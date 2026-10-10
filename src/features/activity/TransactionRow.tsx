import React, { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { TxnListItem } from '../../app/data/types';
import { formatTime } from '../../ui/format';
import { Icon } from '../../ui/icons';
import { Badge, Text } from '../../ui/primitives';
import { useTheme, type Colors } from '../../ui/theme';
import { TxnTile } from '../shared/TxnTile';
import { formatTxnAmount, txnCategoryLabel, txnStatusBadge, txnTitle, type BadgeTone } from '../shared/txnPresenter';

const badgeColors = (tone: BadgeTone, c: Colors) =>
  ({
    warn: { bg: c.warnSoft, ink: c.warn },
    xfer: { bg: c.xferSoft, ink: c.xfer },
    neutral: { bg: c.surface2, ink: c.ink2 },
    pos: { bg: c.posSoft, ink: c.pos },
  }[tone]);

interface TransactionRowProps {
  item: TxnListItem;
  onPress: (id: string) => void;
}

/** One Activity row: tile, name (+ status badge), "category · time", amount and source icons. */
export const TransactionRow = memo(function TransactionRow({ item, onPress }: TransactionRowProps) {
  const { c } = useTheme();
  const { txn } = item;
  const badge = txnStatusBadge(txn);
  const amount = formatTxnAmount(txn);
  const amountColor = amount.tone === 'pos' ? c.pos : amount.tone === 'xfer' ? c.xfer : c.ink;
  return (
    <Pressable
      onPress={() => onPress(txn.id)}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={`${txnTitle(item)}, ${amount.text}`}
      testID={`txn-row-${txn.id}`}
    >
      <TxnTile txn={txn} size={42} radius={13} initialsSize={13} iconSize={21} ring />
      <View style={styles.text}>
        <View style={styles.titleRow}>
          <Text variant="bodyStrong" numberOfLines={1} style={styles.title}>
            {txnTitle(item)}
          </Text>
          {badge ? (
            <Badge label={badge.label} bg={badgeColors(badge.tone, c).bg} ink={badgeColors(badge.tone, c).ink} />
          ) : null}
        </View>
        <Text variant="meta" color="ink3" numberOfLines={1}>
          {txnCategoryLabel(item)} · {formatTime(txn.occurredAt)}
        </Text>
      </View>
      <View style={styles.right}>
        <Text variant="rowValue" tnum color={amountColor}>
          {amount.text}
        </Text>
        <View style={styles.sources}>
          {txn.sourceIds.map(id => (
            <Icon key={id} name="sms" size={13} color={c.ink3} />
          ))}
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 14 },
  text: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { flexShrink: 1 },
  right: { alignItems: 'flex-end', gap: 3 },
  sources: { flexDirection: 'row', gap: 3 },
});
