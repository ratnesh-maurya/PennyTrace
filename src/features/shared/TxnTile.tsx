import React, { memo } from 'react';
import type { Transaction } from '../../core/types';
import { Tile } from '../../ui/primitives';
import { useTheme } from '../../ui/theme';
import { FIXED } from '../../ui/theme/palette';
import { txnTile } from './txnPresenter';

interface TxnTileProps {
  txn: Transaction;
  /** 42 row · 64 detail header · 40 quick check · 44 sheet header. */
  size: number;
  radius: number;
  initialsSize: number;
  iconSize: number;
  /** Inset 1px line ring (rows and detail header). */
  ring?: boolean;
  /** Extra drop shadow (detail header). */
  drop?: boolean;
}

/** Brand tile with initials for merchants and people; tinted icon tile for moves. */
export const TxnTile = memo(function TxnTile({ txn, size, radius, initialsSize, iconSize, ring, drop }: TxnTileProps) {
  const { c } = useTheme();
  const spec = txnTile(txn);
  const shadows = [ring ? `inset 0 0 0 1px ${c.line}` : null, drop ? FIXED.detailTileDrop : null].filter(Boolean);
  const shadow = shadows.length ? shadows.join(', ') : undefined;
  if (spec.type === 'icon') {
    const bg = spec.tone === 'warn' ? c.warnSoft : c.surface2;
    const ink = spec.tone === 'warn' ? c.warn : spec.tone === 'xfer' ? c.xfer : c.ink;
    return <Tile size={size} radius={radius} bg={bg} ink={ink} icon={spec.icon} iconSize={iconSize} shadow={shadow} />;
  }
  return (
    <Tile
      size={size}
      radius={radius}
      bg={spec.color}
      initials={spec.initials}
      fontSize={initialsSize}
      shadow={shadow}
    />
  );
});
