// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `bank/YesBankParser.kt`.
import type { Paise } from '../../types';
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { toPaise } from '../engine/patterns';
import { find, gv, matches } from '../engine/regex';
import { TransactionType } from '../engine/types';

const YES_BANK_KEYWORDS = [
  'spent on yes bank card',
  'debited',
  'credited',
  'withdrawn',
  'deposited',
  'avl lmt', // available limit indicates a transaction
];

/**
 * Parser for Yes Bank SMS messages.
 *
 * Supported formats:
 * - Credit Card UPI: "INR XXX.XX spent on YES BANK Card XXXXX @UPI_MERCHANT DATE TIME. Avl Lmt INR XXX,XXX.XX"
 *
 * Common senders: CP-YESBNK-S, VM-YESBNK-S, JX-YESBNK-S
 */
export class YesBankParser extends BaseIndianBankParser {
  readonly id = 'yes';

  getBankName(): string {
    return 'Yes Bank';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return (
      matches(/^[A-Z]{2}-YESBNK-S$/, normalizedSender) ||
      matches(/^[A-Z]{2}-YESBNK$/, normalizedSender) ||
      normalizedSender === 'YESBNK' ||
      normalizedSender === 'YESBANK'
    );
  }

  protected extractAmount(message: string): Paise | null {
    // "INR XXX.XX spent" format.
    const m = find(/INR\s+([0-9,]+(?:\.\d{2})?)\s+spent/i, message);
    if (m) {
      return toPaise(gv(m, 1));
    }
    return super.extractAmount(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    // "@UPI_MERCHANT NAME": everything after @UPI_ until the date (DD-MM-YYYY).
    const upi = find(/@UPI_([^0-9]+?)(?:\s+\d{2}-\d{2}-\d{4})/i, message);
    if (upi) {
      const cleaned = gv(upi, 1).trim().replace(/\s+/g, ' ').trim();
      if (cleaned.length > 0) {
        return cleaned;
      }
    }

    // Alternative if the date format is different.
    const alt = find(/@UPI_([A-Z\s]+)/i, message);
    if (alt) {
      const cleaned = gv(alt, 1).trim().replace(/\s+/g, ' ').trim();
      if (cleaned.length > 0 && this.isValidMerchantName(cleaned)) {
        return cleaned;
      }
    }

    return super.extractMerchant(message, sender);
  }

  protected extractAccountLast4(message: string): string | null {
    const base = super.extractAccountLast4(message);
    if (base != null) {
      return base;
    }
    // "YES BANK Card XXXXX" where X can be X or an actual digit.
    const card = find(/YES\s+BANK\s+Card\s+([X\d]+)/i, message);
    if (card) {
      return this.extractLast4Digits(gv(card, 1));
    }
    // "SMS BLKCC 1234" carries the last 4 digits.
    const blkcc = find(/SMS\s+BLKCC\s+(\d{4})/i, message);
    if (blkcc) {
      return gv(blkcc, 1);
    }
    return null;
  }

  protected extractAvailableLimit(message: string): Paise | null {
    const m = find(/Avl\s+Lmt\s+INR\s+([0-9,]+(?:\.\d{2})?)/i, message);
    if (m) {
      return toPaise(gv(m, 1));
    }
    return super.extractAvailableLimit(message);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lower = message.toLowerCase();

    if (this.isInvestmentTransaction(lower)) {
      return TransactionType.INVESTMENT;
    }

    // Yes Bank credit card transactions have "spent" and "Avl Lmt".
    if (lower.includes('spent') && lower.includes('yes bank card') && lower.includes('avl lmt')) {
      return TransactionType.CREDIT;
    }

    if (lower.includes('debited')) return TransactionType.EXPENSE;
    if (lower.includes('withdrawn')) return TransactionType.EXPENSE;
    if (lower.includes('spent')) return TransactionType.EXPENSE;
    if (lower.includes('charged')) return TransactionType.EXPENSE;
    if (lower.includes('paid')) return TransactionType.EXPENSE;

    if (lower.includes('credited')) return TransactionType.INCOME;
    if (lower.includes('deposited')) return TransactionType.INCOME;
    if (lower.includes('received')) return TransactionType.INCOME;
    if (lower.includes('refund')) return TransactionType.INCOME;

    return null;
  }

  protected isTransactionMessage(message: string): boolean {
    const lower = message.toLowerCase();

    // OTP and verification messages.
    if (lower.includes('otp') || lower.includes('verification') || lower.includes('one time password')) {
      return false;
    }
    // Promotional messages.
    if (lower.includes('offer') || lower.includes('cashback offer') || lower.includes('discount')) {
      return false;
    }
    // Any Yes Bank specific pattern means it is likely a transaction.
    if (YES_BANK_KEYWORDS.some(k => lower.includes(k))) {
      return true;
    }
    return super.isTransactionMessage(message);
  }

  protected detectIsCard(message: string): boolean {
    const lower = message.toLowerCase();
    if (lower.includes('yes bank card')) {
      return true;
    }
    // SMS BLKCC (Block Credit Card) instruction indicates a card transaction.
    if (lower.includes('sms blkcc')) {
      return true;
    }
    return super.detectIsCard(message);
  }
}
