// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
//
// Bank-agnostic fallback for Indian bank/UPI SMS. Reuses upstream's base
// extraction (amount, account mask, merchant, balance) but is much stricter
// about deciding that a message is a transaction, because it runs for senders
// no bank parser recognised:
// - It needs an amount, a completed-money verb (debited/credited/spent/sent/
//   received/…, or Dr./Cr.), and an anchor tying it to the user's money: an
//   account/card mask, UPI/VPA, or a balance.
// - Direction comes from whichever verb appears first.
// - Confidence 70, parserId 'generic-v1'.

import type { Paise, ParsedEvent, RawSms } from '../types';
import { BaseIndianBankParser } from './engine/BaseIndianBankParser';
import { toPaise } from './engine/patterns';
import { find, gv } from './engine/regex';
import { balanceEvent, bankTxnToEvent, GENERIC_PARSER_CONFIDENCE } from './engine/toEvent';
import { TransactionType } from './engine/types';

export const GENERIC_PARSER_ID = 'generic-v1';

const DEBIT_VERB =
  /\b(debited|spent|sent|paid|withdrawn|deducted|purchased?|transferred\s+to|dr\.?)(?=\W|$)/i;
const CREDIT_VERB = /\b(credited|received|deposited|refunded|cr\.?)(?=\W|$)/i;
const ANCHOR =
  /\b(?:a\/c|acct|account|ac)\b|\bcard\b|\bUPI\b|\bVPA\b|@[a-z]{2,}\b|\b(?:avl|available|avail)\.?\s*(?:bal|balance|lmt|limit)\b|\b[xX*]{2,}\d{3,4}\b/i;
const FAILED = /\b(?:failed|declined|unsuccessful)\b/i;
const NOT_A_TXN =
  /\bfor\s+processing\b|\bscheduled\b|\brequest(?:ed)?\b|\bmandate\s+(?:created|registered|set)\b|\bcredit\s+limit\s+(?:of|has|is)\b|\bloan\b.*\bapproved\b/i;

/** Amount with currency, skipping figures labelled as balance or limit. */
const AMOUNT = /(?:Rs\.?|INR|₹)\s*((?:[0-9,]+(?:\.\d{1,2})?|\.\d{1,2}))/gi;
/** "Avl Bal in A/c XX1234 as on 15-01-26 is Rs.12,345.67": label and figure apart. */
const LABELLED_BALANCE =
  /\b(?:avl|available|avail)\.?\s*bal(?:ance)?\b.{0,60}?(?:Rs\.?|INR|₹)\s*([0-9,]+(?:\.\d{1,2})?)/i;
const BAL_LABEL = /(?:bal(?:ance)?|lmt|limit|due)[\s.:-]*(?:is\s+)?$/i;

class GenericIndianParser extends BaseIndianBankParser {
  readonly id = 'generic';

  getBankName(): string {
    return 'Generic';
  }

  canHandle(_sender: string): boolean {
    return true;
  }

  protected isTransactionMessage(message: string): boolean {
    if (this.isNonTransactionMessage(message) || NOT_A_TXN.test(message)) {
      return false;
    }
    // "will be credited/debited" is a promise, except in a failure notice
    // ("… failed. Amount debited, if any, will be refunded").
    if (/\bwill\s+be\b/i.test(message) && !FAILED.test(message)) {
      return false;
    }
    return (DEBIT_VERB.test(message) || CREDIT_VERB.test(message)) && ANCHOR.test(message);
  }

  protected extractAmount(message: string): Paise | null {
    for (const m of message.matchAll(AMOUNT)) {
      const before = message.slice(Math.max(0, (m.index ?? 0) - 20), m.index);
      if (BAL_LABEL.test(before)) {
        continue;
      }
      const v = toPaise(gv(m, 1));
      if (v != null && v > 0) {
        return v;
      }
    }
    return null;
  }

  protected extractBalance(message: string): Paise | null {
    const m = find(LABELLED_BALANCE, message);
    return m ? toPaise(gv(m, 1)) : super.extractBalance(message);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const d = find(DEBIT_VERB, message);
    const c = find(CREDIT_VERB, message);
    if (d && (!c || d.index <= c.index)) {
      return TransactionType.EXPENSE;
    }
    if (c) {
      return TransactionType.INCOME;
    }
    return null;
  }
}

const generic = new GenericIndianParser();

/** Fallback parse. `bank` is the canonical id to report (the matched bank or the sender). */
export function parseGeneric(sms: RawSms, bank: string): ParsedEvent | null {
  const opts = { bank, confidence: GENERIC_PARSER_CONFIDENCE, parserId: GENERIC_PARSER_ID };
  const t = generic.parse(sms.body, sms.address, sms.date);
  if (t) {
    return bankTxnToEvent(t, sms, opts);
  }
  const bal = generic.parseBalanceUpdate(sms.body);
  if (bal) {
    return balanceEvent(sms, opts, bal.accountLast4, bal.balance);
  }
  return null;
}
