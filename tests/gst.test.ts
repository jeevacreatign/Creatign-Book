// GST on purchases (Zoho Books India): CGST/SGST vs IGST, tax inclusive amounts, reverse charge,
// input tax credit journals, expenses with tax, bulk bill payments and applying advances to bills.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { computeTax, isIntraState, stateFromGstin } from '../shared/gst';

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

type Line = { accountId: string; debit: number; credit: number };
const jlines = (j: { lines: Line[] }[]) => j.flatMap((x) => x.lines);
const dr = (lines: Line[], acc: string) => lines.filter((l) => l.accountId === acc).reduce((s, l) => s + l.debit, 0);
const cr = (lines: Line[], acc: string) => lines.filter((l) => l.accountId === acc).reduce((s, l) => s + l.credit, 0);

async function balanced() {
  const r = await api().get('/api/reports/trial-balance').query({ to: '2999-12-31' });
  expect(r.body.totalDebit).toBeCloseTo(r.body.totalCredit, 2);
}

const bill = (extra: Record<string, unknown>) =>
  api()
    .post('/api/docs')
    .send({ kind: 'bill', mode: 'open', contactId: 'ven_murugan', date: '2026-11-24', lineItems: [{ name: 'Brochures', quantity: 1, rate: 10000, accountId: 'acc_printing', taxId: 'gst18' }], discountPercent: 0, tdsRate: 0, tcsRate: 0, adjustment: 0, ...extra });

describe('gst helpers', () => {
  it('splits intra-state tax and charges IGST between states', () => {
    expect(isIntraState('Tamil Nadu', 'Tamil Nadu')).toBe(true);
    expect(isIntraState('Karnataka', 'Tamil Nadu')).toBe(false);
    expect(isIntraState('Tamil Nadu', 'Tamil Nadu', 'overseas')).toBe(false);
    expect(stateFromGstin('29AAGFC1234K1Z2')).toBe('Karnataka');
    const intra = computeTax([{ amount: 1000, taxId: 'gst12' }], { intra: true });
    expect(intra.breakdown.map((b) => [b.key, b.amount])).toEqual([['CGST6', 60], ['SGST6', 60]]);
    const incl = computeTax([{ amount: 1180, taxId: 'gst18' }], { intra: false, inclusive: true });
    expect(incl.taxTotal).toBe(180);
    expect(incl.lineTaxable[0]).toBe(1000);
  });
});

describe('bills with GST', () => {
  it('charges CGST + SGST for a vendor in the same state and books input tax credit', async () => {
    const r = await bill({});
    expect(r.status).toBe(200);
    expect(r.body.gstTreatment).toBe('registered_business');
    expect(r.body.sourceOfSupply).toBe('Tamil Nadu');
    expect(r.body.taxAmount).toBe(1800);
    expect(r.body.total).toBe(11800);
    const d = await api().get(`/api/docs/${r.body.id}`);
    const lines = jlines(d.body.journals);
    expect(dr(lines, 'acc_printing')).toBe(10000);
    expect(dr(lines, 'acc_input_cgst')).toBe(900);
    expect(dr(lines, 'acc_input_sgst')).toBe(900);
    expect(cr(lines, 'acc_ap')).toBe(11800);
    await balanced();
  });

  it('charges IGST for an inter-state vendor', async () => {
    const r = await bill({ contactId: 'ven_cloudhost', number: 'CH-1' });
    expect(r.body.sourceOfSupply).toBe('Karnataka');
    expect(r.body.taxBreakdown).toEqual([{ key: 'IGST18', component: 'igst', rate: 18, amount: 1800 }]);
  });

  it('extracts tax from tax-inclusive amounts', async () => {
    const r = await bill({ number: 'INC-1', taxInclusive: true, lineItems: [{ name: 'Paper', quantity: 1, rate: 11800, accountId: 'acc_printing', taxId: 'gst18' }] });
    expect(r.body.total).toBe(11800);
    expect(r.body.taxAmount).toBe(1800);
    const d = await api().get(`/api/docs/${r.body.id}`);
    expect(dr(jlines(d.body.journals), 'acc_printing')).toBe(10000);
    await balanced();
  });

  it('leaves tax out of the payable under reverse charge', async () => {
    const r = await bill({ number: 'RCM-1', reverseCharge: true });
    expect(r.body.total).toBe(10000);
    expect(r.body.taxAmount).toBe(1800);
    const d = await api().get(`/api/docs/${r.body.id}`);
    const lines = jlines(d.body.journals);
    expect(cr(lines, 'acc_rcm_payable')).toBe(1800);
    expect(cr(lines, 'acc_ap')).toBe(10000);
    await balanced();
  });

  it('rejects an invalid GSTIN', async () => {
    const r = await bill({ number: 'BAD-1', gstin: 'NOTAGSTIN' });
    expect(r.status).toBe(400);
  });

  it('shows tax on the PDF model', async () => {
    const pdf = await api().get('/api/docs').query({ kind: 'bill' });
    expect(pdf.body.some((b: { taxAmount: number }) => b.taxAmount === 1800)).toBe(true);
  });
});

