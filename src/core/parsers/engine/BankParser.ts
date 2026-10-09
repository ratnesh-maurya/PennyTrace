// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
//
// Upstream `bank/BankParser.kt`. Method names and override points are kept
// identical so per-bank ports can be compared side by side with the Kotlin.
// Changes: amounts are integer paise (`Paise`) instead of BigDecimal; each
// parser carries a canonical PennyTrace bank `id`.

import type { Instrument, Paise } from '../../types';
import { Account, Amount, Balance, Cleaning, Merchant, Reference, toPaise } from './patterns';
import { allDigits, escapeRegex, find, gv, hasLetter, replaceAll, rx, takeLast, digitsOnly } from './regex';
import { TransactionType, type BankTxn } from './types';

/** A verb saying money actually moved — used to tell a payment from a reminder. */
export const COMPLETED_MONEY_VERB =
  /\b(debited|deducted|credited|deposited|withdrawn|spent|received|transferred|sent|charged|used|refunded|reversed|paid|purchased)\b/;

export const MIN_MERCHANT_NAME_LENGTH = 2;

const INVESTMENT_KEYWORDS = [
  // Clearing corporations
  'iccl',
  'indian clearing corporation',
  'nsccl',
  'nse clearing',
  'clearing corporation',
  // Auto-pay indicators (excluding mandate/UMRN to avoid subscription false positives)
  'nach',
  'ach',
  'ecs',
  // Investment platforms
  'groww',
  'zerodha',
  'upstox',
  'kite',
  'kuvera',
  'paytm money',
  'etmoney',
  'coin by zerodha',
  'smallcase',
  'angel one',
  'angel broking',
  '5paisa',
  'icici securities',
  'icici direct',
  'hdfc securities',
  'kotak securities',
  'motilal oswal',
  'sharekhan',
  'edelweiss',
  'axis direct',
  'sbi securities',
  // Investment types
  'mutual fund',
  'sip',
  'elss',
  'ipo',
  'folio',
  'demat',
  'stockbroker',
  'digital gold',
  'sovereign gold',
  // Stock exchanges / depositories
  'nse',
  'bse',
  'cdsl',
  'nsdl',
];

/**
 * Messages that carry an amount but are never a transaction: OTPs, promos,
 * payment requests and due/reminder notices. Shared by every parser.
 */
export function isNonTransactionMessage(message: string): boolean {
  const lowerMessage = message.toLowerCase();

  // OTP messages
  if (
    lowerMessage.includes('otp') ||
    // Hyphenated "One-Time Password" (Amex SafeKey).
    /one[-\s]?time password/.test(lowerMessage) ||
    lowerMessage.includes('verification code')
  ) {
    return true;
  }

  // Promotional messages
  if (
    lowerMessage.includes('offer') ||
    lowerMessage.includes('discount') ||
    lowerMessage.includes('cashback offer') ||
    lowerMessage.includes('win ')
  ) {
    return true;
  }

  // Payment requests
  if (
    lowerMessage.includes('has requested') ||
    lowerMessage.includes('payment request') ||
    lowerMessage.includes('collect request') ||
    lowerMessage.includes('requesting payment') ||
    lowerMessage.includes('requests rs') ||
    lowerMessage.includes('ignore if already paid')
  ) {
    return true;
  }

  // Merchant payment acknowledgments
  if (lowerMessage.includes('have received payment')) {
    return true;
  }

  // IPO/ASBA fund blocking — the money is earmarked, not debited.
  if (lowerMessage.includes('asba') || lowerMessage.includes('is blocked in your')) {
    return true;
  }

  // Reward/gift voucher delivery notices.
  if (
    (lowerMessage.includes('e-voucher') || lowerMessage.includes('evoucher')) &&
    (lowerMessage.includes('received') || lowerMessage.includes('reward') || lowerMessage.includes('redemption')) &&
    !lowerMessage.includes('spent') &&
    !lowerMessage.includes('debited') &&
    !lowerMessage.includes('charged')
  ) {
    return true;
  }

  // Auto-debit intimations announce a future debit; the real debit arrives later.
  if (lowerMessage.includes('will be auto-debited') || lowerMessage.includes('will be auto debited')) {
    return true;
  }

  // Bill-due reminders, unless a completed-money verb is present.
  if (lowerMessage.includes('due on') && !COMPLETED_MONEY_VERB.test(lowerMessage)) {
    return true;
  }

  // Payment reminder/due messages
  if (
    lowerMessage.includes('is due') ||
    lowerMessage.includes('min amount due') ||
    lowerMessage.includes('minimum amount due') ||
    lowerMessage.includes('in arrears') ||
    lowerMessage.includes('is overdue') ||
    lowerMessage.includes('ignore if paid') ||
    (lowerMessage.includes('pls pay') && lowerMessage.includes('min of'))
  ) {
    return true;
  }

  return false;
}

export abstract class BankParser {
  /** Canonical PennyTrace bank id (`hdfc`, `sbi`, …). Used as ParsedEvent.bank. */
  abstract readonly id: string;

