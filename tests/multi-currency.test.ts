// Multi-currency: INR stays the base currency; foreign-currency documents and payments keep their own
// amounts and the rate on their date, the ledger and reports are converted to INR, and settlements at
// another rate post realized exchange gains or losses. All records here are clearly named test data.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Journal, JournalLine } from '../shared/types';

process.env.DB_FILE = ':memory:';
process.env.UPLOAD_DIR = '/tmp/creatign-ledger-test-uploads';

let app: Express;
const api = () => request(app);
const r2 = (n: number) => Math.round(n * 100) / 100;
/** INR at a rate, exactly as the app rounds it (half-up on whole cents) */
const inr = (amount: number, rate: number) => Math.floor((Math.round(amount * 100) * Math.round(rate * 1e6) + 500000) / 1e6) / 100;

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
const lines = (js: Journal[], sourceType?: string) => js.filter((j) => !sourceType || j.sourceType === sourceType).flatMap((j) => j.lines);
const dr = (ls: JournalLine[], acc: string) => r2(ls.filter((l) => l.accountId === acc).reduce((a, l) => a + l.debit, 0));
const cr = (ls: JournalLine[], acc: string) => r2(ls.filter((l) => l.accountId === acc).reduce((a, l) => a + l.credit, 0));
const balanced = (ls: JournalLine[]) => expect(Math.abs(r2(ls.reduce((a, l) => a + l.debit - l.credit, 0)))).toBe(0);

let usdClient = '';
let usdVendor = '';
let usdInvoice = '';

describe('INR regression', () => {
  it('keeps INR as the fixed base currency', async () => {
    const boot = await api().get('/api/bootstrap');
    expect(boot.body.organization.currencyCode).toBe('INR');
    const change = await api().put('/api/organization').send({ currencyCode: 'USD' });
    expect(change.status).toBe(400);
    const cur = await api().get('/api/currencies');
    expect(cur.body[0]).toMatchObject({ code: 'INR', base: true, rate: 1 });
  });

  it('records INR invoices at rate 1 with unchanged journals', async () => {
    const r = await api().post('/api/docs').send({ kind: 'invoice', mode: 'open', contactId: 'cus_test', date: '2026-11-05', lineItems: [{ name: 'MC-TEST INR consulting', quantity: 2, rate: 1250.5 }] });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ currencyCode: 'INR', exchangeRate: 1, baseTotal: r.body.total });
    const d = await api().get(`/api/docs/${r.body.id}`);
    expect(dr(lines(d.body.journals, 'invoice'), 'acc_ar')).toBe(r.body.total);
    const bad = await api().post('/api/docs').send({ kind: 'invoice', mode: 'open', contactId: 'cus_test', date: '2026-11-05', exchangeRate: 2, lineItems: [{ name: 'x', quantity: 1, rate: 1 }] });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/INR always use an exchange rate of 1/);
  });
});

describe('currency settings', () => {
  it('adds ISO 4217 currencies with a manual rate and rejects unknown codes', async () => {
    expect((await api().post('/api/currencies').send({ code: 'XYZ', rate: 1 })).status).toBe(400);
    expect((await api().post('/api/currencies').send({ code: 'USD', rate: 80 })).body.error).toMatch(/already been added/);
    const jpy = await api().post('/api/currencies').send({ code: 'jpy', rate: 0.5612 });
    expect(jpy.status).toBe(200);
    expect(jpy.body).toMatchObject({ code: 'JPY', rate: 0.5612 });
    expect((await api().post('/api/currencies').send({ code: 'CHF', rate: -2 })).status).toBe(400);
    // dated rate history: transactions default to the latest rate on or before their date
    expect((await api().put('/api/currencies/USD').send({ rate: 82, date: '2026-10-15' })).status).toBe(200);
    const on = await api().get('/api/currencies/USD/rate').query({ date: '2026-10-20' });
    expect(on.body.rate).toBe(82);
    expect((await api().delete('/api/currencies/INR')).status).toBe(400);
  });

  it('gives clients and suppliers a default currency', async () => {
    const c = await api().post('/api/contacts').send({ kind: 'customer', displayName: 'MC-TEST Client (USD)', currencyCode: 'USD', placeOfSupply: 'Tamil Nadu', gstTreatment: 'overseas' });
    expect(c.status).toBe(200);
    expect(c.body.currencyCode).toBe('USD');
    usdClient = c.body.id;
    const v = await api().post('/api/contacts').send({ kind: 'vendor', displayName: 'MC-TEST Supplier (USD)', currencyCode: 'USD', gstTreatment: 'overseas' });
    usdVendor = v.body.id;
    const opening = await api().post('/api/contacts').send({ kind: 'customer', displayName: 'MC-TEST Opening (USD)', currencyCode: 'USD', openingBalance: 100 });
    expect(opening.status).toBe(400);
    expect((await api().post('/api/contacts').send({ kind: 'customer', displayName: 'MC-TEST Bad', currencyCode: 'ABC' })).status).toBe(400);
  });
});

