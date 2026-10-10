// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
//
// Upstream `IndusIndBankParser.kt`: IndusInd Bank account, UPI, ACH and credit card alerts.

import type { Paise } from '../../types';
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { toPaise } from '../engine/patterns';
import { find, gv, replaceAll, test } from '../engine/regex';
import { TransactionType, type BalanceUpdateInfo } from '../engine/types';

// Masked card number on a credit-card SMS: "Card XX1234" or "Card XXXX1234".
// 2+ X's so both mask widths match. (#486)
const CARD_MASK_PATTERN = /card\s+x{2,}\d/i;

// Credit-card refund shape: "refund of INR <amt> from <Merchant> has been credited".
const REFUND_MERCHANT_PATTERN =
  /refund\s+of\s+(?:INR|Rs\.?|₹)\s*[0-9,]+(?:\.\d{2})?\s+from\s+(.+?)\s+has\s+been\s+credited/i;

// Trailing legal-entity/branch noise appended to the brand ("Swiggy Limited Banga").
const LEGAL_ENTITY_SUFFIX_PATTERN = /\s+(?:Limited|Ltd\.?|Pvt\.?|Private).*$/i;

const BAL_OF_INR = /Avl\s*BAL\s+of\s+INR\s*([0-9,]+(?:\.\d{2})?)/i;
const BAL_INR = /(?:Avl\s*BAL|Available\s+Balance(?:\s+is)?|Bal)[:\s]+INR\s*([0-9,]+(?:\.\d{2})?)/i;

/** Kotlin `trimEnd(*chars)`. */
function trimEndChars(s: string, chars: string): string {
  let end = s.length;
  while (end > 0 && chars.includes(s[end - 1])) {
    end--;
  }
  return s.slice(0, end);
}

/** Kotlin `substringBefore(delim)`. */
function substringBefore(s: string, delim: string): string {
  const i = s.indexOf(delim);
  return i >= 0 ? s.slice(0, i) : s;
}

/**
 * Parser for IndusInd Bank SMS messages (India)
 *
 * Notes:
 * - Defaults to INR via base class
 * - Relies on base patterns for amount, balance, merchant, account, reference
 * - canHandle() includes common DLT sender variants seen in India
 */
export class IndusIndBankParser extends BaseIndianBankParser {
  readonly id = 'indusind';

  getBankName(): string {
    return 'IndusInd Bank';
  }

  canHandle(sender: string): boolean {
    const s = sender.toUpperCase();

    // Common short/long forms
    if (s === 'INDUSB' || s === 'INDUSIND' || s.includes('INDUSIND BANK')) return true;

    // DLT/route patterns frequently used in India
    // Allow -S, -T, or no suffix (e.g., VM-INDUSB, VM-INDUSB-S, VM-INDUSB-T)
    if (/^[A-Z]{2}-INDUSB(?:-[A-Z])?$/.test(s)) return true;
    if (/^[A-Z]{2}-INDUSIND(?:-[A-Z])?$/.test(s)) return true;

    // Some routes omit the trailing suffix or vary the middle part
    if (/^[A-Z]{2}-INDUS(?:[A-Z]{2,})?-[A-Z]$/.test(s)) return true;

    return false;
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lower = message.toLowerCase();
    // IndusInd typically uses standard verbs; fall back to base for most, but
    // explicitly treat "spent" and "purchase" as expenses to avoid ambiguity.
    // A credit-card purchase ("spent on IndusInd Card ... Avl Lmt: INR ...") must
    // type as CREDIT — not EXPENSE — so it counts as card spend and the base
    // parser's available-limit extraction (gated on CREDIT) runs. Refund SMS say
    // "credited to your ... Card" but carry no "Avl Lmt", so they fall through to
    // INCOME via super. (#486)
    if (lower.includes('card') && lower.includes('avl lmt')) return TransactionType.CREDIT;
    if (lower.includes('spent')) return TransactionType.EXPENSE;
    if (lower.includes('debited')) return TransactionType.EXPENSE;
    if (lower.includes('purchase')) return TransactionType.EXPENSE;
    if (lower.includes('deposit')) return TransactionType.INVESTMENT;
    if (lower.includes('fd')) return TransactionType.INVESTMENT;
    if (lower.includes('ach')) return TransactionType.INVESTMENT;
    return super.extractTransactionType(message);
  }

