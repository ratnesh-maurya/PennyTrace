// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
//
// Upstream `CompiledPatterns`. Never add the `g` flag to these (they are shared).

import { parseAmountToPaise } from '../../money';
import type { Paise } from '../../types';

const NUM = String.raw`(?:[0-9,]+(?:\.\d{1,2})?|\.\d{1,2})`;

export const Amount = {
  RS_PATTERN: new RegExp(String.raw`Rs\.?\s*(${NUM})`, 'i'),
  INR_PATTERN: new RegExp(String.raw`INR\s*(${NUM})`, 'i'),
  RUPEE_SYMBOL_PATTERN: new RegExp(String.raw`₹\s*(${NUM})`),
  get ALL_PATTERNS(): RegExp[] {
    return [Amount.RS_PATTERN, Amount.INR_PATTERN, Amount.RUPEE_SYMBOL_PATTERN];
  },
};

export const Reference = {
  GENERIC_REF: /(?:Ref|Reference|Txn|Transaction)\.?(?:\s+No\.?)?[:\s]+([A-Z0-9]+)/i,
  UPI_REF: /UPI[:\s]+([0-9]+)/i,
  REF_NUMBER: /Reference\s+Number[:\s]+([A-Z0-9]+)/i,
  get ALL_PATTERNS(): RegExp[] {
    return [Reference.GENERIC_REF, Reference.UPI_REF, Reference.REF_NUMBER];
  },
};

export const Account = {
  AC_WITH_MASK: /(?:A\/c|Account|Acct)(?:\s+No)?\.?\s+(\S+)/i,
  CARD_WITH_MASK: /Card\s+(\S+)/i,
  ENDING_PATTERN: /(?:ending|ends with|ending with)\s+(\d{4})/i,
  AC_NO_SLASH: /(?<![/])AC\s+(\S+)/i,
  DEBIT_CREDIT_CARD: /(?:debit|credit)\s+card\s+(\S+)/i,
  YOUR_ACCOUNT: /Your\s+(?:a\/c|account|acct|card|#)\s*(\S+)/i,
  LINKED_ACCOUNT: /linked\s+(?:a\/c|account|acct)\s+(\S+)/i,
  get ALL_PATTERNS(): RegExp[] {
    return [
      Account.AC_WITH_MASK,
      Account.CARD_WITH_MASK,
      Account.ENDING_PATTERN,
      Account.AC_NO_SLASH,
      Account.DEBIT_CREDIT_CARD,
      Account.YOUR_ACCOUNT,
      Account.LINKED_ACCOUNT,
    ];
  },
};

export const Balance = {
  AVL_BAL_RS: /(?:Bal|Balance|Avl Bal|Available Balance)[-:\s]+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
  AVL_BAL_INR: /(?:Bal|Balance|Avl Bal|Available Balance)[-:\s]+INR\s*([0-9,]+(?:\.\d{2})?)/i,
  AVL_BAL_RUPEE: /(?:Bal|Balance|Avl Bal|Available Balance)[-:\s]+₹\s*([0-9,]+(?:\.\d{2})?)/i,
  AVL_BAL_NO_CURRENCY: /(?:Bal|Balance|Avl Bal|Available Balance)[-:\s]+([0-9,]+(?:\.\d{2})?)/i,
  UPDATED_BAL_RS: /(?:Updated Balance|Remaining Balance)[-:\s]+Rs\.?\s*([0-9,]+(?:\.\d{2})?)/i,
  UPDATED_BAL_INR: /(?:Updated Balance|Remaining Balance)[-:\s]+INR\s*([0-9,]+(?:\.\d{2})?)/i,
  get ALL_PATTERNS(): RegExp[] {
    return [
      Balance.AVL_BAL_RS,
      Balance.AVL_BAL_INR,
      Balance.AVL_BAL_RUPEE,
      Balance.AVL_BAL_NO_CURRENCY,
      Balance.UPDATED_BAL_RS,
      Balance.UPDATED_BAL_INR,
    ];
  },
};

export const Merchant = {
  TO_PATTERN: /to\s+([^.\n]+?)(?:\s+on|\s+at|\s+Ref|\s+UPI)/i,
  FROM_PATTERN: /from\s+([^.\n]+?)(?:\s+on|\s+at|\s+Ref|\s+UPI)/i,
  AT_PATTERN: /at\s+([^.\n]+?)(?:\s+on|\s+Ref)/i,
  FOR_PATTERN: /for\s+([^.\n]+?)(?:\s+on|\s+at|\s+Ref)/i,
  get ALL_PATTERNS(): RegExp[] {
    return [Merchant.TO_PATTERN, Merchant.FROM_PATTERN, Merchant.AT_PATTERN, Merchant.FOR_PATTERN];
  },
};

export const HDFC = {
  DLT_PATTERNS: [/^[A-Z]{2}-HDFCBK.*$/, /^[A-Z]{2}-HDFC.*$/, /^HDFC-[A-Z]+$/, /^[A-Z]{2}-HDFCB.*$/],
  SALARY_PATTERN: /for\s+[^-]+-[^-]+-[^-]+\s+[A-Z]+\s+SALARY-([^.\n]+)/i,
  SIMPLE_SALARY_PATTERN: /SALARY[- ]([^.\n]+?)(?:\s+Info|$)/i,
  INFO_PATTERN: /Info:\s*(?:UPI\/)?([^/.\n]+?)(?:\/|$)/i,
  VPA_WITH_NAME: /VPA\s+[^@\s]+@[^\s]+\s*\(([^)]+)\)/i,
  VPA_PATTERN: /VPA\s+([^@\s]+)@/i,
  SPENT_PATTERN: /at\s+([^.\n]+?)\s+on\s+\d{2}/i,
  DEBIT_FOR_PATTERN: /debited\s+for\s+([^.\n]+?)\s+on\s+\d{2}/i,
  MANDATE_PATTERN: /To\s+([^\n]+?)\s*(?:\n|\d{2}\/\d{2})/i,
  REF_SIMPLE: /Ref\s+(\d{9,12})/i,
  UPI_REF_NO: /UPI\s+Ref\s+No\s+(\d{12})/i,
  REF_NO: /Ref\s+No\.?\s+([A-Z0-9]+)/i,
  REF_END: /(?:Ref|Reference)[:.\s]+([A-Z0-9]{6,})(?:\s*$|\s*Not\s+You)/i,
  ACCOUNT_DEPOSITED: /deposited\s+in\s+(?:HDFC\s+Bank\s+)?A\/c\s+(?:XX+)?(\d{3,6})/i,
  ACCOUNT_FROM: /from\s+(?:HDFC\s+Bank\s+)?A\/c\s+(?:XX+)?(\d{3,6})/i,
  ACCOUNT_SIMPLE: /HDFC\s+Bank\s+A\/c\s+(\d{3,6})/i,
  ACCOUNT_GENERIC: /A\/c\s+(?:XX+)(\d{3,4})/i,
  AMOUNT_WILL_DEDUCT: /Rs\.?\s*([0-9,]+(?:\.\d{2})?)\s+will\s+be\s+deducted/i,
  DEDUCTION_DATE: /deducted\s+on\s+(\d{2}\/\d{2}\/\d{2}),?\s*\d{2}:\d{2}:\d{2}/i,
  MANDATE_MERCHANT: /For\s+([^\n]+?)\s+mandate/i,
  UMN_PATTERN: /UMN\s+([a-zA-Z0-9@]+)/i,
};

