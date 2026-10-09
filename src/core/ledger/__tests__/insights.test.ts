import { buildLedger } from '../build';
import { insights } from '../insights';
import { hdfc, icici, input, rs, sbi, pinIST } from './fixtures';

pinIST();

// Week of Mon 5 Oct – Sun 11 Oct 2026, plus the previous week.
const sources = [
  hdfc('2026-09-30 13:00', { amount: rs(1000), counterparty: 'AMAZON' }), // previous week
  hdfc('2026-10-01 09:00', { direction: 'credit', amount: rs(50000), counterparty: 'ACME TECH', hints: { isSalary: true } }),
  hdfc('2026-10-05 13:00', { amount: rs(450), counterparty: 'SWIGGY' }),
  hdfc('2026-10-06 20:00', { amount: rs(350), counterparty: 'Swiggy' }),
  hdfc('2026-10-07 18:00', { amount: rs(1200), counterparty: 'DMART AVENUE' }),
  icici('2026-10-08 21:00', { amount: rs(2000), counterparty: 'DECATHLON' }),
  hdfc('2026-10-09 09:00', { amount: rs(2000), hints: { isAtmWithdrawal: true } }), // not spending
  sbi('2026-10-10 10:00', { direction: 'credit', amount: rs(10000), counterparty: 'AMIT VERMA' }),
  hdfc('2026-10-11 10:00', { amount: rs(5000), status: 'failed', parserId: 'hdfc-upi-failed', counterparty: 'FLIPKART' }), // failed
];
const ledger = buildLedger(input(sources));

describe('insights', () => {
  it('week: 7 day bars Mon..Sun, totals, previous period, kept %', () => {
    const w = insights(ledger, 'week', 'all', '2026-10-11');
    expect(w.bars.map(b => b.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(w.bars.map(b => b.key)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
    expect(w.bars.map(b => b.spent)).toEqual([rs(450), rs(350), rs(1200), rs(2000), 0, 0, 0]);
    expect(w.total).toBe(rs(4000));
    expect(w.avgPerUnit).toBe(Math.round(rs(4000) / 7));
    expect(w.prevTotal).toBe(rs(1000));
    expect(w.moneyIn).toBe(rs(10000));
    expect(w.keptPct).toBe(60);
    expect(w.byAccount).toEqual([
      { accountId: 'hdfc-1234', spent: rs(2000) },
      { accountId: 'icici-4471', spent: rs(2000) },
      { accountId: 'sbi-8821', spent: 0 },
    ]);
    expect(w.categories).toEqual([
      { categoryId: 'shopping', amount: rs(2000), pct: 50 },
      { categoryId: 'groceries', amount: rs(1200), pct: 30 },
      { categoryId: 'food', amount: rs(800), pct: 20 },
    ]);
    expect(w.topMerchants).toEqual([
      { name: 'Decathlon', amount: rs(2000), count: 1 },
      { name: 'Dmart Avenue', amount: rs(1200), count: 1 },
      { name: 'Swiggy', amount: rs(800), count: 2 },
    ]);
  });

  it('month: 4 week bars labelled by start day, avg per week', () => {
    const m = insights(ledger, 'month', 'all', '2026-10-11');
    expect(m.bars.map(b => b.label)).toEqual(['Sep 14', 'Sep 21', 'Sep 28', 'Oct 5']);
    expect(m.bars.map(b => b.spent)).toEqual([0, 0, rs(1000), rs(4000)]);
    expect(m.total).toBe(rs(5000));
    expect(m.avgPerUnit).toBe(rs(1250));
    expect(m.moneyIn).toBe(rs(60000));
    expect(m.keptPct).toBe(92);
  });

  it('single-account scope and no income → keptPct undefined', () => {
    const w = insights(ledger, 'week', 'icici-4471', '2026-10-11');
    expect(w.total).toBe(rs(2000));
    expect(w.keptPct).toBeUndefined();
    expect(w.byAccount).toEqual([{ accountId: 'icici-4471', spent: rs(2000) }]);
  });
});
