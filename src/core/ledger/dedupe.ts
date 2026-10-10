/**
 * Dedupe: decide which alerts describe the same money movement.
 *
 * (a) An identical SMS (same fingerprint) is kept once — ingest already drops it,
 *     and `canonicalSources` drops it again defensively.
 * (b) Same UPI ref / UTR + same amount + same direction + same account (or one
 *     side without an account) → one transaction.
 * (c) Both without refs, same account + amount + direction, ≤ 10 min apart, and
 *     a different sender or a different template (parser id / status) → one
 *     transaction.
 * (d) Same sender + same template + same amount without refs is NEVER merged:
 *     two ₹500 purchases three minutes apart are two purchases.
 *
 * Grouping walks sources in canonical order, so the result never depends on the
 * order the inputs arrived in.
 */
import { formatINR } from '../money';
import { normalizeSender } from '../sms/fingerprint';
import type { ParsedEvent, SourceEvent, TxnStatus } from '../types';
import { cmpNum, cmpSource, cmpStr, strongRefs } from './util';

export const NO_REF_MERGE_WINDOW_MS = 10 * 60_000;

/** A source event that carries a parse result. */
export type ParsedSource = SourceEvent & { parsed: ParsedEvent };

export interface SourceGroup {
  /** Canonical (chronological) order. */
  sources: ParsedSource[];
  /** Best evidence: the alert that wins for account, counterparty and parser id. */
  primary: ParsedSource;
  mergeReason?: string;
}

/**
 * Usable sources in canonical order: parsed only, identical
 * fingerprints collapsed to the earliest-received copy.
 */
export function canonicalSources(sources: readonly SourceEvent[]): ParsedSource[] {
  const byFp = new Map<string, SourceEvent>();
  for (const s of sources) {
    const prev = byFp.get(s.fingerprint);
    if (
      !prev ||
      cmpNum(s.receivedAt, prev.receivedAt) < 0 ||
      (s.receivedAt === prev.receivedAt && cmpStr(s.id, prev.id) < 0)
    ) {
      byFp.set(s.fingerprint, s);
    }
  }
  return [...byFp.values()].filter((s): s is ParsedSource => !!s.parsed && s.parseStatus === 'parsed').sort(cmpSource);
}

function accountsCompatible(a: ParsedEvent, b: ParsedEvent): boolean {
  return !a.accountLast4 || !b.accountLast4 || a.accountLast4 === b.accountLast4;
}

function sameMovement(a: ParsedEvent, b: ParsedEvent): boolean {
  return a.amount === b.amount && a.direction === b.direction && accountsCompatible(a, b);
}

/** Alerts relayed by a UPI app or partner bank rather than the account's own bank. */
const RELAY_RE = /GPAY|GOOGLE|PHONEPE|PAYTM|BHIM|CRED|AMAZONPAY/;

function isRelay(s: ParsedSource): boolean {
  return RELAY_RE.test(normalizeSender(s.sender)) || RELAY_RE.test(s.parsed.parserId.toUpperCase());
}

/** Lower is better. The bank's own alert with a balance wins over a relay copy. */
function primaryRank(s: ParsedSource): number[] {
  const p = s.parsed;
  return [
    p.balance !== undefined ? 0 : 1,
    isRelay(s) ? 1 : 0,
    p.accountLast4 ? 0 : 1,
    p.status === 'success' ? 0 : 1,
    -p.confidence,
  ];
}

function pickPrimary(sources: ParsedSource[]): ParsedSource {
  let best = sources[0];
  let bestRank = primaryRank(best);
  for (const s of sources.slice(1)) {
    const r = primaryRank(s);
    const cmp = r.reduce((acc, v, i) => acc || v - bestRank[i], 0);
    if (cmp < 0) {
      best = s;
      bestRank = r;
    }
  }
  return best;
}

/** pending → success: the last non-pending status wins; all-pending stays pending. */
export function lifecycleStatus(sources: ParsedSource[]): TxnStatus {
  let status: TxnStatus = 'pending';
  for (const s of sources) {
    if (s.parsed.status !== 'pending') {
      status = s.parsed.status;
    }
  }
  return status;
}

function lifecycleSuffix(sources: ParsedSource[]): string {
  const chain: TxnStatus[] = [];
  for (const s of sources) {
    if (chain[chain.length - 1] !== s.parsed.status) {
      chain.push(s.parsed.status);
    }
  }
  return chain.length > 1 ? ` · ${chain.join(' → ')}` : '';
}

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) {
      // Keep the smaller (earlier) index as the root: deterministic.
      if (ra < rb) {
        this.parent[rb] = ra;
      } else {
        this.parent[ra] = rb;
      }
    }
  }
}

