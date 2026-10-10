/**
 * Ingest: raw SMS → new SourceEvents. Pure; the parser is injected so the
 * ledger engine can be tested without depending on parser behaviour.
 *
 * Idempotent: an SMS whose fingerprint is already known (or repeats inside the
 * batch) produces nothing, so a rescan or a duplicate delivery never changes the
 * ledger. Within a batch the earliest copy (by date, then id) wins.
 */
import { fingerprint } from '../sms/fingerprint';
import type { EpochMs, ParsedEvent, ParseStatus, RawSms, SourceEvent } from '../types';
import { cmpNum, cmpStr } from './util';

export interface ParseResult {
  status: ParseStatus;
  parsed?: ParsedEvent;
}

/** A parsed time more than a day in the future is a bad parse; fall back to delivery time. */
const FUTURE_TOLERANCE_MS = 86_400_000;

export function ingestWith(
  parse: (sms: RawSms) => ParseResult,
  raw: readonly RawSms[],
  knownFingerprints: ReadonlySet<string>,
  now: EpochMs,
): SourceEvent[] {
  const ordered = [...raw].sort((a, b) => cmpNum(a.date, b.date) || cmpStr(a.id, b.id));
  const seen = new Set<string>();
  const out: SourceEvent[] = [];
  for (const sms of ordered) {
    const fp = fingerprint(sms.address, sms.body);
    if (knownFingerprints.has(fp) || seen.has(fp)) {
      continue;
    }
    seen.add(fp);
    let outcome: ParseResult;
    try {
      outcome = parse(sms);
    } catch {
      outcome = { status: 'unparsed' };
    }
    const event: SourceEvent = {
      id: `sms:${sms.id}`,
      sourceKind: 'sms',
      externalId: sms.id,
      sender: sms.address,
      body: sms.body,
      fingerprint: fp,
      receivedAt: sms.date,
      parseStatus: outcome.status,
    };
    if (outcome.parsed) {
      const p = outcome.parsed;
      const occurredAt =
        Number.isFinite(p.occurredAt) && p.occurredAt <= Math.max(now, sms.date) + FUTURE_TOLERANCE_MS
          ? p.occurredAt
          : sms.date;
      event.parsed = occurredAt === p.occurredAt ? p : { ...p, occurredAt };
    }
    out.push(event);
  }
  return out;
}
