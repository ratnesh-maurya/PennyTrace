/**
 * Pure decision helpers for the sync service (unit-tested without native modules).
 */
import type { EpochMs, ParsedEvent, ParseStatus, RawSms, SourceEvent } from '../core/types';

/** Inbox `_id`s are decimal strings; compare numerically. */
export function compareSmsIds(a: string, b: string): number {
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
  }
  return x - y;
}

export function maxSmsId(a: string, b: string): string {
  return compareSmsIds(a, b) >= 0 ? a : b;
}

export interface StoredVersions {
  ledgerVersion?: number;
  parserSchemaVersion?: number;
}

export interface CurrentVersions {
  ledgerVersion: number;
  parserSchemaVersion: number;
}

export interface SyncPlan {
  /** Re-run parsers over every stored / inbox message. */
  reparse: boolean;
  /** Inbox cursor to start reading from. */
  afterId: string;
}

/**
 * A parser-schema change means stored parse results are stale: rescan the whole
 * import window from `_id` 0 and reparse stored bodies. A fresh install (no
 * stored version) has nothing stale.
 */
export function planScan(stored: StoredVersions, current: CurrentVersions, cursor: string): SyncPlan {
  const reparse =
    stored.parserSchemaVersion !== undefined && stored.parserSchemaVersion !== current.parserSchemaVersion;
  return { reparse, afterId: reparse ? '0' : cursor };
}

export function needsRebuild(args: {
  stored: StoredVersions;
  current: CurrentVersions;
  newEvents: number;
  reparsed: boolean;
  dirty: boolean;
}): boolean {
  return (
    args.newEvents > 0 ||
    args.reparsed ||
    args.dirty ||
    args.stored.ledgerVersion !== args.current.ledgerVersion ||
    args.stored.parserSchemaVersion !== args.current.parserSchemaVersion
  );
}

/** Start of the import window: `months` calendar months before `now` (device-local). */
export function importSinceMs(months: number, now: EpochMs): EpochMs {
  const d = new Date(now);
  d.setMonth(d.getMonth() - Math.max(0, Math.floor(months)));
  return d.getTime();
}

/** The inbox row a stored event came from, for reparsing. */
export function toRawSms(e: SourceEvent): RawSms | undefined {
  if (e.body === undefined) {
    return undefined;
  }
  return { id: e.externalId, address: e.sender, body: e.body, date: e.receivedAt };
}

export interface ReparseResult {
  fingerprint: string;
  parseStatus: ParseStatus;
  parsed?: ParsedEvent;
  body?: string;
}

/**
 * Merge a fresh parse over a stored one. An LLM-produced parse is kept when the
 * rule parsers still cannot read the message (re-running them must not throw
 * away the user's / model's work).
 */
export function mergeReparse(prev: { parseStatus: ParseStatus }, next: ReparseResult): ReparseResult | undefined {
  if (prev.parseStatus === 'llm' && next.parseStatus === 'unparsed') {
    return undefined;
  }
  return next;
}

/** Fraction 0..1 of the id range [startId, maxId] covered by `cursor`. */
export function scanProgress(startId: string, cursor: string, maxId: string): number {
  const s = Number(startId);
  const c = Number(cursor);
  const m = Number(maxId);
  if (!Number.isFinite(s) || !Number.isFinite(c) || !Number.isFinite(m) || m <= s) {
    return 1;
  }
  return Math.min(1, Math.max(0, (c - s) / (m - s)));
}
