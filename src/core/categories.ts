import type { CategoryId } from './types';

export interface CategoryDef {
  id: CategoryId;
  name: string;
  /** Material Symbols Rounded icon name. */
  icon: string;
  color: string;
  /** Counts as spending when used on a `spend` transaction. */
  group: 'expense' | 'income' | 'movement';
  /** Created by the user in the app. */
  custom?: boolean;
}

/** Seed categories. Colors for the first seven come from the Ledger design palette. */
export const CATEGORIES: readonly CategoryDef[] = [
  { id: 'food', name: 'Food & dining', icon: 'restaurant', color: '#FF6B2C', group: 'expense' },
  { id: 'travel', name: 'Travel', icon: 'local_taxi', color: '#00A6FB', group: 'expense' },
  { id: 'bills', name: 'Bills & utilities', icon: 'bolt', color: '#8B5CF6', group: 'expense' },
  { id: 'shopping', name: 'Shopping', icon: 'shopping_bag', color: '#FF3D81', group: 'expense' },
  { id: 'groceries', name: 'Groceries', icon: 'local_grocery_store', color: '#12B886', group: 'expense' },
  { id: 'entertainment', name: 'Entertainment', icon: 'movie', color: '#F5B000', group: 'expense' },
  { id: 'rent', name: 'Rent & home', icon: 'home', color: '#3B6BFF', group: 'expense' },
  { id: 'fuel', name: 'Fuel', icon: 'local_gas_station', color: '#E8590C', group: 'expense' },
  { id: 'health', name: 'Health', icon: 'medical_services', color: '#E03131', group: 'expense' },
  { id: 'personal', name: 'Personal care', icon: 'spa', color: '#C2255C', group: 'expense' },
  { id: 'education', name: 'Education', icon: 'school', color: '#1971C2', group: 'expense' },
  { id: 'emi', name: 'EMI & loans', icon: 'account_balance', color: '#5F3DC4', group: 'expense' },
  { id: 'investments', name: 'Investments', icon: 'trending_up', color: '#2B8A3E', group: 'movement' },
  { id: 'gift', name: 'Gift', icon: 'redeem', color: '#D6336C', group: 'expense' },
  { id: 'people', name: 'Sent to people', icon: 'person', color: '#6A4FA3', group: 'expense' },
  { id: 'family', name: 'Sent home', icon: 'family_home', color: '#F08C00', group: 'expense' },
  { id: 'fees', name: 'Fees & charges', icon: 'receipt', color: '#868E96', group: 'expense' },
  { id: 'salary', name: 'Salary', icon: 'payments', color: '#0EA371', group: 'income' },
  { id: 'income', name: 'Money received', icon: 'south_west', color: '#0EA371', group: 'income' },
  { id: 'refund', name: 'Refund', icon: 'undo', color: '#0EA371', group: 'income' },
  { id: 'transfer', name: 'Self transfer', icon: 'swap_horiz', color: '#7C3AED', group: 'movement' },
  { id: 'card_payment', name: 'Card bill', icon: 'credit_card', color: '#7C3AED', group: 'movement' },
  { id: 'cash', name: 'Cash withdrawal', icon: 'local_atm', color: '#7C3AED', group: 'movement' },
  { id: 'other', name: 'Other', icon: 'more_horiz', color: '#8790A5', group: 'expense' },
] as const;

const registry: Record<CategoryId, CategoryDef> = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));
let custom: CategoryDef[] = [];

/** Built-in categories plus the user's own (see `setCustomCategories`). */
export const CATEGORY_BY_ID: Readonly<Record<CategoryId, CategoryDef>> = registry;

/**
 * Registers the user's own categories (replacing the previous set). Called by `buildLedger` with
 * its input and by the app after loading, so rules, corrections and screens all know them.
 * Ids that clash with a built-in category are ignored.
 */
export function setCustomCategories(defs: readonly CategoryDef[]): void {
  for (const c of custom) {
    delete registry[c.id];
  }
  custom = defs.filter(d => !CATEGORIES.some(b => b.id === d.id)).map(d => ({ ...d, custom: true }));
  for (const c of custom) {
    registry[c.id] = c;
  }
}

/** Built-in categories, then the user's own. */
export function allCategories(): readonly CategoryDef[] {
  return [...CATEGORIES, ...custom];
}

/** Id for a new category named by the user: `custom-<slug>` (a counter keeps it unique). */
export function customCategoryId(name: string, taken: readonly CategoryId[]): CategoryId {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'category';
  let id = `custom-${slug}`;
  for (let n = 2; taken.includes(id); n++) {
    id = `custom-${slug}-${n}`;
  }
  return id;
}

export const UNCATEGORIZED: CategoryId = 'other';
