// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
//
// Upstream `UnionBankParser.kt`: Union Bank of India account, ATM and UPI alerts.

import type { Paise } from '../../types';
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { toPaise } from '../engine/patterns';
import { allDigits, find, gv } from '../engine/regex';

/**
 * Parser for Union Bank of India SMS messages
 *
 * Supported formats:
 * - Debit: "A/c *1234 Debited for Rs:100.00 on 11-08-2025 18:28:02 by Mob Bk ref no 123456789000 Avl Bal Rs:12345.67"
 * - Credit transactions
 * - ATM withdrawals
 * - UPI transactions
 *
 * Sender patterns: XX-UNIONB-S/T, UNIONB, UNIONBANK, etc.
 */
export class UnionBankParser extends BaseIndianBankParser {
  readonly id = 'union-bank';

  getBankName(): string {
    return 'Union Bank of India';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return (
      normalizedSender.includes('UNIONB') ||
      normalizedSender.includes('UNIONBANK') ||
      normalizedSender.includes('UBOI') ||
      // DLT patterns for transactions (-S, -T suffix)
      /^[A-Z]{2}-UNIONB-[ST]$/.test(normalizedSender) ||
      // Other DLT patterns
      /^[A-Z]{2}-UNIONB-[TPG]$/.test(normalizedSender) ||
      // Legacy patterns
      /^[A-Z]{2}-UNIONB$/.test(normalizedSender) ||
      /^[A-Z]{2}-UNIONBANK$/.test(normalizedSender)
    );
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    // Union Bank includes "Never Share OTP/PIN/CVV" warning in transaction messages
    // Check if it's actually a transaction first before rejecting due to OTP keyword
    const transactionKeywords = ['debited', 'credited', 'withdrawn', 'deposited', 'spent', 'received', 'transferred', 'paid'];

    if (transactionKeywords.some(it => lowerMessage.includes(it))) {
      // It's a transaction message, even if it contains OTP in warning text
      return true;
    }

    // Fall back to parent logic for non-transaction messages
    return super.isTransactionMessage(message);
  }

