/**
 * Demo inbox: a realistic week of Indian bank SMS, relative to "now", run through the real
 * pipeline (`ingestSms` → `buildLedger`). Used by tests and by the in-app demo mode (no SMS
 * permission needed). All names, account digits and references are fictitious.
 *
 * The week mirrors the Ledger design: two personal accounts (HDFC ••1234, SBI ••8821), a joint
 * Kotak account (••0193), an ICICI credit card (••4471). It exercises a duplicate alert, a
 * matched self transfer, an in-transit transfer, a card bill, an ATM withdrawal, a refund and a
 * low-confidence merchant that asks for review.
 */
import type { Account, EpochMs, RawSms } from '../../../core/types';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** `09-Oct-26` */
const dMonY = (d: Date) => `${pad(d.getDate())}-${MON[d.getMonth()]}-${pad(d.getFullYear() % 100)}`;
/** `09/10/26` */
const dSlash = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${pad(d.getFullYear() % 100)}`;
/** `09Oct26` */
const dCompact = (d: Date) => `${pad(d.getDate())}${MON[d.getMonth()]}${pad(d.getFullYear() % 100)}`;

/** `2026-10-08` */
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Local time `daysAgo` days before `now`, at hh:mm. */
function at(now: EpochMs, daysAgo: number, hh: number, mm: number): Date {
  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hh, mm, 0, 0);
  return d;
}

type DemoAccount = 'hdfc' | 'sbi' | 'icici';

interface DemoMessage {
  address: string;
  /** Which account moves, and by how much (rupees, signed). Drives the printed balance. */
  account: DemoAccount;
  delta: number;
  daysAgo: number;
  time: [number, number];
  /** `bal` is the account's balance right after this message, e.g. `1,12,400.00`. */
  body: (d: Date, bal: string) => string;
}

/** Balances before the first demo message (ICICI is a card: no balance is printed). */
const OPENING: Record<DemoAccount, number> = {
  hdfc: 27400,
  sbi: 22000,
  icici: 0,
};

const inr = (rupees: number) =>
  rupees.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const MESSAGES: readonly DemoMessage[] = [
  // ---- 6 days ago --------------------------------------------------------------------------
  {
    account: 'hdfc',
    delta: 85000,
    address: 'AD-HDFCBK-S',
    daysAgo: 6,
    time: [9, 5],
    body: (d, bal) =>
      `Update! INR 85,000.00 deposited in HDFC Bank A/c XX1234 on ${dMonY(
        d,
      ).toUpperCase()} for NEFT Cr-CITI0100000-ACME TECHNOLOGIES-RATNESH-CITIN26100001.Avl bal INR ${bal}. Cheque deposits in A/C are subject to clearing`,
  },
  {
    account: 'hdfc',
    delta: -1240,
    address: 'VM-HDFCBK-S',
    daysAgo: 6,
    time: [13, 20],
    body: d => `Rs.1240.00 debited from A/c XX1234 on ${dMonY(d)} to VPA zomato@hdfcbank (UPI Ref No 428100000101)`,
  },
  // ---- 5 days ago --------------------------------------------------------------------------
  {
    account: 'sbi',
    delta: -1860,
    address: 'JD-SBIUPI-S',
    daysAgo: 5,
    time: [19, 10],
    body: d =>
      `Dear UPI user A/C X8821 debited by 1860.00 on date ${dCompact(
        d,
      )} trf to BIGBASKET Refno 428100000102. If not u? call 1800111109. -SBI`,
  },
  {
    account: 'icici',
    delta: -2499,
    address: 'AX-ICICIT-S',
    daysAgo: 5,
    time: [21, 2],
    body: d =>
      `INR 2,499.00 spent using ICICI Bank Card XX4471 on ${dMonY(
        d,
      )} on MYNTRA. Avl Limit: INR 1,47,620.00. If not you, call 1800 2662/SMS BLOCK 4471 to 9215676766`,
  },
  // ---- 4 days ago --------------------------------------------------------------------------
  {
    account: 'hdfc',
    delta: -320,
    address: 'VM-HDFCBK-S',
    daysAgo: 4,
    time: [8, 40],
    body: d => `Rs.320.00 debited from A/c XX1234 on ${dMonY(d)} to VPA uber@axisbank (UPI Ref No 428100000103)`,
  },
  {
    account: 'sbi',
    delta: -650,
    address: 'JD-SBIUPI-S',
    daysAgo: 4,
    time: [20, 15],
    body: d =>
      `Dear UPI user A/C X8821 debited by 650.00 on date ${dCompact(
        d,
      )} trf to BLUE TOKAI COFFEE Refno 428100000104. If not u? call 1800111109. -SBI`,
  },
  // ---- 3 days ago --------------------------------------------------------------------------
  {
    account: 'hdfc',
    delta: -2100,
    address: 'VM-HDFCBK-S',
    daysAgo: 3,
    time: [12, 30],
    body: d => `Rs.2100.00 debited from A/c XX1234 on ${dMonY(d)} to VPA amazon@apl (UPI Ref No 428100000105)`,
  },
  // ---- 2 days ago --------------------------------------------------------------------------
  {
    account: 'sbi',
    delta: -940,
    address: 'JD-SBIUPI-S',
    daysAgo: 2,
    time: [18, 45],
    body: d =>
      `Dear UPI user A/C X8821 debited by 940.00 on date ${dCompact(
        d,
      )} trf to ZOMATO Refno 428100000106. If not u? call 1800111109. -SBI`,
  },
  // ---- yesterday ---------------------------------------------------------------------------
  {
    account: 'sbi',
    delta: -2000,
    // Own-account transfer to the joint Kotak account; its credit has not arrived yet.
    address: 'JD-SBIUPI-S',
    daysAgo: 1,
    time: [19, 48],
    body: (d, bal) =>
      `Dear UPI user A/C X8821 debited by 2000.00 on date ${dCompact(
        d,
      )} trf to RATNESH MAURYA Refno 428100000107. Avl Bal Rs.${bal}. If not u? call 1800111109. -SBI`,
  },
  {
    account: 'hdfc',
    delta: 1299,
    address: 'VM-HDFCBK-S',
    daysAgo: 1,
    time: [11, 5],
    body: (d, bal) =>
      `Update! INR 1,299.00 deposited in HDFC Bank A/c XX1234 on ${dMonY(
        d,
      ).toUpperCase()} for REFUND AMAZON SELLER SERVICES.Avl bal INR ${bal}.`,
  },
  {
    account: 'hdfc',
    delta: -8000,
    // Credit-card bill paid from HDFC: settles the card, not a second expense.
    address: 'VM-HDFCBK-S',
    daysAgo: 1,
    time: [10, 0],
    body: d =>
      `Sent Rs.8000.00 From HDFC Bank A/C *1234 To ICICI BANK CREDIT CARD On ${dSlash(
        d,
      )} Ref 428100000108 Not You? Call 18002586161`,
  },
  {
    account: 'hdfc',
    delta: -2000,
    // Cash out of the bank: moved to cash, not spending.
    address: 'VM-HDFCBK-S',
    daysAgo: 1,
    time: [17, 30],
    body: (d, bal) =>
      `Rs.2000 withdrawn from HDFC Bank Card x1234 At +18 KORAMANGALA 5TH BLOCK On ${isoDay(
        d,
      )}:17:30:00 Avl bal INR ${bal}`,
  },
  {
    account: 'icici',
    delta: -599,
    address: 'AX-ICICIT-S',
    daysAgo: 1,
    time: [20, 12],
    body: d =>
      `INR 599.00 spent using ICICI Bank Card XX4471 on ${dMonY(
        d,
      )} on AIRTEL PAYMENTS. Avl Limit: INR 1,55,021.00. If not you, call 1800 2662/SMS BLOCK 4471 to 9215676766`,
  },
  // ---- today -------------------------------------------------------------------------------
  {
    account: 'hdfc',
    delta: -540,
    address: 'VM-HDFCBK-S',
    daysAgo: 0,
    time: [8, 55],
    body: d => `Rs.540.00 debited from A/c XX1234 on ${dMonY(d)} to VPA uber@axisbank (UPI Ref No 428100000109)`,
  },
  {
    account: 'hdfc',
    delta: -349,
    // Same Swiggy payment, two HDFC alert templates: one transaction with two pieces of evidence.
    address: 'VM-HDFCBK-S',
    daysAgo: 0,
    time: [13, 12],
    body: d => `Rs.349.00 debited from A/c XX1234 on ${dMonY(d)} to VPA swiggy@icici (UPI Ref No 428100000110)`,
  },
  {
    account: 'hdfc',
    delta: 0,
    address: 'AD-HDFCBK-S',
    daysAgo: 0,
    time: [13, 12],
    body: d =>
      `Sent Rs.349.00 From HDFC Bank A/C *1234 To SWIGGY On ${dSlash(d)} Ref 428100000110 Not You? Call 18002586161`,
  },
  {
    account: 'hdfc',
    delta: -5000,
    // Own-account transfer HDFC → SBI, both legs carry the same UTR.
    address: 'VM-HDFCBK-S',
    daysAgo: 0,
    time: [14, 5],
    body: d => `Rs.5000.00 debited from A/c XX1234 on ${dMonY(d)} to VPA ratnesh@sbi (UPI Ref No 428100000111)`,
  },
  {
    account: 'sbi',
    delta: 5000,
    address: 'JD-SBIUPI-S',
    daysAgo: 0,
    time: [14, 5],
    body: d =>
      `Dear SBI User, your A/c X8821-credited by Rs.5000 on ${dCompact(
        d,
      )} transfer from RATNESH MAURYA Ref No 428100000111 -SBI`,
  },
  {
    account: 'sbi',
    delta: 4000,
    address: 'JD-SBIUPI-S',
    daysAgo: 0,
    time: [16, 30],
    body: d =>
      `Dear SBI User, your A/c X8821-credited by Rs.4000 on ${dCompact(
        d,
      )} transfer from ROHAN MEHTA Ref No 428100000112 -SBI`,
  },
  {
    account: 'hdfc',
    delta: -840,
    address: 'VM-HDFCBK-S',
    daysAgo: 0,
    time: [18, 20],
    body: (d, bal) =>
      `Rs.840.00 debited from A/c XX1234 on ${dMonY(
        d,
      )} to VPA bescom@icici (UPI Ref No 428100000113). Avl bal INR ${bal}`,
  },
  {
    account: 'sbi',
    delta: -400,
    // A merchant nothing recognises: the category is a guess, so the app asks.
    address: 'JD-SBIUPI-S',
    daysAgo: 0,
    time: [19, 41],
    body: (d, bal) =>
      `Dear UPI user A/C X8821 debited by 400.00 on date ${dCompact(
        d,
      )} trf to SRI LAKSHMI AGENCIES Refno 428100000114. Avl Bal Rs.${bal}. If not u? call 1800111109. -SBI`,
  },
];

/** The demo inbox, ids in delivery order. */
export function demoSms(now: EpochMs): RawSms[] {
  const balance = { ...OPENING };
  return MESSAGES.map(m => ({ m, d: at(now, m.daysAgo, m.time[0], m.time[1]) }))
    .sort((a, b) => a.d.getTime() - b.d.getTime())
    .map(({ m, d }, i) => {
      balance[m.account] += m.delta;
      return {
        id: String(1000 + i),
        address: m.address,
        body: m.body(d, inr(balance[m.account])),
        date: d.getTime(),
      };
    });
}

/** The user's own names / handles, so transfers to themselves are recognised. */
export const DEMO_SELF_IDENTITIES = ['RATNESH MAURYA', 'ratnesh@sbi', 'ratnesh@okhdfcbank'];

/** Account metadata the user would set once: names, the joint account, the card. */
export const DEMO_ACCOUNT_EDITS: Partial<Account>[] = [
  {
    id: 'hdfc-1234',
    displayName: 'HDFC Savings',
    type: 'savings',
    upiIds: ['ratnesh@okhdfcbank'],
  },
  {
    id: 'sbi-8821',
    displayName: 'SBI Savings',
    type: 'savings',
    upiIds: ['ratnesh@sbi'],
  },
  { id: 'icici-4471', displayName: 'ICICI Card', type: 'credit_card' },
];
