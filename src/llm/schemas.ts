/**
 * JSON schemas for constrained decoding, plus parsers for what comes back.
 * Pure: no React Native imports.
 *
 * llama.rn turns `response_format.json_schema.schema` into a GBNF grammar
 * (llama.cpp json-schema-to-grammar), which supports enum, anyOf, required,
 * additionalProperties:false, pattern, min/maxLength and min/maxItems.
 */
import { CATEGORIES } from '../core/categories';
import type { CategoryId } from '../core/types';

export type JsonSchema = Record<string, unknown>;

export const CATEGORY_IDS: readonly CategoryId[] = CATEGORIES.map(c => c.id);

const nullableString = (extra: JsonSchema = {}): JsonSchema => ({
  anyOf: [{ type: 'string', ...extra }, { type: 'null' }],
});

const nullableEnum = (values: readonly string[]): JsonSchema => ({
  anyOf: [{ type: 'string', enum: values }, { type: 'null' }],
});

function objectSchema(properties: Record<string, JsonSchema>): JsonSchema {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

// ---------------------------------------------------------------------------
// parseFallback
// ---------------------------------------------------------------------------

export interface LlmParseOutput {
  is_transaction: boolean;
  amount: string | null;
  direction: 'debit' | 'credit' | null;
  account_last4: string | null;
  counterparty: string | null;
  vpa: string | null;
  upi_ref: string | null;
  utr: string | null;
  balance: string | null;
  status: 'success' | 'pending' | 'failed' | 'reversed' | null;
}

export const PARSE_SCHEMA: JsonSchema = objectSchema({
  is_transaction: { type: 'boolean' },
  amount: nullableString({ pattern: '^[0-9][0-9,]*(\\.[0-9]{1,2})?$', maxLength: 16 }),
  direction: nullableEnum(['debit', 'credit']),
  account_last4: nullableString({ pattern: '^[0-9]{4}$' }),
  counterparty: nullableString({ maxLength: 60 }),
  vpa: nullableString({ maxLength: 80 }),
  upi_ref: nullableString({ pattern: '^[0-9]{6,16}$' }),
  utr: nullableString({ pattern: '^[A-Za-z0-9]{6,22}$' }),
  balance: nullableString({ pattern: '^[0-9][0-9,]*(\\.[0-9]{1,2})?$', maxLength: 16 }),
  status: nullableEnum(['success', 'pending', 'failed', 'reversed']),
});

// ---------------------------------------------------------------------------
// categorize
// ---------------------------------------------------------------------------

export type CounterpartyType = 'merchant' | 'person' | 'biller' | 'own';
export const COUNTERPARTY_TYPES: readonly CounterpartyType[] = ['merchant', 'person', 'biller', 'own'];

export interface CategorizeResult {
  clean_name: string;
  counterparty_type: CounterpartyType;
  category_id: CategoryId;
}

export const CATEGORIZE_BATCH = 8;

/** Exactly `n` items, in input order. */
export function categorizeSchema(n: number): JsonSchema {
  return objectSchema({
    items: {
      type: 'array',
      minItems: n,
      maxItems: n,
      items: objectSchema({
        clean_name: { type: 'string', minLength: 1, maxLength: 40 },
        counterparty_type: { type: 'string', enum: COUNTERPARTY_TYPES },
        category_id: { type: 'string', enum: CATEGORY_IDS },
      }),
    },
  });
}

/** Per-item validation; an invalid item becomes null rather than a guess. */
export function parseCategorizeOutput(raw: unknown, n: number): (CategorizeResult | null)[] {
  const items = isObject(raw) && Array.isArray(raw.items) ? raw.items : [];
  const out: (CategorizeResult | null)[] = [];
  for (let i = 0; i < n; i++) {
    const it: unknown = items[i];
    if (
      isObject(it) &&
      typeof it.clean_name === 'string' &&
      it.clean_name.trim().length > 0 &&
      it.clean_name.trim().length <= 40 &&
      COUNTERPARTY_TYPES.includes(it.counterparty_type as CounterpartyType) &&
      CATEGORY_IDS.includes(it.category_id as CategoryId)
    ) {
      out.push({
        clean_name: it.clean_name.trim(),
        counterparty_type: it.counterparty_type as CounterpartyType,
        category_id: it.category_id as CategoryId,
      });
    } else {
      out.push(null);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// summary / chat phrasing
// ---------------------------------------------------------------------------

export const SUMMARY_SCHEMA: JsonSchema = objectSchema({
  summary: { type: 'string', minLength: 1, maxLength: 360 },
});

export const PHRASE_SCHEMA: JsonSchema = objectSchema({
  answer: { type: 'string', minLength: 1, maxLength: 280 },
});

export function stringField(raw: unknown, key: string): string | undefined {
  if (!isObject(raw)) {
    return undefined;
  }
  const v = raw[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

// ---------------------------------------------------------------------------
// JSON extraction
// ---------------------------------------------------------------------------

/**
 * Parse the model's JSON. Grammar-constrained output is already JSON, but strip
 * a stray `<think>…</think>` block or code fence defensively.
 */
export function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/```(?:json)?/g, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return undefined;
  }
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
