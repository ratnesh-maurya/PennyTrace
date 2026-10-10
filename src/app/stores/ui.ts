import { create } from 'zustand';
import type { DayKey, InsightRange, Scope, TxnId } from '../../core/types';
import type { TxnFilter } from '../data/types';

/** Shared, ephemeral UI selections (not persisted). */
interface UiState {
  /** Day shown by the Daily close; also selected by tapping an Insights bar. `undefined` = today. */
  selectedDay?: DayKey;
  todayScope: Scope;
  activityFilter: TxnFilter;
  activityQuery: string;
  insightsRange: InsightRange;
  insightsScope: Scope;
  setSelectedDay: (day: DayKey) => void;
  setTodayScope: (scope: Scope) => void;
  setActivityFilter: (filter: TxnFilter) => void;
  setActivityQuery: (query: string) => void;
  setInsightsRange: (range: InsightRange) => void;
  setInsightsScope: (scope: Scope) => void;
}

export const useUiStore = create<UiState>()(set => ({
  selectedDay: undefined,
  todayScope: 'all',
  activityFilter: 'all',
  activityQuery: '',
  insightsRange: 'week',
  insightsScope: 'all',
  setSelectedDay: selectedDay => set({ selectedDay }),
  setTodayScope: todayScope => set({ todayScope }),
  setActivityFilter: activityFilter => set({ activityFilter }),
  setActivityQuery: activityQuery => set({ activityQuery }),
  setInsightsRange: insightsRange => set({ insightsRange }),
  setInsightsScope: insightsScope => set({ insightsScope }),
}));

/** Global quick-correction sheet target. */
interface CorrectionState {
  txnId?: TxnId;
  open: (txnId: TxnId) => void;
  close: () => void;
}

export const useCorrectionStore = create<CorrectionState>()(set => ({
  txnId: undefined,
  open: txnId => set({ txnId }),
  close: () => set({ txnId: undefined }),
}));

/** Global "set closing balance" sheet: a day, and the account if already chosen. */
interface ClosingSheetState {
  target?: { day: DayKey; accountId?: string };
  open: (day: DayKey, accountId?: string) => void;
  close: () => void;
}

export const useClosingSheetStore = create<ClosingSheetState>()(set => ({
  target: undefined,
  open: (day, accountId) => set({ target: { day, accountId } }),
  close: () => set({ target: undefined }),
}));
