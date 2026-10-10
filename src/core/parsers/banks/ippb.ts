// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `IPPBParser.kt`.

import type { Paise } from '../../types';
import { BankParser } from '../engine/BankParser';
import { toPaise } from '../engine/patterns';
import { find, gv, matches } from '../engine/regex';
import { TransactionType } from '../engine/types';

/**
 * Parser for India Post Payments Bank (IPPB) SMS messages
 */
export class IppbParser extends BankParser {
  readonly id = 'ippb';

  getBankName(): string {
    return 'India Post Payments Bank';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    // Pattern: XX-IPBMSG-S or XX-IPBMSG-T where XX is any two letters
    return matches(/^[A-Z]{2}-IPBMSG-[ST]$/, normalizedSender);
  }

  protected extractAmount(message: string): Paise | null {
    // Pattern: Rs.1.00 or Rs. 1.00
    const m = find(/Rs\.?\s*([\d,]+(?:\.\d{2})?)/i, message);
    if (m) {
      return toPaise(gv(m, 1));
    }
    return super.extractAmount(message);
  }

  protected extractAccountLast4(message: string): string | null {
    const base = super.extractAccountLast4(message);
    if (base != null) {
      return base;
    }
    // Pattern 1: A/C X1234 or a/c X1234
    const m = find(/[Aa]\/[Cc]\s+([X\d]+)/i, message);
    if (m) {
      return this.extractLast4Digits(gv(m, 1));
    }
    return null;
  }

  protected extractBalance(message: string): Paise | null {
    // Pattern: Avl Bal Rs.436.91
    const m = find(/Avl\s+Bal\s+Rs\.?\s*([\d,]+(?:\.\d{2})?)/i, message);
    if (m) {
      return toPaise(gv(m, 1));
    }
    return super.extractBalance(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    const lowerMessage = message.toLowerCase();

    // Pattern 1: "for UPI to john@superyes" (Debit)
    if (lowerMessage.includes('debit')) {
      const m = find(/to\s+([^\s]+(?:@[^\s]+)?)/i, message);
      if (m) {
        const merchant = gv(m, 1).trim();
        // Clean up UPI ID if needed
        if (merchant.includes('@')) {
          const name = merchant.substring(0, merchant.indexOf('@'));
          return this.cleanMerchantName(name);
        }
        return this.cleanMerchantName(merchant);
      }

      // Fallback: "for UPI" without specific merchant
      if (lowerMessage.includes('for upi')) {
        return 'UPI Payment';
      }
    }

    // Pattern 2: "from john doe thru IPPB" (Credit)
    if (lowerMessage.includes('received a payment')) {
      const m = find(/from\s+(.+?)\s+thru/i, message);
      if (m) {
        return this.cleanMerchantName(gv(m, 1).trim());
      }
    }

    return super.extractMerchant(message, sender);
  }

  protected extractReference(message: string): string | null {
    // Pattern 1: Ref 560002638161
    const ref = find(/Ref\s+(\d+)/i, message);
    if (ref) {
      return gv(ref, 1);
    }

    // Pattern 2: Info: UPI/CREDIT/523498793035
    const info = find(/Info:\s*UPI\/[^/]+\/(\d+)/i, message);
    if (info) {
      return gv(info, 1);
    }

    return super.extractReference(message);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('debit')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('received a payment')) return TransactionType.INCOME;
    if (lowerMessage.includes('credit') && lowerMessage.includes('info: upi/credit')) return TransactionType.INCOME;
    return super.extractTransactionType(message);
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    // Check for IPPB-specific transaction keywords
    if (
      lowerMessage.includes('debit rs') ||
      lowerMessage.includes('received a payment') ||
      (lowerMessage.includes('info: upi') && lowerMessage.includes('credit'))
    ) {
      return true;
    }

    return super.isTransactionMessage(message);
  }
}
