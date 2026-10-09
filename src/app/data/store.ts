/**
 * Mutable in-memory store backing the mock data layer. Corrections and
 * transfer marks mutate it so every screen updates. Replaced by reactive
 * repository queries when src/db lands.
 */
import { createStore } from 'zustand/vanilla';
import type { LedgerSnapshot } from './mockEngine';
import {
  MOCK_ACCOUNTS,
  MOCK_ARCHIVE,
  MOCK_SNAPSHOTS,
  MOCK_SOURCES,
  MOCK_SOURCES_STATUS,
  MOCK_TXNS,
  at,
  MOCK_TODAY,
} from './mock';
import type { ChatMessage, ModelStatus, ScanStatus, SourcesStatus } from './types';

export interface DataState extends LedgerSnapshot {
  sourcesStatus: SourcesStatus;
  model: ModelStatus;
  scan: ScanStatus;
  chat: ChatMessage[];
}

export function initialDataState(): DataState {
  return {
    accounts: MOCK_ACCOUNTS,
    txns: MOCK_TXNS,
    archive: MOCK_ARCHIVE,
    sources: Object.fromEntries(MOCK_SOURCES.map(s => [s.id, s])),
    snapshots: MOCK_SNAPSHOTS,
    sourcesStatus: {
      sms: {
        enabled: true,
        permission: 'granted',
        messagesRead: MOCK_SOURCES_STATUS.messagesRead,
        banksRecognised: MOCK_SOURCES_STATUS.banksRecognised,
        lastScanAt: at(MOCK_TODAY, '19:41'),
      },
      discardRaw: false,
    },
    model: {
      state: 'absent',
      name: 'Qwen3-0.6B · Q4_K_M',
      sizeBytes: 462_000_000,
      license: 'Apache-2.0',
      progress: 0,
      wifiOnly: true,
    },
    scan: { state: 'done', depthMonths: 6, scanned: 1284, total: 1284 },
    chat: [],
  };
}

export const dataStore = createStore<DataState>()(() => initialDataState());

/** Test helper: restore the pristine mock. */
export function resetDataStore(): void {
  dataStore.setState(initialDataState(), true);
}
