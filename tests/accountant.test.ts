// Accountant: chart of accounts, manual journals (drafts, reversals, templates, locking), recurring
// journals, bulk update, currency adjustments and transaction locking.
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

const balance = async (id: string) => ((await api().get(`/api/accounts/${id}`)).body as { balance: number }).balance;

describe('chart of accounts', () => {
  it('creates accounts with Zoho types, codes and sub-accounts', async () => {
    const bad = await api().post('/api/accounts').send({ name: 'Goodwill' });
    expect(bad.body.error).toMatch(/Account Type/);
    const parent = await api().post('/api/accounts').send({ name: 'Vehicles', subType: 'fixed_asset', code: '1510' });
    expect(parent.body.type).toBe('asset');
    const child = await api().post('/api/accounts').send({ name: 'Delivery Van', subType: 'fixed_asset', parentId: parent.body.id });
    expect(child.body.parentId).toBe(parent.body.id);
    expect((await api().post('/api/accounts').send({ name: 'Wrong parent', subType: 'expense', parentId: parent.body.id })).body.error).toMatch(/same account type/);
    expect((await api().post('/api/accounts').send({ name: 'Dup code', subType: 'expense', code: '1510' })).body.error).toMatch(/already used/);
    expect((await api().delete(`/api/accounts/${parent.body.id}`)).body.error).toMatch(/sub-accounts/);
    expect((await api().delete('/api/accounts/acc_ar')).body.error).toMatch(/system account/);
    const detail = (await api().get(`/api/accounts/${child.body.id}`)).body;
    expect(detail.parentName).toBe('Vehicles');
  });

  it('bulk marks accounts inactive and skips system accounts', async () => {
    const a = await api().post('/api/accounts').send({ name: 'Old Expense', subType: 'expense' });
    const r = await api().post('/api/accounts/bulk').send({ ids: [a.body.id, 'acc_ar'], action: 'deactivate' });
    expect(r.body.errors).toHaveLength(1);
    expect((await api().get(`/api/accounts/${a.body.id}`)).body.active).toBe(false);
  });
});

