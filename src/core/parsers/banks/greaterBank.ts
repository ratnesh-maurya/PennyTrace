// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `bank/GreaterBankParser.kt`.
import type { Paise } from '../../types';
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { toPaise } from '../engine/patterns';
import { find, gv } from '../engine/regex';
import { TransactionType } from '../engine/types';

/**
 * Parser for Greater Bank SMS messages.
 *
 * Supported formats:
 * - Debit alert: "Your Account XXXX<last4> had a DEBIT transaction of RS. <amount> on <date> at
 *   <time>.Available balance is Rs. <balance>: GREATER BANK"
 * - UPI/IMPS transfer: "Your a/c no. XXXXXXXX<last4> is debited for Rs.<amount> on <date> and
 *   credited to a/c no. XXXXXXXX<last4> (UPI Ref no <ref>) If Not You? Call ... Greater Bank"
 */
export class GreaterBankParser extends BaseIndianBankParser {
  readonly id = 'greater-bank';

  getBankName(): string {
    return 'Greater Bank';
  }

  canHandle(sender: string): boolean {
    const upper = sender.toUpperCase();
    return (
      upper.includes('GRTRBN') ||
      upper.includes('GREATRBN') ||
      upper.includes('GREATERBNK') ||
      upper.includes('GREATERBANK') ||
      upper.includes('GREATER')
    );
  }

  protected extractAmount(message: string): Paise | null {
    // "RS. 100.00" or "RS.100.00".
    const m = find(/RS\.?\s*([0-9,]+(?:\.\d{2})?)/i, message);
    if (m) {
      return toPaise(gv(m, 1));
    }
    return super.extractAmount(message);
  }

  protected extractAccountLast4(message: string): string | null {
    // "Account XXXX5207".
    const account = find(/Account\s+[X*]+(\d{4})/i, message);
    if (account) {
      return gv(account, 1);
    }
    // "a/c no. XXXXXXXX5207".
    const acNo = find(/a\/c\s+no\.?\s+[X*]+(\d{4})/i, message);
    if (acNo) {
      return gv(acNo, 1);
    }
    return super.extractAccountLast4(message);
  }

  protected extractBalance(message: string): Paise | null {
    // "Available balance is Rs. 1127.55".
    const m = find(/available\s+balance\s+is\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i, message);
    if (m) {
      return toPaise(gv(m, 1));
    }
    return super.extractBalance(message);
  }

  protected extractReference(message: string): string | null {
    // "UPI Ref no 232135417634".
    const m = find(/UPI\s+Ref\s+no\s+(\d+)/i, message);
    if (m) {
      return gv(m, 1);
    }
    return super.extractReference(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    const lower = message.toLowerCase();
    // UPI transfer to another account.
    if (lower.includes('upi ref')) {
      return 'Bank Transfer';
    }
    // Generic debit alert with no destination info.
    if (lower.includes('debit transaction')) {
      return 'Debit Transaction';
    }
    return super.extractMerchant(message, sender);
  }

  protected isTransactionMessage(message: string): boolean {
    const lower = message.toLowerCase();
    if (lower.includes('debit transaction') || lower.includes('credit transaction')) {
      return true;
    }
    return super.isTransactionMessage(message);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lower = message.toLowerCase();
    if (lower.includes('debit transaction') || lower.includes('is debited')) {
      return TransactionType.EXPENSE;
    }
    if (lower.includes('credit transaction') || lower.includes('is credited')) {
      return TransactionType.INCOME;
    }
    return super.extractTransactionType(message);
  }
}