  /**
   * Force non-card detection for ACH/NACH messages since these are account debits/credits.
   */
  protected detectIsCard(message: string): boolean {
    const lower = message.toLowerCase();
    const isAchOrNach = lower.includes('ach db') || lower.includes('ach cr') || lower.includes('nach');
    if (isAchOrNach) return false;
    // Credit-card refund SMS say "credited to your IndusInd Bank Credit Card XX1234 ...
    // adjusted against the outstanding on your card account". The trailing "card account"
    // phrase makes the base detectIsCard bail out as an account (non-card) txn, so
    // recognise the credit card explicitly here. Mask is 2+ X's so XX1234 and
    // XXXX1234 both match. (#486)
    if (lower.includes('credit card') && test(CARD_MASK_PATTERN, message)) {
      return true;
    }
    return super.detectIsCard(message);
  }

  /**
   * Detect balance-only notifications (not transactions).
   * Examples:
   *  - "Your A/C 2134***12345 has Avl BAL of INR 1,234.56 as on 05/10/25 04:10 AM ..."
   */
  isBalanceUpdateNotification(message: string): boolean {
    const lower = message.toLowerCase();
    const hasBalanceCue =
      lower.includes('avl bal') ||
      lower.includes('available bal') ||
      lower.includes('account balance') ||
      lower.includes('a/c balance');
    const hasTxnVerb = ['debited', 'credited', 'withdrawn', 'spent', 'transferred'].some(it => lower.includes(it));
    return hasBalanceCue && lower.includes('as on') && !hasTxnVerb;
  }

  /**
   * Parse balance-only notifications.
   * (Upstream also parses the optional "as on dd/MM/yy hh:mm AM/PM" date; PennyTrace does not use it.)
   */
  parseBalanceUpdate(message: string): BalanceUpdateInfo | null {
    if (!this.isBalanceUpdateNotification(message)) return null;

    // Extract account last4 using existing helper
    const accountLast4 = this.extractAccountLast4(message);
    if (accountLast4 == null) return null;

    // Extract balance amount
    // Pattern 1: "Avl BAL of INR 1,234.56"
    const p1 = find(BAL_OF_INR, message);
    let balance = p1 ? toPaise(gv(p1, 1)) : null;
    if (balance == null) {
      // Pattern 2: "Avl BAL INR 1,234.56" | "Available Balance is INR ..." | "Bal INR ..."
      const p2 = find(BAL_INR, message);
      balance = p2 ? toPaise(gv(p2, 1)) : null;
    }
    if (balance == null) return null;

    return {
      bankName: this.getBankName(),
      accountLast4,
      balance,
    };
  }

  protected isTransactionMessage(message: string): boolean {
    const lower = message.toLowerCase();
    // Skip interest payout on deposits as per requirement
    if (lower.includes('net interest') && lower.includes('deposit no')) {
      return false;
    }
    return super.isTransactionMessage(message);
  }

