// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
//
// Parse step of the pipeline (plan.md §5):
//   gate → bank parser(s) by sender (content-aware, upstream order)
//        → balance-only / mandate-notice checks → generic fallback → unparsed.
// LLM fallback is NOT done here; callers queue 'unparsed' messages for it.

import { gateSms, type GateReason } from '../sms/filter';
import type { ParsedEvent, ParseStatus, RawSms } from '../types';
import { BaseIndianBankParser } from './engine/BaseIndianBankParser';
import { normalizeNfkc } from './engine/regex';
import { balanceEvent, bankTxnToEvent, BANK_PARSER_CONFIDENCE } from './engine/toEvent';
import { parseGeneric } from './generic';
import { BANK_PARSERS, parsersForSender } from './registry';

/** Bump when output semantics change so stored events are reprocessed. */
export const PARSER_SCHEMA_VERSION = 1;

export type IgnoreReason = GateReason | 'mandate_notice';

export interface ParseOutcome {
  /** 'parsed' | 'ignored' | 'unparsed' (never 'llm'). */
  status: ParseStatus;
  parsed?: ParsedEvent;
  /** Why the message was ignored (diagnostics only). */
  reason?: IgnoreReason;
}

/** Sender id used as `bank` when no bank parser recognised the sender. */
function senderBankId(address: string): string {
  const upper = address.trim().toUpperCase();
  const parts = upper.split('-');
  const core = parts.length >= 2 && /^[A-Z0-9]{2}$/.test(parts[0]) ? parts[1] : upper;
  return core.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'unknown';
}

export function parseSms(sms: RawSms): ParseOutcome {
  const gate = gateSms(sms);
  if (!gate.keep) {
    return { status: 'ignored', reason: gate.reason };
  }

  const candidates = parsersForSender(sms.address);
  // Some banks (SBI Card) print Unicode "math" letters; parsers expect ASCII.
  const body = normalizeNfkc(sms.body);
  const input: RawSms = body === sms.body ? sms : { ...sms, body };

  for (const parser of candidates) {
    const txn = parser.parse(input.body, input.address, input.date);
    if (txn) {
      const parsed = bankTxnToEvent(txn, input, {
        bank: parser.id,
        defaultInstrument: parser.defaultInstrument,
        confidence: BANK_PARSER_CONFIDENCE,
      });
      return parsed ? { status: 'parsed', parsed } : { status: 'unparsed' };
    }
  }

  for (const parser of candidates) {
    if (!(parser instanceof BaseIndianBankParser)) {
      continue;
    }
    const bal = parser.parseBalanceUpdate(input.body);
    if (bal) {
      const parsed = balanceEvent(input, { bank: parser.id, confidence: BANK_PARSER_CONFIDENCE }, bal.accountLast4, bal.balance);
      if (parsed) {
        return { status: 'parsed', parsed };
      }
    }
    if (parser.isFutureDebitNotification(input.body) || parser.isEMandateNotification(input.body)) {
      return { status: 'ignored', reason: 'mandate_notice' };
    }
  }

  const generic = parseGeneric(input, candidates[0]?.id ?? senderBankId(sms.address));
  if (generic) {
    return { status: 'parsed', parsed: generic };
  }
  return { status: 'unparsed' };
}

export function listSupportedBanks(): { id: string; name: string }[] {
  const seen = new Set<string>();
  const out: { id: string; name: string }[] = [];
  for (const p of BANK_PARSERS) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      out.push({ id: p.id, name: p.getBankName() });
    }
  }
  return out;
}
