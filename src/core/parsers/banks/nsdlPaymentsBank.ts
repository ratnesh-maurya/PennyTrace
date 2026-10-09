// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `NSDLPaymentsBankParser.kt`.

import type { Paise } from '../../types';
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { toPaise } from '../engine/patterns';
import { find, gv } from '../engine/regex';
import { TransactionType } from '../engine/types';

/**
 * Parser for NSDL Payments Bank (NSDLPB) SMS messages.
 *
 * NSDL Payments Bank was rebranded to Jio Payments Bank, but users still receive
 * legacy SMS from the NSDLPB sender in a distinct format. This parser handles that
 * legacy format only; the JIOPBS sender/format is handled by the Jio Payments Bank parser.
 */
export class NsdlPaymentsBankParser extends BaseIndianBankParser {
  readonly id = 'nsdl-payments-bank';

  getBankName(): string {
    return 'NSDL Payments Bank';
  }

  canHandle(sender: string): boolean {
    // Sender ID is NSDLPB, optionally with a DLT prefix (e.g. AD-NSDLPB, VM-NSDLPB-S).
    return sender.toUpperCase().includes('NSDLPB');
  }

  protected extractAmount(message: string): Paise | null {
    // Handles "Rs 1.00" (space) and "Rs.100.00" (no space).
    const m = find(/Rs\.?\s*([\d,]+(?:\.\d{2})?)/i, message);
    if (m) {
      return toPaise(gv(m, 1));
    }
    return super.extractAmount(message);
  }

  protected extractAccountLast4(message: string): string | null {
    // Patterns: "A/c XX1234" (debit) and "A/c no XX1234" (credit).
    const m = find(/A\/c(?:\s+no)?\s+([X\d]+)/i, message);
    if (m) {
      const last4 = this.extractLast4Digits(gv(m, 1));
      if (last4 != null) {
        return last4;
      }
    }
    return super.extractAccountLast4(message);
  }

  protected extractMerchant(message: string, _sender: string): string | null {
    // Debit: "for linked myupihandle@oksbi. UPI Ref ..." — capture the whole VPA up to
    // the sentence boundary (". " / end), then keep the handle before "@". Capturing
    // up to the first dot would truncate dotted handles like business.name@oksbi.
    const m = find(/for\s+linked\s+(.+?)(?:\.\s|$)/i, message);
    if (m) {
      let name = gv(m, 1).trim();
      if (name.includes('@')) name = name.substring(0, name.indexOf('@'));
      name = name.replace(/[.,;]+$/, '');
      const merchant = this.cleanMerchantName(name);
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Credit SMS has no VPA/merchant — leave null.
    return null;
  }

  protected extractReference(message: string): string | null {
    // Debit: "UPI Ref 122345526539"
    // Credit: "(UPI Ref No 617109835321)"
    const m = find(/UPI\s+Ref(?:\s+No)?\s+(\d+)/i, message);
    if (m) {
      return gv(m, 1);
    }
    return super.extractReference(message);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('debited')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('credited')) return TransactionType.INCOME;
    return super.extractTransactionType(message);
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();
    if (
      lowerMessage.includes('upi ref') &&
      (lowerMessage.includes('debited') || lowerMessage.includes('credited'))
    ) {
      return true;
    }
    return super.isTransactionMessage(message);
  }
}