describe('manual journals', () => {
  let id = '';
  it('keeps drafts out of the ledger until published', async () => {
    const before = await balance('acc_prepaid');
    const d = await api().post('/api/manual-journals').send({ date: '2026-11-10', status: 'draft', notes: 'Prepaid rent', lines: [{ accountId: 'acc_prepaid', debit: 1200 }, { accountId: 'acc_petty_cash', credit: 1200 }] });
    expect(d.status).toBe(200);
    expect(d.body.number).toMatch(/^MJ-/);
    id = d.body.id;
    expect(await balance('acc_prepaid')).toBe(before);
    await api().post(`/api/manual-journals/${id}/actions/publish`).send({});
    expect(await balance('acc_prepaid')).toBe(before + 1200);
  });

  it('validates notes, balance and duplicate numbers', async () => {
    expect((await api().post('/api/manual-journals').send({ date: '2026-11-10', lines: [{ accountId: 'acc_prepaid', debit: 10 }, { accountId: 'acc_petty_cash', credit: 10 }] })).body.error).toMatch(/Notes/);
    expect((await api().post('/api/manual-journals').send({ notes: 'x', lines: [{ accountId: 'acc_prepaid', debit: 10 }, { accountId: 'acc_petty_cash', credit: 5 }] })).body.error).toMatch(/must be equal/);
    const num = (await api().get(`/api/manual-journals/${id}`)).body.number;
    expect((await api().post('/api/manual-journals').send({ number: num, notes: 'x', lines: [{ accountId: 'acc_prepaid', debit: 10 }, { accountId: 'acc_petty_cash', credit: 10 }] })).body.error).toMatch(/already exists/);
  });

  it('creates a reversing journal from the reverse journal date and on demand', async () => {
    const j = await api().post('/api/manual-journals').send({ date: '2026-10-31', reverseDate: '2026-11-01', notes: 'Accrued salary', lines: [{ accountId: 'acc_salaries', debit: 5000 }, { accountId: 'acc_gst_payable', credit: 5000 }] });
    const d = (await api().get(`/api/manual-journals/${j.body.id}`)).body;
    expect(d.reversal).toHaveLength(1);
    const rev = (await api().get(`/api/manual-journals/${d.reversal[0].id}`)).body;
    expect(rev.date).toBe('2026-11-01');
    expect(rev.lines.find((l: { accountId: string }) => l.accountId === 'acc_salaries').credit).toBe(5000);
    const r2 = await api().post(`/api/manual-journals/${id}/actions/reverse`).send({ date: '2026-11-20' });
    expect(r2.body.reversalOf).toBe(id);
  });

  it('locks a journal against edits and deletion', async () => {
    await api().post(`/api/manual-journals/${id}/actions/lock`).send({});
    expect((await api().put(`/api/manual-journals/${id}`).send({ notes: 'changed' })).body.error).toMatch(/locked/);
    expect((await api().delete(`/api/manual-journals/${id}`)).body.error).toMatch(/locked/);
    await api().post(`/api/manual-journals/${id}/actions/unlock`).send({});
    expect((await api().put(`/api/manual-journals/${id}`).send({ notes: 'changed' })).status).toBe(200);
  });

  it('saves templates with and without amounts', async () => {
    expect((await api().post('/api/journal-templates').send({ name: 'Dep', enterAmount: true, lines: [{ accountId: 'acc_rent', type: 'debit', amount: 10 }, { accountId: 'acc_petty_cash', type: 'credit', amount: 5 }] })).body.error).toMatch(/equal/);
    const t = await api().post('/api/journal-templates').send({ name: 'Monthly rent', notes: 'Rent', lines: [{ accountId: 'acc_rent', type: 'debit' }, { accountId: 'acc_petty_cash', type: 'credit' }] });
    expect(t.status).toBe(200);
    const fromJ = await api().post(`/api/manual-journals/${id}/actions/save-as-template`).send({ name: 'Prepaid' });
    expect(fromJ.body.lines[0].amount).toBe(1200);
    expect((await api().get('/api/journal-templates')).body).toHaveLength(2);
  });

  it('respects the reporting method in cash and accrual reports', async () => {
    await api().post('/api/manual-journals').send({ date: '2026-11-12', notes: 'Cash only', reportingMethod: 'cash_only', lines: [{ accountId: 'acc_meals', debit: 700 }, { accountId: 'acc_petty_cash', credit: 700 }] });
    const acc = (await api().get('/api/reports/profit-and-loss').query({ from: '2026-11-01', to: '2026-11-30', basis: 'accrual' })).body;
    const cash = (await api().get('/api/reports/profit-and-loss').query({ from: '2026-11-01', to: '2026-11-30', basis: 'cash' })).body;
    const meals = (r: { operatingExpense: { name: string; amount: number }[] }) => r.operatingExpense.find((x) => x.name === 'Meals and Entertainment')?.amount ?? 0;
    expect(meals(acc)).toBe(0);
    expect(meals(cash)).toBe(700);
  });
});

describe('recurring journals', () => {
  it('publishes a journal for every elapsed period', async () => {
    const r = await api().post('/api/recurring-journals').send({ profileName: 'Depreciation', repeatEvery: { n: 1, unit: 'month' }, startOn: '2026-08-31', neverExpires: false, endsOn: '2026-10-31', notes: 'Monthly depreciation', lines: [{ accountId: 'acc_other_expense', debit: 1000 }, { accountId: 'acc_furniture', credit: 1000 }] });
    expect(r.status).toBe(200);
    const d = (await api().get(`/api/recurring-journals/${r.body.id}`)).body;
    const dates = d.children.map((c: { date: string }) => c.date).sort();
    expect(dates).toHaveLength(3);
    expect(dates.slice(0, 2)).toEqual(['2026-08-31', '2026-09-30']);
    expect(d.status).toBe('expired');
  });
});

