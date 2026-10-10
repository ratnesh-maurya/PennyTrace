/**
 * End to end: a week of realistic bank SMS → parsers → ledger engine → screen view models.
 */
import { dailyClose, reconcile, reviewQueue } from '../../../core/ledger';
import { parseSms } from '../../../core/parsers';
import { addDays, today } from '../../../core/time';
import { createDemoBackend } from '../demoBackend';
import { demoSms } from '../demo/demoSms';
import { countTransactions, listTransactions, transactionDetail, transferPairs } from '../views';

const NOW = new Date(2026, 9, 9, 22, 0).getTime();
const TODAY = today(NOW);
const rs = (r: number) => r * 100;

async function load() {
  return createDemoBackend(NOW).load();
}

describe('demo inbox', () => {
  it('every demo SMS is understood by a bank parser', () => {
    for (const sms of demoSms(NOW)) {
      const out = parseSms(sms);
      expect({ body: sms.body, status: out.status }).toEqual({ body: sms.body, status: 'parsed' });
      expect(out.parsed?.parserId).not.toMatch(/^generic/);
    }
  });

  it('merges the two Swiggy alerts into one transaction with both as evidence', async () => {
    const { ledger, sources } = await load();
    const swiggy = ledger.transactions.filter(t => t.counterparty === 'Swiggy');
    expect(swiggy).toHaveLength(1);
    expect(swiggy[0].sourceIds).toHaveLength(2);
    const detail = transactionDetail(ledger, sources, swiggy[0].id);
    expect(detail?.sources.map(s => s.body)).toEqual(
      expect.arrayContaining([expect.stringContaining('VPA swiggy@icici')]),
    );
  });

  it('matches the HDFC → SBI self transfer and holds the joint-account payment in transit', async () => {
    const { ledger } = await load();
    const pairs = transferPairs(ledger);
    expect(pairs.find(p => p.state === 'matched')).toMatchObject({
      fromAccountId: 'hdfc-1234',
      toAccountId: 'sbi-8821',
      amount: rs(5000),
      method: 'ref',
    });
    expect(pairs.find(p => p.state === 'in_transit')).toMatchObject({ fromAccountId: 'sbi-8821', amount: rs(2000) });
  });

  it('today: real spending only; the self transfer is moved, not spent or received', async () => {
    const { ledger } = await load();
    const c = dailyClose(ledger, TODAY, 'all');
    expect(c.received).toBe(rs(4000)); // Rohan Mehta
    expect(c.spent).toBe(rs(540 + 349 + 840 + 400)); // Uber, Swiggy, BESCOM, unknown merchant
    expect(c.movedNet).toBe(0);
    expect(c.movedGross).toBe(rs(5000));
    expect(c.closing).toBe(c.opening + c.received - (c.spent - c.spentOnCard) + c.movedNet);
    expect(c.closingProvenance).toBe('reported');
    expect(c.reported?.variance).toBe(0);
  });

  it('yesterday: card bill, ATM cash and refund are not spending; the card swipe is', async () => {
    const { ledger } = await load();
    const c = dailyClose(ledger, addDays(TODAY, -1), 'all');
    expect(c.spent).toBe(rs(599)); // Airtel, on the ICICI card
    expect(c.spentOnCard).toBe(rs(599));
    expect(c.received).toBe(0);
    const kindOf = (amount: number) => ledger.transactions.find(t => t.amount === amount)?.kind;
    expect(kindOf(rs(8000))).toBe('liability'); // ICICI card bill paid from HDFC
    expect(ledger.transactions.find(t => t.kind === 'cash')?.amount).toBe(rs(2000));
    expect(ledger.transactions.find(t => t.kind === 'refund')?.amount).toBe(rs(1299));
  });

  it('reconciles both bank accounts with the balances printed in the SMS', async () => {
    const { ledger } = await load();
    const byId = Object.fromEntries(reconcile(ledger).map(r => [r.accountId, r]));
    expect(byId['hdfc-1234']).toMatchObject({ status: 'reconciled', variance: 0, calculated: rs(93310) });
    expect(byId['sbi-8821']).toMatchObject({ status: 'reconciled', variance: 0, calculated: rs(25150) });
  });

  it('asks about the merchant it does not know, and a correction with a rule sticks', async () => {
    const backend = createDemoBackend(NOW);
    const before = await backend.load();
    const [unsure] = reviewQueue(before.ledger);
    expect(unsure.counterparty).toBe('Sri Lakshmi Agencies');

    await backend.correct(unsure, 'groceries', true);
    const after = await backend.load();
    const fixed = after.ledger.transactions.find(t => t.stableKey === unsure.stableKey);
    expect(fixed).toMatchObject({ categoryId: 'groceries', needsReview: false });
    expect(reviewQueue(after.ledger)).toHaveLength(0);
  });

  it('activity lists each transfer once and counts the review filter', async () => {
    const { ledger } = await load();
    const all = listTransactions(ledger, 'all', '').flatMap(s => s.data);
    expect(all.filter(i => i.txn.kind === 'xfer')).toHaveLength(1);
    expect(countTransactions(ledger, '').review).toBe(1);
    expect(listTransactions(ledger, 'all', 'swiggy').flatMap(s => s.data)).toHaveLength(1);
  });
});
