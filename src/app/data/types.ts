/**
 * Data-boundary types: what screens receive from `src/app/data`. Everything is
 * expressed in core view models (`src/core/types.ts`, integer paise) plus a
 * few UI-shaped wrappers. The real engine replaces the mock by implementing the
 * hooks in `./hooks.ts` with these exact shapes.
 */
import type {
  Account,
  AccountId,
  DayKey,
  EpochMs,
  Paise,
  SourceEvent,
  Transaction,
  TransferLink,
  TxnId,
} from '../../core/types';

export type TxnFilter = 'all' | 'spent' | 'in' | 'xfer' | 'review';

export interface WeekStripDay {
  day: DayKey;
  /** Spent (spend + fee) on that day within the scope. Drives the dot colour. */
  spent: Paise;
}

/** One Activity row. Matched own-account transfers are collapsed into the debit leg. */
export interface TxnListItem {
  txn: Transaction;
  account: Account;
  /** The other side of a collapsed transfer (credit leg's account), or a move's destination. */
  counterAccount?: Account;
  /** Summary of `txn.linkedTxnId` (refund original, transfer counterpart), if known. */
  linked?: { id: TxnId; occurredAt: EpochMs; accountId: AccountId };
}

export interface TxnSection {
  day: DayKey;
  /** Spent that day across accounts counted in totals (plus cards). Shown as the group total. */
  spent: Paise;
  data: TxnListItem[];
}

export type FilterCounts = Record<TxnFilter, number>;

export interface TxnDetail extends TxnListItem {
  /** Evidence: every source event backing the row (both legs for a collapsed transfer), oldest first. */
  sources: SourceEvent[];
}

export interface TransferPairView {
  /** Debit transaction id. */
  id: TxnId;
  fromAccountId: AccountId;
  /** Destination account when known (also for in-transit moves recognised by alias). */
  toAccountId?: AccountId;
  amount: Paise;
  state: TransferLink['state'];
  method: TransferLink['method'];
  /** Display reference used for matching, e.g. `UTR SBIN2262829114`. */
  ref?: string;
  debitAt: EpochMs;
  creditAt?: EpochMs;
}

export interface SourcesStatus {
  sms: {
    enabled: boolean;
    permission: 'granted' | 'denied' | 'unknown';
    messagesRead: number;
    banksRecognised: number;
    lastScanAt?: EpochMs;
  };
  /** "Discard raw messages": purge bodies after parsing. */
  discardRaw: boolean;
}

export type ScanState = 'idle' | 'scanning' | 'done';

export interface ScanStatus {
  state: ScanState;
  /** Months of inbox history to read on first run. */
  depthMonths: number;
  scanned: number;
  total: number;
}
