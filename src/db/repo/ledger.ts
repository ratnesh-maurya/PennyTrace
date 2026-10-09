/**
 * Derived tables (accounts, transactions, transaction_sources, transfer_links,
 * balance_snapshots). They are replaced wholesale from a freshly built Ledger;
 * never edit them directly — write inputs (overrides, rules, account edits)
 * and rebuild.
 */
import { asc } from 'drizzle-orm';
import type { Account, BalanceSnapshot, Ledger, LedgerInput, Transaction, TransferLink } from '../../core/types';
import { getDb, runAtomic, type SqlStatement } from '../client';
import { accounts, balanceSnapshots, transactions, transactionSources, transferLinks } from '../schema';
import { listAccountEdits } from './accountEdits';
import { getSettings } from './meta';
import { listOverrides } from './overrides';
import { listRules } from './rules';
import * as sourceEventsRepo from './sourceEvents';
import { chunk, orUndefined, parseJson, stmt } from './util';

/**
 * Statements that replace all derived rows with `ledger`. Run them through
 * `runAtomic` (optionally with extra meta updates) so readers never observe a
 * half-written ledger.
 */
export async function replaceDerivedStatements(ledger: Ledger): Promise<SqlStatement[]> {
  const { db } = await getDb();
  const out: SqlStatement[] = [
    stmt(db.delete(transactionSources)),
    stmt(db.delete(transferLinks)),
    stmt(db.delete(balanceSnapshots)),
    stmt(db.delete(transactions)),
    stmt(db.delete(accounts)),
  ];

  const accountRows = ledger.accounts.map((a, ord) => ({
    id: a.id,
    bank: a.bank,
    type: a.type,
    ownership: a.ownership,
    coHolder: a.coHolder ?? null,
    mask: a.mask,
    displayName: a.displayName,
    upiIdsJson: JSON.stringify(a.upiIds),
    aliasesJson: JSON.stringify(a.aliases),
    includeInTotal: a.includeInTotal,
    ord,
  }));
  for (const part of chunk(accountRows)) {
    out.push(stmt(db.insert(accounts).values(part)));
  }

  const txnRows = ledger.transactions.map((t, ord) => ({
    id: t.id,
    stableKey: t.stableKey,
    accountId: t.accountId,
    amountPaise: t.amount,
    direction: t.direction,
    occurredAt: t.occurredAt,
    status: t.status,
    kind: t.kind,
    counterparty: t.counterparty ?? null,
    vpa: t.vpa ?? null,
    categoryId: t.categoryId,
    confidence: t.confidence,
    ruleProvenance: t.ruleProvenance,
    needsReview: t.needsReview,
    refUpi: t.refs.upi ?? null,
    refUtr: t.refs.utr ?? null,
    refOther: t.refs.other ?? null,
    mergeReason: t.mergeReason ?? null,
    linkedTxnId: t.linkedTxnId ?? null,
    parserId: t.parserId,
    ord,
  }));
  for (const part of chunk(txnRows)) {
    out.push(stmt(db.insert(transactions).values(part)));
  }

  const sourceRows = ledger.transactions.flatMap(t =>
    // De-duplicate within a transaction: (txn_id, source_id) is the primary key.
    [...new Set(t.sourceIds)].map((sourceId, position) => ({ txnId: t.id, sourceId, position })),
  );
  for (const part of chunk(sourceRows)) {
    out.push(stmt(db.insert(transactionSources).values(part)));
  }

  const linkRows = ledger.transferLinks.map(l => ({
    debitTxnId: l.debitTxnId,
    creditTxnId: l.creditTxnId ?? null,
    method: l.method,
    state: l.state,
    confidence: l.confidence,
  }));
  for (const part of chunk(linkRows)) {
    out.push(stmt(db.insert(transferLinks).values(part)));
  }

  const snapRows = ledger.snapshots.map(s => ({
    accountId: s.accountId,
    at: s.at,
    reportedPaise: s.reported,
    sourceEventId: s.sourceId,
  }));
  for (const part of chunk(snapRows)) {
    out.push(stmt(db.insert(balanceSnapshots).values(part)));
  }
  return out;
}

/** Atomically replaces the derived tables with `ledger`. */
export async function replaceDerived(ledger: Ledger): Promise<void> {
  await runAtomic(await replaceDerivedStatements(ledger));
}

