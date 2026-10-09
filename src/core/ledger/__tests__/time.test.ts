import { addDays, dayKey, dayRange, daysBetween, endOfDay, fixedOffset, monthDayLabel, setTimeZoneOffset, startOfDay, weekdayShort } from '../../time';

describe('time (device-local days)', () => {
  afterEach(() => setTimeZoneOffset());

  it('IST: 00:30 local belongs to the local day even though UTC is the day before', () => {
    setTimeZoneOffset(fixedOffset(330));
    const ms = Date.UTC(2026, 9, 5, 19, 0); // 00:30 IST on 6 Oct
    expect(dayKey(ms)).toBe('2026-10-06');
    expect(startOfDay('2026-10-06')).toBe(Date.UTC(2026, 9, 5, 18, 30));
    expect(endOfDay('2026-10-06')).toBe(Date.UTC(2026, 9, 6, 18, 30) - 1);
    expect(dayKey(startOfDay('2026-10-06'))).toBe('2026-10-06');
    expect(dayKey(endOfDay('2026-10-06'))).toBe('2026-10-06');
    expect(dayKey(endOfDay('2026-10-06') + 1)).toBe('2026-10-07');
  });

  it('explicit offset function argument', () => {
    expect(dayKey(Date.UTC(2026, 0, 1, 2, 0), fixedOffset(-300))).toBe('2025-12-31');
  });

  it('DST-style offset change keeps day boundaries exact', () => {
    const switchAt = Date.UTC(2026, 2, 29, 1, 0);
    const tz = (ms: number) => (ms >= switchAt ? 120 : 60);
    const start = startOfDay('2026-03-30', tz);
    expect(start).toBe(Date.UTC(2026, 2, 29, 22, 0));
    expect(dayKey(start, tz)).toBe('2026-03-30');
    expect(dayKey(start - 1, tz)).toBe('2026-03-29');
  });

  it('calendar arithmetic and labels', () => {
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(daysBetween('2026-10-05', '2026-10-11')).toBe(6);
    expect(dayRange('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(dayRange('2026-10-02', '2026-10-01')).toEqual([]);
    expect(weekdayShort('2026-10-05')).toBe('Mon');
    expect(weekdayShort('2026-10-11')).toBe('Sun');
    expect(monthDayLabel('2026-09-15')).toBe('Sep 15');
    expect(() => addDays('2026-9-1', 1)).toThrow('Invalid DayKey');
  });
});
