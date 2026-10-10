/**
 * Test fixtures: SourceEvents built directly from ParsedEvents, so ledger tests
 * never depend on parser behaviour. Times are IST.
 */
import { fingerprint } from '../../sms/fingerprint';
import { fixedOffset, setTimeZoneOffset } from '../../time';
import type { DailyClose, Ledger, LedgerInput, ParsedEvent, SourceEvent } from '../../types';
import { addDays } from '../../time';
import { dailyClose } from '../dailyClose';

export const IST = fixedOffset(330);

export function pinIST(): void {
  beforeAll(() => setTimeZoneOffset(IST));
  afterAll(() => setTimeZoneOffset());
}

/** `2026-10-05 09:15` in IST → epoch ms. */
export function ist(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/.exec(s);
  if (!m) {
    throw new Error(s);
  }
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0)) - 330 * 60_000;
}

export const rs = (rupees: number): number => Math.round(rupees * 100);

let seq = 1000;

export interface SrcOpts {
  id?: string;
  body?: string;
  /** Minutes after occurredAt the SMS was delivered. */
  delayMin?: number;
}

export type P = Partial<ParsedEvent> & { amount: number };

export function src(sender: string, at: string, p: P, opts: SrcOpts = {}): SourceEvent {
  const occurredAt = ist(at);
  const parsed: ParsedEvent = {
    kind: 'transaction',
    bank: 'hdfc',
    parserId: 'hdfc-upi-debit',
    parserVersion: 1,
    direction: 'debit',
    status: 'success',
    instrument: 'upi',
    refs: {},
    occurredAt,
    hints: {},
    confidence: 92,
    ...p,
  };
  const body = opts.body ?? `${sender} ${at} ${JSON.stringify(p)}`;
  const id = opts.id ?? `sms:${seq++}`;
  return {
    id,
    sourceKind: 'sms',
    externalId: id.replace(/^sms:/, ''),
    sender,
    body,
    fingerprint: fingerprint(sender, body),
    receivedAt: occurredAt + (opts.delayMin ?? 0) * 60_000,
    parseStatus: 'parsed',
    parsed,
  };
}

// Realistic senders / accounts.
export const HDFC = 'AX-HDFCBK-S';
export const SBI = 'VM-SBIUPI-S';
export const ICICI = 'JD-ICICIT-S';
export const GPAY = 'AD-GPAYBK-S';

export const hdfc = (at: string, p: P, o?: SrcOpts) => src(HDFC, at, { bank: 'hdfc', accountLast4: '1234', ...p }, o);
export const sbi = (at: string, p: P, o?: SrcOpts) =>
  src(
    SBI,
    at,
    {
      bank: 'sbi',
      parserId: p.direction === 'credit' ? 'sbi-upi-credit' : 'sbi-upi-debit',
      accountLast4: '8821',
      ...p,
    },
    o,
  );
export const icici = (at: string, p: P, o?: SrcOpts) =>
  src(
    ICICI,
    at,
    {
      bank: 'icici',
      parserId: 'icici-card-spend',
      instrument: 'card',
      accountLast4: '4471',
      ...p,
      hints: { isCreditCard: true, ...p.hints },
    },
    o,
  );

export function input(sources: SourceEvent[], extra: Partial<LedgerInput> = {}): LedgerInput {
  return { sources, accountEdits: [], rules: [], overrides: [], selfIdentities: ['Ratnesh Maurya'], ...extra };
}

export function txnsOf(ledger: Ledger, accountId?: string) {
  return ledger.transactions.filter(t => !accountId || t.accountId === accountId);
}

/** The numbers a scenario asserts. */
export function nums(c: DailyClose) {
  return {
    opening: c.opening,
    received: c.received,
    spent: c.spent,
    movedNet: c.movedNet,
    movedGross: c.movedGross,
    closing: c.closing,
  };
}

/** Invariants every daily close must satisfy, checked over a span of days. */
export function expectCloseInvariants(ledger: Ledger, from: string, days: number): void {
  const scopes = ['all', ...ledger.accounts.map(a => a.id)];
  for (const scope of scopes) {
    for (let i = 0; i < days; i++) {
      const day = addDays(from, i);
      const c = dailyClose(ledger, day, scope);
      expect(c.closing).toBe(c.opening + c.received - (c.spent - c.spentOnCard) + c.movedNet);
      expect(c.byCategory.reduce((s, x) => s + x.amount, 0)).toBe(c.spent);
      if (scope !== 'all') {
        const next = dailyClose(ledger, addDays(day, 1), scope);
        expect(next.opening).toBe(c.reported?.closing ?? c.closing);
      }
    }
  }
}
