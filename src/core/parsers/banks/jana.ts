// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `JanaSmallFinanceBankParser.kt`.
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { find, gv, rx } from '../engine/regex';

/**
 * Parser for Jana Small Finance Bank (JANA SFB) SMS messages.
 *
 * Sender IDs look like JM-JANABK-S (DLT-prefixed) and the body is signed "JANA SFB".
 * The message shape is the standard Indian SFB UPI format, e.g.:
 *   "Dear Customer, Your acct XX005 is credited with INR 8.00 on 13-Jun-26 from
 *    NPCI BHIM. UPI Ref no 103475395201 . JANA SFB"
 * so amount (INR), account last-4 ("acct XX005"), reference ("UPI Ref no ...") and
 * the credited/debited type all resolve from BaseIndianBankParser; this parser only
 * needs to claim the sender.
 */
export class JanaSmallFinanceBankParser extends BaseIndianBankParser {
  readonly id = 'jana';

  getBankName(): string {
    return 'Jana Small Finance Bank';
  }

  canHandle(sender: string): boolean {
    const normalizedSender = sender.toUpperCase();
    return normalizedSender.includes('JANABK') || normalizedSender.includes('JANASFB');
  }

  protected extractMerchant(message: string, sender: string): string | null {
    // "...credited with INR 8.00 ... from NPCI BHIM. UPI Ref no ..." (payer) and
    // "...debited with INR ... to name@okaxis. UPI Ref no ..." (payee). The base
    // FROM/TO patterns require the name to butt up against " UPI", but here a
    // period separates them ("BHIM. UPI"), so the payer/payee is dropped. Capture
    // up to the sentence / "UPI" boundary instead, keeping the VPA handle before '@'.
    const keyword = message.toLowerCase().includes('credited') ? 'from' : 'to';
    const pattern = rx(String.raw`\b${keyword}\s+(.+?)(?:\.\s|\s+UPI\b|$)`, 'i');
    const m = find(pattern, message);
    if (m) {
      let name = gv(m, 1).trim();
      if (name.includes('@')) {
        name = name.slice(0, name.indexOf('@'));
      }
      name = name.replace(/[.,;]+$/, '');
      const merchant = this.cleanMerchantName(name);
      if (this.isValidMerchantName(merchant)) {
        return merchant;
      }
    }
    return super.extractMerchant(message, sender);
  }
}