describe('foreign-currency documents', () => {
  it('stores the currency and the entered rate and posts the journal in INR', async () => {
    const r = await api().post('/api/docs').send({ kind: 'invoice', mode: 'open', contactId: usdClient, date: '2026-11-01', exchangeRate: 83.2575, lineItems: [{ name: 'MC-TEST Export design work', quantity: 1, rate: 1000.33 }] });
    expect(r.status).toBe(200);
    usdInvoice = r.body.id;
    expect(r.body).toMatchObject({ currencyCode: 'USD', exchangeRate: 83.2575, total: 1000.33 });
    expect(r.body.baseTotal).toBe(inr(1000.33, 83.2575));
    const d = await api().get(`/api/docs/${usdInvoice}`);
    const ls = lines(d.body.journals, 'invoice');
    expect(dr(ls, 'acc_ar')).toBe(inr(1000.33, 83.2575));
    balanced(ls);
    const tb = await trialBalance();
    expect(tb.totalDebit).toBeCloseTo(tb.totalCredit, 2);
  });

  it('defaults the rate to the currency history on the document date', async () => {
    const r = await api().post('/api/docs').send({ kind: 'quote', mode: 'draft', contactId: usdClient, date: '2026-10-20', lineItems: [{ name: 'MC-TEST Estimate', quantity: 1, rate: 50 }] });
    expect(r.body).toMatchObject({ currencyCode: 'USD', exchangeRate: 82 });
    const bill = await api().post('/api/docs').send({ kind: 'bill', mode: 'open', contactId: usdVendor, number: 'MC-TEST-B1', date: '2026-11-02', exchangeRate: 83.5, lineItems: [{ name: 'MC-TEST Cloud credits', quantity: 1, rate: 400 }] });
    expect(bill.status).toBe(200);
    expect(bill.body).toMatchObject({ currencyCode: 'USD', exchangeRate: 83.5, total: 400, baseTotal: 33400 });
  });

  it('rejects a document currency different from the contact currency', async () => {
    const r = await api().post('/api/docs').send({ kind: 'invoice', mode: 'open', contactId: usdClient, currencyCode: 'EUR', lineItems: [{ name: 'x', quantity: 1, rate: 1 }] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/must be in USD, not EUR/);
  });

  it('keeps the original rate when the currency rate changes and requires confirmation to change it', async () => {
    await api().put('/api/currencies/USD').send({ rate: 90 });
    const again = await api().get(`/api/docs/${usdInvoice}`);
    expect(again.body.exchangeRate).toBe(83.2575);
    const edit = await api().put(`/api/docs/${usdInvoice}`).send({ ...again.body, notes: 'MC-TEST edited', mode: 'draft' });
    expect(edit.status).toBe(200);
    expect(edit.body.exchangeRate).toBe(83.2575);
    const unconfirmed = await api().put(`/api/docs/${usdInvoice}`).send({ exchangeRate: 85 });
    expect(unconfirmed.status).toBe(400);
    expect(unconfirmed.body.error).toMatch(/recorded at 1 USD = ₹83\.2575.*Confirm/);
    const confirmed = await api().put(`/api/docs/${usdInvoice}`).send({ exchangeRate: 85, confirmRateChange: true });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.exchangeRate).toBe(85);
    const back = await api().put(`/api/docs/${usdInvoice}`).send({ exchangeRate: 83.2575, confirmRateChange: true });
    expect(back.body.exchangeRate).toBe(83.2575);
    const d = await api().get(`/api/docs/${usdInvoice}`);
    expect(dr(lines(d.body.journals, 'invoice'), 'acc_ar')).toBe(inr(1000.33, 83.2575));
  });

  it('blocks a currency change on a contact with transactions', async () => {
    const r = await api().put(`/api/contacts/${usdClient}`).send({ currencyCode: 'EUR' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/already has transactions in USD/);
  });

  it('rounds base amounts half-up on exact cents, independent of floating point', async () => {
    const { toBase } = await import('../shared/currency');
    expect(toBase(1000.33, 83.2575)).toBe(83284.97); // exactly 83,284.974975
    expect(toBase(0.5, 0.01)).toBe(0.01); // 0.005 rounds up
    expect(toBase(1.005, 1)).toBe(1.01);
    expect(toBase(-10.01, 83.5)).toBe(-835.84); // -835.835 -> away from zero
    expect(toBase(123.45, 1)).toBe(123.45);
  });

  it('balances every journal after rounding to paise', async () => {
    const r = await api().post('/api/docs').send({ kind: 'invoice', mode: 'open', contactId: usdClient, date: '2026-11-03', exchangeRate: 83.123457, discountPercent: 3, lineItems: [{ name: 'MC-TEST A', quantity: 3, rate: 33.33 }, { name: 'MC-TEST B', quantity: 7, rate: 0.37 }, { name: 'MC-TEST C', quantity: 1, rate: 19.99 }] });
    expect(r.status).toBe(200);
    const d = await api().get(`/api/docs/${r.body.id}`);
    const ls = lines(d.body.journals, 'invoice');
    expect(dr(ls, 'acc_ar')).toBe(inr(r.body.total, 83.123457));
    balanced(ls);
    expect(ls.every((l) => r2(l.debit) === l.debit && r2(l.credit) === l.credit)).toBe(true);
    await api().delete(`/api/docs/${r.body.id}`);
  });
});

describe('payments, allocations and realized FX', () => {
  it('rejects a payment in another currency than the invoice', async () => {
    const r = await api().post('/api/payments-received').send({ contactId: usdClient, currencyCode: 'INR', amount: 100, depositToAccountId: 'acc_bank_hdfc', allocations: [{ docId: usdInvoice, amount: 100 }] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/must be in USD, not INR/);
    // an INR client's payment cannot settle the USD invoice either
    const other = await api().post('/api/payments-received').send({ contactId: 'cus_test', amount: 100, depositToAccountId: 'acc_bank_hdfc', allocations: [{ docId: usdInvoice, amount: 100 }] });
    expect(other.status).toBe(400);
  });

  it('applies a payment in the invoice currency and posts the realized gain', async () => {
    const r = await api().post('/api/payments-received').send({ contactId: usdClient, amount: 500, date: '2026-11-10', exchangeRate: 84, depositToAccountId: 'acc_bank_hdfc', allocations: [{ docId: usdInvoice, amount: 500 }] });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ currencyCode: 'USD', exchangeRate: 84 });
    const inv = await api().get(`/api/docs/${usdInvoice}`);
    expect(inv.body.balance).toBe(500.33);
    expect(inv.body.status).toBe('partially_paid');
    expect(inv.body.baseBalance).toBe(inr(500.33, 83.2575));
    const p = await api().get(`/api/payments-received/${r.body.id}`);
    const ls = lines(p.body.journals);
    expect(dr(ls, 'acc_bank_hdfc')).toBe(42000);
    expect(cr(ls, 'acc_ar')).toBe(inr(500, 83.2575));
    expect(cr(ls, 'acc_fx_gain')).toBe(r2(42000 - inr(500, 83.2575)));
    expect(p.body.fxGainLoss).toBe(371.25);
    balanced(ls);
  });

  it('keeps the AR control account equal to open invoices converted at their own rates', async () => {
    const tb = await api().get('/api/reports/trial-balance').query({ to: '2999-12-31' });
    expect(tb.body.totalDebit).toBeCloseTo(tb.body.totalCredit, 2);
    const bal = await api().get('/api/reports/customer-balances');
    const row = bal.body.rows.find((x: { contactId: string }) => x.contactId === usdClient);
    expect(row).toMatchObject({ currencyCode: 'USD', fcyOutstanding: 500.33, outstanding: inr(500.33, 83.2575) });
    const aging = await api().get('/api/reports/ar-aging');
    const dash = await api().get('/api/dashboard');
    expect(dash.body.receivables.total).toBe(aging.body.total ?? dash.body.receivables.total);
    // never adds USD to INR: the dashboard total includes the USD balance converted
    const raw = (await api().get('/api/docs').query({ kind: 'invoice', status: 'unpaid' })).body as { balance: number; baseBalance: number }[];
    expect(dash.body.receivables.total).toBe(r2(raw.reduce((a, d) => a + d.baseBalance, 0)));
  });

  it('refunds in the payment currency at the refund-date rate', async () => {
    const adv = await api().post('/api/payments-received').send({ contactId: usdClient, amount: 100, date: '2026-11-11', exchangeRate: 84, depositToAccountId: 'acc_bank_hdfc' });
    expect(adv.status).toBe(200);
    const mismatch = await api().post(`/api/payments-received/${adv.body.id}/actions/refund`).send({ amount: 40, currencyCode: 'INR', date: '2026-11-12', accountId: 'acc_bank_hdfc' });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error).toMatch(/Currency mismatch/);
    const ok = await api().post(`/api/payments-received/${adv.body.id}/actions/refund`).send({ amount: 40, exchangeRate: 83, date: '2026-11-12', accountId: 'acc_bank_hdfc' });
    expect(ok.status).toBe(200);
    const p = await api().get(`/api/payments-received/${adv.body.id}`);
    const ref = lines(p.body.journals, 'payment_refund');
    expect(dr(ref, 'acc_ar')).toBe(3360);
    expect(cr(ref, 'acc_bank_hdfc')).toBe(3320);
    expect(cr(ref, 'acc_fx_gain')).toBe(40);
    balanced(ref);
  });

  it('posts a realized loss on supplier payments at a higher rate', async () => {
    const bill = (await api().get('/api/docs').query({ kind: 'bill', q: 'MC-TEST-B1' })).body[0];
    const r = await api().post('/api/payments-made').send({ contactId: usdVendor, amount: 400, date: '2026-11-12', exchangeRate: 84, paidThroughAccountId: 'acc_bank_hdfc', allocations: [{ docId: bill.id, amount: 400 }] });
    expect(r.status).toBe(200);
    const p = await api().get(`/api/payments-made/${r.body.id}`);
    const ls = lines(p.body.journals);
    expect(dr(ls, 'acc_ap')).toBe(33400);
    expect(cr(ls, 'acc_bank_hdfc')).toBe(33600);
    expect(dr(ls, 'acc_fx_gain')).toBe(200);
    expect(p.body.fxGainLoss).toBe(-200);
    const b = await api().get(`/api/docs/${bill.id}`);
    expect(b.body.status).toBe('paid');
  });

  it('realizes the difference when a credit note at another rate is applied', async () => {
    const cn = await api().post('/api/docs').send({ kind: 'credit_note', mode: 'open', contactId: usdClient, date: '2026-11-13', exchangeRate: 85, lineItems: [{ name: 'MC-TEST Goodwill credit', quantity: 1, rate: 100 }] });
    expect(cn.status).toBe(200);
    const app1 = await api().post(`/api/docs/${cn.body.id}/apply-credits`).send({ applications: [{ invoiceId: usdInvoice, amount: 100 }] });
    expect(app1.status).toBe(200);
    const d = await api().get(`/api/docs/${cn.body.id}`);
    const ls = lines(d.body.journals, 'credit_application');
    expect(dr(ls, 'acc_ar')).toBe(8500);
    expect(cr(ls, 'acc_ar')).toBe(inr(100, 83.2575));
    // the credit was booked at more INR than the receivable it settles: a gain
    expect(cr(ls, 'acc_fx_gain')).toBe(r2(8500 - inr(100, 83.2575)));
    balanced(ls);
    expect((await api().get(`/api/docs/${usdInvoice}`)).body.balance).toBe(400.33);
    // undo so the later revaluation sees the invoice as before
    const rm = await api().delete(`/api/docs/${cn.body.id}/credit-applications/${app1.body.creditApplications[0].id}`);
    expect(rm.status, JSON.stringify(rm.body)).toBe(200);
    expect((await api().get(`/api/docs/${usdInvoice}`)).body.balance).toBe(500.33);
  });

  it('gives recurring invoices the rate on each generated date', async () => {
    const prof = await api().post('/api/docs').send({ kind: 'recurring_invoice', mode: 'draft', contactId: usdClient, profileName: 'MC-TEST retainer', repeatEvery: { n: 1, unit: 'month' }, startOn: '2026-10-25', date: '2026-10-25', createAsDraft: true, lineItems: [{ name: 'MC-TEST Monthly support', quantity: 1, rate: 200 }] });
    expect(prof.status).toBe(200);
    expect(prof.body.currencyCode).toBe('USD');
    const { makeDocFromProfile } = await import('../server/engine');
    const { getDb } = await import('../server/db');
    const child = makeDocFromProfile(getDb().docs.find((x) => x.id === prof.body.id)!, '2026-10-25');
    expect(child).toMatchObject({ currencyCode: 'USD', exchangeRate: 82 });
    await api().post(`/api/docs/${prof.body.id}/actions/stop`).send({});
  });

  it('shows realized FX in the profit and loss', async () => {
    const pl = await api().get('/api/reports/profit-and-loss').query({ from: '2026-04-01', to: '2027-03-31' });
    expect(JSON.stringify(pl.body)).toMatch(/Exchange Gain or Loss/);
  });
});