  protected extractAmount(message: string): Paise | null {
    // Pattern 1: "Rs:100.00" or "Rs.100.00" (Union Bank format with colon)
    const p1 = find(/Rs[:.]?\s*([0-9,]+(?:\.\d{2})?)/i, message);
    if (p1) {
      return toPaise(gv(p1, 1));
    }

    // Pattern 2: "INR 500" format
    const p2 = find(/INR\s+([0-9,]+(?:\.\d{2})?)/i, message);
    if (p2) {
      return toPaise(gv(p2, 1));
    }

    // Fall back to base class patterns
    return super.extractAmount(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    const lower = message.toLowerCase();

    // Pattern 1: Mobile Banking - "by Mob Bk"
    if (lower.includes('mob bk')) {
      return 'Mobile Banking Transfer';
    }

    // Pattern 2: ATM transactions
    if (lower.includes('atm')) {
      const atm = find(/at\s+([^.\s]+(?:\s+[^.\s]+)*)(?:\s+on|\s+Avl|$)/i, message);
      if (atm) {
        return this.cleanMerchantName(gv(atm, 1).trim());
      }
      return 'ATM Withdrawal';
    }

    // Pattern 3: UPI transactions - "UPI/merchant" or "VPA merchant@bank"
    if (lower.includes('upi')) {
      const upi = find(/UPI[/:]?\s*([^,.\s]+)/i, message);
      if (upi) {
        return this.cleanMerchantName(gv(upi, 1).trim());
      }
    }

    if (lower.includes('vpa')) {
      const vpa = find(/VPA\s+([^@\s]+)/i, message);
      if (vpa) {
        const vpaName = gv(vpa, 1).trim();
        return this.parseUPIMerchant(vpaName);
      }
    }

    // Pattern 4: "to <merchant>" for transfers
    const to = find(/to\s+([^.\n]+?)(?:\s+on|\s+Avl|$)/i, message);
    if (to) {
      const merchant = gv(to, 1).trim();
      if (!merchant.toLowerCase().includes('avl')) {
        return this.cleanMerchantName(merchant);
      }
    }

    // Pattern 5: "from <sender>" for credits
    const from = find(/from\s+([^.\n]+?)(?:\s+on|\s+Avl|$)/i, message);
    if (from) {
      const merchant = gv(from, 1).trim();
      if (!merchant.toLowerCase().includes('avl')) {
        return this.cleanMerchantName(merchant);
      }
    }

    // Fall back to base class extraction
    return super.extractMerchant(message, sender);
  }

  protected extractReference(message: string): string | null {
    // Union Bank format: "ref no 123456789000"
    const refPatterns = [/ref\s+no\s+([\w]+)/i, /ref[:#]?\s*([\w]+)/i, /reference[:#]?\s*([\w]+)/i, /txn[:#]?\s*([\w]+)/i];

    for (const pattern of refPatterns) {
      const m = find(pattern, message);
      if (m) {
        return gv(m, 1).trim();
      }
    }

    return super.extractReference(message);
  }

  protected extractAccountLast4(message: string): string | null {
    const base = super.extractAccountLast4(message);
    if (base != null) {
      return base;
    }

    // Union Bank format: "A/c *1234" or "A/C X1234"
    const accountPatterns = [/A\/[Cc]\s*[*X](\d{4})/i, /Account\s*[*X](\d{4})/i, /Acc\s*[*X](\d{4})/i, /A\/[Cc]\s+(\d{4})/i];

    for (const pattern of accountPatterns) {
      const m = find(pattern, message);
      if (m) {
        return gv(m, 1);
      }
    }

    return null;
  }

  protected extractBalance(message: string): Paise | null {
    // Union Bank format: "Avl Bal Rs:12345.67" or "Avl Bal Rs.12345.67"
    const balancePatterns = [
      /Avl\s+Bal\s+Rs[:.]?\s*([0-9,]+(?:\.\d{2})?)/i,
      /Available\s+Balance[:.]?\s*Rs[:.]?\s*([0-9,]+(?:\.\d{2})?)/i,
      /Balance[:.]?\s*Rs[:.]?\s*([0-9,]+(?:\.\d{2})?)/i,
      /Bal[:.]?\s*Rs[:.]?\s*([0-9,]+(?:\.\d{2})?)/i,
    ];

    for (const pattern of balancePatterns) {
      const m = find(pattern, message);
      if (m) {
        return toPaise(gv(m, 1));
      }
    }

    return super.extractBalance(message);
  }

  private parseUPIMerchant(vpa: string): string {
    const cleanVPA = vpa.toLowerCase();

    // Common payment apps and merchants
    if (cleanVPA.includes('paytm')) return 'Paytm';
    if (cleanVPA.includes('phonepe')) return 'PhonePe';
    if (cleanVPA.includes('googlepay') || cleanVPA.includes('gpay')) return 'Google Pay';
    if (cleanVPA.includes('bharatpe')) return 'BharatPe';
    if (cleanVPA.includes('amazon')) return 'Amazon';
    if (cleanVPA.includes('flipkart')) return 'Flipkart';
    if (cleanVPA.includes('swiggy')) return 'Swiggy';
    if (cleanVPA.includes('zomato')) return 'Zomato';
    if (cleanVPA.includes('uber')) return 'Uber';
    if (cleanVPA.includes('ola')) return 'Ola';

    // Individual transfers (just numbers)
    if (/^\d+$/.test(cleanVPA)) return 'Individual';

    // Default - clean up the VPA name
    const parts = cleanVPA.split(/[.\-_]/);
    const matched = parts.find(it => it.length > 3 && !allDigits(it)) ?? 'merchant';
    return matched.length === 0 ? matched : matched.slice(0, 1).toUpperCase() + matched.slice(1);
  }
}
