/**
 * Pure view shaping: core `Ledger` (+ evidence) → the UI shapes in `./types`.
 * Accounting (daily close, insights, reconciliation) lives in `src/core/ledger`;
 * this file only groups, filters and joins for the screens.
 */
import { CATEGORY_BY_ID } from '../../core/categories';
import { weekCloses } from '../../core/ledger';
import { dayKey } from '../../core/time';
import type {
  Account,
  AccountId,
  DayKey,
  Ledger,
  Paise,
  Scope,
  SourceEvent,
  Transaction,
  TxnId,
  TxnKind,
} from '../../core/types';
import type {
  FilterCounts,
  TransferPairView,
  TxnDetail,
  TxnFilter,
  TxnListItem,
  TxnSection,
  WeekStripDay,
} from './types';

const SPEND_KINDS: ReadonlySet<TxnKind> = new Set(['spend', 'fee']);
const MOVE_KINDS: ReadonlySet<TxnKind> = new Set(['xfer', 'pending_xfer', 'liability', 'cash', 'invest']);

const FILTERS: Record<TxnFilter, (t: Transaction) => boolean> = {
  all: () => true,
  spent: t => SPEND_KINDS.has(t.kind),
  in: t => t.kind === 'in' || t.kind === 'refund',
  xfer: t => MOVE_KINDS.has(t.kind),
  review: t => t.needsReview,
};

interface Index {
  txns: Map<TxnId, Transaction>;
  accounts: Map<AccountId, Account>;
  /** Transfer destination per debit (matched credit's account), when known. */
  transferTo: Map<TxnId, AccountId>;
}

const indexCache = new WeakMap<Ledger, Index>();

function indexOf(ledger: Ledger): Index {
  let idx = indexCache.get(ledger);
  if (!idx) {
    const txns = new Map(ledger.transactions.map(t => [t.id, t]));
    const transferTo = new Map<TxnId, AccountId>();
    for (const l of ledger.transferLinks) {
      const credit = l.creditTxnId ? txns.get(l.creditTxnId) : undefined;
      if (credit) {
        transferTo.set(l.debitTxnId, credit.accountId);
      }
    }
    idx = { txns, accounts: new Map(ledger.accounts.map(a => [a.id, a])), transferTo };
    indexCache.set(ledger, idx);
  }
  return idx;
}

function toItem(idx: Index, t: Transaction): TxnListItem | undefined {
  const account = idx.accounts.get(t.accountId);
  if (!account) {
    return undefined;
  }
  const linked = t.linkedTxnId ? idx.txns.get(t.linkedTxnId) : undefined;
  const counterId = t.kind === 'xfer' && linked ? linked.accountId : idx.transferTo.get(t.id);
  return {
    txn: t,
    account,
    counterAccount: counterId ? idx.accounts.get(counterId) : undefined,
    linked: linked ? { id: linked.id, occurredAt: linked.occurredAt, accountId: linked.accountId } : undefined,
  };
}

/** Activity rows: a matched transfer shows once, on its debit leg. */
function visibleRows(ledger: Ledger, idx: Index): Transaction[] {
  return ledger.transactions.filter(t => {
    if (t.kind === 'xfer' && t.direction === 'credit' && t.linkedTxnId) {
      return !idx.txns.has(t.linkedTxnId);
    }
    return true;
  });
}

