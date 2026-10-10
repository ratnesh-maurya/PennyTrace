import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme, type Colors } from '../theme/ThemeProvider';

export type ConfidenceLevel = 'high' | 'likely' | 'unsure';

/** Design thresholds: ≥90 high (accent), 75–89 likely (xfer), <75 unsure (warn). */
export function confidenceLevel(confidence: number): ConfidenceLevel {
  return confidence >= 90 ? 'high' : confidence >= 75 ? 'likely' : 'unsure';
}

export function confidenceInk(level: ConfidenceLevel, c: Colors): string {
  return level === 'high' ? c.accent : level === 'likely' ? c.xfer : c.warn;
}

export function confidenceLabel(confidence: number): string {
  const level = confidenceLevel(confidence);
  const word = level === 'high' ? 'High confidence' : level === 'likely' ? 'Likely' : 'Unsure';
  return `${word} · ${Math.round(confidence)}%`;
}

interface ProgressBarProps {
  /** 0–100 */
  value: number;
  color: string;
  height?: number;
}

/** 6px rounded progress track on surface2 (confidence, by-account share, download). */
export const ProgressBar = memo(function ProgressBar({ value, color, height = 6 }: ProgressBarProps) {
  const { c } = useTheme();
  const pct = Math.max(0, Math.min(100, value));
  return (
    <View style={[styles.track, { height, borderRadius: height / 2, backgroundColor: c.surface2 }]}>
      <View style={[styles.fill, { width: `${pct}%`, borderRadius: height / 2, backgroundColor: color }]} />
    </View>
  );
});

export const ConfidenceBar = memo(function ConfidenceBar({ confidence }: { confidence: number }) {
  const { c } = useTheme();
  return <ProgressBar value={confidence} color={confidenceInk(confidenceLevel(confidence), c)} />;
});

const styles = StyleSheet.create({
  track: { overflow: 'hidden' },
  fill: { height: '100%' },
});
