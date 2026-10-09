// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
//
// STUB — to be replaced by the port of upstream `PluxeeBankParser.kt`.

import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';

export class PluxeeParser extends BaseIndianBankParser {
  readonly id = 'pluxee';

  getBankName(): string {
    return 'Pluxee';
  }

  canHandle(_sender: string): boolean {
    return false;
  }
}
