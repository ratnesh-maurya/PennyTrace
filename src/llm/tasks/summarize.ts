/**
 * Daily-close summary. The model only rephrases numbers code computed; if its
 * text contains any number we did not provide, the deterministic template wins.
 */
import type { DailyClose } from '../../core/types';
import { SUMMARY_SCHEMA, stringField } from '../schemas';
import { acceptSummary, summaryFacts, templateSummary } from '../summaryTemplate';
import { runJson } from './runJson';

const SYSTEM = [
  'Write a friendly 2-3 sentence summary of the user\'s day from the JSON facts.',
  'Use only the amounts given, written exactly as given (₹ format). Do not add, round, compare or compute numbers.',
  'No advice, no emojis.',
].join('\n');

export interface SummaryResult {
  text: string;
  source: 'llm' | 'template';
}

export async function summarizeDetailed(close: DailyClose, names: Record<string, string> = {}): Promise<SummaryResult> {
  const raw = await runJson({
    system: SYSTEM,
    user: JSON.stringify(summaryFacts(close, names)),
    schema: SUMMARY_SCHEMA,
    maxTokens: 160,
  });
  const text = stringField(raw, 'summary');
  return text && acceptSummary(text, close)
    ? { text, source: 'llm' }
    : { text: templateSummary(close, names), source: 'template' };
}

export async function summarize(close: DailyClose, names: Record<string, string> = {}): Promise<string> {
  return (await summarizeDetailed(close, names)).text;
}
