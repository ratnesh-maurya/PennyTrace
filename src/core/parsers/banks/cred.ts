// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
//
// Upstream `bank/CredParser.kt`: CRED credit card bill payment confirmations.

import type { Paise } from '../../types';
import { BankParser } from '../engine/BankParser';
import { toPaise } from '../engine/patterns';
import { find, gv, matches } from '../engine/regex';
import { TransactionType } from '../engine/types';

/**
 * Parser for CRED credit card payment SMS messages.
 * CRED is a credit card payment service that facilitates bill payments.
 * Example: "Payment of Rs.XX,XXX has been successfully credited towards your ICICI Bank Credit Card. Your payment was settled in 3 seconds - CRED"
 * Sender: JK-CREDIN-S, etc.
 *
 * These messages represent credit card bill payments, which should be treated as transfers
 * from the user's bank account to their credit card account.
 */
export class CredParser extends BankParser {
  readonly id = 'cred';

  getBankName(): string {
    return 'CRED';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    // DLT patterns: JK-CREDIN-S, AX-CREDIN-S, etc.
    return (
      matches(/^[A-Z]{2}-CREDIN-S$/, normalizedSender) ||
      matches(/^[A-Z]{2}-CRED-[TPG]$/, normalizedSender) ||
      matches(/^[A-Z]{2}-CRED-S$/, normalizedSender) ||
      normalizedSender === 'CRED' ||
      normalizedSender === 'CREDIN'
    );
  }

  protected extractAmount(message: string): Paise | null {
    // Pattern: "Rs.XX,XXX" or "Rs. XX,XXX"
    const m = find(/Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i, message);
    if (m) {
      return toPaise(gv(m, 1));
    }
    return super.extractAmount(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    // Extract the credit card name after "towards your"
    const m = find(/towards\s+your\s+(.+?)\s+Credit\s+Card/i, message);
    if (m) {
      const cardName = gv(m, 1).trim();
      if (cardName !== '') {
        // Return something like "ICICI Bank Credit Card"
        return `${cardName} Credit Card`;
      }
    }

    // Default to "CRED"
    return super.extractMerchant(message, sender) ?? 'CRED';
  }

  protected extractTransactionType(_message: string): TransactionType | null {
    // Credit card bill payments are transfers from bank account to credit card account
    return TransactionType.TRANSFER;
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();
    // Must contain "payment of" and "credited towards your" to be a CRED transaction
    return lowerMessage.includes('payment of') && lowerMessage.includes('credited towards your');
  }
}
