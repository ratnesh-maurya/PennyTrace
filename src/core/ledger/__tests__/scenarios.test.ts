/**
 * Ledger scenarios. Each one asserts the daily-close numbers.
 * Accounts: HDFC savings ••1234, SBI savings ••8821, ICICI credit card ••4471.
 */
import { buildLedger } from '../build';
import { dailyClose, weekCloses } from '../dailyClose';
import { position, reconcile } from '../reconcile';
import { expectCloseInvariants, GPAY, hdfc, icici, input, nums, rs, sbi, src, txnsOf, pinIST } from './fixtures';

pinIST();

const H = 'hdfc-1234';
const S = 'sbi-8821';
const C = 'icici-4471';

describe('dedupe', () => {
  it('same SMS delivered twice (same body) → one transaction', () => {
    const a = hdfc('2026-10-05 13:02', { amount: rs(349), counterparty: 'SWIGGY', balance: rs(9651) }, { body: 'Rs.349.00 debited from a/c **1234 to SWIGGY. Avl bal Rs.9,651.00', id: 'sms:1' });
    const b = { ...a, id: 'sms:2', externalId: '2', receivedAt: a.receivedAt + 5_000 };
    const ledger = buildLedger(input([a, b]));
    expect(ledger.transactions).toHaveLength(1);
    expect(ledger.transactions[0].sourceIds).toEqual(['sms:1']);
    expect(nums(dailyClose(ledger, '2026-10-05', H))).toEqual({ opening: rs(10000), received: 0, spent: rs(349), movedNet: 0, movedGross: 0, closing: rs(9651) });
  });

  it('bank alert + GPay partner-bank alert with the same UPI ref → one txn, two sources, bank alert wins', () => {
    const gpay = src(GPAY, '2026-10-05 19:40', { bank: 'axis', parserId: 'gpay-upi-debit', amount: rs(420), counterparty: 'Uber India', refs: { upi: '412398765432' } }, { delayMin: 0 });
    const bank = hdfc('2026-10-05 19:41', { amount: rs(420), counterparty: 'UBER INDIA SYSTEMS PVT LTD', refs: { upi: '412398765432' }, balance: rs(24580) });
    const ledger = buildLedger(input([gpay, bank]));
    expect(ledger.transactions).toHaveLength(1);
    const t = ledger.transactions[0];
    expect(t.sourceIds.sort()).toEqual([bank.id, gpay.id].sort());
    expect(t.accountId).toBe(H);
    expect(t.parserId).toBe('hdfc-upi-debit');
    expect(t.counterparty).toBe('Uber India Systems Pvt Ltd');
    expect(t.mergeReason).toBe('Same UPI ref 4123… in 2 alerts');
    expect(t.stableKey).toBe(`${H}|ref:412398765432`);
    expect(ledger.accounts.map(a => a.id)).toEqual([H]);
    expect(nums(dailyClose(ledger, '2026-10-05', 'all'))).toEqual({ opening: rs(25000), received: 0, spent: rs(420), movedNet: 0, movedGross: 0, closing: rs(24580) });
  });

  it('two genuine ₹500 purchases 3 min apart, same template, no ref → two transactions', () => {
    const a = hdfc('2026-10-06 18:02', { parserId: 'hdfc-card-pos', instrument: 'account', amount: rs(500), counterparty: 'DMART AVENUE', balance: rs(4500) });
    const b = hdfc('2026-10-06 18:05', { parserId: 'hdfc-card-pos', instrument: 'account', amount: rs(500), counterparty: 'DMART AVENUE', balance: rs(4000) });
    const ledger = buildLedger(input([a, b]));
    expect(ledger.transactions).toHaveLength(2);
    expect(ledger.transactions.every(t => !t.mergeReason)).toBe(true);
    expect(nums(dailyClose(ledger, '2026-10-06', H))).toEqual({ opening: rs(5000), received: 0, spent: rs(1000), movedNet: 0, movedGross: 0, closing: rs(4000) });
    expect(dailyClose(ledger, '2026-10-06', H).closingProvenance).toBe('reported');
  });

  it('no-ref alerts from different senders within 10 min merge; 11 min apart do not', () => {
    const bank = hdfc('2026-10-06 10:00', { parserId: 'hdfc-neft-debit', instrument: 'account', amount: rs(1500) });
    const relay = src(GPAY, '2026-10-06 10:04', { bank: 'hdfc', parserId: 'gpay-debit', amount: rs(1500) });
    const late = src(GPAY, '2026-10-06 10:11', { bank: 'hdfc', parserId: 'gpay-debit', amount: rs(1500) });
    const merged = buildLedger(input([bank, relay]));
    expect(merged.transactions).toHaveLength(1);
    expect(merged.transactions[0].mergeReason).toBe('Same ₹1,500 debit from HDFCBK and GPAYBK, 4 min apart');
    expect(merged.transactions[0].stableKey).toBe(`fp:${bank.fingerprint}`);
    const separate = buildLedger(input([bank, late]));
    expect(separate.transactions).toHaveLength(2);
    expect(dailyClose(separate, '2026-10-06', H).spent).toBe(rs(3000));
  });

  it('SMS without any reference keeps a fingerprint-based stable key', () => {
    const a = hdfc('2026-10-07 08:30', { amount: rs(60), counterparty: 'CHAI POINT' });
    const ledger = buildLedger(input([a]));
    const t = ledger.transactions[0];
    expect(t.stableKey).toBe(`fp:${a.fingerprint}`);
    expect(t.id).toMatch(/^t_[0-9a-f]{20}$/);
    expect(buildLedger(input([a])).transactions[0].id).toBe(t.id);
    const c = dailyClose(ledger, '2026-10-07', H);
    expect(nums(c)).toEqual({ opening: 0, received: 0, spent: rs(60), movedNet: 0, movedGross: 0, closing: rs(-60) });
    expect(c.closingProvenance).toBe('estimated');
    expect(c.openingProvenance).toBe('estimated');
  });
});

