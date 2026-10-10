// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `bank/IndianBankParser.kt`.
import type { Paise } from '../../types';
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { toPaise } from '../engine/patterns';
import { find, gv, matches } from '../engine/regex';
import { TransactionType, type MandateInfo } from '../engine/types';

/** Mandate information for Indian Bank (upstream `IndianMandateInfo`). */
export interface IndianMandateInfo extends MandateInfo {
  dateFormat: 'dd-MMM-yy';
}

/**
 * Parser for Indian Bank
 *
 * Common sender patterns:
 * - Service Implicit (transactions): XX-INDBNK-S (e.g., AD-INDBNK-S, AX-INDBNK-S)
 * - OTP: XX-INDBNK-T
 * - Promotional: XX-INDBNK-P
 * - Direct: INDBNK, INDIAN
 */
export class IndianBankParser extends BaseIndianBankParser {
  readonly id = 'indian-bank';

  getBankName(): string {
    return 'Indian Bank';
  }

  canHandle(sender: string): boolean {
    const normalized = sender.toUpperCase();
    return (
      normalized.includes('INDIAN BANK') ||
      normalized.includes('INDIANBANK') ||
      normalized.includes('INDIANBK') ||
      // Match DLT patterns for transactions (-S suffix)
      matches(/^[A-Z]{2}-INDBNK-S$/, normalized) ||
      // Also handle other patterns for completeness
      matches(/^[A-Z]{2}-INDBNK-[TPG]$/, normalized) ||
      // Legacy patterns without suffix
      matches(/^[A-Z]{2}-INDBNK$/, normalized) ||
      // Direct sender IDs
      normalized === 'INDBNK' ||
      normalized === 'INDIAN'
    );
  }

