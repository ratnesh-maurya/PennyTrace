// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `DBSBankParser.kt`.
import type { Paise } from '../../types';
import { BankParser } from '../engine/BankParser';
import { toPaise } from '../engine/patterns';
import { find, gv, matches } from '../engine/regex';
import { TransactionType } from '../engine/types';

/**
 * Parser for DBS Bank (Development Bank of Singapore) SMS messages
 */
export class DbsBankParser extends BankParser {
  readonly id = 'dbs';

  getBankName(): string {
    return 'DBS Bank';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return (
      normalizedSender.includes('DBSBNK') ||
      normalizedSender.includes('DBS') ||
      normalizedSender === 'DBSBANK' ||
      // DLT patterns
      matches(/^[A-Z]{2}-DBSBNK-[ST]$/, normalizedSender) ||
      matches(/^[A-Z]{2}-DBS-[ST]$/, normalizedSender) ||
      matches(/^[A-Z]{2}-DBSBANK-[ST]$/, normalizedSender)
    );
  }

  protected extractAmount(message: string): Paise | null {
    // Pattern: "debited with INR 11" or "credited with INR 100"
    const patterns = [
      /(?:debited|credited)\s+with\s+INR\s*([0-9,]+(?:\.\d{2})?)/i,
      /INR\s*([0-9,]+(?:\.\d{2})?)\s+(?:debited|credited)/i,
    ];
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return toPaise(gv(m, 1));
      }
    }
    return super.extractAmount(message);
  }

  protected extractAccountLast4(message: string): string | null {
    const base = super.extractAccountLast4(message);
    if (base != null) {
      return base;
    }
    // Pattern: "account no ********1234" or "a/c ****1234"
    const patterns = [/account\s+no\s+\*+(\d{4})/i, /a\/c\s+\*+(\d{4})/i, /account\s+\*+(\d{4})/i];
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return gv(m, 1);
      }
    }
    return null;
  }

  protected extractBalance(message: string): Paise | null {
    // Pattern: "Current Balance is INR37888.45" or "Balance: INR 1000"
    const patterns = [
      /Current\s+Balance\s+is\s+INR\s*([0-9,]+(?:\.\d{2})?)/i,
      /Balance[:\s]+INR\s*([0-9,]+(?:\.\d{2})?)/i,
      /Avl\s+Bal[:\s]+INR\s*([0-9,]+(?:\.\d{2})?)/i,
    ];
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return toPaise(gv(m, 1));
      }
    }
    return super.extractBalance(message);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('debited')) {
      return TransactionType.EXPENSE;
    }
    if (lowerMessage.includes('credited')) {
      return TransactionType.INCOME;
    }
    if (lowerMessage.includes('withdrawn')) {
      return TransactionType.EXPENSE;
    }
    if (lowerMessage.includes('deposited')) {
      return TransactionType.INCOME;
    }
    return super.extractTransactionType(message);
  }
}
