/**
 * Golden fixtures: every `fixtures/sms/<bank>/<case>.json` is run through
 * `parseSms` and compared with `expected` (partial match).
 *
 * Fixture shape:
 *   { "sms": RawSms, "expected": Partial<ParsedEvent> | null,
 *     "expectedStatus"?: "parsed" | "ignored" | "unparsed" | "not_parsed",
 *     "note"?: string }
 * `not_parsed` accepts either 'ignored' or 'unparsed'.
 */
import type { ParsedEvent, ParseStatus, RawSms } from '../../types';
import { parseSms } from '../index';

interface Fixture {
  sms: RawSms;
  expected: Partial<ParsedEvent> | null;
  expectedStatus?: ParseStatus | 'not_parsed';
  note?: string;
}

// No @types/node in this project: declare the few Node APIs the test uses.
declare const require: (id: string) => unknown;
declare const __dirname: string;
const fs = require('fs') as {
  existsSync(p: string): boolean;
  readdirSync(p: string): string[];
  statSync(p: string): { isDirectory(): boolean };
  readFileSync(p: string, enc: 'utf8'): string;
};
const path = require('path') as { resolve(...p: string[]): string; join(...p: string[]): string };

const ROOT = path.resolve(__dirname, '../../../../fixtures/sms');

function loadFixtures(): [string, Fixture][] {
  const out: [string, Fixture][] = [];
  if (!fs.existsSync(ROOT)) {
    return out;
  }
  for (const bank of fs.readdirSync(ROOT).sort()) {
    const dir = path.join(ROOT, bank);
    if (!fs.statSync(dir).isDirectory()) {
      continue;
    }
    for (const file of fs.readdirSync(dir).sort()) {
      if (file.endsWith('.json')) {
        out.push([`${bank}/${file.replace(/\.json$/, '')}`, JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))]);
      }
    }
  }
  return out;
}

const fixtures = loadFixtures();

describe('sms fixtures', () => {
  it('has fixtures', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(fixtures)('%s', (_name, fx) => {
    const outcome = parseSms(fx.sms);
    const wantStatus = fx.expectedStatus ?? (fx.expected ? 'parsed' : 'not_parsed');
    if (wantStatus === 'not_parsed') {
      expect({ status: outcome.status, parsed: outcome.parsed }).toMatchObject({
        status: expect.stringMatching(/^(ignored|unparsed)$/),
      });
    } else {
      expect({ status: outcome.status, parsed: outcome.parsed }).toMatchObject({ status: wantStatus });
    }
    if (fx.expected) {
      expect(outcome.parsed).toMatchObject(fx.expected);
    }
    if (outcome.parsed) {
      const p = outcome.parsed;
      expect(Number.isInteger(p.amount)).toBe(true);
      expect(p.amount).toBeGreaterThanOrEqual(0);
      expect(p.parserId).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      if (p.accountLast4 !== undefined) {
        expect(p.accountLast4).toMatch(/^\d{3,4}$/);
      }
    }
  });
});
