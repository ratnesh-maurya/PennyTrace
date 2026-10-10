/**
 * Property: the ledger is a pure function of the evidence set.
 * - Shuffling the sources gives the identical ledger.
 * - Re-delivering / rescanning the same SMS (same fingerprint) changes nothing.
 * - Daily-close invariants hold for every scope and day.
 */
import fc from 'fast-check';
import { fingerprint } from '../../sms/fingerprint';
import type { Direction, Ledger, LedgerInput, ParsedEvent, SourceEvent, TxnStatus } from '../../types';
import { buildLedger } from '../build';
import { ingestWith } from '../ingest';
import { expectCloseInvariants, GPAY, hdfc, icici, input, ist, rs, sbi, src, pinIST } from './fixtures';

pinIST();

const T0 = ist('2026-10-05 00:00');

const ACCOUNTS = [
  { bank: 'hdfc', last4: '1234', sender: 'AX-HDFCBK-S', parser: 'hdfc-upi' },
  { bank: 'sbi', last4: '8821', sender: 'VM-SBIUPI-S', parser: 'sbi-upi' },
  { bank: 'icici', last4: '4471', sender: 'JD-ICICIT-S', parser: 'icici-card' },
  { bank: 'hdfc', last4: undefined, sender: 'AD-GPAYBK-S', parser: 'gpay' },
] as const;

const arbSource = fc.record({
  account: fc.integer({ min: 0, max: ACCOUNTS.length - 1 }),
  amount: fc.constantFrom(rs(349), rs(500), rs(1200), rs(5000)),
  direction: fc.constantFrom<Direction>('debit', 'debit', 'credit'),
  status: fc.constantFrom<TxnStatus>('success', 'success', 'success', 'pending', 'failed', 'reversed'),
  minute: fc.integer({ min: 0, max: 4 * 24 * 60 }),
  ref: fc.option(fc.constantFrom('411100000001', '411100000002', '411100000003'), { nil: undefined }),
  counterparty: fc.option(fc.constantFrom('SWIGGY', 'Ratnesh Maurya', 'RAHUL SHARMA', 'DMART AVENUE', 'ICICI CARD'), {
    nil: undefined,
  }),
  balance: fc.option(
    fc.integer({ min: 0, max: 2000 }).map(r => rs(r)),
    { nil: undefined },
  ),
  flavour: fc.constantFrom(
    'plain',
    'plain',
    'plain',
    'refund',
    'reversal',
    'atm',
    'cardbill',
    'self',
    'balance',
    'alt-template',
  ),
});

type Gen = typeof arbSource extends fc.Arbitrary<infer T> ? T : never;

function toSource(g: Gen, i: number): SourceEvent {
  const a = ACCOUNTS[g.account];
  const occurredAt = T0 + g.minute * 60_000;
  const isBalance = g.flavour === 'balance';
  const parsed: ParsedEvent = {
    kind: isBalance ? 'balance' : 'transaction',
    bank: a.bank,
    parserId: `${a.parser}-${g.flavour === 'alt-template' ? 'alt' : g.direction}`,
    parserVersion: 1,
    amount: isBalance ? 0 : g.amount,
    direction: g.direction,
    status: g.status,
    instrument: a.bank === 'icici' ? 'card' : 'upi',
    refs: g.ref ? { upi: g.ref } : {},
    occurredAt,
    hints: {
      ...(g.flavour === 'refund' ? { isRefund: true } : {}),
      ...(g.flavour === 'reversal' ? { isReversal: true } : {}),
      ...(g.flavour === 'atm' ? { isAtmWithdrawal: true } : {}),
      ...(g.flavour === 'cardbill' ? { isCardBillPayment: true } : {}),
      ...(g.flavour === 'self' ? { counterAccountLast4: g.account === 0 ? '8821' : '1234' } : {}),
    },
    confidence: 90,
  };
  if (a.last4) {
    parsed.accountLast4 = a.last4;
  }
  if (g.counterparty) {
    parsed.counterparty = g.counterparty;
  }
  if (g.balance !== undefined || isBalance) {
    parsed.balance = g.balance ?? rs(1000);
  }
  const body = `#${i} ${a.sender} ${JSON.stringify(g)}`;
  return {
    id: `sms:${100 + i}`,
    sourceKind: 'sms',
    externalId: String(100 + i),
    sender: a.sender,
    body,
    fingerprint: fingerprint(a.sender, body),
    receivedAt: occurredAt + 30_000,
    parseStatus: 'parsed',
    parsed,
  };
}

/** The same SMS seen again (rescan / second delivery): same fingerprint, new row id, later. */
function redelivered(s: SourceEvent, k: number): SourceEvent {
  return {
    ...s,
    id: `${s.id}:again${k}`,
    externalId: `${s.externalId}9${k}`,
    receivedAt: s.receivedAt + 60_000 * (k + 1),
  };
}

function build(sources: SourceEvent[], base: Partial<LedgerInput> = {}): Ledger {
  return buildLedger(
    input(sources, {
      accountEdits: [{ id: 'hdfc-1234', upiIds: ['ratnesh@okhdfcbank'] }],
      rules: [
        { id: 'u1', pattern: 'DMART', field: 'counterparty', categoryId: 'groceries', priority: 1, source: 'user' },
      ],
      ...base,
    }),
  );
}

const arbScenario = fc.array(arbSource, { minLength: 1, maxLength: 40 }).map(gs => gs.map(toSource));

