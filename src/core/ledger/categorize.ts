/**
 * Category, confidence and provenance for each transaction.
 *
 * Movement kinds are categorised by kind (transfer / card_payment / cash /
 * refund) and never go to review. For spend, fee and in:
 *   user override → user rules → (fee / salary / investment hints) →
 *   seed rules (input `seed` rules, then the built-in merchant list) →
 *   LLM-suggested rules → "looks like a person" → Other.
 * Confidence below REVIEW_THRESHOLD sets `needsReview`.
 */
import { CATEGORY_BY_ID } from '../categories';
import type { CategoryId, CategoryRule, TxnKind, UserOverride } from '../types';
import { REVIEW_THRESHOLD } from '../types';
import type { Draft } from './draft';
import { isVoid } from './draft';
import { matchSeed } from './seedRules';
import { cleanCounterparty, cmpStr, vpaHandleWords } from './util';

export interface CategoryResult {
  categoryId: CategoryId;
  confidence: number;
  ruleProvenance: string;
  needsReview: boolean;
}

export const CONFIDENCE = {
  override: 100,
  movement: 100,
  userRule: 95,
  hint: 90,
  seed: 85,
  income: 80,
  llmRule: 70,
  person: 60,
  other: 40,
} as const;

function categoryName(id: CategoryId): string {
  return CATEGORY_BY_ID[id]?.name ?? id;
}

const MOVEMENT_CATEGORY: Partial<Record<TxnKind, CategoryId>> = {
  xfer: 'transfer',
  pending_xfer: 'transfer',
  liability: 'card_payment',
  cash: 'cash',
  refund: 'refund',
};

export function isMovementKind(kind: TxnKind): boolean {
  return MOVEMENT_CATEGORY[kind] !== undefined;
}

const METHOD_LABEL = { ref: 'matched by reference', alias: 'matched to your account', amount_time: 'matched by amount and time', user: 'linked by you' } as const;

function movementProvenance(d: Draft): string {
  switch (d.kind) {
    case 'xfer':
      return d.linkedTxnId && d.transferMethod ? `Self transfer · ${METHOD_LABEL[d.transferMethod]}` : 'Self transfer';
    case 'pending_xfer':
      return 'Self transfer · in transit';
    case 'liability':
      return d.linkedTxnId ? 'Card bill payment · matched' : 'Card bill payment';
    case 'cash':
      return 'ATM withdrawal';
    case 'refund':
      return d.reversal ? (d.linkedTxnId ? 'Reversal · linked to original' : 'Reversal') : d.linkedTxnId ? 'Refund · linked to original' : 'Refund';
    default:
      return '';
  }
}

/** Compiled rule list: user rules first, then seed rules from input, then LLM rules. */
export interface RuleSet {
  user: CompiledRule[];
  seed: CompiledRule[];
  llm: CompiledRule[];
}

interface CompiledRule {
  rule: CategoryRule;
  test: (s: string) => boolean;
}

function compile(rule: CategoryRule): CompiledRule {
  const m = /^\/(.+)\/([a-z]*)$/s.exec(rule.pattern);
  if (m) {
    try {
      const re = new RegExp(m[1], m[2].includes('i') ? m[2] : `${m[2]}i`);
      return { rule, test: s => re.test(s) };
    } catch {
      return { rule, test: () => false };
    }
  }
  const needle = rule.pattern.trim().toLowerCase();
  return { rule, test: s => needle.length > 0 && s.toLowerCase().includes(needle) };
}

export function compileRules(rules: readonly CategoryRule[]): RuleSet {
  const sorted = [...rules].sort((a, b) => b.priority - a.priority || cmpStr(a.id, b.id));
  const valid = sorted.filter(r => CATEGORY_BY_ID[r.categoryId] !== undefined);
  return {
    user: valid.filter(r => r.source === 'user').map(compile),
    seed: valid.filter(r => r.source === 'seed').map(compile),
    llm: valid.filter(r => r.source === 'llm').map(compile),
  };
}

