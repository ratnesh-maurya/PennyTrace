// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `KeralaGraminBankParser.kt`.

import type { Paise } from '../../types';
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { toPaise } from '../engine/patterns';
import { find, gv } from '../engine/regex';
import { TransactionType } from '../engine/types';

/**
 * Parser for Kerala Gramin Bank (India) SMS messages
 *
 * Handles formats like:
 * - "Your a/c no. XXXX12345 is debited for Rs.160.00 on 28/7/25 05:06 PM and credited to a/c no. XXXXX00019 (UPI Ref no 170632692557)"
 * - "Dear Customer, Account XXXX123 is credited with INR 3000 on 20-10-2025 08:15:26 from 7025784485@upi. UPI Ref. no. 529807237409"
 *
 * Common senders: AD-KGBANK-S, BX-KGBANK-S
 * Currency: INR (Indian Rupee)
 */
export class KeralaGraminBankParser extends BaseIndianBankParser {
  readonly id = 'kerala-gramin';

  getBankName(): string {
    return 'Kerala Gramin Bank';
  }

  getCurrency(): string {
    return 'INR';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return (
      normalizedSender.includes('KGBANK') ||
      normalizedSender.includes('KERALA GRAMIN') ||
      normalizedSender.includes('KERALAGR')
    );
  }

  protected extractAmount(message: string): Paise | null {
    // Pattern 1: "debited for Rs.160.00" or "credited with INR 3000"
    const m = find(
      /(?:debited for|credited with)\s+(?:Rs\.?|INR)\s*([0-9,]+(?:\.[0-9]{2})?)/i,
      message,
    );
    if (m) {
      return toPaise(gv(m, 1));
    }
    return null;
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();

    // Debited = expense
    if (
      lowerMessage.includes('debited for') ||
      lowerMessage.includes('is debited')
    ) {
      return TransactionType.EXPENSE;
    }

    // Credited = income
    if (
      lowerMessage.includes('credited with') ||
      lowerMessage.includes('is credited')
    ) {
      return TransactionType.INCOME;
    }

    return null;
  }

  protected extractMerchant(message: string, _sender: string): string | null {
    const lower = message.toLowerCase();
    // Pattern 1: UPI debit - "credited to a/c no. XXXXX00019 (UPI Ref"
    // This is money sent via UPI
    if (lower.includes('debited') && lower.includes('credited to')) {
      return 'UPI Transfer';
    }

    // Pattern 2: UPI credit - "from 7025784485@upi" or "from merchant@paytm"
    const m = find(/from\s+([^.\s]+@[a-z]+)/i, message);
    if (m) {
      const upiId = gv(m, 1).trim();
      // If it's a phone number@provider, return generic UPI Payment
      const at = upiId.indexOf('@');
      const namePart = at >= 0 ? upiId.substring(0, at) : upiId;
      if (/^\d+$/.test(namePart)) {
        return 'UPI Payment';
      }
      // Otherwise extract the name part before @
      if (namePart !== '') {
        return this.cleanMerchantName(namePart);
      }
    }

    return null;
  }

  protected extractAccountLast4(message: string): string | null {
    const base = super.extractAccountLast4(message);
    if (base != null) {
      return base;
    }
    // Pattern: "Your a/c no. XXXX12345" or "Account XXXX123"
    const m = find(/(?:a\/c no\.|Account)\s+([X\d]+)/i, message);
    if (m) {
      return this.extractLast4Digits(gv(m, 1));
    }
    return null;
  }

  protected extractReference(message: string): string | null {
    // Pattern 1: "UPI Ref no 170632692557" or "UPI Ref. no. 529807237409"
    const m = find(/UPI Ref\.?\s*no\.?\s*(\d+)/i, message);
    if (m) {
      return gv(m, 1);
    }
    return null;
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    // Skip OTP and promotional messages
    if (lowerMessage.includes('otp') || lowerMessage.includes('password')) {
      return false;
    }

    // Must contain transaction keywords
    const transactionKeywords = [
      'debited for',
      'is debited',
      'credited with',
      'is credited',
    ];
    return transactionKeywords.some(k => lowerMessage.includes(k));
  }
}