describe('lifecycle', () => {
  it('pending → success is one transaction counted once', () => {
    const pending = hdfc('2026-10-05 11:00', { parserId: 'hdfc-upi-pending', status: 'pending', amount: rs(2000), counterparty: 'BESCOM', refs: { upi: '527711223344' } });
    const done = hdfc('2026-10-05 11:20', { amount: rs(2000), counterparty: 'BESCOM', refs: { upi: '527711223344' }, balance: rs(8000) });
    const ledger = buildLedger(input([done, pending]));
    expect(ledger.transactions).toHaveLength(1);
    const t = ledger.transactions[0];
    expect(t.status).toBe('success');
    expect(t.mergeReason).toBe('Same UPI ref 5277… in 2 alerts · pending → success');
    expect(nums(dailyClose(ledger, '2026-10-05', H))).toEqual({ opening: rs(10000), received: 0, spent: rs(2000), movedNet: 0, movedGross: 0, closing: rs(8000) });
  });

  it('failed transaction is kept for evidence but excluded from totals', () => {
    const ok = hdfc('2026-10-05 09:00', { amount: rs(100), counterparty: 'ZEPTO', balance: rs(900) });
    const failed = hdfc('2026-10-05 12:00', { parserId: 'hdfc-upi-failed', status: 'failed', amount: rs(5000), counterparty: 'AMAZON', refs: { upi: '600011112222' } });
    const ledger = buildLedger(input([ok, failed]));
    expect(ledger.transactions).toHaveLength(2);
    const f = ledger.transactions.find(t => t.status === 'failed')!;
    expect(f.needsReview).toBe(false);
    const c = dailyClose(ledger, '2026-10-05', H);
    expect(nums(c)).toEqual({ opening: rs(1000), received: 0, spent: rs(100), movedNet: 0, movedGross: 0, closing: rs(900) });
    expect(c.txnIds).toContain(f.id);
  });

  it('pending → failed: excluded', () => {
    const pending = hdfc('2026-10-05 11:00', { parserId: 'hdfc-upi-pending', status: 'pending', amount: rs(700), refs: { upi: '700000000001' } });
    const failed = hdfc('2026-10-05 11:03', { parserId: 'hdfc-upi-failed', status: 'failed', amount: rs(700), refs: { upi: '700000000001' } });
    const ledger = buildLedger(input([pending, failed]));
    expect(ledger.transactions).toHaveLength(1);
    expect(ledger.transactions[0].status).toBe('failed');
    expect(dailyClose(ledger, '2026-10-05', H).spent).toBe(0);
  });

  it('refund is its own transaction, linked to the original, and not income', () => {
    const buy = hdfc('2026-10-05 13:00', { amount: rs(450), counterparty: 'SWIGGY', refs: { upi: '611100001111' }, balance: rs(9550) });
    const refund = hdfc('2026-10-07 10:00', { parserId: 'hdfc-upi-credit', direction: 'credit', amount: rs(450), counterparty: 'Swiggy', refs: { upi: '611100009999' }, hints: { isRefund: true }, balance: rs(10000) });
    const ledger = buildLedger(input([buy, refund]));
    const [b, r] = ledger.transactions;
    expect(r.kind).toBe('refund');
    expect(r.categoryId).toBe('refund');
    expect(r.linkedTxnId).toBe(b.id);
    expect(r.needsReview).toBe(false);
    expect(nums(dailyClose(ledger, '2026-10-05', H))).toEqual({ opening: rs(10000), received: 0, spent: rs(450), movedNet: 0, movedGross: 0, closing: rs(9550) });
    expect(nums(dailyClose(ledger, '2026-10-07', H))).toEqual({ opening: rs(9550), received: 0, spent: 0, movedNet: rs(450), movedGross: rs(450), closing: rs(10000) });
    expectCloseInvariants(ledger, '2026-10-04', 5);
  });

  it('reversal credit undoes the debit: original reversed, both linked, nothing spent', () => {
    const debit = hdfc('2026-10-05 20:10', { amount: rs(500), counterparty: 'UBER', refs: { upi: '622200003333' }, balance: rs(4500) });
    const reversal = hdfc('2026-10-06 09:00', { parserId: 'hdfc-upi-reversal', direction: 'credit', amount: rs(500), refs: { upi: '622200003333' }, hints: { isReversal: true }, balance: rs(5000) });
    const ledger = buildLedger(input([debit, reversal]));
    expect(ledger.transactions).toHaveLength(2);
    const [d, r] = ledger.transactions;
    expect(d.status).toBe('reversed');
    expect(d.linkedTxnId).toBe(r.id);
    expect(r.linkedTxnId).toBe(d.id);
    expect(r.kind).toBe('refund');
    expect(r.ruleProvenance).toBe('Reversal · linked to original');
    // Same ref, same account, opposite direction: the later one gets a suffixed key.
    expect(d.stableKey).toBe(`${H}|ref:622200003333`);
    expect(r.stableKey).toBe(`${H}|ref:622200003333|fp:${reversal.fingerprint}`);
    expect(nums(dailyClose(ledger, '2026-10-05', H))).toEqual({ opening: rs(5000), received: 0, spent: 0, movedNet: rs(-500), movedGross: rs(500), closing: rs(4500) });
    expect(nums(dailyClose(ledger, '2026-10-06', H))).toEqual({ opening: rs(4500), received: 0, spent: 0, movedNet: rs(500), movedGross: rs(500), closing: rs(5000) });
    expectCloseInvariants(ledger, '2026-10-04', 4);
  });
});

