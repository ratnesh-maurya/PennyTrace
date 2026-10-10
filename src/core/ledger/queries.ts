/** Read-side queries over a built ledger: review queue and search. */
import { parseAmountToPaise } from '../money';
import type { Ledger, Transaction } from '../types';
import { cmpStr } from './util';

function newestFirst(a: Transaction, b: Transaction): number {
  return b.occurredAt - a.occurredAt || cmpStr(a.id, b.id);
}

/** Transactions waiting for the user's category, newest first. */
export function reviewQueue(ledger: Ledger): Transaction[] {
  return ledger.transactions.filter(t => t.needsReview).sort(newestFirst);
}

/**
 * Search by counterparty, VPA, reference or amount, newest first.
 * A numeric query (`500`, `₹1,250.50`, `rs 349`) matches that exact amount and
 * also references containing those digits.
 */
export function searchTransactions(ledger: Ledger, query: string): Transaction[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [];
  }
  const numeric = /^(₹|rs\.?|inr)?\s*[\d,]+(\.\d{1,2})?$/i.test(q);
  const amount = numeric ? parseAmountToPaise(q) : undefined;
  const digits = q.replace(/[^0-9a-z]/g, '');
  return ledger.transactions
    .filter(t => {
      if (amount !== undefined && t.amount === amount) {
        return true;
      }
      if (t.counterparty?.toLowerCase().includes(q) || t.vpa?.toLowerCase().includes(q)) {
        return true;
      }
      const refs = [t.refs.upi, t.refs.utr, t.refs.other].filter((r): r is string => !!r).map(r => r.toLowerCase());
      return digits.length >= 3 && refs.some(r => r.includes(digits));
    })
    .sort(newestFirst);
}
