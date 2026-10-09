// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
//
// Upstream `bank/JKBankParser.kt`: Jammu & Kashmir Bank (JK Bank).
// Upstream also overrides `parse` only to compute a JK-Bank-specific transaction
// hash (with private helpers `generateJKBankHash`, `extractJKBankReference`,
// `extractTransactionTime`). PennyTrace does not use transaction hashes, so that
// override and its hash-only helpers are dropped.

import type { Paise } from '../../types';
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { toPaise } from '../engine/patterns';
import { find, gv, matches } from '../engine/regex';
import { TransactionType } from '../engine/types';

const includesIc = (s: string, x: string): boolean => s.toLowerCase().includes(x.toLowerCase());

/**
 * Jammu & Kashmir Bank (JK Bank) specific parser.
 * Handles JK Bank's message formats including:
 * - Standard debit/credit messages
 * - UPI transactions
 * - Account number patterns
 * - Balance updates
 */
export class JkBankParser extends BaseIndianBankParser {
  readonly id = 'jk-bank';

  getBankName(): string {
    return 'JK Bank';
  }

  canHandle(sender: string): boolean {
    const upperSender = sender.toUpperCase();

    // Common JK Bank sender IDs
    const jkBankSenders = new Set(['JKBANK', 'JKB', 'JKBANKL', 'JKBNK']);

    // Direct match
    if (jkBankSenders.has(upperSender)) {
      return true;
    }

    // DLT patterns (AD-JKBANK-S, etc.)
    const dltPatterns = [/^[A-Z]{2}-JKBANK.*$/, /^[A-Z]{2}-JKB.*$/, /^[A-Z]{2}-JKBNK.*$/, /^JKBANK-[A-Z]+$/, /^JKB-[A-Z]+$/];

    return dltPatterns.some(p => matches(p, upperSender));
  }