describe('unrealized FX revaluation', () => {
  it('revalues open USD balances, posts on the date and reverses the next day', async () => {
    const preview = await api().post('/api/currency-adjustments/preview').send({ currencyCode: 'USD', date: '2026-11-30', rate: 86 });
    expect(preview.status).toBe(200);
    const invLine = preview.body.lines.find((l: { sourceId: string }) => l.sourceId === usdInvoice);
    expect(invLine).toMatchObject({ balance: 500.33, bookedRate: 83.2575, gainOrLoss: r2(inr(500.33, 86) - inr(500.33, 83.2575)) });
    const adj = await api().post('/api/currency-adjustments').send({ currencyCode: 'USD', date: '2026-11-30', rate: 86, notes: 'MC-TEST month-end revaluation' });
    expect(adj.status).toBe(200);
    expect(adj.body.gainOrLoss).toBe(preview.body.gainOrLoss);
    const gl = await api().get('/api/reports/journal').query({ from: '2026-11-30', to: '2026-12-01' });
    const fx = (gl.body.journals as Journal[]).filter((j) => j.sourceType === 'fx_revaluation');
    expect(fx.map((j) => j.date).sort()).toEqual(['2026-11-30', '2026-12-01']);
    const on = fx.find((j) => j.date === '2026-11-30')!;
    expect(dr(on.lines, 'acc_ar')).toBe(invLine.gainOrLoss);
    for (const j of fx) balanced(j.lines);
    // the revaluation is reversed, so the original rate stays on the invoice
    expect((await api().get(`/api/docs/${usdInvoice}`)).body.exchangeRate).toBe(83.2575);
    const tb = await trialBalance();
    expect(tb.totalDebit).toBeCloseTo(tb.totalCredit, 2);
  });
});

