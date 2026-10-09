// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `SaraswatBankParser.kt`.
import type { Paise } from '../../types';
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { toPaise } from '../engine/patterns';
import { find, gv, matches, replaceAll } from '../engine/regex';
import { TransactionType } from '../engine/types';

/**
 * Parser for Saraswat Co-operative Bank
 *
 * Handles formats like:
 * - "Your A/c no. 013460 is credited with INR 115.50 on 13-10-2025 towards ACH Credit:GUJARAT GAS LIMITED.
 *    Current Bal is INR 941.23 CR  - Saraswat Bank"
 * - "Dear Customer, Your account no. ending with 013460 is debited with INR 10,000.00 on 25-09-2025  for S.I.
 *    Current Bal is INR 8,256.97CR. - Saraswat Bank"
 */
export class SaraswatBankParser extends BaseIndianBankParser {
  readonly id = 'saraswat';

  getBankName(): string {
    return 'Saraswat Co-operative Bank';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();

    // Direct sender IDs
    const saraswatSenders = new Set(['SARBNK', 'SARASWAT', 'SARASWATBANK']);
    if (saraswatSenders.has(normalizedSender)) {
      return true;
    }

    // DLT patterns (XX-SARBNK-S/T format)
    return (
      matches(/^[A-Z]{2}-SARBNK-[ST]$/, normalizedSender) ||
      matches(/^[A-Z]{2}-SARASWAT-[ST]$/, normalizedSender) ||
      matches(/^[A-Z]{2}-SARBNK$/, normalizedSender) ||
      matches(/^[A-Z]{2}-SARASWAT$/, normalizedSender)
    );
  }

  protected extractAmount(message: string): Paise | null {
    // Pattern 1: "INR 115.50" or "INR 10,000.00"
    const inr = find(/INR\s+(\d+(?:,\d{3})*(?:\.\d{2})?)/i, message);
    if (inr) {
      return toPaise(gv(inr, 1));
    }

    // Pattern 2: Rs. format
    const rs = find(/Rs\.?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/i, message);
    if (rs) {
      return toPaise(gv(rs, 1));
    }

    // Fall back to base class patterns
    return super.extractAmount(message);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('is credited')) {
      return TransactionType.INCOME;
    }
    if (lowerMessage.includes('credited with')) {
      return TransactionType.INCOME;
    }
    if (lowerMessage.includes('is debited')) {
      return TransactionType.EXPENSE;
    }
    if (lowerMessage.includes('debited with')) {
      return TransactionType.EXPENSE;
    }
    if (lowerMessage.includes('withdrawn')) {
      return TransactionType.EXPENSE;
    }
    return super.extractTransactionType(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    // Pattern 1: "towards ACH Credit:GUJARAT GAS LIMITED"
    const towards = find(/towards\s+(.+?)(?:\.\s*Current|\s*Current|$)/i, message);
    if (towards) {
      const merchant = gv(towards, 1).trim();
      // Clean up "ACH Credit:" prefix
      const cleanedMerchant = replaceAll(
        replaceAll(merchant, /^ACH\s+Credit:\s*/i, ''),
        /^ACH\s+Debit:\s*/i,
        '',
      ).trim();
      if (this.isValidMerchantName(cleanedMerchant)) {
        return this.cleanMerchantName(cleanedMerchant);
      }
    }

    // Pattern 2: "for S.I." or "for NEFT" etc.
    const forMatch = find(/for\s+([A-Z.]+?)(?:\.\s+Current|\s+Current|$)/i, message);
    if (forMatch) {
      let merchant = gv(forMatch, 1).trim();
      if (merchant.endsWith('.')) {
        merchant = merchant.slice(0, -1);
      }
      switch (merchant.toUpperCase()) {
        case 'S.I':
        case 'SI':
          return 'Standing Instruction';
        case 'NEFT':
          return 'NEFT Transfer';
        case 'RTGS':
          return 'RTGS Transfer';
        case 'IMPS':
          return 'IMPS Transfer';
        default:
          return merchant;
      }
    }

    // Pattern 3: ATM withdrawal
    const lower = message.toLowerCase();
    if (lower.includes('atm') || lower.includes('withdrawn')) {
      return 'ATM Withdrawal';
    }

    // Fall back to base class patterns
    return super.extractMerchant(message, sender);
  }

  protected extractAccountLast4(message: string): string | null {
    const base = super.extractAccountLast4(message);
    if (base != null) {
      return base;
    }
    // Pattern 1: "A/c no. 013460" or "A/c no. ending with 013460"
    const accountNo = find(/A\/c\s+no\.\s+(?:ending\s+with\s+)?(\d{4,6})/i, message);
    if (accountNo) {
      return this.extractLast4Digits(gv(accountNo, 1));
    }

    // Pattern 2: "account no. ending with 013460"
    const endingWith = find(/account\s+no\.\s+ending\s+with\s+(\d{4,6})/i, message);
    if (endingWith) {
      return this.extractLast4Digits(gv(endingWith, 1));
    }

    // Pattern 3: "A/c *1234"
    const pattern3 = find(/A\/c\s+([*\d]+)/i, message);
    if (pattern3) {
      return this.extractLast4Digits(gv(pattern3, 1));
    }

    return null;
  }

  protected extractBalance(message: string): Paise | null {
    // Pattern 1: "Current Bal is INR 941.23 CR" or "Current Bal is INR 8,256.97CR"
    const currentBal = find(/Current\s+Bal\s+is\s+INR\s+(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(?:CR|DR)?/i, message);
    if (currentBal) {
      return toPaise(gv(currentBal, 1));
    }

    // Pattern 2: "Bal: Rs. 1000.00"
    const bal = find(/Bal[:\s]+Rs\.?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/i, message);
    if (bal) {
      return toPaise(gv(bal, 1));
    }

    // Fall back to base class
    return super.extractBalance(message);
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    // Skip OTP and verification messages
    if (
      lowerMessage.includes('otp') ||
      lowerMessage.includes('one time password') ||
      lowerMessage.includes('verification code')
    ) {
      return false;
    }

    // Saraswat Bank specific transaction keywords
    const saraswatTransactionKeywords = [
      'is credited with',
      'is debited with',
      'credited with inr',
      'debited with inr',
      'current bal is',
    ];
    if (saraswatTransactionKeywords.some(k => lowerMessage.includes(k))) {
      return true;
    }

    // Fall back to base class for standard checks
    return super.isTransactionMessage(message);
  }
}
