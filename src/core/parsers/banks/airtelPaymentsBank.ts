// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `AirtelPaymentsBankParser.kt`.

import type { Paise } from '../../types';
import { BankParser } from '../engine/BankParser';
import { toPaise } from '../engine/patterns';
import { find, gv } from '../engine/regex';
import { TransactionType } from '../engine/types';

/**
 * Parser for Airtel Payments Bank SMS messages
 *
 * Common senders: AD-AIRBNK-S, XX-AIRBNK-T, etc.
 *
 * SMS Formats:
 * - Airtel Payments Bank a/c is credited with Rs.20.00. Txn ID: 560992310006. Call 180023400 for help
 * - Rs. 5.00 debited from Airtel Payments Bank a/c Txn ID xxxxxxxx Bal:15.56 Call 180023400 for help
 */
export class AirtelPaymentsBankParser extends BankParser {
  readonly id = 'airtel-payments-bank';

  getBankName(): string {
    return 'Airtel Payments Bank';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    // Only handle Airtel Payments Bank, not prepaid recharges (Airtel-S)
    return normalizedSender.includes('AIRBNK');
  }

  protected extractAmount(message: string): Paise | null {
    // List of amount patterns for Airtel Payments Bank
    const amountPatterns = [
      // "credited with Rs.20.00"
      /credited\s+with\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
      // "Rs. 5.00 debited from"
      /Rs\.?\s*([0-9,]+(?:\.\d{2})?)\s+debited\s+from/i,
      // "debited with Rs.5.00" (potential variant)
      /debited\s+with\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
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
    if (lowerMessage.includes('credited with')) return TransactionType.INCOME;
    if (lowerMessage.includes('is credited')) return TransactionType.INCOME;
    if (lowerMessage.includes('credit')) return TransactionType.INCOME;
    if (lowerMessage.includes('debited from')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('debited with')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('debit')) return TransactionType.EXPENSE;
    return super.extractTransactionType(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    // For basic credit/debit transactions, use bank name
    // In future, can enhance to extract merchant info from more detailed messages
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('airtel payments bank')) {
      return 'Airtel Payments Bank Transaction';
    }
    return super.extractMerchant(message, sender) ?? 'Airtel Payments Bank';
  }

  protected extractReference(message: string): string | null {
    // Pattern: "Txn ID: 560992310006" or "Txn ID xxxxxxxx"
    const txn = find(/Txn\s+ID[:\s]+([A-Z0-9]+)/i, message);
    if (txn) {
      const txnId = gv(txn, 1);
      // Filter out masked IDs like "xxxxxxxx"
      if (!txnId.toLowerCase().includes('x')) {
        return txnId;
      }
    }

    // Alternative pattern for transaction ID
    const alt = find(/Transaction\s+ID[:\s]+([A-Z0-9]+)/i, message);
    if (alt) {
      return gv(alt, 1);
    }

    return super.extractReference(message);
  }

  protected extractBalance(message: string): Paise | null {
    // Pattern: "Bal:15.56"
    const bal = find(/Bal[:\s]+([0-9,]+(?:\.\d{2})?)/i, message);
    if (bal) {
      return toPaise(gv(bal, 1));
    }

    // Alternative pattern: "Balance: Rs. 15.56"
    const alt = find(/Balance[:\s]+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i, message);
    if (alt) {
      return toPaise(gv(alt, 1));
    }

    return super.extractBalance(message);
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    // Skip OTP and non-transaction messages
    if (
      lowerMessage.includes('otp') ||
      lowerMessage.includes('verification') ||
      lowerMessage.includes('request') ||
      lowerMessage.includes('failed')
    ) {
      return false;
    }

    // Check for Airtel Payments Bank specific transaction patterns
    if (
      lowerMessage.includes('credited with') ||
      lowerMessage.includes('debited from') ||
      (lowerMessage.includes('airtel payments bank') &&
        (lowerMessage.includes('credited') || lowerMessage.includes('debited')))
    ) {
      return true;
    }

    return super.isTransactionMessage(message);
  }
}
