import React, { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon } from '../../ui/icons';
import { Text } from '../../ui/primitives';
import { useTheme } from '../../ui/theme';

interface SetClosingLinkProps {
  /** Accounts whose balance can't be right (a savings balance below ₹0). */
  negativeNames: readonly string[];
  onPress: () => void;
}

/** Under the daily close: enter the selected day's closing balance from the bank's app. */
export const SetClosingLink = memo(function SetClosingLink({ negativeNames, onPress }: SetClosingLinkProps) {
  const { c } = useTheme();
  const warn = negativeNames.length > 0;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={[s.row, warn && { backgroundColor: c.warnSoft }]}
      testID="set-closing-link"
    >
      <Icon name={warn ? 'error' : 'edit'} size={18} color={warn ? c.warn : c.accent} fill={warn} />
      <View style={s.flex}>
        {warn ? (
          <Text variant="meta" color="warn">
            {negativeNames.join(', ')} can't be below ₹0: some money came in without an SMS.
          </Text>
        ) : null}
        <Text variant="chip" color={warn ? 'warn' : 'accent'}>
          Set this day's closing balance
        </Text>
      </View>
    </Pressable>
  );
});

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  flex: { flex: 1, gap: 2 },
});
