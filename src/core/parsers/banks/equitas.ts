// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `EquitasBankParser.kt`.
import type { Paise } from '../../types';
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { toPaise } from '../engine/patterns';
import { find, gv } from '../engine/regex';
import { TransactionType } from '../engine/types';

/**
 * Parser for Equitas Small Finance Bank SMS messages
 *
 * Sender patterns: XX-EQUTAS-S, XX-EQUITA-S, EQUTAS, EQUITA
 *
 * SMS Formats:
 * - UPI Debit: "INR XXX.00 debited via UPI from Equitas A/c 12XX -Ref:57198707XXXX on 19-12-25 to MERCHANT. Avl Bal is INR XX,XXX.XX..."
 * - UPI Credit: "INR XXX.00 credited via UPI to Equitas A/c 12XX -Ref:XXXX on DD-MM-YY from SENDER. Avl Bal is INR XX,XXX.XX..."
 */
export class EquitasBankParser extends BaseIndianBankParser {
  readonly id = 'equitas';

  getBankName(): string {
    return 'Equitas Small Finance Bank';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return (
      normalizedSender.includes('EQUTAS') || normalizedSender.includes('EQUITA') || normalizedSender.includes('EQUITS')
    );
  }

  protected extractAmount(message: string): Paise | null {
    // Pattern: "INR XXX.00 debited" or "INR XXX.00 credited"
    const m = find(/INR\s+([0-9,]+(?:\.\d{2})?)\s+(?:debited|credited)/i, message);
    if (m) {
      return toPaise(gv(m, 1));
    }

    return super.extractAmount(message);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('debited')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('credited')) return TransactionType.INCOME;
    if (lowerMessage.includes('withdrawn')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('deposited')) return TransactionType.INCOME;
    return super.extractTransactionType(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    const lowerMessage = message.toLowerCase();

    // Check if it's a debit or credit transaction
    const isDebit = lowerMessage.includes('debited');
    const isCredit = lowerMessage.includes('credited');

    if (isDebit) {
      // Pattern for UPI debit: "to MERCHANT_NAME." or "to MERCHANT_NAME. Avl"
      // Look for "to" after the date pattern (on DD-MM-YY)
      const m = find(/on\s+\d{2}-\d{2}-\d{2}\s+to\s+([^.]+?)(?:\.\s*Avl|\.\s*Not|\.Not|\.$)/i, message);
      if (m) {
        const merchant = this.cleanMerchantName(gv(m, 1).trim());
        if (this.isValidMerchantName(merchant)) {
          return merchant;
        }
      }
    }

    if (isCredit) {
      // Pattern for UPI credit: "on DD-MM-YY from SENDER_NAME. Avl"
      const m = find(/on\s+\d{2}-\d{2}-\d{2}\s+from\s+([^.]+?)(?:\.\s*Avl|\.\s*Not|\.Not|\.$)/i, message);
      if (m) {
        const merchant = this.cleanMerchantName(gv(m, 1).trim());
        if (this.isValidMerchantName(merchant)) {
          return merchant;
        }
      }
    }

    // Check for UPI pattern
    if (lowerMessage.includes('via upi')) {
      return 'UPI Transaction';
    }

    return super.extractMerchant(message, sender);
  }

  protected extractAccountLast4(message: string): string | null {
    const base = super.extractAccountLast4(message);
    if (base != null) {
      return base;
    }

    // Pattern: "Equitas A/c 12XX" or "A/c XX1234"
    const m = find(/(?:Equitas\s+)?A\/c\s+([X\d]+)/i, message);
    if (m) {
      return this.extractLast4Digits(gv(m, 1));
    }

    return null;
  }

  protected extractBalance(message: string): Paise | null {
    // Pattern: "Avl Bal is INR XX,XXX.XX" or "Avl Bal is INR XXXXX"
    const m = find(/Avl\s+Bal\s+is\s+INR\s+([0-9,]+(?:\.\d{2})?)/i, message);
    if (m) {
      return toPaise(gv(m, 1));
    }

    return super.extractBalance(message);
  }

  protected extractReference(message: string): string | null {
    // Pattern: "-Ref:57198707XXXX" or "Ref:XXXX"
    const m = find(/-?Ref[:\s]*([A-Z0-9]+)/i, message);
    if (m) {
      return gv(m, 1);
    }

    return super.extractReference(message);
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    // Skip OTP messages
    if (
      lowerMessage.includes('otp') ||
      lowerMessage.includes('one time password') ||
      lowerMessage.includes('verification code')
    ) {
      return false;
    }

    // Skip promotional messages
    if (lowerMessage.includes('offer') || lowerMessage.includes('discount') || lowerMessage.includes('cashback offer')) {
      return false;
    }

    // Must contain transaction keywords
    const transactionKeywords = ['debited', 'credited', 'withdrawn', 'deposited', 'transferred', 'received', 'paid'];

    return transactionKeywords.some(k => lowerMessage.includes(k));
  }
}
