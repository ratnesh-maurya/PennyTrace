// Ported from pennywiseai-tracker (https://github.com/sarim2000/pennywiseai-tracker), AGPL-3.0. Modified for PennyTrace.
//
// Internal result shape of a ported bank parser (upstream `ParsedTransaction` +
// `TransactionType`). It stays close to upstream so bank ports remain faithful;
// `toEvent.ts` maps it onto the app-wide `ParsedEvent` contract.

import type { Paise } from '../../types';

/** Upstream `TransactionType`. */
export type TransactionType = 'INCOME' | 'EXPENSE' | 'CREDIT' | 'TRANSFER' | 'INVESTMENT' | 'BALANCE_UPDATE';

export const TransactionType = {
  INCOME: 'INCOME',
  EXPENSE: 'EXPENSE',
  /** Credit-card spend (money owed, not money left an account). */
  CREDIT: 'CREDIT',
  TRANSFER: 'TRANSFER',
  INVESTMENT: 'INVESTMENT',
  BALANCE_UPDATE: 'BALANCE_UPDATE',
} as const;

/** Upstream `ParsedTransaction`, with amounts already in integer paise. */
export interface BankTxn {
  amount: Paise;
  type: TransactionType;
  merchant?: string | null;
  reference?: string | null;
  accountLast4?: string | null;
  balance?: Paise | null;
  /** Upstream calls this creditLimit; it is the AVAILABLE limit. */
  creditLimit?: Paise | null;
  smsBody: string;
  sender: string;
  timestamp: number;
  bankName: string;
  isFromCard: boolean;
  /** ISO code; INR unless the bank printed a foreign currency. */
  currency: string;
  fromAccount?: string | null;
  toAccount?: string | null;
}

/** Upstream `MandateInfo`. */
export interface MandateInfo {
  amount: Paise;
  nextDeductionDate: string | null;
  merchant: string;
  umn: string | null;
  dateFormat: string;
  accountLast4: string | null;
}

/** Upstream `BaseIndianBankParser.BaseBalanceUpdateInfo`. */
export interface BalanceUpdateInfo {
  bankName: string;
  accountLast4: string | null;
  balance: Paise;
  asOfDate?: number | null;
}
