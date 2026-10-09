// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
//
// STUB — to be replaced by the port of upstream `YesBankParser.kt`.

import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';

export class YesBankParser extends BaseIndianBankParser {
  readonly id = 'yes';

  getBankName(): string {
    return 'Yes Bank';
  }

  canHandle(_sender: string): boolean {
    return false;
  }
}
