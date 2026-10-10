// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `bank/HDFCBankParser.kt`.
import type { Paise } from '../../types';
import { isNonTransactionMessage } from '../engine/BankParser';
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { HDFC, toPaise } from '../engine/patterns';
import { allDigits, find, gv, matches, test } from '../engine/regex';
import { TransactionType, type BankTxn, type MandateInfo } from '../engine/types';

/** Upstream `HDFCBankParser.EMandateInfo`. */
export interface HdfcEMandateInfo extends MandateInfo {
  dateFormat: 'dd/MM/yy';
}

const HDFC_SENDERS = new Set(['HDFCBK', 'HDFCBANK', 'HDFC', 'HDFCB']);

const TRANSACTION_KEYWORDS = [
  'debited',
  'credited',
  'withdrawn',
  'deposited',
  'spent',
  'received',
  'transferred',
  'paid',
  'sent', // "Sent Rs.X From HDFC Bank"
  'deducted', // "deducted from" pattern
  'txn', // "Txn Rs.X" for card transactions
  'used on', // PIXEL credit card: "Rs X used on HDFC Bank PIXEL Card at M on ..."
  'refund', // "Refund initiated: Amt: Rs.X on HDFC Bank Credit Card ####"
  'reversed', // "Transaction Reversed!On HDFC Bank CREDIT Card ####"
  'reversal',
  'payment successful',
];

/** "Payment of Rs X received towards your credit card …" / "… was credited to your card ending 2312". */
function isCardPaymentConfirmation(message: string): boolean {
  return /\bpayment\s+of\b[\s\S]*?\b(?:received\s+towards\s+your\s+credit\s+card|credited\s+to\s+your\s+(?:credit\s+)?card\s+ending)\b/i.test(
    message,
  );
}

/** Index of the first case-insensitive occurrence of `needle`, or -1. */
function indexOfIgnoreCase(haystack: string, needle: string): number {
  const m = find(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), haystack);
  return m ? m.index : -1;
}

/**
 * HDFC Bank parser.
 *
 * Handles standard debit/credit messages, UPI with VPA details, salary credits with company
 * names, e-mandate notifications and card transactions (BLOCK CC / PCC / DC markers).
 */
export class HdfcBankParser extends BaseIndianBankParser {
  readonly id = 'hdfc';

  getBankName(): string {
    return 'HDFC Bank';
  }

  parse(smsBody: string, sender: string, timestamp: number): BankTxn | null {
    const txn = super.parse(smsBody, sender, timestamp);
    // The base parser reads the available limit only for card spends; a card payment prints it too.
    if (txn && txn.creditLimit == null && isCardPaymentConfirmation(smsBody)) {
      const limit = find(/available\s+limit\s+is\s+(?:Rs\.?|INR)\s*([0-9,]+(?:\.\d{1,2})?)/i, smsBody);
      if (limit) {
        return { ...txn, creditLimit: toPaise(gv(limit, 1)), isFromCard: true };
      }
      return { ...txn, isFromCard: true };
    }
    return txn;
  }

  canHandle(sender: string): boolean {
    const upperSender = sender.toUpperCase();
    if (HDFC_SENDERS.has(upperSender)) {
      return true;
    }
    return HDFC.DLT_PATTERNS.some(p => matches(p, upperSender));
  }

