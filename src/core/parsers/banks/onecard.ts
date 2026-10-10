// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `OneCardParser.kt` (extends BankParser).
import type { Paise } from '../../types';
import { BankParser } from '../engine/BankParser';
import { toPaise } from '../engine/patterns';
import { find, gv } from '../engine/regex';
import { TransactionType, type BankTxn } from '../engine/types';

/**
 * Parser for OneCard credit card SMS messages
 *
 * Supported formats:
 * - Spending: "You've made a booking of Rs. X on MERCHANT on card ending XXXX"
 * - Fuel: "You've fueled up for Rs. X at MERCHANT on card ending XXXX"
 * - General: "You've made a transaction of Rs. X on MERCHANT on card ending XXXX"
 *
 * Common senders: CP-OneCrd-S, ONECRD, OneCard
 */
export class OneCardParser extends BankParser {
  readonly id = 'onecard';

  getBankName(): string {
    return 'OneCard';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return (
      normalizedSender.includes('ONECRD') ||
      normalizedSender.includes('ONECARD') ||
      // DLT patterns for transactions (-S suffix)
      /^[A-Z]{2}-ONECRD-S$/.test(normalizedSender) ||
      /^[A-Z]{2}-ONECARD-S$/.test(normalizedSender) ||
      // Other DLT patterns (OTP, Promotional, Govt)
      /^[A-Z]{2}-ONECRD-[TPG]$/.test(normalizedSender) ||
      /^[A-Z]{2}-ONECARD-[TPG]$/.test(normalizedSender) ||
      // Legacy patterns without suffix
      /^[A-Z]{2}-ONECRD$/.test(normalizedSender) ||
      /^[A-Z]{2}-ONECARD$/.test(normalizedSender) ||
      // Direct sender IDs
      normalizedSender === 'ONECRD' ||
      normalizedSender === 'ONECARD'
    );
  }

  parse(smsBody: string, sender: string, timestamp: number): BankTxn | null {
    const parsed = super.parse(smsBody, sender, timestamp);
    if (parsed == null) {
      return null;
    }

    // OneCard transactions are always credit card transactions
    // All spending on OneCard should be marked as CREDIT type
    return { ...parsed, type: TransactionType.CREDIT };
  }

  /**
   * PennyTrace addition (not upstream): the documented "You've made a booking / fueled up / made a
   * transaction ... on card ending XXXX" formats carry none of the base type keywords, so upstream's
   * base `extractTransactionType` returns null and the whole parse fails. `parse` forces CREDIT anyway,
   * so fall back to CREDIT for those card-spend bodies.
   */
  protected extractTransactionType(message: string): TransactionType | null {
    const type = super.extractTransactionType(message);
    if (type != null) {
      return type;
    }
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.startsWith("you've") && lowerMessage.includes('on card ending')) {
      return TransactionType.CREDIT;
    }
    return null;
  }

  protected extractAmount(message: string): Paise | null {
    // Generic pattern: "for Rs. X at" - covers most OneCard formats
    // Examples: "fueled up for Rs. X at", "hand-picked groceries for Rs. X at", etc.
    const forAmount = find(/for\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)\s+at/i, message);
    if (forAmount) {
      return toPaise(gv(forAmount, 1));
    }

    // Pattern: "of Rs. X on" - for booking/transaction patterns
    const ofAmount = find(/of\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)\s+on/i, message);
    if (ofAmount) {
      return toPaise(gv(ofAmount, 1));
    }

    // Pattern: "spent Rs. X"
    const spent = find(/spent\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i, message);
    if (spent) {
      return toPaise(gv(spent, 1));
    }

    // Fall back to base class patterns
    return super.extractAmount(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    // PennyTrace: the merchant patterns below add a leading `\b` (upstream has none), otherwise
    // "made a transacti|on of Rs. 349.00 on X on card" captures "of Rs. 349.00 on X".
    // Pattern: "at MERCHANT on card" - for fuel transactions
    const atOnCard = find(/\bat\s+([^•\n]+?)\s+on\s+card/i, message);
    if (atOnCard) {
      const merchant = this.cleanMerchantName(gv(atOnCard, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Pattern: "on MERCHANT on card" - extract merchant between "on" and "on card"
    const onOnCard = find(/\bon\s+([^•\n]+?)\s+on\s+card/i, message);
    if (onOnCard) {
      const merchant = this.cleanMerchantName(gv(onOnCard, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Alternative pattern: "at MERCHANT on"
    const atOn = find(/\bat\s+([^•\n]+?)\s+on/i, message);
    if (atOn) {
      const merchant = this.cleanMerchantName(gv(atOn, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Fall back to base class patterns
    return super.extractMerchant(message, sender);
  }

  protected extractAccountLast4(message: string): string | null {
    const base = super.extractAccountLast4(message);
    if (base != null) {
      return base;
    }

    // Pattern: "card ending XXXX" or "on card XXXX"
    const cardPatterns = [/card\s+ending\s+([X\d]+)/i, /on\s+card\s+([X\d]+)/i];
    for (const pattern of cardPatterns) {
      const m = find(pattern, message);
      if (m) {
        return this.extractLast4Digits(gv(m, 1));
      }
    }

    return null;
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    // Skip promotional messages
    if (
      lowerMessage.includes('offer') ||
      lowerMessage.includes('cashback offer') ||
      lowerMessage.includes('get reward') ||
      lowerMessage.includes('statement') ||
      lowerMessage.includes('due date') ||
      lowerMessage.includes('bill generated')
    ) {
      return false;
    }

    // Transaction indicators - OneCard always starts with "You've"
    if (lowerMessage.startsWith("you've") && lowerMessage.includes('on card ending')) {
      return true;
    }

    // Additional patterns
    if (lowerMessage.includes('spent') || lowerMessage.includes('made a')) {
      return true;
    }

    // Fall back to base class for other checks
    return super.isTransactionMessage(message);
  }
}
