// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `bank/ICICIBankParser.kt`.
import type { Paise } from '../../types';
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { toPaise } from '../engine/patterns';
import { find, gv, matches, test } from '../engine/regex';
import { TransactionType, type BankTxn } from '../engine/types';

/**
 * Parser for ICICI Bank SMS messages
 *
 * Supported formats:
 * - Debit: "Your account has been successfully debited with Rs xxx.00"
 * - Credit: "Acct XXxxx is credited with Rs xxx.00"
 * - UPI: "ICICI Bank Acct XXxxx debited for Rs xxx.00"
 * - Cash Deposit: "Cash deposit transaction of Rs xxx in ICICI Bank Account 1234XXXX1234 has been completed"
 * - AutoPay transactions
 * - Multi-currency: "USD 11.80 spent using ICICI Bank Card"
 *
 * Common senders: XX-ICICIB-S, ICICIB, ICICIBANK
 */
export class IciciBankParser extends BaseIndianBankParser {
  readonly id = 'icici';

  getBankName(): string {
    return 'ICICI Bank';
  }

  parse(smsBody: string, sender: string, timestamp: number): BankTxn | null {
    // Skip non-transaction messages
    if (!this.isTransactionMessage(smsBody)) {
      return null;
    }

    const amount = this.extractAmount(smsBody);
    if (amount == null) {
      return null;
    }

    // Detect ICICI's dual-account transfer pattern (e.g. IMPS where the SMS
    // mentions both `Acct XX debited` and `Acct YY credited` in the same body).
    // This routes such SMS to TRANSFER so a later pipeline pass can dedupe
    // against the credit-side SMS using the IMPS/NEFT reference.
    const transferAccounts = this.extractTransferAccounts(smsBody);

    let type: TransactionType;
    if (transferAccounts != null) {
      type = TransactionType.TRANSFER;
    } else {
      const extracted = this.extractTransactionType(smsBody);
      if (extracted == null) {
        return null;
      }
      type = extracted;
    }

    // Extract currency dynamically for multi-currency support
    const currency = this.extractCurrencyFromMessage(smsBody) ?? 'INR';

    // Extract available limit for credit card transactions
    const availableLimit = type === TransactionType.CREDIT ? this.extractAvailableLimit(smsBody) : null;

    const merchant = transferAccounts != null ? this.labelTransferRail(smsBody) : this.extractMerchant(smsBody, sender);

    return this.txn({
      amount,
      type,
      merchant,
      reference: this.extractReference(smsBody),
      accountLast4: transferAccounts?.[0] ?? this.extractAccountLast4(smsBody),
      balance: this.extractBalance(smsBody),
      creditLimit: availableLimit,
      smsBody,
      sender,
      timestamp,
      isFromCard: this.detectIsCard(smsBody),
      currency,
      fromAccount: transferAccounts?.[0] ?? null,
      toAccount: transferAccounts?.[1] ?? null,
    });
  }

  private labelTransferRail(message: string): string {
    const lower = message.toLowerCase();
    if (lower.includes('imps')) return 'IMPS Transfer';
    if (lower.includes('neft')) return 'NEFT Transfer';
    return 'Account Transfer';
  }

  /**
   * Detects ICICI's `Acct XX debited ... & Acct YY credited` IMPS/NEFT pattern
   * and returns (fromAccount, toAccount) when both account references appear
   * in the same SMS and differ. Returns null otherwise so the regular type
   * extraction stays in charge.
   */
  private extractTransferAccounts(message: string): [string, string] | null {
    const debitedMatch = find(/Acct\s+([X*\d]+)\s+(?:is\s+)?debited/i, message);
    if (!debitedMatch) return null;
    const creditedMatch = find(/Acct\s+([X*\d]+)\s+(?:is\s+)?credited/i, message);
    if (!creditedMatch) return null;

    const fromAcct = this.extractLast4Digits(gv(debitedMatch, 1));
    const toAcct = this.extractLast4Digits(gv(creditedMatch, 1));

    if (!fromAcct || fromAcct.trim() === '' || !toAcct || toAcct.trim() === '' || fromAcct === toAcct) {
      return null;
    }
    return [fromAcct, toAcct];
  }

