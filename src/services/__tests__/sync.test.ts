/**
 * Orchestration test for runIncrementalScan with in-memory fakes for the
 * native inbox, the DB repositories and the core pipeline.
 */
import type { RawSms, SourceEvent } from '../../core/types';

type Stmt = { sql: string; params: unknown[] };

const mockStore = {
  meta: new Map<string, string>(),
  events: new Map<string, SourceEvent>(), // by fingerprint
  ledgerBuilds: 0,
  inbox: [] as RawSms[],
  permission: true,
};

function mockApply(s: Stmt) {
  const [op, ...rest] = s.params as [string, ...unknown[]];
  if (op === 'meta') {
    mockStore.meta.set(rest[0] as string, rest[1] as string);
  } else if (op === 'insert') {
    for (const e of rest[0] as SourceEvent[]) {
      if (!mockStore.events.has(e.fingerprint)) {
        mockStore.events.set(e.fingerprint, e);
      }
    }
  } else if (op === 'ledger') {
    mockStore.ledgerBuilds++;
  }
}

jest.mock('../../db/client', () => ({
  runAtomic: async (stmts: Stmt[]) => stmts.forEach(mockApply),
}));

jest.mock('../../db/repo/meta', () => {
  const KEYS = {
    lastScannedSmsId: 'last_scanned_sms_id',
    ledgerVersion: 'ledger_version',
    parserSchemaVersion: 'parser_schema_version',
    importSinceMs: 'import_since_ms',
    ledgerDirty: 'ledger_dirty',
    lastScanAt: 'last_scan_at',
    settings: 'settings',
  };
  const num = (k: string) => (mockStore.meta.has(k) ? Number(mockStore.meta.get(k)) : undefined);
  return {
    META_KEYS: KEYS,
    setMetaStatement: async (k: string, v: string) => ({ sql: 'meta', params: ['meta', k, v] }),
    setMeta: async (k: string, v: string) => {
      mockStore.meta.set(k, v);
    },
    getLastScannedSmsId: async () => mockStore.meta.get(KEYS.lastScannedSmsId) ?? '0',
    getLedgerVersion: async () => num(KEYS.ledgerVersion),
    getParserSchemaVersion: async () => num(KEYS.parserSchemaVersion),
    getImportSinceMs: async () => num(KEYS.importSinceMs),
    isLedgerDirty: async () => mockStore.meta.get(KEYS.ledgerDirty) === '1',
    getSettings: async () => ({ discardRawBodies: false, selfIdentities: [] }),
  };
});

jest.mock('../../db/repo/sourceEvents', () => ({
  knownFingerprints: async () => new Set(mockStore.events.keys()),
  insertStatements: async (events: SourceEvent[]) =>
    events.length ? [{ sql: 'insert', params: ['insert', events] }] : [],
  insertMany: async (events: SourceEvent[]) => mockApply({ sql: 'insert', params: ['insert', events] }),
  updateParseStatements: async () => [],
  statusByFingerprint: async () => new Map([...mockStore.events.values()].map(e => [e.fingerprint, e.parseStatus])),
  withBodies: async () => [...mockStore.events.values()].filter(e => e.body !== undefined),
  purgeBodies: async () => 0,
}));

jest.mock('../../db/repo/ledger', () => ({
  loadLedgerInput: async () => ({
    sources: [...mockStore.events.values()],
    accountEdits: [],
    rules: [],
    overrides: [],
    selfIdentities: [],
  }),
  replaceDerivedStatements: async () => [{ sql: 'ledger', params: ['ledger'] }],
}));

jest.mock('../../core/pipeline', () => ({
  LEDGER_VERSION: 7,
  buildLedger: () => ({ accounts: [], transactions: [], transferLinks: [], snapshots: [] }),
  ingestSms: (raw: RawSms[], known: ReadonlySet<string>) =>
    raw
      .filter(r => !known.has(`fp:${r.body}`))
      .map(r => ({
        id: `sms:${r.id}`,
        sourceKind: 'sms',
        externalId: r.id,
        sender: r.address,
        body: r.body,
        fingerprint: `fp:${r.body}`,
        receivedAt: r.date,
        parseStatus: 'parsed',
      })),
}));

jest.mock('../../core/parsers', () => ({ PARSER_SCHEMA_VERSION: 4 }));

