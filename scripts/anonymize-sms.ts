/**
 * Anonymise real SMS into golden-fixture skeletons.
 *
 *   node --experimental-strip-types --no-warnings scripts/anonymize-sms.ts <in.json> <out-dir>
 *
 * <in.json> is a JSON array of { address, body, date } (date: epoch ms).
 * For each message this writes <out-dir>/<bank>/<slug>.json:
 *   { sms, expected, expectedStatus, needsReview: true, note }
 * where `expected` is what parseSms produces TODAY for the anonymised text.
 * Review every file by hand before committing it (then delete `needsReview`).
 *
 * What gets masked (consistently within one run, so duplicates stay duplicates):
 * - Person names after "to" / "from" / "by" in P2P transfers (heuristic) → PERSON A, PERSON B, …
 * - Every digit run of 6+ digits that is not an amount (refs, phone numbers,
 *   full account numbers) → different digits, same length.
 * - Masked account / card last-4 (XX1234, **1234, ending 1234, …) → fake 4 digits.
 * - VPAs: user@bank → user1@bank (the handle is kept).
 *
 * Plain TypeScript that Node runs with type stripping: no enums, namespaces or
 * parameter properties here.
 */
// No @types/node in this project: take Node built-ins via process.getBuiltinModule
// (Node 22.3+) and declare only the bits this script uses.
interface NodeFs {
  readFileSync(p: string, enc: 'utf8'): string;
  writeFileSync(p: string, data: string): void;
  mkdirSync(p: string, opts: { recursive: boolean }): void;
  existsSync(p: string): boolean;
}
interface NodePath {
  join(...p: string[]): string;
  dirname(p: string): string;
  resolve(...p: string[]): string;
}
interface ResolveResult {
  url: string;
}
type NextResolve = (specifier: string, context: unknown) => ResolveResult;
interface NodeModule {
  registerHooks(hooks: {
    resolve(specifier: string, context: unknown, nextResolve: NextResolve): ResolveResult;
  }): void;
}
interface NodeUrl {
  pathToFileURL(p: string): { href: string };
}
declare const process: {
  argv: string[];
  exit(code: number): never;
  getBuiltinModule(id: 'node:fs'): NodeFs;
  getBuiltinModule(id: 'node:path'): NodePath;
  getBuiltinModule(id: 'node:module'): NodeModule;
  getBuiltinModule(id: 'node:url'): NodeUrl;
};

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
const { registerHooks } = process.getBuiltinModule('node:module');
const { pathToFileURL } = process.getBuiltinModule('node:url');

// src/ uses extensionless relative imports (Metro/Babel style). Teach Node to
// resolve them to .ts files so this script can call the real parser.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (!specifier.startsWith('.')) {
        throw err;
      }
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        return nextResolve(`${specifier}/index.ts`, context);
      }
    }
  },
});

interface InputSms {
  address: string;
  body: string;
  date: number;
}

// ---- Deterministic fake values ------------------------------------------------

/* eslint-disable no-bitwise -- hashing / PRNG need 32-bit integer ops */

/** Small seeded PRNG (mulberry32) so output is stable for the same input. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
/* eslint-enable no-bitwise */

function fakeDigits(original: string): string {
  const rand = prng(hashString(original));
  let out = '';
  for (let i = 0; i < original.length; i++) {
    let d = Math.floor(rand() * 10);
    if (i === 0 && original[0] !== '0' && d === 0) {
      d = 1 + Math.floor(rand() * 9);
    }
    out += String(d);
  }
  // Never return the original by accident.
  return out === original ? out.split('').reverse().join('') : out;
}

class Anonymizer {
  private digitRuns = new Map<string, string>();
  private last4 = new Map<string, string>();
  private vpaUsers = new Map<string, string>();
  private names = new Map<string, string>();

  private fakeRun(run: string): string {
    let v = this.digitRuns.get(run);
    if (!v) {
      v = fakeDigits(run);
      this.digitRuns.set(run, v);
    }
    return v;
  }

  private fakeLast4(digits: string): string {
    let v = this.last4.get(digits);
    if (!v) {
      // 1000 + n keeps 4 digits, avoids years (2000–2099) and is obviously fake.
      const n = this.last4.size;
      v = digits.length === 3 ? String(100 + ((n * 37) % 900)) : String(1000 + ((n * 137) % 999));
      this.last4.set(digits, v);
    }
    return v;
  }

  private fakeVpaUser(user: string): string {
    let v = this.vpaUsers.get(user.toLowerCase());
    if (!v) {
      v = `user${this.vpaUsers.size + 1}`;
      this.vpaUsers.set(user.toLowerCase(), v);
    }
    return v;
  }

  private fakeName(name: string): string {
    let v = this.names.get(name.toUpperCase());
    if (!v) {
      const n = this.names.size;
      v = `PERSON ${String.fromCharCode(65 + (n % 26))}${n >= 26 ? Math.floor(n / 26) : ''}`;
      this.names.set(name.toUpperCase(), v);
    }
    return v;
  }

