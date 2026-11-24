// Core accounting engine: derives balances/statuses from source documents and
// rebuilds the double-entry general ledger. Derived state is recomputed from
// scratch after every mutation, so the ledger can never drift from the documents.
import { computeTotals, taxInTotal } from '../shared/calc';
import { GST_ACCOUNTS, computeTax, isIntraState, stateFromGstin, taxRate } from '../shared/gst';
import { isUnposted } from '../shared/approval';
import { ACCOUNT_IDS as A, DOC_META } from '../shared/docmeta';
import { nextRecurrence, round2, today, addDays, dueDateFor } from '../shared/format';
import type { Database, Journal, JournalLine, JournalSource, TxnDoc, Expense, ExpenseGst, RecurringExpense } from '../shared/types';
import { getDb, newId, now, peekNumber, takeNumber } from './db';

const OPEN_FAMILY_INVOICE = new Set(['open', 'sent', 'due_today', 'overdue', 'partially_paid', 'paid']);

export const isPostedInvoice = (d: TxnDoc) => d.kind === 'invoice' && OPEN_FAMILY_INVOICE.has(d.status);
export const isPostedBill = (d: TxnDoc) => d.kind === 'bill' && OPEN_FAMILY_INVOICE.has(d.status);
export const isPostedCredit = (d: TxnDoc) => (d.kind === 'credit_note' || d.kind === 'vendor_credit') && (d.status === 'open' || d.status === 'closed');

/** Apply computed totals to a document in place. */
export function applyTotals(doc: TxnDoc) {
  const t = computeTotals(doc);
  doc.lineItems.forEach((l, i) => {
    l.amount = t.lineAmounts[i];
    l.taxAmount = t.lineTax[i] || undefined;
  });
  doc.taxAmount = t.taxAmount;
  doc.taxBreakdown = t.taxBreakdown;
  doc.subTotal = t.subTotal;
  doc.discountAmount = t.discountAmount;
  doc.tdsAmount = t.tdsAmount;
  doc.tcsAmount = t.tcsAmount;
  doc.total = t.total;
}

function sum(ns: number[]) {
  return round2(ns.reduce((a, b) => a + (Number(b) || 0), 0));
}

// ------------------------------------------------------------------ balances

