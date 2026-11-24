// End-to-end API tests for the two core workflows:
//  Item -> Quote -> Sales Order -> Invoice -> Journal & Payment Received
//  Vendor -> Bill -> Payment Made
// Runs against an in-memory database (DB_FILE=:memory:).
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

process.env.DB_FILE = ':memory:';
process.env.UPLOAD_DIR = '/tmp/creatign-books-test-uploads';

let app: Express;
const api = () => request(app);

beforeAll(async () => {
  const mod = await import('../server/app');
  const { resetDb } = await import('../server/db');
  resetDb(true);
  mod.boot();
  app = mod.createApp();
});

async function trialBalance() {
  const r = await api().get('/api/reports/trial-balance').query({ to: '2999-12-31' });
  return r.body as { totalDebit: number; totalCredit: number; rows: { accountId: string; debit: number; credit: number }[] };
}

describe('sales flow', () => {
  let itemId = '';
  let quoteId = '';
  let soId = '';
  let invoiceId = '';

  it('creates an item', async () => {
    const r = await api().post('/api/items').send({ name: 'Brand Strategy Workshop', type: 'service', unit: 'days', sellingPrice: 50000, costPrice: 10000 });
    expect(r.status).toBe(200);
    expect(r.body.salesAccountId).toBe('acc_sales');
    itemId = r.body.id;
  });

  it('rejects an item without a selling price', async () => {
    const r = await api().post('/api/items').send({ name: 'Broken', type: 'goods' });
    expect(r.status).toBe(400);
  });

  it('creates a quote with discount and TDS', async () => {
    const r = await api()
      .post('/api/docs')
      .send({ kind: 'quote', mode: 'send', contactId: 'cus_test', date: '2026-11-01', expiryDate: '2099-12-31', lineItems: [{ itemId, name: 'Brand Strategy Workshop', quantity: 2, rate: 50000 }], discountPercent: 10, tdsRate: 2, adjustment: 0 });
    expect(r.status).toBe(200);
    expect(r.body.number).toBe('QT-00001');
    expect(r.body.subTotal).toBe(100000);
    expect(r.body.discountAmount).toBe(10000);
    expect(r.body.tdsAmount).toBe(1800);
    expect(r.body.total).toBe(88200);
    expect(r.body.status).toBe('sent');
    quoteId = r.body.id;
  });

  it('converts the quote to a sales order, which waits for approval', async () => {
    const t = await api().get(`/api/docs/${quoteId}/convert`).query({ to: 'sales_order' });
    expect(t.body.quoteId).toBe(quoteId);
    const r = await api().post('/api/docs').send({ ...t.body, kind: 'sales_order', mode: 'open' });
    expect(r.status).toBe(200);
    // approvals are on for sales orders by default
    expect(r.body.status).toBe('pending_approval');
    soId = r.body.id;
    const blocked = await api().get(`/api/docs/${soId}/convert`).query({ to: 'invoice' });
    expect(blocked.status).toBe(400);
    const approved = await api().post(`/api/docs/${soId}/actions/approve`).send({});
    expect(approved.body.status).toBe('approved');
    const confirmed = await api().post(`/api/docs/${soId}/actions/confirm`).send({});
    expect(confirmed.body.status).toBe('confirmed');
  });

  it('converts the sales order to an invoice, closing the loop on the quote', async () => {
    const t = await api().get(`/api/docs/${soId}/convert`).query({ to: 'invoice' });
    const r = await api().post('/api/docs').send({ ...t.body, kind: 'invoice', mode: 'open', date: '2026-11-01', paymentTerms: 'net_15' });
    expect(r.status).toBe(200);
    expect(r.body.number).toBe('INV-00001');
    expect(r.body.dueDate).toBe('2026-11-16');
    invoiceId = r.body.id;
    const so = await api().get(`/api/docs/${soId}`);
    expect(so.body.invoiceStatus).toBe('invoiced');
    const q = await api().get(`/api/docs/${quoteId}`);
    expect(q.body.status).toBe('invoiced');
  });

  it('posts a balanced journal for the invoice', async () => {
    const r = await api().get(`/api/docs/${invoiceId}`);
    const j = r.body.journals[0];
    const dr = j.lines.reduce((s: number, l: { debit: number }) => s + l.debit, 0);
    const cr = j.lines.reduce((s: number, l: { credit: number }) => s + l.credit, 0);
    expect(dr).toBeCloseTo(cr, 2);
    const line = (id: string) => j.lines.find((l: { accountId: string }) => l.accountId === id);
    expect(line('acc_ar').debit).toBe(88200);
    expect(line('acc_tds_receivable').debit).toBe(1800);
    expect(line('acc_discount').debit).toBe(10000);
    expect(line('acc_sales').credit).toBe(100000);
  });

  it('records a partial then a full payment', async () => {
    const p1 = await api().post('/api/payments-received').send({ contactId: 'cus_test', amount: 50000, date: '2026-11-05', mode: 'Bank Transfer', depositToAccountId: 'acc_bank_hdfc', allocations: [{ docId: invoiceId, amount: 50000 }] });
    expect(p1.status).toBe(200);
    expect(p1.body.number).toBe('1');
    let inv = await api().get(`/api/docs/${invoiceId}`);
    expect(inv.body.status).toBe('partially_paid');
    expect(inv.body.balance).toBe(38200);

    const over = await api().post('/api/payments-received').send({ contactId: 'cus_test', amount: 99999, depositToAccountId: 'acc_petty_cash', allocations: [{ docId: invoiceId, amount: 99999 }] });
    expect(over.status).toBe(400);

    const p2 = await api().post('/api/payments-received').send({ contactId: 'cus_test', amount: 40000, bankCharges: 50, date: '2026-11-06', depositToAccountId: 'acc_petty_cash', allocations: [{ docId: invoiceId, amount: 38200 }] });
    expect(p2.status).toBe(200);
    expect(p2.body.unusedAmount).toBe(1800);
    inv = await api().get(`/api/docs/${invoiceId}`);
    expect(inv.body.status).toBe('paid');
    expect(inv.body.balance).toBe(0);

    const cus = await api().get('/api/contacts/cus_test');
    expect(cus.body.outstanding).toBe(0);
    expect(cus.body.unusedCredits).toBe(1800);
  });

  it('keeps the trial balance balanced', async () => {
    const tb = await trialBalance();
    expect(tb.totalDebit).toBeCloseTo(tb.totalCredit, 2);
    const ar = tb.rows.find((r) => r.accountId === 'acc_ar')!;
    // customer overpaid by 1,800 -> AR has a credit balance of 1,800
    expect(ar.credit).toBe(1800);
  });

  it('creates a credit note and refunds it', async () => {
    const inv2 = await api().post('/api/docs').send({ kind: 'invoice', mode: 'open', contactId: 'cus_ananya', date: '2026-11-10', lineItems: [{ itemId: 'item_logo', name: 'Logo Design', quantity: 1, rate: 8000 }] });
    const cn = await api().post('/api/docs').send({ kind: 'credit_note', mode: 'open', contactId: 'cus_ananya', invoiceId: inv2.body.id, lineItems: [{ name: 'Logo Design', quantity: 1, rate: 3000 }] });
    expect(cn.body.status).toBe('open');
    const ap = await api().post(`/api/docs/${cn.body.id}/apply-credits`).send({ applications: [{ invoiceId: inv2.body.id, amount: 2000 }] });
    expect(ap.status).toBe(200);
    const rf = await api().post(`/api/docs/${cn.body.id}/refunds`).send({ amount: 1000, date: '2026-11-11', mode: 'Cash', accountId: 'acc_petty_cash' });
    expect(rf.body.status).toBe('closed');
    const after = await api().get(`/api/docs/${inv2.body.id}`);
    expect(after.body.balance).toBe(6000);
    const tb = await trialBalance();
    expect(tb.totalDebit).toBeCloseTo(tb.totalCredit, 2);
  });
});

