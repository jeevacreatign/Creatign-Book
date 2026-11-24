// Reports Center: every catalogue report runs, statements balance and GST returns add up.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

process.env.DB_FILE = ':memory:';
process.env.UPLOAD_DIR = '/tmp/creatign-books-test-uploads';

let app: Express;
const api = () => request(app);

type Row = { c: Record<string, string | number | undefined>; kind?: string };
type Report = { title: string; columns: { key: string }[]; rows: Row[] };
const run = async (key: string, q: Record<string, string> = {}) => {
  const r = await api().get(`/api/report-data/${key}`).query(q);
  expect(r.status, `${key}: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(200);
  return r.body as Report;
};
const cell = (r: Report, label: string, key: string) => r.rows.find((x) => String(x.c[r.columns[0].key] ?? '').startsWith(label))?.c[key];

const RANGE = { from: '2026-11-01', to: '2026-11-30' };

beforeAll(async () => {
  const mod = await import('../server/app');
  const { resetDb } = await import('../server/db');
  resetDb(true);
  mod.boot();
  app = mod.createApp();
  // a registered customer in another state (IGST, B2B) and a consumer in Tamil Nadu (CGST + SGST, B2C small)
  const b2b = await api().post('/api/contacts').send({ kind: 'customer', displayName: 'Bengaluru Labs', gstTreatment: 'registered_business', gstin: '29AAGFB1234K1Z2', placeOfSupply: 'Karnataka' });
  const b2c = await api().post('/api/contacts').send({ kind: 'customer', displayName: 'Walk-in Chennai', gstTreatment: 'consumer', placeOfSupply: 'Tamil Nadu' });
  const inv = (contactId: string, rate: number) => api().post('/api/docs').send({ kind: 'invoice', mode: 'open', contactId, date: '2026-11-10', lineItems: [{ name: 'Design work', quantity: 2, rate, taxId: 'gst18', hsnSac: '998391' }] });
  expect((await inv(b2b.body.id, 5000)).body.taxAmount).toBe(1800);
  expect((await inv(b2c.body.id, 1000)).body.taxAmount).toBe(360);
  // a bill with input tax
  await api().post('/api/docs').send({ kind: 'bill', mode: 'open', contactId: 'ven_murugan', date: '2026-11-12', lineItems: [{ name: 'Brochures', quantity: 1, rate: 10000, accountId: 'acc_printing', taxId: 'gst18' }] });
});

describe('catalogue', () => {
  it('runs every report without errors', async () => {
    const cat = (await api().get('/api/report-catalog')).body as { reports: { key: string; category: string }[]; categories: string[] };
    expect(cat.reports.length).toBeGreaterThanOrEqual(70);
    for (const c of cat.categories) expect(cat.reports.some((r) => r.category === c)).toBe(true);
    for (const r of cat.reports) {
      const out = await run(r.key, { period: 'this_fiscal_year' });
      expect(out.columns.length, r.key).toBeGreaterThan(0);
    }
    expect((await api().get('/api/report-data/nope')).status).toBe(404);
  });
});

describe('financial statements', () => {
  it('balances the balance sheet and trial balance', async () => {
    const bs = await run('balance-sheet', { to: '2999-12-31' });
    const assets = cell(bs, 'Total for Assets', 'amount');
    const le = cell(bs, 'Total for Liabilities & Equities', 'amount');
    expect(Number(assets)).toBeCloseTo(Number(le), 2);
    const tb = await run('trial-balance', { to: '2999-12-31' });
    const t = tb.rows.find((r) => r.kind === 'grand')!.c;
    expect(Number(t.debit)).toBeCloseTo(Number(t.credit), 2);
    const s3 = await run('balance-sheet-schedule-iii', { to: '2999-12-31' });
    const totals = s3.rows.filter((r) => r.c.account === 'TOTAL').map((r) => Number(r.c.amount));
    expect(totals[0]).toBeCloseTo(totals[1], 2);
  });

  it('agrees with the profit and loss API and ties cash flow to cash', async () => {
    const pl = await run('profit-and-loss', RANGE);
    const legacy = (await api().get('/api/reports/profit-and-loss').query(RANGE)).body;
    expect(Number(cell(pl, 'Net Profit/Loss', 'amount'))).toBeCloseTo(legacy.netProfit, 2);
    const cf = await run('cash-flow-statement', { from: '2026-04-01', to: '2027-03-31' });
    const ending = Number(cell(cf, 'Ending Cash Balance', 'amount'));
    const cashNow = (await run('balance-sheet', { to: '2027-03-31' })).rows.filter((r) => r.c.account === 'Total for Cash' || r.c.account === 'Total for Bank').reduce((s, r) => s + Number(r.c.amount), 0);
    expect(ending).toBeCloseTo(cashNow, 2);
  });
});

describe('GST', () => {
  it('classifies invoices into GSTR-1 tables', async () => {
    const g = await run('gstr-1-summary', RANGE);
    const b2b = g.rows.find((r) => String(r.c.section).startsWith('B2B'))!.c;
    expect(b2b).toMatchObject({ count: 1, taxable: 10000, igst: 1800 });
    const b2cs = g.rows.find((r) => String(r.c.section).startsWith('B2C Small'))!.c;
    expect(b2cs).toMatchObject({ taxable: 2000, cgst: 180, sgst: 180 });
  });

  it('builds GSTR-3B outward tax and ITC', async () => {
    const g = await run('gstr-3b-summary', RANGE);
    const a = g.rows.find((r) => String(r.c.section).startsWith('(a) Outward taxable'))!.c;
    expect(a.taxable).toBe(12000);
    expect(Number(a.tax)).toBe(2160);
    const itc = g.rows.find((r) => String(r.c.section).startsWith('(A)(5)'))!.c;
    expect(Number(itc.tax)).toBeGreaterThanOrEqual(1800);
    const hsn = await run('hsn-summary', RANGE);
    const row = hsn.rows.find((r) => r.c.hsn === '998391')!.c;
    expect(row).toMatchObject({ qty: 4, taxable: 12000, igst: 1800, cgst: 180, sgst: 180 });
  });
});

describe('details and saved reports', () => {
  it('filters account transactions with a running balance', async () => {
    const r = await run('account-transactions', { ...RANGE, accountId: 'acc_printing', account: 'acc_printing' });
    expect(r.columns.some((c) => c.key === 'balance')).toBe(true);
    const closing = r.rows.find((x) => x.c.date === 'Closing Balance')!.c.balance;
    expect(Number(closing)).toBeGreaterThanOrEqual(10000);
  });

  it('ages receivables and saves a custom report', async () => {
    const ag = await run('ar-aging-summary', { to: '2026-12-31' });
    expect(Number(ag.rows.find((r) => r.c.name === 'Bengaluru Labs')?.c.total)).toBe(11800);
    expect((await api().post('/api/saved-reports').send({ name: '', report: 'sales-by-customer' })).body.error).toMatch(/Name/);
    const s = await api().post('/api/saved-reports').send({ name: 'November sales', report: 'sales-by-customer', params: RANGE, hiddenColumns: ['withTax'] });
    expect(s.status).toBe(200);
    expect((await api().get('/api/report-catalog')).body.saved).toHaveLength(1);
    await api().delete(`/api/saved-reports/${s.body.id}`);
    expect((await api().get('/api/report-catalog')).body.saved).toHaveLength(0);
  });
});
