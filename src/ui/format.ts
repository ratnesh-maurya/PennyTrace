import { formatINR } from '../core/money';
import type { DayKey, EpochMs, Paise } from '../core/types';

/**
 * Display formatting for screens. Money goes through `src/core/money.ts`
 * (en-IN grouping, ₹, U+2212 minus); this file adds dates and compact labels.
 * Formatting is done by hand (not Intl date APIs) so output is identical on
 * Hermes and in Jest.
 */

export const MINUS = '−';

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

/** Device-local `YYYY-MM-DD`. */
export function dayKeyOf(ms: EpochMs): DayKey {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseDayKey(key: DayKey): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: DayKey, n: number): DayKey {
  const d = parseDayKey(key);
  d.setDate(d.getDate() + n);
  return dayKeyOf(d.getTime());
}

/** `Thursday, 9 October` */
export function formatDayLong(key: DayKey): string {
  const d = parseDayKey(key);
  return `${DOW_LONG[d.getDay()]}, ${d.getDate()} ${MONTH_LONG[d.getMonth()]}`;
}

/** `Thu 9 Oct` */
export function formatDayShort(key: DayKey): string {
  const d = parseDayKey(key);
  return `${DOW_SHORT[d.getDay()]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
}

/** `9 Oct` */
export function formatDayMonth(key: DayKey): string {
  const d = parseDayKey(key);
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
}

/** `Thu` */
export function formatDow(key: DayKey): string {
  return DOW_SHORT[parseDayKey(key).getDay()];
}

export function dayOfMonth(key: DayKey): number {
  return parseDayKey(key).getDate();
}

/** `3–9 Oct`, or `28 Sep–4 Oct` across months. */
export function formatDayRange(from: DayKey, to: DayKey): string {
  const a = parseDayKey(from);
  const b = parseDayKey(to);
  if (a.getMonth() === b.getMonth()) {
    return `${a.getDate()}–${b.getDate()} ${MONTH_SHORT[b.getMonth()]}`;
  }
  return `${a.getDate()} ${MONTH_SHORT[a.getMonth()]}–${b.getDate()} ${MONTH_SHORT[b.getMonth()]}`;
}

/** `7:41 PM` */
export function formatTime(ms: EpochMs): string {
  const d = new Date(ms);
  const h = d.getHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad2(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
}

/** `7:41 PM` on `today`, `Yesterday 7:41 PM`, else `Tue 7 Oct · 7:41 PM`. */
export function formatRelativeTime(ms: EpochMs, today: DayKey): string {
  const key = dayKeyOf(ms);
  if (key === today) {
    return formatTime(ms);
  }
  if (key === addDays(today, -1)) {
    return `Yesterday ${formatTime(ms)}`;
  }
  return `${formatDayShort(key)} · ${formatTime(ms)}`;
}

/** `today 2:05 PM` / `yesterday 7:48 PM` / `7 Oct 7:48 PM` (lower-case, mid-sentence). */
export function formatRelativeInline(ms: EpochMs, today: DayKey): string {
  const key = dayKeyOf(ms);
  if (key === today) {
    return `today ${formatTime(ms)}`;
  }
  if (key === addDays(today, -1)) {
    return `yesterday ${formatTime(ms)}`;
  }
  return `${formatDayMonth(key)} ${formatTime(ms)}`;
}

/** `+₹4,000` / `−₹2,000` / `₹0`. */
export function formatSignedINR(value: Paise): string {
  return value === 0 ? formatINR(0) : formatINR(value, { signed: true });
}

/** Bar value labels in the design: `1.3k`, `940`, `—` for zero (no ₹). */
export function formatBarValue(value: Paise): string {
  const rupees = Math.round(value / 100);
  if (rupees >= 1000) {
    return `${(rupees / 1000).toFixed(1)}k`;
  }
  return rupees ? String(rupees) : '—';
}

/** Donut centre: `₹14.9k`. */
export function formatINRShort(value: Paise): string {
  const rupees = Math.round(value / 100);
  return rupees >= 1000 ? `₹${(rupees / 1000).toFixed(1)}k` : `₹${rupees}`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
