import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { CardSpend, CardStatus } from '../../core/ledger';
import type { Account } from '../../core/types';
import { Card, Text, useRowDivider } from '../../ui/primitives';
import { CreditCardRow } from './CreditCardRow';

interface CardsCardProps {
  accounts: readonly Account[];
  statuses: readonly CardStatus[];
  spend?: readonly CardSpend[];
  dayLabel?: string;
  onOpen: (accountId: string) => void;
}

/**
 * Credit cards on their own, under the closing balance: what was charged to a card is a debt,
 * not cash leaving your accounts, so it is shown here and kept out of the closing balance.
 */
export const CardsCard = memo(function CardsCard({ accounts, statuses, spend, dayLabel, onOpen }: CardsCardProps) {
  const divider = useRowDivider();
  const rows = statuses
    .map(status => ({ status, account: accounts.find(a => a.id === status.accountId) }))
    .filter((r): r is { status: CardStatus; account: Account } => !!r.account);
  if (rows.length === 0) {
    return null;
  }
  return (
    <Card style={s.card} testID="cards-card">
      <View style={s.head}>
        <Text variant="section">Credit cards</Text>
        <Text variant="meta" color="ink3">
          Not in your closing balance
        </Text>
      </View>
      {rows.map(({ account, status }, i) => (
        <View key={account.id} style={i > 0 ? divider : undefined}>
          <CreditCardRow
            account={account}
            status={status}
            spent={spend?.find(x => x.accountId === account.id)}
            dayLabel={dayLabel}
            onPress={() => onOpen(account.id)}
          />
        </View>
      ))}
    </Card>
  );
});

const s = StyleSheet.create({
  card: { padding: 16, gap: 4 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
});
