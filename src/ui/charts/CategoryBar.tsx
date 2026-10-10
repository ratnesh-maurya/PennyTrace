import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';

export interface CategoryBarSegment {
  key: string;
  color: string;
  value: number;
}

/**
 * Stacked share bar (Where it went): 10px tall, 3px gaps, rounded ends.
 * flexGrow with a zero basis reproduces CSS `width: x%` + `gap` shrinking.
 */
export const CategoryBar = memo(function CategoryBar({ segments }: { segments: readonly CategoryBarSegment[] }) {
  if (segments.length === 0) {
    return null;
  }
  return (
    <View style={styles.bar} testID="category-bar">
      {segments.map(s => (
        <View key={s.key} style={{ flexGrow: s.value, flexBasis: 0, backgroundColor: s.color }} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', gap: 3, height: 10, borderRadius: 5, overflow: 'hidden' },
});