describe('bulk update', () => {
  it('moves the matching lines of transactions to a new account', async () => {
    const e = await api().post('/api/expenses').send({ date: '2026-11-03', accountId: 'acc_printing', amount: 900, paidThroughAccountId: 'acc_petty_cash' });
    const rows = (await api().post('/api/bulk-update/search').send({ accountId: 'acc_printing', from: '2026-11-01', to: '2026-11-30' })).body;
    expect(rows.map((x: { id: string }) => x.id)).toContain(e.body.id);
    const u = await api().post('/api/bulk-update').send({ accountId: 'acc_printing', newAccountId: 'acc_office_supplies', ids: [e.body.id] });
    expect(u.body.updated).toBe(1);
    expect((await api().get(`/api/expenses/${e.body.id}`)).body.accountId).toBe('acc_office_supplies');
  });
});

describe('currency adjustments', () => {
  it('records the rate with a zero gain or loss for an INR book', async () => {
    expect((await api().post('/api/currency-adjustments').send({ currencyCode: 'INR', date: '2026-11-24', rate: 1, notes: 'x' })).body.error).toMatch(/foreign currency/);
    const a = await api().post('/api/currency-adjustments').send({ currencyCode: 'AED', date: '2026-11-24', rate: 25.258266, notes: 'Month end' });
    expect(a.body.gainOrLoss).toBe(0);
    expect((await api().get('/api/currencies')).body.find((c: { code: string }) => c.code === 'AED').rate).toBe(25.258266);
  });
});

describe('transaction locking', () => {
  it('blocks creating, editing and deleting transactions in a locked period', async () => {
    const inv = await api().post('/api/docs').send({ kind: 'invoice', mode: 'open', contactId: 'cus_test', date: '2026-09-10', lineItems: [{ name: 'Work', quantity: 1, rate: 1000 }] });
    expect(inv.status).toBe(200);
    expect((await api().post('/api/transaction-locks/sales/lock').send({ date: '2026-09-30' })).body.error).toMatch(/Reason/);
    await api().post('/api/transaction-locks/sales/lock').send({ date: '2026-09-30', reason: 'Q2 closed' });
    const blocked = await api().post('/api/docs').send({ kind: 'invoice', mode: 'open', contactId: 'cus_test', date: '2026-09-15', lineItems: [{ name: 'Work', quantity: 1, rate: 1000 }] });
    expect(blocked.body.error).toMatch(/locked/);
    expect((await api().delete(`/api/docs/${inv.body.id}`)).body.error).toMatch(/locked/);
    // purchases are not locked
    expect((await api().post('/api/expenses').send({ date: '2026-09-15', accountId: 'acc_rent', amount: 10, paidThroughAccountId: 'acc_petty_cash' })).status).toBe(200);
    // later dates are fine
    expect((await api().post('/api/docs').send({ kind: 'invoice', mode: 'open', contactId: 'cus_test', date: '2026-10-01', lineItems: [{ name: 'Work', quantity: 1, rate: 1000 }] })).status).toBe(200);
    await api().post('/api/transaction-locks/all/lock').send({ date: '2026-08-31', reason: 'Audit' });
    expect((await api().post('/api/manual-journals').send({ date: '2026-08-01', notes: 'x', lines: [{ accountId: 'acc_rent', debit: 1 }, { accountId: 'acc_petty_cash', credit: 1 }] })).body.error).toMatch(/Accountant/);
    await api().post('/api/transaction-locks/all/unlock').send({ reason: 'done' });
    await api().post('/api/transaction-locks/sales/unlock').send({ reason: 'reopen' });
    expect((await api().delete(`/api/docs/${inv.body.id}`)).status).toBe(200);
  });
});
