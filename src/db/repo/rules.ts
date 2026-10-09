import { asc, desc, eq, sql } from 'drizzle-orm';
import type { CategoryRule } from '../../core/types';
import { getDb, runAtomic } from '../client';
import { categoryRules } from '../schema';
import { META_KEYS, setMetaStatement } from './meta';
import { stmt } from './util';

type Row = typeof categoryRules.$inferSelect;

const fromRow = (r: Row): CategoryRule => ({
  id: r.id,
  pattern: r.pattern,
  field: r.field,
  categoryId: r.categoryId,
  priority: r.priority,
  source: r.source,
});

/** Highest priority first (stable by id), the order the categorizer should try them. */
export async function listRules(): Promise<CategoryRule[]> {
  const { db } = await getDb();
  const rows = await db.select().from(categoryRules).orderBy(desc(categoryRules.priority), asc(categoryRules.id));
  return rows.map(fromRow);
}

/** Insert or replace rules; marks the ledger dirty so the next sync rebuilds. */
export async function upsertRules(rules: readonly CategoryRule[]): Promise<void> {
  if (rules.length === 0) {
    return;
  }
  const { db } = await getDb();
  const statements = rules.map(r =>
    stmt(
      db
        .insert(categoryRules)
        .values(r)
        .onConflictDoUpdate({
          target: categoryRules.id,
          set: {
            pattern: sql`excluded.pattern`,
            field: sql`excluded.field`,
            categoryId: sql`excluded.category_id`,
            priority: sql`excluded.priority`,
            source: sql`excluded.source`,
          },
        }),
    ),
  );
  await runAtomic([...statements, await setMetaStatement(META_KEYS.ledgerDirty, '1')]);
}

export const upsertRule = (rule: CategoryRule) => upsertRules([rule]);

export async function removeRule(id: string): Promise<void> {
  const { db } = await getDb();
  await runAtomic([
    stmt(db.delete(categoryRules).where(eq(categoryRules.id, id))),
    await setMetaStatement(META_KEYS.ledgerDirty, '1'),
  ]);
}
