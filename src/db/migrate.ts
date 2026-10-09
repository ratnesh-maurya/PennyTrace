/**
 * Applies drizzle-kit migrations (src/db/migrations) to an op-sqlite connection.
 *
 * Compatible with drizzle's own `__drizzle_migrations` bookkeeping (created_at =
 * journal `when`), but each migration runs inside one awaited native transaction,
 * which drizzle-orm/op-sqlite/migrator does not guarantee (its transaction()
 * does not await).
 */
import type { DB } from '@op-engineering/op-sqlite';
import bundled from './migrations/migrations';

export interface MigrationBundle {
  journal: { entries: { idx: number; when: number; tag: string; breakpoints: boolean }[] };
  migrations: Record<string, string>;
}

const TABLE = '__drizzle_migrations';

export function pendingMigrations(bundle: MigrationBundle, lastAppliedAt: number | null) {
  return bundle.journal.entries
    .filter(e => lastAppliedAt === null || e.when > lastAppliedAt)
    .sort((a, b) => a.idx - b.idx)
    .map(e => {
      const sql = bundle.migrations[`m${e.idx.toString().padStart(4, '0')}`];
      if (!sql) {
        throw new Error(`Missing migration: ${e.tag}`);
      }
      const statements = sql
        .split('--> statement-breakpoint')
        .map(s => s.trim())
        .filter(s => s.length > 0);
      return { tag: e.tag, when: e.when, statements };
    });
}

export async function migrate(db: DB, bundle: MigrationBundle = bundled): Promise<void> {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS ${TABLE} (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)`,
  );
  const last = await db.execute(`SELECT created_at FROM ${TABLE} ORDER BY created_at DESC LIMIT 1`);
  const lastAt = last.rows.length > 0 ? Number(last.rows[0].created_at) : null;
  for (const m of pendingMigrations(bundle, lastAt)) {
    await db.transaction(async tx => {
      for (const stmt of m.statements) {
        await tx.execute(stmt);
      }
      await tx.execute(`INSERT INTO ${TABLE} (hash, created_at) VALUES (?, ?)`, [m.tag, m.when]);
    });
  }
}
