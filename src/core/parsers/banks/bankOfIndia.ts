// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
//
// Upstream `bank/BankOfIndiaParser.kt`: Bank of India (BOI).

import type { Paise } from '../../types';
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { toPaise } from '../engine/patterns';
import { find, gv, matches, replaceAll } from '../engine/regex';
import { TransactionType } from '../engine/types';

const includesIc = (s: string, x: string): boolean => s.toLowerCase().includes(x.toLowerCase());

/**
 * Parser for Bank of India (BOI) SMS messages.
 *
 * Handles formats like:
 * - "Rs.200.00 debited A/cXX5468 and credited to SAI MISAL via UPI Ref No 315439383341 on 23Aug25. Call 18001031906, if not done by you. -BOI"
 * - Other BOI transaction formats
 */
export class BankOfIndiaParser extends BaseIndianBankParser {
  readonly id = 'boi';

  getBankName(): string {
    return 'Bank of India';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();

    // Direct sender IDs
    const boiSenders = new Set(['BOIIND', 'BOIBNK']);
    if (boiSenders.has(normalizedSender)) {
      return true;
    }

    // DLT patterns (XX-BOIIND-S/T or XX-BOIBNK-S/T format)
    return [
      /^[A-Z]{2}-BOIIND-[ST]$/,
      /^[A-Z]{2}-BOIBNK-[ST]$/,
      /^[A-Z]{2}-BOI-[ST]$/,
      /^[A-Z]{2}-BOIIND$/,
      /^[A-Z]{2}-BOIBNK$/,
      /^[A-Z]{2}-BOI$/,
      /^BK-BOIIND.*$/,
      /^JD-BOIIND.*$/,
    ].some(p => matches(p, normalizedSender));
  }

  protected extractAmount(message: string): Paise | null {
    // Pattern 1: Rs.200.00 debited/credited
    const rs = find(/Rs\.?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)\s+(?:debited|credited)/i, message);
    if (rs) {
      return toPaise(gv(rs, 1));
    }

    // Pattern 2: INR format
    const inr = find(/INR\s*(\d+(?:,\d{3})*(?:\.\d{2})?)\s+(?:debited|credited)/i, message);
    if (inr) {
      return toPaise(gv(inr, 1));
    }

    // Pattern 3: withdrawn Rs 500
    const withdrawn = find(/withdrawn\s+Rs\.?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/i, message);
    if (withdrawn) {
      return toPaise(gv(withdrawn, 1));
    }

    // Fall back to base class patterns
    return super.extractAmount(message);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();

    // BOI specific: Cash deposits should be INCOME (not investment)
    if (
      lowerMessage.includes('deposited in your account') ||
      (lowerMessage.includes('cash') && lowerMessage.includes('deposited'))
    ) {
      return TransactionType.INCOME;
    }

    // Check for investment transactions (including UPI Mandate for mutual funds)
    if (this.isInvestmentTransaction(lowerMessage)) {
      return TransactionType.INVESTMENT;
    }

    // UPI Mandate for mutual funds/investments
    if (
      lowerMessage.includes('mandate') &&
      (lowerMessage.includes('mutual fund') ||
        lowerMessage.includes('iccl') ||
        lowerMessage.includes('groww') ||
        lowerMessage.includes('zerodha') ||
        lowerMessage.includes('kuvera') ||
        lowerMessage.includes('paytm money'))
    ) {
      return TransactionType.INVESTMENT;
    }

    // BOI specific: "debited A/c... and credited to" pattern indicates expense
    if (lowerMessage.includes('debited') && lowerMessage.includes('and credited to')) {
      return TransactionType.EXPENSE;
    }

    // BOI specific: "credited A/c... and debited from" pattern indicates income
    if (lowerMessage.includes('credited') && lowerMessage.includes('and debited from')) {
      return TransactionType.INCOME;
    }

