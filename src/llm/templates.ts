/**
 * Learn a user parser template from a confirmed parse, so later SMS from the
 * same sender with the same wording skip the LLM. Pure: no React Native imports.
 *
 * The confirmed values (amount, last 4, refs, balance, counterparty, VPA) are
 * located in the body and become capture groups. All other text is kept
 * literally, except digit runs (dates, times) and month names, which are
 * generalised. Whitespace runs match any whitespace.
 */
import { parseAmountToPaise } from '../core/money';
import type { ParseHints, ParsedEvent, RawSms } from '../core/types';
import { senderKey } from './bank';
import { escapeRegex, findAmount, findLast4, findText, findToken, normalizeWs, type Span } from './text';

export type TemplateField = 'amount' | 'last4' | 'upi' | 'utr' | 'other' | 'balance' | 'counterparty' | 'vpa';

export interface UserParserTemplate {
  id: string;
  /** Normalised sender (`HDFCBK`). Templates only apply to the same sender. */
  senderKey: string;
  /** Anchored regex source over the whitespace-normalised body. */
  pattern: string;
  /** Capture group i+1 holds fields[i]. */
  fields: TemplateField[];
  createdAt: number;
  /** Values that come from the confirmed parse rather than the body. */
  base: Pick<ParsedEvent, 'kind' | 'bank' | 'direction' | 'status' | 'instrument'> & { hints: ParseHints };
}

export const TEMPLATE_PARSER_ID = 'user-template';
export const TEMPLATE_PARSER_VERSION = 1;
export const TEMPLATE_CONFIDENCE = 85;

const CAPTURE: Record<TemplateField, string> = {
  amount: '(\\d[\\d,]*(?:\\.\\d{1,2})?)',
  balance: '(-?\\d[\\d,]*(?:\\.\\d{1,2})?)',
  last4: '(\\d{4})',
  upi: '(\\d{6,16})',
  utr: '([A-Za-z0-9]{6,22})',
  other: '([A-Za-z0-9]{4,24})',
  vpa: '([A-Za-z0-9._-]+@[A-Za-z0-9.-]+)',
  counterparty: '(.+?)',
};

/** Month names / abbreviations as whole words, also inside `08Oct26` or `07-Oct-26`. */
const MONTHS =
  '(?<![A-Za-z])(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?![A-Za-z])';

/** Escape a literal segment, generalising digits, month names and whitespace. */
function literalToPattern(seg: string): string {
  const out: string[] = [];
  const re = new RegExp(`(\\d+)|(\\s+)|(${MONTHS})`, 'gi');
  let last = 0;
  for (let m = re.exec(seg); m; m = re.exec(seg)) {
    out.push(escapeRegex(seg.slice(last, m.index)));
    out.push(m[1] ? '\\d+' : m[2] ? '\\s+' : '[A-Za-z]{3,9}');
    last = m.index + m[0].length;
  }
  out.push(escapeRegex(seg.slice(last)));
  return out.join('');
}

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33 + s.charCodeAt(i)) % 4294967296;
  }
  return h.toString(36);
}

/**
 * Derive a template from an SMS and the parse the user confirmed.
 * Fields whose value cannot be found in the body are simply not captured.
 */
