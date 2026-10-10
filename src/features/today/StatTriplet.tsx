import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatINR } from '../../core/money';
import type { DailyClose } from '../../core/types';
import { formatSignedINR } from '../../ui/format';
import { StatIcon, Text } from '../../ui/primitives';
import { useTheme, useThemedStyles, type Theme } from '../../ui/theme';
import { movedStatText } from './closePresenter';

/** Received · Spent · Moved for the selected day and scope. */
export const StatTriplet = memo(function StatTriplet({ close }: { close: DailyClose }) {
  const s = useThemedStyles(makeStyles);
  const { c } = useTheme();
  const stats = [
    {
      key: 'received',
      label: 'Received',
      icon: 'south_west',
      color: c.pos,
      value: formatSignedINR(close.received),
      note: undefined,
    },
    {
      key: 'spent',
      label: 'Spent',
      icon: 'north_east',
      color: c.out,
      value: formatSignedINR(-close.spent),
      note: close.spentOnCard > 0 ? `incl. ${formatINR(close.spentOnCard)} on card` : undefined,
    },
    { key: 'moved', label: 'Moved', icon: 'swap_horiz', color: c.xfer, value: movedStatText(close), note: undefined },
  ] as const;
  return (
    <View style={s.row} testID="stat-triplet">
      {stats.map(st => (
        <View key={st.key} style={s.card}>
          <StatIcon icon={st.icon} color={st.color} />
          <Text variant="meta" color="ink3">
            {st.label}
          </Text>
          <Text variant="stat16" tnum adjustsFontSizeToFit numberOfLines={1}>
            {st.value}
          </Text>
          {st.note ? (
            <Text variant="tiny" color="ink3" numberOfLines={1}>
              {st.note}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
});

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    row: { flexDirection: 'row', gap: 8 },
    card: {
      flex: 1,
      gap: 4,
      padding: 12,
      borderRadius: 18,
      backgroundColor: t.c.surface,
      boxShadow: t.shadow,
    },
  });
