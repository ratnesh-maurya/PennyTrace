/**
 * DATA BOUNDARY: write actions. Corrections go to the backend (user overrides / rules, then a
 * ledger rebuild) and the screens reload.
 */
import type { CategoryDef } from '../../core/categories';
import type { CategoryId, DayKey, TxnId } from '../../core/types';
import { dataStore, getBackend, reloadData, startData } from './store';
import { createDemoBackend } from './demoBackend';

/** Correction-sheet choice meaning "this isn't spending" (reimbursement, money held for someone…). */
export const NOT_AN_EXPENSE = 'transfer' as const satisfies CategoryId;

function findTxn(txnId: TxnId) {
  return dataStore.getState().ledger.transactions.find(t => t.id === txnId);
}

/**
 * Set a transaction's category (confidence → 100, leaves the review queue). `remember` also
 * saves an on-device rule for the counterparty, so future payments to it are categorised too.
 */
export async function resolveCategory(txnId: TxnId, categoryId: CategoryId, remember: boolean): Promise<void> {
  const txn = findTxn(txnId);
  if (!txn) {
    return;
  }
  await getBackend().correct(txn, categoryId, remember);
  await reloadData();
}

/** The user says this debit went to one of their own accounts: not spending. */
export async function markAsTransfer(txnId: TxnId): Promise<void> {
  const txn = findTxn(txnId);
  if (!txn) {
    return;
  }
  await getBackend().markTransfer(txn);
  await reloadData();
}

/** A day's closing balance read in the bank's app, for accounts whose SMS miss money (`undefined` removes it). */
export async function setClosingBalance(accountId: string, day: DayKey, closing: number | undefined): Promise<void> {
  await getBackend().setClosingBalance(accountId, day, closing);
  await reloadData();
}

/** Creates (or updates) a category of the user's own. */
export async function addCustomCategory(def: CategoryDef): Promise<void> {
  await getBackend().saveCustomCategory(def);
  await reloadData();
}

/** "Don't count this account" (an old account, someone else's, a payment app), or restore it. */
export async function setAccountIgnored(accountId: string, ignored: boolean): Promise<void> {
  await getBackend().setAccountIgnored(accountId, ignored);
  await reloadData();
}

// ---------------------------------------------------------------------------
// Sources & privacy settings
// ---------------------------------------------------------------------------

/** Pauses reading new SMS for this session. (Revoking access is done in Android settings.) */
export async function setSmsEnabled(enabled: boolean): Promise<void> {
  dataStore.setState(s => ({ sourcesStatus: { ...s.sourcesStatus, sms: { ...s.sourcesStatus.sms, enabled } } }));
}

export async function setDiscardRaw(discardRaw: boolean): Promise<void> {
  await getBackend().setDiscardRaw(discardRaw);
  await reloadData();
}

/** Not built yet (SAF file picker + encrypted export). `false` = not available. */
export async function exportLedger(): Promise<boolean> {
  return false;
}
export async function importStatement(): Promise<boolean> {
  return false;
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

export async function requestSmsPermission(): Promise<'granted' | 'denied'> {
  const result = await getBackend().requestPermission();
  dataStore.setState(s => ({
    sourcesStatus: { ...s.sourcesStatus, sms: { ...s.sourcesStatus.sms, permission: result } },
  }));
  return result;
}

/** Opens this app's page in Android Settings (to allow SMS, or "Allow restricted settings"). */
export function openAppSettings(): void {
  try {
    (require('../../native/PennySms') as typeof import('../../native/PennySms')).openAppSettings();
  } catch {
    // No native module (demo / tests): nothing to open.
  }
}

export async function startInitialScan(depthMonths: number): Promise<void> {
  dataStore.setState({ scan: { state: 'scanning', depthMonths, scanned: 0, total: 0 } });
  await getBackend().initialImport(depthMonths, p =>
    dataStore.setState(s => ({
      scan: { ...s.scan, scanned: p.scanned, total: Math.max(p.total, p.scanned), state: p.done ? 'done' : 'scanning' },
    })),
  );
  dataStore.setState(s => ({ scan: { ...s.scan, state: 'done' } }));
  await reloadData();
}

/** Look around with a built-in week of SMS, without granting SMS access. */
export async function enterDemoMode(): Promise<void> {
  await startData(createDemoBackend());
}