function firstMatch(list: CompiledRule[], d: Draft): CompiledRule | undefined {
  const body = d.primary.body;
  return list.find(c => {
    const value = c.rule.field === 'counterparty' ? d.counterparty : c.rule.field === 'vpa' ? d.vpa : body;
    return value !== undefined && c.test(value);
  });
}

const BUSINESS_WORDS = /\b(pvt|private|ltd|limited|llp|store|stores|mart|shop|enterprises?|traders?|services|solutions|technologies|tech|india|retail|foods?|restaurant|hotel|hospital|pharma|medical|bank|payments?|merchant|online|digital|agency|centre|center|co|company|corp|inc|bazaar|express|motors|fuels?|station|cafe|clinic)\b/i;

/** P2P guess: a short alphabetic name, or a phone-number VPA. */
export function looksLikePerson(counterparty: string | undefined, vpa: string | undefined): boolean {
  if (counterparty) {
    const s = counterparty.trim();
    if (/^[A-Za-z][A-Za-z.' ]{1,40}$/.test(s) && !BUSINESS_WORDS.test(s)) {
      const words = s.split(/\s+/).filter(Boolean);
      return words.length >= 1 && words.length <= 4;
    }
    return false;
  }
  return !!vpa && /^(\+?91)?[6-9]\d{9}@/.test(vpa);
}

export function categorize(d: Draft, rules: RuleSet, override: UserOverride | undefined): CategoryResult {
  const kind = d.kind!;
  const reviewable = !isMovementKind(kind) && !isVoid(d);
  const result = (categoryId: CategoryId, confidence: number, ruleProvenance: string): CategoryResult => ({
    categoryId,
    confidence,
    ruleProvenance,
    needsReview: reviewable && confidence < REVIEW_THRESHOLD,
  });
  const name = cleanCounterparty(d.counterparty) ?? vpaHandleWords(d.vpa) ?? 'this payee';

  if (override?.categoryId && CATEGORY_BY_ID[override.categoryId]) {
    return result(override.categoryId, CONFIDENCE.override, 'Your correction');
  }
  const movement = MOVEMENT_CATEGORY[kind];
  if (movement) {
    return result(movement, CONFIDENCE.movement, movementProvenance(d));
  }

  const user = firstMatch(rules.user, d);
  if (user) {
    return result(user.rule.categoryId, CONFIDENCE.userRule, `Your rule · ${user.rule.pattern} → ${categoryName(user.rule.categoryId)}`);
  }
  if (kind === 'fee') {
    return result('fees', CONFIDENCE.hint, 'Bank charge');
  }
  if (kind === 'in') {
    if (d.hints.isSalary) {
      return result('salary', CONFIDENCE.hint, 'Bank says · salary credit');
    }
    return result('income', CONFIDENCE.income, 'Money received');
  }
  if (d.hints.isInvestment) {
    return result('investments', CONFIDENCE.hint, 'Bank says · investment');
  }

  const seed = firstMatch(rules.seed, d);
  if (seed) {
    return result(seed.rule.categoryId, CONFIDENCE.seed, `Merchant list · ${seed.rule.pattern} → ${categoryName(seed.rule.categoryId)}`);
  }
  const builtin = matchSeed(d.counterparty) ?? matchSeed(vpaHandleWords(d.vpa));
  if (builtin) {
    return result(builtin.rule.categoryId, CONFIDENCE.seed, `Merchant list · ${name} → ${categoryName(builtin.rule.categoryId)}`);
  }
  const llm = firstMatch(rules.llm, d);
  if (llm) {
    return result(llm.rule.categoryId, CONFIDENCE.llmRule, `On-device AI · ${llm.rule.pattern} → ${categoryName(llm.rule.categoryId)}`);
  }
  if (looksLikePerson(d.counterparty, d.vpa)) {
    return result('people', CONFIDENCE.person, 'Guess · looks like a person');
  }
  return result('other', CONFIDENCE.other, 'No match · pick a category');
}
