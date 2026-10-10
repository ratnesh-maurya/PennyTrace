// Maps a ported bank parser's `BankTxn` (upstream ParsedTransaction shape) onto
// PennyTrace's `ParsedEvent` contract. This file is PennyTrace-specific.
//
// Mapping decisions (documented here so the ledger can rely on them):
// - Upstream INCOME → credit; EXPENSE/INVESTMENT → debit; CREDIT (credit-card
//   spend) → debit on instrument 'card'; TRANSFER → direction from the first
//   debit/credit verb in the body (default debit); BALANCE_UPDATE → kind 'balance'.
// - Balance-only events: kind 'balance', amount 0, direction 'credit' (arbitrary,
//   ignored by the ledger), status 'success'.
// - Status: a reversal ("reversed", "reversal") → 'reversed' with
//   hints.isReversal; explicit failure ("failed", "declined", …) → 'failed';
//   "refund initiated" / "is being processed" / "txn pending" → 'pending';
//   otherwise 'success'. Future-debit notices ("will be debited", mandate
//   set-up) never reach here: parseSms reports them as 'ignored'.
// - occurredAt: the SMS delivery time, unless the body prints a full date AND
//   time that falls within [sms.date − 3 days, sms.date + 10 min]. Body times
//   are read as IST (UTC+05:30), which is how Indian banks print them.
// - Non-INR amounts (card spends abroad) are not mappable without a currency
//   field and return null (the caller reports 'unparsed').

import type { Direction, Instrument, ParsedEvent, ParseHints, RawSms, TxnRefs, TxnStatus } from '../../types';
import { find, findAll, gv } from './regex';
import { TransactionType, type BankTxn } from './types';

export const BANK_PARSER_CONFIDENCE = 90;
export const GENERIC_PARSER_CONFIDENCE = 70;
export const PARSER_VERSION = 1;

export interface MapOptions {
  bank: string;
  defaultInstrument?: Instrument;
  confidence: number;
  /** Forces the parserId (generic uses 'generic-v1'). */
  parserId?: string;
}

const DEBIT_WORDS =
  /\b(debited|debit|dr\.?|spent|sent|paid|withdrawn|deducted|purchase[d]?|transferred to|payment of|charged)\b/i;
const CREDIT_WORDS = /\b(credited|credit(?!\s*card)|cr\.?|received|deposited|refunded|refund|added)\b/i;

/** Direction from whichever verb appears first in the body. */
export function inferDirection(body: string): Direction | undefined {
  const d = find(DEBIT_WORDS, body);
  const c = find(CREDIT_WORDS, body);
  if (d && c) {
    return d.index <= c.index ? 'debit' : 'credit';
  }
  if (d) {
    return 'debit';
  }
  if (c) {
    return 'credit';
  }
  return undefined;
}

const FAILURE =
  /\b(failed|failure|declined|unsuccessful|not successful|could not be (?:completed|processed)|was not completed|rejected)\b/i;
const REVERSAL = /\b(reversed|reversal)\b/i;
const FUTURE_REVERSAL = /\bwill\s+be\s+(?:reversed|refunded)\b/i;
const PENDING =
  /\brefund\s+(?:has\s+been\s+|is\s+)?initiated\b|\b(?:is|are)\s+being\s+processed\b|\bunder\s+process\b|\b(?:txn|transaction|payment|transfer)\s+(?:is\s+)?pending\b/i;

export function detectStatus(body: string): TxnStatus {
  if (REVERSAL.test(body) && !FUTURE_REVERSAL.test(body)) {
    return 'reversed';
  }
  if (FAILURE.test(body)) {
    return 'failed';
  }
  if (PENDING.test(body)) {
    return 'pending';
  }
  return 'success';
}

// ---- References -------------------------------------------------------------

const UTR_SHAPE = /^[A-Z]{4}[A-Z0-9]{8,18}$/;

function classifyRef(ref: string, body: string, refs: TxnRefs): void {
  const r = ref.trim();
  if (!r) {
    return;
  }
  const idx = body.indexOf(r);
  const before = idx > 0 ? body.slice(Math.max(0, idx - 25), idx) : '';
  if (/\b(UTR|NEFT|RTGS|IMPS)\b/i.test(before) && !/\bUPI\b/i.test(before)) {
    refs.utr ??= r;
  } else if (/^\d{12}$/.test(r)) {
    refs.upi ??= r;
  } else if (UTR_SHAPE.test(r) && /\d/.test(r) && r.length >= 16) {
    refs.utr ??= r;
  } else {
    refs.other ??= r;
  }
}

