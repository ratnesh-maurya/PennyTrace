/**
 * Daily close: opening, received, spent, moved, closing — per account and per scope.
 *
 * Buckets (each balance-moving transaction lands in exactly one, so
 * `closing = opening + received − (spent − spentOnCard) + movedNet` always holds):
 * - received: kind `in` (real income).
 * - spent:    kinds `spend` + `fee` (real consumption).
 * - movedNet: kinds `xfer`, `pending_xfer`, `liability`, `cash`, `invest`, `refund`, plus
 *   a spend that a reversal credit undid. DECISION: a refund is money back, not
 *   income, and we keep "Spent" as what was actually bought, so the refund is a
 *   signed movement (+) instead of reducing Spent or inflating Received.
 * Failed and self-reversed alerts move nothing.
 *
 * Credit cards: in scope `all` (cash accounts only) a card purchase is still real
 * spending, so it counts in `spent` and `byCategory`, and in `spentOnCard`, which
 * offsets it because it did not reduce cash. Card-side bill credits and refunds are
 * ignored there (the bank-side debit already moved the cash). In a single card
 * account's own scope `spentOnCard` is 0: the card's balance (negative = dues) is
 * the closing figure, so its spends move it directly.
 *
 * Opening = previous day's closing as the bank reported it when the bank printed
 * a balance that day, else as calculated. See balances.ts for anchoring.
 * Provenance: `estimated` when the account has never reported a balance,
 * `reported` when the closing equals the bank's figure for that day, otherwise
 * `calculated`. A variance is reported, never corrected.
 *
 * Scope `all` = accounts with includeInTotal that are not credit cards; matched
 * transfers between two of them net to 0 in movedNet but still show in movedGross.
 */
import type {
  Account,
  CategoryId,
  DailyClose,
  DayKey,
  Ledger,
  Paise,
  Provenance,
  Scope,
  Transaction,
  TxnId,
} from '../types';
import { addDays, dayKey, startOfDay } from '../time';
import type { Timeline } from './balances';
import { balanceAt, cmpKey, keyBefore, movesMoney, relBefore, timelines } from './balances';
import { cmpNum, cmpStr, signed } from './util';

export type Bucket = 'received' | 'spent' | 'moved';

export function bucketOf(t: Transaction): Bucket | undefined {
  if (!movesMoney(t)) {
    return undefined;
  }
  if (t.kind === 'in') {
    return 'received';
  }
  if (t.kind === 'spend' || t.kind === 'fee') {
    return t.status === 'reversed' ? 'moved' : 'spent';
  }
  return 'moved';
}

export function scopeAccounts(ledger: Ledger, scope: Scope): Account[] {
  if (scope === 'all') {
    return ledger.accounts.filter(a => a.includeInTotal && a.type !== 'credit_card');
  }
  return ledger.accounts.filter(a => a.id === scope);
}

interface AccountDay {
  opening: Paise;
  closing: Paise;
  openingProvenance: Provenance;
  closingProvenance: Provenance;
  reported?: { closing: Paise; at: number };
}

function accountDay(tl: Timeline, day: DayKey): AccountDay {
  const start = keyBefore(startOfDay(day));
  const end = keyBefore(startOfDay(addDays(day, 1)));
  const prevStart = keyBefore(startOfDay(addDays(day, -1)));
  const { balance: opening, anchor } = balanceAt(tl, start);
  const closing = opening + relBefore(tl, end) - relBefore(tl, start);
  const none = tl.snapshots.length === 0;

  const inDay = tl.snapshots.filter(s => cmpKey(s.key, start) >= 0 && cmpKey(s.key, end) < 0);
  const last = inDay[inDay.length - 1];
  const reported = last
    ? { closing: last.snap.reported + relBefore(tl, end) - relBefore(tl, last.key), at: last.snap.at }
    : undefined;

  const openingProvenance: Provenance = none
    ? 'estimated'
    : anchor.kind === 'forward' && cmpKey(anchor.snapshot.key, prevStart) >= 0
    ? 'reported'
    : 'calculated';
  const closingProvenance: Provenance = none
    ? 'estimated'
    : reported && reported.closing === closing
    ? 'reported'
    : 'calculated';
  return { opening, closing, openingProvenance, closingProvenance, reported };
}

const PROVENANCE_RANK: Record<Provenance, number> = { reported: 0, calculated: 1, estimated: 2 };

function worst(list: Provenance[]): Provenance {
  return list.reduce<Provenance>((w, p) => (PROVENANCE_RANK[p] > PROVENANCE_RANK[w] ? p : w), 'reported');
}

