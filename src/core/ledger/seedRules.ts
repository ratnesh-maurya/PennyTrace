// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
//
// Source: shared/src/commonMain/kotlin/com/pennywiseai/shared/domain/mapping/SharedCategoryMapping.kt
// Changes for PennyTrace:
// - Keyword sets trimmed to merchants seen in Indian SMS plus the generic words
//   (UAE / Thailand / Singapore brand lists dropped).
// - Their category names mapped to PennyTrace category ids (see SEED_RULES).
// - Fuel split out of Transportation; Fitness folded into Health; Mobile, Tax and
//   Insurance folded into Bills; Banking kept only for loans/EMI.
// - A few local additions (state electricity boards, rent platforms), marked below.
// - Matching semantics kept: single words match on word boundaries, phrases as
//   substrings, case-insensitive; rules are evaluated in priority order.
import type { CategoryId } from '../types';

export interface SeedRule {
  /** Upstream category name, kept for traceability. */
  upstream: string;
  categoryId: CategoryId;
  includes: readonly string[];
  excludes?: readonly string[];
}

const TAX = ['tin', 'tax information', 'income tax', 'gst', 'tax payment', 'challan', 'direct tax', 'indirect tax', 'advance tax', 'self assessment'];

export const BANK_CHARGE = [
  'recovery',
  'charge',
  'charges',
  'fee',
  'fees',
  'penalty',
  'non-maintenance',
  'minimum balance',
  'sms charge',
  'sms charges',
  'atm recovery',
  'service charge',
  'annual fee',
  'processing fee',
  'convenience fee',
  'late payment',
  'cheque returned',
];

const CC_PAYMENT = ['bbps', 'bill payment', 'credit card payment', 'cc payment', 'card payment'];

// PennyTrace: split out of upstream TRANSPORT.
const FUEL = ['petrol', 'fuel', 'shell', 'indian oil', 'iocl', 'bpcl', 'hpcl', 'bharat petroleum', 'hindustan petroleum', 'nayara', 'filling station', 'petroleum'];

const FOOD = [
  'swiggy',
  'zomato',
  'dominos',
  "domino's",
  'pizza',
  'burger',
  'kfc',
  'mcdonalds',
  "mcdonald's",
  'restaurant',
  'cafe',
  'food',
  'canteen',
  'bakery',
  'bakers',
  'dhaba',
  'sweets',
  'biryani',
  'biriyani',
  'idli',
  'dosa',
  'chai',
  'tiffin',
  'eatery',
  'diner',
  'bistro',
  'juice centre',
  'juice center',
  'juice bar',
  'juice shop',
  'coffee',
  'tea stall',
  'snacks',
  'chaat',
  'momos',
  'shawarma',
  'catering',
  'confectionery',
  'patisserie',
  'ice cream',
  'icecream',
  'starbucks',
  'haldiram',
  'barbeque',
  'sangeetha',
  'bikanervala',
  'chicking',
  'papa johns',
  'subway',
  'punjab grill',
  'chaayos',
  'third wave',
  'eatsure',
  'box8',
  'faasos',
  'behrouz',
  'uber eats',
];

const GROCERY = ['bigbasket', 'blinkit', 'zepto', 'grofers', 'jiomart', 'dmart', 'reliance fresh', 'reliance smart', 'more retail', 'more megastore', 'more supermarket', 'grocery', 'groceries', 'dunzo', 'instamart', 'spencers', 'nature basket', 'star bazaar', 'ratnadeep', 'lulu', 'spar', 'kirana', 'supermarket'];

const TRANSPORT = ['uber', 'ola', 'rapido', 'metro', 'irctc', 'redbus', 'makemytrip', 'goibibo', 'parking', 'toll', 'fastag', 'indigo', 'air india', 'spicejet', 'vistara', 'akasa', 'cleartrip', 'namma yatri', 'bmtc', 'best bus', 'yulu'];

