import React, { memo, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useAccounts, useInsights, useToday } from '../../app/data/hooks';
import { useUiStore } from '../../app/stores/ui';
import { formatINR } from '../../core/money';
import type { Account, InsightRange, Insights, Scope } from '../../core/types';
import { DonutChart, SpendBarChart } from '../../ui/charts';
import { addDays, formatDayRange, formatINRShort, plural } from '../../ui/format';
import {
  Card,
  Chip,
  ProgressBar,
  ScreenScroll,
  ScreenTitle,
  Segment,
  StatIcon,
  Text,
  Tile,
  useRowDivider,
} from '../../ui/primitives';
import { brandFor, categoryVisual, useTheme } from '../../ui/theme';
import { accountChipLabel, accountListName, accountTile, isTracked } from '../shared/accountPresenter';

const RANGES = [
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
] as const satisfies readonly { key: InsightRange; label: string }[];

/** Spending analytics per account (joint accounts included), week or last 4 weeks. */
export function InsightsScreen() {
  const { c } = useTheme();
  const today = useToday();
  const range = useUiStore(st => st.insightsRange);
  const scope = useUiStore(st => st.insightsScope);
  const setRange = useUiStore(st => st.setInsightsRange);
  const setScope = useUiStore(st => st.setInsightsScope);
  const selectedDay = useUiStore(st => st.selectedDay) ?? today;
  const setSelectedDay = useUiStore(st => st.setSelectedDay);
  const accounts = useAccounts();
  const data = useInsights(range, scope, today);

  const chipAccounts = useMemo(() => accounts.filter(a => isTracked(a) && a.type !== 'cash'), [accounts]);
  const selectedIndex =
    range === 'week'
      ? Math.max(
          0,
          data.bars.findIndex(b => b.key === selectedDay),
        )
      : data.bars.length - 1;
  const period = range === 'week' ? formatDayRange(addDays(today, -6), today) : 'last 4 weeks';
  const prevLabel = range === 'week' ? 'vs last week' : 'vs prior 4 wks';
  const delta = data.prevTotal > 0 ? Math.round(((data.total - data.prevTotal) / data.prevTotal) * 100) : undefined;

  return (
    <ScreenScroll testID="insights-screen">
      <ScreenTitle
        overline="Spending by account"
        title="Insights"
        right={<Segment options={RANGES} value={range} onChange={setRange} testID="range-segment" />}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
        <Chip
          label="All accounts"
          active={scope === 'all'}
          onPress={() => setScope('all')}
          idleBg="surface"
          height={36}
          leading={<Tile size={24} radius={12} bg={c.accent} initials="ALL" fontSize={8} />}
        />
        {chipAccounts.map(a => {
          const t = accountTile(a);
          return (
            <Chip
              key={a.id}
              label={accountChipLabel(a)}
              active={scope === a.id}
              onPress={() => setScope(a.id)}
              idleBg="surface"
              height={36}
              leading={<Tile size={24} radius={12} bg={t.color} initials={t.initials} logo={t.logo} fontSize={9} />}
            />
          );
        })}
      </ScrollView>

      <Card radius={26} style={s.hero} testID="spend-hero">
        <Text variant="caption" color="ink3">
          Spent · {period}
        </Text>
        <View style={s.heroRow}>
          <Text variant="total" tnum>
            {formatINR(data.total)}
          </Text>
          {delta !== undefined ? (
            <View style={[s.delta, { backgroundColor: delta <= 0 ? c.posSoft : c.outSoft }]}>
              <Text variant="smallStrong" color={delta <= 0 ? 'pos' : 'out'}>
                {delta <= 0 ? '↓' : '↑'} {Math.abs(delta)}% {prevLabel}
              </Text>
            </View>
          ) : null}
        </View>
        <Text variant="meta" color="ink3" tnum>
          avg {formatINR(data.avgPerUnit)} / {range === 'week' ? 'day' : 'week'}
        </Text>
        <SpendBarChart
          bars={data.bars.map(b => ({
            key: b.key,
            label: b.label,
            value: b.spent,
          }))}
          selectedIndex={selectedIndex}
          average={data.avgPerUnit}
          onSelect={range === 'week' ? i => setSelectedDay(data.bars[i].key) : undefined}
        />
      </Card>

      <View style={s.pair}>
        <Card radius={20} style={s.stat}>
          <StatIcon icon="south_west" color={c.pos} size={30} />
          <Text variant="meta" color="ink3">
            Money in
          </Text>
          <Text variant="stat18" tnum>
            +{formatINR(data.moneyIn)}
          </Text>
        </Card>
        <Card radius={20} style={s.stat}>
          <StatIcon icon="savings" color={c.accent} size={30} />
          <Text variant="meta" color="ink3">
            {data.keptPct === undefined ? 'No income this period' : 'Kept of money in'}
          </Text>
          <Text variant="stat18" tnum>
            {data.keptPct === undefined ? '—' : `${Math.round(data.keptPct)}%`}
          </Text>
        </Card>
      </View>

      {scope === 'all' ? <ByAccountCard data={data} accounts={accounts} onPick={setScope} /> : null}
      <CategoriesCard data={data} />
      <TopMerchantsCard data={data} range={range} />
    </ScreenScroll>
  );
}

