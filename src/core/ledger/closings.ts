import type { ClosingBalance, DayKey, Paise } from '../types';

/** Sets (or, with `closing` undefined, removes) the entry for `day`; one entry per day, sorted by day. */
export function withClosing(
  list: readonly ClosingBalance[] | undefined,
  day: DayKey,
  closing: Paise | undefined,
): ClosingBalance[] {
  const rest = (list ?? []).filter(c => c.day !== day);
  const next = closing === undefined ? rest : [...rest, { day, closing }];
  return next.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}