const SHOPPING = [
  'amazon',
  'flipkart',
  'myntra',
  'ajio',
  'nykaa',
  'meesho',
  'snapdeal',
  'shopclues',
  'firstcry',
  'pepperfry',
  'urban ladder',
  'store',
  'mart',
  'textiles',
  'garments',
  'readymade',
  'footwear',
  'stationery',
  'croma',
  'reliance digital',
  'vijay sales',
  'decathlon',
  'ikea',
  'lifestyle',
  'westside',
  'pantaloons',
  'tata cliq',
  'zara',
  'uniqlo',
  'h&m',
  'adidas',
  'nike',
  'puma',
  'skechers',
  'paypal',
  'aliexpress',
];

const SHOPPING_EXCLUDE = ['dmart', 'medical', 'pharmacy', 'chemist', 'clinic', 'hospital', 'diagnostic'];

// PennyTrace additions: state electricity / water boards and piped gas seen in Indian SMS.
const UTILITIES = ['electricity', 'water', 'gas', 'broadband', 'wifi', 'internet', 'tata sky', 'tata play', 'dish', 'd2h', 'bill', 'tata power', 'adani', 'bses', 'act fibernet', 'bescom', 'msedcl', 'mahadiscom', 'tneb', 'tangedco', 'cesc', 'kseb', 'tsspdcl', 'apspdcl', 'bwssb', 'mahanagar gas', 'igl', 'hathway', 'excitel'];

const ENTERTAINMENT = ['netflix', 'spotify', 'prime', 'hotstar', 'sony liv', 'zee5', 'voot', 'youtube', 'cinema', 'pvr', 'inox', 'bookmyshow', 'gaana', 'jiosaavn', 'apple music', 'wynk', 'district'];

const HEALTHCARE = ['1mg', 'pharmeasy', 'netmeds', 'apollo', 'pharmacy', 'medical', 'medicals', 'hospital', 'clinic', 'doctor', 'practo', 'healthkart', 'truemeds', 'healthcare', 'chemist', 'chemists', 'diagnostic', 'diagnostics', 'medplus'];

const INVESTMENT = ['groww', 'zerodha', 'upstox', 'kuvera', 'paytm money', 'coin', 'smallcase', 'mutual fund', 'sip', 'angel', '5paisa', 'etmoney', 'indmoney'];

// Upstream "Banking" also lists bank names and transfer phrases; PennyTrace decides
// transfers in transfers.ts, so only the loan words remain.
const LOANS = ['loan', 'emi', 'bajaj finance', 'bajaj finserv', 'home credit', 'navi', 'kreditbee', 'moneyview'];

const PERSONAL_CARE = ['urban company', 'salon', 'spa', 'barber', 'beauty', 'grooming', 'housejoy', 'laundry', 'parlour', 'naturals', 'lakme salon'];

const EDUCATION = ['byju', "byju's", 'unacademy', 'vedantu', 'coursera', 'udemy', 'upgrad', 'school', 'college', 'university', 'toppr', 'udacity', 'simplilearn', 'whitehat', 'great learning', 'physics wallah'];

const MOBILE = ['airtel', 'jio', 'vodafone', 'vi', 'idea', 'bsnl', 'recharge', 'prepaid', 'postpaid', 'mobile'];

const FITNESS = ['cult', 'cult.fit', 'cultfit', 'gym', 'fitness', 'yoga', 'healthifyme', 'fitternity', "gold's gym", 'anytime fitness'];

const INSURANCE = ['insurance', 'lic', 'policy', 'hdfc life', 'icici pru', 'sbi life', 'max life', 'bajaj allianz', 'policybazaar', 'acko', 'digit', 'star health', 'niva bupa'];

const TRAVEL = ['make my trip', 'yatra', 'ixigo', 'booking.com', 'expedia', 'agoda', 'trip.com', 'airbnb', 'skyscanner', 'flight', 'airline', 'hotel', 'marriott', 'hyatt', 'hilton', 'taj', 'oberoi', 'itc hotels', 'leela', 'radisson', 'novotel', 'ibis', 'oyo', 'treebo', 'fabhotels', 'zostel', 'emirates', 'qatar airways', 'lufthansa', 'singapore airlines'];

