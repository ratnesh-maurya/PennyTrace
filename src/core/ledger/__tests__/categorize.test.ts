import { REVIEW_THRESHOLD } from '../../types';
import { buildLedger } from '../build';
import { looksLikePerson } from '../categorize';
import { dailyClose } from '../dailyClose';
import { reviewQueue, searchTransactions } from '../queries';
import { matchSeed } from '../seedRules';
import type { CategoryRule } from '../../types';
import type { P } from './fixtures';
import { hdfc, input, rs, pinIST } from './fixtures';

pinIST();

function one(counterparty: string | undefined, extra: Partial<P> = {}, rules: CategoryRule[] = []) {
  const ledger = buildLedger(input([hdfc('2026-10-05 12:00', { amount: rs(250), counterparty, ...extra })], { rules }));
  return ledger.transactions[0];
}

describe('categorize', () => {
  it('seed merchant list (ported keyword map)', () => {
    expect(one('SWIGGY')).toMatchObject({
      categoryId: 'food',
      confidence: 85,
      ruleProvenance: 'Merchant list · Swiggy → Food & dining',
      needsReview: false,
    });
    expect(one('UBER INDIA SYSTEMS PVT LTD').categoryId).toBe('travel');
    expect(one('DMART AVENUE').categoryId).toBe('groceries');
    expect(one('BESCOM BANGALORE').categoryId).toBe('bills');
    expect(one('APOLLO PHARMACY').categoryId).toBe('health');
    expect(one('SALT LAKE MEDICAL STORE').categoryId).toBe('health'); // shopping exclude
    expect(one('INDIAN OIL PETROL PUMP').categoryId).toBe('fuel');
    expect(one('MOTOROLA SERVICE')).not.toMatchObject({ categoryId: 'travel' }); // word boundary: no "ola"
  });

  it('matches a VPA handle when there is no name', () => {
    expect(one(undefined, { vpa: 'zomato.order@hdfcbank' }).categoryId).toBe('food');
  });

  it('user rule beats the seed list', () => {
    const t = one('DMART AVENUE', {}, [
      {
        id: 'r1',
        pattern: 'DMART AVENUE',
        field: 'counterparty',
        categoryId: 'shopping',
        priority: 10,
        source: 'user',
      },
    ]);
    expect(t).toMatchObject({
      categoryId: 'shopping',
      confidence: 95,
      ruleProvenance: 'Your rule · DMART AVENUE → Shopping',
    });
  });

  it('regex user rule on the SMS body', () => {
    const rules: CategoryRule[] = [
      { id: 'r2', pattern: '/act\\s*fibernet/', field: 'body', categoryId: 'bills', priority: 1, source: 'user' },
    ];
    const sms = hdfc(
      '2026-10-05 12:00',
      { amount: rs(1179), counterparty: 'PAYU' },
      { body: 'Rs 1179 debited from a/c **1234 to PAYU for ACT Fibernet bill. -HDFC' },
    );
    const t = buildLedger(input([sms], { rules })).transactions[0];
    expect(t).toMatchObject({
      categoryId: 'bills',
      ruleProvenance: 'Your rule · /act\\s*fibernet/ → Bills & utilities',
    });
  });

  it('person names go to people at low confidence → review', () => {
    const t = one('RAHUL SHARMA');
    expect(t).toMatchObject({
      categoryId: 'people',
      confidence: 60,
      ruleProvenance: 'Guess · looks like a person',
      needsReview: true,
    });
    expect(looksLikePerson(undefined, '9876543210@ybl')).toBe(true);
    expect(looksLikePerson('SRI KRISHNA STORES', undefined)).toBe(false);
  });

  it('unknown merchant → Other at 40, needs review', () => {
    expect(one('QX7 VENTURES 22')).toMatchObject({ categoryId: 'other', confidence: 40, needsReview: true });
    expect(40).toBeLessThan(REVIEW_THRESHOLD);
  });

  it('bank charges are fees and count as spent', () => {
    const ledger = buildLedger(
      input([hdfc('2026-10-05 12:00', { amount: rs(17.7), counterparty: 'SMS CHARGES', balance: rs(982.3) })]),
    );
    const t = ledger.transactions[0];
    expect(t).toMatchObject({ kind: 'fee', categoryId: 'fees', needsReview: false });
    const c = dailyClose(ledger, '2026-10-05', 'hdfc-1234');
    expect(c.spent).toBe(rs(17.7));
    expect(c.byCategory).toEqual([{ categoryId: 'fees', amount: rs(17.7), count: 1 }]);
  });

  it('credits are income; salary hint → Salary', () => {
    const ledger = buildLedger(
      input([
        hdfc('2026-10-01 09:00', {
          direction: 'credit',
          amount: rs(85000),
          counterparty: 'ACME TECH',
          hints: { isSalary: true },
        }),
        hdfc('2026-10-02 09:00', { direction: 'credit', amount: rs(1200), counterparty: 'AMIT VERMA' }),
      ]),
    );
    expect(ledger.transactions.map(t => [t.kind, t.categoryId, t.needsReview])).toEqual([
      ['in', 'salary', false],
      ['in', 'income', false],
    ]);
  });

  it('seed matcher handles punctuation keywords', () => {
    expect(matchSeed("DOMINO'S PIZZA")?.rule.categoryId).toBe('food');
    expect(matchSeed('H&M HENNES')?.rule.categoryId).toBe('shopping');
    expect(matchSeed('RANDOM LLP')).toBeUndefined();
  });
});

describe('review queue and search', () => {
  const sources = [
    hdfc('2026-10-05 12:00', {
      amount: rs(300),
      counterparty: 'RAHUL SHARMA',
      vpa: 'rahul.s@okaxis',
      refs: { upi: '612345678901' },
    }),
    hdfc('2026-10-06 12:00', { amount: rs(120), counterparty: 'QX7 VENTURES 22' }),
    hdfc('2026-10-07 12:00', { amount: rs(349), counterparty: 'SWIGGY' }),
    hdfc('2026-10-07 13:00', {
      amount: rs(500),
      counterparty: 'ZOMATO',
      status: 'failed',
      parserId: 'hdfc-upi-failed',
    }),
  ];
  const ledger = buildLedger(input(sources));

  it('needsReview only, newest first', () => {
    expect(reviewQueue(ledger).map(t => t.counterparty)).toEqual(['Qx7 Ventures 22', 'Rahul Sharma']);
  });

  it('search by name, vpa, ref and amount', () => {
    expect(searchTransactions(ledger, 'swig').map(t => t.counterparty)).toEqual(['Swiggy']);
    expect(searchTransactions(ledger, 'okaxis').map(t => t.counterparty)).toEqual(['Rahul Sharma']);
    expect(searchTransactions(ledger, '6123456').map(t => t.counterparty)).toEqual(['Rahul Sharma']);
    expect(searchTransactions(ledger, '₹349').map(t => t.counterparty)).toEqual(['Swiggy']);
    expect(searchTransactions(ledger, '349.00').map(t => t.counterparty)).toEqual(['Swiggy']);
    expect(searchTransactions(ledger, '  ')).toEqual([]);
  });
});
