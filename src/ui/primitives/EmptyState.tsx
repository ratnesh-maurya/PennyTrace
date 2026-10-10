import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, type IconName } from '../icons';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

interface EmptyStateProps {
  icon: IconName;
  message: string;
  /** `dashed`: bordered box (Activity). `plain`: inline inside a card (Where it went). */
  framed?: 'dashed' | 'plain';
  iconColor?: 'accent' | 'pos';
}

export function EmptyState({ icon, message, framed = 'dashed', iconColor = 'accent' }: EmptyStateProps) {
  const { c } = useTheme();
  return (
    <View style={framed === 'dashed' ? [styles.dashed, { borderColor: c.line2 }] : styles.plain}>
      <Icon name={icon} size={framed === 'dashed' ? 28 : 26} color={c[iconColor]} />
      <Text variant="label" weight={400} color="ink3" align="center">
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dashed: {
    marginVertical: 24,
    marginHorizontal: 18,
    padding: 28,
    borderRadius: 22,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    gap: 8,
  },
  plain: { paddingTop: 18, paddingBottom: 22, alignItems: 'center', gap: 6 },
});
