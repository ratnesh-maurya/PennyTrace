// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
//
// STUB — to be replaced by the port of upstream `KotakBankParser.kt`.

import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';

export class KotakBankParser extends BaseIndianBankParser {
  readonly id = 'kotak';

  getBankName(): string {
    return 'Kotak Bank';
  }

  canHandle(_sender: string): boolean {
    return false;
  }
}
