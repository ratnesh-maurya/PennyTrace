import React, { memo } from 'react';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon, type IconName } from '../icons';
import { FIXED } from '../theme/palette';
import type { BankLogo } from '../theme/bankLogos';
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
  /** Bank logo; replaces initials and the brand colour when present. */
  logo?: BankLogo;
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
  logo,
  style,
}: TileProps) {
  if (logo) {
    return (
      <View
        style={[
          styles.tile,
          styles.logoTile,
          { width: size, height: size, borderRadius: radius },
          shadow ? { boxShadow: shadow } : null,
          style,
        ]}
      >
        <LogoImage logo={logo} box={logo.bleed ? size : Math.round(size * 0.78)} />
      </View>
    );
  }
  return (
    <View
      style={[
        styles.tile,
        { width: size, height: size, borderRadius: radius, backgroundColor: bg },
        shadow ? { boxShadow: shadow } : null,
        style,
      ]}
    >
      {icon ? (
        <Icon name={icon} size={iconSize ?? Math.round(size * 0.5)} color={ink} fill={iconFill} />
      ) : (
        <Text
          variant="body"
          color={ink}
          style={{ fontSize, fontFamily: fontFamilyFor(700) }}
          numberOfLines={1}
          allowFontScaling={false}
        >
          {initials}
        </Text>
      )}
    </View>
  );
});

/** Shows the logo's crop rectangle scaled to fit a `box`×`box` square, centred. */
function LogoImage({ logo, box }: { logo: BankLogo; box: number }) {
  const [fx, fy, fw, fh] = logo.crop ?? [0, 0, 1, 1];
  const cw = fw * logo.width;
  const ch = fh * logo.height;
  const scale = box / Math.max(cw, ch);
  return (
    <View style={[styles.logoBox, { width: box, height: box }]}>
      <Image
        source={logo.source}
        style={{
          position: 'absolute',
          width: logo.width * scale,
          height: logo.height * scale,
          left: -fx * logo.width * scale + (box - cw * scale) / 2,
          top: -fy * logo.height * scale + (box - ch * scale) / 2,
        }}
        resizeMode="stretch"
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  logoTile: { backgroundColor: FIXED.white, overflow: 'hidden' },
  logoBox: { overflow: 'hidden' },
});
