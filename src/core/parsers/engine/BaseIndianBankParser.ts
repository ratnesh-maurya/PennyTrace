// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
//
// Upstream `bank/BaseIndianBankParser.kt`: INR, UPI, mandates and balance-only
// notifications common to Indian banks.

import { BankParser } from './BankParser';
import { Amount, DatePatterns, toPaise } from './patterns';
import { find, gv, rx } from './regex';
import type { BalanceUpdateInfo, MandateInfo } from './types';

export abstract class BaseIndianBankParser extends BankParser {
  getCurrency(): string {
    return 'INR';
  }

  protected isInvestmentTransaction(lowerMessage: string): boolean {
    // Credits to a bank account are income, not investment.
    if (lowerMessage.includes('credited') || lowerMessage.includes('deposited')) {
      return false;
    }
    return super.isInvestmentTransaction(lowerMessage);
  }

  // ---- Mandate / subscription --------------------------------------------

  /** E-Mandate notification (not a transaction). */
  isEMandateNotification(message: string): boolean {
    const lower = message.toLowerCase();
    return (
      lower.includes('e-mandate') ||
      lower.includes('upi-mandate') ||
      (lower.includes('mandate') && lower.includes('successfully created'))
    );
  }

  /** Future debit notification (subscription alert, not a current transaction). */
  isFutureDebitNotification(message: string): boolean {
    const lower = message.toLowerCase();
    return (
      lower.includes('will be debited') ||
      lower.includes('mandate set for') ||
      (lower.includes('upcoming') && lower.includes('mandate'))
    );
  }

  parseMandateSubscription(message: string): MandateInfo | null {
    if (!this.isEMandateNotification(message) && !this.isFutureDebitNotification(message)) {
      return null;
    }
    const inr = find(Amount.INR_PATTERN, message);
    const rs = find(Amount.RS_PATTERN, message);
    const amount = (inr ? toPaise(gv(inr, 1)) : null) ?? (rs ? toPaise(gv(rs, 1)) : null);
    if (amount == null) {
      return null;
    }
    let merchant = 'Unknown Subscription';
    const merchantPatterns = [
      /towards\s+([^.\n]+?)(?:\s+from|\s+A\/c|\s+UMRN|\s+ID:|\s+Alert:|\s*\.|$)/i,
      /for\s+([^.\n]+?)(?:\s+mandate|\s+will\s+be|\s+ID:|\s+Act:|\s*\.|$)/i,
      /Info:\s*([^.\n]+?)(?:\s*$)/i,
    ];
    for (const p of merchantPatterns) {
      const m = find(p, message);
      if (m) {
        const cleaned = this.cleanMerchantName(gv(m, 1).trim());
        if (this.isValidMerchantName(cleaned)) {
          merchant = cleaned;
        }
      }
    }
    const datePattern = rx(
      String.raw`(?:on|for)\s+(${DatePatterns.DD_MMM_YY.source}|${DatePatterns.DD_MM_YYYY.source})`,
      'i',
    );
    const dateStr = gv(find(datePattern, message), 1) || null;
    const umn = gv(find(/UMN[:\s]+([^.\s]+)/i, message), 1) || null;
    return {
      amount,
      nextDeductionDate: dateStr,
      merchant,
      umn,
      dateFormat: 'dd-MMM-yy',
      accountLast4: this.extractAccountLast4(message),
    };
  }

  // ---- Balance update ------------------------------------------------------

  /** Balance-only notification (not a transaction). */
  isBalanceUpdateNotification(message: string): boolean {
    const lower = message.toLowerCase();
    const hasBalanceKeyword =
      lower.includes('available bal') ||
      lower.includes('avl bal') ||
      lower.includes('account balance') ||
      lower.includes('a/c balance') ||
      lower.includes('updated balance');
    const hasTxnKeyword =
      lower.includes('debited') ||
      lower.includes('credited') ||
      lower.includes('withdrawn') ||
      lower.includes('deposited') ||
      lower.includes('spent') ||
      lower.includes('transferred') ||
      lower.includes('payment of');
    return hasBalanceKeyword && !hasTxnKeyword;
  }

  parseBalanceUpdate(message: string): BalanceUpdateInfo | null {
    if (!this.isBalanceUpdateNotification(message)) {
      return null;
    }
    const balance = this.extractBalance(message);
    if (balance == null) {
      return null;
    }
    return {
      bankName: this.getBankName(),
      accountLast4: this.extractAccountLast4(message),
      balance,
    };
  }

  // ---- Helpers ---------------------------------------------------------------

  protected getMonthNumber(monthAbbr: string): number {
    const idx = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'].indexOf(
      monthAbbr.toUpperCase(),
    );
    return idx >= 0 ? idx + 1 : 1;
  }
}
