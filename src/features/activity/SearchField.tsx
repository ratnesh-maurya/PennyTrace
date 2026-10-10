import React, { memo } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Icon } from '../../ui/icons';
import { useTheme } from '../../ui/theme';
import { fontFamilyFor } from '../../ui/theme/typography';

interface SearchFieldProps {
  value: string;
  onChangeText: (text: string) => void;
}

/** 46px pill: "Search merchants, people, refs". */
export const SearchField = memo(function SearchField({ value, onChangeText }: SearchFieldProps) {
  const { c } = useTheme();
  return (
    <View style={[styles.field, { backgroundColor: c.surface2 }]}>
      <Icon name="search" size={20} color={c.ink3} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="Search merchants, people, refs"
        placeholderTextColor={c.ink3}
        style={[styles.input, { color: c.ink, fontFamily: fontFamilyFor(400) }]}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel="Search transactions"
        testID="activity-search"
      />
    </View>
  );
});

const styles = StyleSheet.create({
  field: { height: 46, borderRadius: 23, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16 },
  input: { flex: 1, fontSize: 14, paddingVertical: 0 },
});
