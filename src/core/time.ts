/**
 * Device-local day handling.
 *
 * A `DayKey` is `YYYY-MM-DD` in the device's local time zone. All arithmetic on
 * DayKeys is done on the calendar (UTC midnight of that date), so adding days
 * never drifts across DST changes. Converting between epoch ms and DayKeys uses
 * the time-zone offset in effect at that instant.
 *
 * Tests pin the zone with `setTimeZoneOffset(fixedOffset(330))` (IST) so they do
 * not depend on the machine running them.
 */
import type { DayKey, EpochMs } from './types';

/** Minutes east of UTC in effect at `ms` (IST → 330). */
export type TzOffsetFn = (ms: EpochMs) => number;

const MS_MINUTE = 60_000;
export const MS_HOUR = 3_600_000;
export const MS_DAY = 86_400_000;

const deviceOffset: TzOffsetFn = ms => -new Date(ms).getTimezoneOffset();
let currentOffset: TzOffsetFn = deviceOffset;

/** Override the zone used by every helper (tests). `undefined` restores the device zone. */
export function setTimeZoneOffset(fn?: TzOffsetFn): void {
  currentOffset = fn ?? deviceOffset;
}

export function fixedOffset(minutes: number): TzOffsetFn {
  return () => minutes;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatUtcDate(d: Date): DayKey {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDayKey(value: string): boolean {
  return DAY_RE.test(value);
}

/** UTC midnight of the calendar date named by `day`. */
function calendarMs(day: DayKey): number {
  const m = DAY_RE.exec(day);
  if (!m) {
    throw new Error(`Invalid DayKey: ${day}`);
  }
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Local calendar day containing `ms`. */
export function dayKey(ms: EpochMs, tz: TzOffsetFn = currentOffset): DayKey {
  return formatUtcDate(new Date(ms + tz(ms) * MS_MINUTE));
}

/** First millisecond of `day` in local time. */
export function startOfDay(day: DayKey, tz: TzOffsetFn = currentOffset): EpochMs {
  const midnight = calendarMs(day);
  // The offset may differ between UTC midnight and local midnight (DST); one refinement settles it.
  const guess = midnight - tz(midnight) * MS_MINUTE;
  return midnight - tz(guess) * MS_MINUTE;
}

/** Last millisecond of `day` in local time. */
export function endOfDay(day: DayKey, tz: TzOffsetFn = currentOffset): EpochMs {
  return startOfDay(addDays(day, 1), tz) - 1;
}

export function addDays(day: DayKey, n: number): DayKey {
  return formatUtcDate(new Date(calendarMs(day) + n * MS_DAY));
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: DayKey, to: DayKey): number {
  return Math.round((calendarMs(to) - calendarMs(from)) / MS_DAY);
}

/** Inclusive list of days, oldest first. Empty when `to` < `from`. */
export function dayRange(from: DayKey, to: DayKey): DayKey[] {
  const n = daysBetween(from, to);
  const out: DayKey[] = [];
  for (let i = 0; i <= n; i++) {
    out.push(addDays(from, i));
  }
  return out;
}

/** `Mon`, `Tue`, … */
export function weekdayShort(day: DayKey): string {
  return WEEKDAYS[new Date(calendarMs(day)).getUTCDay()];
}

/** `Sep 15`. */
export function monthDayLabel(day: DayKey): string {
  const d = new Date(calendarMs(day));
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Today's DayKey for `now`. */
export function today(now: EpochMs = Date.now(), tz: TzOffsetFn = currentOffset): DayKey {
  return dayKey(now, tz);
}
