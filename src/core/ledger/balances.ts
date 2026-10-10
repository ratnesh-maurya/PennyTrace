/**
 * Per-account balance timeline: the shared engine behind daily close,
 * reconciliation and position.
 *
 * Every balance-moving transaction is a signed delta on a total order
 * (occurredAt, id). A snapshot printed in a transaction alert sits right after
 * that transaction; a balance-only alert sits after everything at its instant.
 *
 * Anchoring ("calculated" balances):
 * - At a point P, use the latest snapshot strictly before P and walk forward.
 * - With no earlier snapshot, use the earliest later snapshot and walk backward.
 * - With no snapshot at all, assume 0 before the first transaction (estimated).
 * A snapshot never anchors its own comparison, so a missed SMS shows up as a
 * variance at the next snapshot instead of being silently absorbed. Nothing here
 * invents transactions.
 */
import type { Account, AccountId, BalanceSnapshot, EpochMs, Ledger, Paise, Transaction } from '../types';
import { isVoid } from './draft';
import { cmpNum, cmpStr, signed } from './util';

/** Position on the account's timeline. */
export type Key = readonly [EpochMs, string, number];

export function cmpKey(a: Key, b: Key): number {
  return cmpNum(a[0], b[0]) || cmpStr(a[1], b[1]) || cmpNum(a[2], b[2]);
}

const AFTER_ALL = '￿';

/** Key just before anything at `ms` (day boundaries). */
export function keyBefore(ms: EpochMs): Key {
  return [ms, '', -1];
}

export interface PlacedSnapshot {
  key: Key;
  snap: BalanceSnapshot;
}

export interface Timeline {
  account: Account;
  /** Balance-moving transactions in order. */
  txns: Transaction[];
  keys: Key[];
  /** prefix[i] = sum of deltas of txns[0..i-1]. */
  prefix: Paise[];
  snapshots: PlacedSnapshot[];
}

export function txnKey(t: Transaction): Key {
  return [t.occurredAt, t.id, 0];
}

/** Does this transaction move money on its account? (failed / self-reversed do not) */
export function movesMoney(t: Transaction): boolean {
  return !isVoid(t);
}

const cache = new WeakMap<Ledger, Map<AccountId, Timeline>>();

export function timelines(ledger: Ledger): Map<AccountId, Timeline> {
  let map = cache.get(ledger);
  if (map) {
    return map;
  }
  map = new Map();
  const txnBySource = new Map<string, Transaction>();
  for (const t of ledger.transactions) {
    for (const s of t.sourceIds) {
      txnBySource.set(s, t);
    }
  }
  for (const account of ledger.accounts) {
    const txns = ledger.transactions
      .filter(t => t.accountId === account.id && movesMoney(t))
      .sort((a, b) => cmpKey(txnKey(a), txnKey(b)));
    const keys = txns.map(txnKey);
    const prefix: Paise[] = [0];
    for (const t of txns) {
      prefix.push(prefix[prefix.length - 1] + signed(t.amount, t.direction));
    }
    const snapshots = ledger.snapshots
      .filter(s => s.accountId === account.id)
      .map(snap => {
        const t = txnBySource.get(snap.sourceId);
        const key: Key = t && t.accountId === account.id ? [t.occurredAt, t.id, 1] : [snap.at, AFTER_ALL, 1];
        return { key, snap };
      })
      .sort((a, b) => cmpKey(a.key, b.key) || cmpStr(a.snap.sourceId, b.snap.sourceId));
    map.set(account.id, { account, txns, keys, prefix, snapshots });
  }
  cache.set(ledger, map);
  return map;
}

/** Sum of deltas of transactions strictly before `key`, relative to an unknown start. */
export function relBefore(tl: Timeline, key: Key): Paise {
  let lo = 0;
  let hi = tl.keys.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (cmpKey(tl.keys[mid], key) < 0) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return tl.prefix[lo];
}

export type Anchor = { kind: 'forward' | 'backward'; snapshot: PlacedSnapshot } | { kind: 'none' };

/** Anchor for the balance at `key`: latest snapshot before it, else earliest after it. */
export function anchorFor(tl: Timeline, key: Key): Anchor {
  let before: PlacedSnapshot | undefined;
  for (const s of tl.snapshots) {
    if (cmpKey(s.key, key) < 0) {
      before = s;
    } else {
      break;
    }
  }
  if (before) {
    return { kind: 'forward', snapshot: before };
  }
  const after = tl.snapshots.find(s => cmpKey(s.key, key) >= 0);
  return after ? { kind: 'backward', snapshot: after } : { kind: 'none' };
}

/** Calculated balance just before `key`. */
export function balanceAt(tl: Timeline, key: Key): { balance: Paise; anchor: Anchor } {
  const anchor = anchorFor(tl, key);
  const rel = relBefore(tl, key);
  if (anchor.kind === 'none') {
    return { balance: rel, anchor };
  }
  return { balance: anchor.snapshot.snap.reported + rel - relBefore(tl, anchor.snapshot.key), anchor };
}

/** Balance after everything recorded, anchored on the latest snapshot (bank truth). */
export function currentBalance(tl: Timeline): Paise {
  const end: Key = [Number.MAX_SAFE_INTEGER, AFTER_ALL, 9];
  const last = tl.snapshots[tl.snapshots.length - 1];
  const rel = relBefore(tl, end);
  return last ? last.snap.reported + rel - relBefore(tl, last.key) : rel;
}
