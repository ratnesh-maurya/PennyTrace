// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `bank/FederalBankParser.kt`.
import type { Paise } from '../../types';
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { toPaise } from '../engine/patterns';
import { find, gv, matches, replaceAll, takeLast, test } from '../engine/regex';
import { TransactionType, type BankTxn, type MandateInfo } from '../engine/types';

/** Upstream `FederalBankParser.EMandateInfo`. */
export interface FederalEMandateInfo extends MandateInfo {
  dateFormat: 'dd-MM-yyyy';
}

const CORPORATE_SUFFIX = /\s+(limited|ltd|pvt\s+ltd|private\s+limited)$/i;

/**
 * Parser for Federal Bank SMS messages
 *
 * Supported formats:
 * - UPI transactions: "Rs 34.51 debited via UPI on 08-05-2025 13:48:03 to VPA ..."
 * - Card transactions
 * - ATM withdrawals
 * - NEFT/IMPS transfers
 *
 * Sender patterns: AD-FEDBNK-S, JM-FEDBNK-S, AX-FEDSMS-S, etc.
 */
export class FederalBankParser extends BaseIndianBankParser {
  readonly id = 'federal';

  getBankName(): string {
    return 'Federal Bank';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return (
      normalizedSender.includes('FEDBNK') ||
      normalizedSender.includes('FEDERAL') ||
      normalizedSender.includes('FEDFIB') ||
      normalizedSender.includes('FEDSMS') ||
      normalizedSender.includes('FEDSCP') ||
      // DLT patterns for transactions (-S suffix)
      matches(/^[A-Z]{2}-FEDBNK-S$/, normalizedSender) ||
      matches(/^[A-Z]{2}-FEDSCP-S$/, normalizedSender) ||
      // FedFiB patterns
      matches(/^[A-Z]{2}-FedFiB-[A-Z]$/, normalizedSender) ||
      // Other DLT patterns
      matches(/^[A-Z]{2}-FEDBNK-[TPG]$/, normalizedSender) ||
      // Legacy patterns
      matches(/^[A-Z]{2}-FEDBNK$/, normalizedSender)
    );
  }

  parse(smsBody: string, sender: string, timestamp: number): BankTxn | null {
    // Check for balance inquiry message first
    if (this.isBalanceInquiryMessage(smsBody)) {
      return this.parseBalanceInquiry(smsBody, sender, timestamp);
    }

    // Otherwise, use the default parsing logic
    return super.parse(smsBody, sender, timestamp);
  }

  /**
   * Detects balance inquiry messages from missed call banking
   * Format: "Your available balance for a/c no(s) SBA1234 is INR 1xxx,SBA5678 is INR 9xxx.9 ..."
   */
  private isBalanceInquiryMessage(message: string): boolean {
    return message.toLowerCase().includes('your available balance for a/c');
  }

  /** Parses balance inquiry message and extracts the balance */
  private parseBalanceInquiry(message: string, sender: string, timestamp: number): BankTxn | null {
    // Pattern: "SBA1234 is INR 1,234.56" - must be followed by comma (next account) or period (sentence end)
    // This ensures we don't match masked balances like "INR 1xxx"
    const balancePattern = /([A-Z]{2,3}\d{4})\s+is\s+INR\s+([0-9,]+(?:\.\d{1,2})?)(?=[,.]|\s+\.)/i;

    const match = find(balancePattern, message);
    if (!match) {
      return null;
    }

    const accountNumber = gv(match, 1);
    const balanceStr = gv(match, 2);

    // Additional check: reject if the balance area contains masking characters
    const balanceAreaPattern = /([A-Z]{2,3}\d{4})\s+is\s+INR\s+[0-9,x.]+/i;
    const balanceArea = find(balanceAreaPattern, message)?.[0] ?? '';
    if (balanceArea.toLowerCase().includes('x')) {
      return null;
    }

    const balance = toPaise(balanceStr);
    if (balance == null) {
      return null;
    }

    return this.txn({
      amount: 0,
      type: TransactionType.BALANCE_UPDATE,
      merchant: 'Balance Inquiry',
      reference: null,
      accountLast4: takeLast(accountNumber, 4),
      balance,
      smsBody: message,
      sender,
      timestamp,
      isFromCard: false,
      currency: 'INR',
    });
  }

  detectIsCreditCard(message: string): boolean {
    return message.toLowerCase().includes('credit card');
  }

