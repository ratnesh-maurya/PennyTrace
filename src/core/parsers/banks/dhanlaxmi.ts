// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `DhanlaxmiBankParser.kt`.
import type { Paise } from '../../types';
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { toPaise } from '../engine/patterns';
import { find, gv } from '../engine/regex';
import { TransactionType } from '../engine/types';

/**
 * Parser for Dhanlaxmi Bank SMS messages
 *
 * Supported formats:
 * - UPI debits: "INR 20.00 is debited from A/c XXXX1234 on 28-NOV-2025 - "UPI TXN: ..."
 * - UPI credits: "INR 10.00 is credited to A/c XXXX1234 on 24-APR-2025 - "UPI TXN: ..."
 * - Internal transfers: "Your a/c no. XXXXXXXX1234 is credited for Rs.10.00 on 24-04-25..."
 *
 * Sender patterns: TL-DHANBK-S, VM-DHANBK, etc.
 */
export class DhanlaxmiBankParser extends BaseIndianBankParser {
  readonly id = 'dhanlaxmi';

  getBankName(): string {
    return 'Dhanlaxmi Bank';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return (
      normalizedSender.includes('DHANBK') ||
      normalizedSender.includes('DHANLAXMI') ||
      /^[A-Z]{2}-DHANBK-?[A-Z]?$/.test(normalizedSender) ||
      /^[A-Z]{2}-DHANBK$/.test(normalizedSender)
    );
  }

  protected extractAmount(message: string): Paise | null {
    // Pattern 1: "INR 20.00 is debited" or "INR 10.00 is credited"
    const inrMatch = find(/INR\s+([0-9,]+(?:\.\d{2})?)\s+is\s+(?:debited|credited)/i, message);
    if (inrMatch) {
      return toPaise(gv(inrMatch, 1));
    }

    // Pattern 2: "credited for Rs.10.00" or "debited for Rs.10.00"
    const rsMatch = find(/(?:credited|debited)\s+for\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i, message);
    if (rsMatch) {
      return toPaise(gv(rsMatch, 1));
    }

    return super.extractAmount(message);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('is debited')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('is credited')) return TransactionType.INCOME;
    if (lowerMessage.includes('debited from')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('credited to')) return TransactionType.INCOME;
    if (lowerMessage.includes('credited for')) return TransactionType.INCOME;
    return super.extractTransactionType(message);
  }

  protected extractAccountLast4(message: string): string | null {
    const base = super.extractAccountLast4(message);
    if (base != null) {
      return base;
    }

    // Pattern 1: "A/c XXXX1234" or "A/c XX1234"
    const acMatch = find(/A\/c\s+([X\d]+)/i, message);
    if (acMatch) {
      return this.extractLast4Digits(gv(acMatch, 1));
    }

    // Pattern 2: "a/c no. XXXXXXXX1234"
    const acNoMatch = find(/a\/c\s+no\.\s*([X\d]+)/i, message);
    if (acNoMatch) {
      return this.extractLast4Digits(gv(acNoMatch, 1));
    }

    return null;
  }

  protected extractBalance(message: string): Paise | null {
    // Pattern: "Aval Bal is INR 26,578.49" or "Aval Bal is INR  26,578.49"
    const m = find(/Aval\s+Bal\s+is\s+INR\s+([0-9,]+(?:\.\d{2})?)/i, message);
    if (m) {
      return toPaise(gv(m, 1));
    }

    return super.extractBalance(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    // For UPI transactions, try to extract from the transaction description
    // Pattern: "UPI TXN: /675325120952-MR /Payment from PhonePe/..."
    if (message.toLowerCase().includes('upi txn')) {
      // Try to extract payment app or merchant from description
      // Stop at /, ", or end of quoted section
      const paymentFrom = find(/Payment\s+from\s+([^/"]+)/i, message);
      if (paymentFrom) {
        const merchant = this.cleanMerchantName(gv(paymentFrom, 1).trim());
        if (this.isValidMerchantName(merchant)) {
          return merchant;
        }
      }

      // Try to extract "payment on <merchant>" pattern
      // Stop at whitespace, /, ", or using
      const paymentOn = find(/payment\s+on\s+(\w+)/i, message);
      if (paymentOn) {
        const merchant = this.cleanMerchantName(gv(paymentOn, 1).trim());
        if (this.isValidMerchantName(merchant)) {
          return merchant;
        }
      }

      return 'UPI Payment';
    }

    // For internal transfers
    const lower = message.toLowerCase();
    if (lower.includes('debited from a/c') && lower.includes('credited')) {
      return 'Internal Transfer';
    }

    return super.extractMerchant(message, sender);
  }

  protected extractReference(message: string): string | null {
    // Pattern 1: UPI Ref no in transaction description
    const upiRef = find(/UPI\s+Ref\s+no\s+(\d+)/i, message);
    if (upiRef) {
      return gv(upiRef, 1);
    }

    // Pattern 2: Reference number from UPI TXN pattern - e.g., "/675325120952-MR"
    const txnRef = find(/UPI\s+TXN:\s*\/(\d+)/i, message);
    if (txnRef) {
      return gv(txnRef, 1);
    }

    return super.extractReference(message);
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    // Skip OTP and promotional messages
    if (
      lowerMessage.includes('otp') ||
      lowerMessage.includes('one time password') ||
      lowerMessage.includes('verification code')
    ) {
      return false;
    }

    // Dhanlaxmi Bank specific transaction keywords
    const dhanlaxmiKeywords = ['is debited from', 'is credited to', 'credited for', 'debited from a/c'];
    if (dhanlaxmiKeywords.some(k => lowerMessage.includes(k))) {
      return true;
    }

    return super.isTransactionMessage(message);
  }
}
