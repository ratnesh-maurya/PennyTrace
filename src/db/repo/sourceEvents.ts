import { and, asc, count, isNotNull, ne, sql } from 'drizzle-orm';
import type { ParsedEvent, ParseStatus, SourceEvent } from '../../core/types';
import { getDb, runAtomic, type SqlStatement } from '../client';
import { sourceEvents } from '../schema';
import { chunk, orUndefined, parseJson, stmt } from './util';

type Row = typeof sourceEvents.$inferSelect;
type Insert = typeof sourceEvents.$inferInsert;

/**
 * Gated-out messages (OTPs, promos) are kept only as a fingerprint + status so
 * they are never re-processed; their text is not stored.
 */
function toRow(e: SourceEvent): Insert {
  return {
    id: e.id,
    sourceKind: e.sourceKind,
    externalId: e.externalId,
    sender: e.sender,
    body: e.parseStatus === 'ignored' ? null : e.body ?? null,
    fingerprint: e.fingerprint,
    receivedAt: e.receivedAt,
    parserId: e.parsed?.parserId ?? null,
    parserVersion: e.parsed?.parserVersion ?? null,
    parseStatus: e.parseStatus,
    parsedJson: e.parsed ? JSON.stringify(e.parsed) : null,
  };
}

export function fromRow(r: Row): SourceEvent {
  const parsed = parseJson<ParsedEvent | undefined>(r.parsedJson, undefined);
  return {
    id: r.id,
    sourceKind: r.sourceKind,
    externalId: r.externalId,
    sender: r.sender,
    body: orUndefined(r.body),
    fingerprint: r.fingerprint,
    receivedAt: r.receivedAt,
    parseStatus: r.parseStatus,
    ...(parsed ? { parsed } : {}),
  };
}

/** INSERT statements: new fingerprints are inserted; an existing `ignored` row is superseded by a non-ignored parse. */
export async function insertStatements(events: readonly SourceEvent[]): Promise<SqlStatement[]> {
  const { db } = await getDb();
  const rows = await withUniqueIds(events.map(toRow));
  return chunk(rows).map(part =>
    stmt(
      db
        .insert(sourceEvents)
        .values(part)
        .onConflictDoUpdate({
          target: sourceEvents.fingerprint,
          set: {
            body: sql`excluded.body`,
            parserId: sql`excluded.parser_id`,
            parserVersion: sql`excluded.parser_version`,
            parseStatus: sql`excluded.parse_status`,
            parsedJson: sql`excluded.parsed_json`,
          },
          setWhere: sql`${sourceEvents.parseStatus} = 'ignored' AND excluded.parse_status <> 'ignored'`,
        }),
    ),
  );
}

/**
 * Primary keys come from the pipeline. If one is already taken by a *different*
 * message (e.g. an inbox `_id` reused after the newest SMS was deleted), derive a
 * distinct id rather than letting the PK conflict abort the whole batch.
 */
async function withUniqueIds(rows: Insert[]): Promise<Insert[]> {
  if (rows.length === 0) {
    return rows;
  }
  const { db } = await getDb();
  const taken = new Map<string, string>();
  for (const part of chunk(
    rows.map(r => r.id),
    900,
  )) {
    const found = await db
      .select({ id: sourceEvents.id, f: sourceEvents.fingerprint })
      .from(sourceEvents)
      .where(
        sql`${sourceEvents.id} IN (${sql.join(
          part.map(id => sql`${id}`),
          sql`, `,
        )})`,
      );
    for (const r of found) {
      taken.set(r.id, r.f);
    }
  }
  return rows.map(r => {
    const owner = taken.get(r.id);
    if (owner === undefined || owner === r.fingerprint) {
      taken.set(r.id, r.fingerprint);
      return r;
    }
    const id = `${r.id}~${r.fingerprint.slice(0, 16)}`;
    taken.set(id, r.fingerprint);
    return { ...r, id };
  });
}

/** Inserts events; existing fingerprints are left alone (except superseding `ignored`). */
export async function insertMany(events: readonly SourceEvent[]): Promise<void> {
  await runAtomic(await insertStatements(events));
}

export async function knownFingerprints(): Promise<Set<string>> {
  const { db } = await getDb();
  const rows = await db.select({ f: sourceEvents.fingerprint }).from(sourceEvents);
  return new Set(rows.map(r => r.f));
}

