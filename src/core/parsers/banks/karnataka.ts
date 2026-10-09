// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `KarnatakaBankParser.kt` (extends BankParser).
import type { Paise } from '../../types';
import { BankParser } from '../engine/BankParser';
import { toPaise } from '../engine/patterns';
import { find, gv, test } from '../engine/regex';

/**
 * Parser for Karnataka Bank SMS messages
 *
 * Supported formats:
 * - Debit: "Your Account x001234x has been DEBITED for Rs.6368/-"
 * - Credit: "Your a/c XX1234 is credited by Rs.6600.00"
 * - ACH, UPI, and other transaction types
 *
 * Common senders: Karnataka Bank, KTKBNK, variations with DLT patterns
 */
export class KarnatakaBankParser extends BankParser {
  readonly id = 'karnataka';

  getBankName(): string {
    return 'Karnataka Bank';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return (
      normalizedSender.includes('KARNATAKA BANK') ||
      normalizedSender.includes('KARNATAKABANK') ||
      normalizedSender.includes('KBLBNK') ||
      normalizedSender.includes('KTKBANK') ||
      normalizedSender.includes('KARBANK') ||
      // DLT patterns for transactions (-S suffix)
      /^[A-Z]{2}-KBLBNK-S$/.test(normalizedSender) ||
      /^[A-Z]{2}-KARBANK-S$/.test(normalizedSender) ||
      // Legacy patterns
      /^[A-Z]{2}-KBLBNK$/.test(normalizedSender) ||
      // Direct sender IDs
      normalizedSender === 'KBLBNK' ||
      normalizedSender === 'KARBANK'
    );
  }

  protected extractAmount(message: string): Paise | null {
    // Pattern 1: "DEBITED for Rs.6368/-"
    const debit = find(/DEBITED\s+for\s+Rs\.?([0-9,]+(?:\.\d{2})?)\/?-?/i, message);
    if (debit) {
      return toPaise(gv(debit, 1));
    }

    // Pattern 2: "credited by Rs.6600.00"
    const credit = find(/credited\s+by\s+Rs\.?([0-9,]+(?:\.\d{2})?)/i, message);
    if (credit) {
      return toPaise(gv(credit, 1));
    }

    // Fall back to base class patterns
    return super.extractAmount(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    // Pattern 1: ACH transactions - "ACHInwDr-MERCHANT/date"
    const ach = find(/ACH[A-Za-z]*-([^/]+)\//i, message);
    if (ach) {
      const merchant = this.cleanMerchantName(gv(ach, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Pattern 2: "from <merchant> on" for UPI
    const fromPattern = /from\s+([^\s]+)\s+on/i;
    const from = find(fromPattern, message);
    if (from) {
      const merchant = this.cleanMerchantName(gv(from, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Pattern 3: UPI transfer payee — "… debited for Rs.X on 06-10-26 trf to
    // SK FAST FOOD CORNER. UPI:6****28.For dispute …" (#868). Ends at the
    // ". UPI:" / ". For" trailer rather than any period, so a payee written
    // with initials ("M. K. STORES") stays whole.
    const trfTo = find(/trf\s+to\s+(.+?)\s*\.\s*(?:UPI\b|For\b|$)/i, message);
    if (trfTo) {
      const merchant = this.cleanMerchantName(gv(trfTo, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Pattern 4: Check for specific transaction types
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('lic of india')) return 'LIC of India';
    if (lowerMessage.includes('upi') && find(fromPattern, message) == null) return 'UPI Transaction';
    return super.extractMerchant(message, sender);
  }

  protected extractAccountLast4(message: string): string | null {
    const base = super.extractAccountLast4(message);
    if (base != null) {
      return base;
    }

    // Pattern 1: "Account x001234x" or "Account XX1234X"
    // Capture everything after keyword, filter to digits, take last 4
    const account1 = find(/Account\s+([xX\d]+)/i, message);
    if (account1) {
      return this.extractLast4Digits(gv(account1, 1));
    }

    // Pattern 2: "a/c XX1234"
    const account2 = find(/a\/c\s+([xX\d]+)/i, message);
    if (account2) {
      return this.extractLast4Digits(gv(account2, 1));
    }

    return null;
  }

  protected extractReference(message: string): string | null {
    // Pattern 1: "UPI Ref no 441877242175"
    const upiRef = find(/UPI\s+Ref\s+no\s+([0-9]+)/i, message);
    if (upiRef) {
      return gv(upiRef, 1);
    }

    // "UPI:6*********39" is masked — the generic UPI pattern would store the
    // lone leading "6" as the reference. No reference beats a wrong one.
    if (test(/UPI:\s*\d*\*/i, message)) return null;

    // Fall back to base class
    return super.extractReference(message);
  }

  protected extractBalance(message: string): Paise | null {
    // Pattern: "Balance is Rs.705.92"
    const m = find(/Balance\s+is\s+Rs\.?([0-9,]+(?:\.\d{2})?)/i, message);
    if (m) {
      return toPaise(gv(m, 1));
    }

    // Fall back to base class
    return super.extractBalance(message);
  }
}
