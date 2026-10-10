import React, { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { DayKey, Paise } from '../../core/types';
import type { WeekStripDay } from '../../app/data/types';
import { dayOfMonth, formatDayLong, formatDow } from '../../ui/format';
import { HeroSurface, Text } from '../../ui/primitives';
import { ON_HERO, useTheme, useThemedStyles, type Colors, type Theme } from '../../ui/theme';

/** Spend-intensity dot (design: > ₹2,600 out, > ₹1,500 warn, else pos). */
export function spendDotColor(spent: Paise, c: Colors): string {
  return spent > 260000 ? c.out : spent > 150000 ? c.warn : c.pos;
}

interface WeekStripProps {
  days: readonly WeekStripDay[];
  selected: DayKey;
  onSelect: (day: DayKey) => void;
}

/** Seven-day picker; the selected day sits on the hero gradient. */
export const WeekStrip = memo(function WeekStrip({ days, selected, onSelect }: WeekStripProps) {
  const s = useThemedStyles(makeStyles);
  const { c } = useTheme();
  return (
    <View style={s.strip} testID="week-strip">
      {days.map(d => {
        const active = d.day === selected;
        const ink = active ? ON_HERO.text : c.ink;
        const body = (
          <>
            <Text variant="dow" color={ink} style={s.dow}>
              {formatDow(d.day)}
            </Text>
            <Text variant="dayNum" color={ink} tnum>
              {dayOfMonth(d.day)}
            </Text>
            <View style={[s.dot, { backgroundColor: active ? ON_HERO.dotActive : spendDotColor(d.spent, c) }]} />
          </>
        );
        return (
          <Pressable
            key={d.day}
            style={s.slot}
            onPress={() => onSelect(d.day)}
            accessibilityRole="button"
            accessibilityLabel={formatDayLong(d.day)}
            accessibilityState={{ selected: active }}
          >
            {active ? (
              <HeroSurface radius={15} style={s.day}>
                {body}
              </HeroSurface>
            ) : (
              <View style={s.day}>{body}</View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
});

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    strip: {
      flexDirection: 'row',
      gap: 4,
      backgroundColor: t.c.surface,
      borderRadius: 20,
      boxShadow: t.shadow,
      padding: 6,
    },
    slot: { flex: 1 },
    day: {
      height: 60,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 3,
    },
    dow: { opacity: 0.72 },
    dot: { width: 5, height: 5, borderRadius: 3 },
  });
