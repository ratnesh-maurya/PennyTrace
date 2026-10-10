import { asc, eq, sql } from 'drizzle-orm';
import type { UserOverride } from '../../core/types';
import { getDb, runAtomic } from '../client';
import { userOverrides } from '../schema';
import { META_KEYS, setMetaStatement } from './meta';
import { parseJson, stmt } from './util';

type Patch = Omit<UserOverride, 'stableKey'>;

export async function listOverrides(): Promise<UserOverride[]> {
  const { db } = await getDb();
  const rows = await db.select().from(userOverrides).orderBy(asc(userOverrides.stableKey));
  return rows.map(r => ({ ...parseJson<Patch>(r.patchJson, {}), stableKey: r.stableKey }));
}

export async function getOverride(stableKey: string): Promise<UserOverride | undefined> {
  const { db } = await getDb();
  const row = await db.select().from(userOverrides).where(eq(userOverrides.stableKey, stableKey)).get();
  return row ? { ...parseJson<Patch>(row.patchJson, {}), stableKey } : undefined;
}

/**
 * Merges `patch` into the stored override for `stableKey` (a field set to
 * `undefined` is removed). Marks the ledger dirty; the caller (or the next
 * sync) rebuilds.
 */
export async function upsertOverride(override: UserOverride): Promise<UserOverride> {
  const { stableKey, ...patch } = override;
  const prev = await getOverride(stableKey);
  const merged: UserOverride = { ...prev, ...patch, stableKey };
  for (const k of Object.keys(merged) as (keyof UserOverride)[]) {
    if (merged[k] === undefined) {
      delete merged[k];
    }
  }
  const stored: Partial<UserOverride> = { ...merged };
  delete stored.stableKey;
  const { db } = await getDb();
  await runAtomic([
    stmt(
      db
        .insert(userOverrides)
        .values({ stableKey, patchJson: JSON.stringify(stored), updatedAt: Date.now() })
        .onConflictDoUpdate({
          target: userOverrides.stableKey,
          set: { patchJson: sql`excluded.patch_json`, updatedAt: sql`excluded.updated_at` },
        }),
    ),
    await setMetaStatement(META_KEYS.ledgerDirty, '1'),
  ]);
  return merged;
}

export async function removeOverride(stableKey: string): Promise<void> {
  const { db } = await getDb();
  await runAtomic([
    stmt(db.delete(userOverrides).where(eq(userOverrides.stableKey, stableKey))),
    await setMetaStatement(META_KEYS.ledgerDirty, '1'),
  ]);
}
