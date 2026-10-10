/**
 * Account resolution on patterns seen in a real inbox: UPI-app copies naming another bank's
 * account, debit-card numbers, alerts without digits, and the user ignoring an account.
 */
import { buildLedger } from '../build';
import { withClosing } from '../closings';
import { dailyClose } from '../dailyClose';
import { hdfc, input, pinIST, rs, src } from './fixtures';

pinIST();

const bob = (at: string, amount: number, extra: object = {}) =>
  src('VM-BOBTXN', at, { bank: 'bob', parserId: 'bob-upi-debit', accountLast4: '7433', amount: rs(amount), ...extra });
const sbiUpiCopy = (at: string, amount: number) =>
  src('JD-SBIUPI', at, {
    bank: 'sbi',
    parserId: 'sbi-upi-credit',
    direction: 'credit',
    accountLast4: '7433',
    amount: rs(amount),
  });

describe('account resolution', () => {
  it('an SBI UPI alert about a/c X7433 belongs to the much busier Bank of Baroda ••7433', () => {
    const many = Array.from({ length: 8 }, (_, i) => bob(`2026-10-0${1 + (i % 8)} 10:0${i}`, 100 + i));
    const ledger = buildLedger(input([...many, sbiUpiCopy('2026-10-05 12:00', 230)]));
    expect(ledger.accounts.map(a => a.id)).toEqual(['bob-7433']);
    expect(ledger.transactions.find(t => t.amount === rs(230))?.accountId).toBe('bob-7433');
  });

  it('two genuinely active accounts with the same digits at different banks stay separate', () => {
    const a = [bob('2026-10-01 10:00', 100), bob('2026-10-02 10:00', 200)];
    const b = [sbiUpiCopy('2026-10-03 10:00', 300), sbiUpiCopy('2026-10-04 10:00', 400)];
    expect(buildLedger(input([...a, ...b])).accounts.map(x => x.id)).toEqual(['bob-7433', 'sbi-7433']);
  });

  it('a debit-card number is the card of the bank’s only savings account', () => {
    const atm = hdfc('2026-10-05 16:00', {
      parserId: 'hdfc-atm-debit',
      instrument: 'card',
      accountLast4: '0533',
      amount: rs(200),
      hints: { isAtmWithdrawal: true },
    });
    const upi = hdfc('2026-10-04 10:00', { accountLast4: '3632', amount: rs(50) });
    const ledger = buildLedger(input([atm, upi]));
    expect(ledger.accounts.map(a => a.id)).toEqual(['hdfc-3632']);
    expect(ledger.transactions.find(t => t.amount === rs(200))?.accountId).toBe('hdfc-3632');
  });

  it('an alert without digits goes to the bank’s only account of that kind', () => {
    const savings = hdfc('2026-10-04 10:00', { accountLast4: '3632', amount: rs(50) });
    const card = hdfc('2026-10-04 11:00', {
      accountLast4: '2312',
      instrument: 'card',
      amount: rs(70),
      hints: { isCreditCard: true },
    });
    const reversal = hdfc('2026-10-05 09:00', {
      accountLast4: undefined,
      instrument: 'card',
      direction: 'credit',
      amount: rs(1000),
      hints: { isCreditCard: true, isReversal: true },
    });
    const ledger = buildLedger(input([savings, card, reversal]));
    expect(ledger.accounts.map(a => a.id)).toEqual(['hdfc-2312', 'hdfc-3632']);
    expect(ledger.transactions.find(t => t.amount === rs(1000))?.accountId).toBe('hdfc-2312');
  });

  it('a bank with no numbered account gets a placeholder that stays out of totals', () => {
    const mandate = src('JK-AXISBK', '2026-10-05 10:00', {
      bank: 'axis',
      parserId: 'axis-mandate-debit',
      amount: rs(68),
    });
    const ledger = buildLedger(input([hdfc('2026-10-05 09:00', { amount: rs(50), balance: rs(950) }), mandate]));
    expect(ledger.accounts.find(a => a.id === 'axis-unknown')).toMatchObject({ includeInTotal: false });
    expect(dailyClose(ledger, '2026-10-05', 'all').spent).toBe(rs(50));
  });
});

describe('ignoring an account', () => {
  const canara = (at: string, amount: number, extra: object = {}) =>
    src('VM-CANBNK', at, {
      bank: 'canara',
      parserId: 'canara-upi-debit',
      accountLast4: '5754',
      amount: rs(amount),
      ...extra,
    });

  it('drops its transactions and balances but keeps the account so it can be restored', () => {
    const sources = [
      canara('2026-10-05 10:00', 500, { balance: rs(9500) }),
      hdfc('2026-10-05 11:00', { amount: rs(50), balance: rs(950) }),
    ];
    const ledger = buildLedger(input(sources, { accountEdits: [{ id: 'canara-5754', ignored: true }] }));
    expect(ledger.accounts.find(a => a.id === 'canara-5754')).toMatchObject({ ignored: true, includeInTotal: false });
    expect(ledger.transactions.map(t => t.accountId)).toEqual(['hdfc-1234']);
    expect(ledger.snapshots.every(s => s.accountId !== 'canara-5754')).toBe(true);
    expect(dailyClose(ledger, '2026-10-05', 'all').spent).toBe(rs(50));
  });

  it('a transfer into an ignored account is still a move, not spending', () => {
    const out = hdfc('2026-10-05 11:00', { amount: rs(2000), refs: { upi: '512345678901' }, balance: rs(8000) });
    const inn = canara('2026-10-05 11:01', 2000, {
      direction: 'credit',
      parserId: 'canara-upi-credit',
      refs: { upi: '512345678901' },
    });
    const ledger = buildLedger(input([out, inn], { accountEdits: [{ id: 'canara-5754', ignored: true }] }));
    const c = dailyClose(ledger, '2026-10-05', 'all');
    expect(c.spent).toBe(0);
    expect(c.movedNet).toBe(rs(-2000));
    expect(ledger.transferLinks[0]).toMatchObject({ state: 'matched', creditTxnId: undefined });
  });
});

