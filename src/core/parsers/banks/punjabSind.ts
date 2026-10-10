// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `PunjabSindBankParser.kt`.

import type { Paise } from '../../types';
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { toPaise } from '../engine/patterns';
import { find, gv } from '../engine/regex';

/**
 * Parser for Punjab & Sind Bank (PSB) SMS messages.
 *
 * Expected format:
 *   A/c No **<last4> Credited|Debited with Rs <amount>--<description> (CLR BAL <bal>CR|DR)(dd-MM-yyyy HH:mm:ss)-Punjab&Sind Bank
 *
 * <description> variants:
 *   - NEFT/<ref>/<sender name>
 *   - UPI/CR|DR/<utr>/<counterparty>/<bank>/<account>/<suffix>
 *   - Credit|Debit of <MICR> (cheque clearing)
 *   - Free text (e.g. generic vendor note)
 */
export class PunjabSindBankParser extends BaseIndianBankParser {
  readonly id = 'punjab-sind';

  getBankName(): string {
    return 'Punjab & Sind Bank';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return (
      normalizedSender.includes('PSBANK') ||
      normalizedSender.includes('PUNJAB&SIND') ||
      normalizedSender.includes('PUNJAB & SIND')
    );
  }

  protected extractAmount(message: string): Paise | null {
    const m = find(/(?:Credited|Debited)\s+with\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i, message);
    if (m) {
      return toPaise(gv(m, 1));
    }
    return super.extractAmount(message);
  }

  protected extractAccountLast4(message: string): string | null {
    const m = find(/A\/[Cc]\s+No\s+\*+(\d{2,})/i, message);
    if (m) {
      return this.extractLast4Digits(gv(m, 1));
    }
    return super.extractAccountLast4(message);
  }

  protected extractBalance(message: string): Paise | null {
    const m = find(/CLR\s+BAL\s+([0-9,]+(?:\.\d{2})?)\s*(?:CR|DR)?/i, message);
    if (m) {
      return toPaise(gv(m, 1));
    }
    return super.extractBalance(message);
  }

  protected extractReference(message: string): string | null {
    const neftRef = find(/NEFT\/([A-Z0-9]+)\//i, message);
    if (neftRef) return gv(neftRef, 1);

    const upiRef = find(/UPI\/(?:CR|DR)\/(\d+)\//i, message);
    if (upiRef) return gv(upiRef, 1);

    const chequeRef = find(/(?:Credit|Debit)\s+of\s+(\d+)/i, message);
    if (chequeRef) return gv(chequeRef, 1);

    const psbRef = find(/\b(PSB\d{10,})\b/, message);
    if (psbRef) return gv(psbRef, 1);

    return super.extractReference(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    const upiMerchant = find(/UPI\/(?:CR|DR)\/\d+\/([^/]+)\//i, message);
    if (upiMerchant) {
      const merchant = this.cleanMerchantName(gv(upiMerchant, 1).trim());
      if (this.isValidMerchantName(merchant)) return merchant;
    }

    const neftMerchant = find(/NEFT\/[A-Z0-9]+\/([^(\r\n]+?)(?=\s*\(|\s*$)/i, message);
    if (neftMerchant) {
      const merchant = this.cleanMerchantName(gv(neftMerchant, 1).trim());
      if (this.isValidMerchantName(merchant)) return merchant;
    }

    const cheque = find(/(Credit|Debit)\s+of\s+\d+/i, message);
    if (cheque) {
      return gv(cheque, 1).toLowerCase() === 'credit' ? 'Cheque Credit' : 'Cheque Debit';
    }

    const descPattern = /(?:Credited|Debited)\s+with\s+Rs\.?\s*[0-9,]+(?:\.\d{2})?\s*--\s*([^(\r\n]+?)\s*\(CLR\s+BAL/i;
    const desc = find(descPattern, message);
    if (desc) {
      const text = gv(desc, 1).trim().replace(/-+$/, '').trim();
      const merchant = this.cleanMerchantName(text);
      if (this.isValidMerchantName(merchant)) return merchant;
    }

    return super.extractMerchant(message, sender);
  }
}
