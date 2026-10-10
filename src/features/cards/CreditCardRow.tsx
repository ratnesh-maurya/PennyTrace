import React, { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { CardSpend, CardStatus } from '../../core/ledger';
import { formatINR } from '../../core/money';
import type { Account } from '../../core/types';
import { plural } from '../../ui/format';
import { ProgressBar, Text, Tile } from '../../ui/primitives';
import { useTheme } from '../../ui/theme';
import { accountListName, accountTile } from '../shared/accountPresenter';

interface CreditCardRowProps {
  account: Account;
  status: CardStatus;
  /** Charged on the day being viewed, when the screen has a day (Today). */
  spent?: CardSpend;
  /** "today" / "Thu 9 Oct": the day `spent` refers to. */
  dayLabel?: string;
  onPress?: () => void;
}

/** A credit card: how much of the limit is used, what is left, and what was charged on the day. */
export const CreditCardRow = memo(function CreditCardRow({
  account,
  status,
  spent,
  dayLabel,
  onPress,
}: CreditCardRowProps) {
  const { c } = useTheme();
  const t = accountTile(account);
  const { used, limit, available } = status;
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  const bar = pct >= 90 ? c.out : pct >= 60 ? c.warn : c.accent;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={s.row}
      testID={`card-${account.id}`}
    >
      <View style={s.head}>
        <Tile size={36} radius={11} bg={t.color} initials={t.initials} logo={t.logo} fontSize={11.5} />
        <View style={s.flex}>
          <Text variant="rowStrong" numberOfLines={1}>
            {accountListName(account)}
          </Text>
          <Text variant="meta" color="ink3">
            Credit card
          </Text>
        </View>
        <View style={s.right}>
          <Text variant="rowValue" tnum color={used > 0 ? 'out' : 'ink'}>
            {formatINR(used)}
          </Text>
          <Text variant="meta" color="ink3">
            used
          </Text>
        </View>
      </View>
      {limit ? <ProgressBar value={pct} color={bar} /> : null}
      <Text variant="meta" color="ink3" tnum>
        {limit
          ? `Limit ${formatINR(limit)} · ${formatINR(available ?? 0)} available`
          : 'Limit shows once the bank prints it in a second card alert.'}
      </Text>
      {spent ? (
        <Text variant="metaStrong" color="out" tnum>
          Charged {dayLabel ?? 'on this day'}: {formatINR(spent.amount)} · {plural(spent.count, 'payment', 'payments')}
        </Text>
      ) : null}
    </Pressable>
  );
});

const s = StyleSheet.create({
  row: { gap: 8, paddingVertical: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  right: { alignItems: 'flex-end' },
});