  anonymize(body: string): string {
    let s = body;

    // 1. VPAs (before digit masking so numeric VPA users are handled once).
    s = s.replace(/([a-zA-Z0-9][a-zA-Z0-9._-]*)@([a-zA-Z][a-zA-Z0-9]*)(?![a-zA-Z0-9]*\.[a-zA-Z]{2,})/g, (_m, user, handle) =>
      `${this.fakeVpaUser(user)}@${handle}`,
    );

    // 2. Last-4 masks: XX1234, xx1234, **1234, *1234, X1234, ending 1234, ...1234.
    s = s.replace(/((?<![A-Za-z0-9])[xX*•]{1,12}|\bending(?:\s+with)?\s+|\bends\s+with\s+)(\d{3,4})\b/g, (_m, prefix, digits) =>
      `${prefix}${this.fakeLast4(digits)}`,
    );

    // 3. Digit runs of 6+ that are not amounts.
    const protectedSpans: [number, number][] = [];
    const amountRe =
      /(?:Rs\.?|INR|₹|Bal(?:ance)?|Lmt|Limit|Amt|Amount)[\s.:-]*\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s*(?:Rs|INR)\b/gi;
    for (const m of s.matchAll(amountRe)) {
      protectedSpans.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
    }
    const isProtected = (i: number) => protectedSpans.some(([a, b]) => i >= a && i < b);
    s = s.replace(/\d{6,}/g, (run, offset: number) => (isProtected(offset) ? run : this.fakeRun(run)));

    // 4. Person names in P2P transfers (heuristic): capitalised words after to/from/by.
    const p2p = /\b(?:UPI|IMPS|NEFT|RTGS|VPA|transfer|sent|received)\b/i.test(s);
    if (p2p) {
      const stop =
        /^(?:A\/C|AC|ACCT|ACCOUNT|YOUR|THE|BANK|UPI|VPA|NEFT|IMPS|RTGS|ATM|CARD|CREDIT|DEBIT|NET|MOBILE|BANKING|ON|AT|REF|RS|INR|SBI|HDFC|ICICI|AXIS|KOTAK|PVT|LTD|LIMITED|STORE|MART|SERVICES|PAYMENTS?|TECHNOLOGIES|INDIA|SELF|OWN|PERSON)$/i;
      s = s.replace(
        /\b([Tt][Oo]|[Ff][Rr][Oo][Mm]|[Bb][Yy])\s+((?:[A-Z][A-Za-z.']*)(?:\s+[A-Z][A-Za-z.']*){0,3})(?=\s+(?:[Oo][Nn]|[Aa][Tt]|[Vv][Ii][Aa]|[Rr][Ee][Ff]|UPI|IMPS|NEFT|\(|-|\.)|[.,;]|$)/g,
        (whole, prep: string, name: string) => {
          const words = name.trim().split(/\s+/);
          if (words.some(w => stop.test(w.replace(/[.']/g, '')))) {
            return whole;
          }
          return `${prep} ${this.fakeName(name.trim())}`;
        },
      );
    }
    return s;
  }
}

// ---- CLI ------------------------------------------------------------------------

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'sms'
  );
}

async function main(argv: string[]): Promise<void> {
  const [inPath, outDir] = argv;
  if (!inPath || !outDir) {
    console.error('usage: node --experimental-strip-types scripts/anonymize-sms.ts <in.json> <out-dir>');
    process.exit(2);
  }
  const here = path.dirname(path.resolve(process.argv[1]));
  const parsers = await import(pathToFileURL(path.join(here, '../src/core/parsers/index.ts')).href);
  const parseSms = parsers.parseSms as (sms: { id: string; address: string; body: string; date: number }) => {
    status: string;
    parsed?: { bank: string; parserId: string };
  };

  const input = JSON.parse(fs.readFileSync(inPath, 'utf8')) as InputSms[];
  if (!Array.isArray(input)) {
    throw new Error('input must be a JSON array of { address, body, date }');
  }
  const anon = new Anonymizer();
  const used = new Set<string>();
  let i = 0;
  for (const raw of input) {
    i += 1;
    const sms = { id: `anon-${String(i).padStart(4, '0')}`, address: raw.address, body: anon.anonymize(raw.body), date: raw.date };
    const outcome = parseSms(sms);
    const bank = outcome.parsed?.bank ?? 'unknown';
    let name = slug(outcome.parsed?.parserId ?? `${outcome.status}-${sms.address}`);
    let n = 1;
    while (used.has(`${bank}/${name}`) || fs.existsSync(path.join(outDir, bank, `${name}.json`))) {
      n += 1;
      name = `${slug(outcome.parsed?.parserId ?? outcome.status)}-${n}`;
    }
    used.add(`${bank}/${name}`);
    const fixture = {
      sms,
      expected: outcome.parsed ?? null,
      expectedStatus: outcome.status,
      needsReview: true,
      note: '',
      source: 'anonymized',
    };
    fs.mkdirSync(path.join(outDir, bank), { recursive: true });
    fs.writeFileSync(path.join(outDir, bank, `${name}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
  }
  console.log(`wrote ${i} fixture skeleton(s) to ${outDir} — review each one before committing`);
}

main(process.argv.slice(2)).catch(err => {
  console.error(err);
  process.exit(1);
});
