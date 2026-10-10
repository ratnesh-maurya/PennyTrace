// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `SBIBankParser.kt`.
import type { Paise } from '../../types';
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { toPaise } from '../engine/patterns';
import { find, gv, matches } from '../engine/regex';
import { TransactionType, type BankTxn, type MandateInfo } from '../engine/types';

/** UPI-Mandate information for SBI Bank (upstream `SBIBankParser.UPIMandateInfo`). */
export type UpiMandateInfo = MandateInfo;

/**
 * NFKD decomposes Unicode Math Sans-Serif characters to ASCII equivalents, then
 * every remaining non-ASCII character is dropped (upstream `normalizeUnicodeText`).
 */
function normalizeUnicodeText(text: string): string {
  let s = text;
  try {
    if (typeof s.normalize === 'function') {
      s = s.normalize('NFKD');
    }
  } catch {
    // keep the original text
  }
  return s.replace(/[^\x00-\x7F]/g, '');
}

/**
 * Parser for State Bank of India (SBI) SMS messages
 */
export class SbiBankParser extends BaseIndianBankParser {
  readonly id = 'sbi';

  getBankName(): string {
    return 'State Bank of India';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return (
      normalizedSender.includes('SBI') ||
      normalizedSender.includes('SBIINB') ||
      normalizedSender.includes('SBIUPI') ||
      normalizedSender.includes('SBICRD') ||
      normalizedSender.includes('ATMSBI') ||
      // Direct sender IDs
      normalizedSender === 'SBIBK' ||
      normalizedSender === 'SBIBNK' ||
      // SBI Card RCS sender
      normalizedSender.includes('SBI CARDS') ||
      // DLT patterns for transactions (-S suffix)
      matches(/^[A-Z]{2}-SBIBK-S$/, normalizedSender) ||
      // Other DLT patterns (OTP, Promotional, Govt)
      matches(/^[A-Z]{2}-SBIBK-[TPG]$/, normalizedSender) ||
      // Legacy patterns without suffix
      matches(/^[A-Z]{2}-SBIBK$/, normalizedSender) ||
      matches(/^[A-Z]{2}-SBI$/, normalizedSender)
    );
  }

  // Check if this is a credit card message
  private isCreditCardMessage(sender: string, message: string): boolean {
    const upperSender = sender.toUpperCase();
    return (
      upperSender.includes('SBICRD') ||
      upperSender.includes('SBI CARDS') ||
      message.toLowerCase().includes('credit card')
    );
  }

