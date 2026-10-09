/**
 * Model download. THE ONLY FILE IN PENNYTRACE THAT INITIATES NETWORK I/O
 * (ESLint allows network globals here and nowhere else; the background
 * downloader must only be imported from this file).
 *
 * - Never auto-starts: `startModelDownload` is only called from an explicit
 *   user action. `reattachModelDownloads` only re-binds transfers the user
 *   already started (they survive app kills) and never creates new ones.
 * - Wi-Fi only by default: `allowsCellularAccess: false` + per-task
 *   `isAllowedOverMetered: false`. On Android the transfer then waits for an
 *   unmetered network instead of failing, and pauses/resumes if Wi-Fi drops.
 * - Writes `<models>/<file>.part`, checks exact size and SHA-256, then moves it
 *   to `${DocumentDirectoryPath}/models/<file>`. Any failure deletes the part.
 */
import {
  completeHandler,
  createDownloadTask,
  getExistingDownloadTasks,
  setConfig,
  type DownloadTask,
} from '@kesha-antonov/react-native-background-downloader';
import { DocumentDirectoryPath, exists, getFSInfo, hash, mkdir, moveFile, stat, unlink } from '@dr.pogodin/react-native-fs';
import { MODEL_CATALOG, type ModelSpec } from './catalog';
import type { ModelEvent } from './modelState';

export type DownloadListener = (modelId: string, ev: ModelEvent) => void;

export interface StartDownloadOptions {
  /** Allow mobile data. Default false. */
  allowMetered?: boolean;
}

const TASK_PREFIX = 'pennytrace-model-';
/** Keep this much free space after the download. */
const FREE_SPACE_MARGIN = 200 * 1024 * 1024;

const tasks = new Map<string, DownloadTask>();
const cancelled = new Set<string>();

export function modelsDir(): string {
  return `${DocumentDirectoryPath}/models`;
}

export function modelFilePath(spec: ModelSpec): string {
  return `${modelsDir()}/${spec.file}`;
}

function partPath(spec: ModelSpec): string {
  return `${modelFilePath(spec)}.part`;
}

function taskId(spec: ModelSpec): string {
  return `${TASK_PREFIX}${spec.id}`;
}

async function safeUnlink(path: string): Promise<void> {
  try {
    if (await exists(path)) {
      await unlink(path);
    }
  } catch {
    // best effort
  }
}

/** Remove the part file and the downloader's own `.tmp` next to it. */
async function removePartFiles(spec: ModelSpec): Promise<void> {
  await safeUnlink(partPath(spec));
  await safeUnlink(`${partPath(spec)}.tmp`);
}

async function ensureModelsDir(): Promise<void> {
  if (!(await exists(modelsDir()))) {
    await mkdir(modelsDir());
  }
}

/** Installed = final file present with the exact catalog size (hash was checked at install). */
export async function isModelFileInstalled(spec: ModelSpec): Promise<boolean> {
  try {
    const path = modelFilePath(spec);
    if (!(await exists(path))) {
      return false;
    }
    const st = await stat(path);
    return Number(st.size) === spec.sizeBytes;
  } catch {
    return false;
  }
}

/** Full SHA-256 re-check of an installed file (slow: reads the whole file). */
export async function verifyInstalledModel(spec: ModelSpec): Promise<boolean> {
  try {
    return (await hash(modelFilePath(spec), 'sha256')).toLowerCase() === spec.sha256;
  } catch {
    return false;
  }
}

export async function removeModelFiles(spec: ModelSpec): Promise<void> {
  await removePartFiles(spec);
  await safeUnlink(modelFilePath(spec));
}

