/**
 * Lifecycle links that span separate transactions.
 *
 * - pending → success / failed is handled in dedupe (same txn, last status wins).
 * - Reversal credit ("Rs 500 reversed to your a/c"): its own `refund` txn, linked
 *   both ways to the debit it undoes (same account, same amount, shared ref first,
 *   then closest earlier debit within 30 days). The debit's status becomes
 *   `reversed`; both keep their balance effect and leave "Spent" (see dailyClose).
 * - Merchant refund: its own `refund` txn linked one-way (refund → original) to
 *   the latest spend from the same counterparty with amount ≥ refund within 60
 *   days (without a counterparty: same account and equal amount). Several partial
 *   refunds may point to one purchase. The purchase stays in "Spent".
 */
import type { TransferLink } from '../types';
import type { Draft } from './draft';
import { MS_DAY } from '../time';
import { cmpStr, sameCounterparty, sharesStrongRef } from './util';

export const REVERSAL_WINDOW_MS = 30 * MS_DAY;
export const REFUND_WINDOW_MS = 60 * MS_DAY;

const REVERSIBLE = new Set(['spend', 'fee', 'pending_xfer', 'cash', 'liability']);

export function linkReversalsAndRefunds(drafts: Draft[], links: TransferLink[]): TransferLink[] {
  // Reversals: one-to-one.
  const reversals = drafts.filter(d => d.kind === 'refund' && d.reversal && d.status !== 'failed' && !d.linkedTxnId);
  const cands: { r: Draft; d: Draft; score: number[] }[] = [];
  for (const r of reversals) {
    for (const d of drafts) {
      const dt = r.occurredAt - d.occurredAt;
      if (
        d.direction !== 'debit' ||
        d.accountId !== r.accountId ||
        d.amount !== r.amount ||
        d.status === 'failed' ||
        d.linkedTxnId ||
        !REVERSIBLE.has(d.kind ?? '') ||
        dt < 0 ||
        dt > REVERSAL_WINDOW_MS
      ) {
        continue;
      }
      cands.push({ r, d, score: [sharesStrongRef(r.refs, d.refs) ? 0 : 1, dt] });
    }
  }
  cands.sort((a, b) => a.score[0] - b.score[0] || a.score[1] - b.score[1] || cmpStr(a.r.id, b.r.id) || cmpStr(a.d.id, b.d.id));
  const used = new Set<string>();
  let out = links;
  for (const { r, d } of cands) {
    if (used.has(r.id) || used.has(d.id)) {
      continue;
    }
    used.add(r.id);
    used.add(d.id);
    r.linkedTxnId = d.id;
    d.linkedTxnId = r.id;
    d.status = 'reversed';
    if (d.kind === 'pending_xfer') {
      // The money came back: it is no longer in transit.
      out = out.filter(l => !(l.debitTxnId === d.id && l.state === 'in_transit'));
    }
  }

  // Merchant refunds: many-to-one, refund → original only.
  for (const r of drafts) {
    if (r.kind !== 'refund' || r.reversal || r.linkedTxnId) {
      continue;
    }
    let best: Draft | undefined;
    let bestScore: number[] | undefined;
    for (const d of drafts) {
      const dt = r.occurredAt - d.occurredAt;
      if (d.direction !== 'debit' || d.kind !== 'spend' || d.status === 'failed' || d.amount < r.amount || dt < 0 || dt > REFUND_WINDOW_MS) {
        continue;
      }
      const byName = sameCounterparty(r.counterparty, d.counterparty) || (!!r.vpa && r.vpa === d.vpa);
      const byAccount = !r.counterparty && !r.vpa && d.accountId === r.accountId && d.amount === r.amount;
      if (!byName && !byAccount) {
        continue;
      }
      const score = [d.accountId === r.accountId ? 0 : 1, dt];
      if (!bestScore || score[0] - bestScore[0] < 0 || (score[0] === bestScore[0] && (score[1] < bestScore[1] || (score[1] === bestScore[1] && cmpStr(d.id, best!.id) < 0)))) {
        best = d;
        bestScore = score;
      }
    }
    if (best) {
      r.linkedTxnId = best.id;
    }
  }
  return out;
}
