/**
 * DATA BOUNDARY — the only place screens get ledger data from.
 *
 * Every hook returns core view models (`src/core/types.ts`, integer paise) or
 * the wrappers in `./types.ts`. Today they read the in-memory mock (`./store`
 * + `./mockEngine`). To wire the real engine, re-implement these hooks with
 * the same signatures on top of src/db repositories / src/core/ledger; screens
 * do not change. Results must be referentially stable while inputs are
 * unchanged (screens memoise on them).
 */
import { useMemo } from 'react';
import { useStore } from 'zustand';
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
import {
  computeDailyClose,
  computeInsights,
  computePosition,
  computeReconciliation,
  computeWeekStrip,
  countTransactions,
  getTransactionDetail,
  listTransactions,
  reviewQueue,
  transferPairs,
  type LedgerSnapshot,
} from './mockEngine';
import { MOCK_TODAY } from './mock';
import { dataStore, type DataState } from './store';
import type {
  ChatMessage,
  FilterCounts,
  ModelStatus,
  ScanStatus,
  SourcesStatus,
  TransferPairView,
  TxnDetail,
  TxnFilter,
  TxnSection,
  WeekStripDay,
} from './types';

function useData<T>(selector: (s: DataState) => T): T {
  return useStore(dataStore, selector);
}

/** Ledger inputs as one stable object; recomputed only when a slice changes. */
function useLedger(): LedgerSnapshot {
  const accounts = useData(s => s.accounts);
  const txns = useData(s => s.txns);
  const archive = useData(s => s.archive);
  const sources = useData(s => s.sources);
  const snapshots = useData(s => s.snapshots);
  return useMemo(
    () => ({ accounts, txns, archive, sources, snapshots }),
    [accounts, txns, archive, sources, snapshots],
  );
}

/** The ledger's "today" (device-local). Mock: pinned to the design's Thu 9 Oct 2026. */
export function useToday(): DayKey {
  return MOCK_TODAY;
}

/** 7 days ending `endDay`, with spend per day in `scope` (week strip dots). */
export function useWeekStrip(scope: Scope, endDay: DayKey): WeekStripDay[] {
  const l = useLedger();
  return useMemo(() => computeWeekStrip(l, scope, endDay), [l, scope, endDay]);
}

export function useDailyClose(day: DayKey, scope: Scope): DailyClose {
  const l = useLedger();
  return useMemo(() => computeDailyClose(l, day, scope), [l, day, scope]);
}

/** All accounts (bank, joint, cards, cash), in display order. */
export function useAccounts(): Account[] {
  return useData(s => s.accounts);
}

/** Calculated vs bank-reported balance per account (cash wallet excluded; cards included). */
export function useReconciliation(): AccountRecon[] {
  const l = useLedger();
  return useMemo(() => computeReconciliation(l), [l]);
}

export function usePosition(): Position {
  const l = useLedger();
  return useMemo(() => computePosition(l), [l]);
}

/** Spend analytics for the week / last 4 weeks ending `endDay`. */
export function useInsights(range: InsightRange, scope: Scope, endDay: DayKey): Insights {
  const l = useLedger();
  return useMemo(() => computeInsights(l, range, scope, endDay), [l, range, scope, endDay]);
}

/** Activity: newest first, grouped by day; `query` matches merchants, people, VPAs, refs, categories, amounts. */
export function useTransactions(filter: TxnFilter, query: string): TxnSection[] {
  const l = useLedger();
  return useMemo(() => listTransactions(l, filter, query), [l, filter, query]);
}

/** Row counts per filter chip for the current query. */
export function useTransactionCounts(query: string): FilterCounts {
  const l = useLedger();
  return useMemo(() => countTransactions(l, query), [l, query]);
}

export function useTransaction(id: TxnId | undefined): TxnDetail | undefined {
  const l = useLedger();
  return useMemo(() => (id ? getTransactionDetail(l, id) : undefined), [l, id]);
}

/** Transactions that need a category decision, least confident first. */
export function useReviewQueue(): Transaction[] {
  const l = useLedger();
  return useMemo(() => reviewQueue(l), [l]);
}

/** Own-account transfers: matched pairs and in-transit debits, newest first. */
export function useTransferPairs(): TransferPairView[] {
  const l = useLedger();
  return useMemo(() => transferPairs(l), [l]);
}

export function useSourcesStatus(): SourcesStatus {
  return useData(s => s.sourcesStatus);
}

export function useModelStatus(): ModelStatus {
  return useData(s => s.model);
}

export function useScanStatus(): ScanStatus {
  return useData(s => s.scan);
}

export function useChatMessages(): ChatMessage[] {
  return useData(s => s.chat);
}
