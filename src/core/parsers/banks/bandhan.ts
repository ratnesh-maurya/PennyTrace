// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
// Upstream `BandhanBankParser.kt`.

import type { Paise } from '../../types';
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { toPaise } from '../engine/patterns';
import { find, gv, hasLetter, matches, replaceAll } from '../engine/regex';

/**
 * Parser for Bandhan Bank transaction SMS messages.
 *
 * Sample formats:
 * - "Dear Customer, your account XXXXXXXXXX1234 is credited with INR 3.00 on 01-OCT-2025 towards interest. Bandhan Bank"
 * - "INR 25,000.00 deposited to A/c XXXXXXXXXX1234 towards UPI/CR/C224513287910/JOHN DOE/u on 03-OCT-2025 . Clear Bal is INR 30,123.00 . Bandhan Bank."
 *
 * Senders generally follow DLT patterns like XY-BDNSMS-S.
 */
export class BandhanBankParser extends BaseIndianBankParser {
  readonly id = 'bandhan';

  getBankName(): string {
    return 'Bandhan Bank';
  }

  canHandle(sender: string): boolean {
    const s = sender.toUpperCase();

    // Common short/long forms
    if (s.includes('BANDHAN')) return true;

    // DLT/route patterns frequently used in India
    if (matches(/^[A-Z]{2}-BDNSMS(?:-S)?$/, s)) return true;
    if (matches(/^[A-Z]{2}-BANDHN(?:-S)?$/, s)) return true;

    return false;
  }

  protected extractMerchant(message: string, sender: string): string | null {
    // Pattern to extract merchant from "towards" section
    // Stops at: " Value", " on", " dt", " at", ".", or end of string
    const m = find(/towards\s+([^.\n]+?)(?:\s+Value|\s+on|\s+dt|\s+at|\.|$)/i, message);
    if (m) {
      let merchantRaw = gv(m, 1).trim();

      // For UPI transactions with "/" delimiters, extract the last meaningful segment
      if (merchantRaw.includes('/')) {
        const segments = merchantRaw
          .split('/')
          .map(it => it.trim())
          .filter(it => it !== '');
        const meaningful = segments.filter(
          segment => segment.length >= 2 && hasLetter(segment) && segment.toLowerCase() !== 'upi',
        );
        const candidate = meaningful.length > 0 ? meaningful[meaningful.length - 1] : segments[segments.length - 1];
        if (candidate != null) {
          merchantRaw = candidate;
        }
      }

      // Clean up the merchant name
      const cleanedMerchant = this.cleanMerchantName(replaceAll(merchantRaw, /\bu\b/i, '').trim());

      // Normalize specific merchants
      const normalizedMerchant = cleanedMerchant.toLowerCase() === 'interest' ? 'Interest' : cleanedMerchant;

      if (this.isValidMerchantName(normalizedMerchant)) {
        return normalizedMerchant;
      }
    }

    return super.extractMerchant(message, sender);
  }

  protected extractReference(message: string): string | null {
    const m = find(/UPI\/[A-Z]{2}\/([A-Z0-9]+)/i, message);
    if (m) {
      return gv(m, 1);
    }
    return super.extractReference(message);
  }

  protected extractBalance(message: string): Paise | null {
    const m = find(/Clear\s+Bal\s+(?:is\s+)?(?:INR\s*)?([0-9,]+(?:\.\d{2})?)/i, message);
    if (m) {
      return toPaise(gv(m, 1));
    }
    return super.extractBalance(message);
  }
}
