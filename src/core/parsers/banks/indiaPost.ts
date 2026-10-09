// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
//
// STUB — to be replaced by the port of upstream `DOPBankParser.kt`.

import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';

export class IndiaPostParser extends BaseIndianBankParser {
  readonly id = 'india-post';

  getBankName(): string {
    return 'Department of Post';
  }

  canHandle(_sender: string): boolean {
    return false;
  }
}
