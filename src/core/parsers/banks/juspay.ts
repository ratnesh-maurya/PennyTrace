// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `bank/JuspayParser.kt`.
import type { Instrument, Paise } from '../../types';
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { toPaise } from '../engine/patterns';
import { find, gv } from '../engine/regex';
import { TransactionType } from '../engine/types';

/**
 * Parser for Juspay/Amazon Pay wallet transactions.
 * Handles messages from XX-JUSPAY-X, APAY, and similar senders.
 */
export class JuspayParser extends BaseIndianBankParser {
  readonly id = 'juspay';
  readonly defaultInstrument: Instrument | undefined = 'wallet' as const;

  getBankName(): string {
    return 'Amazon Pay';
  }

  getCurrency(): string {
    return 'INR';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return (
      normalizedSender.includes('JUSPAY') || normalizedSender.includes('APAY') || normalizedSender === 'AMAZON PAY'
    );
  }

  protected extractAmount(message: string): Paise | null {
    const patterns = [
      // Pattern 1: "Your Apay Wallet balance is debited for INR Xxx"
      /debited\s+for\s+INR\s+([0-9,]+(?:\.[0-9]{1,2})?)/i,
      // Pattern 2: "Payment of Rs xxx using Apay Balance"
      /Payment\s+of\s+Rs\s+([0-9,]+(?:\.[0-9]{1,2})?)/i,
      // Pattern 3: "Rs xxx" generic pattern
      /Rs\s+([0-9,]+(?:\.[0-9]{1,2})?)/i,
      // Pattern 4: "INR xxx" generic pattern
      /INR\s+([0-9,]+(?:\.[0-9]{1,2})?)/i,
    ];
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return toPaise(gv(m, 1));
      }
    }

    return super.extractAmount(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    const lowerMessage = message.toLowerCase();

    // Pattern 1: "successful at merchant" - improved to capture multi-word merchants
    // Captures everything between "successful at" and the period or "Updated Balance"
    const m = find(/successful\s+at\s+(.+?)(?:\.\s*Updated|\s*\.\s*Updated|\.(?:\s|$))/i, message);
    if (m) {
      return gv(m, 1).trim();
    }

    // Pattern 2: Common merchant indicators
    if (lowerMessage.includes('amazon')) return 'Amazon';
    if (lowerMessage.includes('flipkart')) return 'Flipkart';
    if (lowerMessage.includes('swiggy')) return 'Swiggy';
    if (lowerMessage.includes('zomato')) return 'Zomato';
    if (lowerMessage.includes('ola')) return 'Ola';
    if (lowerMessage.includes('uber')) return 'Uber';
    if (lowerMessage.includes('zepto')) return 'Zepto';
    if (lowerMessage.includes('blinkit')) return 'Blinkit';
    if (lowerMessage.includes('apay wallet')) return 'Amazon Pay Transaction';
    if (lowerMessage.includes('wallet')) return 'Amazon Pay Transaction';
    return super.extractMerchant(message, sender) ?? 'Amazon Pay';
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('debited')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('payment')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('charged')) return TransactionType.EXPENSE;
    if (lowerMessage.includes('credited')) return TransactionType.CREDIT;
    if (lowerMessage.includes('refunded')) return TransactionType.CREDIT;
    if (lowerMessage.includes('received')) return TransactionType.CREDIT;
    return null;
  }

  protected extractReference(message: string): string | null {
    const patterns = [
      // Pattern 1: "Transaction Reference Number is 123456789012"
      /Transaction\s+Reference\s+Number\s+is\s+(\d{12})/i,
      // Pattern 2: "Reference Number: 123456789012"
      /Reference\s+(?:Number|No)[:\s]+(\d{12})/i,
    ];
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return gv(m, 1);
      }
    }

    return super.extractReference(message);
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    // Check for transaction keywords
    const transactionKeywords = [
      'debited for',
      'payment of rs',
      'using apay balance',
      'transaction reference number',
      'updated balance is',
    ];

    return transactionKeywords.some(k => lowerMessage.includes(k)) || super.isTransactionMessage(message);
  }
}
