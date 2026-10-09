// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `UtkarshBankParser.kt`.
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { find, gv, matches } from '../engine/regex';
import { TransactionType } from '../engine/types';

/**
 * Parser for Utkarsh Small Finance Bank (SFBL) SuperCard credit card transactions.
 * Handles messages from UTKSPR and similar senders.
 */
export class UtkarshBankParser extends BaseIndianBankParser {
  readonly id = 'utkarsh';

  getBankName(): string {
    return 'Utkarsh Bank';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return (
      normalizedSender.includes('UTKSPR') || normalizedSender.includes('UTKARSH') || normalizedSender.includes('UTKSFB')
    );
  }

  protected extractMerchant(message: string, sender: string): string | null {
    const lowerMessage = message.toLowerCase();

    // Pattern 1: "for UPI - merchant/reference"
    const upi = find(/for\s+UPI\s*[-–]\s*([^\s.]+)/i, message);
    if (upi) {
      const merchant = gv(upi, 1).trim();
      // Check if it's just a reference number (all digits or with x's)
      if (!matches(/[x0-9]+/, merchant)) {
        return this.cleanMerchantName(merchant);
      }
    }

    // Pattern 2: "for merchant on date"
    const forMatch = find(/for\s+([^0-9][^\s]+?)(?:\s+on\s+|\s+at\s+|$)/i, message);
    if (forMatch) {
      const merchant = gv(forMatch, 1).trim();
      if (merchant.toUpperCase() !== 'UPI' && merchant.toUpperCase() !== 'INR') {
        return this.cleanMerchantName(merchant);
      }
    }

    // Check for specific patterns
    if (lowerMessage.includes('supercard') && lowerMessage.includes('upi')) {
      return 'UPI Payment';
    }
    return super.extractMerchant(message, sender) ?? 'Utkarsh SuperCard';
  }

  protected extractTransactionType(_message: string): TransactionType | null {
    // Utkarsh SuperCard is a credit card product, all transactions are credit
    return TransactionType.CREDIT;
  }

  protected extractAccountLast4(message: string): string | null {
    const base = super.extractAccountLast4(message);
    if (base != null) {
      return base;
    }
    // Pattern for SuperCard xxxx
    const card = find(/SuperCard\s+([xX*\d]+)/i, message);
    if (card) {
      return this.extractLast4Digits(gv(card, 1));
    }
    // Pattern for account XXXX
    const account = find(/(?:account|a\/c)\s+([xX*\d]+)/i, message);
    if (account) {
      return this.extractLast4Digits(gv(account, 1));
    }
    return null;
  }
}
