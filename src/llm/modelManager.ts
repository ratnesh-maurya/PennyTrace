/**
 * Model manager: install state, lazy llama.rn context, single-flight completions.
 *
 * - Nothing loads until a task needs it (lazy `ensureLoaded`).
 * - Unloads when the app goes to the background, on a memory warning, and
 *   after IDLE_UNLOAD_MS without work.
 * - Exactly one completion runs at a time (SerialQueue).
 * - CPU only by default (n_gpu_layers 0), no mlock, n_ctx 2048.
 */
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import { initLlama, type CompletionParams, type LlamaContext, type NativeCompletionResult } from 'llama.rn';
import { MODEL_CATALOG, getModelSpec, type ModelSpec } from './catalog';
import {
  cancelModelDownload,
  isModelFileInstalled,
  modelFilePath,
  pauseModelDownload,
  reattachModelDownloads,
  removeModelFiles,
  resumeModelDownload,
  startModelDownload,
  verifyInstalledModel,
  type DownloadListener,
} from './download';
import { isUsable } from './modelState';
import { QueueClearedError, SerialQueue } from './queue';
import { dispatchModel, getEntry, useLlmStore } from './store';

export const LLM_CONTEXT_PARAMS = {
  n_ctx: 2048,
  n_batch: 512,
  // One sequence: llama.rn defaults to 8 parallel slots, which would split the KV cache.
  n_parallel: 1,
  // n_threads omitted on purpose: on Android llama.rn picks the fastest cores
  // (min(4, cores), or 2 on 4-core devices) when n_threads <= 0.
  use_mlock: false,
  use_mmap: true,
  n_gpu_layers: 0,
} as const;

/** Unload after this long without a completion. */
export const IDLE_UNLOAD_MS = 2 * 60 * 1000;
/** Abort a single completion that runs longer than this. */
export const COMPLETION_TIMEOUT_MS = 45 * 1000;

export class LlmUnavailableError extends Error {
  constructor(message = 'No on-device model installed') {
    super(message);
    this.name = 'LlmUnavailableError';
  }
}

const listener: DownloadListener = (modelId, ev) => dispatchModel(modelId, ev);
const queue = new SerialQueue();

let ctx: LlamaContext | null = null;
let ctxModelId: string | null = null;
let loading: Promise<LlamaContext> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let appStateSub: NativeEventSubscription | null = null;
let memorySub: NativeEventSubscription | null = null;
let initialized: Promise<void> | null = null;

function requireSpec(modelId: string): ModelSpec {
  const spec = getModelSpec(modelId);
  if (!spec) {
    throw new Error(`Unknown model: ${modelId}`);
  }
  return spec;
}

function clearIdle(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function armIdle(): void {
  clearIdle();
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (!queue.busy && queue.pending === 0) {
      unloadModel().catch(() => undefined);
    }
  }, IDLE_UNLOAD_MS);
}

function onAppState(state: AppStateStatus): void {
  if (state === 'background') {
    unloadModel().catch(() => undefined);
  }
}

/**
 * Scan installed files, re-bind running downloads, subscribe to AppState.
 * Safe to call more than once. Does not load a model or start a download.
 */
export function initModelManager(): Promise<void> {
  if (!initialized) {
    initialized = (async () => {
      await refreshInstalled();
      await reattachModelDownloads(listener);
      appStateSub = AppState.addEventListener('change', onAppState);
      memorySub = AppState.addEventListener('memoryWarning', () => {
        unloadModel().catch(() => undefined);
      });
    })().catch(e => {
      initialized = null;
      throw e;
    });
  }
  return initialized;
}

/** Tear down listeners and free the model (tests / hot reload). */
export async function disposeModelManager(): Promise<void> {
  appStateSub?.remove();
  memorySub?.remove();
  appStateSub = null;
  memorySub = null;
  initialized = null;
  await unloadModel();
}

/** Re-check which catalog models are on disk. */
export async function refreshInstalled(): Promise<void> {
  for (const spec of MODEL_CATALOG) {
    dispatchModel(spec.id, { type: 'scanned', installed: await isModelFileInstalled(spec) });
  }
  const s = useLlmStore.getState();
  if (!s.entries[s.activeModelId]?.installed) {
    const firstInstalled = MODEL_CATALOG.find(m => s.entries[m.id]?.installed);
    if (firstInstalled) {
      useLlmStore.setState({ activeModelId: firstInstalled.id });
    }
  }
}

export async function installedModels(): Promise<ModelSpec[]> {
  const out: ModelSpec[] = [];
  for (const spec of MODEL_CATALOG) {
    if (await isModelFileInstalled(spec)) {
      out.push(spec);
    }
  }
  return out;
}

/** True when the active model is installed and usable. Synchronous, cheap. */
export function isAvailable(): boolean {
  const s = useLlmStore.getState();
  return isUsable(s.entries[s.activeModelId]);
}

export function setActiveModel(modelId: string): void {
  requireSpec(modelId);
  if (ctxModelId && ctxModelId !== modelId) {
    unloadModel().catch(() => undefined);
  }
  useLlmStore.setState({ activeModelId: modelId });
}

