/**
 * Kind assignment: what each transaction means for the user's money.
 *
 * Order (first rule that applies wins; a kind the user set is never touched):
 *  1. User links (`linkToStableKey`) → `xfer` pair, method `user`.
 *  2. ATM withdrawal → `cash`. Reversal / refund credit → `refund`.
 *  3. Card bills: any non-refund credit on a credit-card account, and any debit
 *     with card-bill evidence (hint, counter-account = own card, CRED-style payee)
 *     → `liability`; card credit ↔ bank debit paired by ref, then amount ≤ 72 h.
 *  4. Own-account transfers between non-card accounts:
 *     a. shared UPI ref / UTR + same amount → `ref`
 *     b. same amount, credit 0–72 h after the debit (10 min clock skew allowed),
 *        and at least one side looks self-directed (or neither names anyone) →
 *        `alias` when the debit names the credited account, else `amount_time`.
 *     Pairs are chosen one-to-one, best evidence then closest in time, ties by id.
 *  5. A self-looking debit with no credit yet → `pending_xfer` ("in transit").
 *  6. Bank charge → `fee`; other debits → `spend`; other credits → `in`.
 * Failed / reversed alerts get a kind but are never paired.
 */
import type { Account, AccountId, TransferLink } from '../types';
import type { AccountResolver } from './accounts';
import type { Draft } from './draft';
import { isVoid } from './draft';
import { BANK_CHARGE, matchesAny, matchSeed } from './seedRules';
import { cmpNum, cmpStr, nameTokens, sharesStrongRef, vpaHandleWords } from './util';

export const TRANSFER_WINDOW_MS = 72 * 3_600_000;
const SKEW_MS = 10 * 60_000;

export class SelfMatcher {
  private vpas = new Set<string>();
  private names: string[][] = [];
  private vpaToAccount = new Map<string, AccountId>();
  private aliasToAccount: { tokens: string[]; accountId: AccountId }[] = [];

  constructor(private accounts: readonly Account[], selfIdentities: readonly string[]) {
    for (const raw of selfIdentities) {
      const id = raw.trim().toLowerCase();
      if (!id) {
        continue;
      }
      if (id.includes('@')) {
        this.vpas.add(id);
      } else {
        this.addName(nameTokens(id));
      }
    }
    for (const a of accounts) {
      for (const u of a.upiIds) {
        this.vpas.add(u);
        this.vpaToAccount.set(u, a.id);
      }
      for (const alias of a.aliases) {
        if (alias.includes('@')) {
          this.vpas.add(alias.toLowerCase());
          this.vpaToAccount.set(alias.toLowerCase(), a.id);
        } else {
          const tokens = nameTokens(alias);
          this.addName(tokens);
          if (tokens.length) {
            this.aliasToAccount.push({ tokens, accountId: a.id });
          }
        }
      }
    }
  }

  private addName(tokens: string[]): void {
    if (tokens.some(t => t.length >= 3)) {
      this.names.push(tokens);
    }
  }

  private nameMatches(counterparty: string | undefined, tokens: string[]): boolean {
    const have = new Set(nameTokens(counterparty));
    return have.size > 0 && tokens.every(t => have.has(t));
  }

  isSelfVpa(vpa: string | undefined): boolean {
    return !!vpa && this.vpas.has(vpa.toLowerCase());
  }

  isSelfName(counterparty: string | undefined): boolean {
    if (!counterparty) {
      return false;
    }
    if (counterparty.includes('@') && this.isSelfVpa(counterparty.trim())) {
      return true;
    }
    return this.names.some(tokens => this.nameMatches(counterparty, tokens));
  }

  /** Bank says "to/from your a/c XX8821", or the payee is one of the user's own ids/names. */
  looksSelf(d: Draft): boolean {
    // The other account must be one of the user's: "credited to a/c no. XXXXXX7881" is very often
    // someone else's account.
    const other = d.hints.counterAccountLast4;
    if (other && this.accounts.some(a => a.mask === other && a.id !== d.accountId)) {
      return true;
    }
    // "transferred to your account XXXXX05754": the bank itself says it is the user's account.
    if (/\byour\s+(?:a\/c|account)\b/i.test(d.counterparty ?? '')) {
      return true;
    }
    return this.isSelfVpa(d.vpa) || this.isSelfName(d.counterparty);
  }

  /** The own account a debit names as its destination, if any. */
  target(d: Draft): AccountId | undefined {
    const last4 =
      d.hints.counterAccountLast4 ?? /\byour\s+(?:a\/c|account)\s+[X*]*\d*?(\d{4})\b/i.exec(d.counterparty ?? '')?.[1];
    if (last4) {
      const hits = this.accounts.filter(a => a.mask === last4 && a.id !== d.accountId);
      if (hits.length === 1) {
        return hits[0].id;
      }
    }
    if (d.vpa && this.vpaToAccount.has(d.vpa)) {
      return this.vpaToAccount.get(d.vpa);
    }
    const alias = this.aliasToAccount.find(
      x => x.accountId !== d.accountId && this.nameMatches(d.counterparty, x.tokens),
    );
    return alias?.accountId;
  }
}

