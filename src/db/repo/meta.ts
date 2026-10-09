import { eq, sql } from 'drizzle-orm';
import { getDb, runAtomic, type SqlStatement } from '../client';
import { meta } from '../schema';
import { parseJson, stmt } from './util';

export const META_KEYS = {
  /** Highest inbox `_id` fully ingested (string; compare numerically). */
  lastScannedSmsId: 'last_scanned_sms_id',
  /** LEDGER_VERSION the derived tables were last built with. */
  ledgerVersion: 'ledger_version',
  /** PARSER_SCHEMA_VERSION stored parse results were produced with. */
  parserSchemaVersion: 'parser_schema_version',
  /** Lower bound (epoch ms) of the initial import window; absent until onboarding imports. */
  importSinceMs: 'import_since_ms',
  /** "1" when source/inputs changed but derived tables were not rebuilt yet (crash safety). */
  ledgerDirty: 'ledger_dirty',
  /** Epoch ms of the last completed scan. */
  lastScanAt: 'last_scan_at',
  /** JSON AppSettings. */
  settings: 'settings',
} as const;

export type MetaKey = (typeof META_KEYS)[keyof typeof META_KEYS];

export async function getMeta(key: MetaKey): Promise<string | undefined> {
  const { db } = await getDb();
  const row = await db.select({ value: meta.value }).from(meta).where(eq(meta.key, key)).get();
  return row?.value;
}

export async function setMetaStatement(key: MetaKey, value: string): Promise<SqlStatement> {
  const { db } = await getDb();
  return stmt(
    db
      .insert(meta)
      .values({ key, value })
      .onConflictDoUpdate({ target: meta.key, set: { value: sql`excluded.value` } }),
  );
}

export async function setMeta(key: MetaKey, value: string): Promise<void> {
  await runAtomic([await setMetaStatement(key, value)]);
}

export async function deleteMeta(key: MetaKey): Promise<void> {
  const { db } = await getDb();
  await db.delete(meta).where(eq(meta.key, key)).run();
}

async function getNumber(key: MetaKey): Promise<number | undefined> {
  const v = await getMeta(key);
  if (v === undefined) {
    return undefined;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export const getLastScannedSmsId = async (): Promise<string> => (await getMeta(META_KEYS.lastScannedSmsId)) ?? '0';
export const getLedgerVersion = () => getNumber(META_KEYS.ledgerVersion);
export const getParserSchemaVersion = () => getNumber(META_KEYS.parserSchemaVersion);
export const getImportSinceMs = () => getNumber(META_KEYS.importSinceMs);
export const getLastScanAt = () => getNumber(META_KEYS.lastScanAt);
export const isLedgerDirty = async (): Promise<boolean> => (await getMeta(META_KEYS.ledgerDirty)) === '1';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface AppSettings {
  /** "Discard raw messages": purge SMS text after parsing. */
  discardRawBodies: boolean;
  /** The user's own names / VPAs (LedgerInput.selfIdentities). */
  selfIdentities: string[];
  /** Other screens may store extra keys; they are preserved on update. */
  [key: string]: unknown;
}

export const DEFAULT_SETTINGS: AppSettings = { discardRawBodies: false, selfIdentities: [] };

export async function getSettings(): Promise<AppSettings> {
  const stored = parseJson<Partial<AppSettings>>(await getMeta(META_KEYS.settings), {});
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = { ...(await getSettings()), ...patch };
  await setMeta(META_KEYS.settings, JSON.stringify(next));
  return next;
}
