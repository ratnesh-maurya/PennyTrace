// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
//
// Upstream `bank/PNBBankParser.kt`: Punjab National Bank (PNB) SMS and RCS messages.

import type { Paise } from '../../types';
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { toPaise } from '../engine/patterns';
import { find, gv, matches, takeLast, test } from '../engine/regex';
import { TransactionType, type BankTxn, type MandateInfo } from '../engine/types';

/** Upstream `PNBBankParser.UPIMandateInfo` (dateFormat is always "dd-MMM-yy"). */
export type UPIMandateInfo = MandateInfo;

const includesIc = (s: string, x: string): boolean => s.toLowerCase().includes(x.toLowerCase());

/**
 * Parser for Punjab National Bank (PNB) SMS messages
 */
export class PnbBankParser extends BaseIndianBankParser {
  readonly id = 'pnb';

  getBankName(): string {
    return 'Punjab National Bank';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return (
      normalizedSender.includes('PUNJAB NATIONAL BANK') || // RCS sender (any case)
      normalizedSender.includes('PNBBNK') ||
      normalizedSender.includes('PUNBN') ||
      normalizedSender.includes('PNBSMS') || // Matches V?-PNBSMS-S
      matches(/^[A-Z]{2}-PNBBNK-S$/, normalizedSender) ||
      matches(/^[A-Z]{2}-PNB-S$/, normalizedSender) ||
      matches(/^[A-Z]{2}-PNBBNK$/, normalizedSender) ||
      matches(/^[A-Z]{2}-PNB$/, normalizedSender) ||
      matches(/^(?:[A-Z]{2}-)?PNBCCD(?:-[ST])?$/, normalizedSender) || // Credit card alerts
      normalizedSender === 'PNBBNK' ||
      normalizedSender === 'PNB'
    );
  }

  parse(smsBody: string, sender: string, timestamp: number): BankTxn | null {
    // Normalize Unicode text for RCS messages
    const normalizedBody = this.normalizeUnicodeText(smsBody);

    // Use normalized body for parsing
    return super.parse(normalizedBody, sender, timestamp);
  }

  private normalizeUnicodeText(text: string): string {
    // Decompose Unicode (NFKD = Compatibility Decomposition)
    let decomposed = text;
    try {
      decomposed = typeof text.normalize === 'function' ? text.normalize('NFKD') : text;
    } catch {
      decomposed = text;
    }
    // Keep ASCII and the rupee symbol
    return decomposed.replace(/[^\x00-\x7F₹]/g, '');
  }

  protected extractAmount(message: string): Paise | null {
    // Handle "a/c no XX340 is debited for Rs 7519" pattern
    const debitedFor = find(/debited\s+for\s+(?:Rs\.?|INR|₹)\s*([0-9,]+(?:\.\d{2})?)/i, message);
    if (debitedFor) {
      return toPaise(gv(debitedFor, 1));
    }

    // Handle explicit debit of initial amount in auto-pay messages
    const initialDebit = find(
      /initial\s+amount\s+of\s+(?:Rs\.?|INR|₹)\s*([0-9,]+(?:\.\d{2})?)\s+has\s+been\s+debited/i,
      message,
    );
    if (initialDebit) {
      return toPaise(gv(initialDebit, 1));
    }

    // Handle debit patterns with currency text or the rupee symbol
    // "with" is optional for backward compatibility ("debited Rs. X" and "debited with Rs. X")
    const debit = find(/debited\s+(?:(?:with|by)\s+)?(?:Rs\.?|INR|₹)\s*([0-9,]+(?:\.\d{2})?)/i, message);
    if (debit) {
      return toPaise(gv(debit, 1));
    }

    // Handle credit patterns with currency text or the rupee symbol
    const credit = find(
      /(?:(?:Rs\.?|INR|₹)\s*([0-9,]+(?:\.\d{2})?)\s+(?:has\s+been\s+)?credited|credited\s+(?:(?:with|by|for)\s+)?(?:Rs\.?|INR|₹)\s*([0-9,]+(?:\.\d{2})?))/i,
      message,
    );
    if (credit) {
      // Try to get the amount from either capture group (pattern 1 or pattern 2)
      const amount = gv(credit, 1) !== '' ? gv(credit, 1) : gv(credit, 2);
      return toPaise(amount);
    }

    // Note: Removed balance pattern - balance should never be used as transaction amount
    // Balance is extracted separately by extractBalance() method
    return super.extractAmount(message);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();

    if (this.isUPIMandateNotification(message)) {
      return null;
    }

    // "PNB Credit Card 1234 debited with Rs.270 ..." is a card spend. Match the
    // card as the thing debited — a bank-account debit "towards PNB credit card
    // payment" also mentions the card and must stay an account expense.
    if (this.isCardSpend(message)) {
      return TransactionType.CREDIT;
    }

    // Auto-Pay activation can carry a real initial debit that should remain an expense.
    if (lowerMessage.includes('auto pay facility') && lowerMessage.includes('debited')) {
      return TransactionType.EXPENSE;
    }

    return super.extractTransactionType(message);
  }

