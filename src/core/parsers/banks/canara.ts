// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `CanaraBankParser.kt`.
import type { Paise } from '../../types';
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { toPaise } from '../engine/patterns';
import { find, gv, test } from '../engine/regex';
import { TransactionType } from '../engine/types';

const COMPACT_DEBIT_PATTERN = /\bDr\.?\s*(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{2})?)\b/i;

/**
 * Parser for Canara Bank SMS messages
 */
export class CanaraBankParser extends BaseIndianBankParser {
  readonly id = 'canara';

  getBankName(): string {
    return 'Canara Bank';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return normalizedSender.includes('CANBNK') || normalizedSender.includes('CANARA');
  }

  protected extractAmount(message: string): Paise | null {
    const compact = find(COMPACT_DEBIT_PATTERN, message);
    if (compact) {
      return toPaise(gv(compact, 1));
    }

    // Pattern: Rs.23.00 paid thru
    const upiAmount = find(/Rs\.?\s*([\d,]+(?:\.\d{2})?)\s+paid/i, message);
    if (upiAmount) {
      return toPaise(gv(upiAmount, 1));
    }

    // Pattern: INR 50.00 has been DEBITED
    const debit = find(/INR\s+([\d,]+(?:\.\d{2})?)\s+has\s+been\s+DEBITED/i, message);
    if (debit) {
      return toPaise(gv(debit, 1));
    }

    // Fall back to base class patterns
    return super.extractAmount(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    // Pattern 1: RTGS/NEFT incoming - "by Sender AXIS MUTUAL FUND REDEMPTION PO, IFSC..."
    // Extract the sender name before IFSC/comma
    const rtgsSender = find(/by\s+Sender\s+([^,]+?)(?:,\s*IFSC|,\s*Sender\s+A\/c|\s*$)/i, message);
    if (rtgsSender) {
      const merchant = this.cleanMerchantName(gv(rtgsSender, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Pattern 2: UPI - paid thru A/C XX1234 on 08-8-25 16:41:00 to BMTC BUS KA57F6
    const upiMerchant = find(/\sto\s+([^,;]+?)(?:[,;]\s*UPI|\.|-Canara)/i, message);
    if (upiMerchant) {
      const merchant = this.cleanMerchantName(gv(upiMerchant, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Check if it's a generic debit
    if (message.toLowerCase().includes('debited')) {
      return 'Canara Bank Debit';
    }

    // Fall back to base class patterns
    return super.extractMerchant(message, sender);
  }

  protected extractAccountLast4(message: string): string | null {
    const base = super.extractAccountLast4(message);
    if (base != null) {
      return base;
    }

    // Pattern: account XXX123 or A/C XX1234
    const m = find(/(?:account|A\/C)\s+([X*\d]+)/i, message);
    if (m) {
      return this.extractLast4Digits(gv(m, 1));
    }

    return null;
  }

  protected extractBalance(message: string): Paise | null {
    // Pattern: Total Avail.bal INR 1,092.62
    const m = find(/(?:Total\s+)?Avail\.?bal\s+INR\s+([\d,]+(?:\.\d{2})?)/i, message);
    if (m) {
      return toPaise(gv(m, 1));
    }

    return super.extractBalance(message);
  }

  protected extractReference(message: string): string | null {
    // Pattern: UPI Ref 123456789012
    const m = find(/UPI\s+Ref\s+(\d+)/i, message);
    if (m) {
      return gv(m, 1);
    }

    return super.extractReference(message);
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    // Skip failed transactions
    if (lowerMessage.includes('failed due to')) {
      return false;
    }

    // Defer to the base class first. It accepts the standard keyword forms
    // ("paid thru", "has been debited/credited") AND — importantly — rejects
    // OTP / promotional / payment-request / reminder messages. (#621)
    if (super.isTransactionMessage(message)) {
      return true;
    }

    // The compact debit form ("Dr. INR 500") carries no standard keyword, so
    // the base class drops it. Accept it here — but not when it appears
    // inside an OTP / promotional body that merely quotes a "Dr. INR" figure.
    if (test(COMPACT_DEBIT_PATTERN, message)) {
      const looksNonTransactional =
        lowerMessage.includes('otp') ||
        lowerMessage.includes('one time password') ||
        lowerMessage.includes('verification code') ||
        lowerMessage.includes('offer') ||
        lowerMessage.includes('discount') ||
        lowerMessage.includes('win ') ||
        lowerMessage.includes('has requested') ||
        lowerMessage.includes('payment request');
      return !looksNonTransactional;
    }

    return false;
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();

    // Mutual fund REDEMPTION credited = INCOME (money coming in from selling investment)
    // This overrides the base class which would mark "mutual fund" as INVESTMENT
    if (lowerMessage.includes('redemption') && lowerMessage.includes('credited')) {
      return TransactionType.INCOME;
    }

    if (test(COMPACT_DEBIT_PATTERN, message)) {
      return TransactionType.EXPENSE;
    }

    // Fall back to base class
    return super.extractTransactionType(message);
  }
}