  /**
   * Extract currency from ICICI transaction messages
   * Handles formats like "USD 11.80 spent" or "EUR 50.00 spent"
   */
  private extractCurrencyFromMessage(message: string): string | null {
    // Pattern for "USD 11.80 spent" format
    // Same optional integer part as extractAmount — "USD .28 spent" has to
    // match here too, or the amount is tagged INR.
    const m = find(/([A-Z]{3})\s+(?:[0-9,]+(?:\.\d{1,2})?|\.\d{1,2})\s+spent/i, message);
    if (m) {
      const currency = gv(m, 1).toUpperCase();
      // Validate it's a valid currency code (3 letters, not month abbreviations)
      if (currency.length === 3 && !matches(/^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/, currency)) {
        return currency;
      }
    }
    return null;
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return (
      normalizedSender.includes('ICICI') ||
      normalizedSender.includes('ICICIB') ||
      // DLT patterns for transactions (-S suffix)
      matches(/^[A-Z]{2}-ICICIB-S$/, normalizedSender) ||
      matches(/^[A-Z]{2}-ICICI-S$/, normalizedSender) ||
      // Other DLT patterns
      matches(/^[A-Z]{2}-ICICIB-[TPG]$/, normalizedSender) ||
      // Legacy patterns
      matches(/^[A-Z]{2}-ICICIB$/, normalizedSender) ||
      matches(/^[A-Z]{2}-ICICI$/, normalizedSender) ||
      // Direct sender IDs
      normalizedSender === 'ICICIB' ||
      normalizedSender === 'ICICIBANK'
    );
  }

