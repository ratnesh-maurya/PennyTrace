// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `SouthIndianBankParser.kt`: UPI debit/credit, IMPS, balance updates
// and card transactions from senders like `AD-SIBSMS-S`, `CP-SIBSMS`.
import type { Paise } from '../../types';
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { toPaise } from '../engine/patterns';
import { allDigits, find, gv } from '../engine/regex';
import { TransactionType, type BankTxn } from '../engine/types';

/**
 * South Indian Bank specific parser.
 * Handles South Indian Bank's unique message formats including:
 * - UPI debit/credit transactions
 * - Balance updates
 * - Card transactions
 */
export class SouthIndianBankParser extends BaseIndianBankParser {
  readonly id = 'south-indian';

  getBankName(): string {
    return 'South Indian Bank';
  }

  canHandle(sender: string): boolean {
    const upperSender = sender.toUpperCase();

    // Common South Indian Bank sender IDs
    const sibSenders = new Set([
      'SIBSMS',
      'AD-SIBSMS',
      'CP-SIBSMS',
      'SIBSMS-S',
      'AD-SIBSMS-S',
      'CP-SIBSMS-S',
      'SOUTHINDIANBANK',
      'SIBBANK',
    ]);

    // Direct match
    if (sibSenders.has(upperSender)) return true;

    // Check for patterns with suffixes
    if (upperSender.includes('SIBSMS')) return true;
    if (upperSender.includes('SIBBANK')) return true;

    // DLT patterns
    return upperSender.startsWith('AD-SIB') || upperSender.startsWith('CP-SIB') || upperSender.startsWith('VM-SIB');
  }

  parse(smsBody: string, sender: string, timestamp: number): BankTxn | null {
    // Check if it's a transaction message
    if (!this.isTransactionMessage(smsBody)) {
      return null;
    }

    // Extract amount
    const amount = this.extractAmount(smsBody);
    if (amount == null) return null;

    // Extract transaction type
    const transactionType = this.extractTransactionType(smsBody);
    if (transactionType == null) return null;

    // Extract other details
    const merchant = this.extractMerchant(smsBody, sender) ?? 'Unknown';
    const reference = this.extractReference(smsBody);
    const accountLast4 = this.extractAccountLast4(smsBody);
    const balance = this.extractBalance(smsBody);

    // Upstream also parses the "YY-MM-DD HH:MM:SS" date/time from the body but never
    // stores it on the result; it is omitted here.

    return this.txn({
      amount,
      type: transactionType,
      merchant,
      reference,
      accountLast4,
      balance,
      smsBody,
      sender,
      timestamp,
    });
  }