export function recompute(db: Database = getDb()) {
  const t = today();

  // payments received
  for (const p of db.paymentsReceived) {
    p.usedAmount = p.status === 'void' ? 0 : sum(p.allocations.map((a) => a.amount));
    p.refundedAmount = sum(p.refunds.map((r) => r.amount));
    p.unusedAmount = p.status === 'void' ? 0 : round2(p.amount + (p.tdsDeducted ? p.tdsAmount : 0) - p.usedAmount - p.refundedAmount);
  }
  for (const p of db.paymentsMade) {
    p.usedAmount = p.status === 'void' ? 0 : sum(p.allocations.map((a) => a.amount));
    p.refundedAmount = sum((p.refunds ?? []).map((r) => r.amount));
    p.unusedAmount = p.status === 'void' ? 0 : round2(p.amount - p.usedAmount - p.refundedAmount);
  }

  // credits (credit notes / vendor credits)
  for (const d of db.docs) {
    if (d.kind !== 'credit_note' && d.kind !== 'vendor_credit') continue;
    applyTotals(d);
    d.creditsUsed = sum([...d.creditApplications.map((c) => c.amount), ...d.refunds.map((r) => r.amount)]);
    d.balance = round2(d.total - d.creditsUsed);
    if (d.status === 'open' || d.status === 'closed') d.status = d.balance <= 0.004 ? 'closed' : 'open';
  }

  // invoices & bills
  const paidOn = new Map<string, number>();
  for (const p of db.paymentsReceived) if (p.status === 'paid') for (const a of p.allocations) paidOn.set(a.docId, (paidOn.get(a.docId) || 0) + a.amount);
  for (const p of db.paymentsMade) if (p.status === 'paid') for (const a of p.allocations) paidOn.set(a.docId, (paidOn.get(a.docId) || 0) + a.amount);
  for (const c of db.docs) if (isPostedCredit(c)) for (const a of c.creditApplications) paidOn.set(a.invoiceId, (paidOn.get(a.invoiceId) || 0) + a.amount);

  for (const d of db.docs) {
    if (d.kind !== 'invoice' && d.kind !== 'bill') continue;
    applyTotals(d);
    const paid = round2((paidOn.get(d.id) || 0) + (d.writeOff?.amount || 0));
    d.amountPaid = paid;
    if (isUnposted(d.status) || d.status === 'void') {
      d.balance = d.status === 'void' ? 0 : d.total;
      continue;
    }
    d.balance = round2(d.total - paid);
    if (d.balance <= 0.004) d.status = 'paid';
    else if (paid > 0) d.status = 'partially_paid';
    else if (d.dueDate && d.dueDate < t) d.status = 'overdue';
    else if (d.dueDate === t) d.status = 'due_today';
    else d.status = d.sentAt ? 'sent' : 'open';
  }

  // quotes, sales orders, delivery challans, purchase orders
  const liveInvoices = db.docs.filter((d) => d.kind === 'invoice' && d.status !== 'void');
  const liveBills = db.docs.filter((d) => d.kind === 'bill' && d.status !== 'void');
  for (const d of db.docs) {
    if (['credit_note', 'vendor_credit', 'invoice', 'bill'].includes(d.kind)) continue;
    applyTotals(d);
    d.balance = d.total;
    if (d.kind === 'quote') {
      const inv = liveInvoices.some((i) => i.quoteId === d.id) || db.docs.some((s) => s.kind === 'sales_order' && s.quoteId === d.id && s.status !== 'void');
      if (inv && liveInvoices.some((i) => i.quoteId === d.id)) d.status = 'invoiced';
      else if (d.status === 'invoiced') d.status = 'accepted';
      if ((d.status === 'sent' || d.status === 'draft') && d.expiryDate && d.expiryDate < t) d.status = 'expired';
    }
    if (d.kind === 'sales_order') {
      const invs = liveInvoices.filter((i) => i.salesOrderId === d.id);
      const invoicedAmt = sum(invs.map((i) => i.subTotal));
      d.invoiceStatus = invs.length === 0 ? 'not_invoiced' : invoicedAmt + 0.004 >= d.subTotal ? 'invoiced' : 'partially_invoiced';
      const posted = invs.filter((i) => !isUnposted(i.status));
      const due = sum(posted.map((i) => i.balance));
      const paidAmt = sum(posted.map((i) => i.total - i.balance));
      d.paymentStatus = posted.length === 0 || paidAmt <= 0 ? 'unpaid' : due <= 0.004 ? 'paid' : 'partially_paid';
      d.shipmentStatus = d.shipmentStatus || 'pending';
      if (!isUnposted(d.status) && d.status !== 'void') d.status = d.invoiceStatus === 'invoiced' && d.shipmentStatus === 'fulfilled' ? 'closed' : 'confirmed';
    }
    if (d.kind === 'delivery_challan') {
      const inv = liveInvoices.some((i) => i.deliveryChallanId === d.id);
      d.invoiceStatus = inv ? 'invoiced' : 'not_invoiced';
    }
    if (d.kind === 'purchase_order') {
      const bills = liveBills.filter((b) => b.purchaseOrderId === d.id);
      const billedAmt = sum(bills.map((b) => b.subTotal));
      d.billedStatus = bills.length === 0 ? 'not_billed' : billedAmt + 0.004 >= d.subTotal ? 'billed' : 'partially_billed';
      if (!isUnposted(d.status) && d.status !== 'cancelled') d.status = d.billedStatus === 'billed' ? 'billed' : d.billedStatus === 'partially_billed' ? 'partially_billed' : 'issued';
    }
  }
  for (const d of db.docs) {
    if (d.kind !== 'recurring_invoice' && d.kind !== 'recurring_bill') continue;
    d.childCount = db.docs.filter((c) => c.recurringProfileId === d.id).length;
    if (d.status === 'active' && !d.neverExpires && d.endsOn && d.endsOn < t && (!d.nextDate || d.nextDate > d.endsOn)) d.status = 'expired';
  }
  for (const e of [...db.recurringExpenses, ...(db.recurringJournals ?? [])]) {
    if (e.status === 'active' && !e.neverExpires && e.endsOn && e.endsOn < t && (!e.nextDate || e.nextDate > e.endsOn)) e.status = 'expired';
  }

  rebuildJournals(db);
}

// ------------------------------------------------------------------ ledger

