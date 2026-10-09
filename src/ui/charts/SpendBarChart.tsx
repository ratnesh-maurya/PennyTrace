import React, { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Paise } from '../../core/types';
import { formatBarValue } from '../format';
import { HeroSurface } from '../primitives/HeroSurface';
import { Text } from '../primitives/Text';
import { useTheme } from '../theme/ThemeProvider';
import { DashedLine } from './DashedLine';

export const SPEND_CHART_HEIGHT = 120;

export interface SpendBar {
  key: string;
  label: string;
  value: Paise;
}

interface SpendBarChartProps {
  bars: readonly SpendBar[];
  selectedIndex: number;
  /** Average per bar; drawn as a dashed line. */
  average: Paise;
  onSelect?: (index: number) => void;
}

/** Design geometry: h = max(4, v / max · 120); avg line at avg / max · 120. */
export function spendBarHeights(values: readonly Paise[], H = SPEND_CHART_HEIGHT): number[] {
  const max = Math.max(...values, 1);
  return values.map(v => Math.max(4, (v / max) * H));
}

const BAR_RADIUS = { tl: 8, tr: 8, br: 4, bl: 4 };

/** Spend per day (week) or per week (month). The selected bar uses the hero gradient. */
export const SpendBarChart = memo(function SpendBarChart({
  bars,
  selectedIndex,
  average,
  onSelect,
}: SpendBarChartProps) {
  const { c } = useTheme();
  const max = Math.max(...bars.map(b => b.value), 1);
  const heights = spendBarHeights(bars.map(b => b.value));
  return (
    <View testID="spend-bar-chart">
      <View style={styles.plot}>
        <DashedLine
          color={c.ink3}
          thickness={1.5}
          opacity={0.45}
          style={[styles.avg, { bottom: (average / max) * SPEND_CHART_HEIGHT }]}
        />
        {bars.map((b, i) => {
          const selected = i === selectedIndex;
          return (
            <Pressable
              key={b.key}
              accessibilityRole="button"
              accessibilityLabel={`${b.label} ${formatBarValue(b.value)}`}
              accessibilityState={{ selected }}
              onPress={onSelect ? () => onSelect(i) : undefined}
              style={styles.slot}>
              {selected ? (
                <HeroSurface radius={BAR_RADIUS} style={{ height: heights[i] }} />
              ) : (
                <View style={[styles.bar, { height: heights[i], backgroundColor: c.barSoft }]} />
              )}
            </Pressable>
          );
        })}
      </View>
      <View style={styles.labels}>
        {bars.map((b, i) => {
          const selected = i === selectedIndex;
          return (
            <View key={b.key} style={styles.labelCol}>
              <Text variant="tiny" weight={selected ? 700 : 500} color={selected ? 'accent' : 'ink3'} numberOfLines={1}>
                {b.label}
              </Text>
              <Text variant="tiny" weight={400} color="ink3" tnum numberOfLines={1}>
                {formatBarValue(b.value)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  plot: { height: SPEND_CHART_HEIGHT, flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  avg: { position: 'absolute', left: 0, right: 0 },
  slot: { flex: 1, height: SPEND_CHART_HEIGHT, justifyContent: 'flex-end' },
  bar: { borderTopLeftRadius: 8, borderTopRightRadius: 8, borderBottomLeftRadius: 4, borderBottomRightRadius: 4 },
  labels: { flexDirection: 'row', gap: 8, marginTop: 10 },
  labelCol: { flex: 1, minWidth: 0, alignItems: 'center', gap: 1 },
});
