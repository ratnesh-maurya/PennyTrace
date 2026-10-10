import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAccountHistory, useAccountSummary, useToday } from '../../app/data/hooks';
import type { RootScreenProps } from '../../app/navigation/types';
import { useClosingSheetStore } from '../../app/stores/ui';
import { formatINR } from '../../core/money';
import { addDays } from '../../ui/format';
import { Chip, EmptyState, IconButton, Text, Tile } from '../../ui/primitives';
import { useTheme } from '../../ui/theme';
import { DayGroup } from '../activity/DayGroup';
import { accountListName, accountTile } from '../shared/accountPresenter';

/** "Load more" choices: each maps the current window (months; `undefined` = all) to the next. */
const LOAD_MORE: readonly { label: string; next: (months: number) => number | undefined }[] = [
  { label: '+1 month', next: m => m + 1 },
  { label: '3 months', next: () => 3 },
  { label: '6 months', next: () => 6 },
  { label: 'All', next: () => undefined },
];

/** One account: balance, then its transactions for the last month, with "Load more". */
export function AccountDetailScreen({ route, navigation }: RootScreenProps<'AccountDetail'>) {
  const { accountId } = route.params;
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const today = useToday();
  const summary = useAccountSummary(accountId);
  /** Months shown; `undefined` = all history. */
  const [months, setMonths] = useState<number | undefined>(1);
  const sinceDay = useMemo(() => (months === undefined ? undefined : addDays(today, -30 * months)), [months, today]);
  const history = useAccountHistory(accountId, sinceDay);
  const open = useCallback((txnId: string) => navigation.navigate('TransactionDetail', { txnId }), [navigation]);
  const openClosing = useClosingSheetStore(st => st.open);

  if (!summary) {
    return (
      <View style={[s.screen, { backgroundColor: c.bg, paddingTop: insets.top }]}>
        <IconButton icon="arrow_back" onPress={navigation.goBack} accessibilityLabel="Back" />
        <EmptyState icon="info" message="This account is no longer in the ledger." />
      </View>
    );
  }
  const { account, balance, recon } = summary;
  const t = accountTile(account);
  const card = account.type === 'credit_card';
  const more = history.shown < history.total;

  const header = (
    <View style={s.header}>
      <IconButton icon="arrow_back" onPress={navigation.goBack} accessibilityLabel="Back" />
      <View style={s.title}>
        <Tile size={44} radius={13} bg={t.color} initials={t.initials} fontSize={13} logo={t.logo} />
        <View style={s.flex}>
          <Text variant="section">{accountListName(account)}</Text>
          <Text variant="meta" color="ink3">
            {card
              ? 'Owed now'
              : recon?.status === 'reconciled'
              ? 'Balance · matches bank'
              : 'Balance · calculated from SMS'}
          </Text>
        </View>
      </View>
      <Text variant="amount" tnum color={!card && balance < 0 ? 'warn' : 'ink'}>
        {card ? formatINR(Math.max(0, -balance)) : formatINR(balance)}
      </Text>
      {!card && balance < 0 ? (
        <Text variant="meta" color="warn">
          A savings balance can't be negative: some money came in without an SMS. Tap "Set closing" on a day and enter
          that day's balance from your bank app.
        </Text>
      ) : null}
      <Text variant="labelStrong" color="ink2">
        {months === undefined ? 'All transactions' : `Last ${months === 1 ? 'month' : `${months} months`}`} ·{' '}
        {history.shown} of {history.total}
      </Text>
    </View>
  );

  const footer = more ? (
    <View style={s.more} testID="load-more">
      <Text variant="labelStrong" color="ink2">
        Load more
      </Text>
      <View style={s.chips}>
        {LOAD_MORE.filter(o => {
          const n = o.next(months ?? 0);
          return n === undefined || n > (months ?? 0);
        }).map(o => (
          <Chip key={o.label} label={o.label} active={false} onPress={() => setMonths(o.next(months ?? 0))} />
        ))}
      </View>
    </View>
  ) : undefined;

  return (
    <FlatList
      testID="account-detail"
      style={{ backgroundColor: c.bg }}
      data={history.sections}
      keyExtractor={sec => sec.day}
      renderItem={({ item }) => (
        <DayGroup
          section={item}
          today={today}
          onOpen={open}
          action={card ? undefined : { label: 'Set closing', onPress: day => openClosing(day, accountId) }}
        />
      )}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      ListEmptyComponent={<EmptyState icon="receipt_long" message="No transactions in this period." />}
      initialNumToRender={6}
      windowSize={9}
      contentContainerStyle={[s.content, { paddingTop: insets.top + 4, paddingBottom: insets.bottom + 24 }]}
      showsVerticalScrollIndicator={false}
    />
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, padding: 18 },
  content: { paddingHorizontal: 18, gap: 14 },
  header: { gap: 10, marginBottom: 4 },
  title: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  more: { gap: 10, paddingVertical: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
