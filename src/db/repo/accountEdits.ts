import { asc, eq, sql } from 'drizzle-orm';
import type { Account, AccountId } from '../../core/types';
import { getDb, runAtomic } from '../client';
import { accountEdits } from '../schema';
import { META_KEYS, setMetaStatement } from './meta';
import { parseJson, stmt } from './util';

export type AccountEdit = Partial<Account> & { id: AccountId };

/** User edits as `LedgerInput.accountEdits` (each carries the account `id`). */
export async function listAccountEdits(): Promise<AccountEdit[]> {
  const { db } = await getDb();
  const rows = await db.select().from(accountEdits).orderBy(asc(accountEdits.accountId));
  return rows.map(r => ({ ...parseJson<Partial<Account>>(r.patchJson, {}), id: r.accountId }));
}

/** Merges `patch` into the stored edit for `id` (fields set to `undefined` are removed). Marks the ledger dirty. */
export async function upsertAccountEdit(id: AccountId, patch: Partial<Omit<Account, 'id'>>): Promise<AccountEdit> {
  const { db } = await getDb();
  const row = await db.select().from(accountEdits).where(eq(accountEdits.accountId, id)).get();
  const merged: Partial<Account> = { ...parseJson<Partial<Account>>(row?.patchJson, {}), ...patch };
  for (const k of Object.keys(merged) as (keyof Account)[]) {
    if (merged[k] === undefined) {
      delete merged[k];
    }
  }
  delete merged.id;
  await runAtomic([
    stmt(
      db
        .insert(accountEdits)
        .values({ accountId: id, patchJson: JSON.stringify(merged), updatedAt: Date.now() })
        .onConflictDoUpdate({
          target: accountEdits.accountId,
          set: { patchJson: sql`excluded.patch_json`, updatedAt: sql`excluded.updated_at` },
        }),
    ),
    await setMetaStatement(META_KEYS.ledgerDirty, '1'),
  ]);
  return { ...merged, id };
}

export async function removeAccountEdit(id: AccountId): Promise<void> {
  const { db } = await getDb();
  await runAtomic([
    stmt(db.delete(accountEdits).where(eq(accountEdits.accountId, id))),
    await setMetaStatement(META_KEYS.ledgerDirty, '1'),
  ]);
}