  protected extractAmount(message: string): Paise | null {
    // Pattern for "Rs.42225.06" or "Rs.42225.06," (with comma after)
    const patterns = [/(?:Rs\.?|INR)\s*([0-9,]+(?:\.\d{2})?)/i];

    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return toPaise(gv(m, 1));
      }
    }

    return null;
  }

  protected extractMerchant(message: string, sender: string): string | null {
    const lower = message.toLowerCase();

    // For IMPS transactions, extract from "Info: IMPS/xxx/reference/MERCHANT" format
    if (lower.includes('imps') && lower.includes('info:')) {
      // Pattern for "Info: IMPS/FDRL/528005821348/EPIFI ACCOUN." - capture until period or next keyword
      const impsMatch = find(/Info:\s*IMPS\/[^/]+\/[^/]+\/\s*([A-Za-z\s]+?)(?:\.|Final|Bal|balance)/i, message);
      if (impsMatch) {
        const merchant = gv(impsMatch, 1).trim();
        if (merchant !== '') {
          return this.cleanMerchantName(merchant);
        }
      }

      // Fallback: capture everything up to period
      const impsMatch2 = find(/Info:\s*IMPS\/[^/]+\/[^/]+\/([^.]+)/i, message);
      if (impsMatch2) {
        const merchant = gv(impsMatch2, 1).trim();
        if (merchant !== '') {
          return this.cleanMerchantName(merchant);
        }
      }
    }

    // For UPI transactions, try to extract UPI ID or merchant name
    if (lower.includes('upi')) {
      // Pattern for "Info:UPI/IPOS/number/MERCHANT NAME on" format
      const infoMatch = find(/Info:\s*UPI\/[^/]+\/\d{12}\/\s*([^/]+?)\s+on/i, message);
      if (infoMatch) {
        const merchant = gv(infoMatch, 1).trim();
        if (merchant !== '') {
          return this.cleanMerchantName(merchant);
        }
      }

      // Check for "to" pattern (e.g., "to merchant@upi")
      // Only match if it appears early in the message to avoid matching footer phone numbers
      const messagePrefix = message.slice(0, 200); // Only look in first 200 chars
      const toMatch = find(/to\s+([^,\s]+@[^\s,]+)/i, messagePrefix);
      if (toMatch) {
        const merchant = gv(toMatch, 1).trim();
        if (merchant !== '') {
          return this.cleanMerchantName(merchant);
        }
      }

      // Check for "from" pattern for incoming transfers
      if (lower.includes('credit')) {
        const fromMatch = find(/from\s+([^,\s]+@[^\s,]+)/i, messagePrefix);
        if (fromMatch) {
          const merchant = gv(fromMatch, 1).trim();
          if (merchant !== '') {
            return this.cleanMerchantName(merchant);
          }
        }
        // Default to UPI Credit if no merchant found
        return 'UPI Credit';
      }

      // Default to UPI Transaction for UPI messages (if not credit)
      return 'UPI Transaction';
    }

    // For debit/credit transactions - merchant between amount and balance
    // Only apply this if NOT a UPI transaction (already handled above)
    if ((lower.includes('debit') || lower.includes('credit')) && !lower.includes('upi')) {
      // Pattern for "DEBIT:Rs.983.75 MERCHANT NAME Bal:Rs.79184.67"
      const m = find(/(?:DEBIT|CREDIT)[:\s]*Rs\.?\s*[0-9,]+(?:\.\d{2})?\s+([A-Z\s]+?)\s+(?:Bal|Available)/i, message);
      if (m) {
        const merchant = gv(m, 1).trim();
        if (merchant !== '' && merchant.length > 2) {
          return this.cleanMerchantName(merchant);
        }
      }
    }

    // For ATM withdrawals
    if (lower.includes('atm') || lower.includes('withdrawn')) {
      return 'ATM';
    }

    // For card transactions
    if (lower.includes('card')) {
      // Try to extract merchant after "at"
      const m = find(/at\s+([^,\n]+?)(?:\s+on|\s*,|$)/i, message);
      if (m) {
        const merchant = gv(m, 1).trim();
        if (merchant !== '') {
          return this.cleanMerchantName(merchant);
        }
      }
    }

    return super.extractMerchant(message, sender);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();

    // Debit keywords
    if (lowerMessage.includes('debit')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('withdrawn')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('spent')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('purchase')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('paid')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('transfer to')) return TransactionType.EXPENSE;

    // Credit keywords
    if (lowerMessage.includes('credit')) return TransactionType.INCOME;
    if (lowerMessage.includes('deposited')) return TransactionType.INCOME;
    if (lowerMessage.includes('received')) return TransactionType.INCOME;
    if (lowerMessage.includes('refund')) return TransactionType.INCOME;
    if (lowerMessage.includes('transfer from')) return TransactionType.INCOME;
    if (lowerMessage.includes('cashback')) return TransactionType.INCOME;

    return null;
  }

  protected extractReference(message: string): string | null {
    const lower = message.toLowerCase();

    // Pattern for IMPS reference in "Info: IMPS/xxx/reference/merchant" format
    // Handle variations with or without space after the last slash
    if (lower.includes('imps') && lower.includes('info:')) {
      // More flexible pattern that handles variations
      const m = find(/Info:\s*IMPS\/[^/]+\/(\d+)(?:\/\s*|\s+)/i, message);
      if (m) {
        const ref = gv(m, 1).trim();
        if (ref !== '') {
          return ref;
        }
      }

      // Fallback pattern: capture reference number between second and third slash
      const m2 = find(/Info:\s*IMPS\/[^/]+\/([^/]+)\//i, message);
      if (m2) {
        const ref = gv(m2, 1).trim();
        if (ref !== '' && allDigits(ref)) {
          return ref;
        }
      }
    }

    // Pattern for UPI reference in "Info: UPI/provider/rrn/..." format.
    const upiInfo = find(/Info:\s*UPI\/[^/]+\/(\d{12})(?:\/|\s|$)/i, message);
    if (upiInfo) {
      return gv(upiInfo, 1).trim();
    }

    // Pattern for RRN (e.g., "RRN:523273398527" or "RRN:567304295699.")
    const rrn = find(/RRN[:\s]*(\d{12})/i, message);
    if (rrn) {
      return gv(rrn, 1).trim();
    }

    // Pattern for reference number
    const ref = find(/Ref(?:erence)?[:\s]*([A-Z0-9]+)/i, message);
    if (ref) {
      return gv(ref, 1).trim();
    }

    return super.extractReference(message);
  }

  protected extractAccountLast4(message: string): string | null {
    const fromBase = super.extractAccountLast4(message);
    if (fromBase != null) return fromBase;

    // Pattern for "A/c X1234" or "A/c XX1234" or "A/c XXX1234"
    const patterns = [
      /A\/c\s+[X*]*(\d{4})/i,
      /Account\s+[X*]*(\d{4})/i,
      /from\s+[X*]*(\d{4})/i,
      /to\s+[X*]*(\d{4})/i,
    ];

    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return gv(m, 1);
      }
    }

    return null;
  }

  protected extractBalance(message: string): Paise | null {
    // Pattern for "Bal:Rs.1234.17" or "Balance:Rs.1234.17" or "Final balance is Rs.1234.17"
    const patterns = [
      /Final\s+balance\s+is\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
      /Bal(?:ance)?[:\s]*Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
      /Available\s+Bal(?:ance)?[:\s]*Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
      /Avl\s+Bal[:\s]*Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
    ];

    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return toPaise(gv(m, 1));
      }
    }

    return super.extractBalance(message);
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    // Skip OTP and promotional messages
    if (
      lowerMessage.includes('otp') ||
      lowerMessage.includes('one time password') ||
      lowerMessage.includes('verification code') ||
      lowerMessage.includes('offer') ||
      lowerMessage.includes('discount')
    ) {
      return false;
    }

    // Skip UPI auto-pay scheduled reminders
    if (lowerMessage.includes('upi auto pay') && lowerMessage.includes('is scheduled on')) {
      return false;
    }

    // Check for transaction keywords
    const transactionKeywords = [
      'debit',
      'credit',
      'withdrawn',
      'deposited',
      'spent',
      'received',
      'transferred',
      'paid',
      'purchase',
      'refund',
      'cashback',
      'upi',
    ];

    return transactionKeywords.some(k => lowerMessage.includes(k));
  }
}