  /** Default instrument when the message itself does not say (wallets override). */
  readonly defaultInstrument: Instrument | undefined = undefined;

  /** Upstream getBankName(). */
  abstract getBankName(): string;

  /** Upstream canHandle(sender). `sender` is the raw SMS address. */
  abstract canHandle(sender: string): boolean;

  getCurrency(): string {
    return 'INR';
  }

  /** Parses an SMS. Returns null if the message cannot be parsed. */
  parse(smsBody: string, sender: string, timestamp: number): BankTxn | null {
    if (!this.isTransactionMessage(smsBody)) {
      return null;
    }
    const amount = this.extractAmount(smsBody);
    if (amount == null) {
      return null;
    }
    const type = this.extractTransactionType(smsBody);
    if (type == null) {
      return null;
    }
    const availableLimit = type === TransactionType.CREDIT ? this.extractAvailableLimit(smsBody) : null;
    const rawAccountLast4 = this.extractAccountLast4(smsBody);
    const safeAccountLast4 = rawAccountLast4 != null ? this.extractLast4Digits(rawAccountLast4) ?? rawAccountLast4 : null;

    return {
      amount,
      type,
      merchant: this.extractMerchant(smsBody, sender),
      reference: this.extractReference(smsBody),
      accountLast4: safeAccountLast4,
      balance: this.extractBalance(smsBody),
      creditLimit: availableLimit,
      smsBody,
      sender,
      timestamp,
      bankName: this.getBankName(),
      isFromCard: this.detectIsCard(smsBody),
      currency: this.getCurrency(),
    };
  }

  /** Helper for overriding `parse`: builds a BankTxn with this parser's defaults. */
  protected txn(fields: Omit<BankTxn, 'bankName' | 'currency' | 'isFromCard'> & Partial<BankTxn>): BankTxn {
    return {
      bankName: this.getBankName(),
      currency: this.getCurrency(),
      isFromCard: false,
      ...fields,
    };
  }

  /** Checks if the message is a transaction message (not OTP, promotional, etc.). */
  protected isTransactionMessage(message: string): boolean {
    if (this.isNonTransactionMessage(message)) {
      return false;
    }
    const lower = message.toLowerCase();
    return ['debited', 'credited', 'withdrawn', 'deposited', 'spent', 'received', 'transferred', 'paid'].some(k =>
      lower.includes(k),
    );
  }

  /** OTPs, promos, payment requests and due/reminder notices. */
  protected isNonTransactionMessage(message: string): boolean {
    return isNonTransactionMessage(message);
  }

  protected extractCurrency(message: string): string | null {
    const m = find(/([A-Z]{3})\s*[0-9,]+(?:\.\d{2})?/i, message);
    return m ? gv(m, 1).toUpperCase() : null;
  }

  protected extractAmount(message: string): Paise | null {
    for (const pattern of Amount.ALL_PATTERNS) {
      const m = find(pattern, message);
      if (m) {
        return toPaise(gv(m, 1));
      }
    }
    return null;
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();
    if (this.isInvestmentTransaction(lowerMessage)) {
      return TransactionType.INVESTMENT;
    }
    if (lowerMessage.includes('debited')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('withdrawn')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('spent')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('charged')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('paid')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('purchase')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('deducted')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('credited')) return TransactionType.INCOME;
    if (lowerMessage.includes('deposited')) return TransactionType.INCOME;
    if (lowerMessage.includes('received')) return TransactionType.INCOME;
    if (lowerMessage.includes('refund')) return TransactionType.INCOME;
    if (lowerMessage.includes('cashback') && !lowerMessage.includes('earn cashback')) return TransactionType.INCOME;
    return null;
  }

  protected isInvestmentTransaction(lowerMessage: string): boolean {
    return INVESTMENT_KEYWORDS.some(k => lowerMessage.includes(k));
  }

  protected extractMerchant(message: string, _sender: string): string | null {
    for (const pattern of Merchant.ALL_PATTERNS) {
      const m = find(pattern, message);
      if (m) {
        const merchant = this.cleanMerchantName(gv(m, 1).trim());
        if (this.isValidMerchantName(merchant)) {
          return merchant;
        }
      }
    }
    return null;
  }

  protected extractReference(message: string): string | null {
    for (const pattern of Reference.ALL_PATTERNS) {
      const m = find(pattern, message);
      if (m) {
        return gv(m, 1).trim();
      }
    }
    return null;
  }

  /** Digits only, last 4. Null if fewer than 3 digits. */
  protected extractLast4Digits(raw: string): string | null {
    const last4 = takeLast(digitsOnly(raw), 4);
    return last4.length >= 3 ? last4 : null;
  }

  protected extractAccountLast4(message: string): string | null {
    for (const pattern of Account.ALL_PATTERNS) {
      const m = find(pattern, message);
      if (m) {
        const last4 = this.extractLast4Digits(gv(m, 1));
        if (last4 != null && this.isValidAccountLast4(last4, m[0], message)) {
          return last4;
        }
      }
    }
    return null;
  }

