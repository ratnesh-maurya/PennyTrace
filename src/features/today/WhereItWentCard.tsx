import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatINR } from '../../core/money';
import type { DailyClose } from '../../core/types';
import { CategoryBar } from '../../ui/charts';
import { formatSignedINR, plural } from '../../ui/format';
import { Icon, toIconName } from '../../ui/icons';
import { Card, Text, Tile, useRowDivider } from '../../ui/primitives';
import { categoryVisual, useTheme } from '../../ui/theme';

/** Category breakdown of the day's spending. */
export const WhereItWentCard = memo(function WhereItWentCard({ close }: { close: DailyClose }) {
  const { c } = useTheme();
  const divider = useRowDivider();
  const total = close.byCategory.reduce((n, x) => n + x.amount, 0);
  return (
    <Card style={styles.card} testID="where-it-went">
      <View style={styles.head}>
        <Text variant="section">Where it went</Text>
        <Text variant="rowValue" tnum>
          {formatSignedINR(-total)}
        </Text>
      </View>
      {close.byCategory.length === 0 ? (
        <View style={styles.empty}>
          <Icon name="savings" size={28} color={c.ink3} />
          <Text variant="label" color="ink3">
            No spending on this day
          </Text>
        </View>
      ) : (
        <>
          <CategoryBar
            segments={close.byCategory.map(x => ({
              key: x.categoryId,
              color: categoryVisual(x.categoryId).color,
              value: x.amount,
            }))}
          />
          <View>
            {close.byCategory.map((x, i) => {
              const v = categoryVisual(x.categoryId);
              const pct = total > 0 ? Math.round((x.amount / total) * 100) : 0;
              return (
                <View key={x.categoryId} style={[styles.row, i > 0 && divider]}>
                  <Tile
                    size={34}
                    radius={11}
                    bg={v.soft}
                    ink={v.color}
                    icon={toIconName(v.def.icon)}
                    iconSize={19}
                    iconFill
                  />
                  <View style={styles.rowText}>
                    <Text variant="rowStrong">{v.def.name}</Text>
                    <Text variant="meta" color="ink3">
                      {plural(x.count, 'transaction', 'transactions')} · {pct}%
                    </Text>
                  </View>
                  <Text variant="rowValue" tnum>
                    {formatINR(x.amount)}
                  </Text>
                </View>
              );
            })}
          </View>
        </>
      )}
    </Card>
  );
});

const styles = StyleSheet.create({
  card: { padding: 16, gap: 14 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  empty: { alignItems: 'center', gap: 6, paddingVertical: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  rowText: { flex: 1, gap: 1 },
});
