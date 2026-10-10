/**
 * Spending insights for a week (7 day bars) or a month (4 week bars) ending on
 * `anchorDay`.
 *
 * Spending = `spend` + `fee` that moved money and were not reversed — the same
 * rule as "Spent" in the daily close. Unlike the daily close, scope `all` here
 * includes credit cards with includeInTotal: card purchases are real spending,
 * and their bill payments are `liability`, so nothing is counted twice.
 * Money in = kind `in` only (refunds and own transfers are not income).
 */
import type {
  Account,
  AccountId,
  CategoryId,
  DayKey,
  InsightRange,
  Insights,
  Ledger,
  Paise,
  Scope,
  Transaction,
} from '../types';
import { addDays, dayKey, monthDayLabel, weekdayShort } from '../time';
import { bucketOf } from './dailyClose';
import { cmpStr, signed } from './util';

function insightAccounts(ledger: Ledger, scope: Scope): Account[] {
  return scope === 'all' ? ledger.accounts.filter(a => a.includeInTotal) : ledger.accounts.filter(a => a.id === scope);
}

function spentOf(t: Transaction): Paise {
  return bucketOf(t) === 'spent' ? -signed(t.amount, t.direction) : 0;
}

function receivedOf(t: Transaction): Paise {
  return bucketOf(t) === 'received' ? signed(t.amount, t.direction) : 0;
}

export function insights(ledger: Ledger, range: InsightRange, scope: Scope, anchorDay: DayKey): Insights {
  const accounts = insightAccounts(ledger, scope);
  const ids = new Set(accounts.map(a => a.id));
  const units = range === 'week' ? 7 : 4;
  const unitDays = range === 'week' ? 1 : 7;
  const span = units * unitDays;
  const first = addDays(anchorDay, -(span - 1));
  const prevFirst = addDays(first, -span);

  const txns = ledger.transactions.filter(t => ids.has(t.accountId));
  const dayOf = new Map(txns.map(t => [t.id, dayKey(t.occurredAt)]));
  const inRange = txns.filter(t => {
    const d = dayOf.get(t.id)!;
    return d >= first && d <= anchorDay;
  });
  const prevTotal = txns.reduce((sum, t) => {
    const d = dayOf.get(t.id)!;
    return d >= prevFirst && d < first ? sum + spentOf(t) : sum;
  }, 0);

  const bars: Insights['bars'] = [];
  for (let i = 0; i < units; i++) {
    const start = addDays(first, i * unitDays);
    const end = addDays(start, unitDays - 1);
    const spent = inRange.reduce((sum, t) => {
      const d = dayOf.get(t.id)!;
      return d >= start && d <= end ? sum + spentOf(t) : sum;
    }, 0);
    bars.push({ key: start, label: range === 'week' ? weekdayShort(start) : monthDayLabel(start), spent });
  }

  const total = bars.reduce((s, b) => s + b.spent, 0);
  const moneyIn = inRange.reduce((s, t) => s + receivedOf(t), 0);

  const byAccountMap = new Map<AccountId, Paise>(accounts.map(a => [a.id, 0]));
  const catMap = new Map<CategoryId, Paise>();
  const merchants = new Map<string, { name: string; amount: Paise; count: number }>();
  for (const t of inRange) {
    const s = spentOf(t);
    if (bucketOf(t) !== 'spent') {
      continue;
    }
    byAccountMap.set(t.accountId, (byAccountMap.get(t.accountId) ?? 0) + s);
    catMap.set(t.categoryId, (catMap.get(t.categoryId) ?? 0) + s);
    if (t.counterparty) {
      const key = t.counterparty.toLowerCase();
      const m = merchants.get(key) ?? { name: t.counterparty, amount: 0, count: 0 };
      m.amount += s;
      m.count++;
      merchants.set(key, m);
    }
  }

  const result: Insights = {
    range,
    scope,
    bars,
    total,
    avgPerUnit: Math.round(total / units),
    prevTotal,
    moneyIn,
    byAccount: [...byAccountMap.entries()]
      .map(([accountId, spent]) => ({ accountId, spent }))
      .sort((a, b) => b.spent - a.spent || cmpStr(a.accountId, b.accountId)),
    categories: [...catMap.entries()]
      .map(([categoryId, amount]) => ({ categoryId, amount, pct: total > 0 ? Math.round((amount / total) * 100) : 0 }))
      .sort((a, b) => b.amount - a.amount || cmpStr(a.categoryId, b.categoryId)),
    topMerchants: [...merchants.values()]
      .sort((a, b) => b.amount - a.amount || b.count - a.count || cmpStr(a.name, b.name))
      .slice(0, 5),
  };
  if (moneyIn > 0) {
    result.keptPct = Math.max(0, Math.min(100, Math.round(((moneyIn - total) / moneyIn) * 100)));
  }
  return result;
}
