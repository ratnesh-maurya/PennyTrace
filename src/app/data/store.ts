/**
 * App data state: the derived ledger (+ evidence) loaded from the active backend, plus
 * UI-side status (scan). Screens read it through `./hooks`, write through `./actions`.
 */
import { TurboModuleRegistry } from 'react-native';
import { createStore } from 'zustand/vanilla';
import { setCustomCategories } from '../../core/categories';
import { today as todayKey } from '../../core/time';
import type { DayKey, Ledger, SourceEvent } from '../../core/types';
import type { DataBackend } from './backend';
import { createDemoBackend } from './demoBackend';
import type { ScanStatus, SourcesStatus } from './types';

export interface DataState {
  backendKind: DataBackend['kind'] | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
  ledger: Ledger;
  sources: ReadonlyMap<string, SourceEvent>;
  today: DayKey;
  sourcesStatus: SourcesStatus;
  scan: ScanStatus;
}

const EMPTY_LEDGER: Ledger = { accounts: [], transactions: [], transferLinks: [], snapshots: [] };

export function initialDataState(): DataState {
  return {
    backendKind: null,
    status: 'idle',
    ledger: EMPTY_LEDGER,
    sources: new Map(),
    today: todayKey(Date.now()),
    sourcesStatus: {
      sms: { enabled: true, permission: 'unknown', messagesRead: 0, banksRecognised: 0 },
      discardRaw: false,
    },
    scan: { state: 'idle', depthMonths: 6, scanned: 0, total: 0 },
  };
}

export const dataStore = createStore<DataState>()(() => initialDataState());

let backend: DataBackend | null = null;
let unsubscribe: (() => void) | null = null;

export function getBackend(): DataBackend {
  if (!backend) {
    throw new Error('Data backend not started: call startData() first');
  }
  return backend;
}

/** Live when the PennySms native module exists (a device build); demo otherwise. */
function defaultBackend(): DataBackend {
  if (TurboModuleRegistry.get('PennySms')) {
    // Required lazily: it pulls in op-sqlite and the SMS TurboModule.
    const { createLiveBackend } = require('./liveBackend') as typeof import('./liveBackend');
    return createLiveBackend();
  }
  return createDemoBackend();
}

/** Re-read the ledger from the backend. */
export async function reloadData(): Promise<void> {
  const b = getBackend();
  try {
    const data = await b.load();
    // Before the screens re-render, so every category id resolves.
    setCustomCategories(data.customCategories);
    dataStore.setState(s => ({
      status: 'ready',
      error: undefined,
      ledger: data.ledger,
      sources: data.sources,
      today: todayKey(Date.now()),
      sourcesStatus: {
        sms: { ...s.sourcesStatus.sms, ...data.sms },
        discardRaw: data.discardRaw,
      },
    }));
  } catch (e) {
    dataStore.setState({ status: 'error', error: e instanceof Error ? e.message : String(e) });
  }
}

/** Start (or switch) the data source. Safe to call again, e.g. to enter demo mode. */
export async function startData(next: DataBackend = defaultBackend()): Promise<void> {
  unsubscribe?.();
  backend = next;
  dataStore.setState({ ...initialDataState(), backendKind: next.kind, status: 'loading' });
  unsubscribe = next.subscribe(() => {
    reloadData();
  });
  await reloadData();
}

/** Test helper. */
export function resetDataStore(): void {
  unsubscribe?.();
  unsubscribe = null;
  backend = null;
  dataStore.setState(initialDataState(), true);
}
