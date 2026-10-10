import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { DayKey } from '../../core/types';
import { formatDayLong } from '../../ui/format';
import { Icon } from '../../ui/icons';
import { Badge, Text } from '../../ui/primitives';
import { useTheme, useThemedStyles, type Theme } from '../../ui/theme';

interface TopRowProps {
  day: DayKey;
  isToday: boolean;
}

/** Date + TODAY marker, "Daily close" title, and the "On-device" pill. */
export const TopRow = memo(function TopRow({ day, isToday }: TopRowProps) {
  const s = useThemedStyles(makeStyles);
  const { c } = useTheme();
  return (
    <View style={s.row}>
      <View style={s.col}>
        <View style={s.dateRow}>
          <Text variant="label" color="ink3">
            {formatDayLong(day)}
          </Text>
          {isToday ? <Badge label="TODAY" bg={c.accentSoft} ink={c.accent} variant="badge" /> : null}
        </View>
        <Text variant="title" accessibilityRole="header">
          Daily close
        </Text>
      </View>
      <View style={s.pill} accessibilityLabel="Ledger is on-device">
        <Icon name="lock" size={16} color={c.accent} fill />
        <Text variant="smallStrong" color="ink2">
          On-device
        </Text>
      </View>
    </View>
  );
});

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      paddingTop: 4,
      paddingHorizontal: 2,
    },
    col: { gap: 2 },
    dateRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      height: 30,
      paddingLeft: 9,
      paddingRight: 11,
      borderRadius: 15,
      backgroundColor: t.c.surface,
      boxShadow: t.shadow,
      marginTop: 6,
    },
  });
