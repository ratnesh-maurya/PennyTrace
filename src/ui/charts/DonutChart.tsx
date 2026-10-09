import React, { memo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

export interface DonutSegment {
  key: string;
  color: string;
  value: number;
}

interface DonutChartProps {
  segments: readonly DonutSegment[];
  /** Outer diameter (124 in the design). */
  size?: number;
  /** Ring thickness: (124 − 86) / 2 = 19. */
  thickness?: number;
  /** Transparent gap at the start of each segment, in % of the circle (design: 0.8 %). */
  gapPct?: number;
  children?: ReactNode;
}

function polar(cx: number, cy: number, r: number, pct: number) {
  const a = (pct / 100) * 2 * Math.PI;
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
}

/** SVG arc from `fromPct` to `toPct` of the circle, clockwise from 12 o'clock (CSS conic-gradient order). */
export function arcPath(cx: number, cy: number, r: number, fromPct: number, toPct: number): string {
  const sweep = Math.min(toPct - fromPct, 99.999);
  const start = polar(cx, cy, r, fromPct);
  const end = polar(cx, cy, r, fromPct + sweep);
  const large = sweep > 50 ? 1 : 0;
  const f = (n: number) => n.toFixed(3);
  return `M ${f(start.x)} ${f(start.y)} A ${r} ${r} 0 ${large} 1 ${f(end.x)} ${f(end.y)}`;
}

/** Category donut: the design's conic gradient with 0.8 % gaps, as SVG arcs. */
export const DonutChart = memo(function DonutChart({
  segments,
  size = 124,
  thickness = 19,
  gapPct = 0.8,
  children,
}: DonutChartProps) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const r = (size - thickness) / 2;
  const cx = size / 2;
  let acc = 0;
  const arcs = segments.map(s => {
    const from = (acc / total) * 100;
    acc += s.value;
    const to = (acc / total) * 100;
    return { key: s.key, color: s.color, d: to - from > gapPct ? arcPath(cx, cx, r, from + gapPct, to) : null };
  });
  return (
    <View style={{ width: size, height: size }} testID="donut-chart">
      <Svg width={size} height={size}>
        {arcs.map(a =>
          a.d ? <Path key={a.key} d={a.d} stroke={a.color} strokeWidth={thickness} fill="none" /> : null,
        )}
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.center]}>{children}</View>
    </View>
  );
});

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});
