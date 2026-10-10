import React, { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatINR } from '../../core/money';
import type { Account, AccountRecon } from '../../core/types';
import { Icon, type IconName } from '../../ui/icons';
import { Card, Text, Tile, useRowDivider } from '../../ui/primitives';
import { useTheme } from '../../ui/theme';
import { accountListName, accountTile } from '../shared/accountPresenter';

interface AccountsCardProps {
  accounts: readonly Account[];
  recons: readonly AccountRecon[];
  onReconcile: () => void;
  onOpen: (accountId: string) => void;
  /** Current balances (cards: negative = owed). */
  balances: Record<string, number>;
}

function statusOf(
  a: Account,
  r: AccountRecon | undefined,
  balance: number,
): { text: string; icon: IconName; tone: 'accent' | 'warn' | 'ink3' } {
  if (a.type === 'credit_card') {
    return { text: 'Owed on card · shown separately', icon: 'credit_card', tone: 'ink3' };
  }
  if (balance < 0) {
    return { text: 'Missing alerts · set balance', icon: 'error', tone: 'warn' };
  }
  if (!r || r.status === 'unknown') {
    return { text: 'Calculated from SMS', icon: 'info', tone: 'ink3' };
  }
  if (r.status === 'off') {
    return { text: `Off by ${formatINR(Math.abs(r.variance ?? 0))}`, icon: 'error', tone: 'warn' };
  }
  return { text: 'Matches bank', icon: 'check_circle', tone: 'accent' };
}

/** Per-account balance with its reconciliation status; cards are a liability. */
export const AccountsCard = memo(function AccountsCard({
  accounts,
  recons,
  onReconcile,
  onOpen,
  balances,
}: AccountsCardProps) {
  const { c } = useTheme();
  const divider = useRowDivider();
  const byId = new Map(recons.map(r => [r.accountId, r]));
  return (
    <Card style={styles.card} testID="accounts-card">
      <View style={styles.head}>
        <Text variant="section">Accounts</Text>
        <Pressable onPress={onReconcile} accessibilityRole="link" hitSlop={8} testID="reconcile-link">
          <Text variant="chip" color="accent">
            Reconcile
          </Text>
        </Pressable>
      </View>
      <View>
        {accounts.map((a, i) => {
          const r = byId.get(a.id);
          const balance = balances[a.id] ?? 0;
          const st = statusOf(a, r, balance);
          const t = accountTile(a);
          return (
            <Pressable
              key={a.id}
              style={[styles.row, i > 0 && divider]}
              onPress={() => onOpen(a.id)}
              accessibilityRole="button"
              testID={`account-row-${a.id}`}
            >
              <Tile size={36} radius={11} bg={t.color} initials={t.initials} logo={t.logo} fontSize={11.5} />
              <View style={styles.text}>
                <Text variant="rowStrong" numberOfLines={1}>
                  {accountListName(a)}
                </Text>
                <View style={styles.status}>
                  <Icon name={st.icon} size={13} color={c[st.tone]} fill />
                  <Text variant="meta" color={st.tone}>
                    {st.text}
                  </Text>
                </View>
              </View>
              <Text variant="rowValue" tnum color={balance < 0 ? 'out' : 'ink'}>
                {formatINR(balance)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
});

const styles = StyleSheet.create({
  card: { padding: 16, gap: 6 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  text: { flex: 1, gap: 2 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
