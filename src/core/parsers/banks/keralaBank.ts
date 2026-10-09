// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `KeralaBankParser.kt`.
import type { Paise } from '../../types';
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { toPaise } from '../engine/patterns';
import { find, gv } from '../engine/regex';
import { TransactionType } from '../engine/types';

/**
 * Parser for Kerala Bank (The Kerala State Co-operative Bank, India) SMS messages.
 *
 * Handles formats like:
 * - "Dear Customer Your A/c no XXXX0024 is credited with 15000.00 on 06-06-2026 by Loan Recovery
 *    From : 139451061. Balance is -579822.00 - Kerala Bank"
 *
 * Notes:
 * - Amounts are printed without a currency symbol (e.g. "credited with 15000.00").
 * - Balances can be NEGATIVE for loan accounts (e.g. "Balance is -579822.00").
 *
 * Common senders: VM-KELBNK-S
 * Currency: INR (Indian Rupee)
 *
 * Distinct from Kerala Gramin Bank (KGBANK / KERALAGR) — gates only on the KELBNK token.
 */
export class KeralaBankParser extends BaseIndianBankParser {
  readonly id = 'kerala-bank';

  getBankName(): string {
    return 'Kerala Bank';
  }

  getCurrency(): string {
    return 'INR';
  }

  canHandle(sender: string): boolean {
    return sender.toUpperCase().includes('KELBNK');
  }

  protected extractAmount(message: string): Paise | null {
    // "credited with 15000.00" / "debited with 15000.00" — no currency symbol.
    const m = find(/(?:credited|debited)\s+with\s+([0-9,]+(?:\.[0-9]{2})?)/i, message);
    if (m) {
      return toPaise(gv(m, 1));
    }
    // Fall back to base patterns (Rs/INR forms) for safety.
    return super.extractAmount(message);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('is credited')) {
      return TransactionType.INCOME;
    }
    if (lowerMessage.includes('is debited')) {
      return TransactionType.EXPENSE;
    }
    return super.extractTransactionType(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    // "by Loan Recovery From : 139451061" -> "Loan Recovery"
    // Stop at the "From :" clause, a ".", the trailing " - Kerala Bank"
    // signature, or end — so a message lacking both "From :" and a period
    // doesn't over-capture the bank-name suffix into the merchant.
    const m = find(/\bby\s+(.+?)(?:\s+From\s*:|\s*-\s*Kerala\s+Bank|\.|$)/i, message);
    if (m) {
      const merchant = this.cleanMerchantName(gv(m, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }
    return super.extractMerchant(message, sender);
  }

  protected extractBalance(message: string): Paise | null {
    // "Balance is -579822.00" — supports an optional leading minus sign.
    const m = find(/Balance\s+is\s+(-?[0-9,]+(?:\.[0-9]{2})?)/i, message);
    if (m) {
      return signedPaise(gv(m, 1));
    }
    return super.extractBalance(message);
  }
}

/** BigDecimal(str) for an optionally negative amount → paise (toPaise rejects the sign). */
function signedPaise(raw: string): Paise | null {
  const s = raw.replace(/,/g, '').trim();
  if (s.startsWith('-')) {
    const v = toPaise(s.slice(1));
    return v == null ? null : -v;
  }
  return toPaise(s);
}