const ByAccountCard = memo(function ByAccountCard({
  data,
  accounts,
  onPick,
}: {
  data: Insights;
  accounts: readonly Account[];
  onPick: (scope: Scope) => void;
}) {
  const divider = useRowDivider();
  const rows = data.byAccount
    .map(b => ({ ...b, account: accounts.find(a => a.id === b.accountId) }))
    .filter((r): r is typeof r & { account: Account } => !!r.account);
  const max = Math.max(1, ...rows.map(r => r.spent));
  return (
    <Card style={s.card}>
      <View style={s.head}>
        <Text variant="section">By account</Text>
        <Text variant="meta" color="ink3">
          Tap a chip above to drill in
        </Text>
      </View>
      {rows.map((r, i) => {
        const t = accountTile(r.account);
        const sub =
          r.account.ownership === 'joint'
            ? `Joint${r.account.coHolder ? ` with ${r.account.coHolder}` : ''} · tracked separately`
            : `${r.account.type === 'credit_card' ? 'Card' : 'Personal'} · ••${r.account.mask}`;
        return (
          <Pressable
            key={r.accountId}
            style={[s.accountRow, i > 0 && divider]}
            onPress={() => onPick(r.accountId)}
            accessibilityRole="button"
            accessibilityLabel={`Show ${accountListName(r.account)}`}
          >
            <Tile size={34} radius={11} bg={t.color} initials={t.initials} logo={t.logo} fontSize={11} />
            <View style={s.flex}>
              <View style={s.head}>
                <Text variant="rowStrong">{accountListName(r.account)}</Text>
                <Text variant="rowValue" tnum>
                  {formatINR(r.spent)}
                </Text>
              </View>
              <ProgressBar value={(r.spent / max) * 100} color={t.color} />
              <Text variant="meta" color="ink3">
                {sub}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </Card>
  );
});

const CategoriesCard = memo(function CategoriesCard({ data }: { data: Insights }) {
  return (
    <Card style={s.card}>
      <Text variant="section">Categories</Text>
      <View style={s.donutRow}>
        <DonutChart
          segments={data.categories.map(x => ({
            key: x.categoryId,
            color: categoryVisual(x.categoryId).color,
            value: x.amount,
          }))}
        >
          <Text variant="meta" color="ink3">
            {plural(data.categories.length, 'category', 'categories')}
          </Text>
          <Text variant="rowValue" tnum>
            {formatINRShort(data.total)}
          </Text>
        </DonutChart>
        <View style={[s.flex, s.legend]}>
          {data.categories.slice(0, 6).map(x => {
            const v = categoryVisual(x.categoryId);
            return (
              <View key={x.categoryId} style={s.legendRow}>
                <View style={[s.swatch, { backgroundColor: v.color }]} />
                <Text variant="small" style={s.flex} numberOfLines={1}>
                  {v.def.name}
                </Text>
                <Text variant="smallStrong" tnum>
                  {Math.round(x.pct)}%
                </Text>
              </View>
            );
          })}
        </View>
      </View>
    </Card>
  );
});

const TopMerchantsCard = memo(function TopMerchantsCard({ data, range }: { data: Insights; range: InsightRange }) {
  const divider = useRowDivider();
  const when = range === 'week' ? 'this week' : 'in 4 weeks';
  return (
    <Card style={s.card}>
      <Text variant="section">Top merchants</Text>
      {data.topMerchants.length === 0 ? (
        <Text variant="meta" color="ink3">
          No spending in this period.
        </Text>
      ) : (
        data.topMerchants.map((m, i) => {
          const b = brandFor(m.name);
          return (
            <View key={m.name} style={[s.accountRow, i > 0 && divider]}>
              <Tile size={34} radius={11} bg={b.color} initials={b.initials} fontSize={11} />
              <View style={s.flex}>
                <Text variant="rowStrong" numberOfLines={1}>
                  {m.name}
                </Text>
                <Text variant="meta" color="ink3">
                  {plural(m.count, 'payment', 'payments')} {when}
                </Text>
              </View>
              <Text variant="rowValue" tnum>
                {formatINR(m.amount)}
              </Text>
            </View>
          );
        })
      )}
    </Card>
  );
});

const s = StyleSheet.create({
  chips: { gap: 6 },
  hero: { padding: 18, gap: 6 },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  delta: {
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 9,
    justifyContent: 'center',
  },
  pair: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, padding: 14, gap: 4 },
  card: { padding: 16, gap: 10 },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  flex: { flex: 1 },
  donutRow: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  legend: { gap: 8 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  swatch: { width: 8, height: 8, borderRadius: 4 },
});