describe('expenses with GST', () => {
  it('adds tax on top of a tax-exclusive expense and keeps the typed amount on edit', async () => {
    const e = await api().post('/api/expenses').send({ date: '2026-11-24', accountId: 'acc_printing', amount: 1000, paidThroughAccountId: 'acc_petty_cash', vendorId: 'ven_murugan', taxId: 'gst5', taxInclusive: false, expenseType: 'goods', hsnSac: '4911' });
    expect(e.status).toBe(200);
    expect(e.body.subTotal).toBe(1000);
    expect(e.body.taxAmount).toBe(50);
    expect(e.body.amount).toBe(1050);
    const d = await api().get(`/api/expenses/${e.body.id}`);
    const lines = jlines(d.body.journals);
    expect(dr(lines, 'acc_printing')).toBe(1000);
    expect(dr(lines, 'acc_input_cgst')).toBe(25);
    expect(cr(lines, 'acc_petty_cash')).toBe(1050);
    const r = await api().put(`/api/expenses/${e.body.id}`).send({ receipts: [] });
    expect(r.body.amount).toBe(1050);
    await balanced();
  });

  it('extracts tax from an inclusive itemized expense', async () => {
    const e = await api().post('/api/expenses').send({ date: '2026-11-24', itemized: true, lines: [{ accountId: 'acc_meals', amount: 1180, taxId: 'gst18' }, { accountId: 'acc_travel', amount: 500, taxId: 'exempt' }], paidThroughAccountId: 'acc_petty_cash', vendorId: 'ven_cloudhost', taxInclusive: true });
    expect(e.status).toBe(200);
    expect(e.body.amount).toBe(1680);
    expect(e.body.taxAmount).toBe(180);
    expect(e.body.taxBreakdown[0].key).toBe('IGST18');
    await balanced();
  });

  it('carries tax into expenses created from a recurring profile', async () => {
    const p = await api().post('/api/recurring-expenses').send({ profileName: 'Internet', repeatEvery: { n: 1, unit: 'month' }, startOn: '2099-01-01', accountId: 'acc_internet', amount: 1000, taxId: 'gst18', taxInclusive: false, paidThroughAccountId: 'acc_petty_cash', vendorId: 'ven_cloudhost' });
    expect(p.body.amount).toBe(1180);
    const c = await api().post(`/api/recurring-expenses/${p.body.id}/actions/create_expense`).send({});
    const child = await api().get(`/api/expenses/${c.body.createdExpenseId}`);
    expect(child.body.amount).toBe(1180);
    expect(child.body.taxAmount).toBe(180);
  });
});

describe('paying bills', () => {
  it('records one payment per vendor from a bulk payment', async () => {
    const a = await bill({ number: 'BULK-1' });
    const b = await bill({ number: 'BULK-2', contactId: 'ven_cloudhost' });
    const r = await api().post('/api/payments-made/bulk').send({ payments: [
      { contactId: 'ven_murugan', date: '2026-11-25', mode: 'Bank Transfer', paidThroughAccountId: 'acc_bank_hdfc', amount: 11800, allocations: [{ docId: a.body.id, amount: 11800 }] },
      { contactId: 'ven_cloudhost', date: '2026-11-25', mode: 'Bank Transfer', paidThroughAccountId: 'acc_bank_hdfc', amount: 5000, allocations: [{ docId: b.body.id, amount: 5000 }] },
    ] });
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(2);
    expect((await api().get(`/api/docs/${a.body.id}`)).body.status).toBe('paid');
    expect((await api().get(`/api/docs/${b.body.id}`)).body.balance).toBe(6800);
  });

  it('rolls back the whole bulk payment when one fails', async () => {
    const before = (await api().get('/api/payments-made')).body.length;
    const a = await bill({ number: 'BULK-3' });
    const r = await api().post('/api/payments-made/bulk').send({ payments: [
      { contactId: 'ven_murugan', date: '2026-11-25', paidThroughAccountId: 'acc_bank_hdfc', amount: 100, allocations: [{ docId: a.body.id, amount: 100 }] },
      { contactId: 'ven_murugan', date: '2026-11-25', paidThroughAccountId: 'acc_bank_hdfc', amount: 99999999, allocations: [{ docId: a.body.id, amount: 99999999 }] },
    ] });
    expect(r.status).toBe(400);
    expect((await api().get('/api/payments-made')).body.length).toBe(before);
  });

  it('applies an unused vendor advance to a bill', async () => {
    const adv = await api().post('/api/payments-made').send({ type: 'vendor_advance', contactId: 'ven_murugan', amount: 5000, date: '2026-11-20', paidThroughAccountId: 'acc_bank_hdfc' });
    const b = await bill({ number: 'ADV-1' });
    const r = await api().post(`/api/payments-made/${adv.body.id}/apply`).send({ allocations: [{ docId: b.body.id, amount: 5000 }] });
    expect(r.status).toBe(200);
    expect((await api().get(`/api/docs/${b.body.id}`)).body.balance).toBe(6800);
    expect((await api().get(`/api/payments-made/${adv.body.id}`)).body.unusedAmount).toBe(0);
    await balanced();
  });
});