async function finalize(spec: ModelSpec, listener: DownloadListener): Promise<void> {
  listener(spec.id, { type: 'verifying' });
  const part = partPath(spec);
  try {
    const st = await stat(part);
    if (Number(st.size) !== spec.sizeBytes) {
      throw new Error(`Size mismatch: got ${st.size} bytes, expected ${spec.sizeBytes}`);
    }
    const digest = (await hash(part, 'sha256')).toLowerCase();
    if (digest !== spec.sha256) {
      throw new Error('Checksum mismatch: the downloaded file is not the expected model');
    }
    await safeUnlink(modelFilePath(spec));
    await moveFile(part, modelFilePath(spec));
    listener(spec.id, { type: 'installed' });
  } catch (e) {
    await removePartFiles(spec);
    listener(spec.id, { type: 'download_failed', error: errorMessage(e) });
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function bind(task: DownloadTask, spec: ModelSpec, listener: DownloadListener): void {
  tasks.set(spec.id, task);
  task
    .begin(({ expectedBytes }) => {
      listener(spec.id, { type: 'download_begin', total: expectedBytes || spec.sizeBytes });
    })
    .progress(({ bytesDownloaded, bytesTotal }) => {
      listener(spec.id, { type: 'progress', bytes: bytesDownloaded, total: bytesTotal || spec.sizeBytes });
    })
    .done(() => {
      tasks.delete(spec.id);
      Promise.resolve(completeHandler(task.id)).catch(() => undefined);
      finalize(spec, listener).catch(() => undefined);
    })
    .error(({ error, errorCode }) => {
      tasks.delete(spec.id);
      if (cancelled.delete(spec.id)) {
        return; // stop() we asked for; cancel already cleaned up
      }
      removePartFiles(spec)
        .catch(() => undefined)
        .finally(() => listener(spec.id, { type: 'download_failed', error: `${error} (${errorCode})` }));
    });
}

function configure(allowMetered: boolean): void {
  setConfig({
    allowsCellularAccess: allowMetered,
    progressInterval: 1000,
    maxParallelDownloads: 1,
    // Android 14+ runs this as a user-initiated data transfer job, which must
    // show a notification; make it an honest, visible progress notification.
    showNotificationsEnabled: true,
    showCompletionNotification: false,
    showCancelAction: false,
    isLogsEnabled: false,
  });
}

/**
 * Start downloading a model. Call ONLY from an explicit user action.
 * Progress, completion and errors arrive through `listener` as ModelEvents.
 */
export async function startModelDownload(
  spec: ModelSpec,
  listener: DownloadListener,
  opts: StartDownloadOptions = {},
): Promise<void> {
  if (tasks.has(spec.id)) {
    return; // already running or paused
  }
  if (await isModelFileInstalled(spec)) {
    listener(spec.id, { type: 'installed' });
    return;
  }
  const allowMetered = opts.allowMetered ?? false;
  try {
    const fs = await getFSInfo();
    if (fs.freeSpace < spec.sizeBytes + FREE_SPACE_MARGIN) {
      throw new Error(
        `Not enough free space: need ${Math.ceil((spec.sizeBytes + FREE_SPACE_MARGIN) / 1e6)} MB, have ${Math.floor(
          fs.freeSpace / 1e6,
        )} MB`,
      );
    }
    await ensureModelsDir();
    await removePartFiles(spec);
  } catch (e) {
    listener(spec.id, { type: 'download_failed', error: errorMessage(e) });
    return;
  }

  configure(allowMetered);
  cancelled.delete(spec.id);
  listener(spec.id, { type: 'download_queued', total: spec.sizeBytes });
  const task = createDownloadTask({
    id: taskId(spec),
    url: spec.url,
    destination: partPath(spec),
    isAllowedOverMetered: allowMetered,
    isAllowedOverRoaming: false,
    maxRedirects: 5,
    notificationTitle: `Downloading ${spec.displayName}`,
    metadata: { modelId: spec.id },
  });
  bind(task, spec, listener);
  task.start();
}

export async function pauseModelDownload(spec: ModelSpec, listener: DownloadListener): Promise<void> {
  const task = tasks.get(spec.id);
  if (task) {
    await task.pause();
    listener(spec.id, { type: 'paused' });
  }
}

export async function resumeModelDownload(spec: ModelSpec, listener: DownloadListener): Promise<void> {
  const task = tasks.get(spec.id);
  if (task) {
    await task.resume();
    listener(spec.id, { type: 'resumed' });
  }
}

export async function cancelModelDownload(spec: ModelSpec, listener: DownloadListener): Promise<void> {
  const task = tasks.get(spec.id);
  if (task) {
    cancelled.add(spec.id);
    tasks.delete(spec.id);
    try {
      await task.stop();
    } catch {
      // already gone
    }
  }
  await removePartFiles(spec);
  listener(spec.id, { type: 'removed' });
}

export function isDownloadActive(spec: ModelSpec): boolean {
  return tasks.has(spec.id);
}

/**
 * On launch: re-bind transfers the user started earlier (they keep running
 * while the app is dead), finish ones that completed meanwhile, and delete
 * orphaned part files. Never starts a new transfer.
 */
export async function reattachModelDownloads(listener: DownloadListener): Promise<void> {
  let existing: DownloadTask[] = [];
  try {
    existing = await getExistingDownloadTasks();
  } catch {
    existing = [];
  }
  const seen = new Set<string>();
  for (const task of existing) {
    if (!task.id.startsWith(TASK_PREFIX)) {
      continue;
    }
    const spec = MODEL_CATALOG.find(m => taskId(m) === task.id);
    if (!spec) {
      await task.stop().catch(() => undefined);
      continue;
    }
    seen.add(spec.id);
    switch (task.state) {
      case 'DONE':
        Promise.resolve(completeHandler(task.id)).catch(() => undefined);
        listener(spec.id, { type: 'download_queued', total: spec.sizeBytes });
        await finalize(spec, listener);
        break;
      case 'FAILED':
      case 'STOPPED':
        await removePartFiles(spec);
        listener(spec.id, { type: 'removed' });
        break;
      default:
        listener(spec.id, { type: 'download_queued', total: spec.sizeBytes });
        listener(spec.id, { type: 'progress', bytes: task.bytesDownloaded, total: task.bytesTotal || spec.sizeBytes });
        bind(task, spec, listener);
        if (task.state === 'PAUSED') {
          listener(spec.id, { type: 'paused' });
        }
    }
  }
  for (const spec of MODEL_CATALOG) {
    if (!seen.has(spec.id)) {
      await removePartFiles(spec);
    }
  }
}