function matchesQuery(t: Transaction, q: string): boolean {
  if (!q) {
    return true;
  }
  const hay = [
    t.counterparty,
    t.vpa,
    t.refs.upi,
    t.refs.utr,
    t.refs.other,
    CATEGORY_BY_ID[t.categoryId]?.name,
    String(Math.round(t.amount / 100)),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every(w => hay.includes(w));
}

/** Newest first, grouped by day; `spent` per day covers accounts in the total plus cards. */
export function listTransactions(ledger: Ledger, filter: TxnFilter, query: string): TxnSection[] {
  const idx = indexOf(ledger);
  const counted = (t: Transaction) => {
    const a = idx.accounts.get(t.accountId);
    return !!a && (a.includeInTotal || a.type === 'credit_card') && t.status !== 'failed';
  };
  const daySpent = new Map<DayKey, Paise>();
  for (const t of ledger.transactions) {
    if (SPEND_KINDS.has(t.kind) && counted(t)) {
      const d = dayKey(t.occurredAt);
      daySpent.set(d, (daySpent.get(d) ?? 0) + t.amount);
    }
  }
  const q = query.trim();
  const rows = visibleRows(ledger, idx)
    .filter(t => FILTERS[filter](t) && matchesQuery(t, q))
    .sort((a, b) => b.occurredAt - a.occurredAt || (a.id < b.id ? -1 : 1));
  const sections: TxnSection[] = [];
  for (const t of rows) {
    const item = toItem(idx, t);
    if (!item) {
      continue;
    }
    const day = dayKey(t.occurredAt);
    let sec = sections[sections.length - 1];
    if (!sec || sec.day !== day) {
      sec = { day, spent: daySpent.get(day) ?? 0, data: [] };
      sections.push(sec);
    }
    sec.data.push(item);
  }
  return sections;
}

export function countTransactions(ledger: Ledger, query: string): FilterCounts {
  const idx = indexOf(ledger);
  const q = query.trim();
  const rows = visibleRows(ledger, idx).filter(t => matchesQuery(t, q));
  const counts = {} as FilterCounts;
  (Object.keys(FILTERS) as TxnFilter[]).forEach(f => {
    counts[f] = rows.filter(FILTERS[f]).length;
  });
  return counts;
}

/** A row plus all its evidence (both legs for a matched transfer), oldest first. */
export function transactionDetail(
  ledger: Ledger,
  sources: ReadonlyMap<string, SourceEvent>,
  id: TxnId,
): TxnDetail | undefined {
  const idx = indexOf(ledger);
  const t = idx.txns.get(id);
  const item = t ? toItem(idx, t) : undefined;
  if (!t || !item) {
    return undefined;
  }
  const ids = [...t.sourceIds];
  if (t.kind === 'xfer' && t.linkedTxnId) {
    ids.push(...(idx.txns.get(t.linkedTxnId)?.sourceIds ?? []));
  }
  const evidence = [...new Set(ids)]
    .map(sid => sources.get(sid))
    .filter((x): x is SourceEvent => !!x)
    .sort((a, b) => a.receivedAt - b.receivedAt);
  return { ...item, sources: evidence };
}

/** Own-account transfers (matched and in transit), newest first. */
export function transferPairs(ledger: Ledger): TransferPairView[] {
  const idx = indexOf(ledger);
  const pairs: TransferPairView[] = [];
  for (const l of ledger.transferLinks) {
    const debit = idx.txns.get(l.debitTxnId);
    if (!debit) {
      continue;
    }
    const credit = l.creditTxnId ? idx.txns.get(l.creditTxnId) : undefined;
    // Card bills are liabilities, shown on the card, not as own-account transfers.
    if (debit.kind === 'liability' || credit?.kind === 'liability') {
      continue;
    }
    const ref = debit.refs.utr ? `UTR ${debit.refs.utr}` : debit.refs.upi ? `UPI ${debit.refs.upi}` : debit.refs.other;
    pairs.push({
      id: debit.id,
      fromAccountId: debit.accountId,
      toAccountId: credit?.accountId,
      amount: debit.amount,
      state: l.state,
      method: l.method,
      ref: l.method === 'ref' ? ref : undefined,
      debitAt: debit.occurredAt,
      creditAt: credit?.occurredAt,
    });
  }
  return pairs.sort((a, b) => b.debitAt - a.debitAt);
}

/** The week strip: 7 days ending `endDay`, with what was spent in `scope` each day. */
export function weekStrip(ledger: Ledger, scope: Scope, endDay: DayKey): WeekStripDay[] {
  return weekCloses(ledger, endDay, scope).map(c => ({ day: c.day, spent: c.spent }));
}

export interface AccountHistory {
  /** Newest first, grouped by day, from `sinceDay` (inclusive) or all. */
  sections: TxnSection[];
  /** Transactions shown vs the account's total. */
  shown: number;
  total: number;
}

/** One account's own rows (both legs of its transfers), for its detail screen. */
export function accountHistory(ledger: Ledger, accountId: AccountId, sinceDay?: DayKey): AccountHistory {
  const idx = indexOf(ledger);
  const all = ledger.transactions
    .filter(t => t.accountId === accountId)
    .sort((a, b) => b.occurredAt - a.occurredAt || (a.id < b.id ? -1 : 1));
  const rows = sinceDay ? all.filter(t => dayKey(t.occurredAt) >= sinceDay) : all;
  const sections: TxnSection[] = [];
  for (const t of rows) {
    const item = toItem(idx, t);
    if (!item) {
      continue;
    }
    const day = dayKey(t.occurredAt);
    let sec = sections[sections.length - 1];
    if (!sec || sec.day !== day) {
      sec = { day, spent: 0, data: [] };
      sections.push(sec);
    }
    if (SPEND_KINDS.has(t.kind) && t.status !== 'failed') {
      sec.spent += t.amount;
    }
    sec.data.push(item);
  }
  return { sections, shown: rows.length, total: all.length };
}