  isUPIMandateNotification(message: string): boolean {
    const lowerMessage = message.toLowerCase();
    return (
      (lowerMessage.includes('upi-mandate') || lowerMessage.includes('upi mandate')) &&
      lowerMessage.includes('successfully created')
    );
  }

  parseUPIMandateSubscription(message: string): UPIMandateInfo | null {
    if (!this.isUPIMandateNotification(message)) {
      return null;
    }

    const amountMatch = find(/for\s+(?:Rs\.?|INR)\s*([0-9,]+(?:\.\d{2})?)/i, message);
    const amount =
      (amountMatch ? toPaise(gv(amountMatch, 1)) : null) ?? super.parseMandateSubscription(message)?.amount ?? null;
    if (amount == null) {
      return null;
    }

    const merchantMatch = find(/towards\s+(.+?)\s+for\s+(?:Rs\.?|INR)/i, message);
    let merchant: string | null = null;
    if (merchantMatch) {
      const cleaned = this.cleanMerchantName(gv(merchantMatch, 1).trim());
      merchant = this.isValidMerchantName(cleaned) ? cleaned : null;
    }
    merchant = merchant ?? super.parseMandateSubscription(message)?.merchant ?? null;
    if (merchant == null) {
      return null;
    }

    const umnMatch = find(/UMN:?\s*([^.\s]+)/i, message);
    const umn = umnMatch ? gv(umnMatch, 1) : null;

    return {
      amount,
      nextDeductionDate: null,
      merchant,
      umn,
      accountLast4: this.extractAccountLast4(message),
      dateFormat: 'dd-MMM-yy',
    };
  }

