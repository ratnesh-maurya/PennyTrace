import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Account, Scope } from '../../core/types';
import { Chip } from '../../ui/primitives';
import { accountShortName } from '../shared/accountPresenter';

interface AccountScopeChipsProps {
  /** Accounts that can be scoped individually (those counted in the total). */
  accounts: readonly Account[];
  value: Scope;
  onChange: (scope: Scope) => void;
}

/** `All` · `HDFC ••1234` · `SBI ••8821`. */
export const AccountScopeChips = memo(function AccountScopeChips({ accounts, value, onChange }: AccountScopeChipsProps) {
  return (
    <View style={styles.row} testID="scope-chips">
      <Chip label="All" active={value === 'all'} onPress={() => onChange('all')} />
      {accounts.map(a => (
        <Chip key={a.id} label={accountShortName(a)} active={value === a.id} onPress={() => onChange(a.id)} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
});
