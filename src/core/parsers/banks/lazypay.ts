// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
//
// STUB — to be replaced by the port of upstream `LazyPayParser.kt`.

import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';

export class LazyPayParser extends BaseIndianBankParser {
  readonly id = 'lazypay';

  getBankName(): string {
    return 'LazyPay';
  }

  canHandle(_sender: string): boolean {
    return false;
  }
}
