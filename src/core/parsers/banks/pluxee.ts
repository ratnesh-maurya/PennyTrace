// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `bank/PluxeeBankParser.kt`.
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { find, gv } from '../engine/regex';

/**
 * Parser for Pluxee (India), the prepaid meal-benefit card (rebrand of Sodexo).
 *
 * Supported format:
 * - Spend: "Rs. 40.00 spent from Pluxee  Meal wallet, card no.xx1234 on 17-08-2026 16:03:14 at
 *   NEW SHAKTHI  . Avl bal Rs.24342.81. Not you call ..."
 *
 * Notes:
 * - The live SMS carries irregular double-spaces ("Pluxee  Meal", "SHAKTHI  ."), so the regexes
 *   are whitespace-tolerant.
 * - A prepaid wallet is NOT a credit card, so no available-limit semantics are set. Amount,
 *   type, balance and the card's last 4 come from the base class.
 *
 * Senders are DLT headers embedding the entity name (AD-PLUXEE, VM-PLUXEE, JD-PLUXEE-S).
 */
export class PluxeeParser extends BaseIndianBankParser {
  readonly id = 'pluxee';

  getBankName(): string {
    return 'Pluxee';
  }

  canHandle(sender: string): boolean {
    // The DLT-wrapped entity name (XX-PLUXEE-S) as well as bare senders.
    return sender.toUpperCase().includes('PLUXEE');
  }

  protected extractMerchant(message: string, sender: string): string | null {
    // "... at NEW SHAKTHI  . Avl bal Rs.24342.81 ...": text after "at " up to the " . Avl bal"
    // delimiter, trimming the trailing double-space the sender emits.
    const m = find(/\bat\s+(.+?)\s*\.\s*Avl\s+bal/i, message);
    if (m) {
      const merchant = this.cleanMerchantName(gv(m, 1).trim());
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }
    return super.extractMerchant(message, sender);
  }

  protected extractAccountLast4(message: string): string | null {
    // "card no.xx1234": a prepaid meal card, so grab its last 4 digits.
    const m = find(/card\s+no\.?\s*(?:xx|\*)*(\d{4})/i, message);
    if (m) {
      const last4 = this.extractLast4Digits(gv(m, 1));
      if (last4 != null) {
        return last4;
      }
    }
    return super.extractAccountLast4(message);
  }
}
