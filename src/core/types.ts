/**
 * PennyTrace core contract.
 *
 * Every layer (parsers, ledger engine, DB, UI) agrees on these shapes.
 * Change them deliberately: bump PARSER_SCHEMA_VERSION / LEDGER_VERSION when
 * semantics change so stored data is reprocessed.
 *
 * Conventions:
 * - Money is integer paise (`Paise`). Never use floats for amounts.
 * - Time is epoch milliseconds (`EpochMs`). Day buckets are `DayKey` (YYYY-MM-DD,
 *   device-local time zone at the moment of computation).
 */

import type { CategoryDef } from './categories';

export type Paise = number;
export type EpochMs = number;
/** `YYYY-MM-DD` in the device-local time zone. */
export type DayKey = string;

export type AccountId = string;
export type TxnId = string;
export type CategoryId = string;

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

/** One SMS as read from the Android inbox (content://sms/inbox). */
export interface RawSms {
  /** Telephony `_id`, stringified. Monotonic per device; used as scan cursor. */
  id: string;
  /** Sender address, e.g. `AX-HDFCBK-S`, `VM-SBIUPI`, `+9198…`. */
  address: string;
  body: string;
  /** Delivery time. */
  date: EpochMs;
}

export type SourceKind = 'sms'; // 'notification' | 'mail' later

export type ParseStatus =
  | 'parsed' // a bank/generic parser produced a ParsedEvent
  | 'ignored' // gated out: OTP, promo, non-financial
  | 'unparsed'; // looked financial but nothing could parse it

export type Direction = 'debit' | 'credit';
export type Instrument = 'account' | 'card' | 'upi' | 'wallet' | 'unknown';
export type TxnStatus = 'pending' | 'success' | 'failed' | 'reversed';

export interface TxnRefs {
  /** 12-digit UPI reference / RRN. */
  upi?: string;
  /** NEFT/RTGS/IMPS UTR. */
  utr?: string;
  /** Anything else the bank calls a reference (card auth code, ARN, BBPS id…). */
  other?: string;
}

/**
 * Hints a parser can attach from message wording. The ledger engine decides the
 * final `TxnKind`; hints only bias it.
 */
export interface ParseHints {
  isAtmWithdrawal?: boolean;
  isCardBillPayment?: boolean;
  isRefund?: boolean;
  isReversal?: boolean;
  isSalary?: boolean;
  isInvestment?: boolean;
  isEmandate?: boolean;
  /** Bank says money went to/came from another account of the same holder. */
  counterAccountLast4?: string;
  /**
   * The alert is about a CREDIT card (credit-card spend type, "credit card" wording or an
   * available limit). A plain `instrument: 'card'` may be a debit card on a savings account.
   */
  isCreditCard?: boolean;
}

/** What a parser extracts from a single message. */
export interface ParsedEvent {
  /** `transaction` moves money; `balance` only reports a balance/limit. */
  kind: 'transaction' | 'balance';
  /** Canonical bank id: `hdfc`, `sbi`, `icici`, `axis`, `kotak`, … */
  bank: string;
  /** Stable parser id, e.g. `hdfc-upi-debit`. Shown in the UI as evidence. */
  parserId: string;
  parserVersion: number;

  amount: Paise; // 0 for kind === 'balance'
  direction: Direction;
  status: TxnStatus;
  instrument: Instrument;

  /** Last 4 digits of the account or card the message is about. */
  accountLast4?: string;
  /** Merchant / payee / payer exactly as printed (trimmed). */
  counterparty?: string;
  /** UPI VPA of the counterparty, if printed. */
  vpa?: string;
  refs: TxnRefs;

  /** Balance after the transaction, if the bank printed it. */
  balance?: Paise;
  /** Credit card available limit, if printed. */
  availableLimit?: Paise;

  /** When it happened. Falls back to the SMS delivery time. */
  occurredAt: EpochMs;
  hints: ParseHints;
  /** 0–100. Bank parsers are ~90. */
  confidence: number;
}