  protected extractAmount(message: string): Paise | null {
    const patterns = [
      // Pattern 1: debited Rs. 19000.00
      /debited\s+Rs\.?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/i,
      // Pattern 2: credited Rs. 5000.00
      /credited\s+Rs\.?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/i,
      // Pattern 2a: Rs.589.00 credited to (amount before credited)
      /Rs\.?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)\s+credited\s+to/i,
      // Pattern 3: withdrawn Rs. 2000
      /withdrawn\s+Rs\.?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/i,
      // Pattern 4: UPI payment of Rs. 500
      /UPI\s+payment\s+of\s+Rs\.?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/i,
      // Pattern 5: Sent Rs.440.00 (newer UPI-debit format)
      /Sent\s+Rs\.?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/i,
    ];
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return toPaise(gv(m, 1));
      }
    }

    // Fall back to base class patterns
    return super.extractAmount(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    const merchantPatterns = [
      // Pattern 0: newer UPI-debit format "to NARMADA FOODS.RRN 213416112187"
      // Stop at the period before RRN so the RRN/trailing text is not captured.
      /to\s+([^.\n]+?)\.RRN\b/i,
      // Pattern 1: "to Merchant Name"
      /to\s+([^.\n]+?)(?:\.\s*UPI:|UPI:|$)/i,
      // Pattern 2: "from Sender Name"
      /from\s+([^.\n]+?)(?:\.\s*UPI:|UPI:|$)/i,
    ];
    for (const pattern of merchantPatterns) {
      const m = find(pattern, message);
      if (m) {
        const merchant = this.cleanMerchantName(gv(m, 1).trim());
        if (this.isValidMerchantName(merchant)) {
          return merchant;
        }
      }
    }

    // Pattern 2a: "linked to VPA 7970282159-2@axl" - extract VPA
    const vpa = find(/VPA\s+([\w.-]+@[\w]+)/i, message);
    if (vpa) {
      const vpaStr = gv(vpa, 1);
      // Extract the part before @ as merchant name
      const merchantFromVpa = vpaStr.split('@')[0];
      return this.cleanMerchantName(merchantFromVpa);
    }

    // Pattern 3: ATM withdrawal at location
    const atm = find(/ATM\s+(?:withdrawal\s+)?at\s+([^.\n]+?)(?:\s+on|$)/i, message);
    if (atm) {
      const location = this.cleanMerchantName(gv(atm, 1).trim());
      if (this.isValidMerchantName(location)) {
        return `ATM - ${location}`;
      }
    }

    // Fall back to base class patterns
    return super.extractMerchant(message, sender);
  }

  protected extractAccountLast4(message: string): string | null {
    const fromSuper = super.extractAccountLast4(message);
    if (fromSuper != null) {
      return fromSuper;
    }
    const patterns = [
      // Pattern 1: A/c *1234 or A/c XX1234
      /A\/c\s+([*X\d]+)/i,
      // Pattern 2: Account XX1234 or XXXX1234
      /Account\s+([X*\d]+)/i,
      // Pattern 3: A/c ending 1234
      /A\/c\s+ending\s+(\d{4})/i,
    ];
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return this.extractLast4Digits(gv(m, 1));
      }
    }
    return null;
  }

  protected extractReference(message: string): string | null {
    const patterns = [
      // Pattern 1: UPI:515314436916
      /UPI:(\d+)/i,
      // Pattern 1a: UPI Ref no 917477824021
      /UPI\s+Ref\s+no\s+(\d+)/i,
      // Pattern 1b: RRN 213416112187 (newer UPI-debit format). Checked AFTER the
      // UPI-ref patterns so that a message carrying both a UPI ref and an RRN keeps
      // preferring the UPI ref; the "Sent Rs." format carries only the RRN.
      /RRN\s+(\d+)/i,
      // Pattern 2: Ref No. 123456
      /Ref\s+No\.?\s*(\w+)/i,
      // Pattern 3: Transaction ID: ABC123
      /Transaction\s+ID:?\s*(\w+)/i,
    ];
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return gv(m, 1);
      }
    }

    // Fall back to base class
    return super.extractReference(message);
  }

  protected extractBalance(message: string): Paise | null {
    const patterns = [
      // Pattern 1: Bal Rs. 50000.00 or Bal- Rs. 50000.00 or Total Bal : Rs. 50000.00
      /Bal[:\s-]+Rs\.?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/i,
      // Pattern 2: Available Balance: Rs. 25000
      /Available\s+Balance:?\s+Rs\.?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/i,
    ];
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return toPaise(gv(m, 1));
      }
    }

    // Fall back to base class
    return super.extractBalance(message);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();

    // Indian Bank specific patterns
    if (lowerMessage.includes('debited')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('withdrawn')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('upi payment') && !lowerMessage.includes('received')) return TransactionType.EXPENSE;
    // Newer UPI-debit format: "Sent Rs.440.00 from A/c ..."
    if (lowerMessage.includes('sent rs')) return TransactionType.EXPENSE;

    if (lowerMessage.includes('credited')) return TransactionType.INCOME;
    if (lowerMessage.includes('deposited')) return TransactionType.INCOME;
    if (lowerMessage.includes('received')) return TransactionType.INCOME;

    // Fall back to base class for other patterns
    return super.extractTransactionType(message);
  }

  /**
   * Recognise the newer "Sent Rs.<amt> ... to <merchant>" UPI-debit format as a
   * transaction. The base [BankParser.isTransactionMessage] only knows verbs like
   * debited/credited/withdrawn, so without this override the message is dropped
   * (parse() returns null) even though it is a real debit.
   */
  protected isTransactionMessage(message: string): boolean {
    if (super.isTransactionMessage(message)) return true;
    return message.toLowerCase().includes('sent rs');
  }

  /**
   * Guard against classifying a "Sent Rs. ... Avl Bal ..." debit as a
   * balance-update-only notification. The base guard treats any message with an
   * "Avl Bal" keyword and no known txn verb as a pure balance update; "sent" is a
   * txn verb here, so exclude it. Bank-local override keeps other banks unaffected.
   */
  isBalanceUpdateNotification(message: string): boolean {
    if (message.toLowerCase().includes('sent rs')) return false;
    return super.isBalanceUpdateNotification(message);
  }

  // ==========================================
  // Mandate / Subscription Logic
  // ==========================================

  /**
   * Checks if this is a mandate notification (not a transaction).
   * Delegates to base class E-Mandate and future debit checks.
   */
  isMandateNotification(message: string): boolean {
    return this.isEMandateNotification(message) || this.isFutureDebitNotification(message);
  }

  /**
   * Parses mandate subscription information from Indian Bank messages.
   * Uses base class logic but returns bank-specific type.
   */
  parseMandateSubscription(message: string): IndianMandateInfo | null {
    const baseInfo = super.parseMandateSubscription(message);
    if (baseInfo == null) {
      return null;
    }

    return {
      amount: baseInfo.amount,
      nextDeductionDate: baseInfo.nextDeductionDate,
      merchant: baseInfo.merchant,
      umn: baseInfo.umn,
      accountLast4: baseInfo.accountLast4,
      dateFormat: 'dd-MMM-yy',
    };
  }
}