function jl(accountId: string, debit: number, credit: number, description?: string, contactId?: string): JournalLine {
  return { accountId, debit: round2(debit), credit: round2(credit), description, contactId };
}

/** Merge lines for the same account/side and drop zero lines. */
function tidy(lines: JournalLine[]): JournalLine[] {
  const map = new Map<string, JournalLine>();
  for (const l of lines) {
    if (l.debit < 0) [l.debit, l.credit] = [0, l.credit - l.debit];
    if (l.credit < 0) [l.credit, l.debit] = [0, l.debit - l.credit];
    const key = `${l.accountId}|${l.debit > 0 ? 'D' : 'C'}`;
    const cur = map.get(key);
    if (cur) {
      cur.debit = round2(cur.debit + l.debit);
      cur.credit = round2(cur.credit + l.credit);
    } else map.set(key, { ...l });
  }
  return [...map.values()].filter((l) => Math.abs(l.debit) > 0.004 || Math.abs(l.credit) > 0.004);
}

/** Lines for an invoice-like sales document (signs flipped for credit notes). */
/** Line amount net of tax when the document is tax inclusive. */
const netLine = (d: TxnDoc, l: TxnDoc['lineItems'][number]) => (d.taxInclusive && !d.reverseCharge ? round2(l.amount - (l.taxAmount || 0)) : l.amount);

function salesDocLines(d: TxnDoc, reverse = false): JournalLine[] {
  const ar = d.accountId || A.ar;
  const adj = round2(d.total - (d.subTotal - d.discountAmount + taxInTotal(d) - d.tdsAmount + d.tcsAmount)); // adjustment + round off
  const dr: JournalLine[] = [jl(ar, d.total, 0, undefined, d.contactId), jl(A.tdsReceivable, d.tdsAmount, 0), jl(A.discount, d.discountAmount, 0)];
  const cr: JournalLine[] = [];
  for (const l of d.lineItems) cr.push(jl(l.accountId || A.sales, 0, netLine(d, l)));
  for (const t of d.taxBreakdown ?? []) cr.push(jl(GST_ACCOUNTS.output[t.component], 0, t.amount, t.key));
  cr.push(jl(A.tcsPayable, 0, d.tcsAmount));
  if (adj >= 0) cr.push(jl(A.otherCharges, 0, adj));
  else dr.push(jl(A.otherCharges, -adj, 0));
  const lines = [...dr, ...cr];
  return reverse ? lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })) : lines;
}

function purchaseDocLines(d: TxnDoc, reverse = false): JournalLine[] {
  const ap = d.accountId || A.ap;
  const adj = round2(d.total - (d.subTotal - d.discountAmount + taxInTotal(d) - d.tdsAmount + d.tcsAmount));
  const dr: JournalLine[] = [];
  for (const l of d.lineItems) dr.push(jl(l.accountId || A.cogs, netLine(d, l), 0));
  // input tax credit; under reverse charge the tax is owed to the government instead of the vendor
  for (const t of d.taxBreakdown ?? []) dr.push(jl(GST_ACCOUNTS.input[t.component], t.amount, 0, t.key));
  dr.push(jl(A.tcsReceivable, d.tcsAmount, 0));
  const cr: JournalLine[] = [jl(ap, 0, d.total, undefined, d.contactId), jl(A.tdsPayable, 0, d.tdsAmount), jl(A.purchaseDiscount, 0, d.discountAmount)];
  if (d.reverseCharge) cr.push(jl(GST_ACCOUNTS.reverseChargePayable, 0, d.taxAmount || 0, 'Reverse charge'));
  if (adj >= 0) dr.push(jl('acc_other_expense', adj, 0));
  else cr.push(jl('acc_other_expense', 0, -adj));
  const lines = [...dr, ...cr];
  return reverse ? lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })) : lines;
}

/** Banking transaction types that bring money into the bank/cash/card account. */
export const BANK_MONEY_IN = new Set(['deposit', 'other_income', 'interest_income', 'owner_contribution', 'transfer_in', 'expense_refund']);

