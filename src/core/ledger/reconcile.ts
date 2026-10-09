/**
 * Reconciliation and overall position.
 *
 * reconcile: per account, the latest bank-reported balance vs. what the ledger
 * calculates at that same moment, walking forward from the previous report (or
 * from the first report itself when there is only one). `variance = reported −
 * calculated`. A variance is shown, never covered with an invented transaction.
 *
 * position: cash = current balances of included non-card accounts; card dues =
 * what included cards owe. Card alerts print an available limit but never the
 * credit limit, so dues are derived from the card's own transactions (spends −
 * payments − refunds since tracking began), floored at 0.
 */
import type { AccountId, AccountRecon, EpochMs, Ledger, Paise, Position } from '../types';
import { balanceAt, currentBalance, timelines } from './balances';

export function reconcile(ledger: Ledger): AccountRecon[] {
  const tls = timelines(ledger);
  return ledger.accounts.map(account => {
    const tl = tls.get(account.id)!;
    const last = tl.snapshots[tl.snapshots.length - 1];
    if (!last || account.type === 'credit_card') {
      return { accountId: account.id, calculated: currentBalance(tl), status: 'unknown' as const };
    }
    const { balance: calculated } = balanceAt(tl, last.key);
    const variance = last.snap.reported - calculated;
    return {
      accountId: account.id,
      calculated,
      reported: last.snap.reported,
      reportedAt: last.snap.at,
      variance,
      status: variance === 0 ? ('reconciled' as const) : ('off' as const),
    };
  });
}

/** Calculated balance of one account now, or just after `at`. */
export function accountBalance(ledger: Ledger, accountId: AccountId, at?: EpochMs): Paise {
  const tl = timelines(ledger).get(accountId);
  if (!tl) {
    return 0;
  }
  return at === undefined ? currentBalance(tl) : balanceAt(tl, [at, '￿', 2]).balance;
}

export function position(ledger: Ledger): Position {
  const tls = timelines(ledger);
  let cash = 0;
  let cardDues = 0;
  for (const a of ledger.accounts) {
    if (!a.includeInTotal) {
      continue;
    }
    const bal = currentBalance(tls.get(a.id)!);
    if (a.type === 'credit_card') {
      cardDues += Math.max(0, -bal);
    } else {
      cash += bal;
    }
  }
  return { cash, cardDues, net: cash - cardDues };
}
