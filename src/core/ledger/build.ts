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
import { setCustomCategories } from '../categories';
import type { BalanceSnapshot, Ledger, LedgerInput, Paise, Transaction, UserOverride } from '../types';
import { resolveAccounts } from './accounts';
import { categorize, compileRules } from './categorize';
import type { ParsedSource } from './dedupe';
import { canonicalSources, groupSources } from './dedupe';
import type { Draft } from './draft';
import { draftFromGroup } from './draft';
import { linkReversalsAndRefunds } from './lifecycle';
import { familyMatcher, inferSelfNames } from './selfNames';
import { classify, SelfMatcher } from './transfers';
import { addDays, startOfDay } from '../time';
import { movesMoney } from './balances';
import { cleanCounterparty, cmpNum, cmpStr, hashId, primaryRef, signed } from './util';

/** Bump when derivation semantics change so stored ledgers are rebuilt. */
export const LEDGER_VERSION = 4;

/** Uncertain categories older than this (before the newest transaction) are not asked about. */
const REVIEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

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
  setCustomCategories(input.customCategories ?? []);
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

  // The user's own name, learned from reference-matched moves between their accounts.
  const selfNames = [...new Set([...input.selfIdentities, ...inferSelfNames(drafts, resolver)])];
  const self = new SelfMatcher(resolver.accounts, selfNames);
  const isFamily = familyMatcher(selfNames.filter(n => !n.includes('@')));
  let links = classify(drafts, { resolver, self, userLinks });
  links = linkReversalsAndRefunds(drafts, links);

  const rules = compileRules(input.rules);
  const transactions: Transaction[] = drafts.map(d => {
    const cat = categorize(d, rules, overrides.get(d.stableKey), isFamily);
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

  // Only recent uncertain categories ask for review: years of history would bury the question.
  // Relative to the newest transaction, not the clock, so a rebuild is deterministic.
  const newest = transactions.length ? transactions[transactions.length - 1].occurredAt : 0;
  for (const t of transactions) {
    if (t.needsReview && t.occurredAt < newest - REVIEW_WINDOW_MS) {
      t.needsReview = false;
    }
  }

  // Balance snapshots: every printed balance on a non-card account. A balance in
  // a transaction alert is "after that transaction", so it takes the txn's time.
  const txnBySource = new Map<string, Draft>();
  for (const d of drafts) {
    for (const s of d.sources) {
      txnBySource.set(s.id, d);
    }
  }
  // Credit cards: the balance is −(limit − available). The limit is the user's setting, else the
  // highest available limit printed across several alerts (some of them right after a payment,
  // when the card was close to fully paid). A single reading says nothing about the limit, so the
  // card then keeps its transaction-derived balance.
  const MIN_LIMIT_READINGS = 2;
  const limitReadings = new Map<string, Paise[]>();
  for (const s of [...txnSources, ...balanceSources]) {
    const account = resolver.byId.get(resolver.resolve(s));
    const avl = s.parsed.availableLimit;
    if (account?.type === 'credit_card' && avl !== undefined && account.creditLimit === undefined) {
      limitReadings.set(account.id, [...(limitReadings.get(account.id) ?? []), avl]);
    }
  }
  for (const a of resolver.accounts) {
    const readings = limitReadings.get(a.id) ?? [];
    if (a.type === 'credit_card' && a.creditLimit === undefined && readings.length >= MIN_LIMIT_READINGS) {
      a.creditLimit = Math.max(...readings);
    }
  }

  const snapshots: BalanceSnapshot[] = [];
  const seenSnap = new Set<string>();
  const addSnapshot = (s: ParsedSource, accountId: string, at: number) => {
    const account = resolver.byId.get(accountId);
    if (!account) {
      return;
    }
    let reported: Paise | undefined;
    if (account.type === 'credit_card') {
      const avl = s.parsed.availableLimit;
      reported = avl !== undefined && account.creditLimit !== undefined ? avl - account.creditLimit : undefined;
    } else {
      reported = s.parsed.balance;
    }
    if (reported === undefined) {
      return;
    }
    const key = `${accountId}|${at}|${reported}`;
    if (seenSnap.has(key)) {
      return;
    }
    seenSnap.add(key);
    snapshots.push({ accountId, at, reported, sourceId: s.id });
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
  // Closing balances the user entered for chosen days. Each is stored as the closing of the day
  // before, net of that day's movements, so the day opens from it and closes at exactly the
  // entered figure; later days roll forward from it.
  for (const e of input.accountEdits) {
    const account = e.id ? resolver.byId.get(e.id) : undefined;
    if (!account || account.type === 'credit_card') {
      continue;
    }
    for (const { day, closing } of e.closingBalances ?? []) {
      const dayStart = startOfDay(day);
      const dayEnd = startOfDay(addDays(day, 1));
      const dayNet = transactions
        .filter(t => t.accountId === account.id && t.occurredAt >= dayStart && t.occurredAt < dayEnd && movesMoney(t))
        .reduce((n, t) => n + signed(t.amount, t.direction), 0);
      snapshots.push({
        accountId: account.id,
        at: dayStart - 1,
        reported: closing - dayNet,
        sourceId: `user:${account.id}:${day}`,
      });
    }
  }
  snapshots.sort((a, b) => cmpStr(a.accountId, b.accountId) || cmpNum(a.at, b.at) || cmpStr(a.sourceId, b.sourceId));

  return dropIgnored({ accounts: resolver.accounts, transactions, transferLinks: links, snapshots });
}

/**
 * "Don't count this account": its transactions and balances leave the ledger. This runs after
 * transfer matching, so money moved into an ignored account from a tracked one stays a move
 * (it left the tracked accounts, but it was not spent).
 */
function dropIgnored(ledger: Ledger): Ledger {
  const ignored = new Set(ledger.accounts.filter(a => a.ignored).map(a => a.id));
  if (ignored.size === 0) {
    return ledger;
  }
  const transactions = ledger.transactions.filter(t => !ignored.has(t.accountId));
  const kept = new Set(transactions.map(t => t.id));
  const transferLinks = ledger.transferLinks
    .filter(l => kept.has(l.debitTxnId))
    .map(l => (l.creditTxnId && !kept.has(l.creditTxnId) ? { ...l, creditTxnId: undefined } : l));
  return {
    accounts: ledger.accounts,
    transactions,
    transferLinks,
    snapshots: ledger.snapshots.filter(s => !ignored.has(s.accountId)),
  };
}
