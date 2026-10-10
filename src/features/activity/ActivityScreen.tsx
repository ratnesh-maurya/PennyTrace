import { useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToday, useTransactionCounts, useTransactions } from '../../app/data/hooks';
import type { TxnFilter } from '../../app/data/types';
import { useUiStore } from '../../app/stores/ui';
import { Chip, EmptyState, ScreenTitle } from '../../ui/primitives';
import { useTheme } from '../../ui/theme';
import { DayGroup } from './DayGroup';
import { SearchField } from './SearchField';

const FILTERS: readonly { key: TxnFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'spent', label: 'Spent' },
  { key: 'in', label: 'Received' },
  { key: 'xfer', label: 'Moves' },
  { key: 'review', label: 'Review' },
];

/** Days rendered per page; more load as the list nears its end. */
const DAYS_PER_PAGE = 15;

/** Every transaction, newest first, grouped by day. Search, filter, tap for the evidence. */
export function ActivityScreen() {
  const navigation = useNavigation();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const today = useToday();
  const filter = useUiStore(s => s.activityFilter);
  const query = useUiStore(s => s.activityQuery);
  const setFilter = useUiStore(s => s.setActivityFilter);
  const setQuery = useUiStore(s => s.setActivityQuery);
  const sections = useTransactions(filter, query);
  const counts = useTransactionCounts(query);

  const [pages, setPages] = useState(1);
  useEffect(() => setPages(1), [filter, query]);
  const visible = useMemo(() => sections.slice(0, pages * DAYS_PER_PAGE), [sections, pages]);
  const hasMore = visible.length < sections.length;
  const loadMore = useCallback(() => {
    if (hasMore) {
      setPages(p => p + 1);
    }
  }, [hasMore]);

  const open = useCallback((txnId: string) => navigation.navigate('TransactionDetail', { txnId }), [navigation]);

  const header = (
    <View style={styles.header}>
      <ScreenTitle title="Activity" />
      <SearchField value={query} onChangeText={setQuery} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {FILTERS.map(f => (
          <Chip
            key={f.key}
            label={f.label}
            count={counts[f.key]}
            active={filter === f.key}
            onPress={() => setFilter(f.key)}
          />
        ))}
      </ScrollView>
    </View>
  );

  return (
    <FlatList
      testID="activity-screen"
      style={{ backgroundColor: c.bg }}
      data={visible}
      keyExtractor={s => s.day}
      renderItem={({ item }) => <DayGroup section={item} today={today} onOpen={open} />}
      ListHeaderComponent={header}
      ListFooterComponent={hasMore ? <ActivityIndicator color={c.accent} style={styles.more} /> : undefined}
      ListEmptyComponent={
        <EmptyState
          icon="task_alt"
          message={filter === 'review' ? 'Nothing left to review.' : 'No transactions match.'}
        />
      }
      onEndReached={loadMore}
      onEndReachedThreshold={0.6}
      initialNumToRender={6}
      maxToRenderPerBatch={6}
      windowSize={9}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 6 }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 18, paddingBottom: 24, gap: 14 },
  header: { gap: 14, marginBottom: 2 },
  chips: { gap: 6 },
  more: { marginVertical: 12 },
});