export function rebuildJournals(db: Database = getDb()) {
  const manual = (db.manualJournals ?? []).filter((j) => j.status !== 'draft').map((j) => ({ ...j, sourceType: 'manual' as const }));
  const out: Journal[] = [];
  const add = (sourceType: JournalSource, sourceId: string, date: string, lines: JournalLine[], reference?: string, contactId?: string, suffix = '') => {
    const t = tidy(lines);
    if (!t.length) return;
    out.push({ id: `jrn_${sourceType}_${sourceId}${suffix}`, number: '', date, sourceType, sourceId, contactId, reference, lines: t, createdAt: date });
  };

  const migration = db.organization.migrationDate || '2026-04-01';
  for (const c of db.contacts) {
    if (!c.openingBalance) continue;
    if (c.kind === 'customer') add('opening_balance', c.id, migration, [jl(c.accountId || A.ar, c.openingBalance, 0, 'Opening balance', c.id), jl(A.openingBalanceAdj, 0, c.openingBalance)], 'Opening Balance', c.id);
    else add('opening_balance', c.id, migration, [jl(A.openingBalanceAdj, c.openingBalance, 0), jl(c.accountId || A.ap, 0, c.openingBalance, 'Opening balance', c.id)], 'Opening Balance', c.id);
  }

  for (const d of db.docs) {
    if (isPostedInvoice(d)) {
      add('invoice', d.id, d.date, salesDocLines(d), d.number, d.contactId);
      if (d.writeOff?.amount) add('write_off', d.id, d.writeOff.date, [jl(A.badDebt, d.writeOff.amount, 0), jl(d.accountId || A.ar, 0, d.writeOff.amount, 'Write off', d.contactId)], d.number, d.contactId);
    }
    if (d.kind === 'credit_note' && isPostedCredit(d)) {
      add('credit_note', d.id, d.date, salesDocLines(d, true), d.number, d.contactId);
      for (const r of d.refunds) add('credit_note_refund', d.id, r.date, [jl(d.accountId || A.ar, r.amount, 0, 'Refund', d.contactId), jl(r.accountId, 0, r.amount)], d.number, d.contactId, `_${r.id}`);
    }
    if (isPostedBill(d)) add('bill', d.id, d.date, purchaseDocLines(d), d.number, d.contactId);
    if (d.kind === 'vendor_credit' && isPostedCredit(d)) {
      add('vendor_credit', d.id, d.date, purchaseDocLines(d, true), d.number, d.contactId);
      for (const r of d.refunds) add('credit_note_refund', d.id, r.date, [jl(r.accountId, r.amount, 0), jl(d.accountId || A.ap, 0, r.amount, 'Refund', d.contactId)], d.number, d.contactId, `_${r.id}`);
    }
  }

  for (const p of db.paymentsReceived) {
    if (p.status !== 'paid') continue;
    const tds = p.tdsDeducted ? p.tdsAmount : 0;
    add('payment_received', p.id, p.date, [
      jl(p.depositToAccountId, p.amount - p.bankCharges, 0),
      jl(A.bankCharges, p.bankCharges, 0),
      jl(A.tdsReceivable, tds, 0),
      jl(A.ar, 0, p.amount + tds, undefined, p.contactId),
    ], p.number, p.contactId);
    for (const r of p.refunds) add('payment_refund', p.id, r.date, [jl(A.ar, r.amount, 0, 'Refund', p.contactId), jl(r.accountId, 0, r.amount)], p.number, p.contactId, `_${r.id}`);
  }

  for (const p of db.paymentsMade) {
    if (p.status !== 'paid') continue;
    add('payment_made', p.id, p.date, [jl(A.ap, p.amount, 0, undefined, p.contactId), jl(p.paidThroughAccountId, 0, p.amount)], p.number, p.contactId);
    for (const r of p.refunds ?? []) add('payment_refund', p.id, r.date, [jl(r.accountId, r.amount, 0), jl(A.ap, 0, r.amount, 'Vendor refund', p.contactId)], p.number, p.contactId, `_${r.id}`);
  }

  for (const e of db.expenses) {
    // net of GST: lines carry the amount excluding tax when the expense has tax
    const lines: JournalLine[] = e.itemized && e.lines.length
      ? e.lines.map((l) => jl(l.accountId, e.taxInclusive ? round2(l.amount - (l.taxAmount || 0)) : l.amount, 0, l.notes))
      : [jl(e.accountId, e.subTotal ?? e.amount, 0, e.notes)];
    for (const t of e.taxBreakdown ?? []) lines.push(jl(GST_ACCOUNTS.input[t.component], t.amount, 0, t.key));
    if (e.reverseCharge && e.taxAmount) lines.push(jl(GST_ACCOUNTS.reverseChargePayable, 0, e.taxAmount, 'Reverse charge'));
    lines.push(jl(e.paidThroughAccountId, 0, e.amount, undefined, e.vendorId));
    add('expense', e.id, e.date, lines, e.invoiceNumber, e.vendorId);
  }

  for (const t of db.bankTransactions ?? []) {
    const lines = BANK_MONEY_IN.has(t.type)
      ? [jl(t.accountId, t.amount, 0, t.description), jl(t.offsetAccountId, 0, t.amount, t.description, t.contactId)]
      : [jl(t.offsetAccountId, t.amount, 0, t.description, t.contactId), jl(t.accountId, 0, t.amount, t.description)];
    add('bank_transaction', t.id, t.date, lines, t.referenceNumber, t.contactId);
  }

  const all = [...out, ...manual].sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)));
  // stable, human-friendly numbering for system journals
  let i = 0;
  for (const j of all) if (j.sourceType !== 'manual') j.number = `JRN-${String(++i).padStart(5, '0')}`;
  db.journals = all;
}

