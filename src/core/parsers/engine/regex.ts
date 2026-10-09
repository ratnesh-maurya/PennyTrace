// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
//
// Small helpers that give JavaScript regexes the semantics of Kotlin's `Regex`
// API, so ported parser code reads almost line for line like the original.
//
// Porting rules (Kotlin → TS):
// - `Regex("…", IGNORE_CASE)`      → a literal `/…/i` (never with the `g` flag).
// - `re.find(s)`                    → `find(re, s)`
// - `re.findAll(s)`                 → `findAll(re, s)`
// - `re.containsMatchIn(s)`         → `test(re, s)`
// - `s.matches(re)` / `matchEntire` → `matches(re, s)` / `matchEntire(re, s)`
// - `s.replace(re, "x")`            → `replaceAll(s, re, 'x')` (Kotlin replaces ALL matches)
// - `match.groupValues[n]`          → `gv(match, n)` ("" when the group did not participate)

/** Kotlin `Regex.find`. Never mutates `re` (works with or without the g flag). */
export function find(re: RegExp, s: string, startIndex = 0): RegExpExecArray | null {
  const r = new RegExp(re.source, re.flags.replace(/[gy]/g, '') + 'g');
  r.lastIndex = startIndex;
  return r.exec(s);
}

/** Kotlin `Regex.findAll`. */
export function findAll(re: RegExp, s: string): RegExpExecArray[] {
  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
  return Array.from(s.matchAll(new RegExp(re.source, flags)));
}

/** Kotlin `Regex.containsMatchIn` / `String.contains(Regex)`. */
export function test(re: RegExp, s: string): boolean {
  return find(re, s) !== null;
}

/** Kotlin `Regex.matchEntire`: the whole string must match. */
export function matchEntire(re: RegExp, s: string): RegExpExecArray | null {
  const r = new RegExp(`^(?:${re.source})$`, re.flags.replace(/[gy]/g, ''));
  return r.exec(s);
}

/** Kotlin `String.matches(Regex)`. */
export function matches(re: RegExp, s: string): boolean {
  return matchEntire(re, s) !== null;
}

/** Kotlin `String.replace(Regex, String)` — replaces every match. */
export function replaceAll(s: string, re: RegExp, replacement: string): string {
  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
  return s.replace(new RegExp(re.source, flags), replacement);
}

/** Kotlin `match.groupValues[n]`: empty string for a non-participating group. */
export function gv(m: RegExpExecArray | RegExpMatchArray | null | undefined, n: number): string {
  return (m && m[n]) ?? '';
}

/** Kotlin `Regex.escape` for use inside a pattern string. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** Build a regex from a source string (for patterns that interpolate values). */
export function rx(source: string, flags = ''): RegExp {
  return new RegExp(source, flags.replace(/[gy]/g, ''));
}

/** Kotlin `Char.isLetter()` (Latin + common Unicode letters; no \p{} for Hermes safety). */
export function isLetter(c: string): boolean {
  return c.toLowerCase() !== c.toUpperCase();
}

/** Kotlin `Char.isDigit()`. */
export function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}

/** Kotlin `String.any { it.isLetter() }`. */
export function hasLetter(s: string): boolean {
  for (const c of s) {
    if (isLetter(c)) {
      return true;
    }
  }
  return false;
}

/** Kotlin `String.all { it.isDigit() }` (true for the empty string, like Kotlin). */
export function allDigits(s: string): boolean {
  for (const c of s) {
    if (!isDigit(c)) {
      return false;
    }
  }
  return true;
}

/** Kotlin `String.filter { it.isDigit() }`. */
export function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

/** Kotlin `String.takeLast(n)`. */
export function takeLast(s: string, n: number): string {
  return n <= 0 ? '' : s.slice(-n);
}

/** Kotlin `String.capitalize`-style title case of each word (`"ACME CORP"` → `"Acme Corp"`). */
export function titleCaseWords(s: string): string {
  return s
    .toLowerCase()
    .split(' ')
    .map(w => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * `java.text.Normalizer.normalize(s, NFKC)`. Some banks (SBI Card) send text in
 * Unicode "mathematical sans-serif" letters; NFKC folds them back to ASCII.
 */
export function normalizeNfkc(s: string): string {
  try {
    return typeof s.normalize === 'function' ? s.normalize('NFKC') : s;
  } catch {
    return s;
  }
}