  protected extractMerchant(message: string, sender: string): string | null {
    const lower = message.toLowerCase();

    // Reversal/refund: "... By AMAZON        000 On 2026-08-21:..." — HDFC right-pads the
    // merchant name with spaces before a trailing code.
    if (lower.includes('reversed') || lower.includes('reversal')) {
      const m = find(/\bBy\s+(.+?)(?:\s{2,}|\s+On\s)/i, message);
      if (m) {
        const merchant = this.cleanMerchantName(gv(m, 1).trim());
        if (merchant.length > 0) {
          return merchant;
        }
      }
    }

    // "Spent Rs.xxx From HDFC Bank Card xxxx At [MERCHANT] On xxx".
    if (lower.includes('from hdfc bank card') && lower.includes(' at ') && lower.includes(' on ')) {
      const atIndex = indexOfIgnoreCase(message, ' At ');
      const onIndex = indexOfIgnoreCase(message, ' On ');
      if (atIndex !== -1 && onIndex !== -1 && onIndex > atIndex) {
        const merchant = message.substring(atIndex + 4, onIndex).trim();
        if (merchant.length > 0) {
          return this.cleanMerchantName(merchant);
        }
      }
    }

    // "Txn Rs.X On HDFC Bank Card At [MERCHANT] by UPI".
    if (lower.includes('txn') && lower.includes('at ') && lower.includes('card')) {
      const m = find(/At\s+(.+?)\s*(?:by\s+UPI|on\s+\d|$)/is, message);
      if (m) {
        const merchant = gv(m, 1).trim();
        if (merchant.length > 0) {
          return this.cleanMerchantName(merchant);
        }
      }
    }

    // ATM withdrawals: extract the location.
    if (lower.includes('withdrawn')) {
      // "At +18 Random Location" or "At ATM Location On".
      const m = find(/At\s+\+?([^O]+?)\s+On/i, message);
      if (m) {
        const location = gv(m, 1).trim();
        return location.length > 0 ? `ATM at ${this.cleanMerchantName(location)}` : 'ATM';
      }
      return 'ATM';
    }

    // Generic ATM mention (without "withdrawn").
    if (lower.includes('atm')) {
      return 'ATM';
    }

    // Credit card transactions (with BLOCK CC/PCC instruction): merchant after "At".
    if (
      lower.includes('card') &&
      lower.includes(' at ') &&
      (lower.includes('block cc') || lower.includes('block pcc'))
    ) {
      const m = find(/at\s+([^@\s]+(?:@[^\s]+)?(?:\s+[^\s]+)?)(?:\s+by\s+|\s+on\s+|$)/i, message);
      if (m) {
        const merchant = gv(m, 1).trim();
        let cleaned = merchant;
        if (merchant.includes('@')) {
          // UPI VPA: "paytmqr@paytm" -> "paytm".
          const vpaName = merchant.split('@')[0].trim();
          cleaned = vpaName.toLowerCase().endsWith('qr') ? vpaName.slice(0, -2) : vpaName;
        }
        if (cleaned.length > 0) {
          return this.cleanMerchantName(cleaned);
        }
      }
    }

    if (lower.includes('netbanking')) {
      const m = find(/to\s+(.+?)\s+via\s+HDFC\s+Bank\s+NetBanking/i, message);
      if (m) {
        const merchant = this.cleanMerchantName(gv(m, 1).trim());
        if (merchant.length > 0) {
          return merchant;
        }
      }
    }

    // Pattern 0: NEFT/RTGS credit - "for NEFT Cr-IFSCCODE-COMPANY NAME-BENEFICIARY-REF".
    if (lower.includes('neft') || lower.includes('rtgs')) {
      const m = find(/(?:NEFT|RTGS)\s+Cr-[A-Z]{4}0[A-Z0-9]{6}-([^-]+)/i, message);
      if (m) {
        const merchant = gv(m, 1).trim();
        if (merchant.length > 0 && !allDigits(merchant)) {
          return this.cleanMerchantName(merchant);
        }
      }
    }

    // Pattern 1: Salary credit - "for XXXXX-ABC-XYZ MONTH SALARY-COMPANY NAME".
    if (lower.includes('salary') && lower.includes('deposited')) {
      const salary = find(HDFC.SALARY_PATTERN, message);
      if (salary) {
        return this.cleanMerchantName(gv(salary, 1).trim());
      }
      const simple = find(HDFC.SIMPLE_SALARY_PATTERN, message);
      if (simple) {
        const merchant = gv(simple, 1).trim();
        if (merchant.length > 0 && !allDigits(merchant)) {
          return this.cleanMerchantName(merchant);
        }
      }
    }

    // Pattern 2: "Info: UPI/merchant/category".
    if (lower.includes('info:')) {
      const m = find(HDFC.INFO_PATTERN, message);
      if (m) {
        const merchant = gv(m, 1).trim();
        if (merchant.length > 0 && merchant.toLowerCase() !== 'upi') {
          return this.cleanMerchantName(merchant);
        }
      }
    }

    // Pattern 3: "VPA merchant@bank (Merchant Name)".
    if (lower.includes('vpa')) {
      // UPI credit: "from VPA username@provider (UPI reference)".
      if (lower.includes('from vpa') && lower.includes('credited')) {
        const m = find(/from\s+VPA\s*([^@\s]+)@[^\s]+\s*\(UPI\s+\d+\)/i, message);
        if (m) {
          const vpaUsername = gv(m, 1).trim();
          if (vpaUsername.length > 0) {
            return this.cleanMerchantName(vpaUsername);
          }
        }
      }
      // Name in parentheses first, but not "(UPI Ref No ...)": that is the reference, not a name.
      // PennyTrace fix: upstream returned "UPI" for "to VPA swiggy@icici (UPI Ref No 4281...)".
      const named = find(HDFC.VPA_WITH_NAME, message);
      if (named && !/^(?:UPI|Ref)\b/i.test(gv(named, 1).trim())) {
        return this.cleanMerchantName(gv(named, 1).trim());
      }
      // Then the VPA username part.
      const vpa = find(HDFC.VPA_PATTERN, message);
      if (vpa) {
        const vpaName = gv(vpa, 1).trim();
        if (vpaName.length > 3 && !allDigits(vpaName)) {
          return this.cleanMerchantName(vpaName);
        }
      }
    }

    // Pattern 4: "spent on Card XX1234 at merchant on date".
    if (lower.includes('spent on card')) {
      const m = find(HDFC.SPENT_PATTERN, message);
      if (m) {
        return this.cleanMerchantName(gv(m, 1).trim());
      }
    }

    // Pattern 5: "debited for merchant on date".
    if (lower.includes('debited for')) {
      const m = find(HDFC.DEBIT_FOR_PATTERN, message);
      if (m) {
        return this.cleanMerchantName(gv(m, 1).trim());
      }
    }

    // Pattern 6: "To merchant name" (UPI mandate).
    if (lower.includes('upi mandate')) {
      const m = find(HDFC.MANDATE_PATTERN, message);
      if (m) {
        return this.cleanMerchantName(gv(m, 1).trim());
      }
    }

    // Pattern 7: "towards [Merchant Name]" (payment alerts).
    if (lower.includes('towards')) {
      const m = find(/towards\s+([^\n]+?)(?:\s+UMRN|\s+ID:|\s+Alert:|$)/i, message);
      if (m) {
        const merchant = gv(m, 1).trim();
        if (merchant.length > 0) {
          return this.cleanMerchantName(merchant);
        }
      }
    }

    // Pattern 8: "For: [Description]" (payment alerts).
    if (lower.includes('for:')) {
      const m = find(/For:\s+([^\n]+?)(?:\s+From|\s+Via|$)/i, message);
      if (m) {
        const merchant = gv(m, 1).trim();
        if (merchant.length > 0) {
          return this.cleanMerchantName(merchant);
        }
      }
    }

    // Pattern 9: "for [Merchant Name]" (future debit notifications).
    if (lower.includes('for ') && lower.includes('will be debited')) {
      const m = find(/for\s+([^\n]+?)(?:\s+mandate|\s+will\s+be|\s+ID:|\s+Act:|$)/i, message);
      if (m) {
        const merchant = gv(m, 1).trim();
        if (merchant.length > 0) {
          return this.cleanMerchantName(merchant);
        }
      }
    }

    return super.extractMerchant(message, sender);
  }

