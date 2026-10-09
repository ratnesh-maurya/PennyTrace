import type { RawSms } from '../../core/types';
import { bankFromSender, senderKey } from '../bank';
import { findNumberLiteral } from '../text';
import { LLM_MAX_CONFIDENCE, LLM_PARSER_ID, amountAppearsIn, validateLlmParse } from '../validate';

const BODY =
  'Rs.349.00 debited from a/c **1234 on 09-10-26 to VPA swiggy@icici (UPI Ref No 427812345678). Avl bal Rs 1,12,345.67';

const sms = (body: string, address = 'AX-HDFCBK-S'): RawSms => ({ id: '1', address, body, date: 1_791_000_000_000 });

const out = (over: Record<string, unknown> = {}) => ({
  is_transaction: true,
  amount: '349.00',
  direction: 'debit',
  account_last4: '1234',
  counterparty: 'swiggy',
  vpa: 'swiggy@icici',
  upi_ref: '427812345678',
  utr: null,
  balance: '1,12,345.67',
  status: 'success',
  ...over,
});

describe('validateLlmParse', () => {
  it('accepts a parse whose numbers all appear literally', () => {
    const ev = validateLlmParse(sms(BODY), out());
    expect(ev).not.toBeNull();
    expect(ev).toMatchObject({
      kind: 'transaction',
      bank: 'hdfc',
      parserId: LLM_PARSER_ID,
      parserVersion: 1,
      amount: 34900,
      direction: 'debit',
      status: 'success',
      instrument: 'upi',
      accountLast4: '1234',
      vpa: 'swiggy@icici',
      refs: { upi: '427812345678' },
      balance: 11234567,
      occurredAt: 1_791_000_000_000,
    });
    expect(ev!.confidence).toBeLessThanOrEqual(LLM_MAX_CONFIDENCE);
  });

  it('accepts amount forms that differ only by grouping commas, currency or trailing .00', () => {
    expect(validateLlmParse(sms(BODY), out({ amount: '349' }))?.amount).toBe(34900);
    expect(validateLlmParse(sms(BODY), out({ amount: 'Rs. 349.00' }))?.amount).toBe(34900);
    const big = sms('INR 12,34,567.00 credited to A/c XX1234. Ref 9988776655');
    expect(validateLlmParse(big, out({ amount: '1234567.00', direction: 'credit', upi_ref: null, balance: null }))?.amount).toBe(
      123456700,
    );
    expect(validateLlmParse(big, out({ amount: '1,234,567', direction: 'credit', upi_ref: null, balance: null }))?.amount).toBe(
      123456700,
    );
  });

  it('rejects a hallucinated amount', () => {
    expect(validateLlmParse(sms(BODY), out({ amount: '350.00' }))).toBeNull();
    expect(validateLlmParse(sms(BODY), out({ amount: '3490' }))).toBeNull();
  });

  it('rejects an amount that is only part of a printed number', () => {
    expect(validateLlmParse(sms(BODY), out({ amount: '49.00' }))).toBeNull();
    expect(validateLlmParse(sms('Rs 349.50 spent on card XX1234'), out({ amount: '349', upi_ref: null, balance: null }))).toBeNull();
    expect(validateLlmParse(sms(BODY), out({ amount: '12' }))).toBeNull();
  });

  it('rejects a hallucinated account_last4', () => {
    expect(validateLlmParse(sms(BODY), out({ account_last4: '9999' }))).toBeNull();
    // digits that sit in the middle of a number are not a last-4
    expect(validateLlmParse(sms(BODY), out({ account_last4: '2781' }))).toBeNull();
  });

  it('rejects references that are not in the body', () => {
    expect(validateLlmParse(sms(BODY), out({ upi_ref: '111122223333' }))).toBeNull();
    expect(validateLlmParse(sms(BODY), out({ utr: 'HDFCN52025100912345' }))).toBeNull();
  });

  it('drops (does not reject) an unprinted balance, counterparty or vpa', () => {
    const ev = validateLlmParse(sms(BODY), out({ balance: '99,999.00', counterparty: 'Zomato', vpa: 'zomato@hdfc' }));
    expect(ev).not.toBeNull();
    expect(ev!.balance).toBeUndefined();
    expect(ev!.counterparty).toBeUndefined();
    expect(ev!.vpa).toBeUndefined();
  });

  it('returns null for non-transactions and malformed output', () => {
    expect(validateLlmParse(sms(BODY), out({ is_transaction: false }))).toBeNull();
    expect(validateLlmParse(sms(BODY), out({ amount: null }))).toBeNull();
    expect(validateLlmParse(sms(BODY), out({ direction: 'sideways' }))).toBeNull();
    expect(validateLlmParse(sms(BODY), undefined)).toBeNull();
    expect(validateLlmParse(sms(BODY), 'Rs 349')).toBeNull();
  });

  it('infers bank from sender, unknown otherwise', () => {
    expect(validateLlmParse(sms(BODY, 'VM-SBIUPI'), out())?.bank).toBe('sbi');
    expect(validateLlmParse(sms(BODY, '+919812345678'), out())?.bank).toBe('unknown');
  });
});

describe('literal helpers', () => {
  it('finds numbers on boundaries only', () => {
    expect(findNumberLiteral('Rs.349.00 spent', '349')).toEqual({ start: 3, end: 6 });
    expect(findNumberLiteral('Rs.1349.00 spent', '349')).toBeUndefined();
    expect(findNumberLiteral('Rs 1,23,456 spent', '123456')).toBeDefined();
    expect(amountAppearsIn('INR 5,000 sent', '5000')).toBe(true);
    expect(amountAppearsIn('INR 5,000 sent', '500')).toBe(false);
  });

  it('normalises senders', () => {
    expect(senderKey('AX-HDFCBK-S')).toBe('HDFCBK');
    expect(senderKey('JD-ICICIT')).toBe('ICICIT');
    expect(bankFromSender('JD-ICICIT')).toBe('icici');
    expect(bankFromSender('AD-AXISBK')).toBe('axis');
  });
});
