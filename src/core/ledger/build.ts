/**
 * buildLedger: the whole derivation from evidence to ledger, as one pure function.
 *
 *   sources ─ canonicalSources ─ groupSources (dedupe + lifecycle) ─ drafts
 *          ─ resolveAccounts ─ stable keys / ids ─ overrides (hide, rename, kind)
 *          ─ classify (transfers, card bills, ATM, fees) ─ reversals / refunds
 *          ─ categorize ─ balance snapshots ─ Ledger
 *
 * Deterministic and order-independent: every stage works on canonically sorted
 * input and breaks ties by content-derived ids, never by arrival order.
 */
import type { BalanceSnapshot, Ledger, LedgerInput, Transaction, UserOverride } from '../types';
import { resolveAccounts } from './accounts';
import { categorize, compileRules } from './categorize';
import type { ParsedSource } from './dedupe';
import { canonicalSources, groupSources } from './dedupe';
import type { Draft } from './draft';
import { draftFromGroup } from './draft';
import { linkReversalsAndRefunds } from './lifecycle';
import { classify, SelfMatcher } from './transfers';
import { cleanCounterparty, cmpNum, cmpStr, hashId, primaryRef } from './util';

/** Bump when derivation semantics change so stored ledgers are rebuilt. */
export const LEDGER_VERSION = 1;

function mergeOverrides(overrides: readonly UserOverride[]): Map<string, UserOverride> {
  const map = new Map<string, UserOverride>();
  for (const o of overrides) {
    map.set(o.stableKey, { ...map.get(o.stableKey), ...o });
  }
  return map;
}

function cmpDraft(a: Draft, b: Draft): number {
  return cmpNum(a.occurredAt, b.occurredAt) || cmpStr(a.sources[0].fingerprint, b.sources[0].fingerprint);
}

export function buildLedger(input: LedgerInput): Ledger {
  const sources = canonicalSources(input.sources);
  const txnSources = sources.filter(s => s.parsed.kind === 'transaction' && s.parsed.amount > 0);
  const balanceSources = sources.filter(s => s.parsed.kind === 'balance');

  const groups = groupSources(txnSources);
  const partial = groups.map(draftFromGroup);

  const resolver = resolveAccounts([...partial.map(p => p.accountSource), ...balanceSources], input.accountEdits);

  // Stable keys: account + strongest ref, else fingerprint of the first alert.
  // On a collision (e.g. a reversal reusing the original's UPI ref) the later
  // transaction gets a `|fp:` suffix, so the original's key never changes.
  let drafts: Draft[] = partial
    .map(p => {
      const accountId = resolver.resolve(p.accountSource);
      const ref = primaryRef(p.refs);
      const stableKey = ref ? `${accountId}|ref:${ref}` : `fp:${p.sources[0].fingerprint}`;
      return { ...p, accountId, stableKey, id: '' };
    })
    .sort(cmpDraft);
  const taken = new Set<string>();
  for (const d of drafts) {
    if (taken.has(d.stableKey)) {
      d.stableKey = `${d.stableKey}|fp:${d.sources[0].fingerprint}`;
    }
    taken.add(d.stableKey);
    d.id = hashId('t_', d.stableKey);
  }

  // User overrides: hide, rename, force kind.
  const overrides = mergeOverrides(input.overrides);
  drafts = drafts.filter(d => !overrides.get(d.stableKey)?.hidden);
  const byKey = new Map(drafts.map(d => [d.stableKey, d]));
  for (const d of drafts) {
    const o = overrides.get(d.stableKey);
    if (o?.counterparty?.trim()) {
      d.counterparty = o.counterparty.trim();
    }
    if (o?.kind) {
      d.kind = o.kind;
      d.kindFixed = true;
    }
  }
  const userLinks: [Draft, Draft][] = [];
  for (const d of drafts) {
    const target = overrides.get(d.stableKey)?.linkToStableKey;
    const other = target ? byKey.get(target) : undefined;
    if (other && other !== d) {
      userLinks.push([d, other]);
    }
  }

  const self = new SelfMatcher(resolver.accounts, input.selfIdentities);
  let links = classify(drafts, { resolver, self, userLinks });
  links = linkReversalsAndRefunds(drafts, links);

  const rules = compileRules(input.rules);
  const transactions: Transaction[] = drafts.map(d => {
    const cat = categorize(d, rules, overrides.get(d.stableKey));
    const t: Transaction = {
      id: d.id,
      stableKey: d.stableKey,
      accountId: d.accountId,
      amount: d.amount,
      direction: d.direction,
      occurredAt: d.occurredAt,
      status: d.status,
      kind: d.kind!,
      categoryId: cat.categoryId,
      confidence: cat.confidence,
      ruleProvenance: cat.ruleProvenance,
      needsReview: cat.needsReview,
      refs: d.refs,
      sourceIds: d.sources.map(s => s.id),
      parserId: d.parserId,
    };
    const counterparty = cleanCounterparty(d.counterparty);
    if (counterparty) {
      t.counterparty = counterparty;
    }
    if (d.vpa) {
      t.vpa = d.vpa;
    }
    if (d.mergeReason) {
      t.mergeReason = d.mergeReason;
    }
    if (d.linkedTxnId) {
      t.linkedTxnId = d.linkedTxnId;
    }
    return t;
  });
  transactions.sort((a, b) => cmpNum(a.occurredAt, b.occurredAt) || cmpStr(a.id, b.id));

  // Balance snapshots: every printed balance on a non-card account. A balance in
  // a transaction alert is "after that transaction", so it takes the txn's time.
  const txnBySource = new Map<string, Draft>();
  for (const d of drafts) {
    for (const s of d.sources) {
      txnBySource.set(s.id, d);
    }
  }
  const snapshots: BalanceSnapshot[] = [];
  const seenSnap = new Set<string>();
  const addSnapshot = (s: ParsedSource, accountId: string, at: number) => {
    const account = resolver.byId.get(accountId);
    if (s.parsed.balance === undefined || !account || account.type === 'credit_card') {
      return;
    }
    const key = `${accountId}|${at}|${s.parsed.balance}`;
    if (seenSnap.has(key)) {
      return;
    }
    seenSnap.add(key);
    snapshots.push({ accountId, at, reported: s.parsed.balance, sourceId: s.id });
  };
  for (const s of txnSources) {
    const d = txnBySource.get(s.id);
    // Only the alert that names the account can vouch for its balance.
    if (d && (s === d.accountSource || s.parsed.accountLast4 === d.accountSource.parsed.accountLast4)) {
      addSnapshot(s, d.accountId, d.occurredAt);
    } else if (!d) {
      addSnapshot(s, resolver.resolve(s), s.parsed.occurredAt); // hidden txn: keep its balance
    }
  }
  for (const s of balanceSources) {
    addSnapshot(s, resolver.resolve(s), s.parsed.occurredAt);
  }
  snapshots.sort((a, b) => cmpStr(a.accountId, b.accountId) || cmpNum(a.at, b.at) || cmpStr(a.sourceId, b.sourceId));

  return { accounts: resolver.accounts, transactions, transferLinks: links, snapshots };
}
