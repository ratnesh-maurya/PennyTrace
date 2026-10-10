/**
 * Sync orchestration: inbox scan → ingest → (reparse) → rebuild → persist.
 *
 * - The Android inbox is the durable queue. `meta.last_scanned_sms_id` is the
 *   cursor; each page is inserted together with the cursor update, so a crash
 *   never loses or double-counts a message (fingerprints dedupe anyway).
 * - The ledger is derived: after any input change (new events, overrides,
 *   rules, version bumps) it is rebuilt with core `buildLedger` and the derived
 *   tables are replaced atomically. `meta.ledger_dirty` survives crashes
 *   between those two steps.
 * - Single-flight: concurrent callers share the running scan; a request that
 *   arrives mid-scan triggers one more pass afterwards (an SMS could have landed
 *   after the page was read).
 */
import { buildLedger, ingestSms, LEDGER_VERSION } from '../core/pipeline';
import { PARSER_SCHEMA_VERSION } from '../core/parsers';
import type { RawSms, SourceEvent } from '../core/types';
import { runAtomic, type SqlStatement } from '../db/client';
import { loadLedgerInput, replaceDerivedStatements } from '../db/repo/ledger';
import * as metaRepo from '../db/repo/meta';
import { META_KEYS } from '../db/repo/meta';
import * as sourceEventsRepo from '../db/repo/sourceEvents';
import { checkSmsPermission, getMaxSmsId, INBOX_PAGE_SIZE, inboxPages } from '../native/PennySms';
import {
  importSinceMs,
  maxSmsId,
  needsRebuild,
  planScan,
  scanProgress,
  toRawSms,
  type ReparseResult,
} from './syncLogic';

export type SyncPhase = 'reading' | 'reparsing' | 'building' | 'saving' | 'done' | 'error';

export interface SyncProgress {
  phase: SyncPhase;
  /** Inbox messages read in this run. */
  scanned: number;
  /** New source events stored in this run. */
  newEvents: number;
  /** 0..1 estimate while reading; 1 when done. */
  fraction: number;
  /** Set on `done` when the derived ledger was rewritten (UI should reload). */
  ledgerChanged?: boolean;
  error?: string;
}

export type SyncSkipReason = 'no-permission' | 'not-onboarded';

export interface SyncResult {
  scanned: number;
  newEvents: number;
  reparsed: boolean;
  ledgerChanged: boolean;
  /** Why the inbox was not read (the ledger may still have been rebuilt). */
  skipped?: SyncSkipReason;
}

export interface ScanOptions {
  /** Diagnostic label: 'sms', 'boot', 'foreground', 'onboarding', … */
  reason?: string;
}

/** Recent window re-read on every incremental scan, to catch inbox `_id` reuse after deletions. */
const OVERLAP_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Progress listeners
// ---------------------------------------------------------------------------

type Listener = (p: SyncProgress) => void;
const listeners = new Set<Listener>();
let lastProgress: SyncProgress | null = null;