export async function loadAccounts(): Promise<Account[]> {
  const { db } = await getDb();
  const rows = await db.select().from(accounts).orderBy(asc(accounts.ord));
  return rows.map(r => ({
    id: r.id,
    bank: r.bank,
    type: r.type,
    ownership: r.ownership,
    ...(r.coHolder != null ? { coHolder: r.coHolder } : {}),
    mask: r.mask,
    displayName: r.displayName,
    upiIds: parseJson<string[]>(r.upiIdsJson, []),
    aliases: parseJson<string[]>(r.aliasesJson, []),
    includeInTotal: r.includeInTotal,
  }));
}

export async function loadTransactions(): Promise<Transaction[]> {
  const { db } = await getDb();
  const [rows, links] = await Promise.all([
    db.select().from(transactions).orderBy(asc(transactions.ord)),
    db.select().from(transactionSources).orderBy(asc(transactionSources.txnId), asc(transactionSources.position)),
  ]);
  const sourcesByTxn = new Map<string, string[]>();
  for (const l of links) {
    const list = sourcesByTxn.get(l.txnId);
    if (list) {
      list.push(l.sourceId);
    } else {
      sourcesByTxn.set(l.txnId, [l.sourceId]);
    }
  }
  return rows.map(r => {
    const t: Transaction = {
      id: r.id,
      stableKey: r.stableKey,
      accountId: r.accountId,
      amount: r.amountPaise,
      direction: r.direction,
      occurredAt: r.occurredAt,
      status: r.status,
      kind: r.kind,
      categoryId: r.categoryId,
      confidence: r.confidence,
      ruleProvenance: r.ruleProvenance,
      needsReview: r.needsReview,
      refs: {
        ...(r.refUpi != null ? { upi: r.refUpi } : {}),
        ...(r.refUtr != null ? { utr: r.refUtr } : {}),
        ...(r.refOther != null ? { other: r.refOther } : {}),
      },
      sourceIds: sourcesByTxn.get(r.id) ?? [],
      parserId: r.parserId,
    };
    const counterparty = orUndefined(r.counterparty);
    const vpa = orUndefined(r.vpa);
    const mergeReason = orUndefined(r.mergeReason);
    const linkedTxnId = orUndefined(r.linkedTxnId);
    if (counterparty !== undefined) {
      t.counterparty = counterparty;
    }
    if (vpa !== undefined) {
      t.vpa = vpa;
    }
    if (mergeReason !== undefined) {
      t.mergeReason = mergeReason;
    }
    if (linkedTxnId !== undefined) {
      t.linkedTxnId = linkedTxnId;
    }
    return t;
  });
}

export async function loadTransferLinks(): Promise<TransferLink[]> {
  const { db } = await getDb();
  const rows = await db.select().from(transferLinks).orderBy(asc(transferLinks.id));
  return rows.map(r => ({
    debitTxnId: r.debitTxnId,
    ...(r.creditTxnId != null ? { creditTxnId: r.creditTxnId } : {}),
    method: r.method,
    state: r.state,
    confidence: r.confidence,
  }));
}

export async function loadSnapshots(): Promise<BalanceSnapshot[]> {
  const { db } = await getDb();
  const rows = await db.select().from(balanceSnapshots).orderBy(asc(balanceSnapshots.id));
  return rows.map(r => ({ accountId: r.accountId, at: r.at, reported: r.reportedPaise, sourceId: r.sourceEventId }));
}

/** The persisted derived ledger, in the order buildLedger produced it. */
export async function loadLedger(): Promise<Ledger> {
  const [accountList, txns, links, snapshots] = await Promise.all([
    loadAccounts(),
    loadTransactions(),
    loadTransferLinks(),
    loadSnapshots(),
  ]);
  return { accounts: accountList, transactions: txns, transferLinks: links, snapshots };
}

/** Everything buildLedger needs, read from the input tables. */
export async function loadLedgerInput(): Promise<LedgerInput> {
  const [sources, accountEditList, rules, overrides, settings] = await Promise.all([
    sourceEventsRepo.all(),
    listAccountEdits(),
    listRules(),
    listOverrides(),
    getSettings(),
  ]);
  return {
    sources,
    accountEdits: accountEditList,
    rules,
    overrides,
    selfIdentities: settings.selfIdentities,
  };
}
