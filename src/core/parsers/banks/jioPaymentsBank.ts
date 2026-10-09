// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `JioPaymentsBankParser.kt` (extends BankParser).
import type { Paise } from '../../types';
import { BankParser } from '../engine/BankParser';
import { toPaise } from '../engine/patterns';
import { find, gv } from '../engine/regex';
import { TransactionType } from '../engine/types';

/**
 * Parser for Jio Payments Bank (JPB/JPBL) SMS messages
 */
export class JioPaymentsBankParser extends BankParser {
  readonly id = 'jio-payments-bank';

  getBankName(): string {
    return 'Jio Payments Bank';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return normalizedSender.includes('JIOPBS');
  }

  protected extractAmount(message: string): Paise | null {
    // Pattern 1: credited with Rs.1670.00
    const credit = find(/credited\s+with\s+Rs\.?\s*([\d,]+(?:\.\d{2})?)/i, message);
    if (credit) {
      return toPaise(gv(credit, 1));
    }

    // Pattern 2: Rs. 1170.00 Sent from
    const sent = find(/Rs\.?\s*([\d,]+(?:\.\d{2})?)\s+Sent\s+from/i, message);
    if (sent) {
      return toPaise(gv(sent, 1));
    }

    // Pattern 3: debited with Rs. 1750.00
    const debit = find(/debited\s+with\s+Rs\.?\s*([\d,]+(?:\.\d{2})?)/i, message);
    if (debit) {
      return toPaise(gv(debit, 1));
    }

    // Fall back to base class patterns
    return super.extractAmount(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    // Pattern 1: UPI/CR/123456789012/JOHN DO
    // Pattern 2: UPI/DR/123456789012/JOHN DOE
    const upi = find(/UPI\/(?:CR|DR)\/[\d]+\/([^.\n]+?)(?:\s*\.|$)/i, message);
    if (upi) {
      const merchant = this.cleanMerchantName(gv(upi, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // If no specific merchant found, check transaction type
    const lower = message.toLowerCase();
    if (lower.includes('upi/cr')) return 'UPI Credit';
    if (lower.includes('upi/dr')) return 'UPI Payment';
    if (lower.includes('sent from')) return 'Money Transfer';
    return super.extractMerchant(message, sender);
  }

  protected extractAccountLast4(message: string): string | null {
    const base = super.extractAccountLast4(message);
    if (base != null) {
      return base;
    }

    // Pattern 1: JPB A/c x1234
    const jpb = find(/JPB\s+A\/c\s+([x\d]+)/i, message);
    if (jpb) {
      return this.extractLast4Digits(gv(jpb, 1));
    }

    // Pattern 2: from x1234
    const from = find(/from\s+([x\d]+)/i, message);
    if (from) {
      return this.extractLast4Digits(gv(from, 1));
    }

    return null;
  }

  protected extractBalance(message: string): Paise | null {
    // Pattern: Avl. Bal: Rs. 9095.5
    const m = find(/Avl\.?\s*Bal:\s*Rs\.?\s*([\d,]+(?:\.\d{1,2})?)/i, message);
    if (m) {
      return toPaise(gv(m, 1));
    }

    return super.extractBalance(message);
  }

  protected extractReference(message: string): string | null {
    // Pattern: UPI/CR/123456789012 or UPI/DR/123456789012
    const m = find(/UPI\/(?:CR|DR)\/(\d+)/i, message);
    if (m) {
      return gv(m, 1);
    }

    return super.extractReference(message);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('credited')) return TransactionType.INCOME;
    if (lowerMessage.includes('upi/cr')) return TransactionType.INCOME;
    if (lowerMessage.includes('debited')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('upi/dr')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('sent from')) return TransactionType.EXPENSE;
    return super.extractTransactionType(message);
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    // Check for Jio Payments Bank specific transaction keywords
    if (
      lowerMessage.includes('jpb a/c') ||
      lowerMessage.includes('upi/cr') ||
      lowerMessage.includes('upi/dr') ||
      lowerMessage.includes('sent from')
    ) {
      return true;
    }

    return super.isTransactionMessage(message);
  }
}
