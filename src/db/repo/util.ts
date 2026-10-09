import type { SqlStatement } from '../client';

/** Rows per multi-row INSERT. Keeps bound params well under SQLite's 32766 limit (≤20 cols × 500). */
export const INSERT_CHUNK = 500;

export function chunk<T>(items: readonly T[], size: number = INSERT_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** Narrow a drizzle builder's `toSQL()` into a batch statement. */
export function stmt(q: { toSQL(): { sql: string; params: unknown[] } }): SqlStatement {
  const { sql, params } = q.toSQL();
  return { sql, params };
}

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (text == null) {
    return fallback;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** Drops `undefined`s so optional fields round-trip as absent, not `null`. */
export function orUndefined<T>(v: T | null): T | undefined {
  return v === null ? undefined : v;
}
