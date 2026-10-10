import React, { memo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import type { Account, Scope } from '../../core/types';
import { Chip } from '../../ui/primitives';
import { accountShortName } from '../shared/accountPresenter';

interface AccountScopeChipsProps {
  /** Accounts that can be scoped individually (those counted in the total). */
  accounts: readonly Account[];
  value: Scope;
  onChange: (scope: Scope) => void;
}

/** `All` · `HDFC ••1234` · `SBI ••8821` … on one line, scrolling sideways when there are many. */
export const AccountScopeChips = memo(function AccountScopeChips({
  accounts,
  value,
  onChange,
}: AccountScopeChipsProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={styles.scroller}
      testID="scope-chips"
    >
      <Chip label="All" active={value === 'all'} onPress={() => onChange('all')} />
      {accounts.map(a => (
        <Chip key={a.id} label={accountShortName(a)} active={value === a.id} onPress={() => onChange(a.id)} />
      ))}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  // Bleed to the screen edges so chips scroll under the margin, like the design's chip rows.
  scroller: { marginHorizontal: -18 },
  row: { gap: 6, paddingHorizontal: 18 },
});
