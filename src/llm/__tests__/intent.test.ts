import type { Account, Ledger, Transaction } from '../../core/types';
import { acceptPhrase, executeIntent, normalizeIntent, resolveRange, templateAnswer, type QueryIntent } from '../intent';

// Friday 9 Oct 2026, 15:00 local time.
const NOW = +new Date(2026, 9, 9, 15, 0);
const at = (month: number, day: number, hour = 12) => +new Date(2026, month - 1, day, hour);

const account = (over: Partial<Account>): Account => ({
  id: 'x',
  bank: 'hdfc',
  type: 'savings',
  ownership: 'personal',
  mask: '0000',
  displayName: '',
  upiIds: [],
  aliases: [],
  includeInTotal: true,
  ...over,
});

let seq = 0;
const txn = (over: Partial<Transaction>): Transaction => {
  seq += 1;
  return {
    id: `t${seq}`,
    stableKey: `k${seq}`,
    accountId: 'hdfc',
    amount: 10_000,
    direction: 'debit',
    occurredAt: NOW,
    status: 'success',
    kind: 'spend',
    categoryId: 'food',
    confidence: 90,
    ruleProvenance: 'test',
    needsReview: false,
    refs: {},
    sourceIds: [`s${seq}`],
    parserId: 'test',
    ...over,
  };
};

const ledger: Ledger = {
  accounts: [
    account({ id: 'hdfc', bank: 'hdfc', mask: '1234', displayName: 'HDFC Salary' }),
    account({ id: 'sbi', bank: 'sbi', mask: '5678', displayName: 'SBI Savings' }),
    account({ id: 'joint', bank: 'icici', mask: '9012', displayName: 'Joint', ownership: 'joint', includeInTotal: false }),
    account({ id: 'card', bank: 'icici', mask: '4321', type: 'credit_card', displayName: 'Amazon Card' }),
  ],
  transactions: [
    // today
    txn({ amount: 34_900, counterparty: 'Swiggy', categoryId: 'food', occurredAt: at(10, 9, 9) }),
    txn({ amount: 25_000, counterparty: 'Uber', categoryId: 'travel', occurredAt: at(10, 9, 10), accountId: 'sbi' }),
    txn({ amount: 1_000, kind: 'fee', categoryId: 'fees', occurredAt: at(10, 9, 11) }),
    // yesterday
    txn({ amount: 45_000, counterparty: 'Swiggy', categoryId: 'food', occurredAt: at(10, 8) }),
    txn({ amount: 99_900, counterparty: 'Amazon', categoryId: 'shopping', occurredAt: at(10, 8), accountId: 'card' }),
    // earlier this month (last week: Mon 28 Sep – Sun 4 Oct)
    txn({ amount: 150_000, counterparty: 'DMart', categoryId: 'groceries', occurredAt: at(10, 2) }),
    txn({ amount: 5_000_000, kind: 'in', direction: 'credit', categoryId: 'salary', counterparty: 'ACME', occurredAt: at(10, 1) }),
    // last month
    txn({ amount: 70_000, counterparty: 'Swiggy', categoryId: 'food', occurredAt: at(9, 20) }),
    // excluded: not spending / not success / not in scope
    txn({ amount: 500_000, kind: 'xfer', categoryId: 'transfer', occurredAt: at(10, 9) }),
    txn({ amount: 20_000, kind: 'refund', direction: 'credit', categoryId: 'refund', occurredAt: at(10, 9) }),
    txn({ amount: 30_000, status: 'failed', occurredAt: at(10, 9) }),
    txn({ amount: 40_000, accountId: 'joint', occurredAt: at(10, 9) }),
    txn({ amount: 60_000, kind: 'pending_xfer', categoryId: 'transfer', occurredAt: at(10, 9) }),
  ],
  transferLinks: [],
  snapshots: [
    { accountId: 'hdfc', at: at(10, 7), reported: 4_000_000, sourceId: 's' },
    { accountId: 'hdfc', at: at(10, 9, 9), reported: 4_100_000, sourceId: 's' },
    { accountId: 'sbi', at: at(10, 5), reported: 1_250_050, sourceId: 's' },
    { accountId: 'card', at: at(10, 8), reported: 99_900, sourceId: 's' },
  ],
};

const run = (intent: QueryIntent) => executeIntent(ledger, intent, NOW);

describe('resolveRange', () => {
  it('uses Monday weeks and calendar months', () => {
    expect(resolveRange({ preset: 'this_week' }, NOW).start).toBe(+new Date(2026, 9, 5));
    expect(resolveRange({ preset: 'last_week' }, NOW)).toMatchObject({
      start: +new Date(2026, 8, 28),
      end: +new Date(2026, 9, 5),
    });
    expect(resolveRange({ preset: 'last_month' }, NOW)).toMatchObject({
      start: +new Date(2026, 8, 1),
      end: +new Date(2026, 9, 1),
    });
    expect(resolveRange({ preset: 'last_n_days', n: 3 }, NOW)).toMatchObject({
      start: +new Date(2026, 9, 7),
      end: +new Date(2026, 9, 10),
      label: 'in the last 3 days',
    });
  });
});