  // The BLOCK instruction names the card type, so it marks a card even when the body only says
  // "used on HDFC Bank PIXEL Card" (no "credit card" wording).
  protected detectIsCard(message: string): boolean {
    return test(/\bblock\s?(?:p?cc|dc)\b/i, message) || super.detectIsCard(message);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lower = message.toLowerCase();

    if (isCardPaymentConfirmation(message)) {
      return TransactionType.INCOME;
    }

    if (this.isInvestmentTransaction(lower)) {
      return TransactionType.INVESTMENT;
    }

    // Reversals return money to the account (on a credit card they pay down the balance), so
    // classify them before the debit/expense keywords below.
    if (lower.includes('reversed') || lower.includes('reversal')) return TransactionType.INCOME;

    // Any transaction with BLOCK CC or BLOCK PCC is a credit card transaction. The space is
    // optional: PIXEL cards write "SMS BLOCKPCC 1234".
    if (test(/\bblock\s?p?cc\b/, lower)) return TransactionType.CREDIT;

    // "INR X deposited in HDFC Bank A/c ... for Interest paid till ..." is money in. Checked
    // before the expense keywords: the narration's "paid" would make it an expense.
    if (lower.includes('deposited in')) return TransactionType.INCOME;

    // Legacy format that explicitly says "spent on card".
    if (lower.includes('spent on card') && !lower.includes('block dc')) return TransactionType.CREDIT;

    // Credit card bill payments (regular expenses from the bank account).
    if (lower.includes('payment') && lower.includes('credit card')) return TransactionType.EXPENSE;
    if (lower.includes('towards') && lower.includes('credit card')) return TransactionType.EXPENSE;

    if (lower.includes('payment successful')) return TransactionType.EXPENSE;

    // "Sent Rs.X From HDFC Bank".
    if (lower.includes('sent') && lower.includes('from hdfc')) return TransactionType.EXPENSE;

    // "Spent Rs.X From HDFC Bank Card" (debit card transactions).
    if (lower.includes('spent') && lower.includes('from hdfc bank card')) return TransactionType.EXPENSE;

    if (lower.includes('debited')) return TransactionType.EXPENSE;
    if (lower.includes('withdrawn') && !lower.includes('block cc')) return TransactionType.EXPENSE;
    if (lower.includes('spent') && !lower.includes('card')) return TransactionType.EXPENSE;
    if (lower.includes('charged')) return TransactionType.EXPENSE;
    if (lower.includes('paid')) return TransactionType.EXPENSE;
    if (lower.includes('purchase')) return TransactionType.EXPENSE;

    if (lower.includes('credited')) return TransactionType.INCOME;
    if (lower.includes('deposited')) return TransactionType.INCOME;
    if (lower.includes('received')) return TransactionType.INCOME;
    if (lower.includes('refund')) return TransactionType.INCOME;
    if (lower.includes('cashback') && !lower.includes('earn cashback')) return TransactionType.INCOME;

    return null;
  }

