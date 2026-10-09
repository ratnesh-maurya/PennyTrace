/**
 * Chat: constrained query intent + a PURE executor over the derived Ledger.
 * The model only fills the intent; every number comes from executeIntent.
 * No React Native imports, no SQL, no LLM.
 */
import { CATEGORY_BY_ID } from '../core/categories';
import { formatINR, maskAccount } from '../core/money';
import type { Account, AccountId, CategoryId, DayKey, EpochMs, Ledger, Paise, Transaction, TxnKind } from '../core/types';
import { AllowedNumbers, isPlainSentence } from './numbers';
import { CATEGORY_IDS, isObject, type JsonSchema } from './schemas';

export const METRICS = ['spent', 'received', 'balance', 'count', 'top_merchants', 'by_category'] as const;
export const RANGE_PRESETS = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'last_n_days',
] as const;
export const GROUP_BYS = ['day', 'week', 'category', 'merchant', 'account'] as const;

export type Metric = (typeof METRICS)[number];
export type RangePreset = (typeof RANGE_PRESETS)[number];
export type GroupBy = (typeof GROUP_BYS)[number];

export interface QueryIntent {
  metric: Metric;
  range: { preset: RangePreset; n?: number };
  /** Free text from the question: bank, nickname or last 4 digits. Resolved fuzzily. */
  accounts?: string[];
  categories?: CategoryId[];
  counterparty?: string;
  groupBy?: GroupBy;
}

const nullable = (s: JsonSchema): JsonSchema => ({ anyOf: [s, { type: 'null' }] });

export const INTENT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    metric: { type: 'string', enum: METRICS },
    range: {
      type: 'object',
      properties: {
        preset: { type: 'string', enum: RANGE_PRESETS },
        n: nullable({ type: 'integer', minimum: 1, maximum: 365 }),
      },
      required: ['preset', 'n'],
      additionalProperties: false,
    },
    accounts: nullable({ type: 'array', items: { type: 'string', maxLength: 40 }, maxItems: 4 }),
    categories: nullable({ type: 'array', items: { type: 'string', enum: CATEGORY_IDS }, maxItems: 6 }),
    counterparty: nullable({ type: 'string', maxLength: 60 }),
    groupBy: nullable({ type: 'string', enum: GROUP_BYS }),
  },
  required: ['metric', 'range', 'accounts', 'categories', 'counterparty', 'groupBy'],
  additionalProperties: false,
};

/** Validate and normalise model output (or anything else) into a QueryIntent. */
export function normalizeIntent(raw: unknown): QueryIntent | null {
  if (!isObject(raw) || !METRICS.includes(raw.metric as Metric) || !isObject(raw.range)) {
    return null;
  }
  const preset = raw.range.preset as RangePreset;
  if (!RANGE_PRESETS.includes(preset)) {
    return null;
  }
  const intent: QueryIntent = { metric: raw.metric as Metric, range: { preset } };
  if (preset === 'last_n_days') {
    const n = Number(raw.range.n);
    intent.range.n = Number.isInteger(n) && n >= 1 && n <= 365 ? n : 7;
  }
  if (Array.isArray(raw.accounts)) {
    const accounts = raw.accounts
      .filter((a): a is string => typeof a === 'string')
      .map(a => a.trim())
      .filter(a => a.length > 0 && a.length <= 40)
      .slice(0, 4);
    if (accounts.length) {
      intent.accounts = accounts;
    }
  }
  if (Array.isArray(raw.categories)) {
    const cats = raw.categories.filter((c): c is CategoryId => CATEGORY_IDS.includes(c as CategoryId));
    if (cats.length) {
      intent.categories = [...new Set(cats)];
    }
  }
  if (typeof raw.counterparty === 'string' && raw.counterparty.trim() && raw.counterparty.trim().length <= 60) {
    intent.counterparty = raw.counterparty.trim();
  }
  if (GROUP_BYS.includes(raw.groupBy as GroupBy)) {
    intent.groupBy = raw.groupBy as GroupBy;
  }
  return intent;
}

// ---------------------------------------------------------------------------
// Time ranges (device-local)
// ---------------------------------------------------------------------------

