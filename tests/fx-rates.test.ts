// Live exchange rates: refresh from the provider (stubbed here, no network), failures, currencies the
// provider does not quote, stale rates, and that a refresh only changes the default for new documents.
// All records are clearly named test data.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { addDays, today } from '../shared/format';

process.env.DB_FILE = ':memory:';
process.env.UPLOAD_DIR = '/tmp/creatign-ledger-test-uploads';
delete process.env.FX_RATES_PROVIDER;
delete process.env.FX_RATES_URL;

let app: Express;
const api = () => request(app);
const inr = (amount: number, rate: number) => Math.floor((Math.round(amount * 100) * Math.round(rate * 1e6) + 500000) / 1e6) / 100;
const DAY = today();

/** A Frankfurter-shaped answer: units per 1 EUR (EUR 1 = INR 101.92, USD 1.0512 ...). AED is not quoted. */
const ecb = (date = DAY, inrPerEur = 101.92) => ({ amount: 1, base: 'EUR', date, rates: { INR: inrPerEur, USD: 1.0512, GBP: 0.8341, JPY: 161.2 } });
const stubFetch = (impl: (url: string) => Promise<Response> | Response) => {
  const fn = vi.fn(async (url: string | URL) => impl(String(url)));
  vi.stubGlobal('fetch', fn);
  return fn;
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeAll(async () => {
  const mod = await import('../server/app');
  const { resetDb } = await import('../server/db');
  resetDb(true);
  mod.boot();
  app = mod.createApp();
});
afterEach(() => vi.unstubAllGlobals());

const currency = async (code: string) => ((await api().get('/api/currencies')).body as { code: string; rate: number; status: { source: string; stale: boolean; date?: string; provider?: string }; history: { date: string; rate: number; source?: string }[] }[]).find((c) => c.code === code)!;

let eurClient = '';
let oldInvoice = '';
const OLD_DATE = addDays(DAY, -20);

describe('before any refresh', () => {
  it('flags seeded rates without a date as stale and records a historical EUR invoice', async () => {
    const eur = await currency('EUR');
    expect(eur.status).toMatchObject({ source: 'unknown', stale: true });
    const c = await api().post('/api/contacts').send({ kind: 'customer', displayName: 'FX-RATES-TEST EUR Client', currencyCode: 'EUR' });
    expect(c.status).toBe(200);
    eurClient = c.body.id;
    // an old manual rate, then an invoice on that date
    expect((await api().put('/api/currencies/EUR').send({ rate: 89.2, date: OLD_DATE })).status).toBe(200);
    const inv = await api().post('/api/docs').send({ kind: 'invoice', mode: 'open', contactId: eurClient, date: OLD_DATE, lineItems: [{ name: 'FX-RATES-TEST old work', quantity: 1, rate: 1000 }] });
    expect(inv.status).toBe(200);
    expect(inv.body.exchangeRate).toBe(89.2);
    oldInvoice = inv.body.id;
    const st = await currency('EUR');
    expect(st.status).toMatchObject({ source: 'manual', stale: true, date: OLD_DATE });
  });
});

describe('successful refresh', () => {
  it('fetches on the server, saves dated fetched rates and lists unsupported currencies', async () => {
    const f = stubFetch(() => json(ecb()));
    const r = await api().post('/api/currency-rates/refresh');
    expect(r.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toBe('https://api.frankfurter.dev/v1/latest?base=EUR');
    expect(r.body).toMatchObject({ ok: true, rateDate: DAY, provider: 'Frankfurter (European Central Bank)' });
    expect(r.body.unsupported).toContain('AED');
    const eurUpd = r.body.updated.find((u: { code: string }) => u.code === 'EUR');
    expect(eurUpd).toMatchObject({ previousRate: 89.2, rate: 101.92, date: DAY });
    // cross rates through EUR: INR per USD = 101.92 / 1.0512
    expect(r.body.updated.find((u: { code: string }) => u.code === 'USD').rate).toBe(Math.round((101.92 / 1.0512) * 1e6) / 1e6);

    const eur = await currency('EUR');
    expect(eur.rate).toBe(101.92);
    expect(eur.status).toMatchObject({ source: 'fetched', stale: false, date: DAY, provider: 'Frankfurter (European Central Bank)' });
    expect(eur.history.find((h) => h.date === DAY)).toMatchObject({ rate: 101.92, source: 'fetched' });
    expect(eur.history.find((h) => h.date === OLD_DATE)).toMatchObject({ rate: 89.2, source: 'manual' });
    // AED was not quoted: unchanged and still flagged
    const aed = await currency('AED');
    expect(aed.status.stale).toBe(true);
    const st = await api().get('/api/currency-rates/status');
    expect(st.body.lastRun).toMatchObject({ ok: true, rateDate: DAY });
    expect(st.body.provider).toMatchObject({ apiKeyRequired: false });
  });

  it('keeps the rate of existing transactions and uses the new rate for new documents', async () => {
    const old = await api().get(`/api/docs/${oldInvoice}`);
    expect(old.body.exchangeRate).toBe(89.2);
    expect(old.body.baseTotal).toBe(inr(old.body.total, 89.2));
    // the rate offered on a new document dated today
    const day = await api().get('/api/currencies/EUR/rate').query({ date: DAY });
    expect(day.body).toMatchObject({ rate: 101.92, source: 'fetched', stale: false });
    // on the old date the historical rate is still offered
    expect((await api().get('/api/currencies/EUR/rate').query({ date: OLD_DATE })).body.rate).toBe(89.2);
    const q = await api().post('/api/docs').send({ kind: 'quote', contactId: eurClient, date: DAY, lineItems: [{ name: 'FX-RATES-TEST consulting', quantity: 2, rate: 150.25 }] });
    expect(q.status).toBe(200);
    expect(q.body).toMatchObject({ currencyCode: 'EUR', exchangeRate: 101.92, total: 300.5 });
    expect(q.body.baseTotal).toBe(inr(300.5, 101.92));
    expect(q.body.baseTotal).toBe(30626.96);
  });

  it('keeps a later manual rate as the default and says so', async () => {
    const yesterday = addDays(DAY, -1);
    stubFetch(() => json(ecb(yesterday, 100.5)));
    // a manual rate for today, then a refresh that returns yesterday's rate
    await api().put('/api/currencies/GBP').send({ rate: 120, date: DAY });
    const r = await api().post('/api/currency-rates/refresh');
    expect(r.body.ok).toBe(true);
    expect(r.body.keptManual).toEqual(expect.arrayContaining([{ code: 'GBP', date: DAY, rate: 120 }]));
    const gbp = await currency('GBP');
    expect(gbp.rate).toBe(120);
    expect(gbp.history.find((h) => h.date === yesterday)).toMatchObject({ source: 'fetched', rate: Math.round((100.5 / 0.8341) * 1e6) / 1e6 });
    // EUR: today's fetched rate stays the default; yesterday's is added to the history
    expect((await currency('EUR')).rate).toBe(101.92);
  });
});

describe('provider failures', () => {
  it('reports an HTTP error and changes nothing', async () => {
    const before = await currency('EUR');
    stubFetch(() => json({ message: 'unavailable' }, 503));
    const r = await api().post('/api/currency-rates/refresh');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: false, updated: [] });
    expect(r.body.error).toMatch(/answered 503/);
    const after = await currency('EUR');
    expect(after.rate).toBe(before.rate);
    expect(after.history).toEqual(before.history);
    const st = await api().get('/api/currency-rates/status');
    expect(st.body.lastRun).toMatchObject({ ok: false });
    expect(st.body.lastSuccessAt).toBeTruthy();
  });

  it('reports a network error and a malformed response', async () => {
    stubFetch(() => Promise.reject(new TypeError('fetch failed')));
    const r = await api().post('/api/currency-rates/refresh');
    expect(r.body).toMatchObject({ ok: false });
    expect(r.body.error).toMatch(/Could not reach the rate provider: fetch failed/);
    stubFetch(() => json({ base: 'EUR', date: DAY, rates: { USD: 1.05 } }));
    const r2 = await api().post('/api/currency-rates/refresh');
    expect(r2.body).toMatchObject({ ok: false, error: 'The rate provider response has no INR rate' });
    stubFetch(() => json({ base: 'EUR', date: DAY, rates: { INR: -4 } }));
    expect((await api().post('/api/currency-rates/refresh')).body.ok).toBe(false);
  });

  it('needs the API key from the environment for a keyed provider, without exposing it', async () => {
    process.env.FX_RATES_PROVIDER = 'openexchangerates';
    try {
      const f = stubFetch(() => json({}));
      const r = await api().post('/api/currency-rates/refresh');
      expect(r.body).toMatchObject({ ok: false, error: 'OPENEXCHANGERATES_APP_ID is not set in the server environment' });
      expect(f).not.toHaveBeenCalled();
      process.env.OPENEXCHANGERATES_APP_ID = 'test-app-id-not-real';
      const g = stubFetch(() => json({ timestamp: Math.floor(Date.parse(`${DAY}T12:00:00Z`) / 1000), base: 'USD', rates: { INR: 96.95, EUR: 0.9513, USD: 1 } }));
      const ok = await api().post('/api/currency-rates/refresh');
      expect(ok.body.ok).toBe(true);
      const [url, init] = g.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).not.toContain('test-app-id-not-real');
      expect((init.headers as Record<string, string>).Authorization).toBe('Token test-app-id-not-real');
      expect(ok.body.updated.find((u: { code: string }) => u.code === 'USD').rate).toBe(96.95);
      const st = await api().get('/api/currency-rates/status');
      expect(JSON.stringify(st.body)).not.toContain('test-app-id-not-real');
      expect(st.body.provider).toMatchObject({ apiKeyRequired: true, apiKeyConfigured: true });
    } finally {
      delete process.env.FX_RATES_PROVIDER;
      delete process.env.OPENEXCHANGERATES_APP_ID;
    }
  });
});

describe('settings', () => {
  it('turns automatic refresh off and on', async () => {
    expect((await api().get('/api/currency-rates/status')).body.autoRefresh).toBe(true);
    expect((await api().put('/api/currency-rates/settings').send({ autoRefresh: false })).body.autoRefresh).toBe(false);
    expect((await api().get('/api/currency-rates/status')).body.autoRefresh).toBe(false);
    await api().put('/api/currency-rates/settings').send({ autoRefresh: true });
  });
});
