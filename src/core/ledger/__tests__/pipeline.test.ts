/** Wiring of the real pipeline entry points (parser-agnostic assertions only). */
import { buildLedger as buildFromPipeline, ingestSms, LEDGER_VERSION } from '../../pipeline';
import { buildLedger } from '../build';

describe('pipeline', () => {
  const raw = [
    {
      id: '1',
      address: 'AX-HDFCBK-S',
      body: 'Rs.349.00 debited from a/c **1234 on 05-10-26 to VPA swiggy@axisbank (UPI Ref No 527700000001). Avl bal Rs.9,651.00',
      date: 1_791_190_000_000,
    },
  ];

  it('ingestSms is idempotent and ids sources as sms:<id>', () => {
    const first = ingestSms(raw, new Set(), raw[0].date);
    expect(first).toHaveLength(1);
    expect(first[0].id).toBe('sms:1');
    expect(ingestSms(raw, new Set(first.map(e => e.fingerprint)), raw[0].date)).toEqual([]);
  });

  it('re-exports the ledger build', () => {
    expect(buildFromPipeline).toBe(buildLedger);
    expect(LEDGER_VERSION).toBeGreaterThanOrEqual(1);
  });
});
