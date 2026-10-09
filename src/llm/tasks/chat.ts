/**
 * Chat: question → constrained QueryIntent → pure executeIntent → phrasing.
 * The model never sees the ledger and never writes SQL; numbers in the reply
 * are checked against the query result, else the template answer is used.
 */
import type { EpochMs, Ledger } from '../../core/types';
import {
  INTENT_SCHEMA,
  acceptPhrase,
  executeIntent,
  normalizeIntent,
  resultFacts,
  templateAnswer,
  type QueryIntent,
  type QueryResult,
} from '../intent';
import { isAvailable } from '../modelManager';
import { PHRASE_SCHEMA, stringField } from '../schemas';
import { runJson } from './runJson';

const INTENT_SYSTEM = [
  'Convert a question about the user\'s own bank transactions into a query.',
  'metric: spent | received | balance | count (number of spends) | top_merchants | by_category.',
  'range.preset: today, yesterday, this_week, last_week, this_month, last_month, or last_n_days with n.',
  'accounts: bank names or last-4 digits mentioned, else null. categories: only if asked. counterparty: a payee name if asked.',
  'groupBy only when the user asks for a breakdown. Default range: this_month.',
].join('\n');

const PHRASE_SYSTEM = [
  'Answer the user\'s question in one or two short sentences using only the JSON result.',
  'Copy amounts exactly as given. Do not compute, round or invent numbers.',
].join('\n');

export async function toIntent(question: string): Promise<QueryIntent | null> {
  const q = question.trim().slice(0, 300);
  if (!q) {
    return null;
  }
  const raw = await runJson({ system: INTENT_SYSTEM, user: q, schema: INTENT_SCHEMA, maxTokens: 120 });
  return raw === undefined ? null : normalizeIntent(raw);
}

export interface ChatAnswer {
  question: string;
  intent: QueryIntent;
  /** Real numbers for the table / chart. */
  result: QueryResult;
  text: string;
  source: 'llm' | 'template';
}

export interface AnswerContext {
  ledger: Ledger;
  now?: EpochMs;
}

/**
 * Full chat turn. Returns null when no model is available or the question
 * could not be turned into an intent (UI shows the "Download model" CTA or a
 * "try rephrasing" hint).
 */
export async function answer(question: string, context: AnswerContext): Promise<ChatAnswer | null> {
  if (!isAvailable()) {
    return null;
  }
  const intent = await toIntent(question);
  if (!intent) {
    return null;
  }
  const result = executeIntent(context.ledger, intent, context.now ?? Date.now());
  const raw = await runJson({
    system: PHRASE_SYSTEM,
    user: `Question: ${question.trim().slice(0, 300)}\nResult: ${JSON.stringify(resultFacts(result))}`,
    schema: PHRASE_SCHEMA,
    maxTokens: 120,
  });
  const text = stringField(raw, 'answer');
  return acceptPhrase(text, result, question)
    ? { question, intent, result, text: text!, source: 'llm' }
    : { question, intent, result, text: templateAnswer(result), source: 'template' };
}
