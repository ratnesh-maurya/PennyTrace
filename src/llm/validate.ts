/**
 * Post-validation of the LLM SMS parse. Pure: no React Native imports.
 *
 * The model is never trusted with numbers. An extraction is accepted only when
 * every number-like field it returns can be found literally in the SMS body:
 * - amount (comma-insensitive, on number boundaries) — else reject
 * - account_last4 — else reject
 * - upi_ref / utr — else reject
 * - balance — else the balance is dropped (it is optional evidence)
 * Text fields (counterparty, vpa) that are not in the body are dropped.
 */
import { parseAmountToPaise } from '../core/money';
import type { Instrument, ParsedEvent, RawSms, TxnStatus } from '../core/types';
import { bankFromSender } from './bank';
import { isObject, type LlmParseOutput } from './schemas';
import { cleanAmountLiteral, findLast4, findNumberLiteral, findText, findToken } from './text';

export const LLM_PARSER_ID = 'llm-fallback';
export const LLM_PARSER_VERSION = 1;
/** Hard ceiling: LLM parses always land in review (below REVIEW_THRESHOLD). */
export const LLM_MAX_CONFIDENCE = 70;

const STATUSES: readonly TxnStatus[] = ['success', 'pending', 'failed', 'reversed'];

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Accept a raw model object only if its shape is right. */
export function coerceParseOutput(raw: unknown): LlmParseOutput | undefined {
  if (!isObject(raw) || typeof raw.is_transaction !== 'boolean') {
    return undefined;
  }
  const direction = raw.direction === 'debit' || raw.direction === 'credit' ? raw.direction : null;
  const status = STATUSES.includes(raw.status as TxnStatus) ? (raw.status as TxnStatus) : null;
  return {
    is_transaction: raw.is_transaction,
    amount: str(raw.amount) ?? null,
    direction,
    account_last4: str(raw.account_last4) ?? null,
    counterparty: str(raw.counterparty) ?? null,
    vpa: str(raw.vpa) ?? null,
    upi_ref: str(raw.upi_ref) ?? null,
    utr: str(raw.utr) ?? null,
    balance: str(raw.balance) ?? null,
    status,
  };
}

/** True when `literal` (an amount as printed) appears in `body`. */
export function amountAppearsIn(body: string, literal: string): boolean {
  const clean = cleanAmountLiteral(literal);
  return clean !== undefined && findNumberLiteral(body, clean) !== undefined;
}

/**
 * Validate a model parse against the SMS and build a ParsedEvent, or return
 * null if anything the model claimed cannot be found in the body.
 */
export function validateLlmParse(sms: RawSms, raw: unknown): ParsedEvent | null {
  const out = coerceParseOutput(raw);
  if (!out || !out.is_transaction || !out.amount || !out.direction) {
    return null;
  }
  const body = sms.body;

  // Amount: must be printed literally and be a positive number.
  const amountLit = cleanAmountLiteral(out.amount);
  if (!amountLit || !findNumberLiteral(body, amountLit)) {
    return null;
  }
  const amount = parseAmountToPaise(amountLit);
  if (amount === undefined || amount <= 0) {
    return null;
  }

  // Account mask: last 4 digits of a digit run in the body.
  let accountLast4: string | undefined;
  if (out.account_last4) {
    const digits = out.account_last4.replace(/\D/g, '').slice(-4);
    if (digits.length !== 4 || !findLast4(body, digits)) {
      return null;
    }
    accountLast4 = digits;
  }

  // References: verbatim tokens.
  if (out.upi_ref && !findToken(body, out.upi_ref)) {
    return null;
  }
  if (out.utr && !findToken(body, out.utr)) {
    return null;
  }

  // Balance: optional; dropped (not rejected) if not printed.
  let balance: number | undefined;
  if (out.balance) {
    const balLit = cleanAmountLiteral(out.balance);
    if (balLit && findNumberLiteral(body, balLit)) {
      balance = parseAmountToPaise(balLit);
    }
  }

  const counterparty = out.counterparty && findText(body, out.counterparty) ? out.counterparty : undefined;
  const vpa = out.vpa && /@/.test(out.vpa) && findToken(body, out.vpa) ? out.vpa : undefined;

  const instrument: Instrument =
    vpa || out.upi_ref || /\bupi\b/i.test(body)
      ? 'upi'
      : /\bcard\b/i.test(body)
      ? 'card'
      : accountLast4
      ? 'account'
      : 'unknown';

  // More corroborating literals → a little more confidence, never above 70.
  const corroborated = [accountLast4, out.upi_ref, out.utr, balance].filter(v => v !== undefined).length;
  const confidence = Math.min(LLM_MAX_CONFIDENCE, 55 + corroborated * 5);

  return {
    kind: 'transaction',
    bank: bankFromSender(sms.address),
    parserId: LLM_PARSER_ID,
    parserVersion: LLM_PARSER_VERSION,
    amount,
    direction: out.direction,
    status: out.status ?? 'success',
    instrument,
    accountLast4,
    counterparty,
    vpa,
    refs: {
      ...(out.upi_ref ? { upi: out.upi_ref } : {}),
      ...(out.utr ? { utr: out.utr } : {}),
    },
    balance,
    occurredAt: sms.date,
    hints: {},
    confidence,
  };
}
