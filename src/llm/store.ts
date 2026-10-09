/**
 * zustand store for model state. Screens read it with `useLlmStore`.
 * Only modelManager / download wiring writes to it (via `dispatchModel`).
 */
import { create } from 'zustand';
import { DEFAULT_MODEL_ID, MODEL_CATALOG } from './catalog';
import { EMPTY_ENTRY, reduceModel, type ModelEntry, type ModelEvent } from './modelState';

export interface LlmStoreState {
  entries: Record<string, ModelEntry>;
  /** Model the tasks use. Persisting the choice is the app's job (see setActiveModel). */
  activeModelId: string;
  /** Model currently resident in memory, if any. */
  loadedModelId: string | null;
  /** Allow downloads over mobile data. Default false (Wi-Fi / unmetered only). */
  allowMetered: boolean;
}

export const useLlmStore = create<LlmStoreState>()(() => ({
  entries: Object.fromEntries(MODEL_CATALOG.map(m => [m.id, EMPTY_ENTRY])),
  activeModelId: DEFAULT_MODEL_ID,
  loadedModelId: null,
  allowMetered: false,
}));

export function dispatchModel(modelId: string, ev: ModelEvent): void {
  useLlmStore.setState(s => ({
    entries: { ...s.entries, [modelId]: reduceModel(s.entries[modelId] ?? EMPTY_ENTRY, ev) },
  }));
}

export function getEntry(modelId: string): ModelEntry {
  return useLlmStore.getState().entries[modelId] ?? EMPTY_ENTRY;
}
