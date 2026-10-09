/**
 * A tiny stand-in for the ledger engine, computing view models from the mock
 * rows in `./mock.ts`. Temporary: when `src/core/ledger` lands, `./hooks.ts`
 * calls the real engine / repositories instead and this file is deleted.
 */
import { CATEGORY_BY_ID } from '../../core/categories';
import type {
  Account,
  AccountId,
  AccountRecon,
  BalanceSnapshot,
  DailyClose,
  DayKey,
  InsightRange,
  Insights,
  Paise,
  Position,
  Scope,
  SourceEvent,
  Transaction,
  TxnKind,
} from '../../core/types';
import { addDays, dayKeyOf, formatDow, parseDayKey } from '../../ui/format';
import {
  MOCK_CLOSING_TODAY,
  MOCK_MONTH,
  MOCK_MONTH_BY_ACCOUNT,
  MOCK_MONTH_KEYS,
  MOCK_MONTH_LABELS,
  MOCK_MOVE_TARGET,
  MOCK_PREV_TOTAL,
  MOCK_TODAY,
  rupees,
} from './mock';
import type {
  FilterCounts,
  TransferPairView,
  TxnDetail,
  TxnFilter,
  TxnListItem,
  TxnSection,
  WeekStripDay,
} from './types';

export interface LedgerSnapshot {
  accounts: Account[];
  txns: Transaction[];
  archive: Transaction[];
  sources: Record<string, SourceEvent>;
  snapshots: BalanceSnapshot[];
}

const SPEND_KINDS: ReadonlySet<TxnKind> = new Set(['spend', 'fee']);
const MOVE_KINDS: ReadonlySet<TxnKind> = new Set(['xfer', 'pending_xfer', 'liability', 'cash']);

const signed = (t: Transaction): Paise => (t.direction === 'credit' ? t.amount : -t.amount);
const dayOf = (t: Transaction): DayKey => dayKeyOf(t.occurredAt);

function scopeAccounts(s: LedgerSnapshot, scope: Scope): Set<AccountId> {
  if (scope === 'all') {
    return new Set(s.accounts.filter(a => a.includeInTotal).map(a => a.id));
  }
  return new Set([scope]);
}

