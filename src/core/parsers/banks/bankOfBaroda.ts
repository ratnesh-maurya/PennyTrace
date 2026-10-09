// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
//
// Upstream `bank/BankOfBarodaParser.kt`: Bank of Baroda (BOB) accounts and BOBCARD credit cards.

import type { Paise } from '../../types';
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { toPaise } from '../engine/patterns';
import { find, gv, matches } from '../engine/regex';
import { TransactionType } from '../engine/types';

const includesIc = (s: string, x: string): boolean => s.toLowerCase().includes(x.toLowerCase());

/**
 * Parser for Bank of Baroda (BOB) SMS messages
 */
export class BankOfBarodaParser extends BaseIndianBankParser {
  readonly id = 'bob';

  getBankName(): string {
    return 'Bank of Baroda';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return (
      normalizedSender.includes('BOB') ||
      normalizedSender.includes('BARODA') ||
      normalizedSender.includes('BOBSMS') ||
      normalizedSender.includes('BOBTXN') ||
      normalizedSender.includes('BOBCRD') || // Credit card messages
      // DLT patterns
      matches(/^[A-Z]{2}-BOBSMS-[A-Z]$/, normalizedSender) ||
      matches(/^[A-Z]{2}-BOBTXN-[A-Z]$/, normalizedSender) ||
      matches(/^[A-Z]{2}-BOB-[A-Z]$/, normalizedSender) ||
      matches(/^[A-Z]{2}-BOBCRD-[A-Z]$/, normalizedSender) || // Credit card DLT pattern
      // Direct sender IDs
      normalizedSender === 'BOB' ||
      normalizedSender === 'BANKOFBARODA'
    );
  }

