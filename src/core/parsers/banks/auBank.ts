// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
//
// Upstream `AUBankParser.kt`: AU Small Finance Bank account, UPI, ATM and credit card alerts.

import type { Paise } from '../../types';
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { toPaise } from '../engine/patterns';
import { find, gv, matches, test } from '../engine/regex';
import { TransactionType } from '../engine/types';

// Hoisted so the Regex isn't recompiled on every extractTransactionType call.
const DR_INR_REGEX = /\bdr\s+inr\b/;
const CR_INR_REGEX = /\bcr\s+inr\b/;

/**
 * Parser for AU Small Finance Bank SMS messages
 *
 * Supported formats:
 * - Credit transactions: "Credited INR XXX to A/c XXXXX on DD-MM-YYYY Ref UPI/XX/XXXXXXXXXX/XXX XXX XX(name of the account). Bal INR XXX"
 * - Debit transactions: "Debited INR XXX from A/c XXXXX on DD-MM-YYYY..."
 * - ATM withdrawals and other transactions
 *
 * Sender patterns: XX-AUBANK-S/T, AUSFB, AU-BANK, etc.
 */
export class AuBankParser extends BaseIndianBankParser {
  readonly id = 'au';

  getBankName(): string {
    return 'AU Small Finance Bank';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return normalizedSender.includes('AUBANK');
  }

  protected extractAmount(message: string): Paise | null {
    const patterns = [
      // Pattern 1: Credited INR XXX
      /Credited\s+INR\s+([0-9,]+(?:\.\d{2})?)\s+to/i,
      // Pattern 2: Debited INR XXX
      /Debited\s+INR\s+([0-9,]+(?:\.\d{2})?)\s+from/i,
      // Pattern 2b: Short-form "Dr INR XXX" / "Cr INR XXX" (AU's newer SMS format)
      /\b(?:Dr|Cr)\s+INR\s+([0-9,]+(?:\.\d{2})?)/i,
      // Pattern 3: INR XXX spent (credit card format)
      /INR\s+([0-9,]+(?:\.\d{2})?)\s+spent/i,
      // Pattern 4: withdrawn INR XXX
      /withdrawn\s+INR\s+([0-9,]+(?:\.\d{2})?)/i,
    ];
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return toPaise(gv(m, 1));
      }
    }

    // Fall back to base class patterns
    return super.extractAmount(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    // Pattern 0: Credit card format - "spent at MERCHANT on"
    const spentAt = find(/spent\s+at\s+(.+?)\s+on\s+(?:AU\s+Bank|$)/i, message);
    if (spentAt) {
      const merchant = this.cleanMerchantName(gv(spentAt, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Pattern 1: UPI/DR or UPI/CR format without Ref prefix: UPI/DR/ref/MERCHANT/IFSC/acct
    const upiDrCr = find(/UPI\/(?:DR|CR)\/\d+\/([^/]+)\/[A-Z]{4}\d*\/\d+/i, message);
    if (upiDrCr) {
      const merchant = this.cleanMerchantName(gv(upiDrCr, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Pattern 1b: Short SMS form `UPI/DR/<ref>/<merchant>` with no IFSC follow-up
    // (e.g. AU's newer messages end the segment at a slash + letter or newline).
    // Reject the all-X "Bank Account XXXXX" placeholder AU uses when no merchant
    // name is available, then fall through to remaining patterns.
    const upiShort = find(/UPI\/(?:DR|CR)\/\d+\/([^/\n]+?)(?:\/[A-Z]|\/\s|\n|$)/i, message);
    if (upiShort) {
      const candidate = gv(upiShort, 1).trim();
      if (!matches(/Bank\s+Account\s+X+/i, candidate)) {
        const merchant = this.cleanMerchantName(candidate);
        if (this.isValidMerchantName(merchant)) {
          return merchant;
        }
      }
    }

    // Pattern 2: UPI transactions - extract name from Ref UPI/.../.../.../name(account)
    const upi = find(/Ref\s+UPI\/[^/]+\/[^/]+\/[^/]+\s+([^(]+)\([^)]+\)/i, message);
    if (upi) {
      const merchant = this.cleanMerchantName(gv(upi, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Pattern 3: Alternative UPI format - name in parentheses
    const upiParen = find(/UPI\/[^/]+\/[^/]+\/[^/]+\s+[^(]*\(([^)]+)\)/i, message);
    if (upiParen) {
      const merchant = this.cleanMerchantName(gv(upiParen, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Pattern 4: ATM transactions
    const lower = message.toLowerCase();
    if (lower.includes('atm') || lower.includes('withdrawn')) {
      return 'ATM Withdrawal';
    }

    // Pattern 5: General "to/from" patterns
    const toFrom = find(/(?:to|from)\s+([^.\n]+?)(?:\.\s*|$)/i, message);
    if (toFrom) {
      const merchant = this.cleanMerchantName(gv(toFrom, 1).trim());
      if (this.isValidMerchantName(merchant) && !merchant.toLowerCase().includes('a/c')) {
        return merchant;
      }
    }

    // Fall back to base class extraction
    return super.extractMerchant(message, sender);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();

    // Credit card transactions (must be checked before generic "spent" keyword)
    if (lowerMessage.includes('credit card')) return TransactionType.CREDIT;

    // Short-form Dr/Cr (AU's newer SMS format) — checked before the long-form
    // keywords below so we don't false-match on substrings.
    if (test(DR_INR_REGEX, lowerMessage)) return TransactionType.EXPENSE;
    if (test(CR_INR_REGEX, lowerMessage)) return TransactionType.INCOME;

    // Income keywords
    if (lowerMessage.includes('credited')) return TransactionType.INCOME;
    if (lowerMessage.includes('received')) return TransactionType.INCOME;
    if (lowerMessage.includes('deposited')) return TransactionType.INCOME;
    if (lowerMessage.includes('refund')) return TransactionType.INCOME;

    // Expense keywords
    if (lowerMessage.includes('debited')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('withdrawn')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('spent')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('paid')) return TransactionType.EXPENSE;

    return super.extractTransactionType(message);
  }

  protected extractAccountLast4(message: string): string | null {
    const base = super.extractAccountLast4(message);
    if (base != null) {
      return base;
    }
    // Pattern for account number: "A/c XXXXX" or "A/c X7013" (with mask characters)
    const m = find(/A\/c\s+[A-Za-z]*(\d+)/i, message);
    if (m) {
      return this.extractLast4Digits(gv(m, 1));
    }
    return null;
  }

  protected extractBalance(message: string): Paise | null {
    // Pattern for balance: "Bal INR XXX"
    const m = find(/Bal\s+INR\s+([0-9,]+(?:\.\d{2})?)/i, message);
    if (m) {
      return toPaise(gv(m, 1));
    }

    // Fall back to base class patterns
    return super.extractBalance(message);
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    // Skip OTP and promotional messages
    if (
      lowerMessage.includes('otp') ||
      lowerMessage.includes('one time password') ||
      lowerMessage.includes('verification code')
    ) {
      return false;
    }

    // Check for AU Bank specific transaction keywords
    const auBankKeywords = [
      'credited inr',
      'debited inr',
      'withdrawn inr',
      'dr inr',
      'cr inr',
      'bal inr',
      'ref upi',
      'spent',
    ];

    // If any AU Bank specific pattern is found, it's likely a transaction
    if (auBankKeywords.some(it => lowerMessage.includes(it))) {
      return true;
    }

    // Fall back to base class for standard checks
    return super.isTransactionMessage(message);
  }
}