  protected extractMerchant(message: string, sender: string): string | null {
    // Check for IMPS Fund transfer pattern first
    // "Amt received from TRUEFILLINGS ADVISOR having A/C No."
    if (includesIc(message, 'IMPS Fund transfer')) {
      const impsPattern = /Amt\s+received\s+from\s+([^h]+?)(?:\s+having\s+A\/C|$)/i;
      const imps = find(impsPattern, message);
      if (imps) {
        const merchant = gv(imps, 1).trim();
        if (merchant !== '') {
          return this.cleanMerchantName(merchant);
        }
      }

      // Fallback pattern for "received from"
      const fromPattern = /received\s+from\s+([^.\n]+?)(?:\s+having|\s+with|$)/i;
      const from = find(fromPattern, message);
      if (from) {
        const merchant = gv(from, 1).trim();
        if (merchant !== '') {
          return this.cleanMerchantName(merchant);
        }
      }

      return 'IMPS Transfer';
    }

    // Check for TIN/Tax Information Network (handles both full and truncated versions)
    if (includesIc(message, 'TIN/Tax Information') || includesIc(message, 'TIN/Tax Informat')) {
      return 'Tax Information Network';
    }

    // Check for ATM Recovery and other charges
    if (includesIc(message, 'ATM RECOVERY')) {
      return 'ATM Recovery Charge';
    }

    // Check for "towards" pattern - common for tax and other payments
    const towardsPattern = /towards\s+([^.\n]+?)(?:\.\s*Avl|\.\s*Available|\.\s*To\s+dispute|$)/i;
    const towards = find(towardsPattern, message);
    if (towards) {
      const merchant = gv(towards, 1).trim();

      // Special handling for TIN/Tax patterns
      if (includesIc(merchant, 'TIN/Tax Informat') || includesIc(merchant, 'TIN/Tax Information')) {
        return 'Tax Information Network';
      }

      // Return the merchant name, cleaning it up
      return this.cleanMerchantName(merchant);
    }

    // Check for transaction patterns "by XXX" but skip the amount part
    // Pattern: "Debited by INR 402393 at 10:43 by RTGS-..."
    const transactionByPattern =
      /(?:Debited|Credited)\s+by\s+INR\s+[\d,]+(?:\.\d{2})?\s+at\s+[\d:]+\s+by\s+([^.\n]+?)(?:\.|Available|$)/i;
    const txnBy = find(transactionByPattern, message);
    if (txnBy) {
      const merchant = gv(txnBy, 1).trim();
      // Bank charges patterns - return null as these are internal bank charges
      if (includesIc(merchant, 'CHRGS') || includesIc(merchant, 'CHARGES')) return null;
      // Check for specific institutions
      if (includesIc(merchant, 'INDIAN CLEARING CORPO')) return 'Indian Clearing Corporation';
      if (includesIc(merchant, 'CLEARING CORPO')) return 'Clearing Corporation';
      if (includesIc(merchant, 'NSE CLEARING')) return 'NSE Clearing';
      if (includesIc(merchant, 'BSE CLEARING')) return 'BSE Clearing';
      // Generic transfer types (only if not charges)
      if (includesIc(merchant, 'RTGS') && !includesIc(merchant, 'CLEARING')) return 'RTGS Transfer';
      if (includesIc(merchant, 'NEFT')) return 'NEFT Transfer';
      if (includesIc(merchant, 'IMPS')) return 'IMPS Transfer';
      if (includesIc(merchant, 'eTFR')) return 'Transfer';
      if (includesIc(merchant, 'mTFR')) {
        // Extract the actual recipient name from mTFR/phone/NAME pattern
        const mtfrMatch = find(/mTFR\/\d+\/(.+)/i, merchant);
        return mtfrMatch ? this.cleanMerchantName(gv(mtfrMatch, 1).trim()) : 'Mobile Transfer';
      }
      if (includesIc(merchant, 'TIN')) return 'Tax Information Network';
      const slash = merchant.indexOf('/');
      return this.cleanMerchantName(slash >= 0 ? merchant.slice(0, slash) : merchant);
    }

    // Fallback pattern for simpler "by XXX" format
    const simpleByPattern = /by\s+([^.\n]+?)(?:\.|Available|$)/i;
    const simpleBy = find(simpleByPattern, message);
    if (simpleBy) {
      const merchant = gv(simpleBy, 1).trim();
      // Skip if it starts with INR (amount)
      if (!merchant.toUpperCase().startsWith('INR')) {
        return this.cleanMerchantName(merchant);
      }
    }

    // Pattern 1: "via UPI from SENDER NAME on" (for credits)
    if (includesIc(message, 'via UPI from')) {
      const fromPattern = /via\s+UPI\s+from\s+([^.\n]+?)\s+on/i;
      const m = find(fromPattern, message);
      if (m) {
        const merchant = gv(m, 1).trim();
        if (this.isValidMerchantName(merchant)) {
          return this.cleanMerchantName(merchant);
        }
      }
    }

    // Pattern 2: "by mTFR/962211111/SENDER NAME" (mPay transfer)
    // mTFR = mPay transfer, followed by mobile number, then sender name
    const mtfrPattern = /mTFR\/\d+\/([^.\n]+?)(?:\.|A\/C|$)/i;
    const mtfr = find(mtfrPattern, message);
    if (mtfr) {
      const merchant = gv(mtfr, 1).trim();
      if (this.isValidMerchantName(merchant)) {
        return this.cleanMerchantName(merchant);
      }
    }

    // Pattern 3: UPI transactions to merchant
    if (includesIc(message, 'via UPI')) {
      // Look for UPI VPA pattern
      const vpaPattern = /to\s+([^@\s]+@[^\s]+)/i;
      const vpaMatch = find(vpaPattern, message);
      if (vpaMatch) {
        const vpa = gv(vpaMatch, 1).trim();
        // Extract the part before @ as merchant name
        const at = vpa.indexOf('@');
        const merchantName = at >= 0 ? vpa.slice(0, at) : vpa;
        if (merchantName !== '' && merchantName !== 'upi') {
          return this.cleanMerchantName(merchantName);
        }
      }

      // Look for merchant after "to" but before "via UPI"
      const toMerchantPattern = /to\s+([^.\n]+?)\s+via\s+UPI/i;
      const toMerchant = find(toMerchantPattern, message);
      if (toMerchant) {
        const merchant = gv(toMerchant, 1).trim();
        if (this.isValidMerchantName(merchant)) {
          return this.cleanMerchantName(merchant);
        }
      }

      // Default to "UPI" if no specific merchant found
      return 'UPI';
    }

    // Check for ATM withdrawals
    if (includesIc(message, 'ATM') || includesIc(message, 'withdrawn')) {
      return 'ATM';
    }

    // Standard patterns for merchant extraction
    const merchantPatterns = [
      // Pattern for "to MERCHANT via"
      /to\s+([^.\n]+?)\s+via/i,
      // Pattern for "from MERCHANT"
      /from\s+([^.\n]+?)(?:\s+on|\s+Ref|$)/i,
      // Pattern for "at MERCHANT"
      /at\s+([^.\n]+?)(?:\s+on|\s+Ref|$)/i,
      // Pattern for "for MERCHANT"
      /for\s+([^.\n]+?)(?:\s+on|\s+Ref|$)/i,
    ];

    for (const pattern of merchantPatterns) {
      const m = find(pattern, message);
      if (m) {
        const merchant = this.cleanMerchantName(gv(m, 1).trim());
        if (this.isValidMerchantName(merchant)) {
          return merchant;
        }
      }
    }

    // Fall back to base extraction
    return super.extractMerchant(message, sender);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();

    // Check for investment-related transactions first
    if (
      lowerMessage.includes('clearing corpo') ||
      lowerMessage.includes('indian clearing') ||
      lowerMessage.includes('nse clearing') ||
      lowerMessage.includes('bse clearing') ||
      lowerMessage.includes('iccl') ||
      lowerMessage.includes('nsccl')
    ) {
      // Clearing corporations handle investment transactions
      // Credits are redemptions/dividends, debits are investments
      if (lowerMessage.includes('credited')) return TransactionType.INVESTMENT;
      if (lowerMessage.includes('debited')) return TransactionType.INVESTMENT;
      return null;
    }

    // JK Bank specific patterns
    if (lowerMessage.includes('has been debited')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('has been credited')) return TransactionType.INCOME;

    // Standard expense keywords
    if (lowerMessage.includes('debited')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('withdrawn')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('spent')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('charged')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('paid')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('purchase')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('transferred')) return TransactionType.EXPENSE;

    // Income keywords
    if (lowerMessage.includes('credited')) return TransactionType.INCOME;
    if (lowerMessage.includes('deposited')) return TransactionType.INCOME;
    if (lowerMessage.includes('received')) return TransactionType.INCOME;
    if (lowerMessage.includes('refund')) return TransactionType.INCOME;
    if (lowerMessage.includes('cashback') && !lowerMessage.includes('earn cashback')) return TransactionType.INCOME;

    return null;
  }