interface Candidate {
  debit: Draft;
  credit: Draft;
  score: number[];
  method: TransferLink['method'];
  confidence: number;
}

/** One-to-one greedy pairing: best score first, ties broken by txn ids (deterministic). */
function pairGreedy(cands: Candidate[]): Candidate[] {
  cands.sort((a, b) => {
    for (let i = 0; i < a.score.length; i++) {
      if (a.score[i] !== b.score[i]) {
        return a.score[i] - b.score[i];
      }
    }
    return cmpStr(a.debit.id, b.debit.id) || cmpStr(a.credit.id, b.credit.id);
  });
  const used = new Set<string>();
  const out: Candidate[] = [];
  for (const c of cands) {
    if (used.has(c.debit.id) || used.has(c.credit.id)) {
      continue;
    }
    used.add(c.debit.id);
    used.add(c.credit.id);
    out.push(c);
  }
  return out;
}

const CARD_PAYEE = ['cred', 'credit card', 'card payment', 'cc payment', 'cc bill', 'card bill', 'creditcard'];

export interface ClassifyOptions {
  resolver: AccountResolver;
  self: SelfMatcher;
  /** [a, b] pairs the user linked as a transfer. */
  userLinks: [Draft, Draft][];
}

function link(c: Candidate, kind: 'xfer' | 'liability'): TransferLink {
  c.debit.kind = kind;
  c.credit.kind = kind;
  c.debit.linkedTxnId = c.credit.id;
  c.credit.linkedTxnId = c.debit.id;
  c.debit.transferMethod = c.method;
  c.credit.transferMethod = c.method;
  return {
    debitTxnId: c.debit.id,
    creditTxnId: c.credit.id,
    method: c.method,
    state: 'matched',
    confidence: c.confidence,
  };
}

/** A debit into investments: the bank says so (NACH/SIP/broker words), or the payee is a known platform. */
function isInvestment(d: Draft): boolean {
  if (d.hints.isInvestment) {
    return true;
  }
  const seed = matchSeed(d.counterparty) ?? matchSeed(vpaHandleWords(d.vpa));
  return seed?.rule.categoryId === 'investments';
}

