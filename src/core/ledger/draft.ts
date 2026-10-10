/** Mutable working shape of a transaction while the ledger is being built. */
import type {
  AccountId,
  Direction,
  Paise,
  ParseHints,
  TransferLink,
  TxnId,
  TxnKind,
  TxnRefs,
  TxnStatus,
} from '../types';
import type { ParsedSource, SourceGroup } from './dedupe';
import { lifecycleStatus } from './dedupe';
import { normRef } from './util';

export interface Draft {
  sources: ParsedSource[];
  primary: ParsedSource;
  /** Source that named the account (primary when it carries the last 4 digits). */
  accountSource: ParsedSource;
  accountId: AccountId;
  amount: Paise;
  direction: Direction;
  occurredAt: number;
  status: TxnStatus;
  refs: TxnRefs;
  counterparty?: string;
  vpa?: string;
  hints: ParseHints;
  parserId: string;
  mergeReason?: string;
  stableKey: string;
  id: TxnId;
  kind?: TxnKind;
  /** Kind set by the user; automatic matching leaves it alone. */
  kindFixed: boolean;
  linkedTxnId?: TxnId;
  transferMethod?: TransferLink['method'];
  /** A credit that reverses an earlier debit (as opposed to a merchant refund). */
  reversal: boolean;
}

function mergeHints(sources: ParsedSource[], primary: ParsedSource): ParseHints {
  const h: ParseHints = {};
  const keys = [
    'isAtmWithdrawal',
    'isCardBillPayment',
    'isRefund',
    'isReversal',
    'isSalary',
    'isInvestment',
    'isEmandate',
  ] as const;
  for (const k of keys) {
    if (sources.some(s => s.parsed.hints[k])) {
      h[k] = true;
    }
  }
  const last4 =
    primary.parsed.hints.counterAccountLast4 ??
    sources.find(s => s.parsed.hints.counterAccountLast4)?.parsed.hints.counterAccountLast4;
  if (last4) {
    h.counterAccountLast4 = last4;
  }
  return h;
}

function mergeRefs(sources: ParsedSource[], primary: ParsedSource): TxnRefs {
  const ordered = [primary, ...sources.filter(s => s !== primary)];
  const refs: TxnRefs = {};
  for (const s of ordered) {
    refs.upi ??= normRef(s.parsed.refs.upi);
    refs.utr ??= normRef(s.parsed.refs.utr);
    refs.other ??= normRef(s.parsed.refs.other);
  }
  for (const k of ['upi', 'utr', 'other'] as const) {
    if (refs[k] === undefined) {
      delete refs[k];
    }
  }
  return refs;
}

export function draftFromGroup(group: SourceGroup): Omit<Draft, 'accountId' | 'stableKey' | 'id'> {
  const { sources, primary } = group;
  const p = primary.parsed;
  const accountSource = p.accountLast4
    ? primary
    : sources.find(s => s.parsed.accountLast4 && s.parsed.bank === p.bank) ??
      sources.find(s => s.parsed.accountLast4) ??
      primary;
  const others = [primary, ...sources.filter(s => s !== primary)];
  return {
    sources,
    primary,
    accountSource,
    amount: p.amount,
    direction: p.direction,
    occurredAt: p.occurredAt,
    status: lifecycleStatus(sources),
    refs: mergeRefs(sources, primary),
    counterparty: others.find(s => s.parsed.counterparty?.trim())?.parsed.counterparty?.trim(),
    vpa: others
      .find(s => s.parsed.vpa?.trim())
      ?.parsed.vpa?.trim()
      .toLowerCase(),
    hints: mergeHints(sources, primary),
    parserId: p.parserId,
    mergeReason: group.mergeReason,
    kindFixed: false,
    reversal: false,
  };
}

/** Failed alerts, and debits whose own alert chain ended in "reversed", move no money. */
export function isVoid(d: { status: TxnStatus; linkedTxnId?: TxnId }): boolean {
  return d.status === 'failed' || (d.status === 'reversed' && !d.linkedTxnId);
}