export function journalsFor(sourceId: string, db: Database = getDb()) {
  return db.journals.filter((j) => j.sourceId === sourceId);
}

// ------------------------------------------------------------------ recurring

export function makeDocFromProfile(profile: TxnDoc, date: string): TxnDoc {
  const kind = profile.kind === 'recurring_invoice' ? 'invoice' : 'bill';
  const meta = DOC_META[kind];
  const number = peekNumber(kind, meta.prefix);
  takeNumber(kind, meta.prefix, number);
  const ts = now();
  const doc: TxnDoc = {
    ...structuredClone(profile),
    id: newId(kind === 'invoice' ? 'inv' : 'bill'),
    kind,
    number,
    date,
    dueDate: dueDateFor(date, profile.paymentTerms),
    status: kind === 'invoice' ? (profile.createAsDraft ? 'draft' : 'open') : profile.createAsDraft ? 'draft' : 'open',
    recurringProfileId: profile.id,
    manuallyAdded: false,
    creditApplications: [],
    refunds: [],
    attachments: [],
    locked: false,
    profileName: undefined,
    repeatEvery: undefined,
    startOn: undefined,
    endsOn: undefined,
    neverExpires: undefined,
    nextDate: undefined,
    lastGeneratedDate: undefined,
    childCount: undefined,
    sentAt: undefined,
    createdAt: ts,
    updatedAt: ts,
  };
  doc.lineItems = doc.lineItems.map((l) => ({ ...l, id: newId('li') }));
  applyTotals(doc);
  doc.balance = doc.total;
  return doc;
}

/** Generate every due child document from active recurring profiles. Returns count created. */
export function runRecurring(db: Database = getDb(), upTo = today()): number {
  let created = 0;
  for (const p of db.docs) {
    if ((p.kind !== 'recurring_invoice' && p.kind !== 'recurring_bill') || p.status !== 'active' || !p.repeatEvery) continue;
    let next = p.nextDate || p.startOn || p.date;
    let guard = 0;
    while (next <= upTo && guard++ < 120) {
      if (!p.neverExpires && p.endsOn && next > p.endsOn) break;
      const child = makeDocFromProfile(p, next);
      db.docs.push(child);
      created++;
      p.lastGeneratedDate = next;
      next = nextRecurrence(next, p.repeatEvery);
      logActivity(db, p.kind, p.id, p.contactId, `${DOC_META[child.kind].label} ${child.number} created from the recurring profile`);
    }
    p.nextDate = next;
  }
  for (const r of db.recurringJournals ?? []) {
    if (r.status !== 'active') continue;
    let next = r.nextDate || r.startOn;
    let guard = 0;
    while (next <= upTo && guard++ < 120) {
      if (!r.neverExpires && r.endsOn && next > r.endsOn) break;
      const n = (db.counters.manual_journal || 0) + 1;
      db.counters.manual_journal = n;
      db.manualJournals.push({ id: newId('mj'), number: `MJ-${String(n).padStart(5, '0')}`, date: next, sourceType: 'manual', status: 'published', reportingMethod: r.reportingMethod, reference: r.reference, notes: r.notes, lines: r.lines.map((l) => ({ ...l })), recurringProfileId: r.id, attachments: [], createdBy: 'Recurring profile', createdAt: now() });
      created++;
      r.lastGeneratedDate = next;
      next = nextRecurrence(next, r.repeatEvery);
    }
    r.nextDate = next;
  }
  for (const r of db.recurringExpenses) {
    if (r.status !== 'active') continue;
    let next = r.nextDate || r.startOn;
    let guard = 0;
    while (next <= upTo && guard++ < 120) {
      if (!r.neverExpires && r.endsOn && next > r.endsOn) break;
      const e = expenseFromProfile(r, next, db);
      db.expenses.push(e);
      created++;
      r.lastGeneratedDate = next;
      next = nextRecurrence(next, r.repeatEvery);
    }
    r.nextDate = next;
  }
  return created;
}

