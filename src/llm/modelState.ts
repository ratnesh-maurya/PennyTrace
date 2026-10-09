/**
 * Per-model state machine. Pure reducer (no React Native imports).
 *
 *   absent → downloading ⇄ paused → verifying → ready → loading → loaded
 *                 ↘ error (download/verify failed: file removed)    ↘ error (load failed: file kept)
 *   loaded → ready on unload; any → absent on cancel/delete.
 */

export type ModelStatus = 'absent' | 'downloading' | 'paused' | 'verifying' | 'ready' | 'loading' | 'loaded' | 'error';

export interface ModelEntry {
  status: ModelStatus;
  /** A verified GGUF is on disk. */
  installed: boolean;
  bytesDownloaded: number;
  bytesTotal: number;
  /** Download queued but not begun (e.g. waiting for an unmetered network). */
  waitingForNetwork: boolean;
  /** 0–100 while loading. */
  loadProgress: number;
  error?: string;
}

export type ModelEvent =
  | { type: 'download_queued'; total: number }
  | { type: 'download_begin'; total: number }
  | { type: 'progress'; bytes: number; total: number }
  | { type: 'paused' }
  | { type: 'resumed' }
  | { type: 'verifying' }
  | { type: 'installed' }
  | { type: 'download_failed'; error: string }
  | { type: 'removed' }
  | { type: 'load_start' }
  | { type: 'load_progress'; progress: number }
  | { type: 'loaded' }
  | { type: 'unloaded' }
  | { type: 'load_failed'; error: string }
  | { type: 'scanned'; installed: boolean };

export const EMPTY_ENTRY: ModelEntry = {
  status: 'absent',
  installed: false,
  bytesDownloaded: 0,
  bytesTotal: 0,
  waitingForNetwork: false,
  loadProgress: 0,
};

const DOWNLOADING: readonly ModelStatus[] = ['downloading', 'paused', 'verifying'];

export function reduceModel(e: ModelEntry, ev: ModelEvent): ModelEntry {
  switch (ev.type) {
    case 'download_queued':
      if (e.installed) {
        return e;
      }
      return { ...EMPTY_ENTRY, status: 'downloading', waitingForNetwork: true, bytesTotal: ev.total };
    case 'download_begin':
      return e.status === 'downloading' ? { ...e, waitingForNetwork: false, bytesTotal: ev.total || e.bytesTotal } : e;
    case 'progress':
      return e.status === 'downloading' || e.status === 'paused'
        ? { ...e, waitingForNetwork: false, bytesDownloaded: ev.bytes, bytesTotal: ev.total || e.bytesTotal }
        : e;
    case 'paused':
      return e.status === 'downloading' ? { ...e, status: 'paused' } : e;
    case 'resumed':
      return e.status === 'paused' ? { ...e, status: 'downloading' } : e;
    case 'verifying':
      return DOWNLOADING.includes(e.status) ? { ...e, status: 'verifying', waitingForNetwork: false } : e;
    case 'installed':
      return { ...EMPTY_ENTRY, status: 'ready', installed: true };
    case 'download_failed':
      return { ...EMPTY_ENTRY, status: 'error', error: ev.error };
    case 'removed':
      return EMPTY_ENTRY;
    case 'load_start':
      return e.installed ? { ...e, status: 'loading', loadProgress: 0, error: undefined } : e;
    case 'load_progress':
      return e.status === 'loading' ? { ...e, loadProgress: ev.progress } : e;
    case 'loaded':
      return e.installed ? { ...e, status: 'loaded', loadProgress: 100 } : e;
    case 'unloaded':
      return e.status === 'loaded' || e.status === 'loading' ? { ...e, status: e.installed ? 'ready' : 'absent' } : e;
    case 'load_failed':
      return { ...e, status: 'error', error: ev.error, loadProgress: 0 };
    case 'scanned':
      if (ev.installed) {
        return e.installed && e.status !== 'absent' ? e : { ...EMPTY_ENTRY, status: 'ready', installed: true };
      }
      return DOWNLOADING.includes(e.status) ? { ...e, installed: false } : EMPTY_ENTRY;
  }
}

/** Usable for tasks: installed and not in a failed-load state. */
export function isUsable(e: ModelEntry | undefined): boolean {
  return !!e && e.installed && e.status !== 'error';
}
