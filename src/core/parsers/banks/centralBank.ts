// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
//
// Upstream `CentralBankOfIndiaParser.kt`: Central Bank of India (CBoI) UPI and NEFT alerts.

import type { Paise } from '../../types';
import { BankParser } from '../engine/BankParser';
import { toPaise } from '../engine/patterns';
import { find, gv } from '../engine/regex';
import { TransactionType, type BankTxn } from '../engine/types';

/**
 * Parser for Central Bank of India (CBoI) SMS messages
 */
export class CentralBankOfIndiaParser extends BankParser {
  readonly id = 'central-bank';

  getBankName(): string {
    return 'Central Bank of India';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return (
      normalizedSender.includes('CENTBK') ||
      normalizedSender.includes('CBOI') ||
      normalizedSender.includes('CENTRALBANK') ||
      normalizedSender.includes('CENTRAL') ||
      // DLT patterns
      /^[A-Z]{2}-CENTBK-[A-Z]$/.test(normalizedSender) ||
      /^[A-Z]{2}-CBOI-[A-Z]$/.test(normalizedSender)
    );
  }

  parse(smsBody: string, sender: string, timestamp: number): BankTxn | null {
    if (!this.canHandle(sender)) return null;
    if (!this.isTransactionMessage(smsBody)) return null;

    const amount = this.extractAmount(smsBody);
    if (amount == null) return null;
    const transactionType = this.extractTransactionType(smsBody);
    if (transactionType == null) return null;
    const merchant = this.extractMerchant(smsBody, sender) ?? 'Unknown';

    return this.txn({
      amount,
      type: transactionType,
      merchant,
      accountLast4: this.extractAccountLast4(smsBody),
      balance: this.extractBalance(smsBody),
      reference: this.extractReference(smsBody),
      smsBody,
      sender,
      timestamp,
    });
  }

  protected extractAmount(message: string): Paise | null {
    // Pattern 1: Credited by Rs.50.00
    // Pattern 2: Debited by Rs.100.50
    const p1 = find(/(?:Credited|Debited)\s+by\s+Rs\.?\s*([\d,]+(?:\.\d{2})?)/i, message);
    if (p1) {
      return toPaise(gv(p1, 1));
    }

    // Pattern 2: Rs.XXX credited/debited
    const p2 = find(/Rs\.?\s*([\d,]+(?:\.\d{2})?)\s+(?:credited|debited)/i, message);
    if (p2) {
      return toPaise(gv(p2, 1));
    }

    return super.extractAmount(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    // Pattern 1: "By.NAME" or "By NAME" for NEFT/transfer credits (before bank suffix like -CBoI)
    const by = find(/By[.\s]+(.+?)(?:-CBoI|-CBOI|-CENTBK|$)/i, message);
    if (by) {
      const merchant = this.cleanMerchantName(gv(by, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Pattern 2: "from [NAME]" for credits
    const from = find(/from\s+([A-Z0-9]+|[^\s]+?)(?:\s+via|\s+Ref|\s+\.|$)/i, message);
    if (from) {
      const merchant = gv(from, 1).trim();
      // Handle masked UPI IDs
      if (merchant.includes('X')) {
        return 'UPI Transfer';
      }
      return this.cleanMerchantName(merchant);
    }

    // Pattern 3: "to [NAME]" for debits
    const to = find(/to\s+([^\s]+?)(?:\s+via|\s+Ref|\s+\.|$)/i, message);
    if (to) {
      const merchant = this.cleanMerchantName(gv(to, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Pattern 4: via UPI
    const lower = message.toLowerCase();
    if (lower.includes('via upi')) {
      if (lower.includes('credited')) {
        return 'UPI Credit';
      } else if (lower.includes('debited')) {
        return 'UPI Payment';
      }
    }

    return super.extractMerchant(message, sender);
  }

  protected extractAccountLast4(message: string): string | null {
    const base = super.extractAccountLast4(message);
    if (base != null) {
      return base;
    }

    // Pattern 1: A/c xxxxxx1234 (CBoI NEFT format)
    const acSlash = find(/A\/c\s+([xX*\d]+)/i, message);
    if (acSlash) {
      return this.extractLast4Digits(gv(acSlash, 1));
    }

    // Pattern 2: account XX3113
    const account = find(/account\s+([xX*\d]+)/i, message);
    if (account) {
      return this.extractLast4Digits(gv(account, 1));
    }

    // Pattern 3: A/C ending XXXX
    const ending = find(/A\/C\s+ending\s+([xX*\d]+)/i, message);
    if (ending) {
      return this.extractLast4Digits(gv(ending, 1));
    }

    return null;
  }

  protected extractBalance(message: string): Paise | null {
    // Pattern 1: Total Bal Rs.0000.99 CR
    // Pattern 2: Clear Bal Rs.XXX CR
    const patterns = [
      /Total\s+Bal\s+Rs\.?\s*([\d,]+(?:\.\d{2})?)\s+(CR|DR)/i,
      /Clear\s+Bal\s+Rs\.?\s*([\d,]+(?:\.\d{2})?)\s+(CR|DR)/i,
    ];
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        const balance = toPaise(gv(m, 1));
        if (balance == null) {
          return null;
        }
        // If DR (debit), make it negative
        return gv(m, 2).toUpperCase() === 'DR' ? -balance : balance;
      }
    }

    return super.extractBalance(message);
  }

  protected extractReference(message: string): string | null {
    // Pattern: Ref No.541986000003
    const m = find(/Ref\s+No\.?\s*(\w+)/i, message);
    if (m) {
      return gv(m, 1);
    }
    return super.extractReference(message);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('credited')) return TransactionType.INCOME;
    if (lowerMessage.includes('deposited')) return TransactionType.INCOME;
    if (lowerMessage.includes('received')) return TransactionType.INCOME;
    if (lowerMessage.includes('debited')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('withdrawn')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('paid')) return TransactionType.EXPENSE;
    return super.extractTransactionType(message);
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    // Check for CBoI-specific transaction keywords
    if ((lowerMessage.includes('credited by') || lowerMessage.includes('debited by')) && lowerMessage.includes('bal')) {
      return true;
    }

    // Check for signature
    if (lowerMessage.includes('-cboi')) {
      return lowerMessage.includes('credited') || lowerMessage.includes('debited');
    }

    return super.isTransactionMessage(message);
  }
}