export function classify(drafts: Draft[], opts: ClassifyOptions): TransferLink[] {
  const { resolver, self } = opts;
  const links: TransferLink[] = [];
  const accountOf = (d: Draft) => resolver.byId.get(d.accountId);
  const isCard = (d: Draft) => accountOf(d)?.type === 'credit_card';
  const open = (d: Draft) => d.kind === undefined && !d.kindFixed;
  const live = (d: Draft) => !isVoid(d);

  // 1. User links.
  for (const [a, b] of opts.userLinks) {
    if (a.direction === b.direction || a.linkedTxnId || b.linkedTxnId) {
      continue;
    }
    const debit = a.direction === 'debit' ? a : b;
    const credit = a.direction === 'debit' ? b : a;
    debit.kindFixed = credit.kindFixed = true;
    links.push(link({ debit, credit, score: [], method: 'user', confidence: 100 }, 'xfer'));
  }

  // 2. Hint-driven kinds.
  for (const d of drafts) {
    if (!open(d)) {
      continue;
    }
    if (d.direction === 'debit' && d.hints.isAtmWithdrawal) {
      d.kind = 'cash';
    } else if (
      d.direction === 'credit' &&
      (d.hints.isReversal || d.sources.some(s => s.parsed.status === 'reversed'))
    ) {
      d.kind = 'refund';
      d.reversal = true;
      // The credit itself landed; "reversed" describes the original debit.
      if (d.status === 'reversed') {
        d.status = 'success';
      }
    } else if (d.direction === 'credit' && d.hints.isRefund) {
      d.kind = 'refund';
    }
  }

  // 3. Card bills.
  const cardMasks = new Set(drafts.filter(isCard).map(d => accountOf(d)!.mask));
  for (const d of drafts) {
    if (!open(d)) {
      continue;
    }
    if (isCard(d) && d.direction === 'credit') {
      d.kind = 'liability';
    } else if (
      !isCard(d) &&
      d.direction === 'debit' &&
      (d.hints.isCardBillPayment ||
        (d.hints.counterAccountLast4 !== undefined && cardMasks.has(d.hints.counterAccountLast4)) ||
        matchesAny(d.counterparty ?? '', CARD_PAYEE) !== undefined)
    ) {
      d.kind = 'liability';
    }
  }
  {
    const cardCredits = drafts.filter(
      d => d.kind === 'liability' && !d.kindFixed && d.direction === 'credit' && isCard(d) && live(d),
    );
    const bankDebits = drafts.filter(
      d =>
        !isCard(d) &&
        d.direction === 'debit' &&
        live(d) &&
        !d.kindFixed &&
        (d.kind === 'liability' || d.kind === undefined),
    );
    const cands: Candidate[] = [];
    for (const c of cardCredits) {
      const cardMask = accountOf(c)!.mask;
      for (const d of bankDebits) {
        if (d.amount !== c.amount) {
          continue;
        }
        const ref = sharesStrongRef(d.refs, c.refs);
        const dt = Math.abs(c.occurredAt - d.occurredAt);
        if (!ref && (d.kind !== 'liability' || dt > TRANSFER_WINDOW_MS)) {
          continue;
        }
        const named = d.hints.counterAccountLast4 === cardMask;
        cands.push({
          debit: d,
          credit: c,
          score: [ref ? 0 : 1, named ? 0 : 1, dt],
          method: ref ? 'ref' : named ? 'alias' : 'amount_time',
          confidence: ref ? 99 : named ? 90 : 75,
        });
      }
    }
    for (const c of pairGreedy(cands)) {
      links.push(link(c, 'liability'));
    }
  }

  // 4. Own-account transfers.
  const debits = () => drafts.filter(d => open(d) && live(d) && d.direction === 'debit' && !isCard(d));
  const credits = () =>
    drafts.filter(d => open(d) && live(d) && d.direction === 'credit' && !isCard(d) && !d.hints.isSalary);
  {
    const cands: Candidate[] = [];
    const cs = credits();
    for (const d of debits()) {
      for (const c of cs) {
        if (c.accountId !== d.accountId && c.amount === d.amount && sharesStrongRef(d.refs, c.refs)) {
          cands.push({
            debit: d,
            credit: c,
            score: [Math.abs(c.occurredAt - d.occurredAt)],
            method: 'ref',
            confidence: 99,
          });
        }
      }
    }
    for (const c of pairGreedy(cands)) {
      links.push(link(c, 'xfer'));
    }
  }
  {
    const cands: Candidate[] = [];
    const cs = credits();
    for (const d of debits()) {
      if (matchSeed(d.counterparty) && !self.looksSelf(d)) {
        continue; // a known merchant is never an own account
      }
      const target = self.target(d);
      const debitSelf = self.looksSelf(d);
      const debitAnon = !d.counterparty && !d.vpa;
      for (const c of cs) {
        const dt = c.occurredAt - d.occurredAt;
        if (c.accountId === d.accountId || c.amount !== d.amount || dt < -SKEW_MS || dt > TRANSFER_WINDOW_MS) {
          continue;
        }
        if (target && target !== c.accountId) {
          continue;
        }
        const creditSelf =
          self.isSelfName(c.counterparty) || self.isSelfVpa(c.vpa) || c.hints.counterAccountLast4 !== undefined;
        const creditAnon = !c.counterparty && !c.vpa;
        if (!(debitSelf || creditSelf || (debitAnon && creditAnon))) {
          continue;
        }
        const named = target === c.accountId;
        cands.push({
          debit: d,
          credit: c,
          score: [named ? 0 : 1, debitSelf || creditSelf ? 0 : 1, Math.abs(dt)],
          method: named ? 'alias' : 'amount_time',
          confidence: named ? 90 : debitSelf || creditSelf ? 80 : 60,
        });
      }
    }
    for (const c of pairGreedy(cands)) {
      links.push(link(c, 'xfer'));
    }
  }

  // 5. In transit.
  for (const d of drafts) {
    if (open(d) && live(d) && d.direction === 'debit' && !isCard(d) && self.looksSelf(d)) {
      d.kind = 'pending_xfer';
      d.transferMethod = 'alias';
      links.push({ debitTxnId: d.id, method: 'alias', state: 'in_transit', confidence: 70 });
    }
  }

  // 6. Everything else.
  for (const d of drafts) {
    if (d.kind !== undefined) {
      continue;
    }
    if (d.direction === 'credit') {
      d.kind = 'in';
    } else if (isInvestment(d)) {
      d.kind = 'invest';
    } else if (matchesAny(d.counterparty ?? '', BANK_CHARGE) !== undefined || /charge|fee/i.test(d.parserId)) {
      d.kind = 'fee';
    } else {
      d.kind = 'spend';
    }
  }

  return links.sort(
    (a, b) =>
      cmpStr(a.debitTxnId, b.debitTxnId) ||
      cmpStr(a.creditTxnId ?? '', b.creditTxnId ?? '') ||
      cmpNum(a.confidence, b.confidence),
  );
}
