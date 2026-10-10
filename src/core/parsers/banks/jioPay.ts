// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `JioPayParser.kt`.

import type { Paise } from '../../types';
import { BankParser } from '../engine/BankParser';
import { toPaise } from '../engine/patterns';
import { find, gv } from '../engine/regex';
import { TransactionType } from '../engine/types';

/**
 * Parser for JioPay wallet transactions.
 * Handles messages from JA-JioPay-S and similar senders.
 *
 * Note: Wallet transactions are marked as CREDIT to avoid double-counting
 * (money already counted when loading wallet from bank account)
 */
export class JioPayParser extends BankParser {
  readonly id = 'jiopay';
  readonly defaultInstrument = 'wallet' as const;

  getBankName(): string {
    return 'JioPay';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return (
      normalizedSender.includes('JIOPAY') ||
      normalizedSender.endsWith('-JIOPAY-S') ||
      normalizedSender.endsWith('-JIOPAY-T') ||
      normalizedSender === 'JM-JIOPAY'
    );
  }

  protected extractAmount(message: string): Paise | null {
    // Pattern 1: "Plan Name : 249.00"
    const plan = find(/Plan\s+Name\s*:\s*([0-9,]+(?:\.\d{2})?)/i, message);
    if (plan) {
      return toPaise(gv(plan, 1));
    }

    // Pattern 2: "Rs. 249.00" or "Rs 249"
    const rs = find(/Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i, message);
    if (rs) {
      return toPaise(gv(rs, 1));
    }

    // Fall back to base class patterns
    return super.extractAmount(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    const lowerMessage = message.toLowerCase();

    // Jio Recharge
    if (lowerMessage.includes('recharge successful') && lowerMessage.includes('jio number')) {
      // Extract the phone number for reference
      const number = gv(find(/Jio\s+Number\s*:\s*(\d{10})/i, message), 1);
      return number !== '' ? `Jio Recharge - ${number.slice(0, 4)}****` : 'Jio Recharge';
    }

    // Bill payment patterns
    if (lowerMessage.includes('bill payment')) {
      if (lowerMessage.includes('electricity')) return 'Electricity Bill';
      if (lowerMessage.includes('water')) return 'Water Bill';
      if (lowerMessage.includes('gas')) return 'Gas Bill';
      if (lowerMessage.includes('broadband')) return 'Broadband Bill';
      if (lowerMessage.includes('dth')) return 'DTH Recharge';
      return 'Bill Payment';
    }

    // Other recharges
    if (lowerMessage.includes('recharge')) {
      if (lowerMessage.includes('mobile')) return 'Mobile Recharge';
      if (lowerMessage.includes('dth')) return 'DTH Recharge';
      if (lowerMessage.includes('data')) return 'Data Recharge';
      return 'Recharge';
    }

    // Payment to merchant
    if (lowerMessage.includes('payment successful to')) {
      const m = find(/payment\s+successful\s+to\s+([^.\n]+)/i, message);
      if (m) {
        return this.cleanMerchantName(gv(m, 1).trim());
      }
      return 'JioPay Payment';
    }

    return super.extractMerchant(message, sender) ?? 'JioPay Transaction';
  }

  protected extractReference(message: string): string | null {
    // Pattern: "Transaction ID : BR000CAUBYON"
    const m = find(/Transaction\s+ID\s*:\s*([A-Z0-9]+)/i, message);
    if (m) {
      return gv(m, 1);
    }
    return super.extractReference(message);
  }

  protected extractTransactionType(message: string): TransactionType {
    const lowerMessage = message.toLowerCase();
    // Bill payment confirmations ("Payment of Rs... has been received") are expenses
    if (lowerMessage.includes('payment of') && lowerMessage.includes('has been received')) {
      return TransactionType.EXPENSE;
    }
    // All JioPay wallet transactions are marked as CREDIT
    // to avoid double-counting (money was already debited when loading wallet)
    return TransactionType.CREDIT;
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    // Reject bill notifications and reminders (not actual transactions)
    if (
      lowerMessage.includes('e-bill') ||
      lowerMessage.includes('bill has been sent') ||
      lowerMessage.includes('bill summary') ||
      lowerMessage.includes('payment due date') ||
      lowerMessage.includes('amount payable')
    ) {
      return false;
    }

    // JioPay messages don't use standard transaction keywords
    // but "recharge successful" indicates a transaction
    return lowerMessage.includes('recharge successful') || super.isTransactionMessage(message);
  }
}