function differentTemplate(a: ParsedSource, b: ParsedSource): boolean {
  return (
    normalizeSender(a.sender) !== normalizeSender(b.sender) ||
    a.parsed.parserId !== b.parsed.parserId ||
    a.parsed.status !== b.parsed.status
  );
}

/** The strong ref carried by the most alerts in a group (ties: alphabetical). */
function sharedRef(group: ParsedSource[]): { type: 'upi' | 'utr'; value: string } {
  const counts = new Map<string, { type: 'upi' | 'utr'; value: string; n: number }>();
  for (const s of group) {
    for (const r of strongRefs(s.parsed.refs)) {
      const key = `${r.type}:${r.value}`;
      const c = counts.get(key) ?? { ...r, n: 0 };
      c.n++;
      counts.set(key, c);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1].n - a[1].n || cmpStr(a[0], b[0]))[0][1];
}

/** Group transaction sources (already canonical) into one group per real money movement. */
export function groupSources(sources: readonly ParsedSource[]): SourceGroup[] {
  const n = sources.length;
  const uf = new UnionFind(n);

  // (b) shared strong ref.
  const byRef = new Map<string, number[]>();
  sources.forEach((s, i) => {
    for (const r of strongRefs(s.parsed.refs)) {
      const key = `${r.type}:${r.value}`;
      const list = byRef.get(key) ?? [];
      list.push(i);
      byRef.set(key, list);
    }
  });
  for (const key of [...byRef.keys()].sort(cmpStr)) {
    const idx = byRef.get(key)!;
    for (let x = 0; x < idx.length; x++) {
      for (let y = x + 1; y < idx.length; y++) {
        const a = sources[idx[x]];
        const b = sources[idx[y]];
        if (sameMovement(a.parsed, b.parsed)) {
          uf.union(idx[x], idx[y]);
        }
      }
    }
  }

  const members = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = uf.find(i);
    const list = members.get(r) ?? [];
    list.push(i);
    members.set(r, list);
  }

  // (c) time-window merge for ref-less singletons. Groups are visited in canonical order.
  interface Open {
    idx: number[];
    at: number;
  }
  const refless: Open[] = [];
  const result: { idx: number[]; reason?: 'ref' | 'time'; root: number }[] = [];
  for (const root of [...members.keys()].sort(cmpNum)) {
    const idx = members.get(root)!;
    if (idx.length > 1 || strongRefs(sources[idx[0]].parsed.refs).length > 0) {
      result.push({ idx, reason: idx.length > 1 ? 'ref' : undefined, root });
      continue;
    }
    const s = sources[idx[0]];
    let best: Open | undefined;
    let bestDt = Infinity;
    for (const g of refless) {
      const dt = Math.abs(s.parsed.occurredAt - g.at);
      if (dt > NO_REF_MERGE_WINDOW_MS || dt >= bestDt) {
        continue;
      }
      const ok = g.idx.every(j => sameMovement(sources[j].parsed, s.parsed) && differentTemplate(sources[j], s));
      if (ok) {
        best = g;
        bestDt = dt;
      }
    }
    if (best) {
      best.idx.push(idx[0]);
    } else {
      const g: Open = { idx: [idx[0]], at: s.parsed.occurredAt };
      refless.push(g);
      result.push({ idx: g.idx, root });
    }
  }

  return result.map(({ idx, reason }) => {
    const group = idx
      .slice()
      .sort(cmpNum)
      .map(i => sources[i]);
    const primary = pickPrimary(group);
    let mergeReason: string | undefined;
    if (group.length > 1) {
      if (reason === 'ref') {
        const r = sharedRef(group);
        const label = r.type === 'upi' ? 'UPI ref' : 'UTR';
        mergeReason = `Same ${label} ${r.value.slice(0, 4)}… in ${group.length} alerts`;
      } else {
        const senders = [...new Set(group.map(g => normalizeSender(g.sender)))];
        const span = Math.round((group[group.length - 1].parsed.occurredAt - group[0].parsed.occurredAt) / 60_000);
        const from = senders.length > 1 ? `from ${senders.join(' and ')}` : 'from different templates';
        mergeReason = `Same ${formatINR(primary.parsed.amount, { paise: true })} ${
          primary.parsed.direction
        } ${from}, ${span} min apart`;
      }
      mergeReason += lifecycleSuffix(group);
    }
    return { sources: group, primary, mergeReason };
  });
}