describe('purchase flow', () => {
  let vendorId = '';
  let billId = '';

  it('creates a vendor', async () => {
    const r = await api().post('/api/contacts').send({ kind: 'vendor', displayName: 'Kovai Paper Mills', companyName: 'Kovai Paper Mills', email: 'sales@kovaipaper.example', msmeRegistered: true, paymentTerms: 'net_30' });
    expect(r.status).toBe(200);
    expect(r.body.accountId).toBe('acc_ap');
    vendorId = r.body.id;
  });

  it('raises a PO and converts it into a bill', async () => {
    const po = await api().post('/api/docs').send({ kind: 'purchase_order', mode: 'open', contactId: vendorId, date: '2026-11-02', lineItems: [{ itemId: 'item_brochure', name: 'Printed Brochure', quantity: 1000, rate: 12 }] });
    expect(po.body.status).toBe('issued');
    const t = await api().get(`/api/docs/${po.body.id}/convert`).query({ to: 'bill' });
    const bill = await api().post('/api/docs').send({ ...t.body, kind: 'bill', number: 'KPM/2026/118', mode: 'open', date: '2026-11-03', tdsRate: 1 });
    expect(bill.status).toBe(200);
    expect(bill.body.total).toBe(11880);
    expect(bill.body.dueDate).toBe('2026-12-03');
    billId = bill.body.id;
    const po2 = await api().get(`/api/docs/${po.body.id}`);
    expect(po2.body.status).toBe('billed');
  });

  it('pays the bill', async () => {
    const r = await api().post('/api/payments-made').send({ contactId: vendorId, amount: 11880, date: '2026-11-20', mode: 'Bank Transfer', paidThroughAccountId: 'acc_bank_hdfc', allocations: [{ docId: billId, amount: 11880 }] });
    expect(r.status).toBe(200);
    const b = await api().get(`/api/docs/${billId}`);
    expect(b.body.status).toBe('paid');
    const tb = await trialBalance();
    expect(tb.totalDebit).toBeCloseTo(tb.totalCredit, 2);
    const ap = tb.rows.find((x) => x.accountId === 'acc_ap');
    expect(ap?.debit ?? 0).toBe(0);
    expect(ap?.credit ?? 0).toBe(0);
  });

  it('records an expense and shows it on the dashboard', async () => {
    const e = await api().post('/api/expenses').send({ date: '2026-11-21', accountId: 'acc_rent', amount: 15000, paidThroughAccountId: 'acc_bank_hdfc' });
    expect(e.status).toBe(200);
    const d = await api().get('/api/dashboard').query({ incomePeriod: 'all', expensePeriod: 'all', cashPeriod: 'all' });
    expect(d.body.topExpenses.items.some((x: { name: string }) => x.name === 'Rent Expense')).toBe(true);
    const pl = await api().get('/api/reports/profit-and-loss').query({ from: '2026-04-01', to: '2027-03-31' });
    expect(pl.body.netProfit).toBeDefined();
    const bs = await api().get('/api/reports/balance-sheet').query({ to: '2999-12-31' });
    expect(bs.body.totalAssets).toBeCloseTo(bs.body.totalLiabilitiesAndEquity, 2);
  });
});

