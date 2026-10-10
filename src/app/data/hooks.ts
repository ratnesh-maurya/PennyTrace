/**
 * DATA BOUNDARY: read hooks. Every number comes from the core engine (`src/core/ledger`)
 * over the loaded ledger; `./views` only groups and joins for the screens.
 */
import { useMemo } from 'react';
import { useStore } from 'zustand';
import {
  accountBalance,
  cardSpendOn,
  cardStatuses,
  dailyClose,
  insights,
  position,
  reconcile,
  reviewQueue,
  type CardSpend,
  type CardStatus,
} from '../../core/ledger';
import type {
  Account,
  AccountRecon,
  DailyClose,
  DayKey,
  InsightRange,
  Insights,
  Position,
  Scope,
  Transaction,
  TxnId,
} from '../../core/types';
import { dataStore, type DataState } from './store';
import type {
  FilterCounts,
  ScanStatus,
  SourcesStatus,
  TransferPairView,
  TxnDetail,
  TxnFilter,
  TxnSection,
  WeekStripDay,
} from './types';
import {
  accountHistory,
  countTransactions,
  listTransactions,
  transactionDetail,
  transferPairs,
  weekStrip,
  type AccountHistory,
} from './views';

function useData<T>(selector: (s: DataState) => T): T {
  return useStore(dataStore, selector);
}

const useLedger = () => useData(s => s.ledger);

/** Load state of the active backend. */
export function useDataStatus(): Pick<DataState, 'status' | 'error' | 'backendKind'> {
  const status = useData(s => s.status);
  const error = useData(s => s.error);
  const backendKind = useData(s => s.backendKind);
  return useMemo(() => ({ status, error, backendKind }), [status, error, backendKind]);
}

/** Today, device-local; refreshed on every reload. */
export function useToday(): DayKey {
  return useData(s => s.today);
}

/** 7 days ending `endDay`, with spend per day in `scope` (week strip dots). */
export function useWeekStrip(scope: Scope, endDay: DayKey): WeekStripDay[] {
  const l = useLedger();
  return useMemo(() => weekStrip(l, scope, endDay), [l, scope, endDay]);
}

export function useDailyClose(day: DayKey, scope: Scope): DailyClose {
  const l = useLedger();
  return useMemo(() => dailyClose(l, day, scope), [l, day, scope]);
}

/** All accounts (banks, joint, cards, cash). */
export function useAccounts(): Account[] {
  return useLedger().accounts;
}

/** Calculated vs bank-reported balance per account. */
export function useReconciliation(): AccountRecon[] {
  const l = useLedger();
  return useMemo(() => reconcile(l), [l]);
}

export function usePosition(): Position {
  const l = useLedger();
  return useMemo(() => position(l), [l]);
}

/** Spend analytics for the week / last 4 weeks ending `endDay`. */
export function useInsights(range: InsightRange, scope: Scope, endDay: DayKey): Insights {
  const l = useLedger();
  return useMemo(() => insights(l, range, scope, endDay), [l, range, scope, endDay]);
}

/** Activity: newest first, grouped by day; `query` matches merchants, people, VPAs, refs, categories, amounts. */
export function useTransactions(filter: TxnFilter, query: string): TxnSection[] {
  const l = useLedger();
  return useMemo(() => listTransactions(l, filter, query), [l, filter, query]);
}

export function useTransactionCounts(query: string): FilterCounts {
  const l = useLedger();
  return useMemo(() => countTransactions(l, query), [l, query]);
}

export function useTransaction(id: TxnId | undefined): TxnDetail | undefined {
  const l = useLedger();
  const sources = useData(s => s.sources);
  return useMemo(() => (id ? transactionDetail(l, sources, id) : undefined), [l, sources, id]);
}

/** Transactions that need a category decision, least confident first. */
export function useReviewQueue(): Transaction[] {
  const l = useLedger();
  return useMemo(() => reviewQueue(l).sort((a, b) => a.confidence - b.confidence || b.occurredAt - a.occurredAt), [l]);
}

/** Own-account transfers: matched pairs and in-transit debits, newest first. */
export function useTransferPairs(): TransferPairView[] {
  const l = useLedger();
  return useMemo(() => transferPairs(l), [l]);
}

export function useSourcesStatus(): SourcesStatus {
  return useData(s => s.sourcesStatus);
}

export function useScanStatus(): ScanStatus {
  return useData(s => s.scan);
}

/** One account: its current balance and reconciliation status. */
export function useAccountSummary(
  accountId: string,
): { account: Account; balance: number; recon?: AccountRecon } | undefined {
  const l = useLedger();
  return useMemo(() => {
    const account = l.accounts.find(a => a.id === accountId);
    if (!account) {
      return undefined;
    }
    return { account, balance: accountBalance(l, accountId), recon: reconcile(l).find(r => r.accountId === accountId) };
  }, [l, accountId]);
}

/** One account's transactions since `sinceDay` (all when undefined). */
export function useAccountHistory(accountId: string, sinceDay: DayKey | undefined): AccountHistory {
  const l = useLedger();
  return useMemo(() => accountHistory(l, accountId, sinceDay), [l, accountId, sinceDay]);
}

/** Current balance per account (cards: negative = owed), rolled forward to now. */
export function useAccountBalances(): Record<string, number> {
  const l = useLedger();
  return useMemo(() => Object.fromEntries(l.accounts.map(a => [a.id, accountBalance(l, a.id)])), [l]);
}

/** Credit cards: limit, used, available. Separate from the cash accounts and their closing balance. */
export function useCardStatuses(): CardStatus[] {
  const l = useLedger();
  return useMemo(() => cardStatuses(l), [l]);
}

/** What was charged to each card on `day`. */
export function useCardSpend(day: DayKey): CardSpend[] {
  const l = useLedger();
  return useMemo(() => cardSpendOn(l, day), [l, day]);
}
