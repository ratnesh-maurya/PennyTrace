// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `StandardCharteredBankParser.kt`: Standard Chartered India and Pakistan
// (PKR) messages from senders like `VM-SCBANK-S`, `StanChart`, `9220`.
import type { Paise } from '../../types';
import { BankParser } from '../engine/BankParser';
import { toPaise } from '../engine/patterns';
import { find, gv, hasLetter, matches, takeLast, test } from '../engine/regex';
import { TransactionType, type BankTxn } from '../engine/types';

/**
 * Parser for Standard Chartered Bank SMS messages (India and Pakistan)
 *
 * Supported formats:
 * - UPI Debit: "Your a/c XX3421 is debited for Rs. 302.00 on 03-12-2025 15:49 and credited to a/c XX1465 (UPI Ref no 487597904232)"
 * - NEFT Credit: "Dear Customer, there is an NEFT credit of INR 48,796.00 in your account 123xxxx7655 on 1/11/2025.Available Balance:INR 97,885.05"
 * - PKR RAAST: "Dear Customer, PKR 55,000.00 sent to SCB PK A/C ****9901 for FUNDSTRANSFER 001 on 06-Feb-26 14:22 via RAAST"
 * - PKR IBFT: "Dear Client, an electronic funds transfer of PKR 5,000.00 has been made into your Account No. 0101xxx9901"
 * Common senders: VM-SCBANK-S, VD-SCBANK-S, JK-SCBANK-S, SCBANK, StanChart, 9220 (Pakistan)
 */
export class StandardCharteredBankParser extends BankParser {
  readonly id = 'standard-chartered';

  getBankName(): string {
    return 'Standard Chartered Bank';
  }

  canHandle(sender: string): boolean {
    const upperSender = sender.toUpperCase();
    return (
      upperSender.includes('SCBANK') ||
      upperSender.includes('STANCHART') ||
      upperSender.includes('STANDARDCHARTERED') ||
      upperSender.includes('STANDARD CHARTERED') ||
      upperSender === '9220' ||
      matches(/^[A-Z]{2}-SCBANK-[A-Z]$/, upperSender)
    );
  }

  parse(smsBody: string, sender: string, timestamp: number): BankTxn | null {
    const parsed = super.parse(smsBody, sender, timestamp);
    if (parsed == null) return null;

    const lower = smsBody.toLowerCase();
    let currency: string;
    if (lower.includes('pkr')) {
      currency = 'PKR';
    } else if (lower.includes('usd')) {
      currency = 'USD';
    } else {
      currency = parsed.currency;
    }

    return { ...parsed, currency };
  }

