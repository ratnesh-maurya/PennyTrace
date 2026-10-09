import type { Paise } from './types';

const MINUS = '−';

/**
 * Parse an amount as printed in a bank SMS ("1,23,456.7", "349", "Rs.5,000.00")
 * into integer paise. Returns undefined when no valid number is present.
 */
export function parseAmountToPaise(text: string): Paise | undefined {
  const m = /(\d[\d,]*)(?:\.(\d{1,2}))?/.exec(text);
  if (!m) {
    return undefined;
  }
  const rupees = Number(m[1].replace(/,/g, ''));
  if (!Number.isSafeInteger(rupees)) {
    return undefined;
  }
  const fraction = (m[2] ?? '').padEnd(2, '0');
  return rupees * 100 + Number(fraction || '0');
}

export function rupeesToPaise(rupees: number): Paise {
  return Math.round(rupees * 100);
}

const groupFormatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export interface FormatOptions {
  /** Prefix + for positive values. */
  signed?: boolean;
  /** Show paise when non-zero. Default false (₹ rounded to rupees). */
  paise?: boolean;
}

/** `₹49,460`, `−₹2,740`, `+₹4,000`. Uses the true minus sign (U+2212). */
export function formatINR(value: Paise, opts: FormatOptions = {}): string {
  const abs = Math.abs(value);
  const showPaise = opts.paise && abs % 100 !== 0;
  const body = showPaise ? decimalFormatter.format(abs / 100) : groupFormatter.format(Math.round(abs / 100));
  const sign = value < 0 ? MINUS : opts.signed && value > 0 ? '+' : '';
  return `${sign}₹${body}`;
}

/** Compact form for chart labels: `₹1.2k`, `₹3.4L`. */
export function formatINRCompact(value: Paise): string {
  const rupees = Math.abs(value) / 100;
  const sign = value < 0 ? MINUS : '';
  if (rupees >= 100000) {
    return `${sign}₹${(rupees / 100000).toFixed(1)}L`;
  }
  if (rupees >= 1000) {
    return `${sign}₹${(rupees / 1000).toFixed(1)}k`;
  }
  return `${sign}₹${Math.round(rupees)}`;
}

export function maskAccount(last4: string): string {
  return `••${last4}`;
}