const UPI_REF_IN_BODY =
  /\b(?:UPI(?:\s*(?:Ref|Reference|Txn|Transaction))?(?:\s*(?:No|Id|ID|Number))?|RRN(?:\s*No)?|Ref(?:erence)?(?:\s*(?:No|Number))?)\.?\s*[:#-]?\s*(\d{12})\b/i;
const UTR_IN_BODY = /\bUTR(?:\s*(?:No|Number))?\.?\s*[:#-]?\s*([A-Z0-9]{12,22})\b/i;

export function extractRefs(body: string, upstreamRef?: string | null): TxnRefs {
  const refs: TxnRefs = {};
  const utr = find(UTR_IN_BODY, body);
  if (utr) {
    refs.utr = gv(utr, 1);
  }
  if (upstreamRef) {
    classifyRef(upstreamRef, body, refs);
  }
  if (!refs.upi) {
    const m = find(UPI_REF_IN_BODY, body);
    if (m && gv(m, 1) !== refs.utr) {
      refs.upi = gv(m, 1);
    }
  }
  return refs;
}

// ---- VPA -------------------------------------------------------------------------

const VPA =
  /(?:^|[\s:(/,])([a-zA-Z0-9][a-zA-Z0-9._-]{0,255}@[a-zA-Z][a-zA-Z0-9]{1,63})(?![a-zA-Z0-9.@]*\.[a-zA-Z]{2,})/;

/** "credited to VPA kureelarun@okicici", "from VPA x@ybl": the other party, named explicitly. */
const COUNTERPARTY_VPA = /\b(?:to|from)\s+VPA\s*:?\s*([a-zA-Z0-9][a-zA-Z0-9._-]{0,255}@[a-zA-Z][a-zA-Z0-9]{1,63})/i;

/**
 * The counterparty's VPA. PennyTrace: prefer an explicit "to/from VPA …", and never return the
 * user's own handle ("Your VPA ratnesh@okhdfcbank linked to your a/c … credited to VPA x@okicici"),
 * which made every such payment look like a transfer to self.
 */
export function extractVpa(body: string): string | undefined {
  const named = find(COUNTERPARTY_VPA, body);
  if (named) {
    return gv(named, 1);
  }
  const m = find(VPA, body);
  if (!m) {
    return undefined;
  }
  const before = body.slice(Math.max(0, m.index - 12), m.index + 1);
  return /\byour\s+vpa\b/i.test(before) ? undefined : gv(m, 1);
}

// ---- Body date/time ----------------------------------------------------------------

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

function year(y: string): number {
  const n = Number(y);
  return y.length === 2 ? 2000 + n : n;
}

/**
 * Finds `date … time` in the body. Supported dates: dd-MMM-yy(yy), ddMMMyy,
 * dd/mm/yy(yy), dd-mm-yy(yy), dd.mm.yy(yy), yyyy-mm-dd. Time HH:MM[:SS] [AM|PM]
 * must follow within 15 characters.
 */
export function extractBodyTimestamp(body: string, smsDate: number): number | undefined {
  const dateRes: { re: RegExp; parse: (m: RegExpExecArray) => [number, number, number] | null }[] = [
    {
      re: /\b(\d{4})-(\d{1,2})-(\d{1,2})/,
      parse: m => [Number(m[1]), Number(m[2]), Number(m[3])],
    },
    {
      re: /\b(\d{1,2})[-\s]?([A-Za-z]{3})[-\s,]?(\d{4}|\d{2})\b/,
      parse: m => {
        const mon = MONTHS.indexOf(m[2].toUpperCase());
        return mon < 0 ? null : [year(m[3]), mon + 1, Number(m[1])];
      },
    },
    {
      re: /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/,
      parse: m => [year(m[3]), Number(m[2]), Number(m[1])],
    },
  ];
  for (const { re, parse } of dateRes) {
    let m: RegExpExecArray | undefined;
    let ymd: [number, number, number] | null = null;
    for (const candidate of findAll(re, body)) {
      ymd = parse(candidate);
      if (ymd) {
        m = candidate;
        break;
      }
    }
    if (!m || !ymd) {
      continue;
    }
    const after = body.slice(m.index + m[0].length, m.index + m[0].length + 25);
    const t = /^[^\d]{0,15}?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?/.exec(after);
    if (!t) {
      return undefined;
    }
    const [y, mo, d] = ymd;
    let h = Number(t[1]);
    const mi = Number(t[2]);
    const s = Number(t[3] ?? '0');
    const ampm = t[4]?.toUpperCase();
    if (ampm === 'PM' && h < 12) {
      h += 12;
    } else if (ampm === 'AM' && h === 12) {
      h = 0;
    }
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) {
      return undefined;
    }
    const epoch = Date.UTC(y, mo - 1, d, h, mi, s) - IST_OFFSET_MS;
    if (epoch >= smsDate - 3 * 24 * 3600 * 1000 && epoch <= smsDate + 10 * 60 * 1000) {
      return epoch;
    }
    return undefined;
  }
  return undefined;
}

// ---- Hints ---------------------------------------------------------------------------

const ATM = /\bATM\b|\bcash\s*(?:withdrawal|wdl|withdrawn)\b|\bATW\b|\bNFS\b/i;
const CARD_BILL_DEBIT =
  /(?:credit\s*card|\bcc\b)\s*(?:bill|payment|pmt|repayment)|\bcard\s*bill\b|towards\s+(?:your\s+)?(?:\w+\s+){0,3}credit\s*card|\bCRED\b|bill\s*desk.{0,20}card/i;
const CARD_PAYMENT_CREDIT = /\b(?:payment|paid|received|repayment)\b/i;
const REFUND = /\brefund(?:ed)?\b/i;
const SALARY = /\bsalary\b|\bsal\b/i;
const EMANDATE =
  /e-?mandate|\bnach\b|\bach\b|\becs\b|\bauto-?pay\b|\bautopay\b|standing\s+instruction|\bSI\b|\bUMRN\b|\bmandate\b/i;
const COUNTER_ACCOUNT =
  /(?:a\/c|acct|account)\s*(?:no\.?\s*)?[xX*.]*(\d{3,4})\b.{0,60}?\bdebited\b.{0,80}?(?:a\/c|acct|account)\s*(?:no\.?\s*)?[xX*.]*(\d{3,4})\b.{0,30}?\bcredited\b/i;

function last4(s: string | null | undefined): string | undefined {
  if (!s) {
    return undefined;
  }
  const d = s.replace(/\D/g, '');
  return d.length >= 3 ? d.slice(-4) : undefined;
}

function buildHints(
  t: BankTxn,
  body: string,
  direction: Direction,
  instrument: Instrument,
  status: TxnStatus,
  accountLast4: string | undefined,
): ParseHints {
  const hints: ParseHints = {};
  // Card + "withdrawn" is an ATM cash withdrawal even when "ATM" is not printed
  // (HDFC: "Rs.2000 withdrawn from HDFC Bank Card x1234 At +18 <location> On ...").
  if (direction === 'debit' && (ATM.test(body) || (instrument === 'card' && /\bwithdrawn\b/i.test(body)))) {
    hints.isAtmWithdrawal = true;
  }
  const refund = REFUND.test(body);
  if (
    (direction === 'credit' &&
      instrument === 'card' &&
      CARD_PAYMENT_CREDIT.test(body) &&
      !refund &&
      status !== 'reversed') ||
    (direction === 'debit' && CARD_BILL_DEBIT.test(body))
  ) {
    hints.isCardBillPayment = true;
  }
  if (refund) {
    hints.isRefund = true;
  }
  if (status === 'reversed') {
    hints.isReversal = true;
  }
  if (direction === 'credit' && SALARY.test(body)) {
    hints.isSalary = true;
  }
  if (t.type === TransactionType.INVESTMENT) {
    hints.isInvestment = true;
  }
  if (
    instrument === 'card' &&
    !hints.isCardBillPayment &&
    (t.type === TransactionType.CREDIT || t.creditLimit != null || /\bcredit\s*card\b/i.test(body))
  ) {
    hints.isCreditCard = true;
  }
  if (direction === 'debit' && EMANDATE.test(body)) {
    hints.isEmandate = true;
  }
  const counter = [last4(t.toAccount), last4(t.fromAccount)].find(a => a && a !== accountLast4);
  if (counter) {
    hints.counterAccountLast4 = counter;
  } else {
    const m = find(COUNTER_ACCOUNT, body);
    if (m && gv(m, 2) !== accountLast4 && gv(m, 1) === (accountLast4 ?? gv(m, 1))) {
      hints.counterAccountLast4 = gv(m, 2);
    }
  }
  return hints;
}

// ---- Instrument / parserId ---------------------------------------------------------

function detectInstrument(
  t: BankTxn,
  body: string,
  accountLast4: string | undefined,
  fallback?: Instrument,
): Instrument {
  if (t.type === TransactionType.CREDIT || t.isFromCard) {
    return 'card';
  }
  if (fallback) {
    return fallback;
  }
  if (/\bUPI\b|\bVPA\b/i.test(body) || extractVpa(body)) {
    return 'upi';
  }
  if (accountLast4 || /\b(?:a\/c|acct|account|ac)\b/i.test(body)) {
    return 'account';
  }
  return 'unknown';
}

export function variantFor(direction: Direction, instrument: Instrument, hints: ParseHints, body: string): string {
  let channel: string;
  if (hints.isAtmWithdrawal) {
    channel = 'atm';
  } else if (instrument === 'card') {
    channel = 'card';
  } else if (instrument === 'wallet') {
    channel = 'wallet';
  } else if (hints.isEmandate) {
    channel = 'mandate';
  } else if (instrument === 'upi') {
    channel = 'upi';
  } else if (/\bNEFT\b/i.test(body)) {
    channel = 'neft';
  } else if (/\bRTGS\b/i.test(body)) {
    channel = 'rtgs';
  } else if (/\bIMPS\b/i.test(body)) {
    channel = 'imps';
  } else {
    channel = 'account';
  }
  return `${channel}-${direction}`;
}

// ---- Public mappers ------------------------------------------------------------------

/** Non-INR transactions cannot be represented (no currency field) → null. */
export function bankTxnToEvent(t: BankTxn, sms: RawSms, opts: MapOptions): ParsedEvent | null {
  if (t.currency && t.currency.toUpperCase() !== 'INR') {
    return null;
  }
  const body = sms.body;
  const accountLast4 = t.accountLast4 ? t.accountLast4.trim() || undefined : undefined;
  const counterparty = t.merchant?.trim() || undefined;
  let vpa = extractVpa(body);
  if (!vpa && counterparty && counterparty.includes('@')) {
    vpa = counterparty;
  }

  if (t.type === TransactionType.BALANCE_UPDATE) {
    return balanceEvent(sms, opts, accountLast4, t.balance ?? t.amount);
  }
  if (!(t.amount > 0)) {
    return null;
  }

  const direction: Direction =
    t.type === TransactionType.INCOME
      ? 'credit'
      : t.type === TransactionType.TRANSFER
      ? inferDirection(body) ?? 'debit'
      : 'debit';
  const instrument = detectInstrument(t, body, accountLast4, opts.defaultInstrument);
  const status = detectStatus(body);
  const hints = buildHints(t, body, direction, instrument, status, accountLast4);
  const refs = extractRefs(body, t.reference);

  const event: ParsedEvent = {
    kind: 'transaction',
    bank: opts.bank,
    parserId: opts.parserId ?? `${opts.bank}-${variantFor(direction, instrument, hints, body)}`,
    parserVersion: PARSER_VERSION,
    amount: t.amount,
    direction,
    status,
    instrument,
    refs,
    occurredAt: extractBodyTimestamp(body, sms.date) ?? sms.date,
    hints,
    confidence: opts.confidence,
  };
  if (accountLast4) {
    event.accountLast4 = accountLast4;
  }
  if (counterparty) {
    event.counterparty = counterparty;
  }
  if (vpa) {
    event.vpa = vpa;
  }
  if (t.balance != null) {
    event.balance = t.balance;
  }
  if (t.creditLimit != null) {
    event.availableLimit = t.creditLimit;
  }
  return event;
}

export function balanceEvent(
  sms: RawSms,
  opts: MapOptions,
  accountLast4: string | null | undefined,
  balance: number | null | undefined,
): ParsedEvent | null {
  if (balance == null) {
    return null;
  }
  const event: ParsedEvent = {
    kind: 'balance',
    bank: opts.bank,
    parserId: opts.parserId ?? `${opts.bank}-balance`,
    parserVersion: PARSER_VERSION,
    amount: 0,
    direction: 'credit',
    status: 'success',
    instrument: accountLast4 ? 'account' : 'unknown',
    refs: {},
    balance,
    occurredAt: extractBodyTimestamp(sms.body, sms.date) ?? sms.date,
    hints: {},
    confidence: opts.confidence,
  };
  if (accountLast4) {
    event.accountLast4 = accountLast4;
  }
  return event;
}
