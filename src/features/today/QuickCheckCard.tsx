import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { CATEGORY_BY_ID } from '../../core/categories';
import { formatINR } from '../../core/money';
import type { Transaction } from '../../core/types';
import { Button, Text } from '../../ui/primitives';
import { useTheme } from '../../ui/theme';
import { TxnTile } from '../shared/TxnTile';

interface QuickCheckCardProps {
  txn: Transaction;
  onConfirm: () => void;
  onChange: () => void;
}

/** Low-confidence category: ask instead of guessing. */
export const QuickCheckCard = memo(function QuickCheckCard({ txn, onConfirm, onChange }: QuickCheckCardProps) {
  const { c } = useTheme();
  const category = CATEGORY_BY_ID[txn.categoryId]?.name ?? 'this category';
  // "Other" is not a guess worth confirming: ask what it was instead.
  const noGuess = txn.categoryId === 'other';
  const lower = category.toLowerCase();
  return (
    <View style={[styles.card, { backgroundColor: c.warnSoft }]} testID="quick-check">
      <View style={styles.head}>
        <TxnTile txn={txn} size={40} radius={12} initialsSize={13} iconSize={20} />
        <View style={styles.text}>
          <Text variant="eyebrow" color="warn">
            Quick check · {txn.confidence}% sure
          </Text>
          <Text variant="bodyStrong">
            {formatINR(txn.amount)} at {(txn.counterparty ?? 'this merchant').toUpperCase()} —{' '}
            {noGuess ? 'what was it?' : `is this ${lower}?`}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        {noGuess ? (
          <Button label="Pick a category" tone="ink" height={40} flex onPress={onChange} testID="quick-check-pick" />
        ) : (
          <>
            <Button label={`Yes, ${lower}`} tone="ink" height={40} flex onPress={onConfirm} testID="quick-check-yes" />
            <Button label="Change" tone="outline" height={40} flex onPress={onChange} testID="quick-check-change" />
          </>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: { borderRadius: 22, padding: 14, gap: 12 },
  head: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  text: { flex: 1, gap: 3 },
  actions: { flexDirection: 'row', gap: 8 },
});
