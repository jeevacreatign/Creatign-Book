// Report basis. The stored ledger (db.journals) is accrual. The cash-basis ledger recognises income and
// expense from invoices, bills and credits only as they are settled: each payment, credit application,
// refund or write-off brings in the matching share of the document's journal on the settlement date.
// Manual journals follow their reporting method (Accrual Only / Cash Only / both).
import { round2 } from '../shared/format';
import type { Database, Journal, JournalLine } from '../shared/types';

export type Basis = 'accrual' | 'cash';

const DOC_SOURCES = new Set(['invoice', 'credit_note', 'bill', 'vendor_credit']);

function scaled(j: Journal, factor: number, date: string, suffix: string): Journal {
  const lines: JournalLine[] = j.lines.map((l) => ({ ...l, debit: round2(l.debit * factor), credit: round2(l.credit * factor) }));
  // keep the journal balanced after rounding: put the difference on the largest line
  const diff = round2(lines.reduce((s, l) => s + l.debit - l.credit, 0));
  if (Math.abs(diff) > 0.001 && lines.length) {
    const big = lines.reduce((a, b) => (Math.max(a.debit, a.credit) >= Math.max(b.debit, b.credit) ? a : b));
    if (big.debit) big.debit = round2(big.debit - diff);
    else big.credit = round2(big.credit + diff);
  }
  return { ...j, id: `${j.id}${suffix}`, date, lines };
}

export function ledger(db: Database, basis: Basis = 'accrual'): Journal[] {
  const keepManual = (j: Journal) => j.sourceType !== 'manual' || (basis === 'accrual' ? j.reportingMethod !== 'cash_only' : j.reportingMethod !== 'accrual_only');
  if (basis === 'accrual') return db.journals.filter(keepManual);

  const out: Journal[] = [];
  const docJournal = new Map<string, Journal>();
  for (const j of db.journals) {
    if (!keepManual(j)) continue;
    if (DOC_SOURCES.has(j.sourceType) && j.sourceId) docJournal.set(j.sourceId, j);
    else out.push(j);
  }
  const share = (docId: string, amount: number, date: string, suffix: string) => {
    const j = docJournal.get(docId);
    const d = db.docs.find((x) => x.id === docId);
    if (!j || !d || !d.total) return;
    out.push(scaled(j, Math.min(1, amount / d.total), date, suffix));
  };
  for (const p of db.paymentsReceived) if (p.status === 'paid') for (const a of p.allocations) share(a.docId, a.amount, p.date, `_cash_${p.id}`);
  for (const p of db.paymentsMade) if (p.status === 'paid') for (const a of p.allocations) share(a.docId, a.amount, p.date, `_cash_${p.id}`);
  for (const d of db.docs) {
    if (!docJournal.has(d.id)) continue;
    if (d.kind === 'credit_note' || d.kind === 'vendor_credit') {
      for (const c of d.creditApplications) {
        share(d.id, c.amount, c.date, `_cash_${c.id}`);
        share(c.invoiceId, c.amount, c.date, `_cash_${c.id}_inv`);
      }
      for (const r of d.refunds) share(d.id, r.amount, r.date, `_cash_${r.id}`);
    }
    if (d.writeOff?.amount) share(d.id, d.writeOff.amount, d.writeOff.date, '_cash_wo');
  }
  return out.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)));
}
