// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
//
// Upstream `HDFCMutualFundParser.kt`: SIP purchase and redemption messages
// from senders like `AD-HDFCMF-AC`, `VM-HDFCMF`.

import type { Paise } from '../../types';
import { BaseIndianBankParser } from '../engine/BaseIndianBankParser';
import { toPaise } from '../engine/patterns';
import { find, gv } from '../engine/regex';
import { TransactionType } from '../engine/types';

export class HdfcMutualFundParser extends BaseIndianBankParser {
  readonly id = 'hdfc-mf';

  getBankName(): string {
    return 'HDFC Mutual Fund';
  }

  canHandle(sender: string): boolean {
    return sender.toUpperCase().includes('HDFCMF');
  }

  protected isTransactionMessage(message: string): boolean {
    const lower = message.toLowerCase();
    return ['sip purchase', 'has been processed', 'folio', 'nav', 'redemption'].some(k => lower.includes(k));
  }

  protected extractAmount(message: string): Paise | null {
    const m = find(/Rs\.?\s*([\d,]+\.?\d*)/, message);
    return m ? toPaise(gv(m, 1)) : null;
  }

  protected extractMerchant(message: string, _sender: string): string | null {
    const m = find(/under\s+(.+?)\s+for/i, message);
    return m ? gv(m, 1).trim() : null;
  }

  protected extractTransactionType(message: string): TransactionType | null {
    const lower = message.toLowerCase();
    if (lower.includes('sip purchase') || lower.includes('purchase')) {
      return TransactionType.INVESTMENT;
    }
    if (lower.includes('redemption')) {
      return TransactionType.INCOME;
    }
    return null;
  }

  protected extractBalance(_message: string): Paise | null {
    return null;
  }

  protected extractAccountLast4(_message: string): string | null {
    return null;
  }
}