  protected extractReference(message: string): string | null {
    // JK Bank specific reference patterns
    const jkBankPatterns = [
      // RRN No.1234567890 for IMPS transfers
      /RRN\s+No\.?\s*(\d+)/i,
      // UPI Ref: 115458170728
      /UPI\s+Ref[:\s]+(\d+)/i,
      // txn Ref: XXXXX
      /txn\s+Ref[:\s]+([A-Z0-9]+)/i,
      // Reference: XXXXX
      /Reference[:\s]+([A-Z0-9]+)/i,
      // Ref No: XXXXX
      /Ref\s+No[:\s]+([A-Z0-9]+)/i,
    ];

    for (const pattern of jkBankPatterns) {
      const m = find(pattern, message);
      if (m) {
        return gv(m, 1).trim();
      }
    }

    // Fall back to base extraction
    return super.extractReference(message);
  }

  protected extractAccountLast4(message: string): string | null {
    const base = super.extractAccountLast4(message);
    if (base != null) {
      return base;
    }

    // JK Bank specific account patterns
    const jkBankPatterns = [
      // Your A/c XXXXXXXX1111 or A/c XX1111
      /A\/c\s+([X\d]+)/i,
      // JK Bank A/c no. XXXXXXXX9651
      /JK\s+Bank\s+A\/c\s+no\.\s+([X\d]+)/i,
      // Account XXXXXXXX1111
      /Account\s+([X\d]+)/i,
      // from A/c ending 1111
      /A\/c\s+ending\s+(\d{4})/i,
    ];

    for (const pattern of jkBankPatterns) {
      const m = find(pattern, message);
      if (m) {
        return this.extractLast4Digits(gv(m, 1));
      }
    }

    return null;
  }

  protected extractBalance(message: string): Paise | null {
    // JK Bank specific balance patterns
    const balancePatterns = [
      // Available Bal is INR XXXX Cr/Dr
      /Available\s+Bal\s+is\s+INR\s*([0-9,]+(?:\.\d{2})?)\s*(?:Cr|Dr)?/i,
      // A/C Bal is INR XXXX Cr/Dr
      /A\/C\s+Bal\s+is\s+INR\s*([0-9,]+(?:\.\d{2})?)\s*(?:Cr|Dr)?/i,
      // Avl Bal: Rs.XXXX
      /Avl\s+Bal[:\s]+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
      // Balance: Rs.XXXX
      /Balance[:\s]+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
      // Bal Rs.XXXX
      /Bal\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
    ];

    for (const pattern of balancePatterns) {
      const m = find(pattern, message);
      if (m) {
        return toPaise(gv(m, 1));
      }
    }

    // Fall back to base extraction
    return super.extractBalance(message);
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();

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

    // Skip payment request messages
    if (
      lowerMessage.includes('has requested') ||
      lowerMessage.includes('payment request') ||
      lowerMessage.includes('collect request') ||
      lowerMessage.includes('requesting payment')
    ) {
      return false;
    }

    // Skip RTGS/NEFT/IMPS confirmation messages
    // These are confirmations of transactions that already happened
    // Example: "Your RTGS Txn with UTR ... has been credited on ..."
    if (lowerMessage.includes('your rtgs txn') && lowerMessage.includes('has been credited')) {
      return false;
    }
    if (lowerMessage.includes('your neft txn') && lowerMessage.includes('has been credited')) {
      return false;
    }
    if (lowerMessage.includes('your imps txn') && lowerMessage.includes('has been credited')) {
      return false;
    }

    // Skip messages asking to report fraud
    // But make sure the transaction keywords are present
    if (lowerMessage.includes('if not done by you') || lowerMessage.includes('report immediately')) {
      // These are usually part of transaction messages, so check for transaction keywords
      const transactionKeywords = ['debited', 'credited', 'withdrawn', 'deposited', 'spent', 'received', 'transferred', 'paid'];
      return transactionKeywords.some(k => lowerMessage.includes(k));
    }

    // JK Bank specific transaction keywords
    const jkBankTransactionKeywords = [
      'has been debited',
      'has been credited',
      'debited',
      'credited',
      'withdrawn',
      'deposited',
      'spent',
      'received',
      'transferred',
      'paid',
    ];

    return jkBankTransactionKeywords.some(k => lowerMessage.includes(k));
  }
}
