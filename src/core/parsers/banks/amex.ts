// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `AMEXBankParser.kt`.

import type { Paise } from '../../types';
import { BankParser } from '../engine/BankParser';
import { toPaise } from '../engine/patterns';
import { find, gv, matches } from '../engine/regex';
import { TransactionType, type BankTxn } from '../engine/types';

/**
 * Parser for American Express (AMEX) card SMS messages
 *
 * Supported formats:
 * - Spending: "Alert: You've spent INR 1,017.70 on your AMEX card ** 91000 at VOUCHER PLAT on 20 August 2025"
 *
 * Common senders: TX-AMEXIN-S, AMEXIN, AMEX
 */
export class AmexBankParser extends BankParser {
  readonly id = 'amex';

  getBankName(): string {
    return 'American Express';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return (
      normalizedSender.includes('AMEX') ||
      normalizedSender.includes('AMEXIN') ||
      // DLT patterns for transactions (-S suffix)
      matches(/^[A-Z]{2}-AMEXIN-S$/, normalizedSender) ||
      matches(/^[A-Z]{2}-AMEX-S$/, normalizedSender) ||
      // Other DLT patterns (OTP, Promotional, Govt)
      matches(/^[A-Z]{2}-AMEXIN-[TPG]$/, normalizedSender) ||
      matches(/^[A-Z]{2}-AMEX-[TPG]$/, normalizedSender) ||
      // Legacy patterns without suffix
      matches(/^[A-Z]{2}-AMEXIN$/, normalizedSender) ||
      matches(/^[A-Z]{2}-AMEX$/, normalizedSender) ||
      // Direct sender IDs
      normalizedSender === 'AMEXIN' ||
      normalizedSender === 'AMEX'
    );
  }

  parse(smsBody: string, sender: string, timestamp: number): BankTxn | null {
    const parsed = super.parse(smsBody, sender, timestamp);
    if (parsed == null) {
      return null;
    }

    // AMEX transactions are always credit card transactions
    // All spending on AMEX cards should be marked as CREDIT type
    return { ...parsed, type: TransactionType.CREDIT };
  }

  protected extractAmount(message: string): Paise | null {
    // Pattern: "You've spent INR 1,017.70" or "spent INR 1,017.70"
    const spent = find(/spent\s+INR\s+([0-9,]+(?:\.\d{2})?)\s+on/i, message);
    if (spent) {
      return toPaise(gv(spent, 1));
    }

    // Pattern for other possible formats: "INR 1,017.70 spent"
    const alt = find(/INR\s+([0-9,]+(?:\.\d{2})?)\s+spent/i, message);
    if (alt) {
      return toPaise(gv(alt, 1));
    }

    // Fall back to base class patterns
    return super.extractAmount(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    // Pattern: "at VOUCHER PLAT on 20 August"
    const m = find(/at\s+([^•\n]+?)\s+on\s+\d{1,2}\s+\w+/i, message);
    if (m) {
      const merchant = this.cleanMerchantName(gv(m, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Fall back to base class patterns
    return super.extractMerchant(message, sender);
  }

  protected extractAccountLast4(message: string): string | null {
    const base = super.extractAccountLast4(message);
    if (base != null) {
      return base;
    }
    // Pattern: "AMEX card ** 91000" - extract the last part
    const card = find(/AMEX\s+card\s+\*+\s*(\d+)/i, message);
    if (card) {
      return this.extractLast4Digits(gv(card, 1));
    }

    // Alternative pattern: "card ending XXXX"
    const ending = find(/card\s+ending\s+(\d{4})/i, message);
    if (ending) {
      return gv(ending, 1);
    }

    return null;
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    // Skip promotional messages
    if (
      lowerMessage.includes('offer') ||
      lowerMessage.includes('reward') ||
      lowerMessage.includes('membership') ||
      lowerMessage.includes('statement') ||
      lowerMessage.includes('due date')
    ) {
      return false;
    }

    // Fall back to base class for other checks
    return super.isTransactionMessage(message);
  }
}
