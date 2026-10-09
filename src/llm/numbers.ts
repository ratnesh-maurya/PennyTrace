/**
 * "Every number the model writes must be one we gave it." Pure.
 *
 * Numbers are compared in a canonical form: grouping commas removed, trailing
 * decimal zeros removed (`₹49,460.00` → `49460`, `1.20` → `1.2`). For each
 * amount we allow the forms a writer would reasonably print: whole rupees
 * (rounded), exact rupees with paise, and compact k / lakh / crore.
 */
import type { DayKey, Paise } from '../core/types';

const NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g;

export function canonicalNumber(token: string): string {
  let s = token.replace(/,/g, '');
  if (s.includes('.')) {
    s = s.replace(/0+$/, '').replace(/\.$/, '');
  }
  s = s.replace(/^0+(?=\d)/, '');
  return s;
}

/** Every number token in the text, canonicalised. */
export function numbersIn(text: string): string[] {
  return (text.match(NUMBER_RE) ?? []).map(canonicalNumber);
}

export class AllowedNumbers {
  private readonly set = new Set<string>();

  addAmount(paise: Paise): this {
    const abs = Math.abs(paise);
    const rupees = abs / 100;
    this.add(String(Math.round(rupees)));
    this.add(rupees.toFixed(2));
    if (rupees >= 1000) {
      this.add((rupees / 1000).toFixed(1));
      this.add(String(Math.round(rupees / 1000)));
    }
    if (rupees >= 100000) {
      this.add((rupees / 100000).toFixed(1));
      this.add((rupees / 100000).toFixed(2));
    }
    if (rupees >= 10000000) {
      this.add((rupees / 10000000).toFixed(1));
      this.add((rupees / 10000000).toFixed(2));
    }
    return this;
  }

  addCount(n: number): this {
    this.add(String(n));
    return this;
  }

  /** Allow the parts of a date (`2026-10-09` → 2026, 10, 9). */
  addDay(day: DayKey): this {
    for (const part of day.split('-')) {
      this.add(part);
    }
    return this;
  }

  add(token: string): this {
    this.set.add(canonicalNumber(token));
    return this;
  }

  has(token: string): boolean {
    return this.set.has(canonicalNumber(token));
  }

  /** True when every number in `text` is allowed. */
  allows(text: string): boolean {
    return numbersIn(text).every(n => this.set.has(n));
  }
}

/** Basic sanity for model prose before we show it. */
export function isPlainSentence(text: string, maxLen: number): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= maxLen && !/[<>{}`]/.test(t);
}
