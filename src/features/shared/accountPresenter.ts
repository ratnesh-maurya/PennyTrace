import type { Account, AccountId, Scope } from '../../core/types';
import { maskAccount } from '../../core/money';
import { brandFor, type BrandTile } from '../../ui/theme/brand';

const BANK: Record<string, { short: string; label: string }> = {
  hdfc: { short: 'HDFC', label: 'HDFC Bank' },
  sbi: { short: 'SBI', label: 'SBI' },
  kotak: { short: 'Kotak', label: 'Kotak' },
  icici: { short: 'ICICI', label: 'ICICI Bank' },
  axis: { short: 'Axis', label: 'Axis Bank' },
  cash: { short: 'Cash', label: 'Cash' },
};

/** `HDFC`, `SBI`, `Kotak` — falls back to the upper-cased bank id. */
export function bankShort(bank: string): string {
  return BANK[bank]?.short ?? bank.toUpperCase();
}

/** `HDFC Bank`, `ICICI Bank` (evidence labels, reconciliation titles). */
export function bankLabel(bank: string): string {
  return BANK[bank]?.label ?? bank.toUpperCase();
}

/** Brand tile; joint accounts read `KJ` (Kotak Joint), like the design's Insights chips. */
export function accountTile(a: Account): BrandTile {
  const b = brandFor(a.bank);
  return a.ownership === 'joint' ? { ...b, initials: `${bankShort(a.bank)[0]}J` } : b;
}

/** `HDFC ••1234` — scope chips, meta lines. */
export function accountShortName(a: Account): string {
  return a.mask ? `${bankShort(a.bank)} ${maskAccount(a.mask)}` : a.displayName;
}

/** Name used in lists: `HDFC Savings`; cards append the mask (`ICICI Card ••4471`). */
export function accountListName(a: Account): string {
  return a.type === 'credit_card' ? `${a.displayName} ${maskAccount(a.mask)}` : a.displayName;
}

/** Insights chips: `HDFC`, `SBI`, joint accounts by display name (`Kotak Joint`). */
export function accountChipLabel(a: Account): string {
  return a.ownership === 'joint' ? a.displayName : bankShort(a.bank);
}

export function findAccount(accounts: readonly Account[], id: AccountId | undefined): Account | undefined {
  return id ? accounts.find(a => a.id === id) : undefined;
}

/** `All accounts` or the account's short name. */
export function scopeLabel(accounts: readonly Account[], scope: Scope): string {
  if (scope === 'all') {
    return 'All accounts';
  }
  const a = findAccount(accounts, scope);
  return a ? accountShortName(a) : scope;
}
