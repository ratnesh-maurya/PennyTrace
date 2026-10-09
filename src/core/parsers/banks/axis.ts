// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
//
// Upstream `AxisBankParser.kt`: Axis Bank account, UPI, debit card and credit card alerts.

import type { Paise } from '../../types';
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { toPaise } from '../engine/patterns';
import { find, gv, replaceAll } from '../engine/regex';
import { TransactionType } from '../engine/types';

/**
 * Parser for Axis Bank SMS messages
 */
export class AxisBankParser extends BaseIndianBankParser {
  readonly id = 'axis';

  getBankName(): string {
    return 'Axis Bank';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return (
      normalizedSender.includes('AXIS BANK') ||
      normalizedSender.includes('AXISBANK') ||
      normalizedSender.includes('AXISBK') ||
      normalizedSender.includes('AXISB') ||
      // DLT patterns for transactions (-S suffix)
      /^[A-Z]{2}-AXISBK-S$/.test(normalizedSender) ||
      /^[A-Z]{2}-AXISBANK-S$/.test(normalizedSender) ||
      /^[A-Z]{2}-AXIS-S$/.test(normalizedSender) ||
      // Legacy patterns
      /^[A-Z]{2}-AXISBK$/.test(normalizedSender) ||
      /^[A-Z]{2}-AXIS$/.test(normalizedSender) ||
      // Direct sender IDs
      normalizedSender === 'AXISBK' ||
      normalizedSender === 'AXISBANK' ||
      normalizedSender === 'AXIS'
    );
  }

  protected extractAmount(message: string): Paise | null {
    const inrDebit = find(/INR\s+([0-9,]+(?:\.\d{2})?)\s+debited/i, message);
    if (inrDebit) {
      return toPaise(gv(inrDebit, 1));
    }

    const inrCredit = find(/INR\s+([0-9,]+(?:\.\d{2})?)\s+credited/i, message);
    if (inrCredit) {
      return toPaise(gv(inrCredit, 1));
    }

    const payment = find(/Payment\s+of\s+INR\s+([0-9,]+(?:\.\d{2})?)/i, message);
    if (payment) {
      return toPaise(gv(payment, 1));
    }

    return super.extractAmount(message);
  }

  /** Removes common truncation suffixes from Axis credit card merchant lines. */
  private cleanTruncatedMerchant(raw: string): string {
    let merchant = raw;
    merchant = replaceAll(merchant, /\s+Limi$/, ''); // "Swiggy Limi" -> "Swiggy"
    merchant = replaceAll(merchant, /\s+Pay$/, ''); // "Amazon Pay" -> "Amazon"
    merchant = replaceAll(merchant, /\s+SUPE$/, ''); // "AVENUE SUPE" -> "AVENUE"
    return this.cleanMerchantName(merchant);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    // ATM withdrawal detection
    // Pattern: "debited from A/c no. XX589034 on AXIS BANK L" or similar
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('debited from a/c no.') && lowerMessage.includes(' on axis bank')) {
      return 'ATM';
    }

    // Also check for explicit ATM mentions
    if ((lowerMessage.includes('atm') || lowerMessage.includes('cash withdrawal')) && lowerMessage.includes('debited')) {
      return 'ATM';
    }

