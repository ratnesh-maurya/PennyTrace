/**
 * Wording for the Daily close (recon chip, Moved stat, transfer note), derived
 * from the DailyClose view model. Pure functions.
 */
import { formatINR } from '../../core/money';
import type { Account, AccountId, DailyClose, DayKey } from '../../core/types';
import { formatSignedINR, formatTime } from '../../ui/format';
import type { IconName } from '../../ui/icons';
import { bankShort } from '../shared/accountPresenter';

export function closeReconLine(close: DailyClose, today: DayKey): { text: string; icon: IconName } {
  const r = close.reported;
  if (!r) {
    return { text: 'Calculated from SMS · no bank balance yet', icon: 'info' };
  }
  if (r.variance !== 0) {
    return { text: `Off by ${formatINR(Math.abs(r.variance))} vs bank`, icon: 'error' };
  }
  if (close.day !== today) {
    return { text: 'Matched bank balance at day end', icon: 'verified' };
  }
  const time = formatTime(r.at);
  return r.accountsMatched > 1
    ? { text: `Matches ${r.accountsMatched} bank balances · ${time}`, icon: 'verified' }
    : { text: `Matches bank · reported ${time}`, icon: 'verified' };
}

/** Moved stat: in "All", a day whose moves cancel out shows the gross amount moved. */
export function movedStatText(close: DailyClose): string {
  if (close.movedNet === 0 && close.scope === 'all' && close.movedGross > 0) {
    return formatINR(close.movedGross);
  }
  return formatSignedINR(close.movedNet);
}

const join = (parts: string[]) =>
  parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One or two sentences explaining the day's non-spending moves (design `xferNote`). */
export function describeMoves(close: DailyClose, accounts: readonly Account[], today: DayKey): string {
  if (close.transfers.length === 0) {
    return 'No transfers or card payments on this day.';
  }
  const byId = new Map<AccountId, Account>(accounts.map(a => [a.id, a]));
  const inScope = (id?: AccountId) => !!id && (close.scope === 'all' ? !!byId.get(id)?.includeInTotal : id === close.scope);
  const name = (id?: AccountId) => {
    const a = id ? byId.get(id) : undefined;
    return a ? (a.ownership === 'joint' ? a.displayName : bankShort(a.bank)) : 'another account';
  };
  const when = close.day === today ? ' today' : '';

  const internal: string[] = [];
  const settled: string[] = []; // card bills + ATM cash
  const transit: string[] = [];
  const sentOut: string[] = [];
  const receivedIn: string[] = [];
  let leaving = 0;

  for (const t of close.transfers) {
    const to = t.toAccountId ? byId.get(t.toAccountId) : undefined;
    const amt = formatINR(t.amount);
    const fromIn = inScope(t.fromAccountId);
    const toIn = inScope(t.toAccountId);
    if (fromIn && toIn) {
      internal.push(`${amt} moved ${name(t.fromAccountId)} → ${name(t.toAccountId)}${when}`);
    } else if (!fromIn && toIn) {
      receivedIn.push(`${amt} received from your ${name(t.fromAccountId)} account`);
    } else if (t.state === 'in_transit') {
      transit.push(`${amt} to ${name(t.toAccountId)}`);
      leaving += t.amount;
    } else if (to?.type === 'credit_card') {
      settled.push(`card bill ${amt}`);
      leaving += t.amount;
    } else if (to?.type === 'cash') {
      settled.push(`ATM cash ${amt}`);
      leaving += t.amount;
    } else {
      sentOut.push(`${amt} sent to your ${name(t.toAccountId)} account`);
      leaving += t.amount;
    }
  }

  const sentences: string[] = [];
  if (internal.length) {
    sentences.push(`${cap(join(internal))}. Excluded from income and spending.`);
  }
  if (close.scope === 'all') {
    const parts = [...settled, ...sentOut, ...transit.map(x => `${x} (in transit)`)];
    if (parts.length > 1) {
      sentences.push(`${formatINR(leaving)} left as non-spending: ${join(parts)}.`);
    } else if (parts.length === 1) {
      sentences.push(`${cap(parts[0])} — not counted as spending.`);
    }
  } else {
    if (sentOut.length) {
      sentences.push(`${cap(join(sentOut))}. Lowers this balance, not counted as spending.`);
    }
    if (receivedIn.length) {
      sentences.push(`${cap(join(receivedIn))}. Not counted as income.`);
    }
    if (settled.length) {
      sentences.push(`${cap(join(settled))} — moved, not spent.`);
    }
    if (transit.length) {
      sentences.push(`${cap(join(transit))} — waiting for the credit, not spending.`);
    }
  }
  if (close.scope !== 'all' && internal.length === 0 && sentences.length === 0) {
    return 'No transfers or card payments on this day.';
  }
  return sentences.join(' ');
}