/** A persisted piece of evidence (one SMS). Raw input to the ledger build. */
export interface SourceEvent {
  id: string;
  sourceKind: SourceKind;
  /** e.g. SMS `_id`. */
  externalId: string;
  sender: string;
  /** Raw text. May be purged by the user ("Discard raw messages"). */
  body?: string;
  /** sha256(normalised sender + normalised body). Unique. */
  fingerprint: string;
  receivedAt: EpochMs;
  parseStatus: ParseStatus;
  parsed?: ParsedEvent;
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export type AccountType = 'savings' | 'current' | 'credit_card' | 'wallet' | 'cash';
export type Ownership = 'personal' | 'joint';

/** A day's closing balance the user read in their bank app. */
export interface ClosingBalance {
  day: DayKey;
  closing: Paise;
}

export interface Account {
  id: AccountId;
  bank: string;
  type: AccountType;
  ownership: Ownership;
  coHolder?: string;
  /** Last 4 digits. */
  mask: string;
  displayName: string;
  /** Own UPI ids / names used to recognise self transfers. */
  upiIds: string[];
  aliases: string[];
  /** Counted in the "All accounts" scope. Joint accounts default to false. */
  includeInTotal: boolean;
  /** Credit cards: total limit, when known (user edit or derived from available-limit alerts). */
  creditLimit?: Paise;
  /**
   * The user said "don't count this account" (an old account, someone else's, a wallet they
   * don't care about). Its transactions and balances are left out of the ledger entirely; it is
   * kept in `accounts` so it can be restored.
   */
  ignored?: boolean;
  /**
   * Input only (an account edit, not stored on the derived account): closing balances the user
   * entered for chosen days, for accounts whose SMS miss money (a credit that was never alerted).
   * Each makes that day close at exactly that figure; later days roll forward from it.
   */
  closingBalances?: readonly ClosingBalance[];
}

/**
 * Accounting treatment, matching the UI vocabulary:
 * - spend: real consumption (counts in "Spent")
 * - in: real income (counts in "Received")
 * - xfer: matched move between own accounts (neither)
 * - pending_xfer: debit to own account, credit not seen yet ("In transit")
 * - refund: money back for an earlier spend (not income)
 * - liability: credit-card bill payment (settles debt, not a second expense)
 * - cash: ATM withdrawal into cash
 * - fee: bank charge (counts in "Spent")
 * - invest: money into investments (SIP, broker, mutual fund): an asset, not spending
 */
export type TxnKind = 'spend' | 'in' | 'xfer' | 'pending_xfer' | 'refund' | 'liability' | 'cash' | 'fee' | 'invest';

export interface Transaction {
  id: TxnId;
  /**
   * Stable across rebuilds: derived from the strongest ref (account+ref) or the
   * fingerprint of the first source. User overrides are keyed by this.
   */
  stableKey: string;
  accountId: AccountId;
  amount: Paise; // always positive
  direction: Direction;
  occurredAt: EpochMs;
  status: TxnStatus;
  kind: TxnKind;

  counterparty?: string; // cleaned display name
  vpa?: string;
  categoryId: CategoryId;
  /** 0–100 confidence of the category. < REVIEW_THRESHOLD → needsReview. */
  confidence: number;
  /** Human-readable provenance: "Your rule · DMART → Groceries", "Merchant list", … */
  ruleProvenance: string;
  needsReview: boolean;

