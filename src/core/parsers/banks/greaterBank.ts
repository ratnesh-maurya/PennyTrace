// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
//
// STUB — to be replaced by the port of upstream `GreaterBankParser.kt`.

import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';

export class GreaterBankParser extends BaseIndianBankParser {
  readonly id = 'greater-bank';

  getBankName(): string {
    return 'Greater Bank';
  }

  canHandle(_sender: string): boolean {
    return false;
  }
}
