import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Icon, type IconName } from '../icons';
import { useTheme } from '../theme/ThemeProvider';

interface IconButtonProps {
  icon: IconName;
  onPress?: () => void;
  accessibilityLabel: string;
  /** `ghost`: 48px transparent (detail app bar). `raised`: 40px surface circle with shadow (Activity tune). */
  kind?: 'ghost' | 'raised';
  testID?: string;
}

export function IconButton({ icon, onPress, accessibilityLabel, kind = 'ghost', testID }: IconButtonProps) {
  const t = useTheme();
  const raised = kind === 'raised';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        raised ? styles.raised : styles.ghost,
        raised ? { backgroundColor: t.c.surface, boxShadow: t.shadow } : null,
        pressed ? { backgroundColor: t.c.surface2 } : null,
      ]}>
      <Icon name={icon} size={raised ? 21 : 24} color={raised ? t.c.ink2 : t.c.ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ghost: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  raised: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