  protected extractAmount(message: string): Paise | null {
    // Prefer transaction amount tied to action verbs to avoid picking Available Balance
    const m = find(
      /(?:INR|Rs\.?|₹)\s*([0-9,]+(?:\.\d{2})?)\s+(?:debited|credited|spent|withdrawn|paid|purchase)/i,
      message,
    );
    if (m) {
      return toPaise(gv(m, 1));
    }
    return super.extractAmount(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    // Credit-card refund: "refund of INR <amt> from <Merchant> has been credited ..."
    // IndusInd appends the legal entity + branch/location (e.g. "Swiggy Limited Banga");
    // keep just the brand so the refund nets against the original spend merchant. (#486)
    const refund = find(REFUND_MERCHANT_PATTERN, message);
    if (refund) {
      const m = replaceAll(gv(refund, 1).trim(), LEGAL_ENTITY_SUFFIX_PATTERN, '');
      if (m.length > 0) return this.cleanMerchantName(m);
    }

    // UPI-style: towards <vpa or merchant>
    // Capture the next token (can include dots) and strip trailing punctuation
    const towards = find(/towards\s+(\S+)/i, message);
    if (towards) {
      let m = trimEndChars(gv(towards, 1).trim(), '.,;');
      if (m.includes('/')) m = substringBefore(m, '/');
      if (m.includes('@')) m = substringBefore(m, '@').trim();
      if (m.length > 0) return this.cleanMerchantName(m);
    }

    // Credit: from account XXXX/MERCHANT pattern
    // Example: "received from account XXXXXXX4321/MADMONEY"
    const fromAccount = find(/from\s+account\s+[^\s/]+\/([^\s(]+)/i, message);
    if (fromAccount) {
      const merchant = trimEndChars(gv(fromAccount, 1).trim(), '.,;)');
      if (merchant.length > 0) return this.cleanMerchantName(merchant);
    }

    // Credit: from <vpa or merchant>
    const from = find(/from\s+(\S+)/i, message);
    if (from) {
      let m = trimEndChars(gv(from, 1).trim(), '.,;');
      if (m.includes('/')) m = substringBefore(m, '/');
      if (m.includes('@')) {
        m = substringBefore(m, '@').trim();
        if (m.length > 0) return this.cleanMerchantName(m);
      }
    }

    // Card/POS: at <merchant>. Stop at " Ref", " on", a sentence-boundary period
    // (e.g. "at INSTAMART. Avl Lmt: ..." on credit-card spends), or end of line.
    const at = find(/at\s+([^\n]+?)(?:\s+Ref|\s+on|\.\s|$)/i, message);
    if (at) {
      const merchant = gv(at, 1).trim();
      if (merchant.length > 0) return this.cleanMerchantName(merchant);
    }

    // Pattern: Ref-.../REFID/<Merchant>.Bal ... -> capture merchant between last '/' and '.Bal'
    const beforeBal = find(/\/(?!\s)([^/.\s]+)\.\s*Bal/i, message);
    if (beforeBal) {
      const m = gv(beforeBal, 1).trim();
      if (m.length > 0) return this.cleanMerchantName(m);
    }

    return super.extractMerchant(message, sender);
  }

  protected extractAccountLast4(message: string): string | null {
    const base = super.extractAccountLast4(message);
    if (base != null) return base;

    // Pattern 1: "IndusInd Account 20XXXXX1234"
    const indusIndAccount = find(/IndusInd\s+Account\s+([\dX]+)/i, message);
    if (indusIndAccount) {
      return this.extractLast4Digits(gv(indusIndAccount, 1));
    }

    // Pattern 2: "account XXXXXXX1234"
    const accountX = find(/account\s+([X\d]+)/i, message);
    if (accountX) {
      return this.extractLast4Digits(gv(accountX, 1));
    }

    // Pattern 3: "A/C 2134***12345" - masked accounts
    const masked = find(/A\/?C\s+([\d*xX#]+)/i, message);
    if (masked) {
      return this.extractLast4Digits(gv(masked, 1));
    }

    // Pattern 4: "A/c *XX1234"
    const starMask = find(/A\/?c\s+([*X\d]+)/i, message);
    if (starMask) {
      return this.extractLast4Digits(gv(starMask, 1));
    }

    return null;
  }

  protected extractBalance(message: string): Paise | null {
    // Pattern: "Avl BAL of INR 1,234.56"
    const p1 = find(BAL_OF_INR, message);
    if (p1) {
      return toPaise(gv(p1, 1));
    }

    // Variant: "Avl BAL INR 1,234.56", "Available Balance is INR ...", or "Bal INR ..."
    const p2 = find(BAL_INR, message);
    if (p2) {
      return toPaise(gv(p2, 1));
    }

    // Fallback to base patterns
    return super.extractBalance(message);
  }

  protected extractReference(message: string): string | null {
    // Capture RRN numbers
    const rrn = find(/RRN[:\s]+([0-9]+)/i, message);
    if (rrn) {
      return gv(rrn, 1);
    }

    // Capture IMPS/UPI Ref no. pattern
    // Example: "IMPS Ref no. 123456789" or "Ref no. 123456789"
    const refNo = find(/(?:IMPS\s+)?Ref\s+no\.?\s*([0-9]+)/i, message);
    if (refNo) {
      return gv(refNo, 1);
    }

    return super.extractReference(message);
  }
}