function byId(s: LedgerSnapshot) {
  const m = new Map<string, Transaction>();
  for (const t of s.txns) {
    m.set(t.id, t);
  }
  for (const t of s.archive) {
    m.set(t.id, t);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Daily close
// ---------------------------------------------------------------------------

/** Ledger balance of an account at the end of `day`, walking back from today's anchor. */
function closingFor(s: LedgerSnapshot, accountId: AccountId, day: DayKey): Paise {
  let bal = MOCK_CLOSING_TODAY[accountId] ?? 0;
  for (const t of s.txns) {
    if (t.accountId === accountId && dayOf(t) > day && dayOf(t) <= MOCK_TODAY) {
      bal -= signed(t);
    }
  }
  return bal;
}

export function computeDailyClose(s: LedgerSnapshot, day: DayKey, scope: Scope): DailyClose {
  const accts = scopeAccounts(s, scope);
  const index = byId(s);
  const dayTxns = s.txns.filter(t => accts.has(t.accountId) && dayOf(t) === day);

  let received = 0;
  let spent = 0;
  let movedNet = 0;
  let movedGross = 0;
  let refundsNet = 0;
  const cats = new Map<string, { amount: Paise; count: number }>();
  const transfers: DailyClose['transfers'] = [];

  for (const t of dayTxns) {
    if (t.kind === 'in') {
      received += t.amount;
    } else if (SPEND_KINDS.has(t.kind)) {
      spent += t.amount;
      const c = cats.get(t.categoryId) ?? { amount: 0, count: 0 };
      c.amount += t.amount;
      c.count += 1;
      cats.set(t.categoryId, c);
    } else if (t.kind === 'refund') {
      refundsNet += signed(t);
    } else if (MOVE_KINDS.has(t.kind)) {
      movedNet += signed(t);
      const linked = t.linkedTxnId ? index.get(t.linkedTxnId) : undefined;
      if (t.direction === 'credit') {
        if (linked && accts.has(linked.accountId)) {
          continue; // internal pair: counted once, on the debit leg
        }
        movedGross += t.amount;
        transfers.push({ fromAccountId: linked?.accountId, toAccountId: t.accountId, amount: t.amount, state: 'matched' });
      } else {
        movedGross += t.amount;
        transfers.push({
          fromAccountId: t.accountId,
          toAccountId: linked?.accountId ?? MOCK_MOVE_TARGET[t.id],
          amount: t.amount,
          state: t.kind === 'pending_xfer' ? 'in_transit' : 'matched',
        });
      }
    }
  }

  let closing = 0;
  for (const id of accts) {
    closing += closingFor(s, id, day);
  }
  const opening = closing - received + spent - movedNet - refundsNet;

  // Bank-reported balances: today from the latest balance SMS; earlier days matched at day end.
  let reported: DailyClose['reported'];
  const reportable = [...accts].filter(id => s.snapshots.some(sn => sn.accountId === id));
  if (accts.size > 0 && reportable.length === accts.size && day <= MOCK_TODAY) {
    const snaps = s.snapshots.filter(sn => accts.has(sn.accountId));
    const at =
      day === MOCK_TODAY
        ? Math.max(...snaps.map(sn => sn.at))
        : parseDayKey(day).getTime() + 86400000 - 60000;
    const variance = day === MOCK_TODAY ? snaps.reduce((a, sn) => a + sn.reported, 0) - closing : 0;
    reported = { closing: closing + variance, at, accountsMatched: accts.size, variance };
  }

  return {
    day,
    scope,
    opening,
    received,
    spent,
    movedNet,
    movedGross,
    closing,
    openingProvenance: 'calculated',
    closingProvenance: reported ? 'reported' : 'calculated',
    reported,
    byCategory: [...cats.entries()]
      .map(([categoryId, v]) => ({ categoryId, amount: v.amount, count: v.count }))
      .sort((a, b) => b.amount - a.amount),
    transfers,
    txnIds: dayTxns.map(t => t.id),
  };
}

export function computeWeekStrip(s: LedgerSnapshot, scope: Scope, endDay: DayKey): WeekStripDay[] {
  const accts = scopeAccounts(s, scope);
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(endDay, i - 6);
    const spent = s.txns
      .filter(t => accts.has(t.accountId) && SPEND_KINDS.has(t.kind) && dayOf(t) === day)
      .reduce((a, t) => a + t.amount, 0);
    return { day, spent };
  });
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

function analysable(s: LedgerSnapshot): Account[] {
  return s.accounts.filter(a => a.type !== 'credit_card' && a.type !== 'cash');
}

export function computeInsights(s: LedgerSnapshot, range: InsightRange, scope: Scope, endDay: DayKey): Insights {
  const prevTotal = MOCK_PREV_TOTAL[range][scope] ?? 0;
  if (range === 'month') {
    const m = MOCK_MONTH[scope] ?? MOCK_MONTH.all;
    const bars = m.bars.map((v, i) => ({ key: MOCK_MONTH_KEYS[i], label: MOCK_MONTH_LABELS[i], spent: rupees(v) }));
    const total = bars.reduce((a, b) => a + b.spent, 0);
    const catTotal = m.cats.reduce((a, c) => a + c[1], 0) || 1;
    const moneyIn = rupees(m.income);
    return {
      range,
      scope,
      bars,
      total,
      avgPerUnit: Math.round(total / bars.length),
      prevTotal,
      moneyIn,
      keptPct: moneyIn ? Math.max(0, ((moneyIn - total) / moneyIn) * 100) : undefined,
      byAccount: analysable(s).map(a => ({ accountId: a.id, spent: rupees(MOCK_MONTH_BY_ACCOUNT[a.id] ?? 0) })),
      categories: m.cats.map(([categoryId, v]) => ({ categoryId, amount: rupees(v), pct: (v / catTotal) * 100 })),
      topMerchants: m.merchants.map(([name, v, count]) => ({ name, amount: rupees(v), count })),
    };
  }

  const accts = scopeAccounts(s, scope);
  const from = addDays(endDay, -6);
  const inRange = (t: Transaction) => dayOf(t) >= from && dayOf(t) <= endDay;
  const rows = s.txns.filter(t => accts.has(t.accountId) && inRange(t));
  const spends = rows.filter(t => SPEND_KINDS.has(t.kind));

  const bars = Array.from({ length: 7 }, (_, i) => {
    const key = addDays(endDay, i - 6);
    return { key, label: formatDow(key), spent: spends.filter(t => dayOf(t) === key).reduce((a, t) => a + t.amount, 0) };
  });
  const total = bars.reduce((a, b) => a + b.spent, 0);
  const moneyIn = rows.filter(t => t.kind === 'in').reduce((a, t) => a + t.amount, 0);

  const cats = new Map<string, Paise>();
  const merchants = new Map<string, { name: string; amount: Paise; count: number }>();
  for (const t of spends) {
    cats.set(t.categoryId, (cats.get(t.categoryId) ?? 0) + t.amount);
    const name = t.counterparty ?? 'Unknown';
    const key = name.toLowerCase();
    const m = merchants.get(key) ?? { name, amount: 0, count: 0 };
    m.amount += t.amount;
    m.count += 1;
    merchants.set(key, m);
  }
  const catTotal = total || 1;

  return {
    range,
    scope,
    bars,
    total,
    avgPerUnit: Math.round(total / 7),
    prevTotal,
    moneyIn,
    keptPct: moneyIn ? Math.max(0, ((moneyIn - total) / moneyIn) * 100) : undefined,
    byAccount: analysable(s).map(a => ({
      accountId: a.id,
      spent: s.txns
        .filter(t => t.accountId === a.id && SPEND_KINDS.has(t.kind) && inRange(t))
        .reduce((x, t) => x + t.amount, 0),
    })),
    categories: [...cats.entries()]
      .map(([categoryId, amount]) => ({ categoryId, amount, pct: (amount / catTotal) * 100 }))
      .sort((a, b) => b.amount - a.amount),
    topMerchants: [...merchants.values()].sort((a, b) => b.amount - a.amount).slice(0, 3),
  };
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export function computeReconciliation(s: LedgerSnapshot): AccountRecon[] {
  return s.accounts
    .filter(a => a.type !== 'cash')
    .map(a => {
      const calculated = MOCK_CLOSING_TODAY[a.id] ?? 0;
      const snap = s.snapshots
        .filter(sn => sn.accountId === a.id)
        .sort((x, y) => y.at - x.at)[0];
      if (!snap) {
        return { accountId: a.id, calculated, status: 'unknown' as const };
      }
      const variance = snap.reported - calculated;
      return {
        accountId: a.id,
        calculated,
        reported: snap.reported,
        reportedAt: snap.at,
        variance,
        status: variance === 0 ? ('reconciled' as const) : ('off' as const),
      };
    });
}

export function computePosition(s: LedgerSnapshot): Position {
  const recon = computeReconciliation(s);
  let cash = 0;
  let cardDues = 0;
  for (const r of recon) {
    const acct = s.accounts.find(a => a.id === r.accountId);
    if (acct?.type === 'credit_card') {
      cardDues += -r.calculated;
    } else {
      cash += r.reported ?? r.calculated;
    }
  }
  return { cash, cardDues, net: cash - cardDues };
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

const FILTERS: Record<TxnFilter, (t: Transaction) => boolean> = {
  all: () => true,
  spent: t => SPEND_KINDS.has(t.kind),
  in: t => t.kind === 'in' || t.kind === 'refund',
  xfer: t => MOVE_KINDS.has(t.kind),
  review: t => t.needsReview,
};

function toItem(s: LedgerSnapshot, index: Map<string, Transaction>, t: Transaction): TxnListItem {
  const accounts = new Map(s.accounts.map(a => [a.id, a]));
  const linked = t.linkedTxnId ? index.get(t.linkedTxnId) : undefined;
  const counterId = linked && t.kind === 'xfer' ? linked.accountId : MOCK_MOVE_TARGET[t.id];
  return {
    txn: t,
    account: accounts.get(t.accountId)!,
    counterAccount: counterId ? accounts.get(counterId) : undefined,
    linked: linked ? { id: linked.id, occurredAt: linked.occurredAt, accountId: linked.accountId } : undefined,
  };
}

/** Rows shown in Activity: matched transfer credit legs fold into their debit leg. */
function visibleRows(s: LedgerSnapshot): Transaction[] {
  const index = byId(s);
  return s.txns.filter(t => {
    if (t.kind === 'xfer' && t.direction === 'credit' && t.linkedTxnId) {
      return !index.has(t.linkedTxnId);
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

export function listTransactions(s: LedgerSnapshot, filter: TxnFilter, query: string): TxnSection[] {
  const index = byId(s);
  const accounts = new Map(s.accounts.map(a => [a.id, a]));
  const counted = (t: Transaction) => {
    const a = accounts.get(t.accountId);
    return !!a && (a.includeInTotal || a.type === 'credit_card');
  };
  const daySpent = new Map<DayKey, Paise>();
  for (const t of s.txns) {
    if (SPEND_KINDS.has(t.kind) && counted(t)) {
      daySpent.set(dayOf(t), (daySpent.get(dayOf(t)) ?? 0) + t.amount);
    }
  }
  const rows = visibleRows(s)
    .filter(t => FILTERS[filter](t) && matchesQuery(t, query.trim()))
    .sort((a, b) => b.occurredAt - a.occurredAt);
  const sections: TxnSection[] = [];
  for (const t of rows) {
    const day = dayOf(t);
    let sec = sections[sections.length - 1];
    if (!sec || sec.day !== day) {
      sec = { day, spent: daySpent.get(day) ?? 0, data: [] };
      sections.push(sec);
    }
    sec.data.push(toItem(s, index, t));
  }
  return sections;
}

export function countTransactions(s: LedgerSnapshot, query: string): FilterCounts {
  const rows = visibleRows(s).filter(t => matchesQuery(t, query.trim()));
  const counts = {} as FilterCounts;
  (Object.keys(FILTERS) as TxnFilter[]).forEach(f => {
    counts[f] = rows.filter(FILTERS[f]).length;
  });
  return counts;
}

export function getTransactionDetail(s: LedgerSnapshot, id: string): TxnDetail | undefined {
  const index = byId(s);
  const t = index.get(id);
  if (!t) {
    return undefined;
  }
  const item = toItem(s, index, t);
  const ids = [...t.sourceIds];
  if (t.kind === 'xfer' && t.linkedTxnId) {
    ids.push(...(index.get(t.linkedTxnId)?.sourceIds ?? []));
  }
  const sources = ids
    .map(sid => s.sources[sid])
    .filter((x): x is SourceEvent => !!x)
    .sort((a, b) => a.receivedAt - b.receivedAt);
  return { ...item, sources };
}

export function reviewQueue(s: LedgerSnapshot): Transaction[] {
  return s.txns.filter(t => t.needsReview).sort((a, b) => a.confidence - b.confidence || b.occurredAt - a.occurredAt);
}

export function transferPairs(s: LedgerSnapshot): TransferPairView[] {
  const index = byId(s);
  const pairs: TransferPairView[] = [];
  for (const t of s.txns) {
    if (t.direction !== 'debit') {
      continue;
    }
    const ref = t.refs.utr ? `UTR ${t.refs.utr}` : t.refs.upi ? `UPI ${t.refs.upi}` : t.refs.other;
    if (t.kind === 'xfer') {
      const credit = t.linkedTxnId ? index.get(t.linkedTxnId) : undefined;
      pairs.push({
        id: t.id,
        fromAccountId: t.accountId,
        toAccountId: credit?.accountId,
        amount: t.amount,
        state: 'matched',
        method: credit ? (t.refs.utr || t.refs.upi ? 'ref' : 'amount_time') : 'user',
        ref,
        debitAt: t.occurredAt,
        creditAt: credit?.occurredAt,
      });
    } else if (t.kind === 'pending_xfer') {
      pairs.push({
        id: t.id,
        fromAccountId: t.accountId,
        toAccountId: MOCK_MOVE_TARGET[t.id],
        amount: t.amount,
        state: 'in_transit',
        method: 'alias',
        ref,
        debitAt: t.occurredAt,
      });
    }
  }
  return pairs.sort((a, b) => b.debitAt - a.debitAt);
}
