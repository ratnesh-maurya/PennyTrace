/**
 * PennyTrace SQLite schema (SQLCipher-encrypted at rest; see ./key.ts).
 *
 * Inputs (source of truth): source_events, account_edits, category_rules, user_overrides, meta.
 * Derived (rebuilt by core/pipeline buildLedger, replaced wholesale): accounts, transactions,
 * transaction_sources, transfer_links, balance_snapshots.
 *
 * Money columns are integer paise. Times are integer epoch ms.
 * After editing this file run `npm run db:generate` to produce a migration.
 */
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type {
  AccountType,
  CategoryRule,
  Direction,
  Ownership,
  ParseStatus,
  SourceKind,
  TransferLink,
  TxnKind,
  TxnStatus,
} from '../core/types';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export const sourceEvents = sqliteTable(
  'source_events',
  {
    id: text('id').primaryKey(),
    sourceKind: text('source_kind').$type<SourceKind>().notNull(),
    externalId: text('external_id').notNull(),
    sender: text('sender').notNull(),
    /** Raw text; NULL after "Discard raw messages" or for gated-out (ignored) SMS. */
    body: text('body'),
    fingerprint: text('fingerprint').notNull(),
    receivedAt: integer('received_at').notNull(),
    parserId: text('parser_id'),
    parserVersion: integer('parser_version'),
    parseStatus: text('parse_status').$type<ParseStatus>().notNull(),
    /** JSON-encoded ParsedEvent, or NULL. */
    parsedJson: text('parsed_json'),
  },
  t => [
    uniqueIndex('source_events_fingerprint_uq').on(t.fingerprint),
    index('source_events_received_at_idx').on(t.receivedAt),
    index('source_events_status_idx').on(t.parseStatus),
  ],
);

/** User edits to an account (rename, ownership, includeInTotal, aliases…). JSON Partial<Account>. */
export const accountEdits = sqliteTable('account_edits', {
  accountId: text('account_id').primaryKey(),
  patchJson: text('patch_json').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const categoryRules = sqliteTable(
  'category_rules',
  {
    id: text('id').primaryKey(),
    pattern: text('pattern').notNull(),
    field: text('field').$type<CategoryRule['field']>().notNull(),
    categoryId: text('category_id').notNull(),
    priority: integer('priority').notNull(),
    source: text('source').$type<CategoryRule['source']>().notNull(),
  },
  t => [index('category_rules_priority_idx').on(t.priority)],
);

/** Keyed by Transaction.stableKey; replayed on every rebuild. JSON UserOverride minus the key. */
export const userOverrides = sqliteTable('user_overrides', {
  stableKey: text('stable_key').primaryKey(),
  patchJson: text('patch_json').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// ---------------------------------------------------------------------------
// Derived
// ---------------------------------------------------------------------------

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  bank: text('bank').notNull(),
  type: text('type').$type<AccountType>().notNull(),
  ownership: text('ownership').$type<Ownership>().notNull(),
  coHolder: text('co_holder'),
  mask: text('mask').notNull(),
  displayName: text('display_name').notNull(),
  /** JSON string[] */
  upiIdsJson: text('upi_ids_json').notNull(),
  /** JSON string[] */
  aliasesJson: text('aliases_json').notNull(),
  includeInTotal: integer('include_in_total', { mode: 'boolean' }).notNull(),
  /** Insertion order from buildLedger, so loadLedger returns accounts in the same order. */
  ord: integer('ord').notNull(),
});

export const transactions = sqliteTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    stableKey: text('stable_key').notNull(),
    accountId: text('account_id').notNull(),
    amountPaise: integer('amount_paise').notNull(),
    direction: text('direction').$type<Direction>().notNull(),
    occurredAt: integer('occurred_at').notNull(),
    status: text('status').$type<TxnStatus>().notNull(),
    kind: text('kind').$type<TxnKind>().notNull(),
    counterparty: text('counterparty'),
    vpa: text('vpa'),
    categoryId: text('category_id').notNull(),
    confidence: integer('confidence').notNull(),
    ruleProvenance: text('rule_provenance').notNull(),
    needsReview: integer('needs_review', { mode: 'boolean' }).notNull(),
    refUpi: text('ref_upi'),
    refUtr: text('ref_utr'),
    refOther: text('ref_other'),
    mergeReason: text('merge_reason'),
    linkedTxnId: text('linked_txn_id'),
    parserId: text('parser_id').notNull(),
    ord: integer('ord').notNull(),
  },
  t => [
    // Not UNIQUE on purpose: a ledger-engine bug must not make the whole rebuild fail to persist.
    index('transactions_stable_key_idx').on(t.stableKey),
    index('transactions_account_time_idx').on(t.accountId, t.occurredAt),
    index('transactions_occurred_at_idx').on(t.occurredAt),
    index('transactions_review_idx').on(t.needsReview),
    index('transactions_ref_upi_idx').on(t.refUpi),
    index('transactions_ref_utr_idx').on(t.refUtr),
  ],
);

/** Transaction.sourceIds, normalised for the evidence screen (txn → SMS). */
export const transactionSources = sqliteTable(
  'transaction_sources',
  {
    txnId: text('txn_id').notNull(),
    sourceId: text('source_id').notNull(),
    position: integer('position').notNull(),
  },
  t => [primaryKey({ columns: [t.txnId, t.sourceId] }), index('transaction_sources_source_idx').on(t.sourceId)],
);

export const transferLinks = sqliteTable(
  'transfer_links',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    debitTxnId: text('debit_txn_id').notNull(),
    creditTxnId: text('credit_txn_id'),
    method: text('method').$type<TransferLink['method']>().notNull(),
    state: text('state').$type<TransferLink['state']>().notNull(),
    confidence: integer('confidence').notNull(),
  },
  t => [index('transfer_links_debit_idx').on(t.debitTxnId), index('transfer_links_credit_idx').on(t.creditTxnId)],
);

export const balanceSnapshots = sqliteTable(
  'balance_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: text('account_id').notNull(),
    at: integer('at').notNull(),
    reportedPaise: integer('reported_paise').notNull(),
    sourceEventId: text('source_event_id').notNull(),
  },
  t => [index('balance_snapshots_account_at_idx').on(t.accountId, t.at)],
);