// PennyTrace addition: rent platforms.
const RENT = ['nobroker', 'nestaway', 'house rent', 'rent payment', 'housing.com', 'stanza living', 'zolo'];

/** Ordered: the first rule whose keywords match wins (upstream priority preserved). */
export const SEED_RULES: readonly SeedRule[] = [
  { upstream: 'Tax', categoryId: 'bills', includes: TAX },
  { upstream: 'Bank Charges', categoryId: 'fees', includes: BANK_CHARGE },
  // Real card bill payments become kind `liability` in transfers.ts; a merchant
  // named like a bill payment (BBPS) is usually a utility bill.
  { upstream: 'Credit Card Payment', categoryId: 'bills', includes: CC_PAYMENT },
  { upstream: 'Transportation (fuel)', categoryId: 'fuel', includes: FUEL },
  { upstream: 'Food & Dining', categoryId: 'food', includes: FOOD },
  { upstream: 'Groceries', categoryId: 'groceries', includes: GROCERY },
  { upstream: 'Transportation', categoryId: 'travel', includes: TRANSPORT },
  { upstream: 'Shopping', categoryId: 'shopping', includes: SHOPPING, excludes: SHOPPING_EXCLUDE },
  { upstream: 'Bills & Utilities', categoryId: 'bills', includes: UTILITIES },
  { upstream: 'Entertainment', categoryId: 'entertainment', includes: ENTERTAINMENT },
  { upstream: 'Healthcare', categoryId: 'health', includes: HEALTHCARE },
  { upstream: 'Investments', categoryId: 'investments', includes: INVESTMENT },
  { upstream: 'Banking', categoryId: 'emi', includes: LOANS },
  { upstream: 'Personal Care', categoryId: 'personal', includes: PERSONAL_CARE },
  { upstream: 'Education', categoryId: 'education', includes: EDUCATION },
  { upstream: 'Mobile', categoryId: 'bills', includes: MOBILE },
  { upstream: 'Fitness', categoryId: 'health', includes: FITNESS },
  { upstream: 'Insurance', categoryId: 'bills', includes: INSURANCE },
  { upstream: 'Travel', categoryId: 'travel', includes: TRAVEL },
  { upstream: 'Rent (PennyTrace)', categoryId: 'rent', includes: RENT },
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const wordRegexCache = new Map<string, RegExp>();

/**
 * Upstream `matches`: a keyword without spaces must match on word boundaries
 * (`\bola\b` does not match "Motorola"); a phrase matches as a substring.
 */
export function keywordMatches(textLower: string, keyword: string): boolean {
  if (keyword.includes(' ')) {
    return textLower.includes(keyword);
  }
  let re = wordRegexCache.get(keyword);
  if (!re) {
    // Upstream uses \b; keywords such as "h&m" or "domino's" start/end with
    // non-word characters, so use explicit alphanumeric boundaries instead.
    re = new RegExp(`(?:^|[^a-z0-9])${escapeRegex(keyword)}(?:[^a-z0-9]|$)`);
    wordRegexCache.set(keyword, re);
  }
  return re.test(textLower);
}

export function matchesAny(text: string, keywords: readonly string[]): string | undefined {
  const lower = text.toLowerCase();
  return keywords.find(k => keywordMatches(lower, k));
}

/** First seed rule matching `text`, with the keyword that matched. */
export function matchSeed(text: string | undefined): { rule: SeedRule; keyword: string } | undefined {
  if (!text) {
    return undefined;
  }
  const lower = text.toLowerCase();
  for (const rule of SEED_RULES) {
    if (rule.excludes?.some(x => lower.includes(x))) {
      continue;
    }
    const keyword = rule.includes.find(k => keywordMatches(lower, k));
    if (keyword) {
      return { rule, keyword };
    }
  }
  return undefined;
}