  protected extractMerchant(message: string, sender: string): string | null {
    // Credit card spend: "... debited with Rs.270 [CODE:..] at <payee or VPA> on 04-10-2026"
    // The payee can be several words ("at AMAZON INDIA on …"), so take
    // everything up to "on <date>".
    if (this.isCardSpend(message)) {
      const m = find(/\bat\s+(.+?)\s+on\s+\d/i, message);
      if (m) {
        // Same as HDFC credit cards: show the VPA's handle, not the bank suffix.
        const raw = gv(m, 1);
        const at = raw.indexOf('@');
        const payee = this.cleanMerchantName(at >= 0 ? raw.slice(0, at) : raw);
        if (payee !== '') {
          return payee;
        }
      }
    }

    // Handle IMPS transactions early to avoid base class patterns matching phone numbers
    if (includesIc(message, 'IMPS')) {
      return 'IMPS Transfer';
    }

    // Extract merchant from Auto-Pay activation: from Google Clouds
    const fromMerchant = find(/auto\s+pay.*?activated.*?from\s+([^.]+?)(?:\s+An\s+initial|\.|$)/i, message);
    if (fromMerchant) {
      return gv(fromMerchant, 1).trim();
    }

    // Extract merchant from UPI-Mandate: towards Google Pay
    const towards = find(/UPI-Mandate.*towards\s+(.+?)\s+for/i, message);
    if (towards) {
      return gv(towards, 1).trim();
    }

    // Extract card info if available: thru card XX9239
    const card = find(/thru\s+card\s+([X*]+\d{4})/i, message);
    if (card) {
      return `Card ${gv(card, 1)}`;
    }

    if (includesIc(message, 'PNB ATM')) {
      return 'PNB ATM Withdrawal';
    }

    if (test(/\bATM\b/i, message)) {
      return 'ATM Transaction';
    }

    if (test(/thru\s+debitcard\b/i, message)) {
      return super.extractMerchant(message, sender) ?? 'Debit Card Transaction';
    }

    if (includesIc(message, 'NEFT')) {
      return 'NEFT Transfer';
    }

    const upiPayee = find(/\bto\s+(.+?)\s+thru\s+UPI\s*:/i, message);
    if (upiPayee) {
      const payee = this.cleanMerchantName(gv(upiPayee, 1).trim());
      if (this.isValidMerchantName(payee)) {
        return payee;
      }
    }

    if (includesIc(message, 'UPI')) {
      const byPayee = find(/\bby\s+((?:(?!\bby\b).)+?)\s+thru\s+UPI\b/i, message);
      if (byPayee) {
        const payee = this.cleanMerchantName(gv(byPayee, 1).trim());
        if (this.isValidMerchantName(payee)) {
          return payee;
        }
      }

      const fromPayee = find(/\bfrom\s+([^/\r\n]+)\//i, message);
      if (fromPayee) {
        const payee = this.cleanMerchantName(gv(fromPayee, 1).trim());
        if (this.isValidMerchantName(payee)) {
          return payee;
        }
      }

      return 'UPI Transaction';
    }

    return super.extractMerchant(message, sender);
  }

  protected extractAccountLast4(message: string): string | null {
    // Preserve short masks; take the trailing digits when more than four are visible.
    const acNo = find(/(?:a\/c\s+(?:no\.?\s*)?|ac\s+)[X*]+(\d{2,16})\b/i, message);
    if (acNo) {
      return takeLast(gv(acNo, 1), 4);
    }

    // Handle variations: Ac, Card followed by X/dots/spaces and then digits (4 to 16)
    const ac = find(/(?:A\/c(?:\s*No\.)?|Ac|Card)\s*(?:[X*]+)?(\d{4,16})/i, message);
    if (ac) {
      return takeLast(gv(ac, 1), 4);
    }

    return super.extractAccountLast4(message);
  }

  protected extractReference(message: string): string | null {
    const rrn = find(/\bRRN\s*[-:]\s*(\d{6,})/i, message);
    if (rrn) {
      return gv(rrn, 1);
    }

    // Handle IMPS reference: "IMPS Ref no 606701245043"
    if (includesIc(message, 'IMPS')) {
      // More flexible pattern: IMPS followed by any word then reference number
      const impsRef = find(/IMPS\s+\w*\s*Ref\s*(?:no\.?\s*)?(\d{6,})/i, message);
      if (impsRef) {
        return gv(impsRef, 1);
      }

      // Fallback: find a 12-digit number after IMPS (IMPS refs are 12 digits)
      const impsFallback = find(/IMPS[^0-9]*(\d{12,})/i, message);
      if (impsFallback) {
        return gv(impsFallback, 1);
      }
    }

    const neftRef = find(/ref\s+no\.\s+([A-Z0-9]+)/i, message);
    if (neftRef) {
      return gv(neftRef, 1);
    }

    // Handle UPI Ref ID: "(UPI Ref ID:606379499474)"
    const upiRefId = find(/UPI\s+Ref\s+ID:?\s*(\d+)/i, message);
    if (upiRefId) {
      return gv(upiRefId, 1);
    }

    // Handle "UPI: <number>" format
    const upiRef = find(/UPI:\s*([0-9]+)/i, message);
    if (upiRef) {
      return gv(upiRef, 1);
    }

    // Fall back to base class, but filter out "-PNB" suffix matches
    const baseRef = super.extractReference(message);
    return baseRef != null && baseRef.toUpperCase() === 'PNB' ? null : baseRef;
  }

  protected extractBalance(message: string): Paise | null {
    // Handle "Aval Bal", "Avl Bal", "Bal" followed by currency and amount, usually ending with CR/DR
    const bal = find(
      /(?:Aval\s+Bal|Avl\s+Bal|Avl|Bal)\s*(?:INR\s*|Rs\.?\s*|₹\s*)?([0-9,]+(?:\.\d{2})?)(?:\s+(?:CR|DR))?/i,
      message,
    );
    if (bal) {
      return toPaise(gv(bal, 1));
    }

    // Fallback for just "Bal XXXX.XX CR"
    const simpleBal = find(/Bal\s*([0-9,]+(?:\.\d{2})?)\s+(?:CR|DR)/i, message);
    if (simpleBal) {
      return toPaise(gv(simpleBal, 1));
    }

    return super.extractBalance(message);
  }

  protected extractAvailableLimit(message: string): Paise | null {
    // "Avl limit Rs. 48882.5." — one decimal digit, which the base patterns truncate.
    const m = find(/Avl\s+limit\s*(?:Rs\.?|INR)\s*([0-9,]+(?:\.\d{1,2})?)/i, message);
    if (m) {
      return toPaise(gv(m, 1));
    }
    return super.extractAvailableLimit(message);
  }

  private isCardSpend(message: string): boolean {
    return test(/PNB\s+Credit\s+Card\s+(?:XX)?\d{4}\s+debited/i, message);
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    if (this.isUPIMandateNotification(message)) {
      return false;
    }

    // Credit card bill payment received: skipped as HDFC/ICICI do — the debit
    // from the paying bank account already records the money moving.
    if (lowerMessage.includes('received as payment towards your pnb credit card')) {
      return false;
    }

    if (lowerMessage.includes('auto pay facility') && lowerMessage.includes('debited')) {
      return true;
    }

    if (lowerMessage.includes('register for e-statement')) {
      return true;
    }

    if (lowerMessage.includes('imps') && lowerMessage.includes('debited')) {
      return true;
    }

    return super.isTransactionMessage(message);
  }
}
