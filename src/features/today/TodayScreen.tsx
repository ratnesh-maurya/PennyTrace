import { useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  useAccountBalances,
  useCardSpend,
  useCardStatuses,
  useAccounts,
  useDailyClose,
  useReconciliation,
  useReviewQueue,
  useToday,
  useWeekStrip,
} from '../../app/data/hooks';
import { resolveCategory } from '../../app/data/actions';
import { useClosingSheetStore, useCorrectionStore, useUiStore } from '../../app/stores/ui';
import { useToastStore } from '../../app/stores/toast';
import { CATEGORY_BY_ID } from '../../core/categories';
import type { DayKey } from '../../core/types';
import { addDays } from '../../ui/format';
import { ScreenScroll, Text } from '../../ui/primitives';
import { accountShortName, isTracked, scopeLabel } from '../shared/accountPresenter';
import { AccountScopeChips } from './AccountScopeChips';
import { CardsCard } from '../cards/CardsCard';
import { AccountsCard } from './AccountsCard';
import { CloseHeroCard } from './CloseHeroCard';
import { QuickCheckCard } from './QuickCheckCard';
import { StatTriplet } from './StatTriplet';
import { TopRow } from './TopRow';
import { SetClosingLink } from './SetClosingLink';
import { WeekNav } from './WeekNav';
import { WeekStrip } from './WeekStrip';
import { WhereItWentCard } from './WhereItWentCard';
import { describeMoves } from './closePresenter';

/** Daily close: pick a day and scope, see opening → in → spent → moved → closing. */
export function TodayScreen() {
  const navigation = useNavigation();
  const today = useToday();
  const selectedDay = useUiStore(s => s.selectedDay) ?? today;
  const scope = useUiStore(s => s.todayScope);
  const setSelectedDay = useUiStore(s => s.setSelectedDay);
  const setScope = useUiStore(s => s.setTodayScope);
  const openCorrection = useCorrectionStore(s => s.open);
  const openClosing = useClosingSheetStore(s => s.open);
  const showToast = useToastStore(s => s.show);

  const accounts = useAccounts();
  const recons = useReconciliation();
  const balances = useAccountBalances();
  const cardStatuses = useCardStatuses();
  const cardSpend = useCardSpend(selectedDay);
  // The week shown in the strip; earlier weeks via ‹. A day picked elsewhere (an Insights bar)
  // brings its week into view.
  const [weekEnd, setWeekEnd] = useState(today);
  useEffect(() => {
    if (selectedDay < addDays(weekEnd, -6) || selectedDay > weekEnd) {
      setWeekEnd(addDays(selectedDay, 6) > today ? today : addDays(selectedDay, 6));
    }
  }, [selectedDay, weekEnd, today]);
  const changeWeek = useCallback(
    (end: DayKey) => {
      setWeekEnd(end);
      setSelectedDay(end);
    },
    [setSelectedDay],
  );
  const week = useWeekStrip(scope, weekEnd);
  const close = useDailyClose(selectedDay, scope);
  const review = useReviewQueue();

  const scopable = useMemo(
    () => accounts.filter(a => a.includeInTotal && a.type !== 'credit_card' && a.type !== 'cash'),
    [accounts],
  );
  const tracked = useMemo(() => accounts.filter(isTracked), [accounts]);
  const negativeNames = useMemo(
    () =>
      tracked
        .filter(a => a.type !== 'credit_card' && (balances[a.id] ?? 0) < 0 && (scope === 'all' || scope === a.id))
        .map(accountShortName),
    [tracked, balances, scope],
  );
  const pending = selectedDay === today ? review[0] : undefined;

  const confirm = useCallback(async () => {
    if (!pending) {
      return;
    }
    await resolveCategory(pending.id, pending.categoryId, true);
    showToast(
      `Rule saved on-device: ${pending.counterparty ?? 'merchant'} → ${CATEGORY_BY_ID[pending.categoryId]?.name ?? ''}`,
    );
  }, [pending, showToast]);

  return (
    <ScreenScroll testID="today-screen">
      <TopRow day={selectedDay} isToday={selectedDay === today} />
      <WeekNav weekEnd={weekEnd} today={today} onChange={changeWeek} />
      <WeekStrip days={week} selected={selectedDay} onSelect={setSelectedDay} />
      <AccountScopeChips accounts={scopable} value={scope} onChange={setScope} />
      <CloseHeroCard close={close} scopeLabel={scopeLabel(accounts, scope)} today={today} />
      <StatTriplet close={close} />
      <SetClosingLink
        negativeNames={negativeNames}
        onPress={() => openClosing(selectedDay, scope === 'all' ? undefined : scope)}
      />
      <View style={styles.note}>
        <Text variant="meta" color="ink3">
          {describeMoves(close, accounts, today)}
        </Text>
      </View>
      {pending ? (
        <QuickCheckCard txn={pending} onConfirm={confirm} onChange={() => openCorrection(pending.id)} />
      ) : null}
      <WhereItWentCard close={close} />
      <CardsCard
        accounts={tracked}
        statuses={cardStatuses}
        spend={cardSpend}
        dayLabel={selectedDay === today ? 'today' : 'this day'}
        onOpen={accountId => navigation.navigate('AccountDetail', { accountId })}
      />
      <AccountsCard
        accounts={tracked.filter(a => a.type !== 'credit_card')}
        recons={recons}
        onReconcile={() => navigation.navigate('Tabs', { screen: 'Accounts' })}
        onOpen={accountId => navigation.navigate('AccountDetail', { accountId })}
        balances={balances}
      />
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  note: { paddingHorizontal: 2 },
});
