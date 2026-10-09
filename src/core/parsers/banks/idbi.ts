// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `IDBIBankParser.kt` (extends BankParser, not BaseIndianBankParser).
import type { Paise } from '../../types';
import { BankParser } from '../engine/BankParser';
import { toPaise } from '../engine/patterns';
import { find, gv } from '../engine/regex';

/**
 * Parser for IDBI Bank SMS messages
 *
 * Supported formats:
 * - Debit: "Your account has been successfully debited with Rs 59.00"
 * - UPI: "IDBI Bank Acct XX1234 debited for Rs 1040.00"
 * - AutoPay/Mandate transactions
 * - Balance information
 *
 * Common senders: IDBIBK, IDBIBANK, variations with DLT patterns
 */
export class IdbiBankParser extends BankParser {
  readonly id = 'idbi';

  getBankName(): string {
    return 'IDBI Bank';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return (
      normalizedSender.includes('IDBIBK') ||
      normalizedSender.includes('IDBIBANK') ||
      normalizedSender.includes('IDBI') ||
      // DLT patterns for transactions (-S suffix)
      /^[A-Z]{2}-IDBIBK-S$/.test(normalizedSender) ||
      /^[A-Z]{2}-IDBI-S$/.test(normalizedSender) ||
      // Legacy patterns
      /^[A-Z]{2}-IDBIBK$/.test(normalizedSender) ||
      /^[A-Z]{2}-IDBI$/.test(normalizedSender) ||
      // Direct sender IDs
      normalizedSender === 'IDBIBK' ||
      normalizedSender === 'IDBIBANK'
    );
  }

  protected extractAmount(message: string): Paise | null {
    // Pattern 1: "debited with Rs 59.00"
    const debitWith = find(/debited\s+with\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i, message);
    if (debitWith) {
      return toPaise(gv(debitWith, 1));
    }

    // Pattern 2: "debited for Rs 1040.00"
    const debitFor = find(/debited\s+for\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i, message);
    if (debitFor) {
      return toPaise(gv(debitFor, 1));
    }

    // Pattern 3: "credited with Rs XXX"
    const credit = find(/credited\s+with\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i, message);
    if (credit) {
      return toPaise(gv(credit, 1));
    }

    // Fall back to base class patterns
    return super.extractAmount(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    // Pattern 1: "towards <merchant> for"
    const towards = find(/towards\s+([^.\n]+?)\s+for/i, message);
    if (towards) {
      const merchant = this.cleanMerchantName(gv(towards, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Pattern 2: "; <merchant> credited."
    const creditedMerchant = find(/;\s*([^.\n]+?)\s+credited\./i, message);
    if (creditedMerchant) {
      const merchant = this.cleanMerchantName(gv(creditedMerchant, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Pattern 3: AutoPay/Mandate specific
    const lower = message.toLowerCase();
    if (lower.includes('autopay') || lower.includes('mandate')) {
      // Extract merchant name before "for" if it's AutoPay
      const m = find(/towards\s+([^.\n]+?)\s+for\s+\w*MANDATE/i, message);
      if (m) {
        return this.cleanMerchantName(gv(m, 1).trim());
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

    // Pattern 1: "Acct XX1234" or "IDBI Bank Acct XX1234"
    const acctPatterns = [/IDBI\s+Bank\s+Acct\s+([X*\d]+)/i, /Acct\s+([X*\d]+)/i];
    for (const pattern of acctPatterns) {
      const m = find(pattern, message);
      if (m) {
        return this.extractLast4Digits(gv(m, 1));
      }
    }

    return null;
  }

  protected extractReference(message: string): string | null {
    // Pattern 1: "RRN 519766155631"
    const rrn = find(/RRN\s+([A-Za-z0-9]+)/i, message);
    if (rrn) {
      return gv(rrn, 1);
    }

    // Pattern 2: "UPI:521687538121"
    const upi = find(/UPI:([A-Za-z0-9]+)/i, message);
    if (upi) {
      return gv(upi, 1);
    }

    // Fall back to base class
    return super.extractReference(message);
  }

  protected extractBalance(message: string): Paise | null {
    // Pattern: "Bal Rs 3694.38"
    const m = find(/Bal\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i, message);
    if (m) {
      return toPaise(gv(m, 1));
    }

    // Fall back to base class
    return super.extractBalance(message);
  }

  protected isTransactionMessage(message: string): boolean {
    // Upstream checks for UPI block instructions ("to block upi" + "send sms") but
    // deliberately does not skip the message: it is just instruction text.
    // Fall back to base class for standard checks
    return super.isTransactionMessage(message);
  }
}
