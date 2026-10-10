// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
//
// Upstream `bank/SliceParser.kt`: Slice (legacy card product and Slice Small Finance Bank).

import type { Paise } from '../../types';
import { BankParser } from '../engine/BankParser';
import { toPaise } from '../engine/patterns';
import { find, gv, rx, test } from '../engine/regex';
import { TransactionType } from '../engine/types';

/**
 * Parser for Slice payments bank transactions.
 * Handles messages from JK-SLICEIT and similar senders.
 */
export class SliceParser extends BankParser {
  readonly id = 'slice';

  getBankName(): string {
    return 'Slice';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return (
      normalizedSender.includes('SLICE') ||
      normalizedSender.includes('SLICEIT') ||
      normalizedSender.includes('SLCEIT') || // Matches JD-SLCEIT-S and similar
      normalizedSender.includes('SLCBNK') // Slice SFB sender, e.g. VA-SLCBNK-S
    );
  }

  private isSuccessMessage(message: string): boolean {
    const lower = message.toLowerCase();
    // Use word boundaries to avoid matching "unsuccessful"
    return (
      test(/\bsuccessful\b/, lower) ||
      test(/\bsuccess\b/, lower) ||
      lower.includes('approved') ||
      lower.includes('confirmed')
    );
  }

  private isFailureMessage(message: string): boolean {
    const lower = message.toLowerCase();
    return (
      lower.includes('declined') ||
      lower.includes('failed') ||
      lower.includes('rejected') ||
      lower.includes('error') ||
      lower.includes('denied') ||
      lower.includes('unsuccessful')
    );
  }

  private isDatePhrase(text: string): boolean {
    // Simple date pattern matching month names with day numbers
    const datePattern =
      /\b(?:\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2})\b/i;
    return test(datePattern, text);
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    // OTP / authorization messages are not completed transactions.
    // (e.g. "is your OTP for txn of Rs. ... on slice card ending ...")
    if (lowerMessage.includes('otp')) {
      return false;
    }

    // UPI AutoPay mandate lifecycle notices ("... is revoked", "is paused",
    // "is suspended") are not money movements.
    if (
      lowerMessage.includes('revoked') ||
      lowerMessage.includes('is paused') ||
      lowerMessage.includes('is suspended')
    ) {
      return false;
    }

    // Slice uses "sent" for UPI transfers, and the base class transaction
    // keyword list does not include "sent" — so accept it explicitly.
    // Collect/payment requests do not use "sent" wording and are filtered
    // by the base class below (it rejects "collect request" / "payment
    // request" / "has requested" / "have received payment" etc.).
    if (lowerMessage.includes('sent')) {
      return true;
    }

    // PennyTrace: "Rs. 11,000 is successfully added to your slice savings account. Your
    // updated balance is Rs. 12,900.15" is a top-up, and the only message that prints the
    // savings balance.
    if (/\badded\s+to\s+your\s+slice\b/.test(lowerMessage)) {
      return true;
    }

    // For "transaction" keyword, ensure it's a successful transaction
    if (lowerMessage.includes('transaction')) {
      return this.isSuccessMessage(message) && !this.isFailureMessage(message);
    }

