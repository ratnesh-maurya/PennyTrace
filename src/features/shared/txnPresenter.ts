/**
 * Pure presentation rules for transactions (design: `decorate()` in
 * LedgerApp2.dc.html). No React, so they are unit-testable.
 */
import { CATEGORY_BY_ID } from '../../core/categories';
import { formatINR } from '../../core/money';
import type { SourceEvent, Transaction } from '../../core/types';
import type { TxnListItem } from '../../app/data/types';
import { formatDayMonth, dayKeyOf } from '../../ui/format';
import { toIconName, type IconName } from '../../ui/icons';
import { brandFor } from '../../ui/theme/brand';
import { bankLabel, bankShort } from './accountPresenter';

export type AmountTone = 'pos' | 'xfer' | 'ink';

/**
 * Signed amount text + colour tone per kind:
 * in/refund `+₹4,000` (pos) · xfer `₹5,000` (xfer, unsigned) · pending_xfer `−₹2,000` (xfer)
 * · everything else `−₹400` (ink). Paise shown only when non-zero.
 */
export function formatTxnAmount(t: Pick<Transaction, 'kind' | 'amount' | 'direction'>): {
  text: string;
  tone: AmountTone;
} {
  const abs = formatINR(t.amount, { paise: true });
  switch (t.kind) {
    case 'in':
    case 'refund':
      return { text: `+${abs}`, tone: 'pos' };
    case 'xfer':
      return { text: abs, tone: 'xfer' };
    case 'pending_xfer':
      return { text: `−${abs}`, tone: 'xfer' };
    default:
      return t.direction === 'credit' ? { text: `+${abs}`, tone: 'pos' } : { text: `−${abs}`, tone: 'ink' };
  }
}

export type BadgeTone = 'warn' | 'xfer' | 'neutral' | 'pos';

/** Review / Matched / In transit / Not spending / To cash / Refund. */
export function txnStatusBadge(t: Transaction): { label: string; tone: BadgeTone } | undefined {
  if (t.needsReview) {
    return { label: 'Review', tone: 'warn' };
  }
  switch (t.kind) {
    case 'xfer':
      return t.linkedTxnId ? { label: 'Matched', tone: 'xfer' } : { label: 'Not spending', tone: 'neutral' };
    case 'pending_xfer':
      return { label: 'In transit', tone: 'warn' };
    case 'liability':
      return { label: 'Not spending', tone: 'neutral' };
    case 'cash':
      return { label: 'To cash', tone: 'neutral' };
    case 'invest':
      return { label: 'Invested', tone: 'neutral' };
    case 'refund':
      return { label: 'Refund', tone: 'pos' };
    default:
      return undefined;
  }
}

const KIND_ICON: Partial<Record<Transaction['kind'], IconName>> = {
  xfer: 'swap_horiz',
  pending_xfer: 'schedule_send',
  liability: 'credit_card',
  cash: 'local_atm',
  invest: 'trending_up',
};

export type TxnTileSpec =
  | { type: 'icon'; icon: IconName; tone: 'warn' | 'xfer' | 'ink' }
  | { type: 'brand'; initials: string; color: string };

/** Moves get an icon tile; merchants and people get a brand tile. */
export function txnTile(t: Transaction): TxnTileSpec {
  const icon = KIND_ICON[t.kind];
  if (icon) {
    return { type: 'icon', icon, tone: t.kind === 'pending_xfer' ? 'warn' : t.kind === 'xfer' ? 'xfer' : 'ink' };
  }
  const b = brandFor(t.counterparty ?? '?');
  return { type: 'brand', initials: b.initials, color: b.color };
}

/** Row / header title. */
export function txnTitle(item: TxnListItem): string {
  const { txn } = item;
  if (txn.kind === 'xfer' && txn.linkedTxnId) {
    return 'Self transfer';
  }
  if (txn.kind === 'pending_xfer') {
    return `To ${txn.counterparty ?? 'own account'}`;
  }
  return txn.counterparty ?? 'Unknown';
}

/** What the row is, in words (design `cat`): category name, or the move's nature. */
export function txnCategoryLabel(item: TxnListItem): string {
  const { txn, account, counterAccount, linked } = item;
  switch (txn.kind) {
    case 'xfer':
      if (counterAccount) {
        return txn.direction === 'debit'
          ? `${bankShort(account.bank)} → ${bankShort(counterAccount.bank)}`
          : `${bankShort(counterAccount.bank)} → ${bankShort(account.bank)}`;
      }
      return 'Not an expense';
    case 'pending_xfer':
      return 'Awaiting credit';
    case 'refund':
      return linked ? `Refund · order of ${formatDayMonth(dayKeyOf(linked.occurredAt))}` : 'Refund';
    case 'liability':
      return 'Liability settlement';
    case 'cash':
      return 'Moved to cash';
    default:
      return CATEGORY_BY_ID[txn.categoryId]?.name ?? 'Other';
  }
}

/** Icon for the category card in Detail. */
export function txnCategoryIcon(t: Transaction): IconName {
  switch (t.kind) {
    case 'xfer':
    case 'pending_xfer':
      return 'swap_horiz';
    case 'refund':
      return 'undo';
    case 'liability':
      return 'credit_card';
    case 'cash':
      return 'payments';
    default:
      return toIconName(CATEGORY_BY_ID[t.categoryId]?.icon);
  }
}

/** `own accounts` for a collapsed transfer, else `HDFC ••1234`. */
export function txnAccountLabel(item: TxnListItem): string {
  if (item.txn.kind === 'xfer' && item.counterAccount) {
    return 'own accounts';
  }
  const a = item.account;
  return a.mask ? `${bankShort(a.bank)}${a.type === 'credit_card' ? ' Card' : ''} ••${a.mask}` : a.displayName;
}

/** Reference line in the meta card: `UPI 428193720116`, `UTR …`, or the bank's own ref. */
export function txnReference(t: Transaction): string {
  if (t.refs.upi) {
    return `UPI ${t.refs.upi}`;
  }
  if (t.refs.utr) {
    return `UTR ${t.refs.utr}`;
  }
  return t.refs.other ?? '—';
}

const SENDER_BANK: [RegExp, string][] = [
  [/HDFC/i, 'hdfc'],
  [/SBI/i, 'sbi'],
  [/ICICI/i, 'icici'],
  [/KOTAK/i, 'kotak'],
  [/AXIS/i, 'axis'],
];

/** `HDFC Bank · SMS`. */
export function sourceLabel(src: SourceEvent): string {
  const bank = src.parsed?.bank ?? SENDER_BANK.find(([re]) => re.test(src.sender))?.[1];
  const who = bank ? bankLabel(bank) : src.sender;
  return `${who} · ${src.sourceKind === 'sms' ? 'SMS' : src.sourceKind}`;
}

export function sourceIcon(src: Pick<SourceEvent, 'sourceKind'>): IconName {
  // v1 evidence is SMS only; notification / mail icons are ready for later sources.
  return src.sourceKind === 'sms' ? 'sms' : 'notifications';
}
