// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
//
// Pipeline step 1 (plan.md §5): decide whether an SMS is worth parsing at all.
// Based on upstream's sender handling and `BankParser.isNonTransactionMessage`,
// made sender-agnostic and a little less eager: a message that clearly reports
// completed money movement is kept even if it mentions "OTP" or "offer" in its
// footer (bank parsers apply their own stricter checks afterwards).

import type { RawSms } from '../types';

export type GateReason = 'promo_sender' | 'otp' | 'promotional' | 'payment_request' | 'reminder' | 'non_financial';
export type GateResult = { keep: true } | { keep: false; reason: GateReason };

const KEEP: GateResult = { keep: true };
const drop = (reason: GateReason): GateResult => ({ keep: false, reason });

/**
 * DLT headers look like `AX-HDFCBK-S`. The trailing letter is the TRAI content
 * category: S = service, T = transactional, P = promotional, G = government.
 */
export function dltCategory(address: string): 'S' | 'T' | 'P' | 'G' | undefined {
  const m = /^[A-Z0-9]{2}-[A-Z0-9]{3,9}-([A-Z])$/i.exec(address.trim());
  const c = m?.[1].toUpperCase();
  return c === 'S' || c === 'T' || c === 'P' || c === 'G' ? c : undefined;
}

/** A verb saying money actually moved. */
const COMPLETED =
  /\b(debited|deducted|credited|deposited|withdrawn|spent|received|transferred|sent|charged|refunded|reversed|purchased|paid)\b/i;

const OTP_WORD = /\botp\b|one[-\s]?time\s+password|verification\s+code|\byour\s+code\s+is\b/i;
/** Phrasing that is unmistakably an OTP delivery, even if the body names an amount. */
const OTP_STRONG =
  /\b(?:otp|one[-\s]?time\s+password|verification\s+code)\b\s*(?:is|:|-)\s*\d|\b\d{4,8}\s+is\s+(?:your|the)\s+(?:otp|one[-\s]?time|verification|secure)|\b(?:otp|one[-\s]?time\s+password)\s+(?:for|to\s+(?:complete|authorise|authorize|approve|verify))\b|\bdo\s+not\s+share\s+(?:this|the)\s+(?:otp|code)\b/i;

const PAYMENT_REQUEST =
  /has\s+requested|payment\s+request|collect\s+request|requesting\s+payment|requests\s+(?:rs|inr|₹)|requested\s+(?:money|rs\.?|inr|₹|a\s+payment)|ignore\s+if\s+already\s+paid|\bon\s+approving\b|approve\s+(?:the\s+)?(?:request|collect)/i;

/** A future debit, never a completed one ("will be debited", mandate set-up). */
const FUTURE_DEBIT =
  /\bwill\s+be\s+(?:auto[-\s]?)?(?:debited|deducted|charged)\b|\bmandate\s+set\s+for\b|\bupcoming\b.{0,60}\b(?:mandate|debit|auto[-\s]?pay)\b|\bscheduled\s+(?:to\s+be\s+)?debited\b/i;
const DUE_REMINDER =
  /\bdue\s+on\b|\bis\s+due\b|\bmin(?:imum)?\.?\s+(?:amt|amount)\s+due\b|\bmin\s+due\b|\btotal\s+(?:amt|amount)\s+due\b|\bin\s+arrears\b|\bis\s+overdue\b|\bpls\s+pay\b|\bplease\s+pay\b|\bpayment\s+(?:is\s+)?due\b|\bdue\s+date\b/i;
const IGNORE_IF_PAID = /\bignore\s+if\s+(?:already\s+)?paid\b/i;

const PROMO =
  /\boffers?\b|\bdiscount|\bwin\s|\bcongratulations\b|\bpre-?approved\b|\bapply\s+now\b|\beligible\s+for\b|\blimited\s+period\b|\bexclusive\b|\bhurry\b|\bget\s+up\s*to\b|\bupgrade\s+(?:now|your)\b|\bcashback\s+offer\b|\bvoucher\s+worth\b|\binstant\s+loan\b|\bloan\s+(?:of|upto|up\s+to)\b/i;

/**
 * Spam that imitates a credit alert to get a tap: instant-loan and card-limit offers, gaming /
 * rummy "winnings", "can be credited" teasers. Dropped even though they say "credited", because
 * real bank alerts never use these phrasings.
 */
