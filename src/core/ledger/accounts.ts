/**
 * Account resolution: bank + last 4 digits → Account, created automatically and
 * then patched with the user's edits. Rules (all order-independent):
 *
 * 1. Account ids are `${bank}-${last4}` so they survive rebuilds and type edits.
 * 2. Same last 4 digits at two banks: the bank with far more alerts owns the account.
 *    UPI apps send alerts in their own name about the user's other bank accounts
 *    ("Dear SBI UPI User, ur A/cX7433 credited" for a Bank of Baroda account).
 * 3. A number seen only on debit-card alerts ("withdrawn from HDFC Bank Card x0533 …
 *    BLOCK DC 0533") is the card of the bank's savings account: the only one, or the one
 *    with far more alerts than any other.
 * 4. An alert without digits attaches to the bank's only account of the matching kind
 *    (credit card / wallet / bank account), else to a `${bank}-unknown` placeholder.
 *    Placeholders are left out of totals: they are usually a payment app's copy of an
 *    alert the user's own bank also sent.
 * 5. Credit card when any alert carries credit-card evidence (`hints.isCreditCard`) or
 *    prints an available limit. Joint and ignored accounts default to `includeInTotal: false`.
 */
import type { Account, AccountId, AccountType } from '../types';
import type { ParsedSource } from './dedupe';
import { cmpStr } from './util';

interface Observation {
  bank: string;
  last4?: string;
  /** Credit-card evidence. */
  card: boolean;
  /** Card instrument without credit-card evidence: a debit card. */
  debitCard: boolean;
  wallet: boolean;
}

interface Seen {
  bank: string;
  last4?: string;
  card: boolean;
  wallet: boolean;
  alerts: number;
  debitCardAlerts: number;
}

/** How much busier an account must be to absorb a sparse one (cross-bank copies, debit cards). */
const CROSS_BANK_DOMINANCE = 4;

