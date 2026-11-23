// Express REST API for Creatign Books.
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { DOC_META } from '../shared/docmeta';
import { periodRange, today, type PeriodKey } from '../shared/format';
import type { Account, Attachment, DocKind, Journal, Project, TimeEntry, TxnDoc } from '../shared/types';
import { UPLOAD_DIR, getDb, newId, now, peekNumber, resetDb } from './db';
import { journalsFor, logActivity, recompute, runRecurring } from './engine';
import * as R from './reports';
import * as S from './services';
import { deliver, mailSettings } from './mailer';
import { renderDocPdf, renderPaymentPdf, renderStatementPdf } from './pdf';

type Handler = (req: Request, res: Response) => unknown;
const h = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (e) {
    next(e);
  }
};
/** Wrap a mutation: run it, then recompute + persist. */
const m = (fn: Handler) =>
  h((req, res) => {
    const out = fn(req, res);
    S.commit();
    return out;
  });

const q = (req: Request, k: string) => (typeof req.query[k] === 'string' ? (req.query[k] as string) : undefined);
const p = (req: Request, k: string) => String(req.params[k]);

function matches(text: string | undefined, needle?: string) {
  return !needle || (text || '').toLowerCase().includes(needle.toLowerCase());
}

let lastRecomputeDay = '';
function freshness(_req: Request, _res: Response, next: NextFunction) {
  // statuses like "overdue" depend on today's date, and recurring profiles fire daily
  const t = today();
  if (t !== lastRecomputeDay) {
    lastRecomputeDay = t;
    runRecurring(getDb());
    S.commit();
  }
  next();
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  app.use('/uploads', express.static(UPLOAD_DIR));

  const api = express.Router();
  api.use(freshness);

  // ------------------------------------------------------------ org & setup
  api.get('/bootstrap', h(() => {
    const db = getDb();
    return { organization: db.organization, accounts: db.accounts, preferences: db.preferences, salespersons: db.preferences.salespersons };
  }));
  api.put('/organization', m((req) => Object.assign(getDb().organization, req.body, { id: getDb().organization.id })));
  api.put('/preferences', m((req) => Object.assign(getDb().preferences, req.body)));
  api.post('/admin/reset', h((req) => {
    resetDb(req.body?.samples !== false);
    S.commit();
    return { ok: true };
  }));

  // ------------------------------------------------------------ accounts
  api.get('/accounts', h(() => getDb().accounts.map((a) => ({ ...a, balance: R.accountBalance(getDb(), a.id) }))));
  api.post('/accounts', m((req) => {
    const db = getDb();
    const b = req.body as Partial<Account>;
    if (!b.name || !b.type || !b.subType) throw new S.HttpError(400, 'Account name and type are required');
    if (db.accounts.some((a) => a.name.toLowerCase() === b.name!.toLowerCase())) throw new S.HttpError(400, 'An account with this name already exists');
    const a: Account = { id: newId('acc'), code: b.code || '', name: b.name, type: b.type, subType: b.subType, description: b.description, active: true };
    db.accounts.push(a);
    return a;
  }));
  api.put('/accounts/:id', m((req) => {
    const a = getDb().accounts.find((x) => x.id === p(req, 'id'));
    if (!a) throw new S.HttpError(404, 'Account not found');
    const { name, code, description, active } = req.body as Partial<Account>;
    Object.assign(a, { name: name ?? a.name, code: code ?? a.code, description, active: active ?? a.active });
    return a;
  }));
  api.delete('/accounts/:id', m((req) => {
    const db = getDb();
    const a = db.accounts.find((x) => x.id === p(req, 'id'));
    if (!a) throw new S.HttpError(404, 'Account not found');
    if (a.system) throw new S.HttpError(400, 'System accounts cannot be deleted');
    if (db.journals.some((j) => j.lines.some((l) => l.accountId === a.id))) throw new S.HttpError(400, 'This account has transactions and cannot be deleted');
    db.accounts = db.accounts.filter((x) => x.id !== a.id);
  }));

  // ------------------------------------------------------------ items
  api.get('/items', h((req) => {
    const status = q(req, 'status');
    return getDb().items.filter((i) => (!status || status === 'all' || i.status === status) && (matches(i.name, q(req, 'q')) || matches(i.sku, q(req, 'q'))));
  }));
  api.get('/items/:id', h((req) => {
    const db = getDb();
    const item = db.items.find((i) => i.id === p(req, 'id'));
    if (!item) throw new S.HttpError(404, 'Item not found');
    const usage = db.docs.filter((d) => d.lineItems.some((l) => l.itemId === item.id)).map((d) => ({ id: d.id, kind: d.kind, number: d.number, date: d.date, status: d.status, contact: S.contactName(db, d.contactId), total: d.total }));
    return { ...item, usage };
  }));
  api.post('/items', m((req) => S.upsertItem(req.body)));
  api.put('/items/:id', m((req) => S.upsertItem(req.body, p(req, 'id'))));
  api.delete('/items/:id', m((req) => S.deleteItem(p(req, 'id'))));

  // ------------------------------------------------------------ contacts
  api.get('/contacts', h((req) => {
    const kind = q(req, 'kind');
    const status = q(req, 'status') || 'active';
    const needle = q(req, 'q');
    return getDb()
      .contacts.filter((c) => (!kind || c.kind === kind) && (status === 'all' || c.status === status) && (matches(c.displayName, needle) || matches(c.companyName, needle) || matches(c.email, needle)))
      .map((c) => ({ ...c, ...S.contactSummary(c) }));
  }));
  api.get('/contacts/:id', h((req) => {
    const c = S.getContact(p(req, 'id'));
    return { ...c, ...S.contactSummary(c) };
  }));
  api.post('/contacts', m((req) => S.upsertContact(req.body)));
  api.put('/contacts/:id', m((req) => S.upsertContact(req.body, p(req, 'id'))));
  api.delete('/contacts/:id', m((req) => S.deleteContact(p(req, 'id'))));
  api.post('/contacts/:id/status', m((req) => {
    const c = S.getContact(p(req, 'id'));
    c.status = req.body.status === 'inactive' ? 'inactive' : 'active';
    return c;
  }));
  api.post('/contacts/:id/clone', m((req) => {
    const c = S.getContact(p(req, 'id'));
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = c;
    return S.upsertContact({ ...structuredClone(rest), displayName: `${c.displayName} (Copy)`, openingBalance: 0 });
  }));
  api.post('/contacts/:id/merge', m((req) => {
    const db = getDb();
    const target = S.getContact(p(req, 'id'));
    const src = S.getContact(String(req.body.sourceId));
    if (src.kind !== target.kind || src.id === target.id) throw new S.HttpError(400, 'Pick another contact of the same type to merge');
    for (const d of db.docs) if (d.contactId === src.id) d.contactId = target.id;
    for (const x of db.paymentsReceived) if (x.contactId === src.id) x.contactId = target.id;
    for (const x of db.paymentsMade) if (x.contactId === src.id) x.contactId = target.id;
    for (const e of db.expenses) {
      if (e.vendorId === src.id) e.vendorId = target.id;
      if (e.customerId === src.id) e.customerId = target.id;
    }
    target.openingBalance += src.openingBalance;
    db.contacts = db.contacts.filter((c) => c.id !== src.id);
    logActivity(db, 'contact', target.id, target.id, `${src.displayName} merged into ${target.displayName}`);
    return target;
  }));
  api.get('/contacts/:id/transactions', h((req) => R.contactTransactions(S.getContact(p(req, 'id')))));
  api.get('/contacts/:id/income', h((req) => R.contactIncome(S.getContact(p(req, 'id')), (q(req, 'period') as PeriodKey) || 'last_6_months', (q(req, 'basis') as 'cash') || 'accrual')));
  api.get('/contacts/:id/statement', h((req) => {
    const c = S.getContact(p(req, 'id'));
    const r = periodRange((q(req, 'period') as PeriodKey) || 'this_month', today(), getDb().organization.fiscalYearStartMonth);
    return R.statement(c, q(req, 'from') || r.from, q(req, 'to') || r.to, (q(req, 'filter') as 'outstanding') || 'all');
  }));

  // ------------------------------------------------------------ documents
  api.get('/docs', h((req) => {
    const db = getDb();
    const kind = q(req, 'kind');
    const status = q(req, 'status');
    const contactId = q(req, 'contactId');
    const needle = q(req, 'q');
    return db.docs
      .filter((d) => (!kind || d.kind === kind) && (!contactId || d.contactId === contactId))
      .filter((d) => !status || status === 'all' || d.status === status || (status === 'unpaid' && ['open', 'sent', 'overdue', 'due_today', 'partially_paid'].includes(d.status)))
      .map((d) => ({ ...d, contactName: S.contactName(db, d.contactId) }))
      .filter((d) => !needle || [d.number, d.referenceNumber, d.orderNumber, d.contactName, d.profileName].some((t) => matches(t, needle)))
      .sort((a, b) => (b.date === a.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)));
  }));
  api.get('/docs/next-number', h((req) => ({ number: S.nextNumber(q(req, 'kind') as DocKind) })));
  api.get('/docs/:id', h((req) => {
    const db = getDb();
    const d = S.getDoc(p(req, 'id'));
    const contact = db.contacts.find((c) => c.id === d.contactId);
    const related = {
      quote: d.quoteId ? db.docs.find((x) => x.id === d.quoteId) : undefined,
      salesOrder: d.salesOrderId ? db.docs.find((x) => x.id === d.salesOrderId) : undefined,
      deliveryChallan: d.deliveryChallanId ? db.docs.find((x) => x.id === d.deliveryChallanId) : undefined,
      purchaseOrder: d.purchaseOrderId ? db.docs.find((x) => x.id === d.purchaseOrderId) : undefined,
      invoice: d.invoiceId ? db.docs.find((x) => x.id === d.invoiceId) : undefined,
      profile: d.recurringProfileId ? db.docs.find((x) => x.id === d.recurringProfileId) : undefined,
      children: db.docs.filter((x) => x.quoteId === d.id || x.salesOrderId === d.id || x.deliveryChallanId === d.id || x.purchaseOrderId === d.id || x.recurringProfileId === d.id || (x.invoiceId === d.id && x.kind === 'credit_note')),
      payments:
        d.kind === 'invoice'
          ? db.paymentsReceived.filter((x) => x.allocations.some((a) => a.docId === d.id)).map((x) => ({ id: x.id, number: x.number, date: x.date, mode: x.mode, status: x.status, amount: x.allocations.find((a) => a.docId === d.id)!.amount }))
          : d.kind === 'bill'
            ? db.paymentsMade.filter((x) => x.allocations.some((a) => a.docId === d.id)).map((x) => ({ id: x.id, number: x.number, date: x.date, mode: x.mode, status: x.status, amount: x.allocations.find((a) => a.docId === d.id)!.amount }))
            : [],
      creditsApplied: db.docs.filter((c) => c.creditApplications.some((a) => a.invoiceId === d.id)).flatMap((c) => c.creditApplications.filter((a) => a.invoiceId === d.id).map((a) => ({ ...a, creditId: c.id, creditNumber: c.number }))),
      appliedTo: d.creditApplications.map((a) => ({ ...a, number: db.docs.find((x) => x.id === a.invoiceId)?.number })),
    };
    return { ...d, contactName: contact?.displayName, contact, related, journals: journalsFor(d.id) };
  }));
  api.get('/docs/:id/convert', h((req) => S.convertTemplate(p(req, 'id'), q(req, 'to') as DocKind)));
  api.post('/docs', m((req) => {
    const { kind, mode, ...body } = req.body as TxnDoc & { mode: S.SaveMode };
    if (!DOC_META[kind]) throw new S.HttpError(400, 'Unknown document kind');
    return S.saveDoc(kind, body, mode);
  }));
  api.put('/docs/:id', m((req) => {
    const d = S.getDoc(p(req, 'id'));
    const { mode, ...body } = req.body as TxnDoc & { mode: S.SaveMode };
    return S.saveDoc(d.kind, body, mode, d.id);
  }));
  api.delete('/docs/:id', m((req) => S.deleteDoc(p(req, 'id'))));
  api.post('/docs/:id/actions/:action', m((req) => S.docAction(p(req, 'id'), p(req, 'action'), req.body)));
  api.post('/docs/:id/apply-credits', m((req) => S.applyCredits(p(req, 'id'), req.body.applications || [])));
  api.delete('/docs/:id/credit-applications/:appId', m((req) => S.removeCreditApplication(p(req, 'id'), p(req, 'appId'))));
  api.post('/docs/:id/refunds', m((req) => S.refundCredit(p(req, 'id'), req.body)));
  api.post('/recurring/run', m(() => ({ created: S.generateRecurringNow() })));

  // ------------------------------------------------------------ payments received
  api.get('/payments-received', h((req) => {
    const db = getDb();
    const needle = q(req, 'q');
    const contactId = q(req, 'contactId');
    return db.paymentsReceived
      .filter((x) => !contactId || x.contactId === contactId)
      .map((x) => ({ ...x, contactName: S.contactName(db, x.contactId), invoiceNumbers: x.allocations.map((a) => db.docs.find((d) => d.id === a.docId)?.number).filter(Boolean) }))
      .filter((x) => !needle || [x.number, x.contactName, x.referenceNumber].some((t) => matches(t, needle)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }));
  api.get('/payments-received/next-number', h(() => ({ number: peekNumber('payment_received', '', 1) })));
  api.get('/payments-received/:id', h((req) => {
    const db = getDb();
    const x = db.paymentsReceived.find((y) => y.id === p(req, 'id'));
    if (!x) throw new S.HttpError(404, 'Payment not found');
    return { ...x, contactName: S.contactName(db, x.contactId), contact: db.contacts.find((c) => c.id === x.contactId), invoices: x.allocations.map((a) => ({ ...a, doc: db.docs.find((d) => d.id === a.docId) })), journals: journalsFor(x.id) };
  }));
  api.post('/payments-received', m((req) => S.savePaymentReceived(req.body)));
  api.put('/payments-received/:id', m((req) => S.savePaymentReceived(req.body, p(req, 'id'))));
  api.delete('/payments-received/:id', m((req) => {
    const db = getDb();
    const x = db.paymentsReceived.find((y) => y.id === p(req, 'id'));
    if (x?.locked) throw new S.HttpError(400, 'This payment is locked');
    db.paymentsReceived = db.paymentsReceived.filter((y) => y.id !== p(req, 'id'));
  }));
  api.post('/payments-received/:id/actions/:action', m((req) => S.paymentReceivedAction(p(req, 'id'), p(req, 'action'), req.body)));

  // ------------------------------------------------------------ payments made
  api.get('/payments-made', h((req) => {
    const db = getDb();
    const needle = q(req, 'q');
    const contactId = q(req, 'contactId');
    return db.paymentsMade
      .filter((x) => !contactId || x.contactId === contactId)
      .map((x) => ({ ...x, contactName: S.contactName(db, x.contactId), billNumbers: x.allocations.map((a) => db.docs.find((d) => d.id === a.docId)?.number).filter(Boolean) }))
      .filter((x) => !needle || [x.number, x.contactName, x.referenceNumber].some((t) => matches(t, needle)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }));
  api.get('/payments-made/next-number', h(() => ({ number: peekNumber('payment_made', '', 1) })));
  api.get('/payments-made/:id', h((req) => {
    const db = getDb();
    const x = db.paymentsMade.find((y) => y.id === p(req, 'id'));
    if (!x) throw new S.HttpError(404, 'Payment not found');
    return { ...x, contactName: S.contactName(db, x.contactId), contact: db.contacts.find((c) => c.id === x.contactId), bills: x.allocations.map((a) => ({ ...a, doc: db.docs.find((d) => d.id === a.docId) })), journals: journalsFor(x.id) };
  }));
  api.post('/payments-made', m((req) => S.savePaymentMade(req.body)));
  api.put('/payments-made/:id', m((req) => S.savePaymentMade(req.body, p(req, 'id'))));
  api.delete('/payments-made/:id', m((req) => {
    getDb().paymentsMade = getDb().paymentsMade.filter((y) => y.id !== p(req, 'id'));
  }));
  api.post('/payments-made/:id/actions/void', m((req) => {
    const x = getDb().paymentsMade.find((y) => y.id === p(req, 'id'));
    if (!x) throw new S.HttpError(404, 'Payment not found');
    x.status = 'void';
    x.allocations = [];
    return x;
  }));

  // ------------------------------------------------------------ expenses
  api.get('/expenses', h((req) => {
    const db = getDb();
    const view = q(req, 'view') || 'all';
    const needle = q(req, 'q');
    const accs = new Map(db.accounts.map((a) => [a.id, a.name]));
    return db.expenses
      .filter((e) => {
        switch (view) {
          case 'unbilled':
            return e.status === 'unbilled';
          case 'invoiced':
            return e.status === 'invoiced';
          case 'reimbursed':
            return e.status === 'reimbursed';
          case 'billable':
            return e.billable;
          case 'non_billable':
            return !e.billable;
          case 'with_receipts':
            return e.receipts.length > 0;
          case 'without_receipts':
            return e.receipts.length === 0;
          default:
            return true;
        }
      })
      .map((e) => ({ ...e, accountName: e.itemized ? 'Itemized' : accs.get(e.accountId), paidThroughName: accs.get(e.paidThroughAccountId), vendorName: S.contactName(db, e.vendorId), customerName: S.contactName(db, e.customerId) }))
      .filter((e) => !needle || [e.accountName, e.vendorName, e.customerName, e.notes, e.invoiceNumber].some((t) => matches(t, needle)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }));
  api.get('/expenses/:id', h((req) => {
    const db = getDb();
    const e = db.expenses.find((x) => x.id === p(req, 'id'));
    if (!e) throw new S.HttpError(404, 'Expense not found');
    return { ...e, vendorName: S.contactName(db, e.vendorId), customerName: S.contactName(db, e.customerId), journals: journalsFor(e.id) };
  }));
  api.post('/expenses', m((req) => S.saveExpense(req.body)));
  api.post('/expenses/bulk', m((req) => (req.body.expenses as unknown[]).map((e) => S.saveExpense(e as never))));
  api.put('/expenses/:id', m((req) => S.saveExpense(req.body, p(req, 'id'))));
  api.delete('/expenses/:id', m((req) => {
    getDb().expenses = getDb().expenses.filter((x) => x.id !== p(req, 'id'));
  }));
  api.post('/expenses/:id/convert-to-invoice', m((req) => S.convertExpenseToInvoice(p(req, 'id'))));
  api.post('/expenses/:id/reimburse', m((req) => {
    const e = getDb().expenses.find((x) => x.id === p(req, 'id'));
    if (!e) throw new S.HttpError(404, 'Expense not found');
    e.status = 'reimbursed';
    return e;
  }));

  api.get('/recurring-expenses', h(() => {
    const db = getDb();
    const accs = new Map(db.accounts.map((a) => [a.id, a.name]));
    return db.recurringExpenses.map((r) => ({ ...r, accountName: accs.get(r.accountId), vendorName: S.contactName(db, r.vendorId), customerName: S.contactName(db, r.customerId), children: db.expenses.filter((e) => e.recurringProfileId === r.id).length }));
  }));
  api.get('/recurring-expenses/:id', h((req) => {
    const db = getDb();
    const r = db.recurringExpenses.find((x) => x.id === p(req, 'id'));
    if (!r) throw new S.HttpError(404, 'Recurring expense not found');
    return { ...r, vendorName: S.contactName(db, r.vendorId), customerName: S.contactName(db, r.customerId), children: db.expenses.filter((e) => e.recurringProfileId === r.id) };
  }));
  api.post('/recurring-expenses', m((req) => S.saveRecurringExpense(req.body)));
  api.put('/recurring-expenses/:id', m((req) => S.saveRecurringExpense(req.body, p(req, 'id'))));
  api.delete('/recurring-expenses/:id', m((req) => {
    getDb().recurringExpenses = getDb().recurringExpenses.filter((x) => x.id !== p(req, 'id'));
  }));
  api.post('/recurring-expenses/:id/actions/:action', m((req) => S.recurringExpenseAction(p(req, 'id'), p(req, 'action'))));

  // ------------------------------------------------------------ journals
  api.get('/journals', h((req) => {
    const db = getDb();
    const kind = q(req, 'kind');
    return db.journals.filter((j) => !kind || (kind === 'manual' ? j.sourceType === 'manual' : true)).slice().reverse();
  }));
  api.get('/journals/:id', h((req) => {
    const j = getDb().journals.find((x) => x.id === p(req, 'id'));
    if (!j) throw new S.HttpError(404, 'Journal not found');
    return j;
  }));
  api.post('/journals', m((req) => {
    const db = getDb();
    const b = req.body as Partial<Journal>;
    const lines = (b.lines || []).filter((l) => l.accountId && (Number(l.debit) || Number(l.credit))).map((l) => ({ ...l, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 }));
    const dr = lines.reduce((s, l) => s + l.debit, 0);
    const cr = lines.reduce((s, l) => s + l.credit, 0);
    if (lines.length < 2) throw new S.HttpError(400, 'A journal needs at least two lines');
    if (Math.abs(dr - cr) > 0.004) throw new S.HttpError(400, `Debits (${dr.toFixed(2)}) and credits (${cr.toFixed(2)}) must be equal`);
    const n = (db.counters.manual_journal || 0) + 1;
    db.counters.manual_journal = n;
    const j: Journal = { id: newId('mj'), number: `MJ-${String(n).padStart(5, '0')}`, date: b.date || today(), sourceType: 'manual', reference: b.reference, notes: b.notes, lines, createdAt: now() };
    db.journals.push(j);
    return j;
  }));
  api.delete('/journals/:id', m((req) => {
    const db = getDb();
    const j = db.journals.find((x) => x.id === p(req, 'id'));
    if (!j || j.sourceType !== 'manual') throw new S.HttpError(400, 'Only manual journals can be deleted');
    db.journals = db.journals.filter((x) => x.id !== j.id);
  }));

  // ------------------------------------------------------------ comments, activity, mail
  api.get('/comments', h((req) => getDb().comments.filter((c) => c.entityId === q(req, 'entityId')).slice().reverse()));
  api.post('/comments', m((req) => {
    const { entityType, entityId, html } = req.body;
    if (!entityId || !String(html || '').replace(/<[^>]*>/g, '').trim()) throw new S.HttpError(400, 'Comment cannot be empty');
    const c = { id: newId('cmt'), entityType, entityId, html: sanitize(String(html)), author: getDb().organization.name, createdAt: now() };
    getDb().comments.push(c);
    return c;
  }));
  api.delete('/comments/:id', m((req) => {
    getDb().comments = getDb().comments.filter((c) => c.id !== p(req, 'id'));
  }));
  api.get('/activities', h((req) => {
    const entityId = q(req, 'entityId');
    const contactId = q(req, 'contactId');
    return getDb()
      .activities.filter((a) => (entityId && a.entityId === entityId) || (contactId && a.contactId === contactId))
      .slice()
      .reverse()
      .slice(0, 200);
  }));
  api.get('/mails', h((req) => {
    const contactId = q(req, 'contactId');
    const entityId = q(req, 'entityId');
    return getDb().mails.filter((x) => (!contactId || x.contactId === contactId) && (!entityId || x.entityId === entityId)).slice().reverse();
  }));
  api.get('/mail-settings', h(() => mailSettings()));
  api.post('/mails', h(async (req) => {
    const db = getDb();
    const b = req.body;
    const split = (v: unknown) => (Array.isArray(v) ? v : String(v || '').split(/[,;\s]+/)).map((x) => String(x).trim()).filter(Boolean);
    const to = split(b.to);
    const cc = split(b.cc);
    if (!to.length) throw new S.HttpError(400, 'Add at least one recipient');
    const bad = [...to, ...cc].find((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
    if (bad) throw new S.HttpError(400, `"${bad}" is not a valid email address`);
    if (!b.subject) throw new S.HttpError(400, 'Subject is required');

    // Build PDF attachments for whatever the email is about
    const files: { filename: string; content: Buffer }[] = [];
    if (b.attachPdf) {
      const d = b.entityId ? db.docs.find((x) => x.id === b.entityId) : undefined;
      const pr = b.entityType === 'payment_received' ? db.paymentsReceived.find((x) => x.id === b.entityId) : undefined;
      const pm = b.entityType === 'payment_made' ? db.paymentsMade.find((x) => x.id === b.entityId) : undefined;
      if (d) files.push({ filename: `${DOC_META[d.kind].label.replace(/ /g, '-')}-${d.number}.pdf`, content: await renderDocPdf(d) });
      else if (pr) files.push({ filename: `Payment-Receipt-${pr.number}.pdf`, content: await renderPaymentPdf(pr) });
      else if (pm) files.push({ filename: `Payment-${pm.number}.pdf`, content: await renderPaymentPdf(pm, true) });
      else if (b.statement && b.contactId) {
        const c = db.contacts.find((x) => x.id === b.contactId);
        if (c) files.push({ filename: `Statement-${c.displayName.replace(/[^\w]+/g, '-')}.pdf`, content: await renderStatementPdf(R.statement(c, b.statement.from, b.statement.to, b.statement.filter || 'all')) });
      }
    }

    const settings = mailSettings();
    if (settings.configured) await deliver({ fromName: db.organization.name, replyTo: db.organization.email, to, cc, subject: b.subject, text: b.body || '', attachments: files });

    const mail = { id: newId('mail'), contactId: b.contactId, entityType: b.entityType, entityId: b.entityId, from: settings.from || db.organization.email, to, cc, subject: b.subject, body: b.body || '', attachments: files.length ? files.map((f) => f.filename) : b.attachments || [], delivered: settings.configured, createdAt: now() };
    db.mails.push(mail);
    // emailing a document marks it as sent
    const d = b.entityId ? db.docs.find((x) => x.id === b.entityId) : undefined;
    if (d) {
      d.sentAt = d.sentAt || now();
      if (d.kind === 'quote' && d.status === 'draft') d.status = 'sent';
      if (d.kind === 'sales_order' && d.status === 'draft') d.status = 'confirmed';
      if (d.kind === 'invoice' && d.status === 'draft') d.status = 'open';
      if (d.kind === 'purchase_order' && d.status === 'draft') d.status = 'issued';
      if ((d.kind === 'credit_note' || d.kind === 'vendor_credit') && d.status === 'draft') d.status = 'open';
      d.emailRecipients = Array.from(new Set([...(d.emailRecipients || []), ...to]));
      logActivity(db, d.kind, d.id, d.contactId, `${DOC_META[d.kind].label} emailed`, `${DOC_META[d.kind].label} ${d.number} emailed to ${to.join(', ')}`);
    } else if (b.contactId) logActivity(db, 'contact', b.contactId, b.contactId, 'Email sent', b.subject);
    S.commit();
    return mail;
  }));

  // ------------------------------------------------------------ share links (public portal)
  api.get('/share-links', h((req) => getDb().shareLinks.filter((s) => s.entityId === q(req, 'entityId'))));
  api.post('/share-links', m((req) => {
    const db = getDb();
    const link = { id: newId('shr'), token: newId('t').slice(2) + newId('t').slice(2), entityType: req.body.entityType, entityId: req.body.entityId, expiresOn: req.body.expiresOn, active: true, createdAt: now() };
    db.shareLinks.push(link);
    return link;
  }));
  api.post('/share-links/disable-all', m((req) => {
    for (const s of getDb().shareLinks) if (s.entityId === req.body.entityId) s.active = false;
  }));
  api.get('/public/share/:token', h((req) => {
    const db = getDb();
    const link = db.shareLinks.find((s) => s.token === p(req, 'token'));
    if (!link || !link.active || (link.expiresOn && link.expiresOn < today())) throw new S.HttpError(404, 'This link has expired or was disabled');
    const d = db.docs.find((x) => x.id === link.entityId);
    if (!d) throw new S.HttpError(404, 'Document not found');
    return { doc: { ...d, contactName: S.contactName(db, d.contactId), contact: db.contacts.find((c) => c.id === d.contactId) }, organization: db.organization };
  }));

  // ------------------------------------------------------------ uploads
  const upload = multer({
    storage: multer.diskStorage({
      destination: UPLOAD_DIR,
      filename: (_req, file, cb) => cb(null, `${newId('f')}${path.extname(file.originalname).slice(0, 10)}`),
    }),
    limits: { fileSize: 10 * 1024 * 1024, files: 10 },
  });
  api.post('/uploads', upload.array('files', 10), h((req) => {
    const files = (req.files as Express.Multer.File[]) || [];
    return files.map<Attachment>((f) => ({ id: path.parse(f.filename).name, name: f.originalname, size: f.size, mimeType: f.mimetype, url: `/uploads/${f.filename}`, uploadedAt: now() }));
  }));
  api.get('/documents', h(() => {
    const db = getDb();
    const out: (Attachment & { source: string; sourceId: string; sourceLabel: string })[] = [];
    for (const d of db.docs) for (const a of d.attachments) out.push({ ...a, source: d.kind, sourceId: d.id, sourceLabel: `${DOC_META[d.kind].label} ${d.number}` });
    for (const c of db.contacts) for (const a of c.documents) out.push({ ...a, source: c.kind, sourceId: c.id, sourceLabel: c.displayName });
    for (const e of db.expenses) for (const a of e.receipts) out.push({ ...a, source: 'expense', sourceId: e.id, sourceLabel: `Expense ${e.date}` });
    for (const x of db.paymentsReceived) for (const a of x.attachments) out.push({ ...a, source: 'payment_received', sourceId: x.id, sourceLabel: `Payment #${x.number}` });
    for (const x of db.paymentsMade) for (const a of x.attachments) out.push({ ...a, source: 'payment_made', sourceId: x.id, sourceLabel: `Payment #${x.number}` });
    return out.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }));

  // ------------------------------------------------------------ projects & time
  api.get('/projects', h(() => {
    const db = getDb();
    return db.projects.map((x) => ({ ...x, customerName: S.contactName(db, x.customerId), hours: db.timeEntries.filter((t) => t.projectId === x.id).reduce((s, t) => s + t.hours, 0) }));
  }));
  api.post('/projects', m((req) => {
    const b = req.body as Partial<Project>;
    if (!b.name) throw new S.HttpError(400, 'Project Name is required');
    const x: Project = { id: newId('prj'), name: b.name, customerId: b.customerId, billingMethod: b.billingMethod || 'hourly', rate: Number(b.rate) || 0, budgetHours: Number(b.budgetHours) || undefined, description: b.description, status: 'active', createdAt: now() };
    getDb().projects.push(x);
    return x;
  }));
  api.put('/projects/:id', m((req) => {
    const x = getDb().projects.find((y) => y.id === p(req, 'id'));
    if (!x) throw new S.HttpError(404, 'Project not found');
    return Object.assign(x, req.body, { id: x.id });
  }));
  api.delete('/projects/:id', m((req) => {
    const db = getDb();
    db.projects = db.projects.filter((x) => x.id !== p(req, 'id'));
    db.timeEntries = db.timeEntries.filter((t) => t.projectId !== p(req, 'id'));
  }));
  api.get('/time-entries', h((req) => {
    const db = getDb();
    return db.timeEntries.filter((t) => !q(req, 'projectId') || t.projectId === q(req, 'projectId')).map((t) => ({ ...t, projectName: db.projects.find((x) => x.id === t.projectId)?.name })).sort((a, b) => b.date.localeCompare(a.date));
  }));
  api.post('/time-entries', m((req) => {
    const b = req.body as Partial<TimeEntry>;
    if (!b.projectId || !(Number(b.hours) > 0)) throw new S.HttpError(400, 'Project and hours are required');
    const t: TimeEntry = { id: newId('te'), projectId: b.projectId, date: b.date || today(), task: b.task, hours: Number(b.hours), notes: b.notes, billable: b.billable !== false, invoiced: false, createdAt: now() };
    getDb().timeEntries.push(t);
    return t;
  }));
  api.delete('/time-entries/:id', m((req) => {
    getDb().timeEntries = getDb().timeEntries.filter((t) => t.id !== p(req, 'id'));
  }));
  api.post('/projects/:id/invoice', m((req) => {
    const db = getDb();
    const prj = db.projects.find((y) => y.id === p(req, 'id'));
    if (!prj?.customerId) throw new S.HttpError(400, 'Associate a customer with this project first');
    const entries = db.timeEntries.filter((t) => t.projectId === prj.id && t.billable && !t.invoiced);
    if (!entries.length) throw new S.HttpError(400, 'There are no unbilled hours for this project');
    const hours = entries.reduce((s, t) => s + t.hours, 0);
    const inv = S.saveDoc('invoice', { contactId: prj.customerId, projectName: prj.name, lineItems: [{ id: newId('li'), name: `${prj.name} - billable hours`, quantity: hours, unit: 'hrs', rate: prj.rate, amount: 0 }] } as Partial<TxnDoc>, 'draft');
    entries.forEach((t) => (t.invoiced = true));
    return inv;
  }));

  // ------------------------------------------------------------ dashboard, search & reports
  api.get('/dashboard', h((req) => R.dashboard({ cashPeriod: q(req, 'cashPeriod') as PeriodKey, incomePeriod: q(req, 'incomePeriod') as PeriodKey, expensePeriod: q(req, 'expensePeriod') as PeriodKey, basis: q(req, 'basis') as 'cash' })));
  api.get('/recent-activity', h(() => getDb().activities.slice(-30).reverse()));
  api.get('/search', h((req) => {
    const db = getDb();
    const needle = q(req, 'q');
    if (!needle) return [];
    const docs = db.docs
      .filter((d) => [d.number, d.referenceNumber, S.contactName(db, d.contactId), d.profileName].some((t) => matches(t, needle)))
      .slice(0, 15)
      .map((d) => ({ type: DOC_META[d.kind].label, title: `${d.number}`, subtitle: S.contactName(db, d.contactId), path: `${DOC_META[d.kind].path}/${d.id}` }));
    const contacts = db.contacts.filter((c) => matches(c.displayName, needle) || matches(c.email, needle)).slice(0, 8).map((c) => ({ type: c.kind === 'customer' ? 'Customer' : 'Vendor', title: c.displayName, subtitle: c.email, path: `/${c.kind === 'customer' ? 'sales/customers' : 'purchases/vendors'}/${c.id}` }));
    const items = db.items.filter((i) => matches(i.name, needle)).slice(0, 8).map((i) => ({ type: 'Item', title: i.name, subtitle: i.type, path: `/items/${i.id}` }));
    return [...contacts, ...items, ...docs];
  }));
  api.get('/reports/:name', h((req) => {
    const fy = getDb().organization.fiscalYearStartMonth;
    const r = periodRange((q(req, 'period') as PeriodKey) || 'this_fiscal_year', today(), fy);
    const from = q(req, 'from') || r.from;
    const to = q(req, 'to') || r.to;
    switch (p(req, 'name')) {
      case 'profit-and-loss':
        return R.profitAndLoss(from, to);
      case 'balance-sheet':
        return R.balanceSheet(to);
      case 'trial-balance':
        return R.trialBalance(to);
      case 'general-ledger':
        return R.generalLedger(from, to, q(req, 'accountId'));
      case 'journal':
        return R.journalReport(from, to);
      case 'ar-aging':
        return R.agingReport('receivables');
      case 'ap-aging':
        return R.agingReport('payables');
      case 'sales-by-customer':
        return R.salesByCustomer(from, to);
      case 'sales-by-item':
        return R.salesByItem(from, to);
      case 'expenses-by-category':
        return R.expensesByCategory(from, to);
      case 'customer-balances':
        return R.contactBalances('customer');
      case 'vendor-balances':
        return R.contactBalances('vendor');
      default:
        throw new S.HttpError(404, 'Unknown report');
    }
  }));

  app.use('/api', api);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((err: Error & { status?: number; code?: string }, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof S.HttpError ? err.status : err.code === 'LIMIT_FILE_SIZE' ? 400 : err.status || 500;
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Each file must be 10MB or smaller' : err.message;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: message });
  });
  return app;
}

/** Allow only the formatting tags the comment editor produces. */
function sanitize(html: string) {
  return html
    .replace(/<(script|style|iframe|object)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(?!\/?(b|i|u|strong|em|br|p|div|ul|ol|li)\b)[^>]*>/gi, '')
    .replace(/\s(on\w+|style|href|src)=("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

export function boot() {
  getDb();
  runRecurring(getDb());
  recompute(getDb());
  S.commit();
}
