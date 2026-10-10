// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `bank/DOPBankParser.kt` (Department of Posts / India Post savings accounts).
import type { Paise } from '../../types';
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { toPaise } from '../engine/patterns';
import { find, gv } from '../engine/regex';
import { TransactionType, type BankTxn } from '../engine/types';

/**
 * Parser for Department of Posts (DOPBNK) account alerts:
 * "Account No. XXXXXXXX1234 CREDIT with amount Rs. 5550.00 on 02-02-2026. Balance: Rs.37500.00. [S33475450]"
 *
 * These senders use the `-G` DLT category, so the gate lets `-G` through for known banks.
 */
export class IndiaPostParser extends BaseIndianBankParser {
  readonly id = 'india-post';

  getBankName(): string {
    return 'Department of Post';
  }

  canHandle(sender: string): boolean {
    const upper = sender.toUpperCase();
    return (
      upper.includes('DOPBNK') ||
      upper.includes('DEPARTMENT OF POST') ||
      upper.includes('DOP-') ||
      upper.endsWith('-DOP') ||
      upper === 'DOP'
    );
  }

  parse(smsBody: string, sender: string, timestamp: number): BankTxn | null {
    return super.parse(this.normalizeUnicodeText(smsBody), sender, timestamp);
  }

  /** NFKD-normalise, replace non-ASCII with spaces, collapse whitespace. */
  private normalizeUnicodeText(text: string): string {
    return text
      .normalize('NFKD')
      .replace(/[^\x00-\x7F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  protected extractAmount(message: string): Paise | null {
    const m = find(/amount\s+(?:Rs\.?|INR)?\s*([\d,]+(?:\.\d{2})?)/i, message);
    if (m) {
      return toPaise(gv(m, 1));
    }
    return super.extractAmount(message);
  }

  protected extractAccountLast4(message: string): string | null {
    const m = find(/Acc(?:ount)?\s*(?:No\.?)?\s+(?:[X*]+)?(\d{4})/i, message);
    if (m) {
      return gv(m, 1);
    }
    return super.extractAccountLast4(message);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lower = message.toLowerCase();
    if (lower.includes('credit')) return TransactionType.INCOME;
    if (lower.includes('debit')) return TransactionType.EXPENSE;
    return super.extractTransactionType(message);
  }

  protected extractBalance(message: string): Paise | null {
    const m = find(/Bal(?:ance)?\s*(?::)?\s*(?:Rs\.?|INR)?\s*([\d,]+(?:\.\d{2})?)/i, message);
    if (m) {
      const balance = toPaise(gv(m, 1));
      if (balance != null) {
        return balance;
      }
    }
    return super.extractBalance(message);
  }

  protected extractReference(message: string): string | null {
    const m = find(/\[([A-Z0-9]+)\]/i, message);
    if (m) {
      return gv(m, 1);
    }
    return super.extractReference(message);
  }

  protected isTransactionMessage(message: string): boolean {
    const lower = message.toLowerCase();
    const hasKeyword = lower.includes('account') || lower.includes('a/c') || lower.includes('dop');
    const hasType = lower.includes('credit') || lower.includes('debit');
    return hasKeyword && hasType;
  }
}