    // Standard patterns
    return super.extractTransactionType(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    // Pattern for cash deposit via Cash Acceptor Machine
    if (
      includesIc(message, 'Cash Acceptor Machine') ||
      (includesIc(message, 'cash') && includesIc(message, 'deposited'))
    ) {
      return 'Cash Deposit';
    }

    // Pattern for UPI Mandate execution: "towards MERCHANT for Mandate Created via PLATFORM"
    if (includesIc(message, 'Mandate') && includesIc(message, 'towards')) {
      // Try to extract platform first (e.g., "via GROWW")
      const via = find(/via\s+([A-Za-z0-9]+)/i, message);
      if (via) {
        const platform = this.cleanMerchantName(gv(via, 1).trim());
        if (this.isValidMerchantName(platform)) {
          return platform;
        }
      }

      // If no platform found, extract merchant from "towards MERCHANT for"
      const towards = find(/towards\s+([^,\n]+?)(?:\s+for|\s*,|$)/i, message);
      if (towards) {
        const merchantInfo = gv(towards, 1).trim();
        // Clean up the merchant name (e.g., "ICCL - Mutual Funds - Autopa" -> "ICCL - Mutual Funds")
        const cleanedMerchant = replaceAll(merchantInfo, /\s*-\s*Autopa.*$/i, '').trim();
        if (this.isValidMerchantName(cleanedMerchant)) {
          return this.cleanMerchantName(cleanedMerchant);
        }
      }
    }

    // Pattern for NEFT inward: "By NEFTINWARD ref/MERCHANT_NAME"
    const neftInward = find(/By\s+NEFTINWARD\s+[^/]+\/(.+?)(?:\s*\.Avl|\s*\.|-BOI|$)/i, message);
    if (neftInward) {
      const merchant = this.cleanMerchantName(gv(neftInward, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Pattern 1: "credited to MERCHANT via UPI" (for debits)
    const creditedTo = find(/credited\s+to\s+([^.\n]+?)(?:\s+via|\s+Ref|\s+on|$)/i, message);
    if (creditedTo) {
      const merchant = this.cleanMerchantName(gv(creditedTo, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Pattern 2: "debited from MERCHANT via UPI" (for credits)
    const debitedFrom = find(/debited\s+from\s+([^.\n]+?)(?:\s+via|\s+Ref|\s+on|$)/i, message);
    if (debitedFrom) {
      const merchant = this.cleanMerchantName(gv(debitedFrom, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Pattern 3: ATM withdrawal
    if (includesIc(message, 'ATM') || includesIc(message, 'withdrawn')) {
      const atm = find(/(?:ATM|withdrawn)\s+(?:at\s+)?([^.\n]+?)(?:\s+on|\s+Ref|$)/i, message);
      if (atm) {
        const location = this.cleanMerchantName(gv(atm, 1).trim());
        if (this.isValidMerchantName(location)) {
          return `ATM - ${location}`;
        }
      }
      return 'ATM';
    }

    // Pattern 4: "towards MERCHANT" (generic, but not for Mandate messages which are handled above)
    if (!includesIc(message, 'Mandate')) {
      const towards = find(/towards\s+([^.\n]+?)(?:\s+via|\s+Ref|\s+on|$)/i, message);
      if (towards) {
        const merchant = this.cleanMerchantName(gv(towards, 1).trim());
        if (this.isValidMerchantName(merchant)) {
          return merchant;
        }
      }
    }

    // Pattern 5: "to MERCHANT" (generic)
    const to = find(/to\s+([^.\n]+?)(?:\s+via|\s+Ref|\s+on|$)/i, message);
    if (to) {
      const merchant = this.cleanMerchantName(gv(to, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Pattern 6: "from MERCHANT" (generic)
    const from = find(/from\s+([^.\n]+?)(?:\s+via|\s+Ref|\s+on|$)/i, message);
    if (from) {
      const merchant = this.cleanMerchantName(gv(from, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Fall back to base class patterns
    return super.extractMerchant(message, sender);
  }

  protected extractAccountLast4(message: string): string | null {
    const base = super.extractAccountLast4(message);
    if (base != null) {
      return base;
    }

    // Pattern 1: A/cXX5468 or A/c XX5468 (BOI format)
    const accountSlash = find(/A\/c\s*([X*\d]+)/i, message);
    if (accountSlash) {
      return this.extractLast4Digits(gv(accountSlash, 1));
    }

    // Pattern 2: "your account XX5468" (BOI cash deposit format)
    const accountWord = find(/account\s+([X*\d]+)/i, message);
    if (accountWord) {
      return this.extractLast4Digits(gv(accountWord, 1));
    }

    // Pattern 3: Account ending 1234
    const ending = find(/(?:Account|A\/c)\s+ending\s+(\d{4})/i, message);
    if (ending) {
      return gv(ending, 1);
    }

    // Pattern 4: A/c No. XX1234
    const accountNo = find(/A\/c\s+No\.?\s*([X*\d]+)/i, message);
    if (accountNo) {
      return this.extractLast4Digits(gv(accountNo, 1));
    }

    return null;
  }

  protected extractReference(message: string): string | null {
    // Pattern 1: Ref No 315439383341 (BOI format)
    const refNo = find(/Ref\s+No\.?\s*(\d+)/i, message);
    if (refNo) {
      return gv(refNo, 1);
    }

    // Pattern 2: Reference: 123456
    const reference = find(/Reference[:\s]+(\w+)/i, message);
    if (reference) {
      return gv(reference, 1);
    }

    // Pattern 3: Txn ID/Txn#
    const txn = find(/Txn\s*(?:ID|#)[:\s]*(\w+)/i, message);
    if (txn) {
      return gv(txn, 1);
    }

    // Pattern 4: UPI reference
    const upi = find(/UPI[:\s]+(\d+)/i, message);
    if (upi) {
      return gv(upi, 1);
    }

    // Fall back to base class
    return super.extractReference(message);
  }

  protected extractBalance(message: string): Paise | null {
    // Pattern 1: Bal: Rs 1000.00
    const balRs = find(/Bal[:\s]+Rs\.?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/i, message);
    if (balRs) {
      return toPaise(gv(balRs, 1));
    }

    // Pattern 2: Available Balance: Rs 1000.00
    const availableBal = find(/Available\s+Balance[:\s]+Rs\.?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/i, message);
    if (availableBal) {
      return toPaise(gv(availableBal, 1));
    }

    // Pattern 3: Avl Bal Rs 1000.00
    const avlBal = find(/Avl\s+Bal[:\s]+Rs\.?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/i, message);
    if (avlBal) {
      return toPaise(gv(avlBal, 1));
    }

    // Fall back to base class
    return super.extractBalance(message);
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    // Skip future debit notifications
    if (lowerMessage.includes('will be')) {
      return false;
    }

    // Skip if it contains the customer care message but ensure it's a transaction
    if (lowerMessage.includes('call') && lowerMessage.includes('if not done by you')) {
      // This is likely a transaction message with a security notice
      // Check if it contains transaction keywords
      if (
        lowerMessage.includes('debited') ||
        lowerMessage.includes('credited') ||
        lowerMessage.includes('withdrawn') ||
        lowerMessage.includes('transferred')
      ) {
        return true;
      }
    }

    // Skip OTP and verification messages
    if (
      lowerMessage.includes('otp') ||
      lowerMessage.includes('one time password') ||
      lowerMessage.includes('verification code')
    ) {
      return false;
    }

    // Skip promotional messages
    if (
      lowerMessage.includes('offer') ||
      lowerMessage.includes('discount') ||
      lowerMessage.includes('cashback offer') ||
      lowerMessage.includes('win ')
    ) {
      return false;
    }

    // Fall back to base class for standard checks
    return super.isTransactionMessage(message);
  }
}
