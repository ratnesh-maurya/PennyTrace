/**
 * Mock ledger reproducing the design's data (design/LedgerApp2.dc.html:
 * `TX`, `DAYS`, `MONTH`, `MERCH`, account cards) as core view-model types.
 *
 * - Money is integer paise.
 * - "Today" is pinned to Thu 9 Oct 2026, the design's date.
 * - Older days of the week are expanded into individual transactions whose
 *   per-day/per-account totals match the design's `DAYS` table exactly, so the
 *   daily close, week strip, and week insights are *computed* (see mockEngine.ts).
 * - v1 evidence is SMS-only (`SourceKind = 'sms'`), so the design's
 *   notification/e-mail evidence is replaced by SMS (or dropped).
 * - Month insights and previous-period totals are constants from the design.
 */
import type {
  Account,
  AccountId,
  BalanceSnapshot,
  CategoryId,
  DayKey,
  Direction,
  EpochMs,
  InsightRange,
  Paise,
  SourceEvent,
  Transaction,
  TxnKind,
  TxnRefs,
} from '../../core/types';

export const MOCK_TODAY: DayKey = '2026-10-09';

const rs = (rupees: number): Paise => Math.round(rupees * 100);

export function at(day: DayKey, hhmm: string): EpochMs {
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime();
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export const ACC = {
  hdfc: 'hdfc-1234',
  sbi: 'sbi-8821',
  kotak: 'kotak-0193',
  icici: 'icici-4471',
  cash: 'cash',
} as const;

export const MOCK_ACCOUNTS: Account[] = [
  {
    id: ACC.hdfc,
    bank: 'hdfc',
    type: 'savings',
    ownership: 'personal',
    mask: '1234',
    displayName: 'HDFC Savings',
    upiIds: [],
    aliases: [],
    includeInTotal: true,
  },
  {
    id: ACC.sbi,
    bank: 'sbi',
    type: 'savings',
    ownership: 'personal',
    mask: '8821',
    displayName: 'SBI Savings',
    upiIds: [],
    aliases: [],
    includeInTotal: true,
  },
  {
    id: ACC.kotak,
    bank: 'kotak',
    type: 'savings',
    ownership: 'joint',
    coHolder: 'Ananya K',
    mask: '0193',
    displayName: 'Kotak Joint',
    upiIds: [],
    aliases: ['ANANYA K KOTAK'],
    includeInTotal: false,
  },
  {
    id: ACC.icici,
    bank: 'icici',
    type: 'credit_card',
    ownership: 'personal',
    mask: '4471',
    displayName: 'ICICI Card',
    upiIds: [],
    aliases: [],
    includeInTotal: false,
  },
  {
    id: ACC.cash,
    bank: 'cash',
    type: 'cash',
    ownership: 'personal',
    mask: '',
    displayName: 'Cash',
    upiIds: [],
    aliases: [],
    includeInTotal: false,
  },
];

/** Ledger (calculated) balances at the end of MOCK_TODAY. Card: negative = dues. */
export const MOCK_CLOSING_TODAY: Record<AccountId, Paise> = {
  [ACC.hdfc]: rs(31800),
  [ACC.sbi]: rs(17660),
  [ACC.kotak]: rs(6216),
  [ACC.icici]: -rs(12380),
};

export const MOCK_SNAPSHOTS: BalanceSnapshot[] = [
  { accountId: ACC.hdfc, at: at(MOCK_TODAY, '18:20'), reported: rs(31800), sourceId: 't3-s0' },
  { accountId: ACC.sbi, at: at(MOCK_TODAY, '19:41'), reported: rs(17660), sourceId: 't7-s0' },
  { accountId: ACC.kotak, at: at('2026-10-07', '20:05'), reported: rs(6098), sourceId: 'kotak-bal-0710' },
];

// ---------------------------------------------------------------------------
// Transactions + their SMS evidence
// ---------------------------------------------------------------------------

interface Sms {
  sender: string;
  body: string;
  /** Minutes after the transaction time. */
  delay?: number;
}

interface TxSpec {
  id: string;
  day: DayKey;
  time: string;
  account: AccountId;
  kind: TxnKind;
  dir?: Direction;
  amount: number; // rupees
  name: string;
  cat: CategoryId;
  conf?: number;
  rule?: string;
  refs?: TxnRefs;
  parser?: string;
  sms?: Sms[];
  merge?: string;
  linked?: string;
  vpa?: string;
}

let refSeq = 428000000000;
const nextRef = () => String(++refSeq);
const ddmm = (day: DayKey) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(2, 4)}`;
const ddMon = (day: DayKey) => `${day.slice(8, 10)}Oct${day.slice(2, 4)}`;

/** Default SMS for synthesized rows, in each bank's house style. */
function defaultSms(s: TxSpec, ref: string): Sms[] {
  const amt = s.amount;
  const up = s.name.toUpperCase();
  const credit = (s.dir ?? (s.kind === 'in' ? 'credit' : 'debit')) === 'credit';
  switch (s.account) {
    case ACC.hdfc:
      return credit
        ? [{ sender: 'AX-HDFCBK-S', body: `Rs.${amt}.00 credited to HDFC Bank A/c XX1234 on ${ddmm(s.day)} by ${up}. Ref ${ref}` }]
        : [{ sender: 'AX-HDFCBK-S', body: `Sent Rs.${amt}.00 From HDFC Bank A/C *1234 To ${up} On ${ddmm(s.day)} Ref ${ref}` }];
    case ACC.sbi:
      return credit
        ? [{ sender: 'VM-SBIUPI-S', body: `Dear SBI User, your A/c X8821-credited by Rs.${amt} on ${ddMon(s.day)} transfer from ${up} Ref No ${ref}` }]
        : [{ sender: 'VM-SBIUPI-S', body: `A/C X8821 debited by ${amt}.0 on ${ddMon(s.day)} trf to ${up} Refno ${ref}` }];
    case ACC.kotak:
      return [{ sender: 'JK-KOTAKB-S', body: `Sent Rs.${amt}.00 from Kotak Bank Ac X0193 to ${s.vpa ?? up} on ${s.day.slice(8, 10)}-10-26.UPI Ref ${ref}.` }];
    default:
      return [{ sender: 'AD-ICICIT-S', body: `INR ${amt}.00 spent using ICICI Bank Card XX4471 on ${ddMon(s.day)} on ${up}.` }];
  }
}

const SINGLE = 'Single source. No duplicate found within ±10 min for this amount and account.';

const DEFAULT_PARSER: Record<string, string> = {
  [ACC.hdfc]: 'hdfc-upi-debit v3',
  [ACC.sbi]: 'sbi-upi-debit v2',
  [ACC.kotak]: 'kotak-upi-debit v1',
  [ACC.icici]: 'icici-card v4',
};

const D3 = '2026-10-03';
const D4 = '2026-10-04';
const D5 = '2026-10-05';
const D6 = '2026-10-06';
const D7 = '2026-10-07';
const D8 = '2026-10-08';
const D9 = MOCK_TODAY;

const SPECS: TxSpec[] = [
  // ── Thu 9 Oct (design TX "today") ────────────────────────────────────────
  {
    id: 't7', day: D9, time: '19:41', account: ACC.sbi, kind: 'spend', amount: 400, name: 'DMart Avenue', cat: 'shopping',
    conf: 62, rule: 'Guessed from merchant type', refs: { upi: '428217730985' }, parser: 'sbi-upi-debit v2',
    sms: [{ sender: 'VM-SBIUPI-S', body: 'Dear UPI user A/C X8821 debited by 400.0 on date 09Oct26 trf to DMART AVENUE Refno 428217730985. -SBI' }],
    merge: SINGLE,
  },
  {
    id: 't3', day: D9, time: '18:20', account: ACC.hdfc, kind: 'spend', amount: 540, name: 'Uber', cat: 'travel',
    conf: 96, rule: 'Rule · Uber → Travel', refs: { upi: '428215504412' }, parser: 'hdfc-upi-debit v3',
    sms: [{ sender: 'AX-HDFCBK-S', body: 'Sent Rs.540.00 From HDFC Bank A/C *1234 To UBER INDIA On 09/10/26 Ref 428215504412' }],
    merge: SINGLE,
  },
  {
    id: 't4', day: D9, time: '14:05', account: ACC.hdfc, kind: 'xfer', dir: 'debit', amount: 5000, name: 'Self transfer', cat: 'transfer',
    conf: 99, rule: 'Matched own-account pair', refs: { utr: 'SBIN2262829114' }, parser: 'hdfc-neft v1 · sbi-credit v2',
    sms: [{ sender: 'AX-HDFCBK-S', body: 'Rs.5000.00 debited from A/c XX1234 to A/c XX8821 (IMPS). UTR SBIN2262829114' }],
    merge: 'Debit and credit share a UTR across two of your accounts. Excluded from income and spending.',
    linked: 't4c',
  },
  {
    id: 't4c', day: D9, time: '14:05', account: ACC.sbi, kind: 'xfer', dir: 'credit', amount: 5000, name: 'Self transfer', cat: 'transfer',
    conf: 99, rule: 'Matched own-account pair', refs: { utr: 'SBIN2262829114' }, parser: 'sbi-credit v2',
    sms: [{ sender: 'VM-SBIINB-S', body: 'Your A/C XXXXX8821 Credited INR 5,000.00 on 09/10/26 -Deposit by transfer from SELF. UTR SBIN2262829114' }],
    merge: 'Debit and credit share a UTR across two of your accounts. Excluded from income and spending.',
    linked: 't4',
  },
  {
    id: 't1', day: D9, time: '13:12', account: ACC.hdfc, kind: 'spend', amount: 349, name: 'Swiggy', cat: 'food',
    conf: 98, rule: 'Rule · Swiggy → Food & dining', refs: { upi: '428193720116' }, parser: 'hdfc-upi-debit v3', vpa: 'swiggy@icici',
    sms: [
      { sender: 'AX-HDFCBK-S', body: 'Sent Rs.349.00 From HDFC Bank A/C *1234 To SWIGGY On 09/10/26 Ref 428193720116' },
      { sender: 'JD-HDFCBK-T', body: 'UPI txn: Rs 349.00 debited from A/c XX1234 to swiggy@icici. UPI Ref 428193720116 -HDFC Bank', delay: 1 },
    ],
    merge: '2 alerts merged into one transaction by UPI reference 428193720116. Counted once.',
  },
  {
    id: 't5', day: D9, time: '11:30', account: ACC.sbi, kind: 'in', dir: 'credit', amount: 4000, name: 'Rohan Mehta', cat: 'income',
    conf: 90, rule: 'UPI credit from a contact', refs: { upi: '428177104238' }, parser: 'sbi-upi-credit v2',
    sms: [{ sender: 'VM-SBIUPI-S', body: 'Dear SBI User, your A/c X8821-credited by Rs.4000 on 09Oct26 transfer from ROHAN MEHTA Ref No 428177104238' }],
    merge: 'Single source. Recognised as a person, not salary.',
  },
  {
    id: 't6', day: D9, time: '10:15', account: ACC.sbi, kind: 'spend', amount: 840, name: 'BESCOM', cat: 'bills',
    conf: 99, rule: 'Rule · Electricity biller', refs: { upi: '428169981230' }, parser: 'sbi-upi-debit v2',
    sms: [{ sender: 'VM-SBIUPI-S', body: 'A/C X8821 debited by 840.0 on 09Oct26 trf to BESCOM Refno 428169981230' }],
    merge: SINGLE,
  },
  {
    id: 't2', day: D9, time: '09:04', account: ACC.hdfc, kind: 'spend', amount: 611, name: 'Blue Tokai Coffee', cat: 'food',
    conf: 94, rule: 'Rule · Café → Food & dining', refs: { upi: '428151127704' }, parser: 'hdfc-upi-debit v3',
    sms: [{ sender: 'AX-HDFCBK-S', body: 'Sent Rs.611.00 From HDFC Bank A/C *1234 To BLUE TOKAI COFFEE On 09/10/26 Ref 428151127704' }],
    merge: SINGLE,
  },
  { id: 'k9a', day: D9, time: '12:40', account: ACC.kotak, kind: 'spend', amount: 380, name: 'BigBasket', cat: 'groceries', vpa: 'bigbasket@hdfcbank' },

  // ── Wed 8 Oct (design TX "yest") ─────────────────────────────────────────
  {
    id: 'y1', day: D8, time: '19:48', account: ACC.sbi, kind: 'pending_xfer', dir: 'debit', amount: 2000, name: 'Kotak ••0193', cat: 'transfer',
    conf: 80, rule: 'Likely own account (alias match)', refs: { upi: '428102291175' }, parser: 'sbi-upi-debit v2',
    sms: [{ sender: 'VM-SBIUPI-S', body: 'A/C X8821 debited by 2000.0 on 08Oct26 trf to ANANYA K KOTAK Refno 428102291175' }],
    merge: 'Beneficiary matches your Kotak alias. Held as in transit — not spending — until the credit arrives.',
  },
  {
    id: 'y2', day: D8, time: '16:10', account: ACC.icici, kind: 'refund', dir: 'credit', amount: 1299, name: 'Amazon', cat: 'refund',
    conf: 97, rule: 'Reversal linked to original', refs: { other: 'ARN 74332246281' }, parser: 'icici-card v4',
    sms: [{ sender: 'AD-ICICIT-S', body: 'Refund of INR 1,299.00 from AMAZON credited to your ICICI Bank Credit Card XX4471' }],
    merge: 'Linked to the 4 Oct purchase. Recorded as a refund, not income.',
    linked: 'o1',
  },
  {
    id: 'y3', day: D8, time: '11:02', account: ACC.hdfc, kind: 'liability', dir: 'debit', amount: 8000, name: 'ICICI card bill', cat: 'card_payment',
    conf: 99, rule: 'Card payment detected', refs: { other: 'BBPS HD0810445521' }, parser: 'hdfc-bbps v1',
    sms: [
      { sender: 'AX-HDFCBK-S', body: 'Rs.8000.00 debited from A/c XX1234 for ICICI CREDIT CARD XX4471 via BBPS' },
      { sender: 'AD-ICICIT-S', body: 'Payment of INR 8,000.00 received on Credit Card XX4471. Thank you.', delay: 38 },
    ],
    merge: 'Settles card dues. Original card purchases are already counted, so this is not a second expense.',
  },
  {
    id: 'y4', day: D8, time: '09:15', account: ACC.hdfc, kind: 'cash', dir: 'debit', amount: 2000, name: 'ATM withdrawal', cat: 'cash',
    conf: 99, rule: 'ATM pattern', refs: { other: 'ATM 0812·S1AN4471' }, parser: 'hdfc-atm v2',
    sms: [{ sender: 'AX-HDFCBK-S', body: 'Rs.2000 withdrawn at ATM S1AN4471 from A/c XX1234 on 08-10-26' }],
    merge: 'Tracked as money moved to your Cash account, not as consumption.',
  },
  {
    id: 'y5', day: D8, time: '08:30', account: ACC.hdfc, kind: 'spend', amount: 599, name: 'Airtel Postpaid', cat: 'bills',
    conf: 99, rule: 'Rule · Mobile biller', refs: { upi: '428088410034' }, parser: 'hdfc-upi-debit v3',
    sms: [{ sender: 'AX-HDFCBK-S', body: 'Sent Rs.599.00 From HDFC Bank A/C *1234 To AIRTEL On 08/10/26 Ref 428088410034' }],
    merge: SINGLE,
  },

  // ── Tue 7 Oct: HDFC shopping 2,310 + food 420 · SBI in 1,500, travel 180 ──
  { id: 'd7a', day: D7, time: '21:05', account: ACC.hdfc, kind: 'spend', amount: 420, name: 'Swiggy', cat: 'food', rule: 'Rule · Swiggy → Food & dining' },
  { id: 'd7b', day: D7, time: '20:15', account: ACC.hdfc, kind: 'spend', amount: 2310, name: 'Myntra', cat: 'shopping', rule: 'Merchant list · Myntra' },
  { id: 'd7c', day: D7, time: '13:20', account: ACC.sbi, kind: 'in', dir: 'credit', amount: 1500, name: 'Priya S', cat: 'income', conf: 90, rule: 'UPI credit from a contact', parser: 'sbi-upi-credit v2' },
  { id: 'd7d', day: D7, time: '09:10', account: ACC.sbi, kind: 'spend', amount: 180, name: 'Namma Metro', cat: 'travel', rule: 'Merchant list · Metro' },

  // ── Mon 6 Oct: HDFC groceries 1,860 + food 240 · Kotak 650 ───────────────
  { id: 'd6a', day: D6, time: '21:40', account: ACC.kotak, kind: 'spend', amount: 210, name: 'Swiggy Instamart', cat: 'food', vpa: 'instamart@icici' },
  { id: 'd6b', day: D6, time: '18:30', account: ACC.hdfc, kind: 'spend', amount: 1860, name: 'Nature’s Basket', cat: 'groceries', rule: 'Merchant list · Groceries' },
  { id: 'd6c', day: D6, time: '16:05', account: ACC.hdfc, kind: 'spend', amount: 240, name: 'Chaayos', cat: 'food', rule: 'Rule · Café → Food & dining' },
  { id: 'd6d', day: D6, time: '10:20', account: ACC.kotak, kind: 'spend', amount: 440, name: 'BigBasket', cat: 'groceries', vpa: 'bigbasket@hdfcbank' },

  // ── Sun 5 Oct: HDFC food 1,450 (2) + entertainment 798 · SBI travel 320 ──
  { id: 'd5a', day: D5, time: '23:05', account: ACC.sbi, kind: 'spend', amount: 320, name: 'Ola', cat: 'travel', rule: 'Rule · Ola → Travel' },
  { id: 'd5b', day: D5, time: '21:10', account: ACC.hdfc, kind: 'spend', amount: 1120, name: 'Toit', cat: 'food', conf: 88, rule: 'Merchant list · Restaurants' },
  { id: 'd5c', day: D5, time: '15:00', account: ACC.hdfc, kind: 'spend', amount: 798, name: 'BookMyShow', cat: 'entertainment', rule: 'Merchant list · Tickets' },
  { id: 'd5d', day: D5, time: '11:20', account: ACC.hdfc, kind: 'spend', amount: 330, name: 'Starbucks', cat: 'food', rule: 'Rule · Café → Food & dining' },

  // ── Sat 4 Oct: HDFC shopping 1,120 + food 860 (2) · SBI food 680 · Kotak 1,240
  { id: 'd4a', day: D4, time: '21:30', account: ACC.sbi, kind: 'spend', amount: 680, name: 'Zomato', cat: 'food', rule: 'Rule · Zomato → Food & dining' },
  { id: 'd4b', day: D4, time: '20:45', account: ACC.hdfc, kind: 'spend', amount: 661, name: 'Swiggy', cat: 'food', rule: 'Rule · Swiggy → Food & dining' },
  { id: 'd4c', day: D4, time: '19:20', account: ACC.kotak, kind: 'spend', amount: 420, name: 'Swiggy Instamart', cat: 'food', vpa: 'instamart@icici' },
  { id: 'd4d', day: D4, time: '17:30', account: ACC.hdfc, kind: 'spend', amount: 1120, name: 'Decathlon', cat: 'shopping', rule: 'Merchant list · Sports' },
  { id: 'd4e', day: D4, time: '11:00', account: ACC.kotak, kind: 'spend', amount: 820, name: 'BigBasket', cat: 'groceries', vpa: 'bigbasket@hdfcbank' },
  { id: 'd4f', day: D4, time: '10:15', account: ACC.hdfc, kind: 'spend', amount: 199, name: 'Third Wave Coffee', cat: 'food', rule: 'Rule · Café → Food & dining' },

  // ── Fri 3 Oct: salary 62,000 · ₹10,000 HDFC → SBI · HDFC food 380 · SBI groceries 940
  { id: 'd3a', day: D3, time: '20:10', account: ACC.hdfc, kind: 'spend', amount: 380, name: 'Swiggy', cat: 'food', rule: 'Rule · Swiggy → Food & dining' },
  { id: 'd3b', day: D3, time: '19:00', account: ACC.sbi, kind: 'spend', amount: 940, name: 'DMart', cat: 'groceries', conf: 92, rule: 'Merchant list · Supermarkets' },
  {
    id: 'd3x', day: D3, time: '10:30', account: ACC.hdfc, kind: 'xfer', dir: 'debit', amount: 10000, name: 'Self transfer', cat: 'transfer',
    conf: 99, rule: 'Matched own-account pair', refs: { utr: 'HDFCN52026100312' }, parser: 'hdfc-neft v1 · sbi-credit v2',
    sms: [{ sender: 'AX-HDFCBK-S', body: 'Rs.10000.00 debited from A/c XX1234 to A/c XX8821 (NEFT). UTR HDFCN52026100312' }],
    merge: 'Debit and credit share a UTR across two of your accounts. Excluded from income and spending.',
    linked: 'd3xc',
  },
  {
    id: 'd3xc', day: D3, time: '10:34', account: ACC.sbi, kind: 'xfer', dir: 'credit', amount: 10000, name: 'Self transfer', cat: 'transfer',
    conf: 99, rule: 'Matched own-account pair', refs: { utr: 'HDFCN52026100312' }, parser: 'sbi-credit v2',
    sms: [{ sender: 'VM-SBIINB-S', body: 'Your A/C XXXXX8821 Credited INR 10,000.00 on 03/10/26 -Deposit by transfer from SELF. UTR HDFCN52026100312' }],
    merge: 'Debit and credit share a UTR across two of your accounts. Excluded from income and spending.',
    linked: 'd3x',
  },
  {
    id: 'd3s', day: D3, time: '09:00', account: ACC.hdfc, kind: 'in', dir: 'credit', amount: 62000, name: 'Acme Technologies', cat: 'salary',
    conf: 99, rule: 'Salary pattern · monthly NEFT credit', refs: { utr: 'CITIN26277331045' }, parser: 'hdfc-neft-credit v1',
    sms: [{ sender: 'AX-HDFCBK-S', body: 'Rs.62000.00 credited to HDFC Bank A/c XX1234 on 03/10/26 by NEFT from ACME TECHNOLOGIES PVT LTD (SALARY). UTR CITIN26277331045' }],
    merge: SINGLE,
  },
];

/** Older transactions referenced by `linkedTxnId` but outside the mock's listed history. */
const ARCHIVE_SPECS: TxSpec[] = [
  {
    id: 'o1', day: D4, time: '14:22', account: ACC.icici, kind: 'spend', amount: 1299, name: 'Amazon', cat: 'shopping',
    conf: 97, rule: 'Merchant list · Amazon', refs: { other: 'AUTH 553921' }, parser: 'icici-card v4',
  },
];

/** Where a non-transfer move went (card bill → card, ATM → cash, in-transit → alias account). */
export const MOCK_MOVE_TARGET: Record<string, AccountId> = {
  y1: ACC.kotak,
  y3: ACC.icici,
  y4: ACC.cash,
};

function build(specs: TxSpec[]): { txns: Transaction[]; sources: SourceEvent[] } {
  const txns: Transaction[] = [];
  const sources: SourceEvent[] = [];
  for (const s of specs) {
    const occurredAt = at(s.day, s.time);
    const ref = s.refs ? undefined : nextRef();
    const refs: TxnRefs = s.refs ?? { upi: ref };
    const sms = s.sms ?? defaultSms(s, refs.upi ?? refs.utr ?? refs.other ?? '');
    const sourceIds = sms.map((m, i) => {
      const id = `${s.id}-s${i}`;
      sources.push({
        id,
        sourceKind: 'sms',
        externalId: String(100000 + sources.length),
        sender: m.sender,
        body: m.body,
        fingerprint: `mock-${id}`,
        receivedAt: occurredAt + (m.delay ?? 0) * 60000,
        parseStatus: 'parsed',
      });
      return id;
    });
    const conf = s.conf ?? 95;
    const direction: Direction = s.dir ?? (s.kind === 'in' || s.kind === 'refund' ? 'credit' : 'debit');
    txns.push({
      id: s.id,
      stableKey: `${s.account}:${refs.upi ?? refs.utr ?? refs.other ?? s.id}`,
      accountId: s.account,
      amount: rs(s.amount),
      direction,
      occurredAt,
      status: 'success',
      kind: s.kind,
      counterparty: s.name,
      vpa: s.vpa,
      categoryId: s.cat,
      confidence: conf,
      ruleProvenance: s.rule ?? 'Merchant list',
      needsReview: conf < 75,
      refs,
      sourceIds,
      mergeReason: s.merge ?? SINGLE,
      linkedTxnId: s.linked,
      parserId: s.parser ?? DEFAULT_PARSER[s.account] ?? 'generic v1',
    });
  }
  return { txns, sources };
}

const built = build(SPECS);
const archived = build(ARCHIVE_SPECS);

export const MOCK_TXNS: Transaction[] = built.txns;
export const MOCK_ARCHIVE: Transaction[] = archived.txns;
export const MOCK_SOURCES: SourceEvent[] = [...built.sources, ...archived.sources];

// ---------------------------------------------------------------------------
// Period constants from the design (not derivable from one week of rows)
// ---------------------------------------------------------------------------

type ScopeKey = 'all' | AccountId;

/** Previous-period spend totals (design: `prev`). */
export const MOCK_PREV_TOTAL: Record<InsightRange, Record<ScopeKey, Paise>> = {
  week: { all: rs(16240), [ACC.hdfc]: rs(11980), [ACC.sbi]: rs(4260), [ACC.kotak]: rs(3120) },
  month: { all: rs(64210), [ACC.hdfc]: rs(45880), [ACC.sbi]: rs(18340), [ACC.kotak]: rs(10400) },
};

export interface MonthMock {
  bars: number[];
  income: number;
  cats: [CategoryId, number][];
  merchants: [string, number, number][];
}

export const MOCK_MONTH_LABELS = ['Sep 15', 'Sep 22', 'Sep 29', 'Oct 6'];
export const MOCK_MONTH_KEYS: DayKey[] = ['2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06'];

/** Design `MONTH` (rupees) + month merchants (the design reused the week list; these are consistent with the month categories). */
export const MOCK_MONTH: Record<ScopeKey, MonthMock> = {
  all: {
    bars: [17320, 19880, 15430, 8349],
    income: 69500,
    cats: [['rent', 18000], ['food', 12460], ['shopping', 10890], ['groceries', 8215], ['bills', 6214], ['travel', 3820], ['entertainment', 1380]],
    merchants: [['Prakash R (rent)', 18000, 1], ['Swiggy', 6240, 14], ['Myntra', 5980, 3]],
  },
  [ACC.hdfc]: {
    bars: [11240, 14310, 10980, 6929],
    income: 62000,
    cats: [['rent', 18000], ['food', 10120], ['shopping', 8340], ['groceries', 4180], ['bills', 1439], ['entertainment', 1380]],
    merchants: [['Prakash R (rent)', 18000, 1], ['Swiggy', 6240, 14], ['Myntra', 5980, 3]],
  },
  [ACC.sbi]: {
    bars: [6080, 5570, 4450, 1420],
    income: 7500,
    cats: [['bills', 4775], ['groceries', 4035], ['travel', 3820], ['shopping', 2550], ['food', 2340]],
    merchants: [['DMart', 2890, 4], ['BESCOM', 2480, 2], ['Ola', 1980, 8]],
  },
  [ACC.kotak]: {
    bars: [3880, 2950, 4120, 1030],
    income: 12000,
    cats: [['groceries', 7240], ['food', 2890], ['rent', 1850]],
    merchants: [['BigBasket', 5120, 8], ['Swiggy Instamart', 2890, 6], ['Urban Company', 1850, 2]],
  },
};

/** Design `BA` month (rupees): spend per account over the last 4 weeks. */
export const MOCK_MONTH_BY_ACCOUNT: Record<AccountId, number> = {
  [ACC.hdfc]: 43459,
  [ACC.sbi]: 17520,
  [ACC.kotak]: 11980,
};

export const MOCK_SOURCES_STATUS = {
  messagesRead: 1284,
  banksRecognised: 6,
};

export { rs as rupees };