  /** Rejects 4 digits that are really part of a date or a year. */
  protected isValidAccountLast4(last4: string, _matchedText: string, fullMessage: string): boolean {
    const e = escapeRegex(last4);
    const datePatterns = [
      rx(String.raw`\d{1,2}[/-]\d{1,2}[/-]${e}`),
      rx(String.raw`${e}[/-]\d{1,2}[/-]\d{1,2}`),
      rx(String.raw`\bon\s+\d{1,2}[/-]\d{1,2}[/-]${e}`, 'i'),
      rx(String.raw`\bdated\s+\d{1,2}[/-]\d{1,2}[/-]${e}`, 'i'),
    ];
    if (datePatterns.some(p => p.test(fullMessage))) {
      return false;
    }
    const n = Number(last4);
    if (/^\d+$/.test(last4) && n >= 2000 && n <= 2099) {
      const yearContextPatterns = [
        rx(String.raw`\bon\s+\d{1,2}[/-]\d{1,2}[/-]${e}`, 'i'),
        rx(String.raw`\bdated\s+.*?${e}`, 'i'),
        rx(String.raw`${e}(?:\s|$)`),
      ];
      for (const yp of yearContextPatterns) {
        if (yp.test(fullMessage)) {
          const accountBeforeYear = rx(String.raw`(?:A/c|Account|Acct).{0,25}${e}`, 'i');
          if (!accountBeforeYear.test(fullMessage)) {
            return false;
          }
        }
      }
    }
    return true;
  }

  protected extractBalance(message: string): Paise | null {
    for (const pattern of Balance.ALL_PATTERNS) {
      const m = find(pattern, message);
      if (m) {
        return toPaise(gv(m, 1));
      }
    }
    return null;
  }

  /** Credit card AVAILABLE limit (not the total limit). */
  protected extractAvailableLimit(message: string): Paise | null {
    const cur = String.raw`(?:Rs\.?|INR|₹)`;
    const amt = String.raw`([0-9,]+(?:\.\d{2})?)`;
    const patterns = [
      rx(String.raw`Available\s+limit\s+${cur}\s*${amt}`, 'i'),
      rx(String.raw`Available\s+limit:?\s*${cur}\s*${amt}`, 'i'),
      rx(String.raw`Avl\s+Lmt:?\s*${cur}\s*${amt}`, 'i'),
      rx(String.raw`Avail\s+Limit:?\s*${cur}\s*${amt}`, 'i'),
      rx(String.raw`Available\s+Credit\s+Limit:?\s*${cur}\s*${amt}`, 'i'),
      rx(String.raw`(?:^|\s)Limit:?\s*${cur}\s*${amt}`, 'i'),
    ];
    for (const p of patterns) {
      const m = find(p, message);
      if (m) {
        return toPaise(gv(m, 1));
      }
    }
    return null;
  }

  /** Card (credit/debit) vs account transaction. */
  protected detectIsCard(message: string): boolean {
    const lowerMessage = message.toLowerCase();
    const accountPatterns = ['a/c', 'account', 'ac ', 'acc ', 'saving account', 'current account', 'savings a/c', 'current a/c'];
    if (accountPatterns.some(p => lowerMessage.includes(p))) {
      return false;
    }
    const cardPatterns = ['card ending', 'card xx', 'debit card', 'credit card', 'card no.', 'card number', 'card *', 'card x'];
    if (cardPatterns.some(p => lowerMessage.includes(p))) {
      return true;
    }
    if (lowerMessage.includes('ending') && /(?:xx|XX|\*{2,})?\d{4}/.test(message)) {
      return true;
    }
    return false;
  }

  /** Removes common suffixes and noise from a merchant name. */
  protected cleanMerchantName(merchant: string): string {
    let s = merchant;
    s = replaceAll(s, Cleaning.TRAILING_PARENTHESES, '');
    s = replaceAll(s, Cleaning.REF_NUMBER_SUFFIX, '');
    s = replaceAll(s, Cleaning.DATE_SUFFIX, '');
    s = replaceAll(s, Cleaning.UPI_SUFFIX, '');
    s = replaceAll(s, Cleaning.TIME_SUFFIX, '');
    s = replaceAll(s, Cleaning.TRAILING_DASH, '');
    s = replaceAll(s, Cleaning.PVT_LTD, '');
    s = replaceAll(s, Cleaning.LTD, '');
    return s.trim();
  }

  protected isValidMerchantName(name: string): boolean {
    const commonWords = new Set(['USING', 'VIA', 'THROUGH', 'BY', 'WITH', 'FOR', 'TO', 'FROM', 'AT', 'THE']);
    return (
      name.length >= MIN_MERCHANT_NAME_LENGTH &&
      hasLetter(name) &&
      !commonWords.has(name.toUpperCase()) &&
      !allDigits(name) &&
      !name.includes('@')
    );
  }
}