export const Cleaning = {
  TRAILING_PARENTHESES: /\s*\(.*?\)\s*$/,
  REF_NUMBER_SUFFIX: /\s+Ref\s+No.*/i,
  DATE_SUFFIX: /\s+on\s+\d{2}.*/,
  UPI_SUFFIX: /\s+UPI.*/i,
  TIME_SUFFIX: /\s+at\s+\d{2}:\d{2}.*/,
  TRAILING_DASH: /\s*-\s*$/,
  PVT_LTD: /(\s+PVT\.?\s*LTD\.?|\s+PRIVATE\s+LIMITED)$/i,
  LTD: /(\s+LTD\.?|\s+LIMITED)$/i,
};

export const Currency = {
  ISO_CODE: /[A-Z]{3}/,
  COMMON_CURRENCIES: /(?:INR|Rs\.?|₹|USD|EUR|GBP|AED|SAR)/i,
};

export const DatePatterns = {
  DD_MM_YY: /\d{1,2}\/\d{1,2}\/\d{2}/,
  DD_MM_YYYY: /\d{1,2}\/\d{1,2}\/\d{4}/,
  DD_MMM_YY: /\d{1,2}-[A-Za-z]{3}-\d{2}/i,
  DD_MM_YYYY_DASH: /\d{1,2}-\d{1,2}-\d{4}/,
};

export const TimePatterns = {
  HH_MM_SS: /\d{1,2}:\d{2}:\d{2}/,
  HH_MM: /\d{1,2}:\d{2}/,
};

/**
 * Kotlin `BigDecimal(str.replace(",", ""))` → integer paise.
 * Returns null where Kotlin would throw NumberFormatException.
 * Accepts a missing integer part (".28") like upstream's NUM pattern.
 */
export function toPaise(raw: string | null | undefined): Paise | null {
  if (raw == null) {
    return null;
  }
  let s = raw.replace(/,/g, '').trim();
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) {
    return null;
  }
  if (s.startsWith('.')) {
    s = `0${s}`;
  }
  const [intPart, frac = ''] = s.split('.');
  if (frac.length > 2) {
    // BigDecimal keeps every digit; paise cannot. Round half up.
    const base = parseAmountToPaise(`${intPart}.${frac.slice(0, 2)}`);
    if (base === undefined) {
      return null;
    }
    return Number(frac[2]) >= 5 ? base + 1 : base;
  }
  return parseAmountToPaise(frac ? `${intPart}.${frac}` : intPart) ?? null;
}
