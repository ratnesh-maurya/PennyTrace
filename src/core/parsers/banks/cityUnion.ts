// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
//
// Upstream `CityUnionBankParser.kt`: City Union Bank account, UPI and NEFT alerts.

import type { Paise } from '../../types';
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { toPaise } from '../engine/patterns';
import { find, gv, takeLast } from '../engine/regex';
import { TransactionType } from '../engine/types';

/**
 * Parser for City Union Bank SMS messages
 *
 * Common senders: JK-CUBLTD-S, XX-CUBLTD-T, etc.
 *
 * SMS Formats:
 * - Your a/c no. XXXXXXXXXXXXXXX is debited for Rs.111.00 on 01-09-2025 and credited to a/c no. YYYYYYYYYYYYYYY (UPI Ref no 123456789012)
 * - Your a/c no. XXXXXXXXXXXXXXX is credited for Rs.111.00 on 01-09-2025 and debited from a/c no. YYYYYYYYYYYYYYY (UPI Ref no 123456789012)
 * - Savings No XXXXXXXXXXXXXXX credited with INR 111.00 towards BY NEFT TRF:AMBANI YYYYYYYYYYYYYYY: on 01-SEP-2025. Avl Bal 120.00
 */
export class CityUnionBankParser extends BaseIndianBankParser {
  readonly id = 'city-union';

  getBankName(): string {
    return 'City Union Bank';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return (
      normalizedSender.includes('CUBANK') || normalizedSender.includes('CUBLTD') || normalizedSender.includes('CUB')
    );
  }

  protected extractAmount(message: string): Paise | null {
    // List of amount patterns for City Union Bank
    const amountPatterns = [
      // "debited for Rs.111.00"
      /debited\s+for\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
      // "credited for Rs.111.00"
      /credited\s+for\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
      // "credited with INR 111.00"
      /credited\s+with\s+INR\s*([0-9,]+(?:\.\d{2})?)/i,
    ];

    for (const pattern of amountPatterns) {
      const m = find(pattern, message);
      if (m) {
        return toPaise(gv(m, 1));
      }
    }

    return super.extractAmount(message);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();
    // Transfers name both accounts ("Your a/c no. XX5501 is credited for
    // Rs.X ... and debited from a/c no. XX4577"). The clause about *your*
    // account decides the direction, so check it before the generic ones.
    if (lowerMessage.includes('your a/c') && lowerMessage.includes('is credited')) return TransactionType.INCOME;
    if (lowerMessage.includes('your a/c') && lowerMessage.includes('is debited')) return TransactionType.EXPENSE;

    // Check for debit patterns
    if (lowerMessage.includes('is debited')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('debited for')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('debited from')) return TransactionType.EXPENSE;

    // Check for credit patterns
    if (lowerMessage.includes('is credited')) return TransactionType.INCOME;
    if (lowerMessage.includes('credited for')) return TransactionType.INCOME;
    if (lowerMessage.includes('credited with')) return TransactionType.INCOME;
    if (lowerMessage.includes('credited to')) return TransactionType.INCOME;

    // NEFT/Transfer patterns
    if (lowerMessage.includes('neft trf')) return TransactionType.INCOME;

    return super.extractTransactionType(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    const lowerMessage = message.toLowerCase();

    // NEFT Transfer pattern
    if (lowerMessage.includes('neft trf')) {
      // Extract sender name from "BY NEFT TRF:NAME"
      const neft = find(/BY\s+NEFT\s+TRF:([^:]+)/i, message);
      if (neft) {
        const merchant = this.cleanMerchantName(gv(neft, 1).trim());
        return `NEFT - ${merchant}`;
      }
      return 'NEFT Transfer';
    }

    // UPI Transaction
    if (lowerMessage.includes('upi ref')) {
      // Try to extract the other account details
      const toAccount = find(/credited\s+to\s+a\/c\s+no\.\s+([A-Z0-9]+)/i, message);
      if (toAccount) {
        const acct = gv(toAccount, 1);
        const accountLast4 = acct.length >= 4 ? takeLast(acct, 4) : acct;
        return `UPI Transfer to A/C XX${accountLast4}`;
      }

      const fromAccount = find(/debited\s+from\s+a\/c\s+no\.\s+([A-Z0-9]+)/i, message);
      if (fromAccount) {
        const acct = gv(fromAccount, 1);
        const accountLast4 = acct.length >= 4 ? takeLast(acct, 4) : acct;
        return `UPI Transfer from A/C XX${accountLast4}`;
      }

      return 'UPI Transfer';
    }

    // Generic transfer
    if (lowerMessage.includes('credited to a/c') || lowerMessage.includes('debited from a/c')) {
      return 'Account Transfer';
    }

    return super.extractMerchant(message, sender);
  }

  protected extractAccountLast4(message: string): string | null {
    const base = super.extractAccountLast4(message);
    if (base != null) {
      return base;
    }

    // Pattern: "Your a/c no. XXXXXXXXXXXXXXX" or "Savings No XXXXXXXXXXXXXXX"
    const accountPatterns = [/Your\s+a\/c\s+no\.\s+([X\d]+)/i, /Savings\s+No\s+([X\d]+)/i];

    for (const pattern of accountPatterns) {
      const m = find(pattern, message);
      if (m) {
        return this.extractLast4Digits(gv(m, 1));
      }
    }

    return null;
  }

  protected extractBalance(message: string): Paise | null {
    // Pattern: "Avl Bal 120.00"
    const m = find(/Avl\s+Bal\s+([0-9,]+(?:\.\d{2})?)/i, message);
    if (m) {
      return toPaise(gv(m, 1));
    }

    return super.extractBalance(message);
  }

  protected extractReference(message: string): string | null {
    // Pattern: "(UPI Ref no 123456789012)"
    const upiRef = find(/\(UPI\s+Ref\s+no\s+(\d+)\)/i, message);
    if (upiRef) {
      return gv(upiRef, 1);
    }

    // NEFT transaction ID if present
    const neftRef = find(/NEFT[:/]\s*([A-Z0-9]+)/i, message);
    if (neftRef) {
      return gv(neftRef, 1);
    }

    return super.extractReference(message);
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    // Skip OTP and non-transaction messages
    if (lowerMessage.includes('otp') || lowerMessage.includes('verification') || lowerMessage.includes('request')) {
      return false;
    }

    // Check for City Union Bank specific transaction patterns
    if (
      lowerMessage.includes('is debited for') ||
      lowerMessage.includes('is credited for') ||
      lowerMessage.includes('credited with') ||
      lowerMessage.includes('neft trf')
    ) {
      return true;
    }

    return super.isTransactionMessage(message);
  }
}