  protected extractReference(message: string): string | null {
    for (const pattern of [HDFC.REF_SIMPLE, HDFC.UPI_REF_NO, HDFC.REF_NO, HDFC.REF_END]) {
      const m = find(pattern, message);
      if (m) {
        return gv(m, 1).trim();
      }
    }
    return super.extractReference(message);
  }

  protected extractAccountLast4(message: string): string | null {
    const base = super.extractAccountLast4(message);
    if (base != null) {
      return base;
    }
    // "Card x####" in withdrawals: already exactly 4 digits.
    const card = find(/Card\s+x(\d{4})/i, message);
    if (card) {
      return gv(card, 1);
    }
    // "HDFC Bank Credit Card ####" / "HDFC Bank Debit Card ####" (refund SMS, no `x` mask). The
    // trailing \b stops us from grabbing the first 4 of a longer digit run.
    const plainCard = find(/HDFC\s+Bank\s+(?:Credit|Debit)\s+Card\s+(\d{4})\b/i, message);
    if (plainCard) {
      return gv(plainCard, 1);
    }
    // "BLOCK DC ####" / "BLOCK CC ####" / "BLOCKPCC ####": the card's last 4.
    const block = find(/BLOCK\s*(?:DC|P?CC)\s+(\d{4})\b/i, message);
    if (block) {
      return gv(block, 1);
    }
    // "HDFC Bank XXNNNN": require the mask prefix, cap the digits.
    const bank = find(/HDFC\s+Bank\s+([X*]+\d{3,6})/i, message);
    if (bank) {
      return this.extractLast4Digits(gv(bank, 1));
    }
    for (const pattern of [HDFC.ACCOUNT_DEPOSITED, HDFC.ACCOUNT_FROM, HDFC.ACCOUNT_SIMPLE, HDFC.ACCOUNT_GENERIC]) {
      const m = find(pattern, message);
      if (m) {
        return this.extractLast4Digits(gv(m, 1));
      }
    }
    return null;
  }

