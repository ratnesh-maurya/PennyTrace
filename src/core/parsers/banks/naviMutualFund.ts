// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `NaviMutualFundParser.kt`.
import type { Paise } from '../../types';
import { BankParser } from '../engine/BankParser';
import { toPaise } from '../engine/patterns';
import { find, gv } from '../engine/regex';
import { TransactionType } from '../engine/types';

/**
 * Navi Mutual Fund parser for SIP / unit-allotment SMS.
 *
 * Handles senders containing "NAVAMC" (Navi Asset Management Company),
 * e.g. "AD-NAVAMC-S", "VK-NAVAMC-T".
 *
 * Sample SMS:
 *   "Unit Allotment Update:
 *    Your SIP purchase of Rs.499.98 in Navi Nifty Next 50 Index Fund DG has been
 *    processed at applicable NAV. The units will be alloted in 1-2 working days.
 *    For further queries, please visit the Navi app.
 *    Team Navi Mutual Fund"
 *
 * Notes:
 * - Account number is not present in AMC unit-allotment SMS; left null.
 * - Underlying bank-side SIP debit (NACH/mandate) is parsed by the user's bank
 *   parser and will book a separate transaction.
 * - Mandate / autopay creation messages are NOT covered here; those originate
 *   from the user's bank, not the AMC.
 */
export class NaviMutualFundParser extends BankParser {
  readonly id = 'navi-mf';

  getBankName(): string {
    return 'Navi Mutual Fund';
  }

  canHandle(sender: string): boolean {
    // Keyed on "NAVAMC" specifically so we don't false-positive on generic
    // "NAVI" senders that may belong to Navi's banking arm.
    return sender.toUpperCase().includes('NAVAMC');
  }

  protected isTransactionMessage(message: string): boolean {
    const lower = message.toLowerCase();
    // Gate strictly on unit-allotment + SIP purchase phrasing so we ignore
    // NAV updates, account statements, marketing, etc.
    return lower.includes('unit allotment') && lower.includes('sip purchase');
  }

  protected extractAmount(message: string): Paise | null {
    // "purchase of Rs.499.98 in ..." — also tolerate optional space after Rs
    // and Indian-style comma grouping (e.g. "Rs. 1,49,999.98").
    const m = find(/purchase\s+of\s+Rs\.?\s*([0-9,]+(?:\.\d+)?)/i, message);
    return m ? toPaise(gv(m, 1)) : null;
  }

  protected extractMerchant(message: string, _sender: string): string | null {
    // Capture the fund name between "in " and " has been processed".
    const m = find(/\bin\s+(.+?)\s+has\s+been\s+processed/i, message);
    if (m) {
      const fund = gv(m, 1).trim();
      if (fund !== '') {
        return fund;
      }
    }
    return null;
  }

  protected extractTransactionType(_message: string): TransactionType | null {
    // Unit allotment from an AMC is always an investment outflow.
    return TransactionType.INVESTMENT;
  }

  // AMC SMS doesn't carry a bank account number.
  protected extractAccountLast4(_message: string): string | null {
    return null;
  }

  // No running balance in AMC SMS.
  protected extractBalance(_message: string): Paise | null {
    return null;
  }
}
