// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `bank/LazyPayParser.kt`.
import type { Paise } from '../../types';
import { BankParser } from '../engine/BankParser';
import { toPaise } from '../engine/patterns';
import { find, gv } from '../engine/regex';
import { TransactionType } from '../engine/types';

const FAILURE_PHRASES = [
  'could not be processed',
  'due to a failure',
  'payment failed',
  'transaction failed',
  'unsuccessful',
];

const TRANSACTION_KEYWORDS = [
  'payment of',
  'was successful',
  'against your lazypay statement',
  'thanks for your payment',
];

/**
 * Parser for LazyPay wallet transactions (BP-LZYPAY-S, JM-LZYPAY-S, JD-LZYPAY-S ...).
 * LazyPay is a Buy-Now-Pay-Later wallet, so every transaction is treated as CREDIT.
 */
export class LazyPayParser extends BankParser {
  readonly id = 'lazypay';

  getBankName(): string {
    return 'LazyPay';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return normalizedSender.includes('LZYPAY') || normalizedSender.includes('LAZYPAY');
  }

  protected extractMerchant(message: string, sender: string): string | null {
    // "for txn TXN512924131 on [MERCHANT] was successful".
    const m = find(/on\s+([^.]+?)\s+was\s+successful/i, message);
    if (m) {
      const rawMerchant = gv(m, 1).trim();
      const lowerRaw = rawMerchant.toLowerCase();
      let cleaned: string;
      if (lowerRaw.includes('zepto marketplace')) {
        cleaned = 'Zepto';
      } else if (lowerRaw.includes('innovative retail concepts')) {
        cleaned = 'BigBasket';
      } else if (lowerRaw.includes('swiggy')) {
        cleaned = 'Swiggy';
      } else if (lowerRaw.includes('zomato')) {
        cleaned = 'Zomato';
      } else {
        // Drop legal suffixes ("Private Limited", "Pvt Ltd" ...) and trailing numbers.
        cleaned = rawMerchant
          .replace(/\s*(Private|Pvt\.?|Ltd\.?|Limited|Inc\.?|LLC|LLP).*$/i, '')
          .replace(/\s*\d+$/, '')
          .trim();
      }
      if (cleaned.length > 0) {
        return cleaned;
      }
    }

    // Repayment messages.
    if (message.toLowerCase().includes('against your lazypay statement')) {
      return 'LazyPay Repayment';
    }

    return super.extractMerchant(message, sender) ?? 'LazyPay';
  }

  protected extractAmount(message: string): Paise | null {
    // "Rs. 235.76" or "Rs 235.76".
    const m = find(/Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i, message);
    if (m) {
      const amount = toPaise(gv(m, 1));
      if (amount != null) {
        return amount;
      }
    }
    return super.extractAmount(message);
  }

  protected extractReference(message: string): string | null {
    // Transaction id like "TXN512924131".
    const m = find(/txn\s+([A-Z0-9]+)/i, message);
    if (m) {
      return gv(m, 1).trim();
    }
    return super.extractReference(message);
  }

  // LazyPay is a credit service: all transactions are credit-based.
  protected extractTransactionType(_message: string): TransactionType {
    return TransactionType.CREDIT;
  }

  protected isTransactionMessage(message: string): boolean {
    const lower = message.toLowerCase();

    if (FAILURE_PHRASES.some(p => lower.includes(p))) {
      return false;
    }

    // Promotional messages, unless they are a payment confirmation.
    if (lower.includes('offer') || lower.includes('get cashback') || lower.includes('explore more')) {
      if (!lower.includes('payment of') && !lower.includes('was successful')) {
        return false;
      }
    }

    return TRANSACTION_KEYWORDS.some(k => lower.includes(k));
  }
}
