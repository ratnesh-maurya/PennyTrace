import React, { memo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon, type IconName } from '../icons';
import { FIXED } from '../theme/palette';
import { fontFamilyFor } from '../theme/typography';
import { Text } from './Text';

interface TileProps {
  size: number;
  radius: number;
  /** Background colour (brand colour, or a palette colour for icon tiles). */
  bg: string;
  /** Text/icon colour. Defaults to white (brand tiles). */
  ink?: string;
  initials?: string;
  icon?: IconName;
  iconSize?: number;
  iconFill?: boolean;
  /** Initials font size. */
  fontSize?: number;
  /** CSS box-shadow, e.g. an inset ring `inset 0 0 0 1px <line>`. */
  shadow?: string;
  style?: StyleProp<ViewStyle>;
}

/** Square tile with a brand colour + initials, or a tinted background + icon. */
export const Tile = memo(function Tile({
  size,
  radius,
  bg,
  ink = FIXED.white,
  initials,
  icon,
  iconSize,
  iconFill,
  fontSize = 12,
  shadow,
  style,
}: TileProps) {
  return (
    <View
      style={[
        styles.tile,
        { width: size, height: size, borderRadius: radius, backgroundColor: bg },
        shadow ? { boxShadow: shadow } : null,
        style,
      ]}>
      {icon ? (
        <Icon name={icon} size={iconSize ?? Math.round(size * 0.5)} color={ink} fill={iconFill} />
      ) : (
        <Text
          variant="body"
          color={ink}
          style={{ fontSize, fontFamily: fontFamilyFor(700) }}
          numberOfLines={1}
          allowFontScaling={false}>
          {initials}
        </Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
});