describe('PDF and email output', () => {
  it('shows the currency, rate and INR total on the document PDF model', async () => {
    const { buildPdfModel, builtInTemplates } = await import('../shared/pdfTemplate');
    const { getDb } = await import('../server/db');
    const db = getDb();
    const d = db.docs.find((x) => x.id === usdInvoice)!;
    const m = buildPdfModel(d, db.organization, db.contacts.find((c) => c.id === d.contactId), builtInTemplates()[0]);
    expect(m.totalValue).toBe('$1,000.33');
    expect(m.facts).toContainEqual(['Exchange Rate', '1 USD = ₹83.2575']);
    const { moneyIn } = await import('../shared/currency');
    expect(m.totals).toContainEqual({ label: 'Total in INR (at 1 USD = ₹83.2575)', value: moneyIn(inr(1000.33, 83.2575), 'INR') });
    const { amountInWords } = await import('../shared/pdfTemplate');
    expect(amountInWords(1000.33, 'USD')).toBe('US Dollar One Thousand and 33/100 Only');
    expect(amountInWords(125000.5)).toBe('Indian Rupee One Lakh Twenty-Five Thousand and Fifty Paise Only');
  });
});

describe('migration of records saved before multi-currency', () => {
  it('reads legacy rows as INR at rate 1', async () => {
    const { normalizeCurrencies } = await import('../shared/currency');
    const legacy = { organization: { currencyCode: 'INR' }, currencies: [{ code: 'INR', name: 'Indian Rupee', symbol: '₹', rate: 1 }], contacts: [{ id: 'c1' }], docs: [{ id: 'd1', total: 10 }], paymentsReceived: [{ id: 'p1' }], paymentsMade: [] } as never;
    normalizeCurrencies(legacy);
    const l = legacy as unknown as { contacts: { currencyCode: string }[]; docs: { currencyCode: string; exchangeRate: number }[]; paymentsReceived: { currencyCode: string; exchangeRate: number }[] };
    expect(l.contacts[0].currencyCode).toBe('INR');
    expect(l.docs[0]).toMatchObject({ currencyCode: 'INR', exchangeRate: 1 });
    expect(l.paymentsReceived[0]).toMatchObject({ currencyCode: 'INR', exchangeRate: 1 });
  });
});
