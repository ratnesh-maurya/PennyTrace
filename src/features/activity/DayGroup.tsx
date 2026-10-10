import React, { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { TxnSection } from '../../app/data/types';
import { formatINR } from '../../core/money';
import { addDays, formatDayLong, formatDayShort } from '../../ui/format';
import { Card, Text, useRowDivider } from '../../ui/primitives';
import { TransactionRow } from './TransactionRow';

/** One day of transactions: "Today · Sat 10 Oct", the day's spend, and the rows. */
export const DayGroup = memo(function DayGroup({
  section,
  today,
  onOpen,
  action,
}: {
  section: TxnSection;
  today: string;
  onOpen: (id: string) => void;
  /** Optional link on the day's header, e.g. "Set closing" on an account's history. */
  action?: { label: string; onPress: (day: string) => void };
}) {
  const divider = useRowDivider();
  const label =
    section.day === today
      ? `Today · ${formatDayShort(section.day)}`
      : section.day === addDays(today, -1)
      ? `Yesterday · ${formatDayShort(section.day)}`
      : formatDayLong(section.day);
  return (
    <View style={styles.group}>
      <View style={styles.head}>
        <Text variant="labelStrong" color="ink2">
          {label}
        </Text>
        <View style={styles.aside}>
          {section.spent > 0 ? (
            <Text variant="meta" color="ink3" tnum>
              −{formatINR(section.spent)} spent
            </Text>
          ) : null}
          {action ? (
            <Pressable
              onPress={() => action.onPress(section.day)}
              hitSlop={8}
              accessibilityRole="button"
              testID={`day-action-${section.day}`}
            >
              <Text variant="metaStrong" color="accent">
                {action.label}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <Card radius={22}>
        {section.data.map((item, i) => (
          <View key={item.txn.id} style={i > 0 ? divider : undefined}>
            <TransactionRow item={item} onPress={onOpen} />
          </View>
        ))}
      </Card>
    </View>
  );
});

const styles = StyleSheet.create({
  group: { gap: 8 },
  aside: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 4 },
});
