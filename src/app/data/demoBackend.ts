/**
 * Demo backend: a built-in week of bank SMS (`./demo/demoSms`) through the real pipeline.
 * Corrections live in memory for the session. No native modules, no storage.
 */
import { withClosing } from '../../core/ledger';
import { buildLedger, ingestSms } from '../../core/pipeline';
import type { LedgerInput } from '../../core/types';
import {
  correctionOverride,
  counterpartyRule,
  smsCounts,
  transferOverride,
  type DataBackend,
  type LoadedData,
} from './backend';
import { DEMO_ACCOUNT_EDITS, DEMO_SELF_IDENTITIES, demoSms } from './demo/demoSms';

export function createDemoBackend(now: number = Date.now()): DataBackend {
  const input: LedgerInput = {
    sources: ingestSms(demoSms(now), new Set(), now),
    accountEdits: DEMO_ACCOUNT_EDITS,
    rules: [],
    overrides: [],
    selfIdentities: DEMO_SELF_IDENTITIES,
  };
  let discardRaw = false;
  const listeners = new Set<() => void>();

  const upsert = <T>(list: T[], item: T, same: (a: T) => boolean) => [...list.filter(x => !same(x)), item];

  return {
    kind: 'demo',
    async load(): Promise<LoadedData> {
      const sources = discardRaw ? input.sources.map(s => ({ ...s, body: undefined })) : input.sources;
      return {
        ledger: buildLedger(input),
        sources: new Map(sources.map(s => [s.id, s])),
        sms: { permission: 'granted', lastScanAt: now, ...smsCounts(input.sources) },
        discardRaw,
        customCategories: input.customCategories ?? [],
      };
    },
    async correct(txn, categoryId, remember) {
      const o = correctionOverride(txn, categoryId);
      input.overrides = upsert(input.overrides, o, x => x.stableKey === o.stableKey);
      const rule = remember ? counterpartyRule(txn, categoryId) : undefined;
      if (rule) {
        input.rules = upsert(input.rules, rule, x => x.id === rule.id);
      }
    },
    async markTransfer(txn) {
      const o = transferOverride(txn);
      input.overrides = upsert(input.overrides, o, x => x.stableKey === o.stableKey);
    },
    async setAccountIgnored(accountId, ignored) {
      const prev = input.accountEdits.find(e => e.id === accountId) ?? { id: accountId };
      input.accountEdits = upsert(input.accountEdits, { ...prev, ignored }, e => e.id === accountId);
    },
    async setClosingBalance(accountId, day, closing) {
      const prev = input.accountEdits.find(e => e.id === accountId) ?? { id: accountId };
      const closingBalances = withClosing(prev.closingBalances, day, closing);
      input.accountEdits = upsert(input.accountEdits, { ...prev, closingBalances }, e => e.id === accountId);
    },
    async saveCustomCategory(def) {
      input.customCategories = [...(input.customCategories ?? []).filter(c => c.id !== def.id), def];
    },
    async setDiscardRaw(discard) {
      discardRaw = discard;
    },
    async requestPermission() {
      return 'granted';
    },
    async initialImport(_months, onProgress) {
      const total = input.sources.length;
      onProgress({ scanned: total, total, done: true });
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
  };
}