  /** Detects if the transaction is from a card (credit/debit) based on Federal Bank specific patterns. */
  protected detectIsCard(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    // Explicit credit card patterns
    if (this.detectIsCreditCard(message)) return true;
    // Explicit debit card patterns
    if (lowerMessage.includes('debit card')) return true;
    // Card number patterns: "card XX**9747" or "card ending with 1234"
    if (lowerMessage.includes('card xx**')) return true;
    if (lowerMessage.includes('card ending with')) return true;
    // INR spent pattern (typically credit card)
    if (matches(/.*inr\s+[\d,]+(?:\.\d{2})?\s+spent.*/, lowerMessage)) return true;
    // "at <merchant> on <date>" pattern (credit card transactions)
    if (lowerMessage.includes(' spent ') && lowerMessage.includes(' at ') && lowerMessage.includes(' on ')) return true;
    // E-mandate on card patterns
    if (
      (lowerMessage.includes('e-mandate') || lowerMessage.includes('payment of')) &&
      (lowerMessage.includes('federal bank debit card') || lowerMessage.includes('federal bank credit card'))
    ) {
      return true;
    }
    // Exclude UPI / ATM / IMPS / NEFT / RTGS (not card transactions)
    return false;
  }

  protected extractAmount(message: string): Paise | null {
    const patterns = [
      // Pattern 1: ₹882.00 (rupee symbol format for Scapia card)
      /₹\s*([0-9,]+(?:\.\d{2})?)/i,
      // Pattern 2: INR 506.52 spent (credit card format)
      /INR\s+([0-9,]+(?:\.\d{2})?)\s+spent/i,
      // Pattern 3: "you've received INR 10,509.09"
      /you've received INR\s+([0-9,]+(?:\.\d{2})?)/i,
      // Pattern 4: Rs 34.51 debited via UPI
      /Rs\s+([0-9,]+(?:\.\d{2})?)\s+debited/i,
      // Pattern 5: Rs 70.00 sent via UPI
      /Rs\s+([0-9,]+(?:\.\d{2})?)\s+sent/i,
      // Pattern 6: Rs 500.00 credited
      /Rs\s+([0-9,]+(?:\.\d{2})?)\s+credited/i,
      // Pattern 7: "has received Rs 21.00 from" (outgoing transfer to company)
      /has\s+received\s+Rs\s+([0-9,]+(?:\.\d{2})?)\s+from/i,
      // Pattern 8: withdrawn Rs 500
      /withdrawn\s+Rs\s+([0-9,]+(?:\.\d{2})?)/i,
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
    const lower = message.toLowerCase();

    // Priority 0: ATM/Cash withdrawal - check early to avoid matching phone numbers
    if (lower.includes('withdrawn')) {
      return 'Cash Withdrawal';
    }

    // Priority 1: "[Company] has received Rs X from your A/c" pattern (outgoing transfers)
    // Extract the company name at the start of the message
    const hasReceived = find(/^([A-Z][A-Za-z0-9\s]+?)\s+has\s+received\s+Rs/i, message);
    if (hasReceived) {
      const merchant = this.cleanMerchantName(gv(hasReceived, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Priority 2: IMPS credits - show "IMPS Credit" instead of parsing description
    if (lower.includes('credited to your a/c') && lower.includes('via imps')) {
      return 'IMPS Credit';
    }

    // Priority 2: Card transactions - use detectIsCard to avoid duplication
    if (this.detectIsCard(message)) {
      // Credit card transactions - "at <merchant> on date" or "at <merchant> on your"
      if (lower.includes(' at ')) {
        // Pattern 1: "at <merchant> on your" (Scapia format)
        // Pattern 2: "at <merchant> on date" (traditional format)
        for (const pattern of [/at\s+([^.\n]+?)\s+on\s+your/i, /at\s+([^.\n]+?)\s+on\s+\d/i]) {
          const m = find(pattern, message);
          if (m) {
            const merchant = this.cleanMerchantName(gv(m, 1).trim());
            if (this.isValidMerchantName(merchant)) {
              const cleanedMerchant = replaceAll(merchant, CORPORATE_SUFFIX, '').trim();
              return cleanedMerchant || merchant;
            }
          }
        }
      }
    }

    // Priority 3: E-mandate transactions
    if (lower.includes('e-mandate') || lower.includes('payment of')) {
      const emandate = find(/payment of\s+[^.]+?\s+for\s+([^.\n]+?)\s+via\s+e-mandate/i, message);
      if (emandate) {
        const merchant = this.cleanMerchantName(gv(emandate, 1).trim());
        if (this.isValidMerchantName(merchant)) {
          return merchant;
        }
      }

      const emandateDeclinedPattern =
        /payment via e-mandate\s+declined\s+for\s+ID:\s*[^.]+?\s+on\s+Federal Bank\s+Debit Card\s+\d+/i;
      if (test(emandateDeclinedPattern, message)) {
        return 'E-Mandate Declined';
      }
    }

    // Priority 4: UPI transactions - "to VPA merchant@bank"
    if (lower.includes('vpa')) {
      const vpa = find(/to\s+VPA\s+([^\s]+?)(?:\.\s*Ref\s+No|\s*Ref\s+No|$)/i, message);
      if (vpa) {
        return this.parseUPIMerchant(gv(vpa, 1).trim());
      }
    }

    // Priority 5: "to <merchant name>" (general)
    const to = find(/to\s+([^.\n]+?)(?:\.\s*Ref|Ref\s+No|$)/i, message);
    if (to) {
      const merchant = gv(to, 1).trim();
      if (!merchant.toLowerCase().includes('vpa')) {
        const cleaned = this.cleanMerchantName(merchant);
        if (this.isValidMerchantName(cleaned)) {
          return cleaned;
        }
      }
    }

    // Priority 6: "you've received INR" transactions
    if (lower.includes("you've received")) {
      const sentBy = find(/It was sent by\s+([^.\n]+?)(?:\s+on|$)/i, message);
      if (sentBy) {
        const senderName = gv(sentBy, 1).trim();
        if (matches(/^0+$/, senderName) || senderName.length <= 4) {
          return 'Bank Transfer';
        }
        const merchant = this.cleanMerchantName(senderName);
        if (this.isValidMerchantName(merchant)) {
          return merchant;
        }
      }
    }

    // Priority 7: "from <sender name>"
    const from = find(/from\s+([^.\n]+?)(?:\.\s*|$)/i, message);
    if (from) {
      const merchant = this.cleanMerchantName(gv(from, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Priority 8: Cash Deposit / CDM transactions
    if (
      lower.includes('cash deposit') ||
      lower.includes('deposited') ||
      lower.includes('cdm') ||
      lower.includes('cash credited')
    ) {
      return 'Cash Deposit';
    }

    return super.extractMerchant(message, sender);
  }

  private parseUPIMerchant(vpa: string): string {
    const cleanVPA = vpa.split('@')[0].toLowerCase();
    const has = (s: string): boolean => cleanVPA.includes(s);

    // Airlines & Travel
    if (has('indigo')) return 'Indigo';
    if (has('spicejet')) return 'SpiceJet';
    if (has('airasia')) return 'AirAsia';
    if (has('vistara')) return 'Vistara';
    if (has('airindia')) return 'Air India';
    // Ride-hailing
    if (has('uber')) return 'Uber';
    if (has('ola')) return 'Ola';
    if (has('rapido')) return 'Rapido';
    // E-commerce
    if (has('amazon')) return 'Amazon';
    if (has('flipkart')) return 'Flipkart';
    if (has('myntra')) return 'Myntra';
    if (has('meesho')) return 'Meesho';
    // Payment apps
    if (has('paytm')) return 'Paytm';
    if (has('bharatpe')) return 'BharatPe';
    if (has('phonepe')) return 'PhonePe';
    if (has('googlepay') || has('gpay')) return 'Google Pay';
    // Food delivery
    if (has('swiggy')) return 'Swiggy';
    if (has('zomato')) return 'Zomato';
    // Entertainment
    if (has('netflix')) return 'Netflix';
    if (has('spotify')) return 'Spotify';
    if (has('hotstar') || has('disney')) return 'Disney+ Hotstar';
    if (has('prime')) return 'Amazon Prime';
    if (has('pvr') || has('inox')) return 'PVR Inox';
    if (has('bookmyshow') || has('bms')) return 'BookMyShow';
    // Telecom
    if (has('jio')) return 'Jio';
    if (has('airtel')) return 'Airtel';
    if (has('vodafone') || has('vi')) return 'Vi';
    if (has('bsnl')) return 'BSNL';
    // Travel
    if (has('irctc')) return 'IRCTC';
    if (has('redbus')) return 'RedBus';
    if (has('makemytrip') || has('mmt')) return 'MakeMyTrip';
    if (has('goibibo')) return 'Goibibo';
    if (has('oyo')) return 'OYO';
    if (has('airbnb')) return 'Airbnb';
    // Payment gateways
    if (has('razorpay') || has('razorp') || has('rzp')) {
      if (has('pvr')) return 'PVR';
      if (has('inox')) return 'PVR Inox';
      if (has('swiggy')) return 'Swiggy';
      if (has('zomato')) return 'Zomato';
      return 'Online Payment';
    }
    if (has('payu') || has('billdesk') || has('ccavenue')) return 'Online Payment';
    // Individual transfers
    if (matches(/\d+/, cleanVPA)) return 'Individual';
    return vpa.trim();
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    // Skip OTP and promotional messages
    if (
      lowerMessage.includes('otp') ||
      lowerMessage.includes('one time password') ||
      lowerMessage.includes('verification code')
    ) {
      return false;
    }

    // Skip mandate creation notifications and declined payments
    if (this.isMandateCreationNotification(message) || this.isDeclinedMandatePayment(message)) {
      return false;
    }

    // Skip outgoing "<beneficiary> has received Rs X from your A/c ... via NEFT ... Ref no."
    // confirmation receipts. For an outgoing NEFT/IMPS transfer, Federal Bank sends both a
    // debit SMS ("Debited Rs X ... to <name>") and this delivery-confirmation SMS carrying the
    // same reference. Parsing both double-counts the single transfer (issue #547); the debit SMS
    // already records it, so the confirmation must not create a second transaction.
    // Investment transfers (mutual fund, digital gold, etc.) are intentionally kept, since those
    // are captured via this same confirmation shape and classified as INVESTMENT.
    if (this.isOutgoingHasReceivedPattern(message) && !this.isInvestmentTransaction(lowerMessage)) {
      return false;
    }

    if (
      lowerMessage.includes('txn of') &&
      (lowerMessage.includes('rewards') || lowerMessage.includes('was successful')) &&
      !lowerMessage.includes('failed') &&
      !lowerMessage.includes('declined')
    ) {
      return true;
    }

    // Federal Bank specific transaction keywords
    const federalKeywords = [
      'sent via upi',
      'debited via upi',
      'credited',
      'withdrawn',
      'received',
      'transferred',
      'spent on your credit card',
      'credit card was successful',
      'payment of',
      'payment via e-mandate',
    ];

    if (federalKeywords.some(k => lowerMessage.includes(k))) {
      return true;
    }

    return super.isTransactionMessage(message);
  }

  protected extractAccountLast4(message: string): string | null {
    const fromSuper = super.extractAccountLast4(message);
    if (fromSuper != null) {
      return fromSuper;
    }
    // Card-specific patterns
    if (this.detectIsCard(message)) {
      const cardPatterns = [
        // Pattern 1: "credit card ending with 1234"
        /(?:credit|debit)\s+card\s+ending\s+with\s+(\d{4})/i,
        // Pattern 2: "card XX**9747"
        /card\s+XX\*\*?(\d{4})/i,
        // Pattern 3: "Federal Bank Debit Card 3456" (e-mandate format)
        /(?:Federal\s+Bank\s+)?(?:Debit|Credit)\s+Card\s+(\d{4})/i,
      ];
      for (const pattern of cardPatterns) {
        const m = find(pattern, message);
        if (m) {
          return gv(m, 1);
        }
      }
    }

    // Non-card: A/c XX4567
    const ac = find(/A\/c\s+([X*\d]+)/i, message);
    if (ac) {
      return this.extractLast4Digits(gv(ac, 1));
    }

    // Non-card: Account XXXXXXXX1896
    const account = find(/Account\s+([X*\d]+)/i, message);
    if (account) {
      return this.extractLast4Digits(gv(account, 1));
    }

    return null;
  }

  protected extractReference(message: string): string | null {
    const ref = super.extractReference(message);
    return ref != null && /\d/.test(ref) ? ref : null;
  }

  protected extractBalance(message: string): Paise | null {
    // Don't extract credit limit as balance
    return super.extractBalance(message);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();

    // "[Company] has received Rs X from your A/c" - outgoing transfer (EXPENSE or INVESTMENT)
    if (this.isOutgoingHasReceivedPattern(message)) {
      // Check if it's an investment (mutual fund, gold, etc.)
      return this.isInvestmentTransaction(lowerMessage) ? TransactionType.INVESTMENT : TransactionType.EXPENSE;
    }

    // Credit card bill payment - "received your payment towards credit card"
    if (lowerMessage.includes('received your payment') && lowerMessage.includes('credit card')) {
      return TransactionType.TRANSFER;
    }

    // Credit card transactions - now using detectIsCard
    if (
      this.detectIsCreditCard(message) &&
      (lowerMessage.includes('spent') || lowerMessage.includes('was successful') || lowerMessage.includes('txn of'))
    ) {
      return TransactionType.CREDIT;
    }

    // E-mandate payments (only successful ones)
    if (
      (lowerMessage.includes('e-mandate') || lowerMessage.includes('payment of')) &&
      lowerMessage.includes('processed successfully')
    ) {
      return TransactionType.EXPENSE;
    }

    // Expense keywords
    if (lowerMessage.includes('sent via upi')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('debited')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('withdrawn')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('spent') && !this.detectIsCreditCard(message)) return TransactionType.EXPENSE;
    if (lowerMessage.includes('paid')) return TransactionType.EXPENSE;

    // Income keywords
    if (lowerMessage.includes('credited')) return TransactionType.INCOME;
    if (lowerMessage.includes('received')) return TransactionType.INCOME;
    if (lowerMessage.includes('deposited')) return TransactionType.INCOME;
    if (lowerMessage.includes('refund')) return TransactionType.INCOME;

    return super.extractTransactionType(message);
  }

  /**
   * Detects "[Company] has received Rs X from your A/c" pattern
   * This indicates money going OUT of the user's account to a company
   */
  private isOutgoingHasReceivedPattern(message: string): boolean {
    return test(/has\s+received\s+Rs\s+[\d,.]+\s+from\s+your\s+A\/c/i, message);
  }

  isMandateCreationNotification(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    return (
      (lowerMessage.includes('mandate') || lowerMessage.includes('e-mandate')) &&
      (lowerMessage.includes('successfully created a mandate') ||
        lowerMessage.includes('you have successfully created') ||
        lowerMessage.includes('successfully created') ||
        lowerMessage.includes('has been initiated') ||
        lowerMessage.includes('registration has been initiated'))
    );
  }

  isDeclinedMandatePayment(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    return (
      (lowerMessage.includes('e-mandate') || lowerMessage.includes('payment of')) && lowerMessage.includes('declined')
    );
  }

  parseEMandateSubscription(message: string): FederalEMandateInfo | null {
    if (!this.isMandateCreationNotification(message)) {
      return null;
    }

    const amountMatch = find(/(?:for\s+a\s+)?maximum\s+amount\s+of\s+Rs\.?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/i, message);
    const amount = amountMatch ? toPaise(gv(amountMatch, 1)) : null;
    if (amount == null) {
      return null;
    }

    const startDate = gv(find(/starting\s+from\s+(\d{2}-\d{2}-\d{4})/i, message), 1) || null;

    const merchantMatch = find(/(?:created\s+a\s+mandate\s+on|mandate\s+on)\s+([^.\n]+?)(?:\s+for|\s*$)/i, message);
    const merchant = merchantMatch ? this.cleanMerchantName(gv(merchantMatch, 1).trim()) : 'Unknown Subscription';

    const umn = gv(find(/Mandate\s+Ref\s+No-?\s*([^.\s]+)/i, message), 1) || null;

    return {
      amount,
      nextDeductionDate: startDate,
      merchant,
      umn,
      dateFormat: 'dd-MM-yyyy',
      accountLast4: null,
    };
  }

  parseFutureDebit(message: string): FederalEMandateInfo | null {
    const lowerMessage = message.toLowerCase();

    if (!lowerMessage.includes('payment due') || !lowerMessage.includes('will be processed')) {
      return null;
    }

    const amountMatch = find(/INR\s+(\d+(?:,\d{3})*(?:\.\d{2})?)/i, message);
    const amount = amountMatch ? toPaise(gv(amountMatch, 1)) : null;
    if (amount == null) {
      return null;
    }

    const dateMatch = find(/on\s+(\d{2}\/\d{2}\/\d{4})/i, message);
    let dueDate: string | null = null;
    if (dateMatch) {
      const dateStr = gv(dateMatch, 1);
      const parts = dateStr.split('/');
      dueDate = parts.length === 3 ? `${parts[0]}/${parts[1]}/${takeLast(parts[2], 2)}` : dateStr;
    }

    const merchantMatch = find(/for\s+([^.\n]+?)\s*,\s*INR/i, message);
    const merchant = merchantMatch ? this.cleanMerchantName(gv(merchantMatch, 1).trim()) : 'Unknown Subscription';

    return {
      amount,
      nextDeductionDate: dueDate,
      merchant,
      umn: null,
      dateFormat: 'dd-MM-yyyy',
      accountLast4: null,
    };
  }

  isTransactionMessageForTesting(message: string): boolean {
    return this.isTransactionMessage(message);
  }
}
