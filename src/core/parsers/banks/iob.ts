// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `IndianOverseasBankParser.kt` (extends BankParser).
import type { Paise } from '../../types';
import { BankParser } from '../engine/BankParser';
import { toPaise } from '../engine/patterns';
import { find, gv } from '../engine/regex';
import { TransactionType } from '../engine/types';

/**
 * Parser for Indian Overseas Bank (IOB) SMS messages
 *
 * Common senders: VA-IOBCHN-S, XX-IOB-S, etc.
 *
 * SMS Format:
 * Your a/c no. XXXXX92 is credited by Rs.906.00 on 2025-08-28 17, from JOHN DOE-9999999999@su(UPI Ref no 123456789012).Payer Remark - Paid via Supe -IOB
 */
export class IndianOverseasBankParser extends BankParser {
  readonly id = 'iob';

  getBankName(): string {
    return 'Indian Overseas Bank';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return normalizedSender.includes('IOB') || normalizedSender.includes('IOBCHN');
  }

  protected extractAmount(message: string): Paise | null {
    // List of amount patterns for IOB
    const amountPatterns = [
      // "credited by Rs.906.00"
      /credited\s+by\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
      // "debited by Rs.906.00"
      /debited\s+by\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
      // "credited with Rs.906.00"
      /credited\s+with\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
      // "debited for Rs.906.00"
      /debited\s+for\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
    ];

    for (const pattern of amountPatterns) {
      const m = find(pattern, message);
      if (m) {
        return toPaise(gv(m, 1));
      }
    }

    return super.extractAmount(message);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('credited by')) return TransactionType.INCOME;
    if (lowerMessage.includes('credited with')) return TransactionType.INCOME;
    if (lowerMessage.includes('is credited')) return TransactionType.INCOME;

    if (lowerMessage.includes('debited by')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('debited for')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('is debited')) return TransactionType.EXPENSE;

    return super.extractTransactionType(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    // UPI transaction with payer details
    // Pattern: "from JOHN DOE-9999999999@su(UPI Ref"
    const upiPayer = find(/from\s+([^(]+?)(?:\(UPI|$)/i, message);
    if (upiPayer) {
      const payer = gv(upiPayer, 1).trim();

      // Check if it contains UPI ID
      if (payer.includes('@')) {
        // Extract name and UPI ID
        const parts = payer.split('-');
        if (parts.length >= 2) {
          const name = this.cleanMerchantName(parts[0].trim());
          const upiId = parts[1].trim();
          return `UPI - ${name} (${upiId})`;
        }
        return `UPI - ${this.cleanMerchantName(payer)}`;
      } else {
        const cleanedPayer = this.cleanMerchantName(payer);
        if (this.isValidMerchantName(cleanedPayer)) {
          return cleanedPayer;
        }
      }
    }

    // Check for payer remark
    const remarkMatch = find(/Payer\s+Remark\s*-\s*([^-]+)/i, message);
    if (remarkMatch) {
      const remark = this.cleanMerchantName(gv(remarkMatch, 1).trim());
      if (this.isValidMerchantName(remark) && remark.toLowerCase() !== 'paid via supe') {
        return remark;
      }
    }

    // Generic patterns for debit transactions
    if (message.toLowerCase().includes('debited')) {
      // Try to extract merchant from "to" or "for" patterns
      const toMatch = find(/(?:to|for)\s+([^,.-]+)/i, message);
      if (toMatch) {
        const merchant = this.cleanMerchantName(gv(toMatch, 1).trim());
        if (this.isValidMerchantName(merchant)) {
          return merchant;
        }
      }
    }

    return super.extractMerchant(message, sender);
  }

  protected extractAccountLast4(message: string): string | null {
    const base = super.extractAccountLast4(message);
    if (base != null) {
      return base;
    }

    // Pattern: "Your a/c no. XXXXX92"
    const m = find(/a\/c\s+no\.\s+([X\d]+)/i, message);
    if (m) {
      return this.extractLast4Digits(gv(m, 1));
    }

    return null;
  }

  protected extractReference(message: string): string | null {
    // Pattern: "(UPI Ref no 123456789012)"
    const upiRef = find(/\(UPI\s+Ref\s+no\s+(\d+)\)/i, message);
    if (upiRef) {
      return gv(upiRef, 1);
    }

    // Alternative pattern without parentheses
    const altUpiRef = find(/UPI\s+Ref\s+no\s+(\d+)/i, message);
    if (altUpiRef) {
      return gv(altUpiRef, 1);
    }

    return super.extractReference(message);
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    // Skip OTP and non-transaction messages
    if (
      lowerMessage.includes('otp') ||
      lowerMessage.includes('verification') ||
      lowerMessage.includes('request') ||
      lowerMessage.includes('failed')
    ) {
      return false;
    }

    // Check for IOB specific transaction patterns
    if (
      lowerMessage.includes('is credited by') ||
      lowerMessage.includes('is debited by') ||
      lowerMessage.includes('credited with') ||
      lowerMessage.includes('debited for')
    ) {
      return true;
    }

    return super.isTransactionMessage(message);
  }
}