describe('recurring', () => {
  it('generates child invoices for every elapsed period', async () => {
    const r = await api().post('/api/docs').send({ kind: 'recurring_invoice', contactId: 'cus_test', profileName: 'Hosting retainer', repeatEvery: { n: 1, unit: 'week' }, startOn: '2026-10-01', endsOn: '2026-10-29', neverExpires: false, lineItems: [{ itemId: 'item_hosting', name: 'Annual Hosting', quantity: 1, rate: 500 }] });
    expect(r.status).toBe(200);
    const run = await api().post('/api/recurring/run');
    expect(run.body.created).toBe(5);
    const prof = await api().get(`/api/docs/${r.body.id}`);
    expect(prof.body.related.children.length).toBe(5);
    expect(prof.body.status).toBe('expired');
  });
});

describe('email', () => {
  it('records an email without a mail server and builds PDFs', async () => {
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    const settings = (await api().get('/api/mail-settings')).body;
    expect(settings.configured).toBe(false);
    expect(settings.googleConnected).toBe(false);
    expect(settings.googleOAuthConfigured).toBe(false);
    const link = await api().get('/api/mail/google/start').query({ nonce: 'nonce_0123456789' });
    expect(link.status).toBe(400);
    expect(link.text).toContain('GOOGLE_OAUTH_CLIENT_ID');
    const inv = await api().post('/api/docs').send({ kind: 'invoice', mode: 'draft', contactId: 'cus_test', lineItems: [{ itemId: 'item_logo', name: 'Logo Design', quantity: 1, rate: 15000 }] });
    const r = await api().post('/api/mails').send({ to: ['client@example.com'], subject: 'Invoice', body: 'Hi', entityType: 'invoice', entityId: inv.body.id, contactId: 'cus_test', attachPdf: true });
    expect(r.status).toBe(200);
    expect(r.body.delivered).toBe(false);
    expect(r.body.attachments[0]).toMatch(/^Invoice-INV-\d+\.pdf$/);
    expect((await api().get(`/api/docs/${inv.body.id}`)).body.status).not.toBe('draft');
    const bad = await api().post('/api/mails').send({ to: ['not-an-email'], subject: 'x' });
    expect(bad.status).toBe(400);
    const { renderDocPdf } = await import('../server/pdf');
    const pdf = await renderDocPdf((await api().get(`/api/docs/${inv.body.id}`)).body);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });
});
