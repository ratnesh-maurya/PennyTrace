/**
 * Deterministic daily summary and the number allow-list for the LLM version.
 * Pure: no React Native imports.
 */
import { CATEGORY_BY_ID } from '../core/categories';
import { formatINR } from '../core/money';
import type { DailyClose, DayKey } from '../core/types';
import { AllowedNumbers, isPlainSentence } from './numbers';

/** `2026-10-09` → `9 Oct`. */
export function dayLabel(day: DayKey): string {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) {
    return day;
  }
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]}`;
}

function categoryName(id: string, names: Record<string, string>): string {
  return names[id] ?? CATEGORY_BY_ID[id]?.name ?? id;
}

/** Expense categories sorted by amount, largest first. */
export function topCategories(close: DailyClose): DailyClose['byCategory'] {
  return [...close.byCategory]
    .filter(c => c.amount > 0 && (CATEGORY_BY_ID[c.categoryId]?.group ?? 'expense') === 'expense')
    .sort((a, b) => b.amount - a.amount);
}

/**
 * Two or three plain sentences built only from the close's numbers.
 * `names` maps category ids (and optionally account ids) to display names.
 */
export function templateSummary(close: DailyClose, names: Record<string, string> = {}): string {
  const when = dayLabel(close.day);
  const parts: string[] = [];
  const cats = topCategories(close);

  if (close.spent === 0 && close.received === 0 && close.movedGross === 0) {
    parts.push(`No spending or income recorded on ${when}.`);
  } else {
    if (close.spent > 0) {
      const top = cats[0];
      const lead = `You spent ${formatINR(close.spent)} on ${when}`;
      if (top && top.amount * 2 >= close.spent) {
        parts.push(`${lead}, mostly on ${categoryName(top.categoryId, names)} (${formatINR(top.amount)}).`);
      } else if (top) {
        parts.push(`${lead}; the largest share was ${categoryName(top.categoryId, names)} (${formatINR(top.amount)}).`);
      } else {
        parts.push(`${lead}.`);
      }
    } else {
      parts.push(`No spending on ${when}.`);
    }
    const extra: string[] = [];
    if (close.received > 0) {
      extra.push(`You received ${formatINR(close.received)}`);
    }
    if (close.movedGross > 0) {
      extra.push(`${formatINR(close.movedGross)} moved between your accounts`);
    }
    if (extra.length) {
      parts.push(`${extra.join(' and ')}.`);
    }
  }

  const closingWord = close.closingProvenance === 'reported' ? 'Closing balance' : 'Calculated closing balance';
  let closing = `${closingWord}: ${formatINR(close.closing)}.`;
  if (close.reported && close.reported.variance !== 0) {
    closing = `${closingWord}: ${formatINR(close.closing)}; the bank reports ${formatINR(
      close.reported.closing,
    )}, a difference of ${formatINR(Math.abs(close.reported.variance))}.`;
  }
  parts.push(closing);
  return parts.join(' ');
}

/** Every number the summary may mention. */
export function summaryAllowedNumbers(close: DailyClose): AllowedNumbers {
  const allowed = new AllowedNumbers()
    .addAmount(close.opening)
    .addAmount(close.received)
    .addAmount(close.spent)
    .addAmount(close.movedNet)
    .addAmount(close.movedGross)
    .addAmount(close.closing)
    .addDay(close.day)
    .addCount(close.txnIds.length)
    .addCount(topCategories(close).length);
  if (close.reported) {
    allowed.addAmount(close.reported.closing).addAmount(close.reported.variance).addCount(close.reported.accountsMatched);
  }
  for (const c of close.byCategory) {
    allowed.addAmount(c.amount).addCount(c.count);
  }
  for (const t of close.transfers) {
    allowed.addAmount(t.amount);
  }
  return allowed;
}

/** Facts handed to the model: pre-formatted so it only has to copy them. */
export function summaryFacts(close: DailyClose, names: Record<string, string> = {}): Record<string, unknown> {
  return {
    day: dayLabel(close.day),
    spent: formatINR(close.spent),
    received: formatINR(close.received),
    moved_between_own_accounts: formatINR(close.movedGross),
    closing_balance: formatINR(close.closing),
    closing_is: close.closingProvenance,
    transactions: close.txnIds.length,
    top_categories: topCategories(close)
      .slice(0, 3)
      .map(c => ({ name: categoryName(c.categoryId, names), amount: formatINR(c.amount), count: c.count })),
    ...(close.reported && close.reported.variance !== 0
      ? { bank_reported_closing: formatINR(close.reported.closing), difference: formatINR(Math.abs(close.reported.variance)) }
      : {}),
  };
}

/** Accept the model's summary only if every number in it was provided. */
export function acceptSummary(text: string | undefined, close: DailyClose): boolean {
  return !!text && isPlainSentence(text, 360) && summaryAllowedNumbers(close).allows(text);
}
