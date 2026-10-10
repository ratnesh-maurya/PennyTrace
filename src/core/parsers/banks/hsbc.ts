// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `HSBCBankParser.kt`: HSBC India (and Egypt-format) account, debit card,
// credit card and NEFT/RTGS/IMPS messages from senders like `VM-HSBCIN-S`.
import type { Paise } from '../../types';
import { BankParser } from '../engine/BankParser';
import { toPaise } from '../engine/patterns';
import { find, gv, matches, replaceAll, rx, test } from '../engine/regex';
import { TransactionType, type BankTxn } from '../engine/types';

/** Multi-currency pattern group. */
const CUR = String.raw`(?:INR|EGP|USD|GBP|EUR|AED|SAR|OMR|BHD|KWD|QAR)`;

/**
 * Parser for HSBC Bank SMS messages
 */
export class HsbcBankParser extends BankParser {
  readonly id = 'hsbc';

  getBankName(): string {
    return 'HSBC Bank';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return (
      normalizedSender.includes('HSBC') ||
      normalizedSender.includes('HSBCIN') ||
      // DLT patterns
      matches(/^[A-Z]{2}-HSBCIN-[A-Z]$/, normalizedSender) ||
      matches(/^[A-Z]{2}-HSBC-[A-Z]$/, normalizedSender)
    );
  }

  parse(smsBody: string, sender: string, timestamp: number): BankTxn | null {
    if (!this.canHandle(sender)) return null;
    if (!this.isTransactionMessage(smsBody)) return null;

    const amount = this.extractAmount(smsBody);
    if (amount == null) return null;
    const transactionType = this.extractTransactionType(smsBody);
    if (transactionType == null) return null;
    const merchant = this.extractMerchant(smsBody, sender) ?? 'Unknown';
    const currency = this.detectCurrency(smsBody);

    return this.txn({
      amount,
      type: transactionType,
      merchant,
      accountLast4: this.extractAccountLast4(smsBody),
      balance: this.extractBalance(smsBody),
      creditLimit: this.extractAvailableLimit(smsBody),
      reference: this.extractReference(smsBody),
      smsBody,
      sender,
      timestamp,
      isFromCard: this.detectIsCard(smsBody),
      currency,
    });
  }

  private detectCurrency(message: string): string {
    const m = find(/(EGP|INR|USD|GBP|EUR|AED|SAR|OMR|BHD|KWD|QAR)\s+[\d,]+/i, message);
    return m ? gv(m, 1).toUpperCase() : 'INR';
  }

