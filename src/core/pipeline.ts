/**
 * PennyTrace pipeline entry points.
 *
 *   RawSms ─ ingestSms (fingerprint, parse) ─ SourceEvent (persisted)
 *   SourceEvents + edits + rules + overrides ─ buildLedger ─ Ledger (derived)
 *
 * The ledger is always rebuilt from scratch from the persisted evidence, so the
 * same inputs give the same ledger no matter the order they arrived in.
 */
import { parseSms } from './parsers';
import { ingestWith } from './ledger/ingest';
import type { EpochMs, RawSms, SourceEvent } from './types';

export { buildLedger, LEDGER_VERSION } from './ledger/build';

/** New SourceEvents for SMS not seen before. id = `sms:${raw.id}`. */
export function ingestSms(raw: RawSms[], knownFingerprints: ReadonlySet<string>, now: EpochMs): SourceEvent[] {
  return ingestWith(parseSms, raw, knownFingerprints, now);
}