  protected extractAmount(message: string): Paise | null {
    const patterns = [
      // Pattern 0: ALERT: INR XXX.XX is spent (Credit card pattern - check first)
      /ALERT:\s*INR\s*([\d,]+(?:\.\d{2})?)\s+is\s+spent/i,
      // Pattern 1: Rs.XX transferred from A/c (Transfer pattern)
      /Rs\.?\s*([\d,]+(?:\.\d{2})?)\s+transferred\s+from/i,
      // Pattern 2: Rs.80.00 Dr. from
      /Rs\.?\s*([\d,]+(?:\.\d{2})?)\s+Dr\.?\s+from/i,
      // Pattern 3: credited with INR 70.00
      /credited\s+with\s+INR\s+([\d,]+(?:\.\d{2})?)/i,
      // Pattern 4: Rs.xxxxxx Credited to
      /Rs\.?\s*([\d,]+(?:\.\d{2})?)\s+Credited\s+to/i,
      // Pattern 5: Cr. to redacted@ybl (UPI)
      /Rs\.?\s*([\d,]+(?:\.\d{2})?)\s+.*?Cr\.?\s+to/i,
      // Pattern 6: Rs.xxxxx deposited in cash
      /Rs\.?\s*([\d,]+(?:\.\d{2})?)\s+deposited\s+in\s+cash/i,
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
    // Pattern 1: transferred from A/c to:Merchant Name (Transfer pattern)
    const transferTo = find(/transferred\s+from\s+A\/c\s+[^\s]+\s+to:\s*([^.]+?)(?:\.|$)/i, message);
    if (transferTo) {
      const merchantRaw = gv(transferTo, 1).trim();
      // Clean up the merchant name (remove "Total Bal" and everything after if present)
      const merchant = merchantRaw.split(/\s+Total\s+Bal/i)[0].trim();
      if (this.isValidMerchantName(merchant)) {
        return this.cleanMerchantName(merchant);
      }
    }

    // Pattern 2: Cr. to redacted@ybl (UPI VPA)
    const upi = find(/Cr\.?\s+to\s+([^\s]+@[^\s.]+)/i, message);
    if (upi) {
      const vpa = gv(upi, 1);
      // Extract name from VPA if possible
      const at = vpa.indexOf('@');
      const name = at >= 0 ? vpa.slice(0, at) : vpa;
      return name === 'redacted' ? 'UPI Payment' : this.cleanMerchantName(name);
    }

    // Pattern 3: IMPS by Name of Person
    const imps = find(/IMPS\/[\d]+\s+by\s+([^.]+?)(?:\s*\.|$)/i, message);
    if (imps) {
      const merchant = this.cleanMerchantName(gv(imps, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Pattern 4: For UPI credits, extract from context
    if (includesIc(message, 'UPI')) {
      if (includesIc(message, 'credited')) {
        return 'UPI Credit';
      } else if (includesIc(message, 'Dr.')) {
        return 'UPI Payment';
      }
    }

    // Pattern 5: For IMPS without clear merchant
    if (includesIc(message, 'IMPS')) {
      return 'IMPS Transfer';
    }

    // Pattern 6: Cash deposit
    if (includesIc(message, 'deposited in cash')) {
      return 'Cash Deposit';
    }

    // Fall back to base class patterns
    return super.extractMerchant(message, sender);
  }

  protected extractAccountLast4(message: string): string | null {
    const base = super.extractAccountLast4(message);
    if (base != null) {
      return base;
    }

    // Pattern 0: BOBCARD ending 1234 (Credit card format)
    const bobCard = find(/BOBCARD\s+ending\s+(\d{4})/i, message);
    if (bobCard) {
      return gv(bobCard, 1);
    }

    // Pattern 1: A/C or A/c with masked account number
    const ac = find(/A\/[Cc]\s+([X.*\d]+)/i, message);
    if (ac) {
      return this.extractLast4Digits(gv(ac, 1));
    }

    return null;
  }

  protected extractBalance(message: string): Paise | null {
    const patterns = [
      // Pattern 1: AvlBal:Rsxxxxxcx or AvlBal: Rsxxxxxxx
      /AvlBal:\s*Rs\.?\s*([\d,]+(?:\.\d{2})?)/i,
      // Pattern 2: Total Bal:Rs.xxxxxxx
      /Total\s+Bal:\s*Rs\.?\s*([\d,]+(?:\.\d{2})?)/i,
      // Pattern 3: Avlbl Amt:Rs.xxxxxxxx
      /Avlbl\s+Amt:\s*Rs\.?\s*([\d,]+(?:\.\d{2})?)/i,
    ];

    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return toPaise(gv(m, 1));
      }
    }

    return super.extractBalance(message);
  }

  protected extractReference(message: string): string | null {
    const patterns = [
      // Pattern 1: Ref:52211xxxxxx
      /Ref:\s*(\d+)/i,
      // Pattern 2: UPI Ref No 510xxxxxxxxxx
      /UPI\s+Ref\s+No\s+(\d+)/i,
      // Pattern 3: IMPS/5182xxxxxxx
      /IMPS\/(\d+)/i,
    ];

    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return gv(m, 1);
      }
    }

    return super.extractReference(message);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();

    // Credit card transactions - BOBCARD
    if (lowerMessage.includes('spent on your bobcard')) return TransactionType.CREDIT;
    if (lowerMessage.includes('bobcard') && lowerMessage.includes('spent')) return TransactionType.CREDIT;
    if (lowerMessage.includes('bobcard') && lowerMessage.includes('is spent')) return TransactionType.CREDIT;

    // Debit/Expense patterns
    if (lowerMessage.includes('transferred from')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('dr.') || lowerMessage.includes('debited')) return TransactionType.EXPENSE;

    // Credit/Income patterns
    if (lowerMessage.includes('cr.') || lowerMessage.includes('credited')) return TransactionType.INCOME;
    if (lowerMessage.includes('deposited')) return TransactionType.INCOME;

    return super.extractTransactionType(message);
  }

  protected extractAvailableLimit(message: string): Paise | null {
    // Pattern for "Available credit limit is Rs 42,981.46"
    const m = find(/Available\s+credit\s+limit\s+is\s+Rs\.?\s*([\d,]+(?:\.\d{2})?)/i, message);
    if (m) {
      return toPaise(gv(m, 1));
    }

    // Fall back to base class patterns
    return super.extractAvailableLimit(message);
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    // Credit-card bill-payment confirmation, e.g.
    // "Payment of Rs X received for your BOBCARD ending NNNN ...".
    // This only acknowledges that a payment landed on the card; it is not a
    // spend or income. The actual debit is tracked on the funding bank
    // account, so skip this notice to avoid a spurious transaction. (#498)
    if (lowerMessage.includes('payment of') && lowerMessage.includes('received for your bobcard')) {
      return false;
    }

    // Check for BOB-specific transaction keywords
    if (
      lowerMessage.includes('dr. from') ||
      lowerMessage.includes('cr. to') ||
      lowerMessage.includes('credited to a/c') ||
      lowerMessage.includes('credited with inr') ||
      lowerMessage.includes('deposited in cash') ||
      lowerMessage.includes('transferred from') || // Transfer transactions
      lowerMessage.includes('is spent') // Credit card transactions
    ) {
      return true;
    }

    return super.isTransactionMessage(message);
  }
}