describe('debit card with a stray extra number at the same bank', () => {
  it('still merges into the dominant savings account', () => {
    const main = Array.from({ length: 5 }, (_, i) =>
      hdfc(`2026-10-0${i + 1} 10:00`, { accountLast4: '3632', amount: rs(10 + i) }),
    );
    const stray = hdfc('2026-10-06 10:00', { accountLast4: '6542', parserId: 'hdfc-mandate-debit', amount: rs(2) });
    const atm = hdfc('2026-10-07 16:00', {
      parserId: 'hdfc-atm-debit',
      instrument: 'card',
      accountLast4: '0533',
      amount: rs(200),
    });
    const ledger = buildLedger(input([...main, stray, atm]));
    expect(ledger.transactions.find(t => t.amount === rs(200))?.accountId).toBe('hdfc-3632');
    expect(ledger.accounts.map(a => a.id)).toEqual(['hdfc-3632', 'hdfc-6542']);
  });
});

describe('credit card dues from available-limit alerts', () => {
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

  it('uses the highest available limit as the credit limit and the latest reading as the dues', () => {
    const ledger = buildLedger(
      input([
        card('2026-10-01 10:00', {
          direction: 'credit',
          amount: rs(9000),
          availableLimit: rs(52000),
          hints: { isCardBillPayment: true },
        }),
        card('2026-10-03 10:00', { amount: rs(2000) }),
        card('2026-10-05 10:00', {
          direction: 'credit',
          amount: rs(500),
          availableLimit: rs(50500),
          hints: { isCardBillPayment: true },
        }),
      ]),
    );
    expect(ledger.accounts[0]).toMatchObject({ type: 'credit_card', creditLimit: rs(52000) });
    // Dues = limit − latest available = 1,500 (not years of spends with missing payments).
    expect(ledger.snapshots.at(-1)?.reported).toBe(rs(-1500));
  });
});

describe('closing balances the user enters', () => {
  const top = src('AD-SLCEIT-S', '2026-10-01 10:00', {
    bank: 'slice',
    parserId: 'slice-account-credit',
    direction: 'credit',
    accountLast4: '2851',
    amount: rs(1000),
    balance: rs(12900),
  });
  const out1 = src('VA-SLCBNK-S', '2026-10-05 10:00', {
    bank: 'slice',
    parserId: 'slice-upi-debit',
    accountLast4: '2851',
    amount: rs(15000),
  });
  const out2 = src('VA-SLCBNK-S', '2026-10-07 10:00', {
    bank: 'slice',
    parserId: 'slice-upi-debit',
    accountLast4: '2851',
    amount: rs(1000),
  });
  const S = 'slice-2851';

  it('without them, missing credits make the balance impossible', () => {
    const ledger = buildLedger(input([top, out1, out2]));
    expect(dailyClose(ledger, '2026-10-05', S).closing).toBe(rs(-2100));
  });

  it('a past day closes at the entered figure and later days roll forward from it', () => {
    const ledger = buildLedger(
      input([top, out1, out2], {
        accountEdits: [{ id: S, closingBalances: [{ day: '2026-10-05', closing: rs(4200) }] }],
      }),
    );
    expect(dailyClose(ledger, '2026-10-05', S)).toMatchObject({ opening: rs(19200), closing: rs(4200) });
    expect(dailyClose(ledger, '2026-10-06', S).closing).toBe(rs(4200));
    expect(dailyClose(ledger, '2026-10-07', S).closing).toBe(rs(3200));
  });

  it('a later entry takes over from its own day', () => {
    const ledger = buildLedger(
      input([top, out1, out2], {
        accountEdits: [
          {
            id: S,
            closingBalances: [
              { day: '2026-10-05', closing: rs(4200) },
              { day: '2026-10-07', closing: rs(9000) },
            ],
          },
        ],
      }),
    );
    expect(dailyClose(ledger, '2026-10-06', S).closing).toBe(rs(4200));
    expect(dailyClose(ledger, '2026-10-07', S)).toMatchObject({ opening: rs(10000), closing: rs(9000) });
  });
});

describe('withClosing', () => {
  it('keeps one entry per day, sorted, and removes with undefined', () => {
    const a = withClosing(undefined, '2026-10-07', 900);
    const b = withClosing(a, '2026-10-05', 500);
    expect(withClosing(b, '2026-10-07', 700)).toEqual([
      { day: '2026-10-05', closing: 500 },
      { day: '2026-10-07', closing: 700 },
    ]);
    expect(withClosing(b, '2026-10-05', undefined)).toEqual([{ day: '2026-10-07', closing: 900 }]);
  });
});
