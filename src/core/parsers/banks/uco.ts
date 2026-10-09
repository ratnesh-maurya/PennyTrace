// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `UCOBankParser.kt`.

import type { Paise } from '../../types';
import { BankParser } from '../engine/BankParser';
import { toPaise } from '../engine/patterns';
import { find, gv, matches, rx } from '../engine/regex';
import { TransactionType } from '../engine/types';

/** Rupees with or without a leading zero: "2,000.00", "50.00", ".50". */
const AMOUNT = String.raw`(\d[\d,]*(?:\.\d{1,2})?|\.\d{1,2})`;
const DEBIT_CREDIT_AMOUNT = rx(
  String.raw`(?:debited|credited)\s+with\s+Rs\.?\s*${AMOUNT}`,
  'i',
);
const ANY_AMOUNT = rx(String.raw`Rs\.?\s*${AMOUNT}`, 'i');
const BALANCE_CLAUSE = /Avl\s+Bal|Available\s+Balance/i;

/**
 * Parser for UCO Bank SMS messages
 *
 * Supported formats:
 * - Debit: "A/c XX1111 Debited with Rs.2000.00 on 21-09-2025 by UCO-UPI.Avl Bal Rs.11111.11. Report Dispute https://spgrs.ucoonline.in/Home_Page.jsp"
 * - Credit: "A/c XX1111 Credited with Rs.2,000.00 on 21-09-2025 by UCO-UPI.Avl Bal Rs.11111.11. Report Dispute https://spgrs.ucoonline.in/Home_Page.jsp -UCO Bank"
 *
 * Sender patterns: XX-UCOBNK-S (where XX can be any two letters)
 */
export class UcoBankParser extends BankParser {
  readonly id = 'uco';

  getBankName(): string {
    return 'UCO Bank';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return (
      normalizedSender.includes('UCOBNK') ||
      normalizedSender.includes('UCOBANK') ||
      normalizedSender.includes('UCO BANK') ||
      // DLT patterns with any two-letter prefix followed by -UCOBNK-S
      matches(/^[A-Z]{2}-UCOBNK-[ST]$/, normalizedSender) ||
      // Other variations
      matches(/^[A-Z]{2}-UCOBNK$/, normalizedSender) ||
      matches(/^[A-Z]{2}-UCOBANK$/, normalizedSender)
    );
  }

  protected extractAmount(message: string): Paise | null {
    // Read the amount from the "Debited/Credited with" clause itself. A bare
    // "first Rs. in the message" search is unsafe here: when the amount
    // doesn't match (e.g. "Rs..50", a sub-rupee amount printed without its
    // leading zero) it walks on to the next "Rs." — the Avl Bal — and
    // records the whole balance as the transaction.
    const dc = find(DEBIT_CREDIT_AMOUNT, message);
    if (dc) {
      return toAmount(gv(dc, 1));
    }

    // Anything else: only look before the balance clause, so the fallback
    // can never pick up the balance either.
    const bal = find(BALANCE_CLAUSE, message);
    const beforeBalance = bal ? message.substring(0, bal.index) : message;
    const any = find(ANY_AMOUNT, beforeBalance);
    if (any) {
      return toAmount(gv(any, 1));
    }

    return super.extractAmount(beforeBalance);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('debited with')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('credited with')) return TransactionType.INCOME;
    return super.extractTransactionType(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    // UCO Bank format: "by UCO-UPI" or "by <merchant>"
    const m = find(/by\s+([^.]+?)(?:\.Avl|$)/i, message);
    if (m) {
      const merchant = gv(m, 1).trim();
      // Handle UCO-UPI transactions
      if (merchant.toLowerCase().includes('uco-upi')) {
        return 'UPI Transfer';
      }
      // Clean up common suffixes
      return this.cleanMerchantName(merchant);
    }

    // Fall back to base class extraction
    return super.extractMerchant(message, sender);
  }

  protected extractAccountLast4(message: string): string | null {
    const base = super.extractAccountLast4(message);
    if (base != null) {
      return base;
    }
    // UCO Bank format: "A/c XX1111"
    const accountPatterns = [
      /A\/c\s+([X*\d]+)/i,
      /Account\s+([X*\d]+)/i,
      /Acc\s+([X*\d]+)/i,
    ];
    for (const pattern of accountPatterns) {
      const m = find(pattern, message);
      if (m) {
        return this.extractLast4Digits(gv(m, 1));
      }
    }
    return null;
  }

  protected extractBalance(message: string): Paise | null {
    // UCO Bank format: "Avl Bal Rs.11111.11"
    const balancePatterns = [
      // "Avl Bal Rs.11111.11" and "Avl Bal in your A/c is Rs.2,992.54".
      // The connecting words are spelled out rather than skipped with a
      // wildcard: an open gap would let "Avl Bal unavailable ... charge
      // Rs.10.00" record the charge as the balance.
      /Avl\s+Bal(?:\s+in\s+your\s+A\/c\s+is)?\s*[:.]?\s*Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
      /Available\s+Balance\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
      /Balance[:.]?\s*Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
    ];
    for (const pattern of balancePatterns) {
      const m = find(pattern, message);
      if (m) {
        return toPaise(gv(m, 1));
      }
    }
    return super.extractBalance(message);
  }

  protected extractReference(message: string): string | null {
    // Look for any transaction reference patterns specific to UCO Bank
    const refPatterns = [
      /ref[:#]?\s*(\w+)/i,
      /txn[:#]?\s*(\w+)/i,
      /transaction\s+id[:#]?\s*(\w+)/i,
    ];
    for (const pattern of refPatterns) {
      const m = find(pattern, message);
      if (m) {
        return gv(m, 1);
      }
    }
    return super.extractReference(message);
  }
}

/** "2,000.00" -> 2000.00; ".50" -> 0.50. */
function toAmount(raw: string): Paise | null {
  const cleaned = raw.replaceAll(',', '');
  return toPaise(cleaned.startsWith('.') ? `0${cleaned}` : cleaned);
}
