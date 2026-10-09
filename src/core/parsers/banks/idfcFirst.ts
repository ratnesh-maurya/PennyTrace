// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `IDFCFirstBankParser.kt`: IDFC First account debits/credits and credit
// card spends (multi-currency) from senders like `BM-IDFCBK-S`, `AD-IDFCB-S`.
import type { Paise } from '../../types';
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { toPaise } from '../engine/patterns';
import { find, gv, matches } from '../engine/regex';
import { TransactionType, type BankTxn } from '../engine/types';

/**
 * Parser for IDFC First Bank SMS messages
 *
 * Common senders: XX-IDFCBK-S, XX-IDFCBK-T, XX-IDFCB-S, XX-IDFCB-T, IDFCBK
 * Examples: BM-IDFCBK-S, AX-IDFCBK-T, AD-IDFCB-S
 *
 * SMS Format:
 * Your A/C XXXXXXXXXXX is debited by INR 68.00 on 06/08/25 17:36. New Bal :INR XXXXX.00
 * Your A/C XXXXXXXXXXX is credited by INR 500.00 on 06/08/25 17:36. New Bal :INR XXXXX.00
 *
 * Credit Card Format (with multi-currency support):
 * Transaction Successful! EUR 500.00 spent on your IDFC FIRST Bank Credit Card ending XXXX at MERCHANT on DD-MMM-YYYY
 */
export class IdfcFirstBankParser extends BaseIndianBankParser {
  readonly id = 'idfc-first';

  getBankName(): string {
    return 'IDFC First Bank';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return normalizedSender.includes('IDFCBK') || normalizedSender.includes('IDFCFB') || normalizedSender.includes('IDFC');
  }

  parse(smsBody: string, sender: string, timestamp: number): BankTxn | null {
    // Skip non-transaction messages
    if (!this.isTransactionMessage(smsBody)) {
      return null;
    }

    const amount = this.extractAmount(smsBody);
    if (amount == null) {
      return null;
    }

    const type = this.extractTransactionType(smsBody);
    if (type == null) {
      return null;
    }

    // Extract currency dynamically for multi-currency support (foreign transactions on credit cards)
    const currency = this.extractCurrencyFromMessage(smsBody) ?? 'INR';

    // Extract available limit for credit card transactions
    const availableLimit = type === TransactionType.CREDIT ? this.extractAvailableLimit(smsBody) : null;

    return this.txn({
      amount,
      type,
      merchant: this.extractMerchant(smsBody, sender),
      reference: this.extractReference(smsBody),
      accountLast4: this.extractAccountLast4(smsBody),
      balance: this.extractBalance(smsBody),
      creditLimit: availableLimit,
      smsBody,
      sender,
      timestamp,
      isFromCard: this.detectIsCard(smsBody),
      currency,
    });
  }

  /**
   * Extract currency from IDFC First Bank transaction messages.
   * Handles formats like "EUR 500.00 spent" or "USD 100.00 spent" for credit card transactions.
   */
  private extractCurrencyFromMessage(message: string): string | null {
    // Pattern: "EUR 500.00 spent" or "USD 100.00 spent" (credit card foreign currency transactions)
    const m = find(/([A-Z]{3})\s+[0-9,]+(?:\.\d{2})?\s+spent/i, message);
    if (m) {
      const currency = gv(m, 1).toUpperCase();
      // Validate: 3 letters, not month abbreviations
      if (!matches(/^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/, currency)) {
        return currency;
      }
    }
    return null; // Falls back to INR
  }

  protected extractAmount(message: string): Paise | null {
    // List of amount patterns for IDFC First Bank
    const amountPatterns = [
      // Credit card foreign currency pattern: "EUR 500.00 spent" or "USD 100.00 spent"
      /[A-Z]{3}\s+([0-9,]+(?:\.\d{2})?)\s+spent/i,
      // Debit patterns
      /Debit\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
      /debited\s+by\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
      /debited\s+by\s+INR\s*([0-9,]+(?:\.\d{2})?)/i,
      // Credit patterns
      /credited\s+by\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
      /credited\s+with\s+INR\s*([0-9,]+(?:\.\d{2})?)/i,
      /credited\s+by\s+INR\s*([0-9,]+(?:\.\d{2})?)/i,
      // Interest pattern
      /interest\s+of\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
    ];

    for (const pattern of amountPatterns) {
      const m = find(pattern, message);
      if (m) {
        return toPaise(gv(m, 1));
      }
    }

    return super.extractAmount(message);
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    // Shared skip-list (OTP, promos, payment requests, reminders, IPO
    // blocking, e-vouchers). This used to be a local copy that drifted.
    if (this.isNonTransactionMessage(message)) {
      return false;
    }

    // Skip bill reminders and due date notifications
    if (
      lowerMessage.includes('reminder') ||
      lowerMessage.includes('is due on') ||
      (lowerMessage.includes('bill of rs') && lowerMessage.includes('due'))
    ) {
      return false;
    }

    // Skip payment request messages (common across banks)
    if (
      lowerMessage.includes('has requested') ||
      lowerMessage.includes('payment request') ||
      lowerMessage.includes('collect request') ||
      lowerMessage.includes('requesting payment') ||
      lowerMessage.includes('requests rs') ||
      lowerMessage.includes('ignore if paid') ||
      lowerMessage.includes('ignore if already paid')
    ) {
      return false;
    }

    // Must contain transaction keywords - IDFC specific patterns
    const transactionKeywords = [
      'debit',
      'debited',
      'credited',
      'withdrawn',
      'deposited',
      'spent',
      'received',
      'transferred',
      'paid',
      'interest',
    ];

    return transactionKeywords.some(k => lowerMessage.includes(k));
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('debit')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('debited')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('spent')) return TransactionType.EXPENSE; // Credit card transactions
    if (lowerMessage.includes('credited')) return TransactionType.INCOME;
    if (lowerMessage.includes('withdrawn') || lowerMessage.includes('withdrawal')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('deposited') || lowerMessage.includes('deposit')) return TransactionType.INCOME;
    if (lowerMessage.includes('cash deposit')) return TransactionType.INCOME;
    if (lowerMessage.includes('interest') && lowerMessage.includes('earned')) return TransactionType.INCOME;
    if (lowerMessage.includes('monthly interest')) return TransactionType.INCOME;

