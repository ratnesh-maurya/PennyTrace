import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatINR } from '../../core/money';
import type { Paise } from '../../core/types';
import { MINUS, formatSignedINR } from '../format';
import { Text } from '../primitives/Text';
import { ON_HERO } from '../theme/palette';
import { DashedLine } from './DashedLine';

export const WATERFALL_HEIGHT = 84;
/** Minimum value range so a quiet day doesn't blow tiny moves up to full height (₹1,500). */
export const WATERFALL_MIN_RANGE: Paise = 150000;

export interface WaterfallInput {
  opening: Paise;
  received: Paise;
  spent: Paise;
  closing: Paise;
}

export interface WaterfallBar {
  key: 'opening' | 'in' | 'spent' | 'moved' | 'closing';
  /** px from the baseline */
  bottom: number;
  /** px */
  height: number;
}

/**
 * Exact scale from the design (`renderVals` in LedgerApp2.dc.html):
 *   L = [open, open+in, open+in−spent, close]
 *   rng = max(max−min, ₹1,500); lo = min − rng·0.55
 *   px(v) = max(2, (v−lo)/(max−lo)·84)
 *   floating segment(a,b): bottom = px(min(a,b)) − (a===b ? 2 : 0), height = max(3, |px(b)−px(a)|)
 * Opening and closing bars stand on the baseline.
 */
export function waterfallGeometry(w: WaterfallInput, H = WATERFALL_HEIGHT): WaterfallBar[] {
  const L = [w.opening, w.opening + w.received, w.opening + w.received - w.spent, w.closing];
  const mn = Math.min(...L);
  const mx = Math.max(...L);
  const rng = Math.max(mx - mn, WATERFALL_MIN_RANGE);
  const lo = mn - rng * 0.55;
  const px = (v: number) => Math.max(2, ((v - lo) / (mx - lo)) * H);
  const seg = (a: number, b: number) => ({
    bottom: px(Math.min(a, b)) - (a === b ? 2 : 0),
    height: Math.max(3, Math.abs(px(b) - px(a))),
  });
  return [
    { key: 'opening', bottom: 0, height: px(w.opening) },
    { key: 'in', ...seg(L[0], L[1]) },
    { key: 'spent', ...seg(L[1], L[2]) },
    { key: 'moved', ...seg(L[2], L[3]) },
    { key: 'closing', bottom: 0, height: px(w.closing) },
  ];
}

const BAR_COLOR: Record<WaterfallBar['key'], string> = {
  opening: ON_HERO.opening,
  in: ON_HERO.in,
  spent: ON_HERO.spent,
  moved: ON_HERO.moved,
  closing: ON_HERO.closing,
};
const VALUE_INK: Record<WaterfallBar['key'], string> = {
  opening: ON_HERO.text,
  in: ON_HERO.inInk,
  spent: ON_HERO.spentInk,
  moved: ON_HERO.movedInk,
  closing: ON_HERO.text,
};
const LABEL: Record<WaterfallBar['key'], string> = {
  opening: 'Opening',
  in: 'In',
  spent: 'Spent',
  moved: 'Moved',
  closing: 'Closing',
};

interface CloseWaterfallProps extends WaterfallInput {
  movedNet: Paise;
}

/** Opening → in → spent → moved → closing, drawn on the hero gradient. */
export const CloseWaterfall = memo(function CloseWaterfall(props: CloseWaterfallProps) {
  const bars = waterfallGeometry(props);
  const values: Record<WaterfallBar['key'], string> = {
    opening: formatINR(props.opening),
    in: `+${formatINR(props.received)}`,
    spent: `${MINUS}${formatINR(props.spent)}`,
    moved: props.movedNet === 0 ? `net ${formatINR(0)}` : formatSignedINR(props.movedNet),
    closing: formatINR(props.closing),
  };
  return (
    <View style={styles.wrap} testID="close-waterfall">
      <View>
        <View style={styles.plot}>
          {bars.map(b => (
            <View key={b.key} style={styles.col}>
              <View
                testID={`waterfall-bar-${b.key}`}
                style={[styles.bar, { bottom: b.bottom, height: b.height, backgroundColor: BAR_COLOR[b.key] }]}
              />
            </View>
          ))}
        </View>
        <DashedLine color={ON_HERO.baseline} />
      </View>
      <View style={styles.labels}>
        {bars.map(b => (
          <View key={b.key} style={styles.labelCol}>
            <Text variant="tiny" color={ON_HERO.label}>
              {LABEL[b.key]}
            </Text>
            <Text
              variant="metaStrong"
              color={VALUE_INK[b.key]}
              tnum
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {values[b.key]}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  plot: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: WATERFALL_HEIGHT },
  col: { flex: 1, height: WATERFALL_HEIGHT },
  bar: { position: 'absolute', left: 0, right: 0, borderRadius: 6 },
  labels: { flexDirection: 'row', gap: 8 },
  labelCol: { flex: 1, minWidth: 0, gap: 1 },
});