describe('executeIntent', () => {
  it('spent today counts spend + fee in included accounts only', () => {
    const r = run({ metric: 'spent', range: { preset: 'today' } });
    expect(r.total).toBe(34_900 + 25_000 + 1_000);
    expect(r.count).toBe(3);
    expect(r.accountIds).toEqual(['hdfc', 'sbi', 'card']);
  });

  it('spent this month grouped by category', () => {
    const r = run({ metric: 'spent', range: { preset: 'this_month' }, groupBy: 'category' });
    expect(r.total).toBe(34_900 + 25_000 + 1_000 + 45_000 + 99_900 + 150_000);
    expect(r.rows.map(x => [x.key, x.amount])).toEqual([
      ['groceries', 150_000],
      ['shopping', 99_900],
      ['food', 79_900],
      ['travel', 25_000],
      ['fees', 1_000],
    ]);
  });

  it('received excludes refunds and transfers', () => {
    expect(run({ metric: 'received', range: { preset: 'this_month' } }).total).toBe(5_000_000);
  });

  it('filters by account words and reports unmatched ones', () => {
    expect(run({ metric: 'spent', range: { preset: 'today' }, accounts: ['HDFC'] }).total).toBe(35_900);
    expect(run({ metric: 'spent', range: { preset: 'today' }, accounts: ['••5678'] }).total).toBe(25_000);
    expect(run({ metric: 'spent', range: { preset: 'today' }, accounts: ['joint'] }).total).toBe(40_000);
    const none = run({ metric: 'spent', range: { preset: 'today' }, accounts: ['kotak'] });
    expect(none.total).toBe(0);
    expect(none.warnings[0]).toContain('kotak');
  });

  it('filters by counterparty and category', () => {
    expect(run({ metric: 'spent', range: { preset: 'last_n_days', n: 30 }, counterparty: 'swiggy' }).total).toBe(
      34_900 + 45_000 + 70_000,
    );
    expect(run({ metric: 'count', range: { preset: 'this_month' }, categories: ['food'] }).count).toBe(2);
  });

  it('top merchants and by_category', () => {
    const top = run({ metric: 'top_merchants', range: { preset: 'this_month' } });
    expect(top.rows.slice(0, 3).map(x => [x.label, x.amount, x.count])).toEqual([
      ['DMart', 150_000, 1],
      ['Amazon', 99_900, 1],
      ['Swiggy', 79_900, 2],
    ]);
    expect(top.rows.length).toBeLessThanOrEqual(5);
    const last = run({ metric: 'by_category', range: { preset: 'last_month' } });
    expect(last.rows).toEqual([{ key: 'food', label: 'Food & dining', amount: 70_000, count: 1 }]);
  });

  it('groups by day in date order', () => {
    const r = run({ metric: 'spent', range: { preset: 'last_n_days', n: 2 }, groupBy: 'day' });
    expect(r.rows.map(x => [x.key, x.amount])).toEqual([
      ['2026-10-08', 144_900],
      ['2026-10-09', 60_900],
    ]);
  });

  it('balance uses the latest snapshot before range end and excludes cards from the total', () => {
    const r = run({ metric: 'balance', range: { preset: 'today' } });
    expect(r.rows.map(x => [x.key, x.amount])).toEqual([
      ['hdfc', 4_100_000],
      ['sbi', 1_250_050],
      ['card', 99_900],
    ]);
    expect(r.total).toBe(4_100_000 + 1_250_050);
    const y = run({ metric: 'balance', range: { preset: 'yesterday' }, accounts: ['1234'] });
    expect(y.rows[0].amount).toBe(4_000_000);
  });
});

describe('templateAnswer / acceptPhrase', () => {
  it('phrases results deterministically', () => {
    expect(templateAnswer(run({ metric: 'spent', range: { preset: 'today' } }))).toBe(
      'You spent ₹609 today across 3 transactions.',
    );
    expect(templateAnswer(run({ metric: 'count', range: { preset: 'yesterday' } }))).toBe(
      '2 spending transactions yesterday.',
    );
    expect(templateAnswer(run({ metric: 'balance', range: { preset: 'today' }, accounts: ['sbi'] }))).toBe(
      'SBI Savings ••5678: last reported balance ₹12,501.',
    );
  });

  it('only accepts model phrasing whose numbers come from the result or question', () => {
    const r = run({ metric: 'spent', range: { preset: 'last_n_days', n: 30 }, counterparty: 'swiggy' });
    const q = 'How much on Swiggy in the last 30 days?';
    expect(acceptPhrase('You spent ₹1,499 on Swiggy in the last 30 days, over 3 orders.', r, q)).toBe(true);
    expect(acceptPhrase('You spent ₹1,500 on Swiggy.', r, q)).toBe(false);
    expect(acceptPhrase('About 20% of your spending.', r, q)).toBe(false);
  });
});

describe('normalizeIntent', () => {
  it('accepts schema output and drops nulls / unknown values', () => {
    expect(
      normalizeIntent({
        metric: 'spent',
        range: { preset: 'last_n_days', n: 10 },
        accounts: null,
        categories: ['food', 'not-a-category'],
        counterparty: null,
        groupBy: 'day',
      }),
    ).toEqual({ metric: 'spent', range: { preset: 'last_n_days', n: 10 }, categories: ['food'], groupBy: 'day' });
  });

  it('rejects invalid metric or range', () => {
    expect(normalizeIntent({ metric: 'sql', range: { preset: 'today' } })).toBeNull();
    expect(normalizeIntent({ metric: 'spent', range: { preset: 'forever' } })).toBeNull();
    expect(normalizeIntent(null)).toBeNull();
  });
});
