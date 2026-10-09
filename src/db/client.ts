/**
 * Encrypted database singleton: op-sqlite (SQLCipher) + drizzle.
 *
 * drizzle-orm's `op-sqlite` driver targets the pre-v15 op-sqlite API
 * (`executeAsync`, `executeRawAsync`, sync `execute().rows._array`) and its
 * `transaction()` does not await the callback. So:
 * - drizzle gets a small adapter onto the op-sqlite v18 API (reads + single writes);
 * - multi-statement writes go through `runAtomic()` (op-sqlite `executeBatch`,
 *   which runs in one native transaction), never through drizzle's `db.transaction`;
 * - migrations use our own migrator (./migrate.ts).
 */
import { open, type DB, type Scalar, type SQLBatchTuple } from '@op-engineering/op-sqlite';
import { drizzle, type OPSQLiteDatabase } from 'drizzle-orm/op-sqlite';
import { getOrCreateDbKey, toSqlcipherRawKey } from './key';
import { migrate } from './migrate';
import * as schema from './schema';

export const DB_NAME = 'pennytrace.db';

export type Database = OPSQLiteDatabase<typeof schema>;

export interface DbHandle {
  raw: DB;
  db: Database;
}

/** The DB file exists but cannot be decrypted with the stored key (e.g. Keystore key lost). */
export class DatabaseUnreadableError extends Error {
  constructor(cause: unknown) {
    super(`Encrypted database could not be opened: ${String((cause as Error)?.message ?? cause)}`);
    this.name = 'DatabaseUnreadableError';
  }
}

/** A statement built with drizzle (`.toSQL()`) or by hand. */
export interface SqlStatement {
  sql: string;
  params: unknown[];
}

function drizzleAdapter(raw: DB) {
  return {
    executeAsync: (sql: string, params?: Scalar[]) => raw.execute(sql, params),
    executeRawAsync: async (sql: string, params?: Scalar[]) => (await raw.executeRaw(sql, params)).rawRows,
    execute: (sql: string, params?: Scalar[]) => ({ rows: { _array: raw.executeSync(sql, params).rows } }),
  };
}

let handlePromise: Promise<DbHandle> | null = null;

async function openHandle(): Promise<DbHandle> {
  const keyHex = await getOrCreateDbKey();
  const raw = open({ name: DB_NAME, encryptionKey: toSqlcipherRawKey(keyHex) });
  try {
    // First real read: SQLCipher only validates the key here.
    await raw.execute('SELECT count(*) FROM sqlite_master');
  } catch (e) {
    raw.close();
    throw new DatabaseUnreadableError(e);
  }
  await raw.execute('PRAGMA foreign_keys = ON');
  await raw.execute('PRAGMA journal_mode = WAL');
  await migrate(raw);
  // The adapter matches what drizzle's op-sqlite session actually calls at runtime;
  // its declared client type comes from an older op-sqlite, hence the cast.
  const db = drizzle(drizzleAdapter(raw) as unknown as Parameters<typeof drizzle>[0], { schema }) as Database;
  return { raw, db };
}

/** Opens (once per JS runtime) the encrypted DB, running migrations. Shared by UI and headless task. */
export function getDb(): Promise<DbHandle> {
  if (!handlePromise) {
    handlePromise = openHandle().catch(e => {
      handlePromise = null;
      throw e;
    });
  }
  return handlePromise;
}

/** Runs statements atomically (single native transaction). */
export async function runAtomic(statements: readonly SqlStatement[]): Promise<void> {
  if (statements.length === 0) {
    return;
  }
  const { raw } = await getDb();
  const batch: SQLBatchTuple[] = statements.map(s => [s.sql, s.params as Scalar[]]);
  await raw.executeBatch(batch);
}

/** For tests / "delete all data": closes and forgets the singleton. */
export async function closeDb(): Promise<void> {
  const p = handlePromise;
  handlePromise = null;
  if (p) {
    const { raw } = await p.catch(() => ({ raw: null }));
    raw?.close();
  }
}
