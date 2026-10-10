import React, { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { DayKey } from '../../core/types';
import { addDays, formatDayRange } from '../../ui/format';
import { Icon } from '../../ui/icons';
import { Text } from '../../ui/primitives';
import { useTheme } from '../../ui/theme';

interface WeekNavProps {
  /** Last day of the week shown. */
  weekEnd: DayKey;
  today: DayKey;
  onChange: (weekEnd: DayKey) => void;
}

/** ‹ 27 Sep – 3 Oct › : step back through earlier weeks; "This week" returns. */
export const WeekNav = memo(function WeekNav({ weekEnd, today, onChange }: WeekNavProps) {
  const { c } = useTheme();
  const atLatest = weekEnd >= today;
  return (
    <View style={s.row}>
      <Pressable
        onPress={() => onChange(addDays(weekEnd, -7))}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Previous week"
        testID="week-prev"
      >
        <Icon name="chevron_left" size={22} color={c.ink2} />
      </Pressable>
      <Text variant="labelStrong" color="ink2" style={s.label}>
        {formatDayRange(addDays(weekEnd, -6), weekEnd)}
      </Text>
      {atLatest ? null : (
        <Pressable onPress={() => onChange(today)} hitSlop={8} accessibilityRole="button" testID="week-today">
          <Text variant="chip" color="accent">
            This week
          </Text>
        </Pressable>
      )}
      <Pressable
        onPress={() => onChange(addDays(weekEnd, 7) > today ? today : addDays(weekEnd, 7))}
        disabled={atLatest}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Next week"
        accessibilityState={{ disabled: atLatest }}
        testID="week-next"
      >
        <Icon name="chevron_right" size={22} color={atLatest ? c.line2 : c.ink2} />
      </Pressable>
    </View>
  );
});

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 },
  label: { flex: 1 },
});
