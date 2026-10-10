import { buildLedger } from '../build';
import { cardSpendOn, cardStatuses } from '../cards';
import { dailyClose } from '../dailyClose';
import { reconcile } from '../reconcile';
import { hdfc, input, pinIST, rs, src } from './fixtures';

pinIST();

const card = (at: string, p: object) =>
  src('VM-HDFCBK-S', at, {
    bank: 'hdfc',
    parserId: 'hdfc-card-debit',
    instrument: 'card',
    accountLast4: '2312',
    hints: { isCreditCard: true },
    amount: 0,
    ...p,
  });

describe('credit card status', () => {
  const sources = [
    card('2026-10-01 10:00', {
      direction: 'credit',
      amount: rs(9000),
      availableLimit: rs(52000),
      hints: { isCreditCard: true, isCardBillPayment: true },
    }),
    card('2026-10-03 10:00', { amount: rs(2000), availableLimit: rs(50000) }),
    card('2026-10-05 10:00', { amount: rs(102), counterparty: 'ZOMATO', availableLimit: rs(49898) }),
  ];

  it('shows the limit, what is used and what is left', () => {
    const [c] = cardStatuses(buildLedger(input(sources)));
    expect(c).toEqual({ accountId: 'hdfc-2312', used: rs(2102), limit: rs(52000), available: rs(49898) });
  });

  it('reports what was charged on a day, per card', () => {
    const ledger = buildLedger(input(sources));
    expect(cardSpendOn(ledger, '2026-10-05')).toEqual([{ accountId: 'hdfc-2312', amount: rs(102), count: 1 }]);
    expect(cardSpendOn(ledger, '2026-10-04')).toEqual([]);
  });

  it('never enters the cash closing balance', () => {
    const cash = hdfc('2026-10-05 09:00', { accountLast4: '3632', amount: rs(50), balance: rs(950) });
    const ledger = buildLedger(input([...sources, cash]));
    const c = dailyClose(ledger, '2026-10-05', 'all');
    expect(c.closing).toBe(rs(950));
    expect(c.spent).toBe(rs(50 + 102)); // spending counts everywhere…
    expect(c.spentOnCard).toBe(rs(102)); // …but the card part is offset in the cash waterfall
  });

  it('an unknown limit is not invented', () => {
    const only = [card('2026-10-05 10:00', { amount: rs(102), counterparty: 'ZOMATO' })];
    const [c] = cardStatuses(buildLedger(input(only)));
    expect(c).toEqual({ accountId: 'hdfc-2312', used: rs(102) });
  });
});

describe('reconciliation dates', () => {
  it('names the two bank reports between which money went missing, and the balance now', () => {
    const a = hdfc('2026-09-02 10:00', { amount: rs(100), balance: rs(10000) });
    const b = hdfc('2026-09-16 10:00', { amount: rs(100), balance: rs(7000) }); // 2,900 left without an SMS
    const later = hdfc('2026-09-20 10:00', { amount: rs(500) });
    const [r] = reconcile(buildLedger(input([a, b, later])));
    expect(r).toMatchObject({ reported: rs(7000), variance: rs(-2900), status: 'off' });
    expect(r.previousReportedAt).toBe(a.receivedAt);
    expect(r.reportedAt).toBe(b.receivedAt);
    expect(r.current).toBe(rs(6500)); // the bank's figure rolled forward, not the SMS-only total
  });
});
