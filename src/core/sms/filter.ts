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

/** Not a transaction even though it carries an amount. */
const NON_TXN_NOTICE =
  /\basba\b|\bis\s+blocked\s+in\s+your\b|\bhave\s+received\s+payment\b|\be-?voucher\b(?![\s\S]*\b(?:spent|debited|charged)\b)/i;

/** Something that looks like money: Rs/INR/₹ amount, or a balance phrase. */
const MONEY =
  /(?:\brs\.?|\binr\b|₹|\bamt\b|\bamount\b)\s*:?\s*\.?\d|\d[\d,]*(?:\.\d{1,2})?\s*(?:rs|inr)\b|\b(?:avl|available|a\/c|account)\s*bal|\b(?:debited|credited|dr|cr)\.?\s+(?:by|with|for)?\s*\d/i;

export function gateSms(sms: RawSms): GateResult {
  const cat = dltCategory(sms.address);
  if (cat === 'P' || cat === 'G') {
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
  if (PROMO.test(body) && !completed) {
    return drop('promotional');
  }
  if (!MONEY.test(body) || NON_TXN_NOTICE.test(body)) {
    return drop('non_financial');
  }
  return KEEP;
}
