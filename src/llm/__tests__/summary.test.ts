import type { DailyClose } from '../../core/types';
import { AllowedNumbers, canonicalNumber, numbersIn } from '../numbers';
import { acceptSummary, summaryAllowedNumbers, summaryFacts, templateSummary } from '../summaryTemplate';

const close = (over: Partial<DailyClose> = {}): DailyClose => ({
  day: '2026-10-09',
  scope: 'all',
  opening: 5_000_000,
  received: 250_000,
  spent: 185_000,
  movedNet: 0,
  movedGross: 500_000,
  closing: 5_065_000,
  openingProvenance: 'reported',
  closingProvenance: 'calculated',
  byCategory: [
    { categoryId: 'food', amount: 120_000, count: 3 },
    { categoryId: 'travel', amount: 65_000, count: 2 },
  ],
  transfers: [{ fromAccountId: 'a', toAccountId: 'b', amount: 500_000, state: 'matched' }],
  txnIds: ['t1', 't2', 't3', 't4', 't5', 't6'],
  ...over,
});

describe('templateSummary', () => {
  it('states the computed numbers', () => {
    const text = templateSummary(close());
    expect(text).toBe(
      'You spent ₹1,850 on 9 Oct, mostly on Food & dining (₹1,200). ' +
        'You received ₹2,500 and ₹5,000 moved between your accounts. ' +
        'Calculated closing balance: ₹50,650.',
    );
  });

  it('uses provided names and mentions a reported variance', () => {
    const text = templateSummary(
      close({
        byCategory: [
          { categoryId: 'food', amount: 60_000, count: 1 },
          { categoryId: 'travel', amount: 125_000, count: 2 },
        ],
        reported: { closing: 5_000_000, at: 0, accountsMatched: 2, variance: -65_000 },
      }),
      { travel: 'Cabs' },
    );
    expect(text).toContain('mostly on Cabs (₹1,250)');
    expect(text).toContain('the bank reports ₹50,000, a difference of ₹650');
  });

  it('handles an empty day', () => {
    const text = templateSummary(close({ spent: 0, received: 0, movedGross: 0, byCategory: [], transfers: [], txnIds: [] }));
    expect(text).toBe('No spending or income recorded on 9 Oct. Calculated closing balance: ₹50,650.');
  });

  it('passes its own number validation', () => {
    expect(acceptSummary(templateSummary(close()), close())).toBe(true);
  });

  it('facts are pre-formatted strings', () => {
    expect(summaryFacts(close())).toMatchObject({ spent: '₹1,850', received: '₹2,500', closing_balance: '₹50,650' });
  });
});

describe('summary number validation', () => {
  it('accepts paraphrases that only use provided numbers, in any common format', () => {
    const c = close();
    expect(acceptSummary('A ₹1,850 day, with ₹1,200 going to food across 3 orders.', c)).toBe(true);
    expect(acceptSummary('You spent Rs 1850.00 and got ₹2500 back in.', c)).toBe(true);
    expect(acceptSummary('On 9 October you ended at ₹50,650.', c)).toBe(true);
  });

  it('rejects any number that was not provided', () => {
    const c = close();
    expect(acceptSummary('You spent ₹1,900 today.', c)).toBe(false);
    expect(acceptSummary('You spent ₹1,850, 12% more than usual.', c)).toBe(false);
    expect(acceptSummary('You spent ₹1,850 across 4 categories.', c)).toBe(false);
  });

  it('rejects markup and empty output', () => {
    expect(acceptSummary('', close())).toBe(false);
    expect(acceptSummary('<b>₹1,850</b>', close())).toBe(false);
    expect(acceptSummary(undefined, close())).toBe(false);
  });

  it('canonicalises numbers', () => {
    expect(canonicalNumber('49,460.00')).toBe('49460');
    expect(canonicalNumber('1.20')).toBe('1.2');
    expect(numbersIn('₹1,850 and 3 items on 09')).toEqual(['1850', '3', '9']);
    const allowed = new AllowedNumbers().addAmount(4_946_050);
    expect(allowed.allows('₹49,461')).toBe(true);
    expect(allowed.allows('₹49,460.50')).toBe(true);
    expect(allowed.allows('₹49.5k')).toBe(true);
    expect(allowed.allows('₹49,460')).toBe(false);
    expect(summaryAllowedNumbers(close()).has('6')).toBe(true);
  });
});
