/**
 * Credit cards, shown on their own: how much of the limit is used, and what was charged on
 * a day. Card balances never enter the cash closing balance (see dailyClose).
 */
import type { AccountId, DayKey, Ledger, Paise } from '../types';
import { dayKey } from '../time';
import { currentBalance, movesMoney, timelines } from './balances';

export interface CardStatus {
  accountId: AccountId;
  /** Owed now (positive). */
  used: Paise;
  /** Credit limit, when known (set by the user or read from several available-limit alerts). */
  limit?: Paise;
  /** Limit − used, when the limit is known. */
  available?: Paise;
}

export function cardStatuses(ledger: Ledger): CardStatus[] {
  const tls = timelines(ledger);
  return ledger.accounts
    .filter(a => a.type === 'credit_card' && !a.ignored)
    .map(a => {
      const used = Math.max(0, -currentBalance(tls.get(a.id)!));
      const limit = a.creditLimit;
      return {
        accountId: a.id,
        used,
        ...(limit !== undefined ? { limit, available: Math.max(0, limit - used) } : {}),
      };
    });
}

export interface CardSpend {
  accountId: AccountId;
  amount: Paise;
  count: number;
}

/** What was charged to each card on `day` (spend and fees; failed and reversed charges excluded). */
export function cardSpendOn(ledger: Ledger, day: DayKey): CardSpend[] {
  const cards = new Set(ledger.accounts.filter(a => a.type === 'credit_card' && !a.ignored).map(a => a.id));
  const out = new Map<AccountId, CardSpend>();
  for (const t of ledger.transactions) {
    if (!cards.has(t.accountId) || dayKey(t.occurredAt) !== day || !movesMoney(t)) {
      continue;
    }
    if ((t.kind === 'spend' || t.kind === 'fee') && t.status !== 'reversed') {
      const prev = out.get(t.accountId) ?? { accountId: t.accountId, amount: 0, count: 0 };
      out.set(t.accountId, { ...prev, amount: prev.amount + t.amount, count: prev.count + 1 });
    }
  }
  return [...out.values()].sort((a, b) => (a.accountId < b.accountId ? -1 : 1));
}
