/**
 * Pure text helpers shared by validation and template learning.
 * No React Native imports: jest-testable.
 */
import type { Paise } from '../core/types';

export interface Span {
  start: number;
  end: number;
}

/** Collapse whitespace runs and trim. */
export function normalizeWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** `1,23,456.00` → `123456.00`. Only removes commas between digits. */
export function stripDigitGrouping(s: string): string {
  return s.replace(/(\d),(?=\d)/g, '$1');
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/**
 * Clean an amount the model printed: drop a currency prefix and spaces.
 * Returns undefined unless what remains looks like `1,234.50`.
 */
export function cleanAmountLiteral(raw: string): string | undefined {
  const s = raw
    .trim()
    .replace(/^(?:rs\.?|inr|₹)\s*/i, '')
    .replace(/\s+/g, '');
  return /^\d[\d,]*(?:\.\d{1,2})?$/.test(s) ? s : undefined;
}

/**
 * Find a number in `body` that is literally `literal`, ignoring digit-grouping
 * commas on either side (`123456` matches `1,23,456`). The match must sit on
 * number boundaries, so `349` never matches inside `1349` or `349.50`;
 * a literal without decimals may be followed by `.00` in the body.
 */
export function findNumberLiteral(body: string, literal: string, from = 0): Span | undefined {
  const plain = stripDigitGrouping(literal.trim());
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(plain);
  if (!m) {
    return undefined;
  }
  const intPart = m[1].split('').join(',?');
  const frac = m[2];
  const core = frac ? `${intPart}\\.${frac}` : intPart;
  const after = frac ? '(?!\\d)' : '(?!\\d|,\\d|\\.\\d*[1-9])';
  const re = new RegExp(`(?<!\\d)(?<!\\d[.,])${core}${after}`, 'g');
  re.lastIndex = from;
  const hit = re.exec(body);
  return hit ? { start: hit.index, end: hit.index + hit[0].length } : undefined;
}

/**
 * Printed forms of an amount in paise that `findNumberLiteral` can locate:
 * `34900` → [`349`] (also finds `349.00`, `349.0`), `34950` → [`349.50`, `349.5`].
 */
export function amountLiterals(paise: Paise): string[] {
  const rupees = Math.floor(paise / 100);
  const frac = paise % 100;
  if (frac === 0) {
    return [String(rupees)];
  }
  const two = `${rupees}.${String(frac).padStart(2, '0')}`;
  return frac % 10 === 0 ? [two, `${rupees}.${frac / 10}`] : [two];
}

/** First occurrence of an amount (any printed form) at or after `from`, not overlapping `taken`. */
export function findAmount(body: string, paise: Paise, taken: Span[] = []): Span | undefined {
  for (const lit of amountLiterals(paise)) {
    let from = 0;
    for (;;) {
      const span = findNumberLiteral(body, lit, from);
      if (!span) {
        break;
      }
      if (!overlapsAny(span, taken)) {
        return extendDecimals(body, span);
      }
      from = span.end;
    }
  }
  return undefined;
}

/** Grow a span over a trailing `.00`-style decimal part. */
function extendDecimals(body: string, span: Span): Span {
  const tail = /^\.\d{1,2}(?!\d)/.exec(body.slice(span.end));
  return tail ? { start: span.start, end: span.end + tail[0].length } : span;
}

/** `last4` digits that end a digit run (`XX1234`, `**1234`, `0011234`). */
export function findLast4(body: string, last4: string, taken: Span[] = []): Span | undefined {
  if (!/^\d{4}$/.test(last4)) {
    return undefined;
  }
  const re = new RegExp(`${last4}(?!\\d)`, 'g');
  for (let hit = re.exec(body); hit; hit = re.exec(body)) {
    const span = { start: hit.index, end: hit.index + 4 };
    if (!overlapsAny(span, taken)) {
      return span;
    }
  }
  return undefined;
}

/** A reference / token that must appear verbatim, as a whole alphanumeric token. */
export function findToken(body: string, token: string, taken: Span[] = [], caseInsensitive = true): Span | undefined {
  const t = token.trim();
  if (!t) {
    return undefined;
  }
  const re = new RegExp(`(?<![A-Za-z0-9])${escapeRegex(t)}(?![A-Za-z0-9])`, caseInsensitive ? 'gi' : 'g');
  for (let hit = re.exec(body); hit; hit = re.exec(body)) {
    const span = { start: hit.index, end: hit.index + hit[0].length };
    if (!overlapsAny(span, taken)) {
      return span;
    }
  }
  return undefined;
}

/** Plain substring search (case-insensitive), whitespace-normalised. */
export function findText(body: string, text: string, taken: Span[] = []): Span | undefined {
  const t = normalizeWs(text);
  if (!t) {
    return undefined;
  }
  const re = new RegExp(escapeRegex(t).replace(/ /g, '\\s+'), 'gi');
  for (let hit = re.exec(body); hit; hit = re.exec(body)) {
    const span = { start: hit.index, end: hit.index + hit[0].length };
    if (!overlapsAny(span, taken)) {
      return span;
    }
  }
  return undefined;
}

export function overlapsAny(span: Span, taken: Span[]): boolean {
  return taken.some(t => span.start < t.end && t.start < span.end);
}
