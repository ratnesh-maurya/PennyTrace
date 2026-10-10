/**
 * Where the ledger comes from. `live` reads the encrypted database and the SMS inbox;
 * `demo` runs a built-in week of SMS through the same engine (tests, previews, and users
 * who want to look around before granting SMS access). Screens never see the difference.
 */
import { CATEGORY_BY_ID, type CategoryDef } from '../../core/categories';
import type {
  CategoryId,
  CategoryRule,
  DayKey,
  Ledger,
  Paise,
  SourceEvent,
  Transaction,
  UserOverride,
} from '../../core/types';

export interface SmsStatus {
  permission: 'granted' | 'denied' | 'unknown';
  messagesRead: number;
  banksRecognised: number;
  lastScanAt?: number;
}

export interface LoadedData {
  ledger: Ledger;
  /** Evidence by source id (raw SMS may have been discarded: `body` undefined). */
  sources: ReadonlyMap<string, SourceEvent>;
  sms: SmsStatus;
  discardRaw: boolean;
  /** Categories the user created. */
  customCategories: CategoryDef[];
}

export interface ImportProgress {
  scanned: number;
  total: number;
  done: boolean;
}

export interface DataBackend {
  readonly kind: 'live' | 'demo';
  load(): Promise<LoadedData>;
  /** Persist a user correction (and optionally a rule for the counterparty), then rebuild. */
  correct(txn: Transaction, categoryId: CategoryId, remember: boolean): Promise<void>;
  markTransfer(txn: Transaction): Promise<void>;
  /** "Don't count this account" (or restore it). Rebuilds the ledger. */
  setAccountIgnored(accountId: string, ignored: boolean): Promise<void>;
  /** A day's closing balance read in the bank's app (`undefined` removes it). Rebuilds the ledger. */
  setClosingBalance(accountId: string, day: DayKey, closing: Paise | undefined): Promise<void>;
  setDiscardRaw(discard: boolean): Promise<void>;
  /** Adds (or replaces, by id) a category the user created. */
  saveCustomCategory(def: CategoryDef): Promise<void>;
  requestPermission(): Promise<'granted' | 'denied'>;
  /** First inbox import; reports progress until done. */
  initialImport(months: number, onProgress: (p: ImportProgress) => void): Promise<void>;
  /** Called whenever the stored ledger changed underneath (new SMS, background sync). */
  subscribe(onChange: () => void): () => void;
}

/** The override for a category correction. Movement categories become non-spending moves. */
export function correctionOverride(txn: Transaction, categoryId: CategoryId): UserOverride {
  if (categoryId === 'investments') {
    return { stableKey: txn.stableKey, categoryId, kind: 'invest' };
  }
  const movement = CATEGORY_BY_ID[categoryId]?.group === 'movement';
  return movement ? { stableKey: txn.stableKey, categoryId, kind: 'xfer' } : { stableKey: txn.stableKey, categoryId };
}

/** "Always use this for DMART AVENUE": a user rule on the counterparty name. */
export function counterpartyRule(txn: Transaction, categoryId: CategoryId): CategoryRule | undefined {
  const name = txn.counterparty?.trim();
  if (!name) {
    return undefined;
  }
  return {
    id: `user:${name.toLowerCase()}`,
    pattern: name,
    field: 'counterparty',
    categoryId,
    priority: 100,
    source: 'user',
  };
}

export function transferOverride(txn: Transaction): UserOverride {
  return { stableKey: txn.stableKey, categoryId: 'transfer', kind: 'xfer' };
}

/** "1,284 messages read · 6 banks recognised". */
export function smsCounts(sources: Iterable<SourceEvent>): Pick<SmsStatus, 'messagesRead' | 'banksRecognised'> {
  let messagesRead = 0;
  const banks = new Set<string>();
  for (const s of sources) {
    messagesRead++;
    if (s.parseStatus === 'parsed' && s.parsed && !s.parsed.parserId.startsWith('generic')) {
      banks.add(s.parsed.bank);
    }
  }
  return { messagesRead, banksRecognised: banks.size };
}
