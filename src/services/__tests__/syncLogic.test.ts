import {
  compareSmsIds,
  importSinceMs,
  maxSmsId,
  mergeReparse,
  needsRebuild,
  planScan,
  scanProgress,
  toRawSms,
} from '../syncLogic';
import { pendingMigrations } from '../../db/migrate';
import bundle from '../../db/migrations/migrations';

const current = { ledgerVersion: 3, parserSchemaVersion: 2 };

describe('sms id ordering', () => {
  it('compares numerically, not lexically', () => {
    expect(compareSmsIds('9', '10')).toBeLessThan(0);
    expect(maxSmsId('9', '10')).toBe('10');
    expect(maxSmsId('120', '0')).toBe('120');
  });
});

describe('planScan', () => {
  it('continues from the cursor when versions match', () => {
    expect(planScan({ ledgerVersion: 3, parserSchemaVersion: 2 }, current, '500')).toEqual({
      reparse: false,
      afterId: '500',
    });
  });
  it('does not reparse on a fresh install', () => {
    expect(planScan({}, current, '0')).toEqual({ reparse: false, afterId: '0' });
  });
  it('rescans from the start after a parser schema bump', () => {
    expect(planScan({ ledgerVersion: 3, parserSchemaVersion: 1 }, current, '500')).toEqual({
      reparse: true,
      afterId: '0',
    });
  });
});

describe('needsRebuild', () => {
  const same = { ledgerVersion: 3, parserSchemaVersion: 2 };
  const base = { stored: same, current, newEvents: 0, reparsed: false, dirty: false };
  it('skips when nothing changed', () => {
    expect(needsRebuild(base)).toBe(false);
  });
  it.each([
    ['new events', { newEvents: 1 }],
    ['reparse', { reparsed: true }],
    ['dirty flag (crash between insert and rebuild, or user edit)', { dirty: true }],
    ['ledger version bump', { stored: { ...same, ledgerVersion: 2 } }],
    ['first build', { stored: {} }],
  ])('rebuilds on %s', (_label, patch) => {
    expect(needsRebuild({ ...base, ...patch })).toBe(true);
  });
});

describe('mergeReparse', () => {
  it('keeps an LLM parse when rule parsers still fail', () => {
    expect(mergeReparse({ parseStatus: 'llm' }, { fingerprint: 'f', parseStatus: 'unparsed' })).toBeUndefined();
  });
  it('lets a rule parser supersede an LLM parse', () => {
    const next = { fingerprint: 'f', parseStatus: 'parsed' as const };
    expect(mergeReparse({ parseStatus: 'llm' }, next)).toBe(next);
  });
});

describe('helpers', () => {
  it('importSinceMs goes back whole calendar months', () => {
    const now = new Date(2026, 9, 9, 12).getTime();
    expect(new Date(importSinceMs(6, now)).getMonth()).toBe(3);
  });
  it('scanProgress is clamped to 0..1', () => {
    expect(scanProgress('0', '50', '100')).toBe(0.5);
    expect(scanProgress('0', '150', '100')).toBe(1);
    expect(scanProgress('100', '100', '100')).toBe(1);
  });
  it('toRawSms needs a body', () => {
    const e = {
      id: 'sms:1',
      sourceKind: 'sms' as const,
      externalId: '1',
      sender: 'AX-HDFCBK',
      fingerprint: 'f',
      receivedAt: 5,
      parseStatus: 'parsed' as const,
    };
    expect(toRawSms(e)).toBeUndefined();
    expect(toRawSms({ ...e, body: 'x' })).toEqual({ id: '1', address: 'AX-HDFCBK', body: 'x', date: 5 });
  });
});

describe('migrations bundle', () => {
  it('splits generated SQL into statements and applies only newer ones', () => {
    const all = pendingMigrations(bundle, null);
    expect(all.length).toBeGreaterThan(0);
    const sql = all.flatMap(m => m.statements).join('\n');
    expect(sql).toContain('CREATE TABLE `source_events`');
    expect(sql).toContain('`source_events_fingerprint_uq`');
    const last = all[all.length - 1].when;
    expect(pendingMigrations(bundle, last)).toEqual([]);
  });
});
