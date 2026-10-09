/**
 * Clean counterparty names and pick a category, in batches of ≤ 8.
 * Returns one entry per input (null where the model's answer was invalid),
 * or null for the whole call when no model is available.
 */
import { CATEGORIES } from '../../core/categories';
import {
  CATEGORIZE_BATCH,
  categorizeSchema,
  parseCategorizeOutput,
  type CategorizeResult,
} from '../schemas';
import { isAvailable } from '../modelManager';
import { runJson } from './runJson';

export interface CategorizeInput {
  counterparty: string;
  vpa?: string;
  sampleBody?: string;
}

const SYSTEM = [
  'For each payee, return a short clean display name, the payee type and a category.',
  'merchant = shop/brand/app; person = an individual; biller = utility/telecom/insurance/loan/government; own = the user\'s own account.',
  `Categories: ${CATEGORIES.map(c => `${c.id} (${c.name})`).join(', ')}.`,
  'Return the items in the same order as given.',
].join('\n');

function describe(item: CategorizeInput, i: number): string {
  const parts = [`${i + 1}. name: ${item.counterparty.slice(0, 60)}`];
  if (item.vpa) {
    parts.push(`vpa: ${item.vpa.slice(0, 60)}`);
  }
  if (item.sampleBody) {
    parts.push(`sms: ${item.sampleBody.replace(/\s+/g, ' ').slice(0, 160)}`);
  }
  return parts.join(' | ');
}

async function categorizeBatch(batch: CategorizeInput[]): Promise<(CategorizeResult | null)[]> {
  const raw = await runJson({
    system: SYSTEM,
    user: batch.map(describe).join('\n'),
    schema: categorizeSchema(batch.length),
    maxTokens: 40 + batch.length * 40,
  });
  return parseCategorizeOutput(raw, batch.length);
}

export async function categorize(items: CategorizeInput[]): Promise<(CategorizeResult | null)[] | null> {
  if (!isAvailable()) {
    return null;
  }
  const out: (CategorizeResult | null)[] = [];
  for (let i = 0; i < items.length; i += CATEGORIZE_BATCH) {
    out.push(...(await categorizeBatch(items.slice(i, i + CATEGORIZE_BATCH))));
  }
  return out;
}