  protected extractAmount(message: string): Paise | null {
    const patterns = [
      // Pattern 1: Multi-currency support - "USD 11.80 spent" or "EUR 50.00 spent"
      // The integer part is optional: ICICI prints sub-unit amounts as
      // "USD .28 spent". Without this the pattern missed the real amount and
      // a later pattern picked up "Avl Limit: INR 3,85,664.53" instead.
      /[A-Z]{3}\s+((?:[0-9,]+(?:\.\d{1,2})?|\.\d{1,2}))\s+spent/i,
      // Pattern 2: "Rs xxx.xx spent" or "INR xxx.xx spent" (for INR card transactions)
      /(?:Rs\.?|INR)\s+((?:[0-9,]+(?:\.\d{1,2})?|\.\d{1,2}))\s+spent/i,
      // Pattern 2: "debited with Rs xxx.00"
      /debited\s+with\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
      // Pattern 3: "debited for Rs xxx.00"
      /debited\s+for\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
      // Pattern 4: "credited with Rs xxx.00"
      /credited\s+with\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
      // Pattern 5: "credited:Rs. xxx.xx" (colon format for cash deposits)
      /credited:\s*Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
    ];
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return toPaise(gv(m, 1));
      }
    }

    // Fall back to base class patterns
    return super.extractAmount(message);
  }

  protected extractMerchant(message: string, sender: string): string | null {
    const lower = message.toLowerCase();

    // Pattern 0: NEFT/RTGS transfer to beneficiary - use "NEFT Transfer" as merchant
    // These are outgoing transfers where we don't know the beneficiary name
    if (lower.includes('credited to the beneficiary') || lower.includes('credited to beneficiary')) {
      return 'NEFT Transfer';
    }

    // Pattern 0b: Incoming NEFT credit - "Info NEFT-<refcode>-<PAYER NAME>"
    // The payer name follows the NEFT reference code (after the last hyphen),
    // e.g. "Info NEFT-FDRLM4175907234-JOHN JOSE." -> "JOHN JOSE".
    const neftCredit = find(/Info\s+NEFT-[A-Za-z0-9]+-(.+?)(?:\.|$)/i, message);
    if (neftCredit) {
      const merchant = this.cleanMerchantName(gv(neftCredit, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }

    // Pattern 1: Salary transactions - "Info INF*...*...* SAL ..."
    // Example: "Info INF*000169831922*IQBO SAL FE"
    if (test(/Info\s+INF\*[^*]+\*[^*]*SAL[^.]*/i, message)) {
      return 'Salary';
    }

    // Pattern 2: NFS Cash Withdrawal - various ATM withdrawal formats
    // Examples: "NFSCASH WDL", "NFS CASH WDL", "NFS*CASH WDL*", "CASH WDL"
    if (
      lower.includes('nfscash wdl') ||
      lower.includes('nfs cash wdl') ||
      lower.includes('nfs*cash wdl') ||
      lower.includes('cash wdl') ||
      lower.includes('nfscash')
    ) {
      return 'Cash Withdrawal';
    }

    // Pattern 2a: ATM cash withdrawal marker - "CAM*<code>*"
    // ICICI uses a "CAM*<terminal/ref code>*" token to mark cash withdrawals.
    // Emit a clean label instead of the raw marker code.
    // Closing "*" is optional — some variants omit it.
    if (test(/\bCAM\*[A-Za-z0-9]+\*?/i, message)) {
      return 'ATM Withdrawal';
    }

    const merchantPatterns = [
      // Pattern 2b: Bill-pay biller - "InfoBIL*<biller name>"
      // ICICI's generic bill-pay format. The biller name runs until the
      // sentence boundary: a ".", the "Avl/Avb Bal" balance clause, or end of
      // segment — so the capture doesn't absorb the tail when the "." is absent.
      /InfoBIL\*(.+?)(?=\.|\s*Av[bl]\s*Bal|$)/i,
      // Pattern 3: Card transactions - "on DD-Mon-YY at MERCHANT NAME. Avl" or "on DD-Mon-YY on MERCHANT NAME"
      /on\s+\d{1,2}-\w{3}-\d{2}\s+(?:at|on)\s+([^.]+?)(?:\.|\s+Avl|$)/i,
      // Pattern: "for UPI-REFNO-MERCHANT" (credit card UPI transactions)
      /for\s+UPI-\d+-([A-Za-z][\w\s]*?)(?:\.|$|\s+To\s)/i,
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

    // Pattern 3: ACH/NACH dividend payments - "Info ACH*COMPANY NAME*XXX"
    const achNach = find(/Info\s+(?:ACH|NACH)\*([^*]+)\*/i, message);
    if (achNach) {
      const companyName = this.cleanMerchantName(gv(achNach, 1).trim());
      // Append "Dividend" to make categorization clear
      return `${companyName} Dividend`;
    }

    const morePatterns = [
      // Pattern 3: "towards <merchant> for"
      /towards\s+([^.\n]+?)\s+for/i,
      // Pattern 4: "from <name>. UPI"
      /from\s+([^.\n]+?)\.\s*UPI/i,
      // Pattern 5: "; <name> credited. UPI"
      /;\s*([^.\n]+?)\s+credited\.\s*UPI/i,
    ];
    for (const pattern of morePatterns) {
      const m = find(pattern, message);
      if (m) {
        const merchant = this.cleanMerchantName(gv(m, 1).trim());
        if (this.isValidMerchantName(merchant)) {
          return merchant;
        }
      }
    }

    // Pattern 6: Cash deposit via "Info BY CASH" pattern
    if (lower.includes('info by cash')) {
      return 'Cash Deposit';
    }

    // Pattern 7: AutoPay specific - extract service name
    if (lower.includes('autopay')) {
      // Look for common AutoPay services
      if (lower.includes('google play')) return 'Google Play Store';
      if (lower.includes('netflix')) return 'Netflix';
      if (lower.includes('spotify')) return 'Spotify';
      if (lower.includes('amazon prime')) return 'Amazon Prime';
      if (lower.includes('disney') || lower.includes('hotstar')) return 'Disney+ Hotstar';
      if (lower.includes('youtube')) return 'YouTube Premium';
      return 'AutoPay Subscription';
    }

    // Fall back to base class patterns
    return super.extractMerchant(message, sender);
  }

  protected extractAccountLast4(message: string): string | null {
    const fromSuper = super.extractAccountLast4(message);
    if (fromSuper != null) {
      return fromSuper;
    }
    const patterns = [
      // Pattern 1: "ICICI Bank Card XXNNNN"
      /ICICI\s+Bank\s+Card\s+([X*\d]+)/i,
      // Pattern 2: "ICICI Bank Credit Card XX1234"
      /ICICI\s+Bank\s+Credit\s+Card\s+([X*\d]+)/i,
      // Pattern 3: "ICICI Bank Account XXNNNN"
      /ICICI\s+Bank\s+Account\s+([X*\d]+)/i,
      // Pattern 4: "ICICI Bank Acct XXNNNN"
      /ICICI\s+Bank\s+Acct\s+([X*\d]+)/i,
      // Pattern 5: "ICICI Bank Acc XX921"
      /ICICI\s+Bank\s+Acc\s+([X*\d]+)/i,
      // Pattern 6: "Acct XX1234" or "Acct *1234"
      /Acct\s+([X*\d]+)(?:\s|$|[,;.])/i,
      // Pattern 7: "Acc XX921"
      /Acc\s+([X*\d]+)(?:\s|$|[,;.])/i,
    ];
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return this.extractLast4Digits(gv(m, 1));
      }
    }
    return null;
  }

  protected extractBalance(message: string): Paise | null {
    const patterns = [
      // Pattern 1: "Available Balance is Rs. 28,076.14" (ICICI-specific format with "is")
      /Available\s+Balance\s+is\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
      // Pattern 2: "Avl Bal Rs 10,000.00" or "Avb Bal Rs 10,000.00" (typo variant)
      /Av[lb]\s+Bal\s+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
      // Pattern 3: "Updated Bal: Rs 5,000.00"
      /Updated\s+Bal[:\s]+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
    ];
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return toPaise(gv(m, 1));
      }
    }

    // Fall back to base class
    return super.extractBalance(message);
  }

  protected extractReference(message: string): string | null {
    const patterns = [
      // Pattern 0: "IMPS:xxxxx" — keep ahead of UPI so dual-rail SMS pick the IMPS ref
      /IMPS:([A-Za-z0-9]+)/i,
      // Pattern 1: "RRN 1xxxxx3xxxxx"
      /RRN\s+([A-Za-z0-9]+)/i,
      // Pattern 2: "UPI:5xxxxx8xxxxx"
      /UPI:([A-Za-z0-9]+)/i,
      // Pattern 3: "transaction reference no.MCDA001746000000"
      /transaction\s+reference\s+no\.?([A-Z0-9]+)/i,
    ];
    for (const pattern of patterns) {
      const m = find(pattern, message);
      if (m) {
        return gv(m, 1);
      }
    }

    // Fall back to base class
    return super.extractReference(message);
  }

  protected isTransactionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    // SMS BLOCK instructions ("SMS BLOCK ... to 9215676766") are just trailing instruction
    // text on transaction messages — upstream deliberately does not skip on them.

    // Skip cash deposit confirmation messages (these are duplicates)
    // We only want to process the actual credit notification
    if (lowerMessage.includes('cash deposit transaction') && lowerMessage.includes('has been completed')) {
      return false; // Skip this confirmation message
    }

    // Skip payment due reminders
    if (lowerMessage.includes('is due by')) {
      return false;
    }

    // Skip future debit notifications - these are not actual transactions yet
    // Examples: "will be debited on", "will be debited with", "account will be debited"
    if (lowerMessage.includes('will be debited')) {
      return false;
    }

    // Skip credit card bill payment confirmations - these are transfers between own accounts
    // Example: "Payment of Rs 26,266.00 has been received on your ICICI Bank Credit Card XX9006..."
    if (lowerMessage.includes('has been received on your icici bank credit card')) {
      return false;
    }

    // Check for ICICI-specific transaction keywords
    const iciciKeywords = [
      'debited with',
      'debited for',
      'credited with',
      'credited:', // For "credited:Rs." format
      'autopay',
      'your account has been',
      'inr', // For "INR xxx spent" pattern
      'spent using', // For card transactions
    ];

    // If any ICICI-specific pattern is found, it's likely a transaction
    // BUT make sure it's not a future transaction (already filtered above)
    if (iciciKeywords.some(k => lowerMessage.includes(k))) {
      return true;
    }

    // Fall back to base class for standard checks
    return super.isTransactionMessage(message);
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lowerMessage = message.toLowerCase();

    // NEFT/RTGS transfer confirmation to sender - "credited to the beneficiary account"
    // This means the sender's money was sent OUT to the beneficiary
    if (lowerMessage.includes('credited to the beneficiary') || lowerMessage.includes('credited to beneficiary')) {
      return TransactionType.EXPENSE;
    }

    // Credit card transactions - both "ICICI Bank Credit Card" and "ICICI Bank Card" with spent
    if (
      (lowerMessage.includes('icici bank credit card') ||
        (lowerMessage.includes('icici bank card') && lowerMessage.includes('spent'))) &&
      (lowerMessage.includes('spent') || lowerMessage.includes('debited'))
    ) {
      return TransactionType.CREDIT;
    }

    // Cash deposit via "Info BY CASH" is income
    if (lowerMessage.includes('info by cash')) {
      return TransactionType.INCOME;
    }

    // Fall back to base class for standard checks
    return super.extractTransactionType(message);
  }
}
