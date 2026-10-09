/**
 * LLM fallback parser for SMS no bank/generic parser understood.
 * The output is validated literally against the body (see validate.ts);
 * accepted events carry parserId 'llm-fallback' and confidence ≤ 70.
 */
import type { ParsedEvent, RawSms } from '../../core/types';
import { PARSE_SCHEMA } from '../schemas';
import { validateLlmParse } from '../validate';
import { runJson } from './runJson';

const SYSTEM = [
  'Extract one bank transaction from an Indian bank or UPI SMS.',
  'Copy every number and name exactly as printed in the SMS. Never compute or guess.',
  'amount: the transaction amount without currency, e.g. "1,250.00".',
  'debit = money left the account; credit = money came in.',
  'account_last4: last 4 digits of the account/card number shown.',
  'upi_ref: UPI reference/RRN digits. utr: NEFT/IMPS/RTGS UTR.',
  'Use null for anything not printed.',
  'OTP, offers, reminders, due notices and balance-only messages: is_transaction false.',
].join('\n');

/** Max body length sent to the model; bank SMS are far shorter. */
const MAX_BODY = 600;

export async function parseFallback(sms: RawSms): Promise<ParsedEvent | null> {
  const body = sms.body.trim();
  if (!body || body.length > MAX_BODY) {
    return null;
  }
  const raw = await runJson({
    system: SYSTEM,
    user: `Sender: ${sms.address}\nSMS: ${body}`,
    schema: PARSE_SCHEMA,
    maxTokens: 220,
  });
  return raw === undefined ? null : validateLlmParse(sms, raw);
}
