import { fingerprint } from '../../sms/fingerprint';
import type { ParsedEvent, RawSms } from '../../types';
import { ingestWith } from '../ingest';

const parsed = (sms: RawSms, occurredAt = sms.date): ParsedEvent => ({
  kind: 'transaction',
  bank: 'hdfc',
  parserId: 'hdfc-upi-debit',
  parserVersion: 1,
  amount: 34900,
  direction: 'debit',
  status: 'success',
  instrument: 'upi',
  accountLast4: '1234',
  refs: {},
  occurredAt,
  hints: {},
  confidence: 92,
});

const fakeParse = (sms: RawSms) => (/debited/.test(sms.body) ? { status: 'parsed' as const, parsed: parsed(sms) } : { status: 'ignored' as const });

const raw: RawSms[] = [
  { id: '12', address: 'AX-HDFCBK-S', body: 'Rs.349.00 debited from a/c **1234 to SWIGGY', date: 1_780_000_000_000 },
  { id: '13', address: 'VM-HDFCBK', body: 'Rs.349.00  debited from a/c **1234 to SWIGGY', date: 1_780_000_001_000 }, // same SMS, other route
  { id: '14', address: 'AX-HDFCBK-S', body: 'Your OTP is 123456', date: 1_780_000_002_000 },
];

describe('ingest', () => {
  it('fingerprints, parses, and drops in-batch duplicates (earliest copy wins)', () => {
    const out = ingestWith(fakeParse, [...raw].reverse(), new Set(), 1_780_000_100_000);
    expect(out.map(e => e.id)).toEqual(['sms:12', 'sms:14']);
    expect(out[0]).toMatchObject({ sourceKind: 'sms', externalId: '12', sender: 'AX-HDFCBK-S', parseStatus: 'parsed', receivedAt: raw[0].date });
    expect(out[0].fingerprint).toBe(fingerprint('AX-HDFCBK-S', raw[0].body));
    expect(out[1]).toMatchObject({ parseStatus: 'ignored' });
    expect(out[1].parsed).toBeUndefined();
  });

  it('rescan is a no-op', () => {
    const first = ingestWith(fakeParse, raw, new Set(), 1_780_000_100_000);
    const known = new Set(first.map(e => e.fingerprint));
    expect(ingestWith(fakeParse, raw, known, 1_780_000_200_000)).toEqual([]);
  });

  it('a throwing parser marks the SMS unparsed instead of failing the scan', () => {
    const out = ingestWith(
      () => {
        throw new Error('boom');
      },
      [raw[0]],
      new Set(),
      0,
    );
    expect(out[0].parseStatus).toBe('unparsed');
  });

  it('a parsed time far in the future falls back to the delivery time', () => {
    const far = (sms: RawSms) => ({ status: 'parsed' as const, parsed: parsed(sms, sms.date + 40 * 86_400_000) });
    const out = ingestWith(far, [raw[0]], new Set(), raw[0].date);
    expect(out[0].parsed!.occurredAt).toBe(raw[0].date);
  });
});