function startOfDay(t: EpochMs): Date {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Monday-based week start. */
function startOfWeek(t: EpochMs): Date {
  const d = startOfDay(t);
  const dow = (d.getDay() + 6) % 7; // Mon = 0
  return addDays(d, -dow);
}

export function dayKeyOf(t: EpochMs): DayKey {
  const d = new Date(t);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export interface ResolvedRange {
  /** Inclusive. */
  start: EpochMs;
  /** Exclusive. */
  end: EpochMs;
  label: string;
}

export function resolveRange(range: QueryIntent['range'], now: EpochMs): ResolvedRange {
  const today = startOfDay(now);
  switch (range.preset) {
    case 'today':
      return { start: +today, end: +addDays(today, 1), label: 'today' };
    case 'yesterday':
      return { start: +addDays(today, -1), end: +today, label: 'yesterday' };
    case 'this_week': {
      const s = startOfWeek(now);
      return { start: +s, end: +addDays(s, 7), label: 'this week' };
    }
    case 'last_week': {
      const s = addDays(startOfWeek(now), -7);
      return { start: +s, end: +addDays(s, 7), label: 'last week' };
    }
    case 'this_month': {
      const s = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start: +s, end: +new Date(today.getFullYear(), today.getMonth() + 1, 1), label: 'this month' };
    }
    case 'last_month': {
      const s = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      return { start: +s, end: +new Date(today.getFullYear(), today.getMonth(), 1), label: 'last month' };
    }
    case 'last_n_days': {
      const n = range.n && range.n >= 1 ? Math.min(365, Math.floor(range.n)) : 7;
      return {
        start: +addDays(today, -(n - 1)),
        end: +addDays(today, 1),
        label: n === 1 ? 'today' : `in the last ${n} days`,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface QueryRow {
  key: string;
  label: string;
  amount: Paise;
  count: number;
  /** Balance rows: when the bank reported it. */
  at?: EpochMs;
}

export interface QueryResult {
  intent: QueryIntent;
  metric: Metric;
  range: ResolvedRange;
  /** Spent / received / balance total, or 0 for `count`. */
  total: Paise;
  /** Number of matching transactions (balance: accounts with a reported balance). */
  count: number;
  rows: QueryRow[];
  /** Accounts in scope. */
  accountIds: AccountId[];
  warnings: string[];
}

const SPEND_KINDS: readonly TxnKind[] = ['spend', 'fee'];
const IN_KINDS: readonly TxnKind[] = ['in'];

export function accountLabel(a: Account): string {
  return a.displayName?.trim() ? `${a.displayName} ${maskAccount(a.mask)}` : `${a.bank.toUpperCase()} ${maskAccount(a.mask)}`;
}

/** Match LLM account words (`HDFC`, `1234`, `••1234`, `salary account`) to accounts. */
export function resolveAccounts(accounts: Account[], words: string[]): Account[] {
  const out = new Set<Account>();
  for (const w of words) {
    const norm = w
      .toLowerCase()
      .replace(/••|\*+|x{2,}|a\/c|account|acct|bank|card/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const digits = w.replace(/\D/g, '');
    for (const a of accounts) {
      const hit =
        a.id === w ||
        (digits.length >= 3 && digits.length <= 4 && a.mask.endsWith(digits)) ||
        (digits.length > 4 && digits.endsWith(a.mask)) ||
        (norm.length >= 2 &&
          (a.bank.toLowerCase() === norm ||
            a.displayName.toLowerCase().includes(norm) ||
            a.aliases.some(al => al.toLowerCase() === norm)));
      if (hit) {
        out.add(a);
      }
    }
  }
  return accounts.filter(a => out.has(a));
}

function merchantOf(t: Transaction): { key: string; label: string } {
  const label = t.counterparty?.trim() || t.vpa?.trim() || 'Unknown';
  return { key: label.toLowerCase(), label };
}

function weekLabel(startKey: DayKey): string {
  const [, m, d] = startKey.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `Week of ${d} ${months[m - 1]}`;
}

function groupKey(t: Transaction, by: GroupBy, accounts: Map<AccountId, Account>): { key: string; label: string } {
  switch (by) {
    case 'day': {
      const k = dayKeyOf(t.occurredAt);
      return { key: k, label: k };
    }
    case 'week': {
      const k = dayKeyOf(+startOfWeek(t.occurredAt));
      return { key: k, label: weekLabel(k) };
    }
    case 'category':
      return { key: t.categoryId, label: CATEGORY_BY_ID[t.categoryId]?.name ?? t.categoryId };
    case 'merchant':
      return merchantOf(t);
    case 'account': {
      const a = accounts.get(t.accountId);
      return { key: t.accountId, label: a ? accountLabel(a) : t.accountId };
    }
  }
}

function group(txns: Transaction[], by: GroupBy, accounts: Map<AccountId, Account>): QueryRow[] {
  const rows = new Map<string, QueryRow>();
  for (const t of txns) {
    const { key, label } = groupKey(t, by, accounts);
    const row = rows.get(key) ?? { key, label, amount: 0, count: 0 };
    row.amount += t.amount;
    row.count += 1;
    rows.set(key, row);
  }
  const list = [...rows.values()];
  if (by === 'day' || by === 'week') {
    return list.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }
  return list.sort((a, b) => b.amount - a.amount || b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Run an intent over the ledger. Pure and deterministic.
 * - spent = successful `spend` + `fee` (refunds, transfers, card bills, cash excluded)
 * - received = successful `in` (refunds and self transfers excluded)
 * - count = number of matching spending transactions
 * - balance = latest bank-reported balance per account at or before range end
 */
export function executeIntent(ledger: Ledger, intent: QueryIntent, now: EpochMs): QueryResult {
  const range = resolveRange(intent.range, now);
  const warnings: string[] = [];
  const byId = new Map(ledger.accounts.map(a => [a.id, a]));

  let scope: Account[];
  if (intent.accounts?.length) {
    scope = resolveAccounts(ledger.accounts, intent.accounts);
    if (!scope.length) {
      warnings.push(`No account matched ${intent.accounts.map(a => `“${a}”`).join(', ')}.`);
    }
  } else {
    scope = ledger.accounts.filter(a => a.includeInTotal);
  }
  const scopeIds = new Set(scope.map(a => a.id));
  const base: QueryResult = {
    intent,
    metric: intent.metric,
    range,
    total: 0,
    count: 0,
    rows: [],
    accountIds: scope.map(a => a.id),
    warnings,
  };

  if (intent.metric === 'balance') {
    const rows: QueryRow[] = [];
    for (const a of scope) {
      let latest: Ledger['snapshots'][number] | undefined;
      for (const s of ledger.snapshots) {
        if (s.accountId === a.id && s.at < range.end && (!latest || s.at > latest.at)) {
          latest = s;
        }
      }
      if (latest) {
        rows.push({ key: a.id, label: accountLabel(a), amount: latest.reported, count: 0, at: latest.at });
      }
    }
    const total = rows.reduce((sum, r) => (byId.get(r.key)?.type === 'credit_card' ? sum : sum + r.amount), 0);
    return { ...base, total, count: rows.length, rows };
  }

  const kinds = intent.metric === 'received' ? IN_KINDS : SPEND_KINDS;
  const cats = intent.categories?.length ? new Set(intent.categories) : undefined;
  const cp = intent.counterparty?.toLowerCase();
  const txns = ledger.transactions.filter(
    t =>
      scopeIds.has(t.accountId) &&
      t.status === 'success' &&
      kinds.includes(t.kind) &&
      t.occurredAt >= range.start &&
      t.occurredAt < range.end &&
      (!cats || cats.has(t.categoryId)) &&
      (!cp || (t.counterparty ?? '').toLowerCase().includes(cp) || (t.vpa ?? '').toLowerCase().includes(cp)),
  );
  const total = txns.reduce((s, t) => s + t.amount, 0);
  const count = txns.length;

  switch (intent.metric) {
    case 'top_merchants':
      return { ...base, total, count, rows: group(txns, 'merchant', byId).slice(0, 5) };
    case 'by_category':
      return { ...base, total, count, rows: group(txns, 'category', byId) };
    case 'count': {
      const rows = intent.groupBy ? group(txns, intent.groupBy, byId) : [];
      return {
        ...base,
        total: 0,
        count,
        rows: intent.groupBy === 'day' || intent.groupBy === 'week' ? rows : rows.sort((a, b) => b.count - a.count),
      };
    }
    default: {
      const rows = intent.groupBy ? group(txns, intent.groupBy, byId) : [];
      return { ...base, total, count, rows: intent.groupBy === 'merchant' ? rows.slice(0, 10) : rows };
    }
  }
}

// ---------------------------------------------------------------------------
// Phrasing
// ---------------------------------------------------------------------------

function listRows(rows: QueryRow[], max: number, withCount = false): string {
  return rows
    .slice(0, max)
    .map(r => `${r.label} ${formatINR(r.amount)}${withCount ? ` (${r.count})` : ''}`)
    .join(', ');
}

/** Deterministic answer text. Used when no model or the model's text fails validation. */
export function templateAnswer(result: QueryResult): string {
  const { range, rows } = result;
  const lead = result.warnings.length ? `${result.warnings.join(' ')} ` : '';
  const cats = result.intent.categories?.map(c => CATEGORY_BY_ID[c]?.name ?? c).join(', ');
  const on = [cats, result.intent.counterparty].filter(Boolean).join(', ');
  const onText = on ? ` on ${on}` : '';
  const grouped = rows.length && (result.intent.groupBy === 'category' || result.intent.groupBy === 'merchant' || result.intent.groupBy === 'account');

  switch (result.metric) {
    case 'spent':
      return `${lead}You spent ${formatINR(result.total)}${onText} ${range.label}${
        result.count ? ` across ${result.count} ${result.count === 1 ? 'transaction' : 'transactions'}` : ''
      }.${grouped ? ` Biggest: ${listRows(rows, 3)}.` : ''}`;
    case 'received':
      return `${lead}You received ${formatINR(result.total)}${onText} ${range.label}${
        result.count ? ` in ${result.count} ${result.count === 1 ? 'payment' : 'payments'}` : ''
      }.${grouped ? ` Biggest: ${listRows(rows, 3)}.` : ''}`;
    case 'count':
      return `${lead}${result.count} spending ${result.count === 1 ? 'transaction' : 'transactions'}${onText} ${range.label}.`;
    case 'balance':
      if (!rows.length) {
        return `${lead}No bank-reported balance yet for these accounts.`;
      }
      if (rows.length === 1) {
        return `${lead}${rows[0].label}: last reported balance ${formatINR(rows[0].amount)}.`;
      }
      return `${lead}Last reported balances: ${listRows(rows, 4)}.`;
    case 'top_merchants':
      return rows.length
        ? `${lead}Top merchants ${range.label}: ${listRows(rows, 5, true)}.`
        : `${lead}No spending ${range.label}.`;
    case 'by_category':
      return rows.length
        ? `${lead}Spending ${range.label} by category: ${listRows(rows, 5)}.`
        : `${lead}No spending ${range.label}.`;
  }
}

/** Every number an answer about `result` may contain. */
export function resultAllowedNumbers(result: QueryResult): AllowedNumbers {
  const allowed = new AllowedNumbers().addAmount(result.total).addCount(result.count).addCount(result.rows.length);
  if (result.intent.range.n) {
    allowed.addCount(result.intent.range.n);
  }
  allowed.addDay(dayKeyOf(result.range.start)).addDay(dayKeyOf(result.range.end - 1));
  for (const r of result.rows) {
    allowed.addAmount(r.amount).addCount(r.count);
    // Labels may carry numbers (account masks, day keys).
    for (const n of r.label.match(/\d+/g) ?? []) {
      allowed.add(n);
    }
  }
  return allowed;
}

/** Compact, pre-formatted facts for the phrasing prompt. */
export function resultFacts(result: QueryResult): Record<string, unknown> {
  return {
    metric: result.metric,
    period: result.range.label,
    ...(result.metric === 'count' ? {} : { total: formatINR(result.total) }),
    transactions: result.count,
    rows: result.rows.slice(0, 5).map(r => ({ name: r.label, amount: formatINR(r.amount), count: r.count })),
    ...(result.warnings.length ? { note: result.warnings.join(' ') } : {}),
  };
}

/** Validate model phrasing: every number must come from the result or the question. */
export function acceptPhrase(text: string | undefined, result: QueryResult, question: string): boolean {
  if (!text || !isPlainSentence(text, 280)) {
    return false;
  }
  const allowed = resultAllowedNumbers(result);
  for (const n of question.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) {
    allowed.add(n);
  }
  return allowed.allows(text);
}