describe('transfers', () => {
  it('self transfer HDFC → SBI matched by shared ref: not spent, not income', () => {
    const out = hdfc('2026-10-06 09:30', { parserId: 'hdfc-imps-debit', instrument: 'account', amount: rs(5000), refs: { utr: '627912345678' }, balance: rs(15000) });
    const into = sbi('2026-10-06 09:31', { direction: 'credit', instrument: 'account', amount: rs(5000), counterparty: 'RATNESH MAURYA', refs: { utr: '627912345678' }, balance: rs(7000) });
    const ledger = buildLedger(input([into, out]));
    const d = txnsOf(ledger, H)[0];
    const c = txnsOf(ledger, S)[0];
    expect([d.kind, c.kind]).toEqual(['xfer', 'xfer']);
    expect(d.linkedTxnId).toBe(c.id);
    expect(c.linkedTxnId).toBe(d.id);
    expect(d.categoryId).toBe('transfer');
    expect(ledger.transferLinks).toEqual([{ debitTxnId: d.id, creditTxnId: c.id, method: 'ref', state: 'matched', confidence: 99 }]);
    const all = dailyClose(ledger, '2026-10-06', 'all');
    expect(nums(all)).toEqual({ opening: rs(22000), received: 0, spent: 0, movedNet: 0, movedGross: rs(5000), closing: rs(22000) });
    expect(all.transfers).toEqual([{ fromAccountId: H, toAccountId: S, amount: rs(5000), state: 'matched' }]);
    expect(nums(dailyClose(ledger, '2026-10-06', H))).toMatchObject({ spent: 0, movedNet: rs(-5000), closing: rs(15000) });
    expect(nums(dailyClose(ledger, '2026-10-06', S))).toMatchObject({ received: 0, movedNet: rs(5000), closing: rs(7000) });
  });

  it('credit arriving 5 h later: in transit before, matched after — never spent', () => {
    const out = hdfc('2026-10-06 10:00', { parserId: 'hdfc-neft-debit', instrument: 'account', amount: rs(5000), hints: { counterAccountLast4: '8821' }, balance: rs(15000) });
    const before = buildLedger(input([out]));
    const d0 = before.transactions[0];
    expect(d0.kind).toBe('pending_xfer');
    expect(d0.needsReview).toBe(false);
    expect(before.transferLinks).toEqual([{ debitTxnId: d0.id, method: 'alias', state: 'in_transit', confidence: 70 }]);
    const c0 = dailyClose(before, '2026-10-06', 'all');
    expect(nums(c0)).toEqual({ opening: rs(20000), received: 0, spent: 0, movedNet: rs(-5000), movedGross: rs(5000), closing: rs(15000) });
    expect(c0.transfers).toEqual([{ fromAccountId: H, amount: rs(5000), state: 'in_transit' }]);

    const into = sbi('2026-10-06 15:00', { parserId: 'sbi-neft-credit', direction: 'credit', instrument: 'account', amount: rs(5000), balance: rs(5000) });
    const after = buildLedger(input([out, into]));
    const d = txnsOf(after, H)[0];
    const c = txnsOf(after, S)[0];
    expect(d.id).toBe(d0.id); // stable across rebuilds
    expect([d.kind, c.kind]).toEqual(['xfer', 'xfer']);
    expect(after.transferLinks).toEqual([{ debitTxnId: d.id, creditTxnId: c.id, method: 'alias', state: 'matched', confidence: 90 }]);
    const c1 = dailyClose(after, '2026-10-06', 'all');
    expect(nums(c1)).toEqual({ opening: rs(20000), received: 0, spent: 0, movedNet: 0, movedGross: rs(5000), closing: rs(20000) });
  });

  it('equal amount alone does not make a transfer (merchant debit vs friend credit)', () => {
    const buy = hdfc('2026-10-06 10:00', { amount: rs(800), counterparty: 'ZOMATO' });
    const gift = sbi('2026-10-06 12:00', { direction: 'credit', amount: rs(800), counterparty: 'AMIT VERMA' });
    const ledger = buildLedger(input([buy, gift]));
    expect(ledger.transactions.map(t => t.kind)).toEqual(['spend', 'in']);
  });

  it('closest-in-time pairing is one-to-one', () => {
    const d1 = hdfc('2026-10-06 09:00', { amount: rs(2000), counterparty: 'Ratnesh Maurya' });
    const d2 = hdfc('2026-10-06 11:00', { amount: rs(2000), counterparty: 'Ratnesh Maurya' });
    const c1 = sbi('2026-10-06 11:05', { direction: 'credit', amount: rs(2000), counterparty: 'RATNESH MAURYA' });
    const ledger = buildLedger(input([d1, d2, c1]));
    const credit = txnsOf(ledger, S)[0];
    const debits = txnsOf(ledger, H);
    expect(credit.linkedTxnId).toBe(debits[1].id);
    expect(debits[0].kind).toBe('pending_xfer');
    expect(debits[1].kind).toBe('xfer');
  });

  it('card bill payment is a liability, not spending; card spends count on the card', () => {
    const swipe = icici('2026-10-05 21:00', { amount: rs(1800), counterparty: 'DECATHLON', availableLimit: rs(98200) });
    const pay = hdfc('2026-10-07 09:00', { parserId: 'hdfc-billpay-debit', instrument: 'account', amount: rs(12000), counterparty: 'ICICI CARD', hints: { isCardBillPayment: true }, refs: { other: 'BD1234' }, balance: rs(38000) });
    const recv = icici('2026-10-07 18:00', { parserId: 'icici-card-payment', direction: 'credit', amount: rs(12000) });
    const ledger = buildLedger(input([swipe, pay, recv]));
    const card = ledger.accounts.find(a => a.id === C)!;
    expect(card.type).toBe('credit_card');
    expect(card.displayName).toBe('ICICI Card ••4471');
    const p = txnsOf(ledger, H)[0];
    const r = txnsOf(ledger, C).find(t => t.direction === 'credit')!;
    expect([p.kind, r.kind]).toEqual(['liability', 'liability']);
    expect(p.categoryId).toBe('card_payment');
    expect(p.linkedTxnId).toBe(r.id);
    expect(nums(dailyClose(ledger, '2026-10-07', H))).toEqual({ opening: rs(50000), received: 0, spent: 0, movedNet: rs(-12000), movedGross: rs(12000), closing: rs(38000) });
    // Cards are not part of "all"; the card scope shows the swipe.
    expect(dailyClose(ledger, '2026-10-05', 'all').spent).toBe(0);
    expect(nums(dailyClose(ledger, '2026-10-05', C))).toEqual({ opening: 0, received: 0, spent: rs(1800), movedNet: 0, movedGross: 0, closing: rs(-1800) });
    expect(position(ledger)).toEqual({ cash: rs(38000), cardDues: 0, net: rs(38000) });
    expectCloseInvariants(ledger, '2026-10-04', 5);
  });

  it('card dues = card spends − payments', () => {
    const ledger = buildLedger(input([icici('2026-10-05 21:00', { amount: rs(1800), counterparty: 'DECATHLON' }), hdfc('2026-10-05 08:00', { amount: rs(100), balance: rs(900) })]));
    expect(position(ledger)).toEqual({ cash: rs(900), cardDues: rs(1800), net: rs(-900) });
  });

  it('ATM withdrawal moves money to cash; it is not spending', () => {
    const atm = hdfc('2026-10-08 19:00', { parserId: 'hdfc-atm', instrument: 'card', accountLast4: '1234', amount: rs(2000), hints: { isAtmWithdrawal: true }, balance: rs(8000) });
    const ledger = buildLedger(input([atm], { accountEdits: [{ id: H, type: 'savings' }] }));
    const t = ledger.transactions[0];
    expect(t.kind).toBe('cash');
    expect(t.categoryId).toBe('cash');
    expect(nums(dailyClose(ledger, '2026-10-08', 'all'))).toEqual({ opening: rs(10000), received: 0, spent: 0, movedNet: rs(-2000), movedGross: rs(2000), closing: rs(8000) });
  });
});