/** Fingerprints that already have a real (non-ignored) result. */
export async function settledFingerprints(): Promise<Set<string>> {
  const { db } = await getDb();
  const rows = await db
    .select({ f: sourceEvents.fingerprint })
    .from(sourceEvents)
    .where(ne(sourceEvents.parseStatus, 'ignored'));
  return new Set(rows.map(r => r.f));
}

export async function all(): Promise<SourceEvent[]> {
  const { db } = await getDb();
  const rows = await db.select().from(sourceEvents).orderBy(asc(sourceEvents.receivedAt), asc(sourceEvents.id));
  return rows.map(fromRow);
}

/** Events that still have their raw text (candidates for re-parsing). */
export async function withBodies(): Promise<SourceEvent[]> {
  const { db } = await getDb();
  const rows = await db.select().from(sourceEvents).where(isNotNull(sourceEvents.body));
  return rows.map(fromRow);
}

export async function byIds(ids: readonly string[]): Promise<SourceEvent[]> {
  if (ids.length === 0) {
    return [];
  }
  const { db } = await getDb();
  const out: SourceEvent[] = [];
  for (const part of chunk(ids, 900)) {
    const rows = await db
      .select()
      .from(sourceEvents)
      .where(
        sql`${sourceEvents.id} IN (${sql.join(
          part.map(id => sql`${id}`),
          sql`, `,
        )})`,
      );
    out.push(...rows.map(fromRow));
  }
  return out;
}

export interface ParseUpdate {
  fingerprint: string;
  parseStatus: ParseStatus;
  parsed?: ParsedEvent;
  /** Restores the raw text (e.g. a previously ignored SMS that now parses). Ignored rows always drop it. */
  body?: string;
}

/** Replaces parse results by fingerprint (used after a parser upgrade). */
export async function updateParseStatements(updates: readonly ParseUpdate[]): Promise<SqlStatement[]> {
  const { db } = await getDb();
  return updates.map(u =>
    stmt(
      db
        .update(sourceEvents)
        .set({
          parseStatus: u.parseStatus,
          parsedJson: u.parsed ? JSON.stringify(u.parsed) : null,
          parserId: u.parsed?.parserId ?? null,
          parserVersion: u.parsed?.parserVersion ?? null,
          ...(u.parseStatus === 'ignored' ? { body: null } : u.body !== undefined ? { body: u.body } : {}),
        })
        .where(sql`${sourceEvents.fingerprint} = ${u.fingerprint}`),
    ),
  );
}

export async function updateParse(updates: readonly ParseUpdate[]): Promise<void> {
  await runAtomic(await updateParseStatements(updates));
}

/**
 * "Discard raw messages": drops stored SMS text. Unparsed messages keep their
 * text by default so the Needs-review list can still show it.
 */
export async function purgeBodies(opts: { includeUnparsed?: boolean } = {}): Promise<number> {
  const { db } = await getDb();
  const where = opts.includeUnparsed
    ? isNotNull(sourceEvents.body)
    : and(isNotNull(sourceEvents.body), ne(sourceEvents.parseStatus, 'unparsed'));
  const res = await db.update(sourceEvents).set({ body: null }).where(where).run();
  return res.rowsAffected;
}

export async function countByStatus(): Promise<Record<ParseStatus, number>> {
  const { db } = await getDb();
  const rows = await db
    .select({ status: sourceEvents.parseStatus, n: count() })
    .from(sourceEvents)
    .groupBy(sourceEvents.parseStatus);
  const out: Record<ParseStatus, number> = { parsed: 0, ignored: 0, unparsed: 0 };
  for (const r of rows) {
    out[r.status] = r.n;
  }
  return out;
}

/** Messages that looked financial but nothing could parse (Needs-parsing list). */
export async function unparsed(): Promise<SourceEvent[]> {
  const { db } = await getDb();
  const rows = await db
    .select()
    .from(sourceEvents)
    .where(sql`${sourceEvents.parseStatus} = 'unparsed'`)
    .orderBy(asc(sourceEvents.receivedAt));
  return rows.map(fromRow);
}

/** fingerprint → stored parse status, for every event. */
export async function statusByFingerprint(): Promise<Map<string, ParseStatus>> {
  const { db } = await getDb();
  const rows = await db.select({ f: sourceEvents.fingerprint, s: sourceEvents.parseStatus }).from(sourceEvents);
  return new Map(rows.map(r => [r.f, r.s]));
}
