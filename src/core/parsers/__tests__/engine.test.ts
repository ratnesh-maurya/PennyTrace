import { toPaise } from '../engine/patterns';
import { find, gv, replaceAll } from '../engine/regex';
import { detectStatus, extractBodyTimestamp, extractRefs, extractVpa, inferDirection } from '../engine/toEvent';
import { listSupportedBanks, parseSms, PARSER_SCHEMA_VERSION } from '../index';

const IST = (y: number, mo: number, d: number, h: number, mi: number, s = 0) =>
  Date.UTC(y, mo - 1, d, h, mi, s) - (5 * 60 + 30) * 60 * 1000;

describe('regex helpers (Kotlin semantics)', () => {
  it('replaceAll replaces every match even without the g flag', () => {
    expect(replaceAll('a-b-c', /-/, '+')).toBe('a+b+c');
  });
  it('find never mutates a shared regex', () => {
    const re = /(\d+)/;
    expect(gv(find(re, 'x 12 y 34'), 1)).toBe('12');
    expect(gv(find(re, 'x 12 y 34'), 1)).toBe('12');
    expect(gv(find(/(z)?x/, 'x'), 1)).toBe('');
  });
});

describe('toPaise', () => {
  it('converts BigDecimal-style strings into integer paise', () => {
    expect(toPaise('1,23,456.78')).toBe(12345678);
    expect(toPaise('500')).toBe(50000);
    expect(toPaise('.28')).toBe(28);
    expect(toPaise('100.')).toBe(10000);
    expect(toPaise('12.345')).toBe(1235);
    expect(toPaise('abc')).toBeNull();
    expect(toPaise('')).toBeNull();
  });
});

describe('detectStatus', () => {
  it('classifies lifecycle wording', () => {
    expect(detectStatus('Rs 500 debited from A/c XX1234')).toBe('success');
    expect(detectStatus('Txn of Rs 500 failed')).toBe('failed');
    expect(detectStatus('Your transaction was declined')).toBe('failed');
    expect(detectStatus('Rs 500 reversed to your a/c')).toBe('reversed');
    expect(detectStatus('Txn failed. Amount will be reversed in 3 days')).toBe('failed');
    expect(detectStatus('Refund initiated: Amt: Rs.300 on card 1111')).toBe('pending');
  });
});

describe('extractRefs', () => {
  it('puts 12-digit references in refs.upi and labelled UTRs in refs.utr', () => {
    expect(extractRefs('UPI Ref No 123456789012', '123456789012')).toEqual({ upi: '123456789012' });
    expect(extractRefs('NEFT UTR HDFCN52026011512345678 credited', null)).toEqual({ utr: 'HDFCN52026011512345678' });
    expect(extractRefs('IMPS Ref 512345678901', '512345678901')).toEqual({ utr: '512345678901' });
    expect(extractRefs('Txn ID AB12CD', 'AB12CD')).toEqual({ other: 'AB12CD' });
    expect(extractRefs('Ref 123', null)).toEqual({});
  });
});

describe('extractVpa', () => {
  it('finds VPAs but not e-mail addresses', () => {
    expect(extractVpa('to VPA shop.name@okaxis on 01-01-26')).toBe('shop.name@okaxis');
    expect(extractVpa('from 9876543210@ybl.')).toBe('9876543210@ybl');
    expect(extractVpa('mail us at care@bank.com')).toBeUndefined();
  });
});

describe('inferDirection', () => {
  it('uses the first money verb', () => {
    expect(inferDirection('A/c X debited and A/c Y credited')).toBe('debit');
    expect(inferDirection('A/c Y credited by transfer from X')).toBe('credit');
    expect(inferDirection('balance enquiry')).toBeUndefined();
  });
});

