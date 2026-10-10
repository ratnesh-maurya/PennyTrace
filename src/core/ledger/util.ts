/** Small deterministic helpers shared by the ledger stages. */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { Direction, Paise, SourceEvent, TxnRefs } from '../types';

export function hashId(prefix: string, key: string): string {
  return `${prefix}${bytesToHex(sha256(utf8ToBytes(key))).slice(0, 20)}`;
}

/** Plain code-unit comparison (locale-independent, so results never depend on the device). */
export function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function cmpNum(a: number, b: number): number {
  return a - b;
}

export function signed(amount: Paise, direction: Direction): Paise {
  return direction === 'credit' ? amount : -amount;
}

export function normRef(ref: string | undefined): string | undefined {
  const r = ref?.replace(/\s+/g, '').toUpperCase();
  return r ? r : undefined;
}

/** The refs that identify one money movement across alerts (UPI ref / RRN, UTR). */
export function strongRefs(refs: TxnRefs): { type: 'upi' | 'utr'; value: string }[] {
  const out: { type: 'upi' | 'utr'; value: string }[] = [];
  const upi = normRef(refs.upi);
  const utr = normRef(refs.utr);
  if (upi) {
    out.push({ type: 'upi', value: upi });
  }
  if (utr && utr !== upi) {
    out.push({ type: 'utr', value: utr });
  }
  return out;
}

export function primaryRef(refs: TxnRefs): string | undefined {
  return normRef(refs.upi) ?? normRef(refs.utr) ?? normRef(refs.other);
}

export function sharesStrongRef(a: TxnRefs, b: TxnRefs): string | undefined {
  const bs = new Set(strongRefs(b).map(r => r.value));
  return strongRefs(a).find(r => bs.has(r.value))?.value;
}

/** Canonical order of source events: independent of input order. */
export function cmpSource(a: SourceEvent, b: SourceEvent): number {
  return (
    cmpNum(a.parsed?.occurredAt ?? a.receivedAt, b.parsed?.occurredAt ?? b.receivedAt) ||
    cmpNum(a.receivedAt, b.receivedAt) ||
    cmpStr(a.fingerprint, b.fingerprint) ||
    cmpStr(a.id, b.id)
  );
}

const SMALL_WORDS = new Set(['of', 'and', 'the', 'for', 'to', 'by', 'at', 'on', 'in']);
/** Short words that are not acronyms, so they get Title Case. */
const SHORT_WORDS = new Set([
  'pvt',
  'ltd',
  'llp',
  'inc',
  'co',
  'pay',
  'net',
  'mr',
  'mrs',
  'ms',
  'dr',
  'new',
  'one',
  'big',
  'tea',
  'bar',
  'car',
  'gym',
  'spa',
  'sri',
  'shri',
  'smt',
]);

/**
 * Display name for a counterparty: whitespace collapsed, trailing punctuation
 * removed, SHOUTING and all-lowercase turned into Title Case (short acronyms such as
 * `SBI`, `ATM` kept).
 */
export function cleanCounterparty(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  // A UPI handle printed as the name ("MANMATTERS@YESPAY"): the part before "@" names the payee.
  const handle = /^([A-Za-z0-9._-]+)@[A-Za-z0-9.]+$/.exec(raw.trim());
  const s = (handle ? handle[1] : raw).replace(/\s+/g, ' ').replace(/^[\s.,:;\-/]+|[\s.,:;\-/]+$/g, '');
  if (!s) {
    return undefined;
  }
  // All-lowercase names come from UPI handles ("swiggy", "uber"): capitalise each word.
  if (s === s.toLowerCase() && /[a-z]/.test(s)) {
    return s.replace(/\b[a-z]/g, ch => ch.toUpperCase());
  }
  if (s !== s.toUpperCase() || !/[A-Z]/.test(s)) {
    return s;
  }
  return s
    .split(' ')
    .map((w, i) => {
      if (
        w.length <= 3 &&
        /^[A-Z]+$/.test(w) &&
        !SHORT_WORDS.has(w.toLowerCase()) &&
        !(i > 0 && SMALL_WORDS.has(w.toLowerCase()))
      ) {
        return w;
      }
      const lower = w.toLowerCase();
      if (i > 0 && SMALL_WORDS.has(lower)) {
        return lower;
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

const NAME_NOISE = new Set([
  'pvt',
  'private',
  'ltd',
  'limited',
  'llp',
  'inc',
  'india',
  'technologies',
  'technology',
  'tech',
  'services',
  'service',
  'the',
  'www',
  'com',
  'in',
  'co',
  'mr',
  'mrs',
  'ms',
]);

export function nameTokens(s: string | undefined): string[] {
  if (!s) {
    return [];
  }
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 0);
}

function significantTokens(s: string | undefined): string[] {
  return nameTokens(s).filter(t => !NAME_NOISE.has(t));
}

/** Loose "same merchant" test for refund linking: `SWIGGY` ~ `Swiggy Instamart`. */
export function sameCounterparty(a: string | undefined, b: string | undefined): boolean {
  const ta = significantTokens(a);
  const tb = significantTokens(b);
  if (ta.length === 0 || tb.length === 0) {
    return false;
  }
  if (ta[0] === tb[0] && ta[0].length >= 3) {
    return true;
  }
  const ja = ta.join('');
  const jb = tb.join('');
  return ja.length >= 4 && jb.length >= 4 && (ja.includes(jb) || jb.includes(ja));
}

/** VPA handle as words: `swiggy.stores@axb` → `swiggy stores`. */
export function vpaHandleWords(vpa: string | undefined): string | undefined {
  if (!vpa) {
    return undefined;
  }
  const handle = vpa.split('@')[0] ?? '';
  const words = handle.replace(/[._\-+]+/g, ' ').trim();
  return words || undefined;
}

export function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(cmpStr);
}
