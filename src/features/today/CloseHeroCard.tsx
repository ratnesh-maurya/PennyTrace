import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatINR } from '../../core/money';
import type { DailyClose, DayKey } from '../../core/types';
import { CloseWaterfall } from '../../ui/charts';
import { Icon } from '../../ui/icons';
import { HeroSurface, Text } from '../../ui/primitives';
import { ON_HERO } from '../../ui/theme';
import { closeReconLine } from './closePresenter';

interface CloseHeroCardProps {
  close: DailyClose;
  scopeLabel: string;
  today: DayKey;
}

/** Closing balance on the accent gradient, with the recon badge and the day's waterfall. */
export const CloseHeroCard = memo(function CloseHeroCard({ close, scopeLabel, today }: CloseHeroCardProps) {
  const recon = closeReconLine(close, today);
  return (
    <HeroSurface radius={28} shadow glows style={styles.card} testID="close-hero">
      <Text variant="caption" color={ON_HERO.textMuted}>
        Closing balance · {scopeLabel}
      </Text>
      <Text variant="display" color={ON_HERO.text} tnum style={styles.amount}>
        {formatINR(close.closing)}
      </Text>
      <View style={styles.badge}>
        <Icon name={recon.icon} size={14} color={ON_HERO.text} fill />
        <Text variant="metaStrong" color={ON_HERO.text}>
          {recon.text}
        </Text>
      </View>
      {/* Card purchases did not touch cash, so the cash waterfall excludes them. */}
      <CloseWaterfall
        opening={close.opening}
        received={close.received}
        spent={close.spent - close.spentOnCard}
        closing={close.closing}
        movedNet={close.movedNet}
      />
    </HeroSurface>
  );
});

const styles = StyleSheet.create({
  card: { paddingTop: 20, paddingHorizontal: 20, paddingBottom: 16, gap: 6 },
  amount: { marginTop: 2 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    height: 24,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: ON_HERO.chip,
    marginBottom: 10,
  },
});