describe('ledger properties', () => {
  it('shuffled input → identical ledger', () => {
    fc.assert(
      fc.property(
        arbScenario.chain(sources =>
          fc.tuple(
            fc.constant(sources),
            fc.shuffledSubarray(sources, { minLength: sources.length, maxLength: sources.length }),
          ),
        ),
        ([sources, shuffled]) => {
          expect(build(shuffled)).toEqual(build(sources));
        },
      ),
      { numRuns: 300 },
    );
  });

  it('duplicate deliveries (same fingerprint) → identical ledger, and ingest drops them', () => {
    fc.assert(
      fc.property(
        arbScenario.chain(sources =>
          fc.subarray(sources).chain(sub => {
            const all = [...sources, ...sub.map((s, k) => redelivered(s, k))];
            return fc.tuple(
              fc.constant(sources),
              fc.shuffledSubarray(all, { minLength: all.length, maxLength: all.length }),
            );
          }),
        ),
        ([sources, all]) => {
          expect(build(all)).toEqual(build(sources));
          const raws = sources.map(s => ({ id: s.externalId, address: s.sender, body: s.body!, date: s.receivedAt }));
          const known = new Set(sources.map(s => s.fingerprint));
          expect(ingestWith(() => ({ status: 'ignored' }), raws, known, T0)).toEqual([]);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('daily-close invariants and evidence accounting hold for random ledgers', () => {
    fc.assert(
      fc.property(arbScenario, sources => {
        const ledger = build(sources);
        expectCloseInvariants(ledger, '2026-10-04', 6);
        // Every source backs at most one transaction; ids are unique.
        const ids = ledger.transactions.flatMap(t => t.sourceIds);
        expect(new Set(ids).size).toBe(ids.length);
        expect(new Set(ledger.transactions.map(t => t.id)).size).toBe(ledger.transactions.length);
        expect(new Set(ledger.transactions.map(t => t.stableKey)).size).toBe(ledger.transactions.length);
        // Links point at real transactions.
        const txnIds = new Set(ledger.transactions.map(t => t.id));
        for (const l of ledger.transferLinks) {
          expect(txnIds.has(l.debitTxnId)).toBe(true);
          if (l.creditTxnId) {
            expect(txnIds.has(l.creditTxnId)).toBe(true);
          }
        }
        // Movement kinds never wait for review.
        for (const t of ledger.transactions) {
          if (['xfer', 'pending_xfer', 'liability', 'cash', 'refund'].includes(t.kind)) {
            expect(t.needsReview).toBe(false);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('realistic mixed month: shuffle + rescan give the same ledger', () => {
    const pool = [
      hdfc('2026-10-05 08:00', { kind: 'balance', parserId: 'hdfc-balance', amount: 0, balance: rs(52000) }),
      hdfc('2026-10-05 13:02', {
        amount: rs(349),
        counterparty: 'SWIGGY',
        refs: { upi: '527700000001' },
        balance: rs(51651),
      }),
      src(GPAY, '2026-10-05 13:02', {
        bank: 'axis',
        parserId: 'gpay-upi-debit',
        amount: rs(349),
        counterparty: 'Swiggy',
        refs: { upi: '527700000001' },
      }),
      hdfc('2026-10-05 19:40', { amount: rs(420), counterparty: 'UBER', refs: { upi: '527700000002' } }),
      hdfc('2026-10-06 09:30', {
        parserId: 'hdfc-imps-debit',
        amount: rs(5000),
        refs: { utr: '627900000001' },
        hints: { counterAccountLast4: '8821' },
      }),
      sbi('2026-10-06 14:30', {
        direction: 'credit',
        amount: rs(5000),
        refs: { utr: '627900000001' },
        balance: rs(25000),
      }),
      hdfc('2026-10-06 18:02', { parserId: 'hdfc-pos', amount: rs(500), counterparty: 'DMART AVENUE' }),
      hdfc('2026-10-06 18:05', { parserId: 'hdfc-pos', amount: rs(500), counterparty: 'DMART AVENUE' }),
      icici('2026-10-07 21:00', { amount: rs(2400), counterparty: 'BOOKMYSHOW', availableLimit: rs(97600) }),
      hdfc('2026-10-08 09:00', { amount: rs(15000), hints: { isCardBillPayment: true }, counterparty: 'CRED' }),
      icici('2026-10-08 12:00', { direction: 'credit', parserId: 'icici-card-payment', amount: rs(15000) }),
      hdfc('2026-10-08 19:00', { amount: rs(2000), hints: { isAtmWithdrawal: true } }),
      hdfc('2026-10-09 10:00', {
        direction: 'credit',
        amount: rs(349),
        counterparty: 'SWIGGY',
        hints: { isRefund: true },
      }),
      sbi('2026-10-09 11:00', {
        amount: rs(1840),
        counterparty: 'BESCOM',
        status: 'failed',
        parserId: 'sbi-upi-failed',
      }),
      sbi('2026-10-09 11:05', {
        amount: rs(1840),
        counterparty: 'BESCOM',
        refs: { upi: '527700000009' },
        balance: rs(23160),
      }),
    ];
    const overrides = [{ stableKey: 'hdfc-1234|ref:527700000002', categoryId: 'travel' }];
    const reference = build(pool, { overrides });
    fc.assert(
      fc.property(
        fc.shuffledSubarray(pool, { minLength: pool.length, maxLength: pool.length }),
        fc.subarray(pool),
        (shuffled, again) => {
          const withRescan = [...shuffled, ...again.map((s, k) => redelivered(s, k))];
          expect(build(withRescan, { overrides })).toEqual(reference);
        },
      ),
      { numRuns: 100 },
    );
    expect(reference.transactions).toHaveLength(13);
    expectCloseInvariants(reference, '2026-10-04', 7);
  });
});