    // Everything else — including the SFB "received in slice A/c" credit and
    // the AutoPay "Successfully paid" debit — is handled by the base class,
    // whose keyword set ("received"/"paid"/...) accepts genuine transactions
    // while its guards reject collect/payment requests, OTPs and reminders.
    // A UPI collect-request from the slice sender therefore can no longer be
    // booked as income.
    return super.isTransactionMessage(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    const lowerMessage = message.toLowerCase();

    // --- Slice SFB (banking) formats ---
    // Card transaction: "transaction of Rs. 2.07 at FamAppbyTriO from a/c ... is successful"
    const atMerchant = find(/\bat\s+(.+?)(?:\s+from\b|\s+on\b|\s+is\b|\.\s|$)/i, message);
    if (atMerchant) {
      const merchant = this.cleanMerchantName(gv(atMerchant, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // UPI received: "received in slice A/c ... from NASIMUDDIN ... via UPI (Ref ID: ...)"
    // UPI sent:     "sent from a/c ... to Hussain Shaikh (UPI Ref: ...)"
    // AutoPay paid: "paid Rs.1 from slice a/c ... to OpenAI LLC on 25-May-26 via UPI AutoPay"
    // Only applies to the Slice SFB account-to-account flows (they always carry
    // an a/c reference), so we don't hijack legacy "credited to your slice
    // account" style messages.
    if (test(/\ba\/c\b/i, message)) {
      const payeeKeyword = lowerMessage.includes('received') ? 'from' : 'to';
      // "in your" ends the payer in the app notification:
      // "You've got ₹1,565 from NAME in your slice bank a/c xx1234."
      const payeePattern = rx(
        String.raw`\b${payeeKeyword}\s+(.+?)(?:\s+in\s+your\b|\s+on\b|\s+via\b|\s+is\b|\s*\(|\.\s|$)`,
        'i',
      );
      const payee = find(payeePattern, message);
      if (payee) {
        const merchant = this.cleanMerchantName(gv(payee, 1).trim());
        if (this.isValidMerchantName(merchant)) {
          return merchant;
        }
      }
    }

    // Look for "sent to NAME" pattern for UPI transfers
    const sentTo = find(/sent.*to\s+([A-Z][A-Z0-9\s./&-]+?)\s*\(/i, message);
    if (sentTo) {
      const merchant = gv(sentTo, 1).trim();
      if (merchant !== '') {
        return this.cleanMerchantName(merchant);
      }
    }

    // Look for "from MERCHANT" pattern
    const from = find(/from\s+([A-Z][A-Z0-9\s]+?)(?:\s+on|\s+\(|$)/i, message);
    if (from) {
      const merchant = gv(from, 1).trim();
      if (merchant !== '' && merchant.toUpperCase() !== 'NEFT') {
        return this.cleanMerchantName(merchant);
      }
    }

    // Look for "on MERCHANT" pattern for credit card transactions
    const on = find(/\bon\s+([A-Za-z0-9\s./&-]+?)(?:\s+is|$)/i, message);
    if (on) {
      const merchant = gv(on, 1).trim();
      if (
        merchant !== '' &&
        merchant.toLowerCase() !== 'slice' &&
        merchant.toUpperCase() !== 'RS' &&
        !this.isDatePhrase(merchant)
      ) {
        return this.cleanMerchantName(merchant);
      }
    }

    // Check for specific patterns
    if (lowerMessage.includes('paypal')) return 'PayPal';
    if (lowerMessage.includes('slice') && lowerMessage.includes('credited')) return 'Slice Credit';
    return super.extractMerchant(message, sender) ?? 'Slice';
  }

  protected detectIsCard(message: string): boolean {
    const lower = message.toLowerCase();
    // Slice SFB card-spend format:
    // "Your transaction of Rs. X at MERCHANT from a/c ... is successful"
    // carries an a/c reference (which the base detector treats as non-card),
    // so flag it explicitly. UPI flows use sent/received/paid wording instead.
    if (
      lower.includes('transaction of') &&
      test(/\bat\s/i, message) &&
      !lower.includes('sent') &&
      !lower.includes('received') &&
      !lower.includes('paid')
    ) {
      return true;
    }
    return super.detectIsCard(message);
  }

  protected extractBalance(message: string): Paise | null {
    // Slice SFB prints "Avl. Bal. Rs. 2,203.56" (dots after Avl/Bal break the
    // base [:\s]+ patterns), so handle that shape explicitly first.
    const sliceBal = find(/Avl\.?\s*Bal\.?\s*(?:Rs\.?|INR|₹)?\s*([0-9,]+(?:\.\d{2})?)/i, message);
    if (sliceBal) {
      return toPaise(gv(sliceBal, 1));
    }
    // PennyTrace: "Your updated balance is Rs. 12,900.15".
    const updated = find(/updated\s+balance\s+is\s+(?:Rs\.?|INR|₹)\s*([0-9,]+(?:\.\d{1,2})?)/i, message);
    if (updated) {
      return toPaise(gv(updated, 1));
    }
    return super.extractBalance(message);
  }

  protected extractReference(message: string): string | null {
    // Slice SFB UPI formats: "(UPI Ref: 616851070000)" and "(Ref ID: 212756500000)".
    const upiRef = find(/UPI\s+Ref(?:\s+ID)?[:\s]+([0-9]+)/i, message);
    if (upiRef) {
      return gv(upiRef, 1);
    }
    const refId = find(/Ref\s+ID[:\s]+([0-9]+)/i, message);
    if (refId) {
      return gv(refId, 1);
    }
    return super.extractReference(message);
  }

  /**
   * Returns true when the message clearly references a Slice credit-card product
   * (legacy, pre-2022 RBI PPI pivot). Modern Slice is a UPI / savings-account
   * product, so without explicit card context we treat debits as EXPENSE, not
   * CREDIT (which downstream is interpreted as "credit card account").
   */
  private hasCardContext(lowerMessage: string): boolean {
    return (
      lowerMessage.includes('credit card') ||
      lowerMessage.includes('credit limit') ||
      lowerMessage.includes('available limit') ||
      lowerMessage.includes('card ending') ||
      lowerMessage.includes('card xx') ||
      lowerMessage.includes('card no') ||
      lowerMessage.includes('on your slice card') ||
      lowerMessage.includes('slice card')
    );
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();
    const cardContext = this.hasCardContext(lowerMessage);
    const spendType = cardContext ? TransactionType.CREDIT : TransactionType.EXPENSE;

    // Slice credits/cashbacks (income side unchanged)
    if (lowerMessage.includes('credited')) return TransactionType.INCOME;
    if (lowerMessage.includes('received')) return TransactionType.INCOME;
    if (lowerMessage.includes('cashback')) return TransactionType.INCOME;
    if (lowerMessage.includes('refund')) return TransactionType.INCOME;
    // PennyTrace: "is successfully added to your slice savings account" (a top-up).
    if (/\badded\s+to\s+your\s+slice\b/.test(lowerMessage)) return TransactionType.INCOME;

    // Slice payments/debits.
    // After RBI's 2022 PPI guidelines, Slice pivoted from a credit-card
    // product to a UPI / savings-account product (Slice Bank). Debits
    // from the bank account must be EXPENSE so that downstream code
    // does not classify the account as a credit card. Only fall back
    // to CREDIT when the message explicitly mentions card context.
    if (lowerMessage.includes('debited')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('sent')) return TransactionType.EXPENSE; // UPI transfer
    if (lowerMessage.includes('spent')) return spendType;
    if (lowerMessage.includes('paid')) return spendType;
    if (lowerMessage.includes('payment') && !lowerMessage.includes('received')) return spendType;

    // Only map bare "transaction" word to a type if it's a successful
    // transaction; default to EXPENSE unless clearly card-context.
    if (
      lowerMessage.includes('transaction') &&
      !lowerMessage.includes('credited') &&
      this.isSuccessMessage(message) &&
      !this.isFailureMessage(message)
    ) {
      return spendType;
    }

    return super.extractTransactionType(message);
  }
}