  protected extractAmount(message: string): Paise | null {
    const patterns = [
      // Pakistan: "PKR 55,000.00"
      /PKR\s+([0-9,]+(?:\.\d{2})?)/i,
      // International: "USD 79.00 have been paid at ..."
      /\b(?:USD)\s+([0-9,]+(?:\.\d{2})?)/i,
      // India Pattern 1: "is debited for Rs. 302.00"
      /is debited for Rs\.\s*([0-9,]+(?:\.\d{2})?)/i,
      // India Pattern 2: "NEFT credit of INR 48,796.00"
      /(?:NEFT|RTGS|IMPS)\s+credit\s+of\s+INR\s+([0-9,]+(?:\.\d{2})?)/i,
      // India Pattern 3: "is credited for Rs. xxx"
      /is credited for Rs\.\s*([0-9,]+(?:\.\d{2})?)/i,
    ];
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return toPaise(gv(m, 1));
      }
    }

    return super.extractAmount(message);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();
    const isCreditCard = lowerMessage.includes('credit card');

    // Pakistan-specific
    if (lowerMessage.includes('payment of') && lowerMessage.includes('financing')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('transaction of pkr') && lowerMessage.includes('using online banking')) {
      return TransactionType.EXPENSE;
    }
    if (lowerMessage.includes('withdrawn from account')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('cash withdrawal transaction')) {
      return isCreditCard ? TransactionType.CREDIT : TransactionType.EXPENSE;
    }
    if (lowerMessage.includes('paid at')) {
      return isCreditCard ? TransactionType.CREDIT : TransactionType.EXPENSE;
    }
    if (lowerMessage.includes('transaction of pkr') && lowerMessage.includes('to')) return TransactionType.TRANSFER;
    if (lowerMessage.includes('sent to scb pk')) return TransactionType.INCOME;
    if (lowerMessage.includes('electronic funds transfer') && lowerMessage.includes('into your account')) {
      return TransactionType.INCOME;
    }
    if (lowerMessage.includes('has been credited')) return TransactionType.INCOME;

    // India-specific
    if (lowerMessage.includes('is debited for')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('neft credit')) return TransactionType.INCOME;
    if (lowerMessage.includes('rtgs credit')) return TransactionType.INCOME;
    if (lowerMessage.includes('imps credit')) return TransactionType.INCOME;
    if (lowerMessage.includes('is credited for')) return TransactionType.INCOME;

    return super.extractTransactionType(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    const lower = message.toLowerCase();

    // Pakistan-specific merchant patterns
    if (lower.includes('sent to scb pk')) {
      return 'RAAST Transfer';
    }
    if (lower.includes('financing facility')) {
      return 'Financing Payment';
    }
    if (lower.includes('withdrawn') || lower.includes('cash withdrawal')) {
      return 'ATM Cash Withdrawal';
    }

    // India Pattern 1: "credited to a/c XX1465" (for debit/UPI transfers)
    const upiTransfer = find(/and credited to a\/c ([X*]+\d+)/i, message);
    if (upiTransfer) {
      const accountNum = gv(upiTransfer, 1);
      return `UPI Transfer to ${accountNum}`;
    }

    // India Pattern 2: NEFT/RTGS/IMPS credits
    if (lower.includes('neft credit')) {
      return 'NEFT Credit';
    }
    if (lower.includes('rtgs credit')) {
      return 'RTGS Credit';
    }
    if (lower.includes('imps credit')) {
      return 'IMPS Credit';
    }

    // Pakistan: "paid at ELITE CLUB on"
    const paidAt = find(/paid at\s+([A-Za-z0-9\s.-]+?)\s+on/i, message);
    if (paidAt) {
      return this.cleanMerchantName(gv(paidAt, 1));
    }

    // Pakistan: "to TANBITS on" (online banking transfer)
    const transferTo = find(/to\s+([A-Za-z0-9*]+)(?:\s|$)/i, message);
    if (transferTo) {
      const dest = gv(transferTo, 1);
      if (dest.trim() !== '') {
        const normalized = dest.toLowerCase();
        const skip = normalized === 'your' || normalized === 'account' || normalized === 'iban' || normalized === 'acct';
        if (!skip) {
          if (/^\*+$/.test(dest)) return 'Transfer';
          if (dest.startsWith('****')) return `Transfer to ${takeLast(dest, 4)}`;
          if (dest.length >= 3 && dest.length <= 8 && hasLetter(dest)) return this.cleanMerchantName(dest);
          if (dest.length >= 3 && dest.length <= 8) return `Transfer to ${dest}`;
          return 'Transfer';
        }
      }
    }

    // Pakistan: "from account 18-87xxxxx-9039959 PAYONEER from IBFT"
    const fromAccount = find(
      /from account\s+[A-Za-z0-9\-*xX]+(?:\s+([A-Z][A-Za-z0-9\s]+?))(?:\s+from\s+IBFT|\s+via|\s+on|\s*$)/i,
      message,
    );
    if (fromAccount) {
      const name = gv(fromAccount, 1).trim();
      if (name !== '') {
        return this.cleanMerchantName(name);
      }
    }

    if (test(/from account\s+[A-Za-z0-9\-*xX]+/i, message)) {
      return 'IBFT Transfer';
    }

    if (lower.includes('raast')) {
      return 'RAAST Transfer';
    }

    if (lower.includes('ibft') || lower.includes('electronic funds transfer')) {
      return 'IBFT Transfer';
    }

    return super.extractMerchant(message, sender);
  }

  protected extractAccountLast4(message: string): string | null {
    const fromBase = super.extractAccountLast4(message);
    if (fromBase != null) return fromBase;

    // Each pattern returns as soon as it matches (even if no digits survive), as upstream.
    const patterns = [
      // India Pattern 1: "Your a/c XX3421"
      /Your a\/c ([X*\d]+)/i,
      // India Pattern 2: "in your account 123xxxx7655"
      /in your account ([0-9xX*]+)/i,
      // Pakistan Pattern 3: "A/C ****9901" or "Account No. 0101xxx9901"
      /(?:A\/C\s*|Account No\.\s*|Acc\. Number\s*|Iban\.\s*)([0-9Xx*]+)/i,
      // Pakistan Pattern 4: "credit/debit card no 53119xxxxxxxx1640"
      /card no\.?\s*([0-9Xx*\s-]+)/i,
      // Pakistan Pattern 5: "your account 01-01***9901"
      /your account\s+([0-9\-*xX]+)/i,
      // Pakistan Pattern 6: "account 01-70***32-01"
      /account\s+([0-9\-*xX]+)/i,
    ];
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return this.extractLast4Digits(gv(m, 1));
      }
    }

    return null;
  }

  protected extractReference(message: string): string | null {
    const patterns = [
      // India: "UPI Ref no 487597904232"
      /UPI Ref no (\d+)/i,
      // Pakistan: "TX ID FAYS2602061422..."
      /TX ID ([A-Z0-9]+)/i,
      // Pakistan: "Transaction ID:PK-019-..."
      /Transaction ID:([A-Z0-9-]+)/i,
    ];
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return gv(m, 1);
      }
    }

    return super.extractReference(message);
  }

  protected extractBalance(message: string): Paise | null {
    const patterns = [
      // India: "Available Balance:INR 97,885.05"
      /Available Balance:\s*INR\s+([0-9,]+(?:\.\d{2})?)/i,
      // Pakistan: "Avail Limit PKR 18062.81"
      /Avail Limit\s*PKR\s*([0-9,]+(?:\.\d{2})?)/i,
    ];
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return toPaise(gv(m, 1));
      }
    }

    return super.extractBalance(message);
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    if (
      lowerMessage.includes('is debited for') ||
      lowerMessage.includes('is credited for') ||
      lowerMessage.includes('neft credit') ||
      lowerMessage.includes('rtgs credit') ||
      lowerMessage.includes('imps credit') ||
      lowerMessage.includes('withdrawn from account') ||
      lowerMessage.includes('cash withdrawal transaction') ||
      lowerMessage.includes('paid at') ||
      lowerMessage.includes('payment of') ||
      lowerMessage.includes('transaction of pkr') ||
      lowerMessage.includes('sent to scb pk') ||
      lowerMessage.includes('electronic funds transfer') ||
      lowerMessage.includes('has been credited')
    ) {
      return true;
    }

    return super.isTransactionMessage(message);
  }
}
