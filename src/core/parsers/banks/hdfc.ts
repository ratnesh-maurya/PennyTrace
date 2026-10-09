// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
//
// STUB — to be replaced by the port of upstream `HDFCBankParser.kt`.

import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';

export class HdfcBankParser extends BaseIndianBankParser {
  readonly id = 'hdfc';

  getBankName(): string {
    return 'HDFC Bank';
  }

  canHandle(_sender: string): boolean {
    return false;
  }
}
