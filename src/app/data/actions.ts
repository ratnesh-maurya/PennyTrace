/**
 * DATA BOUNDARY — write actions. Mock implementations mutate the in-memory
 * store; the real engine writes `user_overrides` / `category_rules` and
 * rebuilds the ledger. All actions are async so callers already await.
 */
import { CATEGORY_BY_ID } from '../../core/categories';
import type { CategoryId, Transaction, TxnId } from '../../core/types';
import { normaliseName } from '../../ui/theme/brand';
import { dataStore } from './store';
import type { ChatMessage } from './types';

/**
 * Choice in the correction sheet meaning "this isn't spending" (reimbursement,
 * money held for someone…). Mock: recorded as an unlinked move ('transfer'
 * category, kind 'xfer'). The core engine still has to define how this
 * override is stored.
 */
export const NOT_AN_EXPENSE = 'transfer' as const satisfies CategoryId;

function patchTxns(match: (t: Transaction) => boolean, patch: (t: Transaction) => Partial<Transaction>) {
  dataStore.setState(s => ({
    txns: s.txns.map(t => (match(t) ? { ...t, ...patch(t) } : t)),
  }));
}

function kindFor(t: Transaction, categoryId: CategoryId): Transaction['kind'] {
  const group = CATEGORY_BY_ID[categoryId]?.group;
  if (group === 'movement' && (t.kind === 'spend' || t.kind === 'fee')) {
    return 'xfer';
  }
  if (group !== 'movement' && t.kind === 'xfer' && !t.linkedTxnId) {
    return t.direction === 'credit' ? 'in' : 'spend';
  }
  return t.kind;
}

/**
 * Set a transaction's category (confidence → 100, leaves the review queue).
 * `remember` also saves an on-device rule for the counterparty, applied to
 * every transaction with the same counterparty.
 */
export async function resolveCategory(txnId: TxnId, categoryId: CategoryId, remember: boolean): Promise<void> {
  const target = dataStore.getState().txns.find(t => t.id === txnId);
  if (!target) {
    return;
  }
  const catName = CATEGORY_BY_ID[categoryId]?.name ?? categoryId;
  const who = target.counterparty ?? '';
  const key = normaliseName(who);
  const provenance = remember && who ? `Your rule · ${who.toUpperCase()} → ${catName}` : 'Your correction';
  patchTxns(
    t => t.id === txnId || (remember && !!key && normaliseName(t.counterparty ?? '') === key && t.kind !== 'in'),
    t => ({
      categoryId,
      kind: kindFor(t, categoryId),
      confidence: 100,
      needsReview: false,
      ruleProvenance: provenance,
    }),
  );
}

/** User says this debit went to one of their own accounts: not spending. */
export async function markAsTransfer(txnId: TxnId): Promise<void> {
  patchTxns(
    t => t.id === txnId,
    () => ({
      kind: 'xfer',
      categoryId: 'transfer',
      confidence: 100,
      needsReview: false,
      ruleProvenance: 'Marked as a transfer by you',
    }),
  );
}

// ---------------------------------------------------------------------------
// Sources & privacy settings
// ---------------------------------------------------------------------------

export async function setSmsEnabled(enabled: boolean): Promise<void> {
  dataStore.setState(s => ({ sourcesStatus: { ...s.sourcesStatus, sms: { ...s.sourcesStatus.sms, enabled } } }));
}

export async function setDiscardRaw(discardRaw: boolean): Promise<void> {
  dataStore.setState(s => ({ sourcesStatus: { ...s.sourcesStatus, discardRaw } }));
}

/** Stubs until the SAF file picker + encrypted export land. Resolve `false` = not available. */
export async function exportLedger(): Promise<boolean> {
  return false;
}
export async function importStatement(): Promise<boolean> {
  return false;
}

// ---------------------------------------------------------------------------
// Onboarding (PennySms TurboModule later)
// ---------------------------------------------------------------------------

export async function requestSmsPermission(): Promise<'granted' | 'denied'> {
  dataStore.setState(s => ({
    sourcesStatus: { ...s.sourcesStatus, sms: { ...s.sourcesStatus.sms, permission: 'granted' } },
  }));
  return 'granted';
}

let scanTimer: ReturnType<typeof setInterval> | undefined;

export async function startInitialScan(depthMonths: number): Promise<void> {
  clearInterval(scanTimer);
  const total = depthMonths * 214;
  dataStore.setState({ scan: { state: 'scanning', depthMonths, scanned: 0, total } });
  scanTimer = setInterval(() => {
    const { scan } = dataStore.getState();
    const scanned = Math.min(total, scan.scanned + 120);
    dataStore.setState({ scan: { ...scan, scanned, state: scanned >= total ? 'done' : 'scanning' } });
    if (scanned >= total) {
      clearInterval(scanTimer);
    }
  }, 120);
}

// ---------------------------------------------------------------------------
// On-device model (src/llm later — the only network use)
// ---------------------------------------------------------------------------

let downloadTimer: ReturnType<typeof setInterval> | undefined;

/** Mock: simulates download + SHA-256 verify. Real: src/llm modelManager. */
export async function downloadModel(): Promise<void> {
  clearInterval(downloadTimer);
  dataStore.setState(s => ({ model: { ...s.model, state: 'downloading', progress: 0, error: undefined } }));
  downloadTimer = setInterval(() => {
    const { model } = dataStore.getState();
    if (model.state === 'downloading') {
      const progress = Math.min(1, model.progress + 0.04);
      dataStore.setState({ model: { ...model, progress, state: progress >= 1 ? 'verifying' : 'downloading' } });
    } else if (model.state === 'verifying') {
      dataStore.setState({ model: { ...model, state: 'ready', progress: 1 } });
      clearInterval(downloadTimer);
    } else {
      clearInterval(downloadTimer);
    }
  }, 150);
}

export async function cancelModelDownload(): Promise<void> {
  clearInterval(downloadTimer);
  dataStore.setState(s => ({ model: { ...s.model, state: 'absent', progress: 0 } }));
}

export async function deleteModel(): Promise<void> {
  clearInterval(downloadTimer);
  dataStore.setState(s => ({ model: { ...s.model, state: 'absent', progress: 0 } }));
}

export async function setModelWifiOnly(wifiOnly: boolean): Promise<void> {
  dataStore.setState(s => ({ model: { ...s.model, wifiOnly } }));
}

// ---------------------------------------------------------------------------
// Chat (src/llm/tasks/chat later)
// ---------------------------------------------------------------------------

let chatSeq = 0;

export async function sendChatMessage(text: string): Promise<void> {
  const now = Date.now();
  const user: ChatMessage = { id: `m${++chatSeq}`, role: 'user', text, at: now };
  const ready = dataStore.getState().model.state === 'ready';
  const reply: ChatMessage = {
    id: `m${++chatSeq}`,
    role: 'assistant',
    text: ready
      ? 'Answers come from your ledger on this phone. Chat is not wired to the model in this build yet.'
      : 'Download the on-device model to ask questions about your ledger. Nothing you type leaves this phone.',
    at: now,
  };
  dataStore.setState(s => ({ chat: [...s.chat, user, reply] }));
}