describe('extractBodyTimestamp', () => {
  const sms = IST(2026, 1, 15, 12, 0);
  it('reads date + time as IST when close to delivery time', () => {
    expect(extractBodyTimestamp('on 15-01-2026 11:45:10 to CAFE', sms)).toBe(IST(2026, 1, 15, 11, 45, 10));
    expect(extractBodyTimestamp('on 15-Jan-26 at 09:05 PM', sms + 24 * 3600 * 1000)).toBe(IST(2026, 1, 15, 21, 5));
    expect(extractBodyTimestamp('On 2026-01-15:05:20:26', sms)).toBe(IST(2026, 1, 15, 5, 20, 26));
  });
  it('ignores date-only bodies and implausible dates', () => {
    expect(extractBodyTimestamp('on 15-01-26 to CAFE', sms)).toBeUndefined();
    expect(extractBodyTimestamp('on 15-01-2025 11:45 to CAFE', sms)).toBeUndefined();
  });
});

describe('parseSms API', () => {
  it('exposes a schema version and the supported banks', () => {
    expect(PARSER_SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
    const banks = listSupportedBanks();
    expect(banks.length).toBeGreaterThan(40);
    expect(new Set(banks.map(b => b.id)).size).toBe(banks.length);
    expect(banks.map(b => b.id)).toEqual(expect.arrayContaining(['hdfc', 'sbi', 'icici', 'axis', 'kotak']));
  });

  it('reports gate drops as ignored with a reason', () => {
    expect(parseSms({ id: '1', address: 'AX-HDFCBK-P', body: 'Rs 500 debited', date: 0 })).toEqual({
      status: 'ignored',
      reason: 'promo_sender',
    });
  });
});

describe('dispatch rules', () => {
  const dop = (address: string) => ({
    id: '1',
    address,
    body: 'Account No. XXXXXXXX1234 CREDIT with amount Rs. 5550.00 on 02-02-2026. Balance: Rs.37500.00. [S33475450]',
    date: 1768458600000,
  });

  it('lets a -G sender through only when a bank parser claims it', () => {
    expect(parseSms(dop('VM-DOPBNK-G')).status).toBe('parsed');
    expect(parseSms({ ...dop('VM-RANDOM-G'), body: 'Rs. 100 debited from your account' }).status).toBe('ignored');
  });

  it('always drops promotional -P senders, even for known banks', () => {
    expect(parseSms(dop('VM-DOPBNK-P')).status).toBe('ignored');
  });

  it('does not let the generic fallback resurrect a known bank rejection', () => {
    // Federal printed this NEFT receipt as a duplicate of the debit: counting it would double-count.
    const federal = {
      id: '2',
      address: 'CP-FEDBNK-S',
      body: 'Jerry Joseph has received Rs 6000.000 from your A/c XX3343 via NEFT on 24-06-2026 22:04:04. Ref no. FDRLM4175007432 - Federal Bank',
      date: 1768458600000,
    };
    expect(parseSms(federal).status).toBe('unparsed');
  });

  it('keeps foreign-currency card spends visible as unparsed instead of dropping them', () => {
    const eur = {
      id: '3',
      address: 'JM-ICICIT-S',
      body: 'EUR 50.00 spent using ICICI Bank Card XX1234 on 05-Sep-25 on Amazon DE. Avl Limit: INR 2,00,000.00.',
      date: 1768458600000,
    };
    expect(parseSms(eur).status).toBe('unparsed');
  });
});

describe('senders no bank parser claims', () => {
  it('are never counted, even when they read like a debit', () => {
    const lic = {
      id: '9',
      address: 'JD-LICIND',
      body: 'Dear Customer, Survival Benefit under policy no.- 123456789 paid by LIC Rs. 19982 to Bank A/C no. XXXXXXXXXX1234.',
      date: 1768458600000,
    };
    expect(parseSms(lic).status).toBe('unparsed');
    const jio = {
      id: '10',
      address: 'JZ-JIOFBR',
      body: 'Dear Customer, Payment of Rs. 2120.46 for your JioAirFiber connection through UPI Payments has been received on 07-Sep-24.',
      date: 1768458600000,
    };
    expect(parseSms(jio).status).toBe('unparsed');
  });
});