describe('balances and reconciliation', () => {
  it('variance: bank figure ≠ calculated is reported, not fixed, and no transaction is invented', () => {
    const bal = hdfc('2026-10-05 08:00', { kind: 'balance', parserId: 'hdfc-balance', amount: 0, balance: rs(10000) });
    const a = hdfc('2026-10-06 12:00', { amount: rs(500), counterparty: 'DMART', balance: rs(9500) });
    // A ₹200 debit SMS never arrived; the next alert prints the true balance.
    const b = hdfc('2026-10-07 12:00', { amount: rs(300), counterparty: 'BLINKIT', balance: rs(9000) });
    const ledger = buildLedger(input([bal, a, b]));
    expect(ledger.transactions).toHaveLength(2);
    expect(ledger.snapshots).toHaveLength(3);
    const d6 = dailyClose(ledger, '2026-10-06', H);
    expect(nums(d6)).toEqual({ opening: rs(10000), received: 0, spent: rs(500), movedNet: 0, movedGross: 0, closing: rs(9500) });
    // Oct 5 printed a balance, so Oct 6 opens from the bank's own figure.
    expect([d6.openingProvenance, d6.closingProvenance]).toEqual(['reported', 'reported']);
    const d7 = dailyClose(ledger, '2026-10-07', H);
    expect(nums(d7)).toEqual({ opening: rs(9500), received: 0, spent: rs(300), movedNet: 0, movedGross: 0, closing: rs(9200) });
    expect(d7.reported).toEqual({ closing: rs(9000), at: b.parsed!.occurredAt, accountsMatched: 1, variance: rs(-200) });
    expect(d7.closingProvenance).toBe('calculated');
    // Next day opens from what the bank said.
    const d8 = dailyClose(ledger, '2026-10-08', H);
    expect(nums(d8)).toEqual({ opening: rs(9000), received: 0, spent: 0, movedNet: 0, movedGross: 0, closing: rs(9000) });
    expect(d8.openingProvenance).toBe('reported');
    expect(reconcile(ledger)).toEqual([{ accountId: H, calculated: rs(9200), reported: rs(9000), reportedAt: b.parsed!.occurredAt, variance: rs(-200), status: 'off' }]);
    expect(position(ledger).cash).toBe(rs(9000));
    expectCloseInvariants(ledger, '2026-10-04', 6);
  });

  it('opening walks backward from a later snapshot when none is earlier', () => {
    const a = sbi('2026-10-05 10:00', { amount: rs(250), counterparty: 'BMTC' });
    const b = sbi('2026-10-06 10:00', { direction: 'credit', parserId: 'sbi-salary', instrument: 'account', amount: rs(60000), counterparty: 'ACME TECHNOLOGIES PVT LTD', hints: { isSalary: true }, balance: rs(70000) });
    const ledger = buildLedger(input([a, b]));
    const d5 = dailyClose(ledger, '2026-10-05', S);
    expect(nums(d5)).toEqual({ opening: rs(10250), received: 0, spent: rs(250), movedNet: 0, movedGross: 0, closing: rs(10000) });
    expect(d5.openingProvenance).toBe('calculated');
    const d6 = dailyClose(ledger, '2026-10-06', S);
    expect(nums(d6)).toEqual({ opening: rs(10000), received: rs(60000), spent: 0, movedNet: 0, movedGross: 0, closing: rs(70000) });
    expect(ledger.transactions[1].categoryId).toBe('salary');
    expect(reconcile(ledger)[0].status).toBe('reconciled');
  });

  it('scope reported only when every account reported that day', () => {
    const a = hdfc('2026-10-06 10:00', { amount: rs(100), balance: rs(900) });
    const b = sbi('2026-10-06 11:00', { amount: rs(100) });
    const ledger = buildLedger(input([a, b]));
    expect(dailyClose(ledger, '2026-10-06', 'all').reported).toBeUndefined();
    const c = sbi('2026-10-06 12:00', { kind: 'balance', amount: 0, parserId: 'sbi-balance', balance: rs(400) });
    const l2 = buildLedger(input([a, b, c]));
    expect(dailyClose(l2, '2026-10-06', 'all').reported).toEqual({ closing: rs(1300), at: c.parsed!.occurredAt, accountsMatched: 2, variance: 0 });
  });

  it('joint account is excluded from "all" but analysable on its own', () => {
    const own = hdfc('2026-10-06 10:00', { amount: rs(100), counterparty: 'ZEPTO', balance: rs(900) });
    const joint = sbi('2026-10-06 10:00', { amount: rs(3000), counterparty: 'NOBROKER', balance: rs(20000) });
    const ledger = buildLedger(input([own, joint], { accountEdits: [{ id: S, ownership: 'joint', coHolder: 'Priya' }] }));
    const sb = ledger.accounts.find(a => a.id === S)!;
    expect(sb.includeInTotal).toBe(false);
    expect(sb.coHolder).toBe('Priya');
    expect(nums(dailyClose(ledger, '2026-10-06', 'all'))).toEqual({ opening: rs(1000), received: 0, spent: rs(100), movedNet: 0, movedGross: 0, closing: rs(900) });
    expect(nums(dailyClose(ledger, '2026-10-06', S))).toEqual({ opening: rs(23000), received: 0, spent: rs(3000), movedNet: 0, movedGross: 0, closing: rs(20000) });
    expect(position(ledger).cash).toBe(rs(900));
  });

  it('week strip has seven closes ending on the day', () => {
    const ledger = buildLedger(input([hdfc('2026-10-06 10:00', { amount: rs(100), balance: rs(900) })]));
    const week = weekCloses(ledger, '2026-10-11', 'all');
    expect(week.map(w => w.day)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
    expect(week.map(w => w.spent)).toEqual([0, rs(100), 0, 0, 0, 0, 0]);
  });
});

describe('user overrides', () => {
  const buy = hdfc('2026-10-05 13:00', { amount: rs(640), counterparty: 'SRI KRISHNA STORES', refs: { upi: '633300001111' }, balance: rs(9360) });
  const dup = hdfc('2026-10-05 13:01', { amount: rs(640), counterparty: 'SRI KRISHNA STORES', refs: { upi: '633300002222' } });
  const key = `${H}|ref:633300001111`;

  it('category correction survives a rebuild with new SMS in a different order', () => {
    const overrides = [{ stableKey: key, categoryId: 'groceries' }];
    const first = buildLedger(input([buy], { overrides }));
    const later = hdfc('2026-10-06 09:00', { amount: rs(90), counterparty: 'CHAI POINT' });
    const second = buildLedger(input([later, buy], { overrides }));
    for (const l of [first, second]) {
      const t = l.transactions.find(x => x.stableKey === key)!;
      expect(t).toMatchObject({ categoryId: 'groceries', confidence: 100, ruleProvenance: 'Your correction', needsReview: false });
    }
    expect(dailyClose(second, '2026-10-05', H).byCategory).toEqual([{ categoryId: 'groceries', amount: rs(640), count: 1 }]);
  });

  it('hidden removes a user-flagged duplicate; kind and counterparty can be forced', () => {
    const dupKey = `${H}|ref:633300002222`;
    const ledger = buildLedger(input([buy, dup], { overrides: [{ stableKey: dupKey, hidden: true }, { stableKey: key, kind: 'xfer', counterparty: 'Mom' }] }));
    expect(ledger.transactions).toHaveLength(1);
    expect(ledger.transactions[0]).toMatchObject({ kind: 'xfer', counterparty: 'Mom', categoryId: 'transfer' });
    expect(nums(dailyClose(ledger, '2026-10-05', H))).toMatchObject({ spent: 0, movedNet: rs(-640) });
  });

  it('linkToStableKey forces a transfer pair', () => {
    const out = hdfc('2026-10-05 10:00', { amount: rs(3000), counterparty: 'PAYTM WALLET', refs: { upi: '644400001111' } });
    const into = sbi('2026-10-09 10:00', { direction: 'credit', amount: rs(3000), counterparty: 'PAYTM PAYMENTS', refs: { upi: '644400002222' } });
    const ledger = buildLedger(input([out, into], { overrides: [{ stableKey: `${H}|ref:644400001111`, linkToStableKey: `${S}|ref:644400002222` }] }));
    expect(ledger.transactions.map(t => t.kind)).toEqual(['xfer', 'xfer']);
    expect(ledger.transferLinks[0]).toMatchObject({ method: 'user', state: 'matched', confidence: 100 });
    expect(ledger.transactions[0].ruleProvenance).toBe('Self transfer · linked by you');
  });
});
