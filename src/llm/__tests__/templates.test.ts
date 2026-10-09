import type { ParsedEvent, RawSms } from '../../core/types';
import { applyTemplates, learnTemplate, TEMPLATE_PARSER_ID } from '../templates';

// Anonymised, synthetic samples in three common Indian bank formats.
const sms = (address: string, body: string, date = 1_791_000_000_000): RawSms => ({ id: 'x', address, body, date });

const event = (over: Partial<ParsedEvent>): ParsedEvent => ({
  kind: 'transaction',
  bank: 'unknown',
  parserId: 'llm-fallback',
  parserVersion: 1,
  amount: 0,
  direction: 'debit',
  status: 'success',
  instrument: 'upi',
  refs: {},
  occurredAt: 0,
  hints: {},
  confidence: 60,
  ...over,
});

describe('learnTemplate → applyTemplates', () => {
  it('HDFC multi-line UPI debit', () => {
    const learnedFrom = sms(
      'AX-HDFCBK-S',
      'Sent Rs.349.00\nFrom HDFC Bank A/C *1234\nTo SWIGGY\nOn 09/10/26\nRef 427812345678\nNot You?\nCall 18002586161/SMS BLOCK UPI to 7308080808',
    );
    const confirmed = event({
      bank: 'hdfc',
      amount: 34_900,
      accountLast4: '1234',
      counterparty: 'SWIGGY',
      refs: { upi: '427812345678' },
    });
    const tpl = learnTemplate(learnedFrom, confirmed, 1);
    expect(tpl.senderKey).toBe('HDFCBK');
    expect(tpl.fields).toEqual(['amount', 'last4', 'counterparty', 'upi']);

    // Same SMS parses back to the confirmed values.
    expect(applyTemplates(learnedFrom, [tpl])).toMatchObject({
      amount: 34_900,
      accountLast4: '1234',
      counterparty: 'SWIGGY',
      refs: { upi: '427812345678' },
    });

    // A new SMS with the same wording but different values.
    const next = sms(
      'VM-HDFCBK',
      'Sent Rs.1,250.50\nFrom HDFC Bank A/C *1234\nTo Ramesh Kumar\nOn 12/11/26\nRef 431899998888\nNot You?\nCall 18002586161/SMS BLOCK UPI to 7308080808',
      1_792_000_000_000,
    );
    expect(applyTemplates(next, [tpl])).toEqual({
      kind: 'transaction',
      bank: 'hdfc',
      parserId: TEMPLATE_PARSER_ID,
      parserVersion: 1,
      amount: 125_050,
      direction: 'debit',
      status: 'success',
      instrument: 'upi',
      accountLast4: '1234',
      counterparty: 'Ramesh Kumar',
      vpa: undefined,
      refs: { upi: '431899998888' },
      balance: undefined,
      occurredAt: 1_792_000_000_000,
      hints: {},
      confidence: 85,
    });
  });

  it('SBI UPI credit with a glued date (08Oct26)', () => {
    const learnedFrom = sms(
      'JD-SBIUPI',
      'Dear UPI user A/C X5678 credited by 2500.00 on date 08Oct26 trf from PRIYA S Refno 528112345678. If not u? call 1800111109. -SBI',
    );
    const tpl = learnTemplate(
      learnedFrom,
      event({
        bank: 'sbi',
        direction: 'credit',
        amount: 250_000,
        accountLast4: '5678',
        counterparty: 'PRIYA S',
        refs: { upi: '528112345678' },
      }),
    );
    const next = sms(
      'BZ-SBIUPI',
      'Dear UPI user A/C X5678 credited by 10,000.00 on date 12Nov26 trf from ACME PVT LTD Refno 528187654321. If not u? call 1800111109. -SBI',
    );
    expect(applyTemplates(next, [tpl])).toMatchObject({
      bank: 'sbi',
      direction: 'credit',
      amount: 1_000_000,
      accountLast4: '5678',
      counterparty: 'ACME PVT LTD',
      refs: { upi: '528187654321' },
    });
  });

  it('ICICI card spend with balance-like limit and repeated last 4', () => {
    const learnedFrom = sms(
      'AD-ICICIT',
      'INR 1,499.00 spent using ICICI Bank Card XX4321 on 07-Oct-26 on AMAZON PAY IN. Avl Limit: INR 2,34,567.89. If not you, call 1800 2662/SMS BLOCK 4321 to 9215676766.',
    );
    const tpl = learnTemplate(
      learnedFrom,
      event({
        bank: 'icici',
        instrument: 'card',
        amount: 149_900,
        accountLast4: '4321',
        counterparty: 'AMAZON PAY IN',
      }),
    );
    expect(tpl.fields).toEqual(['amount', 'last4', 'counterparty']);
    const next = sms(
      'AD-ICICIT',
      'INR 250.00 spent using ICICI Bank Card XX4321 on 15-Nov-26 on UBER INDIA. Avl Limit: INR 2,30,000.00. If not you, call 1800 2662/SMS BLOCK 4321 to 9215676766.',
    );
    expect(applyTemplates(next, [tpl])).toMatchObject({
      bank: 'icici',
      instrument: 'card',
      amount: 25_000,
      accountLast4: '4321',
      counterparty: 'UBER INDIA',
    });
  });

  it('captures balance separately from amount', () => {
    const learnedFrom = sms(
      'AX-AXISBK',
      'INR 500.00 debited from A/c no. XX9012 on 01-10-2026 at ATM. Avl Bal INR 12,000.00',
    );
    const tpl = learnTemplate(learnedFrom, event({ amount: 50_000, accountLast4: '9012', balance: 1_200_000, instrument: 'account' }));
    expect(tpl.fields).toEqual(['amount', 'last4', 'balance']);
    const next = sms('AX-AXISBK', 'INR 2,000.00 debited from A/c no. XX9012 on 03-10-2026 at ATM. Avl Bal INR 10,000.00');
    expect(applyTemplates(next, [tpl])).toMatchObject({ amount: 200_000, balance: 1_000_000 });
  });

  it('does not apply across senders or to different wording', () => {
    const learnedFrom = sms('AX-HDFCBK', 'Sent Rs.349.00 From HDFC Bank A/C *1234 To SWIGGY On 09/10/26 Ref 427812345678');
    const tpl = learnTemplate(
      learnedFrom,
      event({ amount: 34_900, accountLast4: '1234', counterparty: 'SWIGGY', refs: { upi: '427812345678' } }),
    );
    expect(applyTemplates({ ...learnedFrom, address: 'AX-ICICIB' }, [tpl])).toBeNull();
    expect(
      applyTemplates(sms('AX-HDFCBK', 'Received Rs.349.00 in HDFC Bank A/C *1234 From SWIGGY On 09/10/26 Ref 427812345678'), [tpl]),
    ).toBeNull();
    expect(applyTemplates(learnedFrom, [])).toBeNull();
  });
});