function observe(s: ParsedSource): Observation {
  const p = s.parsed;
  const card = p.hints.isCreditCard === true || p.availableLimit !== undefined;
  return {
    bank: p.bank.trim().toLowerCase() || 'unknown',
    last4: p.accountLast4?.trim() || undefined,
    card,
    debitCard: p.instrument === 'card' && !card,
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

const kindOf = (s: Pick<Seen, 'card' | 'wallet'>): 'card' | 'wallet' | 'bank' =>
  s.card ? 'card' : s.wallet ? 'wallet' : 'bank';

export function resolveAccounts(
  namingSources: readonly ParsedSource[],
  edits: readonly Partial<Account>[],
): AccountResolver {
  // ---- 1. Numbered accounts as the alerts name them -------------------------------------
  const seen = new Map<AccountId, Seen>();
  for (const s of namingSources) {
    const o = observe(s);
    if (!o.last4) {
      continue;
    }
    const id = accountIdFor(o.bank, o.last4);
    const prev = seen.get(id) ?? {
      bank: o.bank,
      last4: o.last4,
      card: false,
      wallet: false,
      alerts: 0,
      debitCardAlerts: 0,
    };
    seen.set(id, {
      ...prev,
      card: prev.card || o.card,
      wallet: prev.wallet || o.wallet,
      alerts: prev.alerts + 1,
      debitCardAlerts: prev.debitCardAlerts + (o.debitCard ? 1 : 0),
    });
  }

  // ---- 2. Canonical ids: merge UPI-app copies and debit-card numbers ---------------------
  const alias = new Map<AccountId, AccountId>();
  const ids = [...seen.keys()].sort(cmpStr);
  const busier = (a: AccountId, b: AccountId) => seen.get(b)!.alerts - seen.get(a)!.alerts || cmpStr(a, b);

  const byDigits = new Map<string, AccountId[]>();
  for (const id of ids) {
    const d = seen.get(id)!.last4!;
    byDigits.set(d, [...(byDigits.get(d) ?? []), id]);
  }
  for (const group of byDigits.values()) {
    if (group.length < 2) {
      continue;
    }
    const [owner] = [...group].sort(busier);
    for (const id of group) {
      if (id !== owner && seen.get(id)!.alerts * CROSS_BANK_DOMINANCE <= seen.get(owner)!.alerts) {
        alias.set(id, owner);
      }
    }
  }

  const canonical = (id: AccountId): AccountId => alias.get(id) ?? id;
  const bankAccounts = (bank: string, kind?: ReturnType<typeof kindOf>) =>
    ids.filter(id => !alias.has(id) && seen.get(id)!.bank === bank && (!kind || kindOf(seen.get(id)!) === kind));

  for (const id of ids) {
    const s = seen.get(id)!;
    if (alias.has(id) || s.card || s.wallet || s.debitCardAlerts !== s.alerts) {
      continue;
    }
    const others = bankAccounts(s.bank, 'bank')
      .filter(x => x !== id && seen.get(x)!.debitCardAlerts !== seen.get(x)!.alerts)
      .sort(busier);
    // The bank's only savings account, or one that clearly dominates (a stray one-off number
    // such as a mandate reference must not block the merge).
    const [main, next] = others;
    if (main && (!next || seen.get(next)!.alerts * CROSS_BANK_DOMINANCE <= seen.get(main)!.alerts)) {
      alias.set(id, main);
    }
  }

  // ---- 3. Alerts without digits ----------------------------------------------------------
  const resolveObs = (o: Observation): AccountId => {
    if (o.last4) {
      return canonical(accountIdFor(o.bank, o.last4));
    }
    const sameKind = bankAccounts(o.bank, kindOf(o));
    if (sameKind.length === 1) {
      return sameKind[0];
    }
    const any = bankAccounts(o.bank);
    if (any.length === 1) {
      return any[0];
    }
    return accountIdFor(o.bank, undefined);
  };

  const placeholders = new Map<AccountId, Seen>();
  for (const s of namingSources) {
    const o = observe(s);
    if (o.last4) {
      continue;
    }
    const id = resolveObs(o);
    if (!seen.has(id) && !placeholders.has(id)) {
      placeholders.set(id, { bank: o.bank, card: o.card, wallet: o.wallet, alerts: 0, debitCardAlerts: 0 });
    }
  }

  // ---- 4. Build accounts and apply the user's edits --------------------------------------
  const editById = new Map<string, Partial<Account>>();
  for (const e of edits) {
    if (e.id) {
      editById.set(e.id, { ...editById.get(e.id), ...e });
    }
  }

  const build = (id: AccountId, base: Seen | undefined, edit: Partial<Account> | undefined): Account | undefined => {
    const bank = base?.bank ?? edit?.bank;
    if (!bank) {
      return undefined;
    }
    const mask = base?.last4 ?? edit?.mask ?? '';
    const autoType: AccountType = base?.card ? 'credit_card' : base?.wallet ? 'wallet' : 'savings';
    const type = edit?.type ?? autoType;
    const ownership = edit?.ownership ?? 'personal';
    const ignored = edit?.ignored === true;
    const account: Account = {
      id,
      bank,
      type,
      ownership,
      mask,
      displayName: edit?.displayName ?? defaultName(bank, type, mask),
      upiIds: [...(edit?.upiIds ?? [])]
        .map(u => u.trim().toLowerCase())
        .filter(Boolean)
        .sort(cmpStr),
      aliases: [...(edit?.aliases ?? [])]
        .map(a => a.trim())
        .filter(Boolean)
        .sort(cmpStr),
      // Ignored accounts never count; placeholders without a number don't count unless the user says so.
      includeInTotal: ignored ? false : edit?.includeInTotal ?? (ownership !== 'joint' && mask !== ''),
    };
    if (edit?.coHolder) {
      account.coHolder = edit.coHolder;
    }
    if (edit?.creditLimit !== undefined) {
      account.creditLimit = edit.creditLimit;
    }
    if (ignored) {
      account.ignored = true;
    }
    return account;
  };

  const accounts: Account[] = [];
  const built = new Set<AccountId>();
  for (const id of [...ids.filter(x => !alias.has(x)), ...placeholders.keys()].sort(cmpStr)) {
    const a = build(id, seen.get(id) ?? placeholders.get(id), editById.get(id));
    if (a) {
      accounts.push(a);
      built.add(id);
    }
  }
  // Accounts the user created by hand (e.g. a cash wallet) that no SMS mentions yet.
  for (const id of [...editById.keys()].sort(cmpStr)) {
    if (!built.has(id) && !alias.has(id)) {
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