  // Extract credit card last 4 digits
  private extractCreditCardLast4(message: string): string | null {
    // Pattern: "ending with 1234" or "ending 1234"
    const patterns = [/ending\s+with\s+(\d{4})/i, /ending\s+(\d{4})/i];
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return gv(m, 1);
      }
    }
    return null;
  }

  parse(smsBody: string, sender: string, timestamp: number): BankTxn | null {
    // Normalize Unicode text (SBI Card uses Mathematical Sans-Serif characters in RCS)
    const normalizedBody = normalizeUnicodeText(smsBody);

    const parsed = super.parse(normalizedBody, sender, timestamp);
    if (parsed == null) {
      return null;
    }

    // Handle credit card messages
    if (this.isCreditCardMessage(sender, normalizedBody)) {
      const lowerBody = normalizedBody.toLowerCase();
      // Extract credit card last 4 digits
      const cardLast4 = this.extractCreditCardLast4(normalizedBody) ?? parsed.accountLast4;

      // Extract available limit for credit card messages
      const creditLimit = this.extractAvailableLimit(normalizedBody) ?? parsed.creditLimit;

      // Determine transaction type based on message content
      let transactionType: TransactionType;
      if (lowerBody.includes('payment of') && lowerBody.includes('credited to your sbi credit card')) {
        // Payment TO credit card (reducing debt)
        transactionType = TransactionType.INCOME;
      } else if (lowerBody.includes('spent on') || lowerBody.includes('spent')) {
        // Credit card spending
        transactionType = TransactionType.CREDIT;
      } else {
        // Default for other credit card transactions
        transactionType = TransactionType.CREDIT;
      }

      // Extract merchant for credit card transactions
      const merchant = lowerBody.includes('via bbps')
        ? 'BBPS Payment'
        : this.extractCreditCardMerchant(normalizedBody) ?? parsed.merchant;

      return {
        ...parsed,
        accountLast4: cardLast4,
        type: transactionType,
        merchant: merchant ?? parsed.merchant,
        creditLimit,
        isFromCard: true,
      };
    }

    return parsed;
  }

  private extractCreditCardMerchant(message: string): string | null {
    // Pattern: "at MERCHANT on DD/MM/YY"
    const m = find(/at\s+([A-Za-z0-9\s&._-]+?)\s+on\s+\d/i, message);
    if (m) {
      const merchant = this.cleanMerchantName(gv(m, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }
    return null;
  }

  protected extractAvailableLimit(message: string): Paise | null {
    // Pattern: "available limit is Rs.1,235.00"
    const patterns = [
      /available\s+limit\s+is\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
      /Your\s+available\s+limit\s+is\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
    ];
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return toPaise(gv(m, 1));
      }
    }
    return super.extractAvailableLimit(message);
  }

  protected extractAmount(message: string): Paise | null {
    const amt = String.raw`(\d+(?:,\d{3})*(?:\.\d{2})?)`;
    const patterns: RegExp[] = [
      // Transaction number format: "transaction number 1234 for Rs.383.00"
      /transaction\s+number\s+\d+\s+for\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
      // Credit card payment: "payment of Rs.1,644.55"
      /payment\s+of\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
      // Credit card spending: "Rs.259.00 spent"
      /Rs\.?\s*([0-9,]+(?:\.\d{2})?)\s+spent/i,
      // Pattern 0: A/C debited by 20.0 (UPI format)
      /debited\s+by\s+(\d+(?:,\d{3})*(?:\.\d{1,2})?)/i,
      // Pattern 0a: A/c credited by Rs.500 (UPI format)
      /credited\s+by\s+Rs\.?\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)/i,
      // Pattern 1: Rs 500 debited
      new RegExp(String.raw`Rs\.?\s*${amt}\s+(?:has\s+been\s+)?debited`, 'i'),
      // Pattern 2: INR 500 debited
      new RegExp(String.raw`INR\s*${amt}\s+(?:has\s+been\s+)?debited`, 'i'),
      // Pattern 3: Rs 500 credited
      new RegExp(String.raw`Rs\.?\s*${amt}\s+(?:has\s+been\s+)?credited`, 'i'),
      // Pattern 4: INR 500 credited
      new RegExp(String.raw`INR\s*${amt}\s+(?:has\s+been\s+)?credited`, 'i'),
      // Pattern 5: withdrawn Rs 500
      new RegExp(String.raw`withdrawn\s+Rs\.?\s*${amt}`, 'i'),
      // Pattern 6: transferred Rs 500
      new RegExp(String.raw`transferred\s+Rs\.?\s*${amt}`, 'i'),
      // Pattern 7: UPI patterns - "paid to MERCHANT@upi Rs 500"
      new RegExp(String.raw`paid\s+to\s+[\w.-]+@[\w]+\s+Rs\.?\s*${amt}`, 'i'),
      // Pattern 8: ATM withdrawal - "ATM withdrawal of Rs 500"
      new RegExp(String.raw`ATM\s+withdrawal\s+of\s+Rs\.?\s*${amt}`, 'i'),
      // Pattern 9: YONO Cash withdrawal - "Yono Cash Rs 3000 w/d@SBI ATM"
      new RegExp(String.raw`Yono\s+Cash\s+Rs\.?\s*${amt}`, 'i'),
    ];
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return toPaise(gv(m, 1));
      }
    }

    // Fall back to base class patterns
    return super.extractAmount(message);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();

    // SBI-specific patterns
    if (lowerMessage.includes('withdrawn')) {
      return TransactionType.EXPENSE;
    }
    if (lowerMessage.includes('transferred')) {
      return TransactionType.EXPENSE;
    }
    if (lowerMessage.includes('paid to')) {
      return TransactionType.EXPENSE;
    }
    if (lowerMessage.includes('atm withdrawal')) {
      return TransactionType.EXPENSE;
    }
    if (lowerMessage.includes('by sbi debit card')) {
      return TransactionType.EXPENSE;
    }

    // Fall back to base class for common patterns
    return super.extractTransactionType(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    // Pattern for "done at <location>": "done at -string of number redacted- on"
    const doneAt = find(/done\s+at\s+([^.\n]+?)(?:\s+on\s+|$)/i, message);
    if (doneAt) {
      const location = this.cleanMerchantName(gv(doneAt, 1).trim());
      if (this.isValidMerchantName(location)) {
        return location;
      }
    }

    // Pattern 0: trf to Merchant (UPI format)
    const trf = find(/trf\s+to\s+([^.\n]+?)(?:\s+Ref|\s+ref|$)/i, message);
    if (trf) {
      const merchant = this.cleanMerchantName(gv(trf, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Pattern 0a: transfer from Sender (credit format)
    const transferFrom = find(/transfer\s+from\s+([^.\n]+?)(?:\s+Ref|\s+ref|$)/i, message);
    if (transferFrom) {
      const merchant = this.cleanMerchantName(gv(transferFrom, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Pattern 1: paid to MERCHANT@upi
    const upiMerchant = find(/paid\s+to\s+([\w.-]+)@[\w]+/i, message);
    if (upiMerchant) {
      const merchant = this.cleanMerchantName(gv(upiMerchant, 1));
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Pattern 2: YONO Cash ATM - "w/d@SBI ATM S1NW000093009"
    const yonoAtm = find(/w\/d@SBI\s+ATM\s+([A-Z0-9]+)/i, message);
    if (yonoAtm) {
      return `YONO Cash ATM - ${gv(yonoAtm, 1)}`;
    }

    // Pattern 2a: Regular ATM location
    const atm = find(/ATM\s+(?:withdrawal\s+)?(?:at\s+)?([^.\n]+?)(?:\s+on|\s+Avl)/i, message);
    if (atm) {
      const location = this.cleanMerchantName(gv(atm, 1));
      if (this.isValidMerchantName(location)) {
        return `ATM - ${location}`;
      }
    }

    // Pattern 3: NEFT/IMPS/RTGS with beneficiary
    const neft = find(/(?:NEFT|IMPS|RTGS)[^:]*:\s*([^.\n]+?)(?:\s+Ref|\s+on|$)/i, message);
    if (neft) {
      const merchant = this.cleanMerchantName(gv(neft, 1));
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
    // Pattern for debit card: "by SBI Debit Card <last4>"
    const debitCard = find(/by\s+SBI\s+Debit\s+Card\s+([\w-]+)/i, message);
    if (debitCard) {
      return this.extractLast4Digits(gv(debitCard, 1));
    }

    // Pattern 1: A/c XNNNN or A/c XXNNNN. PennyTrace: the space is optional; SBI UPI alerts
    // print "ur A/cX1234 credited".
    const p1 = find(/A\/c\s*([X*\d]+)/i, message);
    if (p1) {
      return this.extractLast4Digits(gv(p1, 1));
    }

    // Pattern 2: from A/c ending 1234
    const p2 = find(/A\/c\s+ending\s+(\d{4})/i, message);
    if (p2) {
      return gv(p2, 1);
    }

    // Pattern 3: a/c no. XX1234
    const p3 = find(/a\/c\s+no\.?\s+([X*\d]+)/i, message);
    if (p3) {
      return this.extractLast4Digits(gv(p3, 1));
    }

    return null;
  }

  protected extractBalance(message: string): Paise | null {
    const amt = String.raw`(\d+(?:,\d{3})*(?:\.\d{2})?)`;
    const patterns: RegExp[] = [
      // Updated balance: "Your updated available balance is Rs.999999999"
      new RegExp(String.raw`Your\s+updated\s+available\s+balance\s+is\s+Rs\.?\s*${amt}`, 'i'),
      // Pattern 1: Avl Bal Rs 1000.00
      new RegExp(String.raw`Avl\s+Bal\s+Rs\.?\s*${amt}`, 'i'),
      // Pattern 2: Available Balance: Rs 1000
      new RegExp(String.raw`Available\s+Balance:?\s+Rs\.?\s*${amt}`, 'i'),
      // Pattern 3: Bal: Rs 1000
      new RegExp(String.raw`Bal:?\s+Rs\.?\s*${amt}`, 'i'),
    ];
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return toPaise(gv(m, 1));
      }
    }

    // Fall back to base class
    return super.extractBalance(message);
  }

  protected extractReference(message: string): string | null {
    const patterns = [
      // Transaction number: "transaction number <alphanumeric>"
      /transaction\s+number\s+([\w-]+)/i,
      // Pattern 1: Ref No 123456789
      /Ref\s+No\.?\s*(\w+)/i,
      // Pattern 2: Txn# 123456
      /Txn#\s*(\w+)/i,
      // Pattern 3: transaction ID 123456
      /transaction\s+ID:?\s*(\w+)/i,
    ];
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return gv(m, 1);
      }
    }

    // Fall back to base class
    return super.extractReference(message);
  }

  protected isTransactionMessage(message: string): boolean {
    // Normalize Unicode first (SBI Card uses Math Sans-Serif characters)
    const normalizedMessage = normalizeUnicodeText(message);
    const lowerMessage = normalizedMessage.toLowerCase();

    // Skip e-statement notifications
    if (lowerMessage.includes('e-statement of sbi credit card')) {
      return false;
    }

    // PennyTrace: "Your NCMC Prepaid Card …5440 is loaded with Rs. 200" is a transit-card top-up.
    // The bank debit that paid for it is the spend; counting the load too would double it.
    if (/\bprepaid\s+card\b[\s\S]*\bis\s+loaded\s+with\b/.test(lowerMessage)) {
      return false;
    }

    // Skip future/pending transactions
    if (lowerMessage.includes('is due for')) {
      return false;
    }

    // Skip credit card application status messages
    if (
      lowerMessage.includes('sbi card application') ||
      lowerMessage.includes('process your app.no') ||
      lowerMessage.includes('track your application status')
    ) {
      return false;
    }

    // Skip UPI-Mandate creation notifications
    if (this.isEMandateNotification(normalizedMessage) || this.isUPIMandateNotification(normalizedMessage)) {
      return false;
    }

    // SBI Debit Card transactions
    if (lowerMessage.includes('by sbi debit card')) {
      return true;
    }

    // SBI Credit Card spending
    if (lowerMessage.includes('spent') && lowerMessage.includes('credit card')) {
      return true;
    }

    // Fall back to base class for other checks
    return super.isTransactionMessage(normalizedMessage);
  }

  // ==========================================
  // UPI-Mandate / Subscription Logic
  // ==========================================

  /**
   * Checks if this is a UPI-Mandate notification (not a transaction).
   * SBI sends specific UPI-Mandate messages for recurring payments.
   */
  isUPIMandateNotification(message: string): boolean {
    const lowerMessage = message.toLowerCase();
    return (
      lowerMessage.includes('upi-mandate') ||
      lowerMessage.includes('upi mandate') ||
      (lowerMessage.includes('mandate') && lowerMessage.includes('created') && lowerMessage.includes('upi'))
    );
  }

  /**
   * Parses UPI-Mandate subscription information from SBI messages.
   */
  parseUPIMandateSubscription(message: string): UpiMandateInfo | null {
    if (!this.isUPIMandateNotification(message) && !this.isEMandateNotification(message)) {
      return null;
    }

    // Extract amount - patterns like "Rs.1050.00", "INR 59.00"
    const amountPatterns = [/Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i, /INR\s*([0-9,]+(?:\.\d{2})?)/i];
    let amount: Paise | null = null;
    for (const pattern of amountPatterns) {
      const m = find(pattern, message);
      if (m) {
        amount = toPaise(gv(m, 1));
      }
      if (amount != null) {
        break;
      }
    }
    if (amount == null) {
      return null;
    }

    // Extract merchant
    let merchant = 'Unknown Subscription';
    const merchantPatterns = [
      /towards\s+([^.\n]+?)(?:\s+from|\s+A\/c|\s+UMRN|\s+ID:|\s+Alert:|\s*\.|$)/i,
      /for\s+([^.\n]+?)(?:\s+ID:|\s+Act:|\s*\.|$)/i,
      /mandate\s+created\s+for\s+([^.\n]+?)(?:\s+UMN|\s+of|\s*\.|$)/i,
    ];
    for (const pattern of merchantPatterns) {
      const m = find(pattern, message);
      if (m) {
        const cleaned = this.cleanMerchantName(gv(m, 1).trim());
        if (this.isValidMerchantName(cleaned)) {
          merchant = cleaned;
        }
      }
      if (merchant !== 'Unknown Subscription') {
        break;
      }
    }

    // Extract next deduction date
    const datePatterns = [/on\s+(\d{2}-\w{3}-\d{2,4})/i, /date[:\s]+(\d{2}\/\d{2}\/\d{2,4})/i, /(\d{2}-\d{2}-\d{4})/i];
    let nextDeductionDate: string | null = null;
    for (const pattern of datePatterns) {
      const m = find(pattern, message);
      if (m) {
        nextDeductionDate = gv(m, 1);
        break;
      }
    }

    // Extract UMN (Unique Mandate Number)
    const umnMatch = find(/UMN[:\s]+([^.\s]+)/i, message);
    const umn = umnMatch ? gv(umnMatch, 1) : null;

    return {
      amount,
      nextDeductionDate,
      merchant,
      umn,
      dateFormat: 'dd-MMM-yy',
      accountLast4: this.extractAccountLast4(message),
    };
  }
}