    return super.extractTransactionType(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    const lowerMessage = message.toLowerCase();

    // Interest credit
    if (lowerMessage.includes('monthly interest')) {
      return 'Interest Credit';
    }

    // Cash deposit
    if (lowerMessage.includes('cash deposit')) {
      // Try to extract ATM ID if present
      const atm = find(/ATM\s+(?:ID\s+)?([A-Z0-9]+)/i, message);
      if (atm) {
        return `Cash Deposit - ATM ${gv(atm, 1)}`;
      }
      return 'Cash Deposit';
    }

    // Pattern: "debited by Rs. X on DATE; MERCHANT credited" (e.g., REDBUS credited)
    const merchantCredited = find(/;\s*([A-Z][A-Z0-9\s]+?)\s+credited/i, message);
    if (merchantCredited) {
      const merchant = this.cleanMerchantName(gv(merchantCredited, 1));
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // UPI transaction pattern
    if (lowerMessage.includes('upi')) {
      // Try to extract UPI ID
      const upi = find(/(?:to|from|at)\s+([a-zA-Z0-9._-]+@[a-zA-Z0-9]+)/i, message);
      if (upi) {
        return `UPI - ${gv(upi, 1)}`;
      }
      return 'UPI Transaction';
    }

    // IMPS with mobile number
    if (lowerMessage.includes('imps')) {
      // Try to extract mobile number
      const mobile = find(/mobile\s+[X]*(\d{3,4})/i, message);
      if (mobile) {
        return `IMPS Transfer - Mobile XXX${gv(mobile, 1)}`;
      }
      return 'IMPS Transfer';
    }

    // NEFT/RTGS patterns
    if (lowerMessage.includes('neft')) return 'NEFT Transfer';
    if (lowerMessage.includes('rtgs')) return 'RTGS Transfer';

    // ATM withdrawal/transaction
    if (lowerMessage.includes('atm')) {
      // Try to extract ATM ID
      const atmId = find(/ATM\s+([A-Z]{2}\d+)/i, message);
      if (atmId) {
        return `ATM - ${gv(atmId, 1)}`;
      }
      return 'ATM Transaction';
    }

    // For card transactions
    const to = find(/(?:to|at|for)\s+([A-Z][A-Z0-9\s&.-]+?)(?:\s+on|\s+New|\.|,|$)/i, message);
    if (to) {
      const merchant = this.cleanMerchantName(gv(to, 1));
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    return super.extractMerchant(message, sender);
  }

  protected extractAccountLast4(message: string): string | null {
    const fromBase = super.extractAccountLast4(message);
    if (fromBase != null) return fromBase;

    // Pattern 1: Credit Card ending XX1234
    const cardEnding = find(/Credit\s+Card\s+ending\s+([X\d]+)/i, message);
    if (cardEnding) {
      return this.extractLast4Digits(gv(cardEnding, 1));
    }

    // Pattern 2: A/C XXXXXXXXXXX where last digits are visible
    const ac = find(/A\/C\s+([X\d]+)/i, message);
    if (ac) {
      return this.extractLast4Digits(gv(ac, 1));
    }

    return null;
  }

  protected extractBalance(message: string): Paise | null {
    // List of balance patterns for IDFC First Bank
    const balancePatterns = [
      // "New Bal :INR XXXXX.00" or "New bal: Rs.XXXXX.00"
      /New\s+Bal\s*:\s*(?:INR|Rs\.?)\s*([0-9,]+(?:\.\d{2})?)/i,
      // "New balance is INR XXXXX.00"
      /New\s+balance\s+is\s+INR\s*([0-9,]+(?:\.\d{2})?)/i,
      // "Updated balance is INR XXXXX.00"
      /Updated\s+balance\s+is\s+INR\s*([0-9,]+(?:\.\d{2})?)/i,
      // "Available balance Rs. X,XXX.XX"
      /Available\s+balance\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
    ];

    for (const pattern of balancePatterns) {
      const m = find(pattern, message);
      if (m) {
        return toPaise(gv(m, 1));
      }
    }

    return super.extractBalance(message);
  }

  protected extractReference(message: string): string | null {
    const patterns = [
      // RRN (Retrieval Reference Number) pattern
      /RRN\s+(\d+)/i,
      // IMPS reference pattern in parentheses
      /IMPS\s+Ref\s+no\s+(\d+)/i,
      // UPI reference pattern
      /UPI[:/]\s*([0-9]+)/i,
      // Transaction ID pattern
      /(?:txn|transaction)\s*(?:id|ref|no)[:\s]*([A-Z0-9]+)/i,
    ];
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return gv(m, 1);
      }
    }

    return super.extractReference(message);
  }
}
