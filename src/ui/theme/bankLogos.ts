/**
 * Bank logos, when fetched locally with `node scripts/fetch-bank-logos.js` (gitignored: bank
 * logos are trademarks of their owners). Metro maps `./bankLogos.generated` to
 * `./bankLogos.empty` when the file does not exist (metro.config.js), so builds work either way.
 */
import type { ImageSourcePropType } from 'react-native';

export interface BankLogo {
  source: ImageSourcePropType;
  /** Pixel size of the image. */
  width: number;
  height: number;
  /** Part of the image that holds the symbol, `[x, y, w, h]` as fractions; whole image if absent. */
  crop?: readonly [number, number, number, number];
  /** Fill the tile edge to edge (an app icon) instead of padding the symbol on white. */
  bleed?: boolean;
}

let logos: Record<string, BankLogo> = {};
try {
  logos = require('./bankLogos.generated').BANK_LOGOS;
} catch {
  // Not fetched: initials tiles.
}

export function bankLogo(bank: string): BankLogo | undefined {
  return logos[bank];
}
