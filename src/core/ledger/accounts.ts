/**
 * Account resolution: bank + last 4 digits → Account, created automatically and
 * then patched with the user's edits.
 *
 * - Account ids are `${bank}-${last4}` so they survive rebuilds and type edits.
 * - An alert without digits attaches to the bank's only known account, or to a
 *   `${bank}-unknown` placeholder when the bank has several (or none).
 * - Credit card when any alert names a card instrument or prints an available
 *   limit. (A debit card alert is indistinguishable here; the user fixes the type.)
 * - Joint accounts default to `includeInTotal: false`.
 */
import type { Account, AccountId, AccountType } from '../types';
import type { ParsedSource } from './dedupe';
import { cmpStr } from './util';

interface Observation {
  bank: string;
  last4?: string;
  card: boolean;
  wallet: boolean;
}

function observe(s: ParsedSource): Observation {
  const p = s.parsed;
  return {
    bank: p.bank.trim().toLowerCase() || 'unknown',
    last4: p.accountLast4?.trim() || undefined,
    card: p.instrument === 'card' || p.availableLimit !== undefined,
    wallet: p.instrument === 'wallet',
  };
}

export function accountIdFor(bank: string, last4: string | undefined): AccountId {
  return `${bank}-${last4 ?? 'unknown'}`;
}

function bankLabel(bank: string): string {
  return bank.length <= 5 ? bank.toUpperCase() : bank.charAt(0).toUpperCase() + bank.slice(1);
}

function defaultName(bank: string, type: AccountType, mask: string): string {
  const label = bankLabel(bank);
  if (!mask) {
    return `${label} (account unknown)`;
  }
  return type === 'credit_card' ? `${label} Card ••${mask}` : `${label} ••${mask}`;
}

export interface AccountResolver {
  accounts: Account[];
  /** Account for the alert that names the account of a transaction or balance. */
  resolve(source: ParsedSource): AccountId;
  byId: Map<AccountId, Account>;
}

export function resolveAccounts(namingSources: readonly ParsedSource[], edits: readonly Partial<Account>[]): AccountResolver {
  const seen = new Map<AccountId, { bank: string; last4?: string; card: boolean; wallet: boolean }>();
  const masksByBank = new Map<string, Set<string>>();

  for (const s of namingSources) {
    const o = observe(s);
    if (!o.last4) {
      continue;
    }
    const id = accountIdFor(o.bank, o.last4);
    const prev = seen.get(id);
    seen.set(id, { bank: o.bank, last4: o.last4, card: (prev?.card ?? false) || o.card, wallet: (prev?.wallet ?? false) || o.wallet });
    const set = masksByBank.get(o.bank) ?? new Set<string>();
    set.add(o.last4);
    masksByBank.set(o.bank, set);
  }

  const editById = new Map<string, Partial<Account>>();
  for (const e of edits) {
    if (e.id) {
      editById.set(e.id, { ...editById.get(e.id), ...e });
    }
  }

  const resolveObs = (o: Observation): AccountId => {
    if (o.last4) {
      return accountIdFor(o.bank, o.last4);
    }
    const masks = masksByBank.get(o.bank);
    if (masks && masks.size === 1) {
      return accountIdFor(o.bank, [...masks][0]);
    }
    return accountIdFor(o.bank, undefined);
  };

  for (const s of namingSources) {
    const o = observe(s);
    if (!o.last4) {
      const id = resolveObs(o);
      if (!seen.has(id)) {
        seen.set(id, { bank: o.bank, card: o.card, wallet: o.wallet });
      }
    }
  }

  const accounts: Account[] = [];
  const build = (id: AccountId, base: { bank: string; last4?: string; card: boolean; wallet: boolean } | undefined, edit: Partial<Account> | undefined): Account | undefined => {
    const bank = base?.bank ?? edit?.bank;
    if (!bank) {
      return undefined;
    }
    const mask = base?.last4 ?? edit?.mask ?? '';
    const autoType: AccountType = base?.card ? 'credit_card' : base?.wallet ? 'wallet' : 'savings';
    const type = edit?.type ?? autoType;
    const ownership = edit?.ownership ?? 'personal';
    const account: Account = {
      id,
      bank,
      type,
      ownership,
      mask,
      displayName: edit?.displayName ?? defaultName(bank, type, mask),
      upiIds: [...(edit?.upiIds ?? [])].map(u => u.trim().toLowerCase()).filter(Boolean).sort(cmpStr),
      aliases: [...(edit?.aliases ?? [])].map(a => a.trim()).filter(Boolean).sort(cmpStr),
      includeInTotal: edit?.includeInTotal ?? ownership !== 'joint',
    };
    const coHolder = edit?.coHolder;
    if (coHolder) {
      account.coHolder = coHolder;
    }
    return account;
  };

  for (const id of [...seen.keys()].sort(cmpStr)) {
    const a = build(id, seen.get(id), editById.get(id));
    if (a) {
      accounts.push(a);
    }
  }
  // Accounts the user created by hand (e.g. a cash wallet) that no SMS mentions yet.
  for (const id of [...editById.keys()].sort(cmpStr)) {
    if (!seen.has(id)) {
      const a = build(id, undefined, editById.get(id));
      if (a) {
        accounts.push(a);
      }
    }
  }
  accounts.sort((a, b) => cmpStr(a.id, b.id));

  return {
    accounts,
    resolve: s => resolveObs(observe(s)),
    byId: new Map(accounts.map(a => [a.id, a])),
  };
}