const BAIT = new RegExp(
  [
    String.raw`\b(?:get|avail|claim|apply\s+for)\s+(?:an?\s+)?(?:instant\s+|personal\s+)?loan\b`,
    String.raw`\bloan\s+(?:of|upto|up\s+to)\s+(?:rs\.?|inr|₹)`,
    String.raw`\binstant(?:ly)?\s+(?:loan|credited|approved|disbursed)\b`,
    String.raw`\b(?:can|could|will)\s+be\s+(?:successfully\s+)?(?:credited|transferred|disbursed)\b`,
    String.raw`\blimit\s+(?:is|has\s+been)\s+(?:upgraded|increased|enhanced)\b`,
    String.raw`\b(?:install|download|register|join)\s+(?:now|today|the\s+app)\b`,
    String.raw`\bto\s+withdraw\b`,
    String.raw`\b(?:rummy|teen\s*patti|fantasy|my11circle|dream11|poker|casino)\b`,
    String.raw`\bwelcome\s+bonus\b|\bprize\s+pool\b|\bclaim\s+now\b`,
    String.raw`\bcredited\s+to\s+your\s+(?:wallet|game|gaming)\b`,
  ].join('|'),
  'i',
);

/** Not a transaction even though it carries an amount. */
const NON_TXN_NOTICE = /\basba\b|\bis\s+blocked\s+in\s+your\b|\bhave\s+received\s+payment\b/i;

/** Reward / gift voucher delivery notice. Buying a voucher (any debit wording) is a real spend. */
function isVoucherDeliveryNotice(body: string): boolean {
  const lower = body.toLowerCase();
  return (
    /\be-?voucher\b/.test(lower) &&
    /\b(?:received|reward|redemption)\b/.test(lower) &&
    !/\b(?:spent|debited|charged)\b/.test(lower)
  );
}

/**
 * Something that looks like money: Rs/INR/₹ amount, a balance phrase, or a foreign amount
 * ("EUR 50.00"). Foreign amounts pass the gate so the parsers can see them; the ledger is
 * INR-only, so they end up `unparsed` and surface in Needs review instead of vanishing.
 */
const MONEY =
  /(?:\brs\.?|\binr\b|₹|\bamt\b|\bamount\b|\b(?:usd|eur|gbp|aed|sar|pkr|egp|chf|sgd|aud|cad|jpy|thb|myr|qar|kwd|omr|bdt|lkr|npr)\b)\s*:?\s*\.?\d|\d[\d,]*(?:\.\d{1,2})?\s*(?:rs|inr)\b|\b(?:avl|available|a\/c|account)\s*bal|\b(?:debited|credited|dr|cr)\.?\s+(?:by|with|for)?\s*\d/i;

export interface GateOptions {
  /**
   * A bank parser claims this sender. DLT category `-G` (government / service-explicit) is then
   * let through, since some banks (e.g. India Post, `-DOPBNK-G`) send real alerts under it.
   * Promotional `-P` is always dropped.
   */
  senderClaimed?: boolean;
}

export function gateSms(sms: RawSms, opts: GateOptions = {}): GateResult {
  const cat = dltCategory(sms.address);
  if (cat === 'P' || (cat === 'G' && !opts.senderClaimed)) {
    return drop('promo_sender');
  }

  const body = sms.body;
  // Strip "ignore if paid" before checking for a completed verb: that "paid" is not one.
  const completed = COMPLETED.test(body.replace(IGNORE_IF_PAID, ''));

  if (OTP_STRONG.test(body) || (OTP_WORD.test(body) && !completed)) {
    return drop('otp');
  }
  if (PAYMENT_REQUEST.test(body)) {
    return drop('payment_request');
  }
  if (FUTURE_DEBIT.test(body) || IGNORE_IF_PAID.test(body) || (DUE_REMINDER.test(body) && !completed)) {
    return drop('reminder');
  }
  if (BAIT.test(body) || (PROMO.test(body) && !completed)) {
    return drop('promotional');
  }
  if (!MONEY.test(body) || NON_TXN_NOTICE.test(body) || isVoucherDeliveryNotice(body)) {
    return drop('non_financial');
  }
  return KEEP;
}
