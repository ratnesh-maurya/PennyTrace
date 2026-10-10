/**
 * Live backend: the encrypted ledger database + the SMS sync service. Loaded lazily (it pulls
 * in native modules), only when the PennySms TurboModule exists.
 */
import type { CategoryDef } from '../../core/categories';
import { withClosing } from '../../core/ledger';
import { accountEditsRepo, ledgerRepo, metaRepo, overridesRepo, rulesRepo, sourceEventsRepo } from '../../db';
import { checkSmsPermission, hasSmsAccess, requestSmsPermission } from '../../native/PennySms';
import { initialImport, onSyncProgress, rebuildNow } from '../../services/sync';
import {
  correctionOverride,
  counterpartyRule,
  smsCounts,
  transferOverride,
  type DataBackend,
  type LoadedData,
} from './backend';

export function createLiveBackend(): DataBackend {
  return {
    kind: 'live',
    async load(): Promise<LoadedData> {
      const [ledger, sources, perm, settings, lastScanAt] = await Promise.all([
        ledgerRepo.loadLedger(),
        sourceEventsRepo.all(),
        checkSmsPermission(),
        metaRepo.getSettings(),
        metaRepo.getLastScanAt(),
      ]);
      return {
        ledger,
        sources: new Map(sources.map(s => [s.id, s])),
        sms: { permission: hasSmsAccess(perm) ? 'granted' : 'denied', lastScanAt, ...smsCounts(sources) },
        discardRaw: settings.discardRawBodies,
        customCategories: (settings.customCategories as CategoryDef[] | undefined) ?? [],
      };
    },
    async correct(txn, categoryId, remember) {
      await overridesRepo.upsertOverride(correctionOverride(txn, categoryId));
      const rule = remember ? counterpartyRule(txn, categoryId) : undefined;
      if (rule) {
        await rulesRepo.upsertRule(rule);
      }
      await rebuildNow();
    },
    async markTransfer(txn) {
      await overridesRepo.upsertOverride(transferOverride(txn));
      await rebuildNow();
    },
    async setAccountIgnored(accountId, ignored) {
      await accountEditsRepo.upsertAccountEdit(accountId, { ignored: ignored || undefined });
      await rebuildNow();
    },
    async setClosingBalance(accountId, day, closing) {
      const prev = (await accountEditsRepo.listAccountEdits()).find(e => e.id === accountId);
      await accountEditsRepo.upsertAccountEdit(accountId, {
        closingBalances: withClosing(prev?.closingBalances, day, closing),
      });
      await rebuildNow();
    },
    async saveCustomCategory(def) {
      const settings = await metaRepo.getSettings();
      const existing = (settings.customCategories as CategoryDef[] | undefined) ?? [];
      await metaRepo.updateSettings({ customCategories: [...existing.filter(c => c.id !== def.id), def] });
    },
    async setDiscardRaw(discard) {
      await metaRepo.updateSettings({ discardRawBodies: discard });
      if (discard) {
        await sourceEventsRepo.purgeBodies({ includeUnparsed: true });
      }
    },
    async requestPermission() {
      return hasSmsAccess(await requestSmsPermission()) ? 'granted' : 'denied';
    },
    async initialImport(months, onProgress) {
      const off = onSyncProgress(p =>
        onProgress({ scanned: p.scanned, total: p.fraction > 0 ? Math.round(p.scanned / p.fraction) : 0, done: false }),
      );
      try {
        const r = await initialImport(months);
        onProgress({ scanned: r.scanned, total: r.scanned, done: true });
      } finally {
        off();
      }
    },
    // New SMS and app resume already trigger scans (services/headless.ts); reload when one
    // of them rewrote the ledger.
    subscribe(onChange) {
      return onSyncProgress(p => {
        if (p.phase === 'done' && p.ledgerChanged) {
          onChange();
        }
      });
    },
  };
}