/** GST on an expense (single or itemized). `entered` is the amount as typed (inclusive or exclusive of tax). */
export function expenseGst(db: Database, g: ExpenseGst, vendorId: string | undefined, entered: number, lines: Expense['lines'], itemized: boolean, isMileage: boolean) {
  const vendor = vendorId ? db.contacts.find((c) => c.id === vendorId) : undefined;
  const gstTreatment = g.gstTreatment || vendor?.gstTreatment || (vendor?.gstin ? 'registered_business' : undefined);
  const destinationOfSupply = g.destinationOfSupply || db.organization.state;
  const sourceOfSupply = g.sourceOfSupply || vendor?.placeOfSupply || stateFromGstin(vendor?.gstin) || db.organization.state;
  const reverseCharge = Boolean(g.reverseCharge);
  const inclusive = (g.taxInclusive ?? true) && !reverseCharge;
  const taxId = isMileage || itemized ? undefined : taxRate(g.taxId) ? g.taxId : undefined;
  const intra = isIntraState(sourceOfSupply, destinationOfSupply, gstTreatment);
  const t = computeTax(itemized ? lines.map((l) => ({ amount: l.amount, taxId: l.taxId })) : [{ amount: entered, taxId }], { intra, inclusive });
  if (itemized) lines.forEach((l, i) => (l.taxAmount = t.lineTax[i] || undefined));
  const gross = itemized ? round2(lines.reduce((s2, l) => s2 + l.amount, 0)) : entered;
  const subTotal = inclusive ? round2(gross - t.taxTotal) : gross;
  const amount = inclusive || reverseCharge ? gross : round2(gross + t.taxTotal);
  const vendorGstin = (g.vendorGstin || '').trim() || vendor?.gstin;
  return {
    gstTreatment,
    vendorGstin: vendorGstin?.toUpperCase(),
    sourceOfSupply,
    destinationOfSupply,
    reverseCharge,
    taxInclusive: inclusive,
    taxId,
    taxAmount: t.taxTotal,
    taxBreakdown: t.breakdown,
    subTotal,
    amount,
  };
}

/** One expense generated from a recurring expense profile (copies its GST settings). */
export function expenseFromProfile(r: RecurringExpense, date: string, db: Database = getDb()): Expense {
  const ts = now();
  const entered = r.taxInclusive === false ? r.subTotal ?? r.amount : r.amount;
  const gst = expenseGst(db, r, r.vendorId, entered, [], false, false);
  return {
    id: newId('exp'),
    date,
    accountId: r.accountId,
    itemized: false,
    lines: [],
    paidThroughAccountId: r.paidThroughAccountId,
    vendorId: r.vendorId,
    notes: r.notes,
    customerId: r.customerId,
    billable: r.billable,
    projectId: r.projectId,
    status: r.billable ? 'unbilled' : 'non_billable',
    isMileage: false,
    receipts: [],
    recurringProfileId: r.id,
    reportingTags: { ...r.reportingTags },
    expenseType: r.expenseType,
    hsnSac: r.hsnSac,
    ...gst,
    createdAt: ts,
    updatedAt: ts,
  };
}

// ------------------------------------------------------------------ activity

export function logActivity(db: Database, entityType: string, entityId: string, contactId: string | undefined, message: string, detail?: string, author?: string) {
  db.activities.push({ id: newId('act'), entityType, entityId, contactId, message, detail, author: author || db.organization.name, createdAt: now() });
}

export { addDays };
