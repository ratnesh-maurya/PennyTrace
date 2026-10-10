import React, { memo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Line } from 'react-native-svg';

interface DashedLineProps {
  color: string;
  thickness?: number;
  dash?: [number, number];
  opacity?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Horizontal dashed rule. Drawn with SVG because RN cannot dash a single
 * border side consistently on Android.
 */
export const DashedLine = memo(function DashedLine({
  color,
  thickness = 1,
  dash = [4, 3],
  opacity = 1,
  style,
}: DashedLineProps) {
  return (
    <View style={[styles.wrap, { height: thickness, opacity }, style]} pointerEvents="none">
      <Svg width="100%" height={thickness}>
        <Line
          x1="0"
          y1={thickness / 2}
          x2="100%"
          y2={thickness / 2}
          stroke={color}
          strokeWidth={thickness}
          strokeDasharray={dash}
        />
      </Svg>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
});