  protected extractBalance(message: string): Paise | null {
    // "Avl bal:INR NNNN.NN", "Available Balance: INR NNNN.NN", "Bal Rs.NNNN.NN".
    const patterns = [
      /Avl\s+bal:?\s*INR\s*([0-9,]+(?:\.\d{2})?)/i,
      /Available\s+Balance:?\s*INR\s*([0-9,]+(?:\.\d{2})?)/i,
      /Bal\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
    ];
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return toPaise(gv(m, 1));
      }
    }
    return super.extractBalance(message);
  }

  protected isTransactionMessage(message: string): boolean {
    // E-mandate and future-debit notices are subscription alerts, not transactions.
    if (this.isEMandateNotification(message)) {
      return false;
    }
    if (this.isFutureDebitNotification(message)) {
      return false;
    }

    const lower = message.toLowerCase();

    // NACH mandate processing notifications are not actual transactions.
    if (lower.includes('nach mandate') && lower.includes('received') && lower.includes('for processing')) {
      return false;
    }

    // Bill alerts are reminders for future payments: "New Bill Alert: Your ... Bill ... is due on".
    if (lower.includes('bill alert') || (lower.includes('bill') && lower.includes('is due on'))) {
      return false;
    }

    // Payment alerts are current transactions, unless they announce a future one.
    if (lower.includes('payment alert') && !lower.includes('will be')) {
      return true;
    }

    // Payment requests.
    if (
      lower.includes('has requested') ||
      lower.includes('payment request') ||
      lower.includes('to pay, download') ||
      lower.includes('collect request') ||
      lower.includes('ignore if already paid')
    ) {
      return false;
    }

    // PennyTrace: credit-card payment confirmations ("PAYMENT OF Rs. 4515.00 RECEIVED TOWARDS
    // YOUR CREDIT CARD ENDING WITH 2312 … YOUR AVAILABLE LIMIT IS RS. 52000.00", "Online Payment
    // of Rs.7316 … was credited to your card ending 2312") are kept: they are the card side of a
    // bill payment (the ledger pairs them with the bank debit as a liability settlement), and the
    // only alerts that print the card's available limit. Upstream dropped them.
    if (isCardPaymentConfirmation(message)) {
      return true;
    }
    // PennyTrace: "Payment of Rs X was credited to your Debit Card EMI Loan 4516" confirms a loan
    // repayment whose debit was already alerted from the savings account.
    if (/\bpayment\b[\s\S]*\bcredited\s+to\s+your\s+[\w\s]*\bloan\b/i.test(message)) {
      return false;
    }

    // Shared skip-list (OTP, promos, payment requests, reminders, IPO blocking, e-vouchers).
    if (isNonTransactionMessage(message)) {
      return false;
    }

    return TRANSACTION_KEYWORDS.some(k => lower.includes(k));
  }

  // ==========================================
  // E-Mandate / Subscription logic
  // ==========================================

  /** Parses E-Mandate subscription information from an HDFC message. */
  parseEMandateSubscription(message: string): HdfcEMandateInfo | null {
    if (!this.isEMandateNotification(message)) {
      return null;
    }

    const amount = this.mandateAmount(message);
    if (amount == null) {
      return null;
    }

    const merchant = this.mandateMerchant(message, [
      /towards\s+([^.\n]+?)(?:\s+from|\s+A\/c|\s+UMRN|\s+ID:|\s+Alert:|\s*\.|$)/i,
      /for\s+([^.\n]+?)(?:\s+mandate|\s+will\s+be|\s+ID:|\s+Act:|\s*\.|$)/i,
      /Info:\s*([^.\n]+?)(?:\s*$)/i,
      /To\s+([^.\n]+?)(?:\s+UPI|,|$)/i,
    ]);

    const nextDeductionDate = this.firstGroup(message, [
      /on\s+(\d{2}-\w{3}-\d{2,4})/i,
      /date[:\s]+(\d{2}\/\d{2}\/\d{2,4})/i,
      /(\d{2}-\d{2}-\d{4})/i,
      /(\d{2}\/\d{2}\/\d{2,4})/i,
    ]);

    const umn = this.firstGroup(message, [/UMN[:\s]+([^.\s]+)/i, /UMRN[:\s]+([^.\s]+)/i]);

    return {
      amount,
      nextDeductionDate,
      merchant,
      umn,
      accountLast4: this.extractAccountLast4(message),
      dateFormat: 'dd/MM/yy',
    };
  }

  /** Parses a future-debit notification (an alert for an upcoming subscription charge). */
  parseFutureDebit(message: string): HdfcEMandateInfo | null {
    if (!this.isFutureDebitNotification(message)) {
      return null;
    }

    const amount = this.mandateAmount(message);
    if (amount == null) {
      return null;
    }

    const merchant = this.mandateMerchant(message, [
      /for\s+([^.\n]+?)(?:\s+mandate|\s+will\s+be|\s+ID:|\s+Act:|\s*\.|$)/i,
      /towards\s+([^.\n]+?)(?:\s+from|\s+A\/c|\s+UMRN|\s+ID:|\s*\.|$)/i,
    ]);

    const nextDeductionDate = this.firstGroup(message, [
      /on\s+(\d{2}-\w{3}-\d{2,4})/i,
      /on\s+(\d{2}\/\d{2}\/\d{2,4})/i,
      /(\d{2}-\d{2}-\d{4})/i,
    ]);

    return {
      amount,
      nextDeductionDate,
      merchant,
      umn: null,
      accountLast4: this.extractAccountLast4(message),
      dateFormat: 'dd/MM/yy',
    };
  }

  private mandateAmount(message: string): Paise | null {
    for (const pattern of [/Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i, /INR\s*([0-9,]+(?:\.\d{2})?)/i]) {
      const m = find(pattern, message);
      if (m) {
        const amount = toPaise(gv(m, 1));
        if (amount != null) {
          return amount;
        }
      }
    }
    return null;
  }

  private mandateMerchant(message: string, patterns: RegExp[]): string {
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        const merchant = this.cleanMerchantName(gv(m, 1).trim());
        if (this.isValidMerchantName(merchant) && merchant.length > 2) {
          return merchant;
        }
      }
    }
    return 'Unknown Subscription';
  }

  private firstGroup(message: string, patterns: RegExp[]): string | null {
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return gv(m, 1);
      }
    }
    return null;
  }
}
