// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `bank/CashfreeParser.kt`.
import type { Paise } from '../../types';
import { BankParser } from '../engine/BankParser';
import { toPaise } from '../engine/patterns';
import { find, gv } from '../engine/regex';
import { TransactionType } from '../engine/types';

/**
 * Parser for Cashfree payment gateway confirmations.
 * Handles DLT-style senders such as JX-CSHfre-S, VK-CSHfre-S, JD-CSHfre-T, etc.
 *
 * Cashfree is a payment aggregator (similar in role to Juspay) that delivers
 * outgoing payment confirmations on behalf of merchants. Messages typically look like:
 *
 *   "Payment INR 50.00 (ID:1234567890) confirmed for order #abc_123 on MerchantName.
 *    Powered by Cashfree"
 *
 * The gateway has no concept of balance, account, mandate, or subscription, so this
 * parser extends [BankParser] directly rather than [BaseIndianBankParser].
 */
export class CashfreeParser extends BankParser {
  readonly id = 'cashfree';

  getBankName(): string {
    return 'Cashfree';
  }

  getCurrency(): string {
    return 'INR';
  }

  canHandle(sender: string): boolean {
    // Match the CSHfre token case-insensitively. Covers headers like
    // JX-CSHfre-S, VK-CSHfre-S, JD-CSHfre-T, and plain "CSHFRE".
    return sender.toUpperCase().includes('CSHFRE');
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    // Reject OTP / verification messages first so a Cashfree-sender
    // promo or deep-link that happens to contain "payment" + "confirmed
    // for order" alongside OTP content can never short-circuit past the
    // guard below.
    if (
      lowerMessage.includes('otp') ||
      lowerMessage.includes('one time password') ||
      lowerMessage.includes('verification code')
    ) {
      return false;
    }

    // Cashfree-specific confirmation phrasing: "Payment ... confirmed for order ..."
    if (lowerMessage.includes('payment') && lowerMessage.includes('confirmed for order')) {
      return true;
    }

    return super.isTransactionMessage(message);
  }

  protected extractAmount(message: string): Paise | null {
    // Pattern: "Payment INR 50.00"
    const m = find(/Payment\s+INR\s+([0-9,]+(?:\.\d{1,2})?)/i, message);
    if (m) {
      return toPaise(gv(m, 1));
    }

    return super.extractAmount(message);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();

    // Cashfree messages are outgoing payment confirmations.
    if (lowerMessage.includes('payment') && lowerMessage.includes('confirmed for order')) {
      return TransactionType.EXPENSE;
    }

    return super.extractTransactionType(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    // Pattern: "...confirmed for order #<orderId> on <Merchant>."
    // Capture the merchant between "on " and the next period/end-of-line.
    const m = find(/confirmed\s+for\s+order\s+#\S+\s+on\s+([^.\n\r]+?)(?:\.|$)/i, message);
    if (m) {
      const cleaned = this.cleanMerchantName(gv(m, 1).trim());
      if (this.isValidMerchantName(cleaned)) {
        return cleaned;
      }
    }

    return super.extractMerchant(message, sender);
  }

  protected extractReference(message: string): string | null {
    // Pattern: "(ID:5448114171)"
    const m = find(/\(ID:\s*([A-Za-z0-9]+)\)/i, message);
    if (m) {
      return gv(m, 1);
    }

    return super.extractReference(message);
  }

  protected extractAccountLast4(_message: string): string | null {
    // Cashfree confirmations carry no account/card identifier.
    return null;
  }

  protected extractBalance(_message: string): Paise | null {
    // Cashfree confirmations carry no balance information.
    return null;
  }
}