export function dailyClose(ledger: Ledger, day: DayKey, scope: Scope): DailyClose {
  const accounts = scopeAccounts(ledger, scope);
  const inScope = new Set(accounts.map(a => a.id));
  const tls = timelines(ledger);

  let opening = 0;
  let closing = 0;
  const openProv: Provenance[] = [];
  const closeProv: Provenance[] = [];
  let reportedSum = 0;
  let reportedAt = 0;
  let reportedCount = 0;
  for (const a of accounts) {
    const ad = accountDay(tls.get(a.id)!, day);
    opening += ad.opening;
    closing += ad.closing;
    openProv.push(ad.openingProvenance);
    closeProv.push(ad.closingProvenance);
    if (ad.reported) {
      reportedSum += ad.reported.closing;
      reportedAt = Math.max(reportedAt, ad.reported.at);
      reportedCount++;
    }
  }

  // Scope `all` also reads card accounts' purchases (not their balances).
  const cardIds = new Set(
    scope === 'all' ? ledger.accounts.filter(a => a.includeInTotal && a.type === 'credit_card').map(a => a.id) : [],
  );
  const dayTxns = ledger.transactions.filter(
    t => (inScope.has(t.accountId) || cardIds.has(t.accountId)) && dayKey(t.occurredAt) === day,
  );
  const byId = new Map(ledger.transactions.map(t => [t.id, t]));
  let received = 0;
  let spent = 0;
  let spentOnCard = 0;
  let movedNet = 0;
  let movedGross = 0;
  const cats = new Map<CategoryId, { amount: Paise; count: number }>();
  for (const t of dayTxns) {
    const b = bucketOf(t);
    const delta = signed(t.amount, t.direction);
    const onCard = cardIds.has(t.accountId);
    if (onCard && b !== 'spent') {
      continue;
    }
    if (onCard) {
      spentOnCard -= delta;
    }
    if (b === 'received') {
      received += delta;
    } else if (b === 'spent') {
      spent -= delta;
      const c = cats.get(t.categoryId) ?? { amount: 0, count: 0 };
      c.amount -= delta;
      c.count++;
      cats.set(t.categoryId, c);
    } else if (b === 'moved') {
      movedNet += delta;
      const partner = t.linkedTxnId ? byId.get(t.linkedTxnId) : undefined;
      const counted =
        t.direction === 'credit' &&
        (t.kind === 'xfer' || t.kind === 'liability') &&
        partner &&
        inScope.has(partner.accountId) &&
        dayKey(partner.occurredAt) === day &&
        movesMoney(partner);
      if (!counted) {
        movedGross += t.amount;
      }
    }
  }

  const transfers: DailyClose['transfers'] = [];
  for (const l of ledger.transferLinks) {
    const debit = byId.get(l.debitTxnId);
    const credit = l.creditTxnId ? byId.get(l.creditTxnId) : undefined;
    const touches = (t: Transaction | undefined) => !!t && inScope.has(t.accountId) && dayKey(t.occurredAt) === day;
    if (!debit || !(touches(debit) || touches(credit))) {
      continue;
    }
    const entry: DailyClose['transfers'][number] = { amount: debit.amount, state: l.state };
    entry.fromAccountId = debit.accountId;
    if (credit) {
      entry.toAccountId = credit.accountId;
    }
    transfers.push(entry);
  }

  const result: DailyClose = {
    day,
    scope,
    opening,
    received,
    spent,
    spentOnCard,
    movedNet,
    movedGross,
    closing,
    openingProvenance: accounts.length ? worst(openProv) : 'estimated',
    closingProvenance: accounts.length ? worst(closeProv) : 'estimated',
    byCategory: [...cats.entries()]
      .map(([categoryId, v]) => ({ categoryId, amount: v.amount, count: v.count }))
      .sort((a, b) => b.amount - a.amount || cmpStr(a.categoryId, b.categoryId)),
    transfers,
    txnIds: dayTxns
      .slice()
      .sort((a, b) => cmpNum(a.occurredAt, b.occurredAt) || cmpStr(a.id, b.id))
      .map((t): TxnId => t.id),
  };
  if (accounts.length > 0 && reportedCount === accounts.length) {
    result.reported = {
      closing: reportedSum,
      at: reportedAt,
      accountsMatched: reportedCount,
      variance: reportedSum - closing,
    };
  }
  return result;
}

/** Seven closes ending on `endDay`, oldest first (the Today week strip). */
export function weekCloses(ledger: Ledger, endDay: DayKey, scope: Scope): DailyClose[] {
  const out: DailyClose[] = [];
  for (let i = 6; i >= 0; i--) {
    out.push(dailyClose(ledger, addDays(endDay, -i), scope));
  }
  return out;
}
