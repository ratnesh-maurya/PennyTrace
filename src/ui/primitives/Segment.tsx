import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { FIXED } from '../theme/palette';
import { Text } from './Text';

interface SegmentProps<K extends string> {
  options: readonly { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
  testID?: string;
}

/** Segmented control (Insights Week/Month): surface2 track, selected segment raised on surface. */
export function Segment<K extends string>({ options, value, onChange, testID }: SegmentProps<K>) {
  const { c } = useTheme();
  return (
    <View testID={testID} style={[styles.track, { backgroundColor: c.surface2 }]}>
      {options.map(o => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.key)}
            style={[
              styles.seg,
              active ? { backgroundColor: c.surface, boxShadow: FIXED.segmentShadow } : null,
            ]}>
            <Text variant="chip" color={active ? 'ink' : 'ink3'}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', padding: 3, borderRadius: 12 },
  seg: { height: 30, paddingHorizontal: 12, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
});