  refs: TxnRefs;
  /** Source event ids backing this transaction (≥1). */
  sourceIds: string[];
  /** Why several sources were merged, for the evidence screen. */
  mergeReason?: string;
  /** Linked transaction (transfer counterpart, refund original). */
  linkedTxnId?: TxnId;
  parserId: string;
}

export interface TransferLink {
  debitTxnId: TxnId;
  creditTxnId?: TxnId; // undefined while in transit
  method: 'ref' | 'amount_time' | 'alias' | 'user';
  state: 'matched' | 'in_transit';
  confidence: number;
}

export interface BalanceSnapshot {
  accountId: AccountId;
  at: EpochMs;
  reported: Paise;
  sourceId: string;
}

export interface CategoryRule {
  id: string;
  /** Case-insensitive substring or `/regex/`. */
  pattern: string;
  field: 'counterparty' | 'vpa' | 'body';
  categoryId: CategoryId;
  priority: number;
  source: 'seed' | 'user';
}

/** User correction, replayed on every rebuild. */
export interface UserOverride {
  stableKey: string;
  categoryId?: CategoryId;
  kind?: TxnKind;
  counterparty?: string;
  /** Force-link as a transfer to this stableKey. */
  linkToStableKey?: string;
  /** Hide (e.g. user says it's a duplicate). */
  hidden?: boolean;
}

/** Fully derived ledger. Rebuilt deterministically from inputs. */
export interface Ledger {
  accounts: Account[];
  transactions: Transaction[];
  transferLinks: TransferLink[];
  snapshots: BalanceSnapshot[];
}

export interface LedgerInput {
  sources: SourceEvent[];
  /** User-edited account metadata (names, ownership, includeInTotal, aliases). */
  accountEdits: Partial<Account>[];
  rules: CategoryRule[];
  overrides: UserOverride[];
  /** The user's own names / VPAs, for self-transfer detection. */
  selfIdentities: string[];
  /** Categories the user created in the app. */
  customCategories?: CategoryDef[];
}

export const REVIEW_THRESHOLD = 75;

// ---------------------------------------------------------------------------
// View models (what screens consume)
// ---------------------------------------------------------------------------

/** `all` = accounts with includeInTotal; otherwise a single account id. */
export type Scope = 'all' | AccountId;
export type Provenance = 'reported' | 'calculated' | 'estimated';

export interface DailyClose {
  day: DayKey;
  scope: Scope;
  opening: Paise;
  received: Paise;
  /** spend + fee in scope, INCLUDING purchases on credit cards (what the user consumed). */
  spent: Paise;
  /**
   * Part of `spent` charged to credit cards. It did not reduce cash, so:
   * closing = opening + received − (spent − spentOnCard) + movedNet
   */
  spentOnCard: Paise;
  /**
   * Signed net effect on this scope's cash of xfer, pending_xfer, liability (card bill),
   * cash (ATM), refunds and reversed spends.
   */
  movedNet: Paise;
  /** Unsigned total of moves, for display ("Moved ₹5,000"). */
  movedGross: Paise;
  closing: Paise;
  openingProvenance: Provenance;
  closingProvenance: Provenance;
  /** Bank-reported closing for the scope, if every account in it reported that day. */
  reported?: { closing: Paise; at: EpochMs; accountsMatched: number; variance: Paise };
  byCategory: { categoryId: CategoryId; amount: Paise; count: number }[];
  transfers: { fromAccountId?: AccountId; toAccountId?: AccountId; amount: Paise; state: 'matched' | 'in_transit' }[];
  txnIds: TxnId[];
}

export interface AccountRecon {
  accountId: AccountId;
  /** What the SMS alone predict the balance was when the bank last reported (not "now"). */
  calculated: Paise;
  reported?: Paise;
  reportedAt?: EpochMs;
  /** The bank report before the last one: the gap arose between the two. */
  previousReportedAt?: EpochMs;
  /** Balance now: the bank's last figure rolled forward by the alerts since. */
  current?: Paise;
  variance?: Paise;
  status: 'reconciled' | 'off' | 'unknown';
}

export interface Position {
  cash: Paise; // sum of included non-card balances
  cardDues: Paise; // positive number owed
  net: Paise;
}

export type InsightRange = 'week' | 'month';

export interface Insights {
  range: InsightRange;
  scope: Scope;
  /** 7 day bars (week) or 4 week bars (month), oldest first. */
  bars: { key: DayKey; label: string; spent: Paise }[];
  total: Paise;
  avgPerUnit: Paise;
  prevTotal: Paise;
  moneyIn: Paise;
  /** (moneyIn − total) / moneyIn, 0–100; undefined when no income. */
  keptPct?: number;
  byAccount: { accountId: AccountId; spent: Paise }[];
  categories: { categoryId: CategoryId; amount: Paise; pct: number }[];
  topMerchants: { name: string; amount: Paise; count: number }[];
}
