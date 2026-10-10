/**
 * Categories learned from a real inbox: investments are not spending, glued merchant names,
 * the user's own name, and money sent home.
 */
import { buildLedger } from '../build';
import { dailyClose } from '../dailyClose';
import { hdfc, input, pinIST, rs, src } from './fixtures';

pinIST();

const bob = (at: string, p: object) =>
  src('VM-BOBTXN', at, { bank: 'bob', parserId: 'bob-upi-debit', accountLast4: '7433', amount: 0, ...p });
const sbiCredit = (at: string, p: object) =>
  src('JD-SBIUPI', at, {
    bank: 'sbi',
    parserId: 'sbi-upi-credit',
    direction: 'credit',
    accountLast4: '8821',
    amount: 0,
    ...p,
  });

describe('categories from a real inbox', () => {
  it('an SIP to Groww is invested, not spent', () => {
    const sip = hdfc('2026-10-05 09:49', { amount: rs(500), counterparty: 'Groww.Iccl1.Brk', balance: rs(9500) });
    const ledger = buildLedger(input([sip]));
    expect(ledger.transactions[0]).toMatchObject({ kind: 'invest', categoryId: 'investments', needsReview: false });
    const c = dailyClose(ledger, '2026-10-05', 'all');
    expect(c.spent).toBe(0);
    expect(c.movedNet).toBe(rs(-500));
  });

  it('a card merchant with a glued suffix is still Zomato', () => {
    const ledger = buildLedger(input([hdfc('2026-10-08 21:45', { amount: rs(135.98), counterparty: 'ZOMATOCYBS' })]));
    expect(ledger.transactions[0]).toMatchObject({ categoryId: 'food', needsReview: false });
  });

  it('learns the user’s name from a matched transfer, then treats payments to it as transfers', () => {
    const out = bob('2026-10-01 10:00', {
      amount: rs(5000),
      counterparty: 'RATNESH MAURYA',
      refs: { upi: '612345678901' },
    });
    const inn = sbiCredit('2026-10-01 10:00', {
      amount: rs(5000),
      counterparty: 'RATNESH MAURYA',
      refs: { upi: '612345678901' },
    });
    const later = bob('2026-10-06 10:00', { amount: rs(4000), counterparty: 'Ratnesh Maurya' });
    const ledger = buildLedger(input([out, inn, later], { selfIdentities: [] }));
    const t = ledger.transactions.find(x => x.amount === rs(4000))!;
    expect(t.kind).toBe('pending_xfer');
    expect(dailyClose(ledger, '2026-10-06', 'all').spent).toBe(0);
  });

  it('family (same surname, another first name) is “Sent home”', () => {
    const out = bob('2026-10-01 10:00', {
      amount: rs(5000),
      counterparty: 'RATNESH MAURYA',
      refs: { upi: '612345678901' },
    });
    const inn = sbiCredit('2026-10-01 10:00', {
      amount: rs(5000),
      counterparty: 'RATNESH MAURYA',
      refs: { upi: '612345678901' },
    });
    const home = bob('2026-10-02 23:28', { amount: rs(15000), counterparty: 'SHIVANGI MAURYA' });
    const ledger = buildLedger(input([out, inn, home], { selfIdentities: [] }));
    expect(ledger.transactions.find(x => x.amount === rs(15000))).toMatchObject({
      categoryId: 'family',
      kind: 'spend',
      needsReview: false,
    });
  });

  it('without a learned name nobody is assumed to be family', () => {
    const ledger = buildLedger(
      input([bob('2026-10-02 23:28', { amount: rs(15000), counterparty: 'SHIVANGI MAURYA' })], { selfIdentities: [] }),
    );
    expect(ledger.transactions[0].categoryId).toBe('people');
  });
});

describe('payee names', () => {
  it('a UPI handle printed as the name shows only the part before "@"', () => {
    const ledger = buildLedger(
      input([hdfc('2026-10-05 10:00', { amount: rs(1147.1), counterparty: 'MANMATTERS@YESPAY' })]),
    );
    expect(ledger.transactions[0].counterparty).toBe('Manmatters');
  });
});

describe('custom categories', () => {
  const pets = { id: 'custom-pets', name: 'Pets', icon: 'home', color: '#12B886', group: 'expense' as const };

  it('a correction and a rule can use a category the user created', () => {
    const vet = hdfc('2026-10-05 10:00', { amount: rs(800), counterparty: 'HAPPY PAWS CLINIC' });
    const vet2 = hdfc('2026-10-06 10:00', { amount: rs(300), counterparty: 'HAPPY PAWS CLINIC' });
    const ledger = buildLedger(
      input([vet, vet2], {
        customCategories: [pets],
        rules: [
          {
            id: 'user:happy paws clinic',
            pattern: 'HAPPY PAWS',
            field: 'counterparty',
            categoryId: 'custom-pets',
            priority: 100,
            source: 'user',
          },
        ],
      }),
    );
    expect(ledger.transactions.map(t => t.categoryId)).toEqual(['custom-pets', 'custom-pets']);
    expect(dailyClose(ledger, '2026-10-05', 'all').byCategory).toEqual([
      { categoryId: 'custom-pets', amount: rs(800), count: 1 },
    ]);
  });

  it('without the definition the rule is ignored rather than inventing a category', () => {
    const vet = hdfc('2026-10-05 10:00', { amount: rs(800), counterparty: 'HAPPY PAWS CLINIC' });
    const ledger = buildLedger(
      input([vet], {
        rules: [
          {
            id: 'u',
            pattern: 'HAPPY PAWS',
            field: 'counterparty',
            categoryId: 'custom-pets',
            priority: 100,
            source: 'user',
          },
        ],
      }),
    );
    expect(ledger.transactions[0].categoryId).not.toBe('custom-pets');
  });
});
