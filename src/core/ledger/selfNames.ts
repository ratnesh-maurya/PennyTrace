/**
 * Who the user is, learned from their own alerts, and who their family is.
 *
 * - A person's name printed on *both* legs of a reference-matched move between two of the user's
 *   accounts is the user ("transfer from RATNESH MAURYA" into SBI, "sent to RATNESH MAURYA" from
 *   Bank of Baroda, same UPI ref). Payments to that name are then self transfers.
 * - A different first name with the user's surname ("RASMI MAURYA") is family: "Sent home".
 */
import type { AccountResolver } from './accounts';
import type { Draft } from './draft';
import { isVoid } from './draft';
import { nameTokens, strongRefs } from './util';

/** Words in bank labels ("UPI Credit", "IMPS Transfer"), never in a person's name. */
const LABEL_WORDS = new Set([
  'upi',
  'imps',
  'neft',
  'rtgs',
  'credit',
  'debit',
  'transfer',
  'payment',
  'pay',
  'account',
  'bank',
  'card',
  'wallet',
  'cash',
  'deposit',
  'refund',
  'salary',
  'interest',
  'self',
  'your',
  'from',
  'to',
]);

/** A plausible person's name: 2–4 alphabetic words, none of them a banking label. */
function personTokens(name: string | undefined): string[] | undefined {
  const tokens = nameTokens(name);
  const ok =
    tokens.length >= 2 && tokens.length <= 4 && tokens.every(t => /^[a-z]{2,}$/.test(t) && !LABEL_WORDS.has(t));
  return ok ? tokens : undefined;
}

export function inferSelfNames(drafts: readonly Draft[], resolver: AccountResolver): string[] {
  const isBankAccount = (d: Draft) => {
    const t = resolver.byId.get(d.accountId)?.type;
    return t !== undefined && t !== 'credit_card';
  };
  const byRef = new Map<string, Draft[]>();
  for (const d of drafts) {
    if (isVoid(d) || !isBankAccount(d)) {
      continue;
    }
    for (const r of strongRefs(d.refs)) {
      byRef.set(r.value, [...(byRef.get(r.value) ?? []), d]);
    }
  }
  const names = new Set<string>();
  for (const group of byRef.values()) {
    const debit = group.find(d => d.direction === 'debit');
    const credit = group.find(d => d.direction === 'credit' && debit && d.accountId !== debit.accountId);
    if (!debit || !credit || debit.amount !== credit.amount) {
      continue;
    }
    for (const leg of [debit, credit]) {
      const tokens = personTokens(leg.counterparty);
      if (tokens) {
        names.add(tokens.join(' '));
      }
    }
  }
  return [...names].sort();
}

/** True for a person with the user's surname but another first name. */
export function familyMatcher(selfNames: readonly string[]): (counterparty: string | undefined) => boolean {
  const selves = selfNames.map(n => nameTokens(n)).filter(t => t.length >= 2);
  const surnames = new Set(selves.map(t => t[t.length - 1]).filter(s => s.length >= 3));
  const firstNames = new Set(selves.map(t => t[0]));
  return counterparty => {
    const tokens = personTokens(counterparty);
    if (!tokens || surnames.size === 0) {
      return false;
    }
    return surnames.has(tokens[tokens.length - 1]) && !firstNames.has(tokens[0]);
  };
}