  protected extractAmount(message: string): Paise | null {
    const patterns = [
      // Pattern 1: "INR 49.00 is paid from" / "EGP 123.99 is debited"
      rx(String.raw`${CUR}\s+([\d,]+(?:\.\d+)?)\s+is\s+(?:paid|credited|debited)`, 'i'),
      // Pattern 2: "for EGP 123.99 on" / "for INR 305.00 on" (card transactions)
      rx(String.raw`for\s+${CUR}\s+([\d,]+(?:\.\d+)?)\s+on`, 'i'),
      // Pattern 3: "has been used for EGP 123.99 on" (Egypt credit card)
      rx(String.raw`used\s+for\s+${CUR}\s+([\d,]+(?:\.\d+)?)\s+on`, 'i'),
      // Pattern 4: "for INR 305.00" at end (credit card, no trailing "on")
      rx(String.raw`for\s+${CUR}\s+([\d,]+(?:\.\d+)?)(?:\s|$|\.)`, 'i'),
    ];
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return toPaise(gv(m, 1));
      }
    }

    return super.extractAmount(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    // Pattern 0: Outgoing NEFT/RTGS/IMPS - "credited to the [BANK] A/c XXX of [NAME]"
    // Extract the beneficiary name (the person receiving the money)
    const outgoingNeft = find(/credited\s+to\s+the\s+\w+\s+A\/c\s+[X\d]+\s+of\s+(.+?)\s+on\s+/i, message);
    if (outgoingNeft) {
      const beneficiaryName = this.cleanMerchantName(gv(outgoingNeft, 1).trim());
      if (this.isValidMerchantName(beneficiaryName)) {
        return beneficiaryName;
      }
    }

    const patterns = [
      // Pattern 1: "from CHAS A/c ***6983 of John Doe" (NEFT/Credit transactions)
      // Extract everything after "from" until " ." or end of sentence
      /as\s+(?:NEFT|RTGS|IMPS)\s+from\s+(.+?)\s+\./i,
      // Pattern 2: "at IKEA INDIA ." (debit card format with space before period)
      /at\s+([^.]+?)\s*\./i,
      // Pattern 3: "used at [Merchant] for" (credit card)
      /used\s+at\s+([^\s]+)\s+for\s+INR/i,
      // Pattern 4: "to [Merchant] on" for payments
      /to\s+([^.]+?)\s+on\s+\d/i,
      // Pattern 5: "from [Merchant]" for generic credits
      /from\s+([^.]+?)(?:\s+on\s+|\s+with\s+|$)/i,
    ];
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        const merchant = this.cleanMerchantName(gv(m, 1).trim());
        if (this.isValidMerchantName(merchant)) {
          return merchant;
        }
      }
    }

    return super.extractMerchant(message, sender);
  }

  protected cleanMerchantName(merchant: string): string {
    let cleaned = super.cleanMerchantName(merchant);
    // Remove "for INR xxx" suffix that may appear in credit card transactions
    cleaned = replaceAll(cleaned, /\s+for\s+INR\s+[\d,]+(?:\.\d{2})?$/i, '');
    return cleaned.trim();
  }

  protected extractAccountLast4(message: string): string | null {
    const fromBase = super.extractAccountLast4(message);
    if (fromBase != null) return fromBase;

    // Each pattern returns as soon as it matches (even if no digits survive), as upstream.
    const patterns = [
      // Pattern 0: "Credit Card ending with ***6" (Egypt format)
      /(?:Credit\s+Card|Debit\s+Card|Card)\s+ending\s+with\s+([*\d]+)/i,
      // Pattern 1: "A/c 074-260***-006" format
      // Capture everything after A/c keyword, filter to digits, take last 4
      /A\/c\s+([\d\-*]+)/i,
      // Pattern 2: "Debit Card XXXXX71xx" format
      // Handle mixed digits and 'x' characters - extract digits only, take last 4
      /Debit\s+Card\s+([X*\d]+)/i,
      // Pattern 3: "creditcard xxxxx1234" or "credit card xxxxx1234"
      /credit\s*card\s+([xX*\d]+)/i,
      // Pattern 4: account XXXXXX1234
      /account\s+([X*\d]+)/i,
    ];
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return this.extractLast4Digits(gv(m, 1));
      }
    }

    return null;
  }

  protected extractReference(message: string): string | null {
    // Pattern 1: "with UTR CHASH00007392391" (NEFT/RTGS/IMPS transactions)
    const utr = find(/with\s+UTR\s+(\w+)/i, message);
    if (utr) {
      return gv(utr, 1);
    }

    // Pattern 2: "with ref 222222222222"
    const ref = find(/with\s+ref\s+(\w+)/i, message);
    if (ref) {
      return gv(ref, 1);
    }

    return super.extractReference(message);
  }

  protected extractBalance(message: string): Paise | null {
    const patterns = [
      // Pattern 1: "Your Avl Bal is INR xyz"
      rx(String.raw`(?:Your\s+)?Avl\s+Bal\s+is\s+${CUR}\s+([\d,]+(?:\.\d+)?)`, 'i'),
      // Pattern 2: "available bal is INR/EGP xyz"
      rx(String.raw`available\s+bal\s+is\s+${CUR}\s+([\d,]+(?:\.\d+)?)`, 'i'),
    ];
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return toPaise(gv(m, 1));
      }
    }

    return super.extractBalance(message);
  }

  protected extractAvailableLimit(message: string): Paise | null {
    // "Your available limit is EGP 1234.29"
    const m = find(
      /available\s+limit\s+is\s+(?:INR|EGP|USD|GBP|EUR|AED|SAR|OMR|BHD|KWD|QAR)\s+([\d,]+(?:\.\d+)?)/i,
      message,
    );
    if (m) {
      return toPaise(gv(m, 1));
    }

    return super.extractAvailableLimit(message);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();

    // Debit card transactions - "Thank you for using HSBC Debit Card"
    if (lowerMessage.includes('debit card') && lowerMessage.includes('thank you for using')) {
      return TransactionType.EXPENSE;
    }
    if (lowerMessage.includes('debit card') && lowerMessage.includes('for inr')) return TransactionType.EXPENSE;

    // Credit card transactions
    if (lowerMessage.includes('creditcard') || lowerMessage.includes('credit card')) return TransactionType.CREDIT;

    // NEFT/RTGS/IMPS outgoing transfer - "credited to the [OTHER BANK] A/c of [PERSON]"
    // This is a confirmation that YOUR outgoing transfer was successful
    if (this.isOutgoingNeftTransfer(message)) return TransactionType.TRANSFER;

    // Standard transaction patterns
    if (lowerMessage.includes('is paid from')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('is debited')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('is credited to')) return TransactionType.INCOME;
    if (lowerMessage.includes('is credited with')) return TransactionType.INCOME;
    if (lowerMessage.includes('deposited')) return TransactionType.INCOME;

    return super.extractTransactionType(message);
  }

  /**
   * Detects outgoing NEFT/RTGS/IMPS transfers where the SMS confirms
   * that money has been credited to someone else's account at another bank.
   * Pattern: "your NEFT transaction... has been credited to the [BANK] A/c... of [NAME]"
   */
  private isOutgoingNeftTransfer(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    // Must be a NEFT/RTGS/IMPS transaction
    if (!lowerMessage.includes('neft') && !lowerMessage.includes('rtgs') && !lowerMessage.includes('imps')) {
      return false;
    }

    // Check for pattern: "credited to the [BANK] A/c" where BANK is not HSBC
    const m = find(/credited\s+to\s+the\s+(\w+)\s+A\/c/i, message);
    if (m) {
      const bankName = gv(m, 1).toUpperCase();
      // If credited to a non-HSBC account, it's an outgoing transfer
      if (bankName !== 'HSBC') {
        return true;
      }
    }

    // Check for pattern: "credited to... of [PERSON NAME]" (beneficiary name)
    if (lowerMessage.includes('credited to') && test(/A\/c\s+[X\d]+\s+of\s+\w+/i, message)) {
      return true;
    }

    return false;
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    // Skip OTP messages
    if (lowerMessage.includes('otp is') || lowerMessage.includes('otp valid for')) {
      return false;
    }

    // Check for HSBC-specific transaction keywords
    if (
      lowerMessage.includes('is paid from') ||
      lowerMessage.includes('is credited to') ||
      lowerMessage.includes('is debited') ||
      lowerMessage.includes('has been used for') ||
      (lowerMessage.includes('creditcard') && lowerMessage.includes('used at')) ||
      (lowerMessage.includes('credit card') && lowerMessage.includes('used at')) ||
      (lowerMessage.includes('credit card') && lowerMessage.includes('used for')) ||
      (lowerMessage.includes('thank you for using') && lowerMessage.includes('card')) ||
      (lowerMessage.includes('debit card') && lowerMessage.includes('for inr')) ||
      (lowerMessage.includes('inr') && lowerMessage.includes('account')) ||
      (lowerMessage.includes('egp') && lowerMessage.includes('card'))
    ) {
      return true;
    }

    return super.isTransactionMessage(message);
  }
}