/** Subscribe to scan progress (onboarding, pull-to-refresh). Returns an unsubscribe function. */
export function onSyncProgress(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Latest progress event, if any (e.g. to render state on mount). */
export function getLastSyncProgress(): SyncProgress | null {
  return lastProgress;
}

function emit(p: SyncProgress): void {
  lastProgress = p;
  for (const cb of [...listeners]) {
    try {
      cb(p);
    } catch {
      // A broken listener must not break the sync.
    }
  }
}

// ---------------------------------------------------------------------------
// Single-flight
// ---------------------------------------------------------------------------

let inflight: Promise<SyncResult> | null = null;
let rerunRequested = false;

export function isSyncing(): boolean {
  return inflight !== null;
}

/** Reads new inbox messages, stores them, and rebuilds the ledger if anything changed. */
export function runIncrementalScan(opts: ScanOptions = {}): Promise<SyncResult> {
  if (inflight) {
    rerunRequested = true;
    return inflight;
  }
  const run = async (): Promise<SyncResult> => {
    let total: SyncResult = { scanned: 0, newEvents: 0, reparsed: false, ledgerChanged: false };
    do {
      rerunRequested = false;
      const r = await scanOnce(opts);
      total = {
        scanned: total.scanned + r.scanned,
        newEvents: total.newEvents + r.newEvents,
        reparsed: total.reparsed || r.reparsed,
        ledgerChanged: total.ledgerChanged || r.ledgerChanged,
        ...(r.skipped ? { skipped: r.skipped } : {}),
      };
    } while (rerunRequested);
    return total;
  };
  inflight = run().finally(() => {
    inflight = null;
  });
  return inflight;
}

/**
 * First import (onboarding): read the last `months` months of the inbox. Calling
 * it again with a deeper window widens the import and rescans from the start
 * (already-stored messages are skipped by fingerprint).
 */
export async function initialImport(months = 6): Promise<SyncResult> {
  const since = importSinceMs(months, Date.now());
  const prev = await metaRepo.getImportSinceMs();
  if (prev === undefined || since < prev) {
    await runAtomic([
      await metaRepo.setMetaStatement(META_KEYS.importSinceMs, String(since)),
      await metaRepo.setMetaStatement(META_KEYS.lastScannedSmsId, '0'),
    ]);
  }
  return runIncrementalScan({ reason: 'onboarding' });
}

/** Rebuild the derived ledger now (e.g. right after a user correction). */
export function rebuildNow(): Promise<SyncResult> {
  return runIncrementalScan({ reason: 'rebuild' });
}

// ---------------------------------------------------------------------------
// One pass
// ---------------------------------------------------------------------------

async function scanOnce(_opts: ScanOptions): Promise<SyncResult> {
  const progress: SyncProgress = { phase: 'reading', scanned: 0, newEvents: 0, fraction: 0 };
  try {
    const [perm, since, cursor, storedLedger, storedParser, dirty] = await Promise.all([
      checkSmsPermission(),
      metaRepo.getImportSinceMs(),
      metaRepo.getLastScannedSmsId(),
      metaRepo.getLedgerVersion(),
      metaRepo.getParserSchemaVersion(),
      metaRepo.isLedgerDirty(),
    ]);
    const stored = { ledgerVersion: storedLedger, parserSchemaVersion: storedParser };
    const current = { ledgerVersion: LEDGER_VERSION, parserSchemaVersion: PARSER_SCHEMA_VERSION };

    let skipped: SyncSkipReason | undefined;
    let reparsed = false;
    if (!perm.read) {
      skipped = 'no-permission';
    } else if (since === undefined) {
      skipped = 'not-onboarded';
    }

    if (!skipped && since !== undefined) {
      const plan = planScan(stored, current, cursor);
      emit({ ...progress });
      if (plan.reparse) {
        progress.phase = 'reparsing';
        emit({ ...progress });
        await reparseAll(since, progress);
        reparsed = true;
      } else {
        await readNew(plan.afterId, since, progress);
        await readOverlap(since, progress);
      }
    }

    const rebuild = needsRebuild({ stored, current, newEvents: progress.newEvents, reparsed, dirty });
    if (rebuild) {
      progress.phase = 'building';
      emit({ ...progress });
      const ledger = buildLedger(await loadLedgerInput());
      progress.phase = 'saving';
      emit({ ...progress });
      await runAtomic([
        ...(await replaceDerivedStatements(ledger)),
        await metaRepo.setMetaStatement(META_KEYS.ledgerVersion, String(LEDGER_VERSION)),
        await metaRepo.setMetaStatement(META_KEYS.parserSchemaVersion, String(PARSER_SCHEMA_VERSION)),
        await metaRepo.setMetaStatement(META_KEYS.ledgerDirty, '0'),
        await metaRepo.setMetaStatement(META_KEYS.lastScanAt, String(Date.now())),
      ]);
    } else if (!skipped) {
      await metaRepo.setMeta(META_KEYS.lastScanAt, String(Date.now()));
    }

    if ((await metaRepo.getSettings()).discardRawBodies) {
      // Everything, including alerts nothing could read: "discard" means no message text kept.
      await sourceEventsRepo.purgeBodies({ includeUnparsed: true });
    }

    emit({ ...progress, phase: 'done', fraction: 1, ledgerChanged: rebuild });
    return {
      scanned: progress.scanned,
      newEvents: progress.newEvents,
      reparsed,
      ledgerChanged: rebuild,
      ...(skipped ? { skipped } : {}),
    };
  } catch (e) {
    emit({ ...progress, phase: 'error', error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/** Reads `_id > afterId` page by page; each page is stored together with the cursor. */
async function readNew(afterId: string, since: number, progress: SyncProgress): Promise<void> {
  const known = await sourceEventsRepo.knownFingerprints();
  const maxId = await getMaxSmsId();
  let cursor = afterId;
  for await (const page of inboxPages(afterId, since, INBOX_PAGE_SIZE)) {
    const events = ingestSms(page, known, Date.now());
    for (const e of events) {
      known.add(e.fingerprint);
    }
    cursor = page.reduce((m, r) => maxSmsId(m, r.id), cursor);
    await persistPage(events, cursor);
    progress.scanned += page.length;
    progress.newEvents += events.length;
    progress.fraction = scanProgress(afterId, cursor, maxId);
    emit({ ...progress });
  }
  // Rows between the last page and maxId were filtered out by `since`; skip them next time.
  if (maxSmsId(maxId, cursor) !== cursor) {
    await metaRepo.setMeta(META_KEYS.lastScannedSmsId, maxId);
  }
}

/**
 * Re-reads the last few days regardless of the cursor. AOSP's sms table has no
 * AUTOINCREMENT, so deleting the newest SMS lets the next one reuse its `_id`
 * (≤ cursor). Fingerprints make this a no-op when nothing was missed.
 */
async function readOverlap(since: number, progress: SyncProgress): Promise<void> {
  const known = await sourceEventsRepo.knownFingerprints();
  const windowStart = Math.max(since, Date.now() - OVERLAP_WINDOW_MS);
  for await (const page of inboxPages('0', windowStart, INBOX_PAGE_SIZE)) {
    const events = ingestSms(page, known, Date.now());
    if (events.length === 0) {
      continue;
    }
    for (const e of events) {
      known.add(e.fingerprint);
    }
    await sourceEventsRepo.insertMany(events);
    await metaRepo.setMeta(META_KEYS.ledgerDirty, '1');
    progress.newEvents += events.length;
  }
}

async function persistPage(events: SourceEvent[], cursor: string): Promise<void> {
  const statements: SqlStatement[] = [];
  if (events.length > 0) {
    statements.push(...(await sourceEventsRepo.insertStatements(events)));
    statements.push(await metaRepo.setMetaStatement(META_KEYS.ledgerDirty, '1'));
  }
  statements.push(await metaRepo.setMetaStatement(META_KEYS.lastScannedSmsId, cursor));
  await runAtomic(statements);
}

/**
 * Parser schema changed: re-run the parsers over the whole import window of the
 * inbox, then over stored bodies of messages no longer in the inbox. Existing
 * rows are updated by fingerprint.
 */
async function reparseAll(since: number, progress: SyncProgress): Promise<void> {
  const statuses = await sourceEventsRepo.statusByFingerprint();
  const seen = new Set<string>();
  const maxId = await getMaxSmsId();
  let cursor = '0';

  const apply = async (raws: RawSms[]) => {
    const fresh = ingestSms(raws, new Set(), Date.now());
    const inserts: SourceEvent[] = [];
    const updates: ReparseResult[] = [];
    for (const e of fresh) {
      if (seen.has(e.fingerprint)) {
        continue;
      }
      seen.add(e.fingerprint);
      const prev = statuses.get(e.fingerprint);
      if (prev === undefined) {
        inserts.push(e);
        statuses.set(e.fingerprint, e.parseStatus);
        continue;
      }
      updates.push({ fingerprint: e.fingerprint, parseStatus: e.parseStatus, parsed: e.parsed, body: e.body });
    }
    return { inserts, updates };
  };

  for await (const page of inboxPages('0', since, INBOX_PAGE_SIZE)) {
    const { inserts, updates } = await apply(page);
    cursor = page.reduce((m, r) => maxSmsId(m, r.id), cursor);
    await runAtomic([
      ...(await sourceEventsRepo.insertStatements(inserts)),
      ...(await sourceEventsRepo.updateParseStatements(updates)),
      await metaRepo.setMetaStatement(META_KEYS.ledgerDirty, '1'),
      await metaRepo.setMetaStatement(META_KEYS.lastScannedSmsId, cursor),
    ]);
    progress.scanned += page.length;
    progress.newEvents += inserts.length;
    progress.fraction = scanProgress('0', cursor, maxId);
    emit({ ...progress });
  }
  if (maxSmsId(maxId, cursor) !== cursor) {
    await metaRepo.setMeta(META_KEYS.lastScannedSmsId, maxId);
  }

  // Stored text of messages that have left the inbox (deleted by the user/SMS app).
  const leftovers = (await sourceEventsRepo.withBodies()).filter(e => !seen.has(e.fingerprint));
  const raws = leftovers.map(toRawSms).filter((r): r is RawSms => r !== undefined);
  for (let i = 0; i < raws.length; i += INBOX_PAGE_SIZE) {
    const { inserts, updates } = await apply(raws.slice(i, i + INBOX_PAGE_SIZE));
    // A stored body re-fingerprints to its own row, so `inserts` is normally empty.
    await runAtomic([
      ...(await sourceEventsRepo.insertStatements(inserts)),
      ...(await sourceEventsRepo.updateParseStatements(updates)),
      await metaRepo.setMetaStatement(META_KEYS.ledgerDirty, '1'),
    ]);
  }
}