jest.mock('../../native/PennySms', () => ({
  INBOX_PAGE_SIZE: 2,
  checkSmsPermission: async () => ({ read: mockStore.permission, receive: mockStore.permission }),
  getMaxSmsId: async () => mockStore.inbox.reduce((m, r) => Math.max(m, Number(r.id)), 0).toString(),
  // Hand-rolled async iterable: async generators are transpiled with helpers jest.mock factories can't reference.
  inboxPages: (afterId: string, since: number, limit: number) => {
    const rows = mockStore.inbox
      .filter(r => Number(r.id) > Number(afterId) && r.date >= since)
      .sort((a, b) => Number(a.id) - Number(b.id));
    let i = 0;
    return {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            if (i >= rows.length) {
              return { done: true, value: undefined };
            }
            const value = rows.slice(i, i + limit);
            i += limit;
            return { done: false, value };
          },
        };
      },
    };
  },
}));

import { initialImport, onSyncProgress, runIncrementalScan } from '../sync';

const now = Date.now();
const sms = (id: number, body: string, ageDays = 1): RawSms => ({
  id: String(id),
  address: 'AX-HDFCBK',
  body,
  date: now - ageDays * 86_400_000,
});

beforeEach(() => {
  mockStore.meta.clear();
  mockStore.events.clear();
  mockStore.ledgerBuilds = 0;
  mockStore.permission = true;
  mockStore.inbox = [sms(1, 'a', 400), sms(2, 'b', 30), sms(3, 'c', 10), sms(4, 'd', 2), sms(5, 'e', 1)];
});

it('does nothing before onboarding', async () => {
  const r = await runIncrementalScan();
  expect(r.skipped).toBe('not-onboarded');
  expect(mockStore.events.size).toBe(0);
});

it('initial import reads the window, advances the cursor and builds once', async () => {
  const seen: string[] = [];
  const off = onSyncProgress(p => seen.push(p.phase));
  const r = await initialImport(6);
  off();
  expect(r.newEvents).toBe(4); // sms 1 is older than 6 months
  expect(mockStore.meta.get('last_scanned_sms_id')).toBe('5');
  expect(mockStore.meta.get('ledger_version')).toBe('7');
  expect(mockStore.meta.get('parser_schema_version')).toBe('4');
  expect(mockStore.meta.get('ledger_dirty')).toBe('0');
  expect(mockStore.ledgerBuilds).toBe(1);
  expect(seen).toContain('reading');
  expect(seen[seen.length - 1]).toBe('done');
});

it('incremental scan is a no-op when nothing is new, and picks up new SMS', async () => {
  await initialImport(6);
  const again = await runIncrementalScan();
  expect(again.newEvents).toBe(0);
  expect(again.ledgerChanged).toBe(false);
  expect(mockStore.ledgerBuilds).toBe(1);

  mockStore.inbox.push(sms(6, 'f', 0));
  const next = await runIncrementalScan();
  expect(next.newEvents).toBe(1);
  expect(mockStore.meta.get('last_scanned_sms_id')).toBe('6');
  expect(mockStore.ledgerBuilds).toBe(2);
});

it('recovers an SMS whose _id was reused below the cursor', async () => {
  await initialImport(6);
  mockStore.inbox = mockStore.inbox.filter(r => r.id !== '5');
  mockStore.inbox.push(sms(5, 'reused', 0));
  const r = await runIncrementalScan();
  expect(r.newEvents).toBe(1);
  expect(mockStore.events.has('fp:reused')).toBe(true);
});

it('rebuilds when a crash left the ledger dirty', async () => {
  await initialImport(6);
  mockStore.meta.set('ledger_dirty', '1');
  const r = await runIncrementalScan();
  expect(r.ledgerChanged).toBe(true);
  expect(mockStore.ledgerBuilds).toBe(2);
});

it('rebuilds after a ledger version change without re-reading', async () => {
  await initialImport(6);
  mockStore.meta.set('ledger_version', '6');
  const r = await runIncrementalScan();
  expect(r.ledgerChanged).toBe(true);
  expect(r.reparsed).toBe(false);
});

it('reparses everything after a parser schema bump', async () => {
  await initialImport(6);
  mockStore.meta.set('parser_schema_version', '3');
  const r = await runIncrementalScan();
  expect(r.reparsed).toBe(true);
  expect(r.scanned).toBe(4);
  expect(mockStore.meta.get('parser_schema_version')).toBe('4');
});

it('still rebuilds a dirty ledger without SMS permission', async () => {
  await initialImport(6);
  mockStore.permission = false;
  mockStore.meta.set('ledger_dirty', '1');
  const r = await runIncrementalScan();
  expect(r.skipped).toBe('no-permission');
  expect(r.ledgerChanged).toBe(true);
});

it('coalesces concurrent calls (single-flight)', async () => {
  await initialImport(6);
  const a = runIncrementalScan();
  const b = runIncrementalScan();
  expect(a).toBe(b);
  await a;
});
