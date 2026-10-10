import React, { memo, useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { markAsTransfer } from '../../app/data/actions';
import { useToday, useTransaction } from '../../app/data/hooks';
import type { TxnDetail } from '../../app/data/types';
import type { RootScreenProps } from '../../app/navigation/types';
import { showToast } from '../../app/stores/toast';
import { useCorrectionStore } from '../../app/stores/ui';
import { CATEGORY_BY_ID } from '../../core/categories';
import type { SourceEvent } from '../../core/types';
import { dayKeyOf, formatDayShort, formatRelativeInline, formatTime, plural } from '../../ui/format';
import { Icon } from '../../ui/icons';
import {
  Button,
  Card,
  ConfidenceBar,
  EmptyState,
  IconButton,
  Text,
  Tile,
  confidenceInk,
  confidenceLabel,
  confidenceLevel,
  useRowDivider,
} from '../../ui/primitives';
import { categoryVisual, useTheme, useThemedStyles, type Theme } from '../../ui/theme';
import { TxnTile } from '../shared/TxnTile';
import {
  formatTxnAmount,
  sourceIcon,
  sourceLabel,
  txnAccountLabel,
  txnCategoryIcon,
  txnCategoryLabel,
  txnReference,
  txnTitle,
} from '../shared/txnPresenter';

/** "Three alerts, one transaction": the evidence behind a ledger row is visible, not hidden. */
export function TransactionDetailScreen({ route, navigation }: RootScreenProps<'TransactionDetail'>) {
  const s = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const item = useTransaction(route.params.txnId);

  return (
    <View style={[s.screen, { paddingTop: insets.top }]} testID="detail-screen">
      <View style={s.appBar}>
        <IconButton icon="arrow_back" onPress={navigation.goBack} accessibilityLabel="Back" />
      </View>
      {item ? (
        <DetailBody item={item} />
      ) : (
        <View style={s.missing}>
          <EmptyState icon="info" message="This transaction is no longer in the ledger." />
        </View>
      )}
    </View>
  );
}

const DetailBody = memo(function DetailBody({ item }: { item: TxnDetail }) {
  const s = useThemedStyles(makeStyles);
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const today = useToday();
  const openCorrection = useCorrectionStore(st => st.open);
  const { txn } = item;
  const amount = formatTxnAmount(txn);
  const amountColor = amount.tone === 'pos' ? c.pos : amount.tone === 'xfer' ? c.xfer : c.ink;
  const movement = CATEGORY_BY_ID[txn.categoryId]?.group === 'movement';
  const canMarkTransfer = txn.direction === 'debit' && (txn.kind === 'spend' || txn.kind === 'fee');

  const onMarkTransfer = useCallback(async () => {
    await markAsTransfer(txn.id);
    showToast('Marked as a transfer · not counted as spending');
  }, [txn.id]);

  return (
    <ScrollView
      contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 24 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={s.header}>
        <TxnTile txn={txn} size={64} radius={20} initialsSize={20} iconSize={30} ring drop />
        <Text variant="section" align="center">
          {txnTitle(item)}
        </Text>
        <Text variant="amount" tnum color={amountColor}>
          {amount.text}
        </Text>
        <Text variant="meta" color="ink3">
          {formatDayShort(dayKeyOf(txn.occurredAt))} · {formatTime(txn.occurredAt)} · {txnAccountLabel(item)}
        </Text>
      </View>

      <CategoryCard item={item} onEdit={movement ? undefined : () => openCorrection(txn.id)} />
      <EvidenceTimeline sources={item.sources} today={today} />

      {txn.mergeReason ? (
        <View style={[s.callout, { backgroundColor: c.accentSoft }]}>
          <Icon name="join" size={18} color={c.accent} />
          <Text variant="bodySmall" color="ink2" style={s.flex}>
            {txn.mergeReason}
          </Text>
        </View>
      ) : null}

      <MetaCard item={item} />

      <View style={s.actions}>
        {!movement ? (
          <Button
            label="Change category"
            tone="ink"
            height={48}
            flex
            onPress={() => openCorrection(txn.id)}
            testID="change-category"
          />
        ) : null}
        {canMarkTransfer ? (
          <Button
            label="Mark as transfer"
            tone="outline"
            height={48}
            flex
            onPress={onMarkTransfer}
            testID="mark-transfer"
          />
        ) : null}
      </View>
    </ScrollView>
  );
});

const CategoryCard = memo(function CategoryCard({ item, onEdit }: { item: TxnDetail; onEdit?: () => void }) {
  const s = useThemedStyles(makeStyles);
  const { c } = useTheme();
  const { txn } = item;
  const v = categoryVisual(txn.categoryId);
  const level = confidenceLevel(txn.confidence);
  return (
    <Card style={s.card}>
      <View style={s.row}>
        <Tile size={36} radius={11} bg={v.soft} ink={v.color} icon={txnCategoryIcon(txn)} iconSize={20} iconFill />
        <View style={s.flex}>
          <Text variant="meta" color="ink3">
            Category
          </Text>
          <Text variant="rowStrong">{txnCategoryLabel(item)}</Text>
        </View>
        {onEdit ? <IconButton icon="edit" onPress={onEdit} accessibilityLabel="Change category" /> : null}
      </View>
      <View style={s.confRow}>
        <Text variant="meta" color="ink3" style={s.flex} numberOfLines={2}>
          {txn.ruleProvenance}
        </Text>
        <Text variant="metaStrong" color={confidenceInk(level, c)}>
          {confidenceLabel(txn.confidence)}
        </Text>
      </View>
      <ConfidenceBar confidence={txn.confidence} />
    </Card>
  );
});

const EvidenceTimeline = memo(function EvidenceTimeline({ sources, today }: { sources: SourceEvent[]; today: string }) {
  const s = useThemedStyles(makeStyles);
  const { c } = useTheme();
  return (
    <Card style={s.card}>
      <View style={s.row}>
        <Text variant="section" style={s.flex}>
          Evidence
        </Text>
        <Text variant="meta" color="ink3">
          {plural(sources.length, 'alert', 'alerts')} → 1 transaction
        </Text>
      </View>
      {sources.map((src, i) => (
        <View key={src.id} style={s.step}>
          <View style={s.rail}>
            <Tile size={30} radius={10} bg={c.surface2} ink={c.ink2} icon={sourceIcon(src)} iconSize={16} />
            {i < sources.length - 1 ? <View style={[s.connector, { backgroundColor: c.line2 }]} /> : null}
          </View>
          <View style={[s.flex, s.stepBody]}>
            <View style={s.row}>
              <Text variant="labelStrong" style={s.flex}>
                {sourceLabel(src)}
              </Text>
              <Text variant="meta" color="ink3">
                {formatRelativeInline(src.receivedAt, today)}
              </Text>
            </View>
            {src.body ? (
              <View style={[s.raw, { backgroundColor: c.surface2 }]}>
                <Text variant="mono" color="ink2" selectable>
                  {src.body}
                </Text>
              </View>
            ) : (
              <Text variant="meta" color="ink3">
                Raw message discarded after parsing.
              </Text>
            )}
          </View>
        </View>
      ))}
    </Card>
  );
});

const MetaCard = memo(function MetaCard({ item }: { item: TxnDetail }) {
  const s = useThemedStyles(makeStyles);
  const divider = useRowDivider();
  const rows = [
    { label: 'Reference', value: txnReference(item.txn) },
    { label: 'Parser', value: item.txn.parserId },
  ];
  return (
    <Card style={s.card}>
      {rows.map((r, i) => (
        <View key={r.label} style={[s.metaRow, i > 0 && divider]}>
          <Text variant="label" color="ink3">
            {r.label}
          </Text>
          <Text variant="monoSmall" selectable numberOfLines={1} style={s.metaValue}>
            {r.value}
          </Text>
        </View>
      ))}
    </Card>
  );
});

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.c.bg },
    appBar: { height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 },
    missing: { padding: 18 },
    content: { paddingHorizontal: 18, gap: 14 },
    header: { alignItems: 'center', gap: 6, paddingVertical: 8 },
    card: { padding: 16, gap: 12 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    flex: { flex: 1 },
    confRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    step: { flexDirection: 'row', gap: 12 },
    rail: { alignItems: 'center' },
    connector: { width: 2, flex: 1, marginTop: 4 },
    stepBody: { gap: 6, paddingBottom: 6 },
    raw: { borderRadius: 10, padding: 10 },
    callout: { flexDirection: 'row', gap: 10, padding: 14, borderRadius: 18, alignItems: 'flex-start' },
    metaRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 10,
      gap: 16,
    },
    metaValue: { flexShrink: 1 },
    actions: { flexDirection: 'row', gap: 8 },
  });
