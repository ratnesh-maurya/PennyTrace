// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `bank/KotakBankParser.kt`.
import type { Paise } from '../../types';
import { BankParser, isNonTransactionMessage } from '../engine/BankParser';
import { toPaise } from '../engine/patterns';
import { allDigits, find, gv, hasLetter, matches } from '../engine/regex';
import { TransactionType } from '../engine/types';

const GENERATED_ID_PREFIXES = [
  'paytmqr',
  'phonepeqr',
  'phonepe.qr',
  'gpay',
  'amazonpayqr',
  'bhimqr',
  'bharatpeqr',
  'freechargeqr',
  'mobikwikqr',
];

const BANK_CODE_NAMES: Record<string, string> = {
  okaxis: 'Axis Bank',
  okbizaxis: 'Axis Bank Business',
  okhdfcbank: 'HDFC Bank',
  okicici: 'ICICI Bank',
  oksbi: 'State Bank of India',
  paytm: 'Paytm',
  ybl: 'PhonePe',
  amazonpay: 'Amazon Pay',
  googlepay: 'Google Pay',
  airtel: 'Airtel Money',
  freecharge: 'Freecharge',
  mobikwik: 'MobiKwik',
  jupiteraxis: 'Jupiter',
  razorpay: 'Razorpay',
  bharatpe: 'BharatPe',
};

const TRANSACTION_KEYWORDS = [
  'sent',
  'debited',
  'credited',
  'withdrawn',
  'deposited',
  'spent',
  'received',
  'transferred',
  'paid',
  // Credit-card refund: "INR X from <Merchant> refunded to your Kotak Credit Card ...".
  'refund',
];

/**
 * Kotak Bank parser.
 *
 * Handles UPI "Sent Rs.X from Kotak Bank AC XXXX to merchant@bank on ...", NEFT/IMPS credits,
 * debit/credit messages and credit-card spends (identified by "Avl limit").
 */
export class KotakBankParser extends BankParser {
  readonly id = 'kotak';

  getBankName(): string {
    return 'Kotak Bank';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    // DLT patterns — covers KOTAKB, KOTAKD and similar variants.
    if (matches(/^[A-Z]{2}-KOTAK[A-Z]-[ST]$/, normalizedSender)) {
      return true;
    }
    // RCS senders arrive with a decoded display name ("Kotak", "Kotak811"), not the DLT header.
    return normalizedSender.includes('KOTAK');
  }