export function setAllowMetered(allow: boolean): void {
  useLlmStore.setState({ allowMetered: allow });
}

// ---------------------------------------------------------------------------
// Downloads (explicit user actions only)
// ---------------------------------------------------------------------------

export function downloadModel(modelId: string, opts: { allowMetered?: boolean } = {}): Promise<void> {
  const allowMetered = opts.allowMetered ?? useLlmStore.getState().allowMetered;
  return startModelDownload(requireSpec(modelId), listener, { allowMetered });
}

export function pauseDownload(modelId: string): Promise<void> {
  return pauseModelDownload(requireSpec(modelId), listener);
}

export function resumeDownload(modelId: string): Promise<void> {
  return resumeModelDownload(requireSpec(modelId), listener);
}

export function cancelDownload(modelId: string): Promise<void> {
  return cancelModelDownload(requireSpec(modelId), listener);
}

export async function deleteModel(modelId: string): Promise<void> {
  const spec = requireSpec(modelId);
  if (ctxModelId === modelId) {
    await unloadModel();
  }
  await cancelModelDownload(spec, listener);
  await removeModelFiles(spec);
  dispatchModel(modelId, { type: 'removed' });
}

/** Re-hash an installed file; deletes it if it no longer matches. */
export async function verifyModel(modelId: string): Promise<boolean> {
  const spec = requireSpec(modelId);
  const ok = await verifyInstalledModel(spec);
  if (!ok) {
    await removeModelFiles(spec);
    dispatchModel(modelId, { type: 'download_failed', error: 'Installed model failed its checksum and was removed' });
  }
  return ok;
}

// ---------------------------------------------------------------------------
// Load / unload
// ---------------------------------------------------------------------------

/** Load the active (or given) model if needed. Resolves with the live context. */
export async function loadModel(modelId?: string): Promise<LlamaContext> {
  const id = modelId ?? useLlmStore.getState().activeModelId;
  if (ctx && ctxModelId === id) {
    return ctx;
  }
  if (loading) {
    const c = await loading;
    if (ctxModelId === id) {
      return c;
    }
  }
  const spec = requireSpec(id);
  if (!getEntry(id).installed) {
    throw new LlmUnavailableError();
  }
  if (ctx) {
    // May run inside a queued job: release directly, never wait on the queue.
    await releaseContext();
  }
  dispatchModel(id, { type: 'load_start' });
  loading = (async () => {
    try {
      const c = await initLlama({ model: modelFilePath(spec), ...LLM_CONTEXT_PARAMS }, progress =>
        dispatchModel(id, { type: 'load_progress', progress }),
      );
      ctx = c;
      ctxModelId = id;
      useLlmStore.setState({ loadedModelId: id });
      dispatchModel(id, { type: 'loaded' });
      return c;
    } catch (e) {
      dispatchModel(id, { type: 'load_failed', error: e instanceof Error ? e.message : String(e) });
      throw e;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** Stop any running completion, drop queued work, and free the context. */
export async function unloadModel(): Promise<void> {
  clearIdle();
  queue.clear('Model unloaded');
  if (loading) {
    await loading.catch(() => undefined);
  }
  if (ctx && queue.busy) {
    await ctx.stopCompletion().catch(() => undefined);
    await queue.settled();
  }
  await releaseContext();
}

async function releaseContext(): Promise<void> {
  const c = ctx;
  const id = ctxModelId;
  if (!c) {
    return;
  }
  ctx = null;
  ctxModelId = null;
  useLlmStore.setState({ loadedModelId: null });
  try {
    await c.release();
  } finally {
    if (id) {
      dispatchModel(id, { type: 'unloaded' });
    }
  }
}

// ---------------------------------------------------------------------------
// Completions (single flight)
// ---------------------------------------------------------------------------

/** Defaults every task uses: greedy, no thinking. */
export const BASE_COMPLETION: Partial<CompletionParams> = {
  temperature: 0,
  top_k: 1,
  seed: 0,
  enable_thinking: false,
  reasoning_format: 'none',
};

/**
 * Queue one completion on the loaded model (loading it lazily).
 * Throws LlmUnavailableError when no usable model is installed.
 */
export function complete(params: CompletionParams): Promise<NativeCompletionResult> {
  if (!isAvailable()) {
    return Promise.reject(new LlmUnavailableError());
  }
  clearIdle();
  return queue
    .enqueue(async () => {
      const c = await loadModel();
      const timer = setTimeout(() => {
        c.stopCompletion().catch(() => undefined);
      }, COMPLETION_TIMEOUT_MS);
      try {
        return await c.completion({ ...BASE_COMPLETION, ...params });
      } finally {
        clearTimeout(timer);
      }
    })
    .finally(() => {
      // The idle callback re-checks that the queue is empty before unloading.
      if (ctx) {
        armIdle();
      }
    });
}

export function isQueueCleared(e: unknown): boolean {
  return e instanceof QueueClearedError;
}