    // Debit card transaction pattern (Issue #120)
    // Pattern: "debited from A/c no. XXxxxxy on BURGRILL 04-12-2025 13:13:27 IST"
    // Extract merchant name between "on" and the date pattern
    const debitCard = find(/debited from A\/c no\. [^\s]+ on ([^0-9]+?)(?:\d{2}-\d{2}-\d{4})/i, message);
    if (debitCard) {
      const merchant = this.cleanMerchantName(gv(debitCard, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Credit card "Spent" transactions with merchant on separate line
    // Format 1: "Spent INR 131\nAxis Bank Card no. XX0818\n05-10-25 09:43:27 IST\nSwiggy Limi\nAvl Limit:"
    // Format 2: "Spent\nCard no. XX7441\nINR 562\n01-09-25 12:04:18\nAVENUE SUPE\nAvl Lmt"
    const spentWithIst = find(
      /Spent[\s\S]*?IST\s*\n\s*([^\n]+?)(?:\s*\n|\s*Avl Limit:|\s*Avl Lmt|\s*Not you?)/i,
      message,
    );
    if (spentWithIst) {
      const merchant = this.cleanTruncatedMerchant(gv(spentWithIst, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Alternative pattern without IST (for formats that use different time formats)
    const spentWithTime = find(
      /Spent[\s\S]*?\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s*\n\s*([^\n]+?)(?:\s*\n|\s*Avl Limit:|\s*Avl Lmt|\s*Not you?)/i,
      message,
    );
    if (spentWithTime) {
      const merchant = this.cleanTruncatedMerchant(gv(spentWithTime, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    const upiMerchant = find(/UPI\/[^/]+\/[^/]+\/([^\n]+?)(?:\s*Not you|\s*$)/i, message);
    if (upiMerchant) {
      const merchant = this.cleanMerchantName(gv(upiMerchant, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    const upiPerson = find(/UPI\/P2A\/[^/]+\/([^\n]+?)(?:\s*Not you|\s*$)/i, message);
    if (upiPerson) {
      const merchant = this.cleanMerchantName(gv(upiPerson, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    const info = find(/Info\s*[-–]\s*([^.\n]+?)(?:\.\s*Chk|\s*$)/i, message);
    if (info) {
      const text = gv(info, 1).trim();
      return text.toLowerCase().includes('salary') ? 'Salary' : this.cleanMerchantName(text);
    }

    // Fall back to base class patterns
    return super.extractMerchant(message, sender);
  }

  protected extractAccountLast4(message: string): string | null {
    const base = super.extractAccountLast4(message);
    if (base != null) {
      return base;
    }

    // Pattern 1: "A/c no. XXNNNN" or "A/c no. XXxxxxy"
    const acNo = find(/A\/c\s+no\.\s+([X*xX\d]+)/i, message);
    if (acNo) {
      return this.extractLast4Digits(gv(acNo, 1));
    }

    // Pattern 2: "Card no. XXNNNN"
    const cardNo = find(/Card\s+no\.\s+([X*\d]+)/i, message);
    if (cardNo) {
      return this.extractLast4Digits(gv(cardNo, 1));
    }

    // Pattern 3: "Credit Card XXNNNN"
    const creditCard = find(/Credit\s+Card\s+([X*\d]+)/i, message);
    if (creditCard) {
      return this.extractLast4Digits(gv(creditCard, 1));
    }

    return null;
  }

  protected extractReference(message: string): string | null {
    const upiRef = find(/UPI\/[^/]+\/([0-9]+)/i, message);
    if (upiRef) {
      return gv(upiRef, 1);
    }
    return super.extractReference(message);
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    // Skip Axis-specific payment confirmation messages (payment TO card, not spending)
    if (
      lowerMessage.includes('payment') &&
      lowerMessage.includes('has been received') &&
      lowerMessage.includes('towards your axis bank')
    ) {
      return false;
    }

    // Base class handles common payment reminders and other non-transaction messages
    return super.isTransactionMessage(message);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();

    // Credit card transactions: if message contains "Avl Limit" or "Avl Lmt", it's a credit card
    if (lowerMessage.includes('avl limit') || lowerMessage.includes('avl lmt')) {
      return TransactionType.CREDIT;
    }

    // Explicit credit card mention
    if (
      (lowerMessage.includes('credit card') || lowerMessage.includes(' cc ')) &&
      (lowerMessage.includes('debited') || lowerMessage.includes('spent'))
    ) {
      return TransactionType.CREDIT;
    }

    // Fall back to base class for standard checks
    return super.extractTransactionType(message);
  }

  protected extractAvailableLimit(message: string): Paise | null {
    // Axis Bank specific patterns using "INR" instead of "Rs"
    const axisCreditLimitPatterns = [
      // "Avl Limit: INR 217162.72"
      /Avl\s+Limit:?\s*INR\s+([0-9,]+(?:\.\d{2})?)/i,
      // "Avl Lmt INR 4632.87"
      /Avl\s+Lmt\s+INR\s+([0-9,]+(?:\.\d{2})?)/i,
      // "Available limit INR 111,111.89"
      /Available\s+limit:?\s*INR\s+([0-9,]+(?:\.\d{2})?)/i,
    ];
    for (const pattern of axisCreditLimitPatterns) {
      const m = find(pattern, message);
      if (m) {
        return toPaise(gv(m, 1));
      }
    }

    // Fall back to base class patterns (for Rs-based formats)
    return super.extractAvailableLimit(message);
  }
}