  protected extractMerchant(message: string, sender: string): string | null {
    // Credit-card refund: "INR <amt> from <Merchant> refunded to your Kotak Credit Card xNNNN".
    // Without this the generic TO pattern would grab "your Kotak Credit Card xNNNN".
    const refundMatch = find(/(?:INR|Rs\.?|₹)\s*[0-9,]+(?:\.\d{2})?\s+from\s+(.+?)\s+refunded\b/i, message);
    if (refundMatch) {
      const merchant = this.cleanMerchantName(gv(refundMatch, 1).trim());
      if (merchant.length > 0) {
        return merchant;
      }
    }

    // NEFT credit: "... via NEFT from beneficiary <Name>. UTR Ref. <utr>". Stop at the trailer
    // clause rather than the first period: names carry their own ("Mr. John Doe").
    const neftMatch = find(
      /via\s+NEFT\s+from\s+(?:beneficiary\s+)?(.+?)\s*(?:\.\s*(?:UTR|Ref|Avl|Bal|Not|Call|Info)\b|\.?\s*$)/i,
      message,
    );
    if (neftMatch) {
      const merchant = this.cleanMerchantName(gv(neftMatch, 1).trim());
      if (merchant.length > 0) {
        return merchant;
      }
    }

    // IMPS credit from mobile: "linked to mobile xNNNN".
    const mobileMatch = find(/linked\s+to\s+mobile\s+([xX*]+\d{2,})/i, message);
    if (mobileMatch) {
      return gv(mobileMatch, 1);
    }

    // Credit card: "on DD-MON-YYYY at MERCHANT. Avl limit".
    const cardMatch = find(/on\s+\d{1,2}-\w{3}-\d{2,4}\s+at\s+([^.]+?)(?:\.|\s+Avl|$)/i, message);
    if (cardMatch) {
      const merchant = this.cleanKotakCardMerchant(gv(cardMatch, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // "Sent Rs.X from Kotak Bank AC XXXX to merchant@bank on ..." / "... from merchant@bank on".
    const upiMatch = find(/to\s+([^\s]+@[^\s]+)\s+on/i, message) ?? find(/from\s+([^\s]+@[^\s]+)\s+on/i, message);
    if (upiMatch) {
      const merchantName = this.merchantFromUpiId(gv(upiMatch, 1).trim());
      if (merchantName != null) {
        return merchantName;
      }
    }

    return super.extractMerchant(message, sender);
  }

  private merchantFromUpiId(upiId: string): string | null {
    // "upiXXX@bank": drop the "upi" prefix.
    if (upiId.toLowerCase().startsWith('upi')) {
      const name = upiId.substring(3).split('@')[0];
      return name.length > 0 ? this.cleanMerchantName(name) : null;
    }

    const at = upiId.indexOf('@');
    const name = at >= 0 ? upiId.substring(0, at) : upiId;
    const bankCode = at >= 0 ? upiId.substring(at + 1) : upiId;

    // Generated payment-app QR ids: the domain says more than the random handle.
    if (this.isPaymentAppGeneratedId(name)) {
      return this.merchantFromBankCode(bankCode) ?? this.cleanMerchantName(name);
    }
    // Meaningful ids (not purely digits, or digits with separators).
    if (name.length > 0 && (!allDigits(name) || name.includes('-') || name.includes('_'))) {
      if (/^[\d\-_]+$/.test(name)) {
        return this.merchantFromBankCode(bankCode) ?? name;
      }
      return this.cleanMerchantName(name);
    }
    // Pure phone numbers: show WHO the user paid, not which app.
    if (name.length > 0 && allDigits(name)) {
      return name;
    }
    return null;
  }

  /** "UPI-<ref>-<MERCHANT>" → "<MERCHANT>". */
  private cleanKotakCardMerchant(rawMerchant: string): string {
    const m = find(/^UPI-\d+-(.+)$/i, rawMerchant);
    if (m) {
      return this.cleanMerchantName(gv(m, 1).trim());
    }
    return this.cleanMerchantName(rawMerchant);
  }

  /** True for QR-style ids ("paytmqr288...") and long random alphanumerics. */
  private isPaymentAppGeneratedId(name: string): boolean {
    const lowerName = name.toLowerCase();
    if (GENERATED_ID_PREFIXES.some(p => lowerName.startsWith(p))) {
      return true;
    }
    return name.length > 20 && hasLetter(name) && /\d/.test(name);
  }

  private merchantFromBankCode(bankCode: string): string | null {
    return BANK_CODE_NAMES[bankCode.toLowerCase()] ?? null;
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lower = message.toLowerCase();

    // "Avl limit" indicates credit-card usage.
    if (lower.includes('avl limit') || lower.includes('avl lmt')) {
      return TransactionType.CREDIT;
    }
    if (lower.includes('credit card') && (lower.includes('spent') || lower.includes('debited'))) {
      return TransactionType.CREDIT;
    }

    // Anchored on "sent rs" so unrelated uses of "sent" ("...has been sent to your A/c...")
    // are not misclassified as expense before the income branches run.
    if (lower.includes('sent rs')) return TransactionType.EXPENSE;

    if (lower.includes('debited')) return TransactionType.EXPENSE;
    if (lower.includes('withdrawn')) return TransactionType.EXPENSE;
    if (lower.includes('spent')) return TransactionType.EXPENSE;
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
    // "UPI Ref 123..." and the short-SMS "UPI ref no. 648604626824".
    for (const pattern of [/UPI\s+Ref\s+([0-9]+)/i, /UPI\s+ref\s+no\.?\s+([0-9]+)/i]) {
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
    // "Credit Card x5236" / "Credit Card XX5236".
    const card = find(/Credit\s+Card\s+[xX*]*(\d{4})/i, message);
    if (card) {
      return gv(card, 1);
    }
    // "AC X0000" / "AC XXXX0000".
    const account = find(/AC\s+[X*]*([0-9]{4})(?:\s|,|\.)/i, message);
    if (account) {
      return gv(account, 1);
    }
    // Short-SMS format: "Sent Rs.X from XXXXXX9722 to ...".
    const masked = find(/from\s+[xX*]{2,}(\d{4})\b/i, message);
    if (masked) {
      return gv(masked, 1);
    }
    return null;
  }

  protected extractAvailableLimit(message: string): Paise | null {
    const patterns = [
      /Avl\s+limit:?\s*INR\s+([0-9,]+(?:\.\d{2})?)/i,
      /Avl\s+Lmt:?\s*INR\s+([0-9,]+(?:\.\d{2})?)/i,
      /Available\s+limit:?\s*INR\s+([0-9,]+(?:\.\d{2})?)/i,
    ];
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return toPaise(gv(m, 1));
      }
    }
    return super.extractAvailableLimit(message);
  }

  protected isTransactionMessage(message: string): boolean {
    // Shared skip-list (OTP, promos, payment requests, due reminders).
    if (isNonTransactionMessage(message)) {
      return false;
    }
    const lower = message.toLowerCase();
    return TRANSACTION_KEYWORDS.some(k => lower.includes(k));
  }
}
