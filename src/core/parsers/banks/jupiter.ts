// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `JupiterBankParser.kt`.

import type { Paise } from '../../types';
import { BankParser } from '../engine/BankParser';
import { toPaise } from '../engine/patterns';
import { find, gv, matches } from '../engine/regex';
import { TransactionType } from '../engine/types';

/**
 * Parser for Jupiter Bank (CSB Bank partner) SMS messages
 *
 * Jupiter is a digital banking app powered by CSB Bank.
 *
 * Supported formats:
 * - Credit card transactions: "Rs.130.00 debited to your Edge CSB Bank RuPay Credit Card"
 * - UPI transactions
 * - Account debits/credits
 *
 * Common senders: JTEDGE, JUPITER, variations with DLT patterns
 */
export class JupiterBankParser extends BankParser {
  readonly id = 'jupiter';

  getBankName(): string {
    return 'Jupiter';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return (
      matches(/^[A-Z]{2}-JTEDGE-S$/, normalizedSender) ||
      matches(/^[A-Z]{2}-JTEDGE-T$/, normalizedSender) ||
      // Legacy patterns
      matches(/^[A-Z]{2}-JTEDGE$/, normalizedSender)
    );
  }

  protected extractAmount(message: string): Paise | null {
    // Pattern 1: "Rs.130.00 debited"
    const debit = find(/Rs\.?\s*([0-9,]+(?:\.\d{2})?)\s+debited/i, message);
    if (debit) {
      return toPaise(gv(debit, 1));
    }

    // Pattern 2: "Rs.XXX credited"
    const credit = find(/Rs\.?\s*([0-9,]+(?:\.\d{2})?)\s+credited/i, message);
    if (credit) {
      return toPaise(gv(credit, 1));
    }

    // Fall back to base class patterns
    return super.extractAmount(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    return super.extractMerchant(message, sender);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();

    if (
      lowerMessage.includes('credit card') &&
      (lowerMessage.includes('debited') || lowerMessage.includes('spent') || lowerMessage.includes('charged'))
    ) {
      return TransactionType.CREDIT;
    }

    return super.extractTransactionType(message);
  }

  protected extractAccountLast4(message: string): string | null {
    const base = super.extractAccountLast4(message);
    if (base != null) {
      return base;
    }
    // Pattern 1: "ending 6852"
    const ending = find(/ending\s+(\d{4})/i, message);
    if (ending) {
      return gv(ending, 1);
    }

    // Pattern 2: "Card ending 6852"
    const cardEnding = find(/Card\s+ending\s+(\d{4})/i, message);
    if (cardEnding) {
      return gv(cardEnding, 1);
    }

    return null;
  }

  protected extractReference(message: string): string | null {
    // Pattern: "UPI Ref no.281751568470"
    const m = find(/UPI\s+Ref\s+no\.?\s*([A-Za-z0-9]+)/i, message);
    if (m) {
      return gv(m, 1);
    }

    // Fall back to base class
    return super.extractReference(message);
  }

  protected isTransactionMessage(message: string): boolean {
    // Upstream checks "to dispute … call" (instruction text only, never skips the
    // message) and "jupiter"/"csb" before deferring to the base class in every case.
    return super.isTransactionMessage(message);
  }
}
