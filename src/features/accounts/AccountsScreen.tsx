import { useNavigation } from '@react-navigation/native';
import React, { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { setAccountIgnored } from '../../app/data/actions';
import {
  useCardStatuses,
  useAccounts,
  usePosition,
  useReconciliation,
  useToday,
  useTransferPairs,
} from '../../app/data/hooks';
import type { TransferPairView } from '../../app/data/types';
import { showToast } from '../../app/stores/toast';
import { useClosingSheetStore } from '../../app/stores/ui';
import { formatINR } from '../../core/money';
import type { Account, AccountRecon } from '../../core/types';
import { dayKeyOf, formatDayShort, formatRelativeInline, formatSignedINR } from '../../ui/format';
import { Icon } from '../../ui/icons';
import { Card, ScreenScroll, ScreenTitle, SectionHeading, Text, Tile } from '../../ui/primitives';
import { useTheme } from '../../ui/theme';
import { CardsCard } from '../cards/CardsCard';
import { accountListName, accountTile, findAccount, isTracked, notCountedReason } from '../shared/accountPresenter';

/** Ledger vs. bank-reported balances. Variances are reported, never silently fixed. */
export function AccountsScreen() {
  const { c } = useTheme();
  const today = useToday();
  const accounts = useAccounts();
  const recons = useReconciliation();
  const position = usePosition();
  const pairs = useTransferPairs();
  const cashCount = accounts.filter(a => a.includeInTotal && a.type !== 'credit_card' && a.type !== 'cash').length;
  const notCounted = accounts.filter(a => !isTracked(a));
  const cardStatuses = useCardStatuses();
  const navigation = useNavigation();
  const openClosing = useClosingSheetStore(st => st.open);

  const ignore = async (a: Account) => {
    await setAccountIgnored(a.id, true);
    showToast(`Not counting ${accountListName(a)} · restore it under Not counted`);
  };

  return (
    <ScreenScroll testID="accounts-screen">
      <ScreenTitle overline="Ledger vs. bank-reported balances" title="Reconciliation" />

      <View style={[s.position, { backgroundColor: c.ink }]} testID="position-card">
        <View style={s.row}>
          <Text variant="labelStrong" color={c.bg} style={s.flex}>
            Full financial position
          </Text>
          <Icon name="info" size={18} color={c.bg} />
        </View>
        <Text variant="position" tnum color={c.bg}>
          {formatINR(position.net)}
        </Text>
        <View style={s.positionGrid}>
          <View style={s.flex}>
            <Text variant="meta" color={c.bg} style={s.muted}>
              Cash in {cashCount} {cashCount === 1 ? 'account' : 'accounts'}
            </Text>
            <Text variant="stat16" tnum color={c.bg}>
              {formatINR(position.cash)}
            </Text>
          </View>
          <View style={s.flex}>
            <Text variant="meta" color={c.bg} style={s.muted}>
              Card dues
            </Text>
            <Text variant="stat16" tnum color={c.bg}>
              {formatSignedINR(-position.cardDues)}
            </Text>
          </View>
        </View>
      </View>

      {recons.map(r => {
        const a = findAccount(accounts, r.accountId);
        return a && isTracked(a) && a.type !== 'credit_card' ? (
          <ReconCard
            key={r.accountId}
            account={a}
            recon={r}
            onIgnore={() => ignore(a)}
            onSetBalance={() => openClosing(today, a.id)}
            onOpen={() => navigation.navigate('AccountDetail', { accountId: a.id })}
          />
        ) : null;
      })}

      <CardsCard
        accounts={accounts.filter(isTracked)}
        statuses={cardStatuses}
        onOpen={accountId => navigation.navigate('AccountDetail', { accountId })}
      />

      <SectionHeading title="Own-account transfers" aside="Not income · not spending" />
      {pairs.length === 0 ? (
        <Text variant="meta" color="ink3">
          No transfers between your accounts yet.
        </Text>
      ) : (
        pairs.map(p => <TransferPairCard key={p.id} pair={p} accounts={accounts} today={today} />)
      )}

      {notCounted.length > 0 ? (
        <>
          <SectionHeading title="Not counted" aside="Left out of totals" />
          <Card style={s.card} testID="not-counted">
            {notCounted.map(a => (
              <NotCountedRow
                key={a.id}
                account={a}
                onToggle={() => (a.ignored ? setAccountIgnored(a.id, false) : ignore(a))}
              />
            ))}
          </Card>
        </>
      ) : null}
    </ScreenScroll>
  );
}

const NotCountedRow = memo(function NotCountedRow({ account, onToggle }: { account: Account; onToggle: () => void }) {
  const t = accountTile(account);
  return (
    <View style={s.row}>
      <Tile size={34} radius={11} bg={t.color} initials={t.initials} logo={t.logo} fontSize={11} />
      <View style={s.flex}>
        <Text variant="rowStrong">{accountListName(account)}</Text>
        <Text variant="meta" color="ink3">
          {notCountedReason(account)}
        </Text>
      </View>
      <Pressable onPress={onToggle} accessibilityRole="button" hitSlop={8} testID={`toggle-${account.id}`}>
        <Text variant="chip" color="accent">
          {account.ignored ? 'Count again' : "Don't count"}
        </Text>
      </Pressable>
    </View>
  );
});

const ReconCard = memo(function ReconCard({
  account,
  recon,
  onIgnore,
  onSetBalance,
  onOpen,
}: {
  account: Account;
  recon: AccountRecon;
  onIgnore: () => void;
  onSetBalance: () => void;
  onOpen: () => void;
}) {
  const { c } = useTheme();
  const t = accountTile(account);
  const off = recon.status === 'off';
  const subtitle =
    account.ownership === 'joint'
      ? `Joint ••${account.mask}${account.coHolder ? ` · with ${account.coHolder}` : ''}`
      : `${account.type === 'credit_card' ? 'Card' : account.type === 'current' ? 'Current' : 'Savings'} ••${
          account.mask
        }`;
  const day = (ms: number) => formatDayShort(dayKeyOf(ms));
  const when = recon.reportedAt !== undefined ? day(recon.reportedAt) : '';
  const missing = recon.variance ?? 0;
  const since = recon.previousReportedAt !== undefined ? day(recon.previousReportedAt) : 'the start';
  const note =
    recon.status === 'unknown'
      ? 'The bank has not printed a balance in its SMS yet, so this is calculated from alerts.'
      : off
      ? `${
          missing < 0 ? `${formatINR(-missing)} left this account` : `${formatINR(missing)} came in`
        } between ${since} and ${when} without an SMS we could read. The balance above starts from the bank's ${when} figure, so it is not affected. We never invent a transaction to close the gap.`
      : `Matches the bank's balance of ${when}.`;
  const hasReport = recon.status !== 'unknown';
  const cells = hasReport
    ? [
        { label: `Bank said · ${when}`, value: formatINR(recon.reported ?? 0) },
        { label: 'SMS add up to', value: formatINR(recon.calculated) },
        { label: 'Missing', value: formatSignedINR(missing) },
      ]
    : [];
  return (
    <Card style={s.card}>
      <View style={s.row}>
        <Tile size={38} radius={12} bg={t.color} initials={t.initials} logo={t.logo} fontSize={12} />
        <View style={s.flex}>
          <Text variant="rowStrong">{accountListName(account)}</Text>
          <Text variant="meta" color="ink3">
            {subtitle}
          </Text>
        </View>
        <View
          style={[
            s.status,
            {
              backgroundColor: off ? c.warnSoft : recon.status === 'unknown' ? c.surface2 : c.accentSoft,
            },
          ]}
        >
          <Icon
            name={off ? 'error' : recon.status === 'unknown' ? 'info' : 'check_circle'}
            size={14}
            color={off ? c.warn : recon.status === 'unknown' ? c.ink2 : c.accent}
            fill
          />
          <Text variant="metaStrong" color={off ? 'warn' : recon.status === 'unknown' ? 'ink2' : 'accent'}>
            {off
              ? `Off by ${formatINR(Math.abs(recon.variance ?? 0))}`
              : recon.status === 'unknown'
              ? 'Not reported'
              : 'Reconciled'}
          </Text>
        </View>
      </View>
      <View style={s.row}>
        <Text variant="meta" color="ink3" style={s.flex}>
          Balance now
        </Text>
        <Text variant="stat18" tnum color={(recon.current ?? recon.calculated) < 0 ? 'warn' : 'ink'}>
          {formatINR(recon.current ?? recon.calculated)}
        </Text>
      </View>
      {hasReport ? (
        <View style={[s.grid, { backgroundColor: c.surface2 }]}>
          {cells.map(cell => (
            <View key={cell.label} style={s.flex}>
              <Text variant="meta" color="ink3">
                {cell.label}
              </Text>
              <Text variant="rowValue" tnum color={cell.label === 'Missing' && off ? 'warn' : 'ink'}>
                {cell.value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      <Text variant="meta" color="ink3">
        {note}
      </Text>
      <View style={s.actions}>
        <Pressable onPress={onOpen} accessibilityRole="button" hitSlop={8} testID={`open-${account.id}`}>
          <Text variant="chip" color="accent">
            Transactions
          </Text>
        </Pressable>
        {/* SMS can't explain a negative savings balance or a mismatch: let the user anchor it once. */}
        {account.type !== 'credit_card' && (recon.status !== 'reconciled' || recon.calculated < 0) ? (
          <Pressable onPress={onSetBalance} accessibilityRole="button" hitSlop={8} testID={`set-balance-${account.id}`}>
            <Text variant="chip" color="accent">
              Set closing balance
            </Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onIgnore} accessibilityRole="button" hitSlop={8} testID={`ignore-${account.id}`}>
          <Text variant="chip" color="ink3">
            Don't count
          </Text>
        </Pressable>
      </View>
    </Card>
  );
});

const TransferPairCard = memo(function TransferPairCard({
  pair,
  accounts,
  today,
}: {
  pair: TransferPairView;
  accounts: readonly Account[];
  today: string;
}) {
  const { c } = useTheme();
  const from = findAccount(accounts, pair.fromAccountId);
  const to = findAccount(accounts, pair.toAccountId);
  const matched = pair.state === 'matched';
  const tone = matched ? c.xfer : c.warn;
  const end = (a: Account | undefined, waiting: boolean) => {
    if (waiting || !a) {
      return (
        <View style={s.end}>
          <Tile size={36} radius={11} bg={c.surface2} ink={c.ink3} icon="hourglass_top" iconSize={18} />
          <Text variant="meta" color="ink3" numberOfLines={1}>
            {a ? `${accountListName(a)}` : 'Own account'}
          </Text>
        </View>
      );
    }
    const t = accountTile(a);
    return (
      <View style={s.end}>
        <Tile size={36} radius={11} bg={t.color} initials={t.initials} logo={t.logo} fontSize={11} />
        <Text variant="meta" color="ink3" numberOfLines={1}>
          ••{a.mask}
        </Text>
      </View>
    );
  };
  return (
    <Card style={s.card}>
      <View style={s.pairRow}>
        {end(from, false)}
        <View style={s.link}>
          <View style={[s.line, { borderColor: tone, borderStyle: matched ? 'solid' : 'dashed' }]} />
          <View
            style={[
              s.linkPill,
              matched
                ? { backgroundColor: c.xferSoft }
                : {
                    borderColor: c.warn,
                    borderWidth: 1,
                    backgroundColor: c.surface,
                  },
            ]}
          >
            <Icon name={matched ? 'link' : 'schedule'} size={14} color={tone} />
            <Text variant="metaStrong" tnum color={matched ? 'xfer' : 'warn'}>
              {formatINR(pair.amount)}
            </Text>
          </View>
        </View>
        {end(to, !matched)}
      </View>
      <View style={s.row}>
        <Icon name={matched ? 'check_circle' : 'pending'} size={16} color={matched ? c.accent : c.warn} fill />
        <Text variant="meta" color="ink2" style={s.flex}>
          {matched
            ? `Debit and credit matched${pair.ref ? ` by ${pair.ref}` : ''} · ${formatRelativeInline(
                pair.creditAt ?? pair.debitAt,
                today,
              )}`
            : `Debit seen ${formatRelativeInline(
                pair.debitAt,
                today,
              )}. Held as in transit until the credit arrives — never counted as spending.`}
        </Text>
      </View>
    </Card>
  );
});

const s = StyleSheet.create({
  position: { borderRadius: 26, padding: 18, gap: 8 },
  positionGrid: { flexDirection: 'row', gap: 12, marginTop: 6 },
  muted: { opacity: 0.7 },
  card: { padding: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1 },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 26,
    borderRadius: 13,
    paddingHorizontal: 9,
  },
  grid: { flexDirection: 'row', borderRadius: 14, padding: 12, gap: 8 },
  pairRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  end: { alignItems: 'center', gap: 4, width: 72 },
  link: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  line: { position: 'absolute', left: 0, right: 0, borderTopWidth: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  linkPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 26,
    borderRadius: 13,
    paddingHorizontal: 10,
  },
});