export function learnTemplate(sms: RawSms, confirmed: ParsedEvent, now: number = Date.now()): UserParserTemplate {
  const body = normalizeWs(sms.body);
  const taken: (Span & { field: TemplateField })[] = [];
  const take = (field: TemplateField, span: Span | undefined) => {
    if (span) {
      taken.push({ ...span, field });
    }
  };

  // Longest / most specific tokens first so they are not swallowed by others.
  if (confirmed.vpa) {
    take('vpa', findToken(body, confirmed.vpa, taken));
  }
  if (confirmed.refs.upi) {
    take('upi', findToken(body, confirmed.refs.upi, taken));
  }
  if (confirmed.refs.utr) {
    take('utr', findToken(body, confirmed.refs.utr, taken));
  }
  if (confirmed.refs.other) {
    take('other', findToken(body, confirmed.refs.other, taken));
  }
  if (confirmed.kind === 'transaction' && confirmed.amount > 0) {
    take('amount', findAmount(body, confirmed.amount, taken));
  }
  if (confirmed.accountLast4) {
    take('last4', findLast4(body, confirmed.accountLast4, taken));
  }
  if (confirmed.balance !== undefined) {
    take('balance', findAmount(body, Math.abs(confirmed.balance), taken));
  }
  if (confirmed.counterparty) {
    take('counterparty', findText(body, confirmed.counterparty, taken));
  }

  taken.sort((a, b) => a.start - b.start);
  const parts: string[] = ['^'];
  const fields: TemplateField[] = [];
  let pos = 0;
  for (const t of taken) {
    parts.push(literalToPattern(body.slice(pos, t.start)));
    parts.push(CAPTURE[t.field]);
    fields.push(t.field);
    pos = t.end;
  }
  parts.push(literalToPattern(body.slice(pos)));
  parts.push('$');
  const pattern = parts.join('');
  const key = senderKey(sms.address);

  return {
    id: `tpl-${key.toLowerCase()}-${djb2(pattern)}`,
    senderKey: key,
    pattern,
    fields,
    createdAt: now,
    base: {
      kind: confirmed.kind,
      bank: confirmed.bank,
      direction: confirmed.direction,
      status: confirmed.status,
      instrument: confirmed.instrument,
      hints: { ...confirmed.hints },
    },
  };
}

const compiled = new Map<string, RegExp | null>();

function compile(pattern: string): RegExp | null {
  if (!compiled.has(pattern)) {
    try {
      compiled.set(pattern, new RegExp(pattern, 'i'));
    } catch {
      compiled.set(pattern, null);
    }
  }
  return compiled.get(pattern) ?? null;
}

/** Apply one template; null if sender or wording differ, or the amount is unusable. */
export function applyTemplate(sms: RawSms, t: UserParserTemplate): ParsedEvent | null {
  if (senderKey(sms.address) !== t.senderKey) {
    return null;
  }
  const re = compile(t.pattern);
  const m = re?.exec(normalizeWs(sms.body));
  if (!m) {
    return null;
  }
  const got: Partial<Record<TemplateField, string>> = {};
  t.fields.forEach((f, i) => {
    const v = m[i + 1]?.trim();
    if (v) {
      got[f] = v;
    }
  });

  const amount = got.amount ? parseAmountToPaise(got.amount) : t.base.kind === 'balance' ? 0 : undefined;
  if (amount === undefined || (t.base.kind === 'transaction' && amount <= 0)) {
    return null;
  }
  let balance: number | undefined;
  if (got.balance) {
    const b = parseAmountToPaise(got.balance);
    balance = b === undefined ? undefined : got.balance.startsWith('-') ? -b : b;
  }

  return {
    kind: t.base.kind,
    bank: t.base.bank,
    parserId: TEMPLATE_PARSER_ID,
    parserVersion: TEMPLATE_PARSER_VERSION,
    amount,
    direction: t.base.direction,
    status: t.base.status,
    instrument: t.base.instrument,
    accountLast4: got.last4,
    counterparty: got.counterparty,
    vpa: got.vpa,
    refs: {
      ...(got.upi ? { upi: got.upi } : {}),
      ...(got.utr ? { utr: got.utr } : {}),
      ...(got.other ? { other: got.other } : {}),
    },
    balance,
    occurredAt: sms.date,
    hints: { ...t.base.hints },
    confidence: TEMPLATE_CONFIDENCE,
  };
}

/** First matching template wins (callers order them, e.g. newest first). */
export function applyTemplates(sms: RawSms, templates: readonly UserParserTemplate[]): ParsedEvent | null {
  for (const t of templates) {
    const ev = applyTemplate(sms, t);
    if (ev) {
      return ev;
    }
  }
  return null;
}
