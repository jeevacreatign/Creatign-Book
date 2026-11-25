// Purchases module: expense detail data, Make Recurring, profile "Create Expense",
// bulk delete rules, and vendor refunds on Supplier Payments.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

process.env.DB_FILE = ':memory:';
process.env.UPLOAD_DIR = '/tmp/creatign-ledger-test-uploads';

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
  return r.body as { totalDebit: number; totalCredit: number };
}

describe('expenses', () => {
  let expenseId = '';

  it('returns the names the detail page shows (account tag, Paid Through, Paid To, Client)', async () => {
    const e = await api().post('/api/expenses').send({ date: '2026-11-24', accountId: 'acc_printing', amount: 122222, paidThroughAccountId: 'acc_petty_cash', vendorId: 'ven_murugan', customerId: 'cus_test', reportingTags: { Region: 'South' } });
    expect(e.status).toBe(200);
    expenseId = e.body.id;
    const d = await api().get(`/api/expenses/${expenseId}`);
    expect(d.body.accountName).toBe('Printing and Stationery');
    expect(d.body.paidThroughName).toBeTruthy();
    expect(d.body.vendorName).toBe('Sri Murugan Printers');
    expect(d.body.customerName).toBe('Test Company');
    expect(d.body.status).toBe('non_billable');
    expect(d.body.reportingTags).toEqual({ Region: 'South' });
    expect(d.body.journals).toHaveLength(1);
    const j = d.body.journals[0];
    expect(j.lines.reduce((s: number, l: { debit: number }) => s + l.debit, 0)).toBe(122222);
  });

  it('saves receipts dropped on the detail page without touching the amount', async () => {
    const r = await api().put(`/api/expenses/${expenseId}`).send({ receipts: [{ id: 'r1', name: 'bill.png', size: 10, mimeType: 'image/png', url: '/uploads/r1.png', uploadedAt: '2026-11-24' }] });
    expect(r.status).toBe(200);
    expect(r.body.amount).toBe(122222);
    expect(r.body.receipts).toHaveLength(1);
    const h = await api().get('/api/activities').query({ entityId: expenseId });
    expect(JSON.stringify(h.body)).toContain('Receipts updated');
  });

  it('makes the expense recurring and creates an expense from the profile on demand', async () => {
    const p = await api().post('/api/recurring-expenses').send({ profileName: 'Monthly printing', repeatEvery: { n: 1, unit: 'month' }, startOn: '2099-01-01', neverExpires: true, accountId: 'acc_printing', amount: 5000, paidThroughAccountId: 'acc_petty_cash', vendorId: 'ven_murugan' });
    expect(p.status).toBe(200);
    expect(p.body.nextDate).toBe('2099-01-01');
    const c = await api().post(`/api/recurring-expenses/${p.body.id}/actions/create_expense`).send({});
    expect(c.status).toBe(200);
    expect(c.body.createdExpenseId).toBeTruthy();
    const d = await api().get(`/api/recurring-expenses/${p.body.id}`);
    expect(d.body.children).toHaveLength(1);
    expect(d.body.children[0].amount).toBe(5000);
    expect(d.body.nextDate).toBe('2099-01-01');
    const child = await api().get(`/api/expenses/${c.body.createdExpenseId}`);
    expect(child.body.profile.profileName).toBe('Monthly printing');
  });

  it('blocks deleting an invoiced expense and bulk-deletes the rest', async () => {
    const billable = await api().post('/api/expenses').send({ date: '2026-11-24', accountId: 'acc_printing', amount: 900, paidThroughAccountId: 'acc_petty_cash', customerId: 'cus_test', billable: true });
    expect(billable.body.status).toBe('unbilled');
    const inv = await api().post(`/api/expenses/${billable.body.id}/convert-to-invoice`).send({});
    expect(inv.status).toBe(200);
    const blocked = await api().delete(`/api/expenses/${billable.body.id}`);
    expect(blocked.status).toBe(400);
    const other = await api().post('/api/expenses').send({ date: '2026-11-24', accountId: 'acc_meals', amount: 300, paidThroughAccountId: 'acc_petty_cash' });
    const bulk = await api().post('/api/expenses/bulk-delete').send({ ids: [other.body.id, expenseId] });
    expect(bulk.status).toBe(200);
    expect(bulk.body.deleted).toBe(2);
    expect((await api().get(`/api/expenses/${expenseId}`)).status).toBe(404);
  });
});

describe('supplier payments refunds', () => {
  it('refunds an unused supplier advance and keeps the books balanced', async () => {
    const pm = await api().post('/api/payments-made').send({ type: 'vendor_advance', contactId: 'ven_cloudhost', amount: 10000, date: '2026-11-20', mode: 'Bank Transfer', paidThroughAccountId: 'acc_petty_cash' });
    expect(pm.status).toBe(200);
    const tooMuch = await api().post(`/api/payments-made/${pm.body.id}/refunds`).send({ amount: 20000, date: '2026-11-24', accountId: 'acc_petty_cash' });
    expect(tooMuch.status).toBe(400);
    const r = await api().post(`/api/payments-made/${pm.body.id}/refunds`).send({ amount: 4000, date: '2026-11-24', mode: 'Bank Transfer', accountId: 'acc_petty_cash' });
    expect(r.status).toBe(200);
    const d = await api().get(`/api/payments-made/${pm.body.id}`);
    expect(d.body.refundedAmount).toBe(4000);
    expect(d.body.unusedAmount).toBe(6000);
    expect(d.body.journals).toHaveLength(2);
    const tb = await trialBalance();
    expect(tb.totalDebit).toBeCloseTo(tb.totalCredit, 2);
    const del = await api().delete(`/api/payments-made/${pm.body.id}/refunds/${d.body.refunds[0].id}`);
    expect(del.status).toBe(200);
    expect((await api().get(`/api/payments-made/${pm.body.id}`)).body.unusedAmount).toBe(10000);
  });
});
