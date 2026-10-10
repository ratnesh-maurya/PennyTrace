import type { Account, AccountId, Scope } from '../../core/types';
import { maskAccount } from '../../core/money';
import { bankLogo, type BankLogo } from '../../ui/theme/bankLogos';
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

/**
 * Brand tile: the bank's logo when fetched locally (scripts/fetch-bank-logos.js), else brand
 * colour + initials. Joint accounts read `KJ` (Kotak Joint), like the design's Insights chips.
 */
export function accountTile(a: Account): BrandTile & { logo?: BankLogo } {
  const b = brandFor(a.bank);
  const logo = bankLogo(a.bank);
  return {
    ...b,
    ...(a.ownership === 'joint' ? { initials: `${bankShort(a.bank)[0]}J` } : {}),
    ...(logo ? { logo } : {}),
  };
}

/** `HDFC ••1234` — scope chips, meta lines. */
export function accountShortName(a: Account): string {
  return a.mask ? `${bankShort(a.bank)} ${maskAccount(a.mask)}` : a.displayName;
}

/** Name used in lists: `HDFC Savings`; cards append the mask (`ICICI Card ••4471`). */
export function accountListName(a: Account): string {
  const masked = maskAccount(a.mask);
  return a.type === 'credit_card' && a.mask && !a.displayName.includes(masked)
    ? `${a.displayName} ${masked}`
    : a.displayName;
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

/** Shown as a real account: not ignored by the user, and the SMS named its number. */
export function isTracked(a: Account): boolean {
  return !a.ignored && a.mask !== '';
}

/** Why an account is in "Not counted". */
export function notCountedReason(a: Account): string {
  if (a.ignored) {
    return 'You chose not to count it';
  }
  if (!a.mask) {
    return 'No account number in its alerts. Usually a payment app\u2019s copy of your bank\u2019s alert';
  }
  return a.ownership === 'joint' ? 'Joint account · tracked separately' : 'Left out of your totals';
}
