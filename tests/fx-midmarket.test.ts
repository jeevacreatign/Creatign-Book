// Live mid-market rates (Open Exchange Rates, stubbed here, no network): the Settings choice, a successful
// refresh with the rate's time, provider failure, stale rates by market hours, INR conversion on a new
// document, and that existing transactions keep their rates. All records are clearly named test data.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { addDays, today } from '../shared/format';
import { marketHoursBetween, rateStatus } from '../shared/currency';

process.env.DB_FILE = ':memory:';
process.env.UPLOAD_DIR = '/tmp/creatign-ledger-test-uploads';
delete process.env.FX_RATES_PROVIDER;
delete process.env.FX_RATES_URL;
delete process.env.OPENEXCHANGERATES_APP_ID;
const KEY = 'test-oxr-app-id-not-real';

let app: Express;
const api = () => request(app);
const inr = (amount: number, rate: number) => Math.floor((Math.round(amount * 100) * Math.round(rate * 1e6) + 500000) / 1e6) / 100;
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const DAY = today();
const OXR_URL = 'https://openexchangerates.org/api/latest.json';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const stubFetch = (impl: (url: string) => Response) => {
  const fn = vi.fn(async (url: string | URL) => impl(String(url)));
  vi.stubGlobal('fetch', fn);
  return fn;
};
/** An Open Exchange Rates answer: units per 1 USD, timestamped `minutesAgo` before now. */
const oxr = (inrPerUsd: number, eurPerUsd: number, minutesAgo = 20) => ({
  disclaimer: 'test',
  license: 'test',
  timestamp: Math.floor((Date.now() - minutesAgo * 60_000) / 1000),
  base: 'USD',
  rates: { USD: 1, INR: inrPerUsd, EUR: eurPerUsd, GBP: 0.79 },
});

beforeAll(async () => {
  const mod = await import('../server/app');
  const { resetDb } = await import('../server/db');
  resetDb(true);
  mod.boot();
  app = mod.createApp();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENEXCHANGERATES_APP_ID;
});
const withKey = () => (process.env.OPENEXCHANGERATES_APP_ID = KEY);

type Row = { code: string; rate: number; status: { source: string; stale: boolean; date?: string; provider?: string; asOf?: string; staleReason?: string }; history: { date: string; rate: number; source?: string; provider?: string; asOf?: string }[] };
const currency = async (code: string) => ((await api().get('/api/currencies')).body as Row[]).find((c) => c.code === code)!;

let client = '';
let oldInvoice = '';
let todayInvoice = '';
const OLD_DATE = addDays(DAY, -12);

describe('choosing live mid-market rates', () => {
  it('offers mid-market only once the App ID is set on the server', async () => {
    const st = await api().get('/api/currency-rates/status');
    expect(st.body.provider).toMatchObject({ basis: 'central-bank', midMarketAvailable: false, basisFromEnv: false, refreshEvery: 'every 6 hours' });
    const no = await api().put('/api/currency-rates/settings').send({ rateBasis: 'mid-market' });
    expect(no.status).toBe(400);
    expect(no.body.error).toMatch(/need OPENEXCHANGERATES_APP_ID set in the server environment/);
    expect((await api().put('/api/currency-rates/settings').send({ rateBasis: 'live' })).status).toBe(400);
    // the AWS stack's placeholder for an empty key counts as no key
    process.env.OPENEXCHANGERATES_APP_ID = 'not-set';
    expect((await api().get('/api/currency-rates/status')).body.provider).toMatchObject({ basis: 'central-bank', midMarketAvailable: false });

    withKey();
    const on = await api().get('/api/currency-rates/status');
    // with the key and no choice saved, mid-market is the default
    expect(on.body.provider).toMatchObject({ basis: 'mid-market', mode: 'openexchangerates', midMarketAvailable: true, apiKeyConfigured: true, refreshEvery: 'every hour' });
    expect(on.body.midMarketStaleHours).toBe(24);
    expect(on.body.provider.note).toMatch(/Indicative/);
    expect(on.body.provider.note).toMatch(/not always the same figure/);
    expect(on.body.provider.sources.map((s: { id: string }) => s.id)).toEqual(['openexchangerates']);
    expect(JSON.stringify(on.body)).not.toContain(KEY);
  });

  it('records test transactions at an old manual rate before any refresh', async () => {
    const c = await api().post('/api/contacts').send({ kind: 'customer', displayName: `FX-MID-TEST EUR Client ${Date.now()}`, currencyCode: 'EUR' });
    expect(c.status).toBe(200);
    client = c.body.id;
    expect((await api().put('/api/currencies/EUR').send({ rate: 89.2, date: OLD_DATE })).status).toBe(200);
    const inv = await api().post('/api/docs').send({ kind: 'invoice', mode: 'open', contactId: client, date: OLD_DATE, lineItems: [{ name: 'FX-MID-TEST old work', quantity: 1, rate: 1000 }] });
    expect(inv.body.exchangeRate).toBe(89.2);
    oldInvoice = inv.body.id;
    // a manual rate from yesterday, and an invoice dated today at that rate
    expect((await api().put('/api/currencies/EUR').send({ rate: 95, date: addDays(DAY, -1) })).status).toBe(200);
    expect((await api().get('/api/currencies/EUR/rate').query({ date: DAY })).body).toMatchObject({ rate: 95, source: 'manual' });
    const t = await api().post('/api/docs').send({ kind: 'invoice', mode: 'open', contactId: client, date: DAY, lineItems: [{ name: 'FX-MID-TEST today work', quantity: 1, rate: 500 }] });
    expect(t.body.exchangeRate).toBe(95);
    todayInvoice = t.body.id;
  });
});

describe('successful refresh', () => {
  it('takes every currency from Open Exchange Rates with its time, and only from there', async () => {
    withKey();
    const f = stubFetch((url) => (url === OXR_URL ? json(oxr(96.95, 0.9513)) : json({}, 404)));
    const r = await api().post('/api/currency-rates/refresh');
    expect(r.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(OXR_URL);
    expect(url).not.toContain(KEY);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Token ${KEY}`);
    const eurRate = r6(96.95 / 0.9513);
    expect(r.body).toMatchObject({ ok: true, provider: 'Open Exchange Rates', rateDate: DAY });
    expect(Date.now() - Date.parse(r.body.rateAsOf)).toBeLessThan(21 * 60_000 + 5000);
    expect(r.body.updated.find((u: { code: string }) => u.code === 'EUR')).toMatchObject({ previousRate: 95, rate: eurRate, source: 'Open Exchange Rates' });
    expect(r.body.updated.find((u: { code: string }) => u.code === 'USD')).toMatchObject({ rate: 96.95 });
    expect(JSON.stringify(r.body)).not.toContain(KEY);

    const eur = await currency('EUR');
    expect(eur.rate).toBe(eurRate);
    expect(eur.status).toMatchObject({ source: 'fetched', provider: 'Open Exchange Rates', stale: false, date: DAY, asOf: r.body.rateAsOf });
    expect(eur.history.find((h) => h.date === DAY)).toMatchObject({ source: 'fetched', provider: 'Open Exchange Rates', asOf: r.body.rateAsOf });
    expect(eur.history.find((h) => h.date === OLD_DATE)).toMatchObject({ rate: 89.2, source: 'manual' });
  });

  it('a later refresh the same day replaces that day’s rate with the newer one', async () => {
    withKey();
    stubFetch(() => json(oxr(97.1, 0.95, 2)));
    const r = await api().post('/api/currency-rates/refresh');
    expect(r.body.ok).toBe(true);
    const eur = await currency('EUR');
    expect(eur.rate).toBe(r6(97.1 / 0.95));
    expect(eur.history.filter((h) => h.date === DAY)).toHaveLength(1);
  });

  it('keeps a rate entered by hand for today instead of overwriting it', async () => {
    withKey();
    expect((await api().put('/api/currencies/GBP').send({ rate: 120.5, date: DAY })).status).toBe(200);
    stubFetch(() => json(oxr(97.1, 0.95, 2)));
    const r = await api().post('/api/currency-rates/refresh');
    expect(r.body.keptManual).toEqual([{ code: 'GBP', date: DAY, rate: 120.5 }]);
    const gbp = await currency('GBP');
    expect(gbp.rate).toBe(120.5);
    expect(gbp.status).toMatchObject({ source: 'manual' });
    expect(gbp.history.filter((h) => h.date === DAY)).toEqual([expect.objectContaining({ rate: 120.5, source: 'manual' })]);
  });

  it('uses the refreshed rate on a new document and keeps the rates of saved ones', async () => {
    const rate = r6(97.1 / 0.95);
    const day = await api().get('/api/currencies/EUR/rate').query({ date: DAY });
    expect(day.body).toMatchObject({ rate, source: 'fetched', provider: 'Open Exchange Rates', rateDate: DAY, stale: false });
    expect(day.body.asOf).toBeTruthy();
    expect(day.body.refreshError).toBeUndefined();
    const q = await api().post('/api/docs').send({ kind: 'quote', contactId: client, date: DAY, lineItems: [{ name: 'FX-MID-TEST consulting', quantity: 2, rate: 150.25 }] });
    expect(q.status).toBe(200);
    expect(q.body).toMatchObject({ currencyCode: 'EUR', exchangeRate: rate, total: 300.5 });
    expect(q.body.baseTotal).toBe(inr(300.5, rate));
    // saved transactions are untouched, including the one dated today
    const old = await api().get(`/api/docs/${oldInvoice}`);
    expect(old.body.exchangeRate).toBe(89.2);
    expect(old.body.baseTotal).toBe(inr(old.body.total, 89.2));
    const t = await api().get(`/api/docs/${todayInvoice}`);
    expect(t.body.exchangeRate).toBe(95);
    expect(t.body.baseTotal).toBe(inr(500, 95));
  });
});

describe('provider failure', () => {
  it('reports the error, changes nothing and does not switch to another source', async () => {
    withKey();
    const before = await currency('EUR');
    const f = stubFetch(() => json({ error: true, status: 401, message: `invalid_app_id ${KEY}` }, 200));
    const r = await api().post('/api/currency-rates/refresh');
    expect(r.body).toMatchObject({ ok: false, updated: [] });
    expect(r.body.error).toMatch(/The rate provider reported an error: invalid_app_id \*\*\*/);
    expect(JSON.stringify(r.body)).not.toContain(KEY);
    expect(f).toHaveBeenCalledTimes(1);
    stubFetch(() => json({ message: 'down' }, 503));
    const down = await api().post('/api/currency-rates/refresh');
    expect(down.body).toMatchObject({ ok: false, error: 'The rate provider answered 503' });
    const after = await currency('EUR');
    expect(after.rate).toBe(before.rate);
    expect(after.history).toEqual(before.history);
    // the default offered to a new document says it is the last saved rate, from a failed refresh
    const day = await api().get('/api/currencies/EUR/rate').query({ date: DAY });
    expect(day.body).toMatchObject({ rate: before.rate, source: 'fetched', refreshError: 'The rate provider answered 503' });
    expect(day.body.refreshFailedAt).toBeTruthy();
    const st = await api().get('/api/currency-rates/status');
    expect(st.body.lastRun).toMatchObject({ ok: false });
    expect(st.body.lastSuccessAt).toBeTruthy();
  });

  it('refuses a rate time in the future and a response without INR', async () => {
    withKey();
    stubFetch(() => json(oxr(97, 0.95, -60)));
    expect((await api().post('/api/currency-rates/refresh')).body.error).toBe('The rate provider sent a rate time in the future');
    stubFetch(() => json({ timestamp: Math.floor(Date.now() / 1000), rates: { USD: 1 } }));
    expect((await api().post('/api/currency-rates/refresh')).body.error).toBe('The rate provider response has no INR rate');
  });
});

describe('stale mid-market rates', () => {
  it('flags a rate older than 24 market hours, and not Friday’s close over the weekend', () => {
    const c = (asOf: string) => ({ code: 'EUR', name: 'Euro', symbol: '€', rate: 100, history: [{ date: asOf.slice(0, 10), rate: 100, source: 'fetched' as const, provider: 'Open Exchange Rates', asOf }] });
    const rules = { staleHoursByProvider: { 'Open Exchange Rates': 24 } };
    // Wednesday 2026-11-25 10:00 UTC, checked Thursday 09:00 UTC: 23 hours, fresh
    expect(rateStatus(c('2026-11-25T10:00:00.000Z'), '2026-11-26', 4, { ...rules, now: Date.parse('2026-11-26T09:00:00Z') })).toMatchObject({ stale: false, ageHours: 23 });
    // ... checked Thursday 12:00 UTC: 26 hours, stale
    const st = rateStatus(c('2026-11-25T10:00:00.000Z'), '2026-11-26', 4, { ...rules, now: Date.parse('2026-11-26T12:00:00Z') });
    expect(st).toMatchObject({ stale: true, ageHours: 26, staleReason: 'Rate is 26 market hours old' });
    // Friday 2026-11-27 21:00 UTC close, checked Sunday 2026-11-29 12:00 UTC: 1 market hour, fresh
    expect(marketHoursBetween('2026-11-27T21:00:00.000Z', Date.parse('2026-11-29T12:00:00Z'))).toBe(1);
    expect(rateStatus(c('2026-11-27T21:00:00.000Z'), '2026-11-29', 4, { ...rules, now: Date.parse('2026-11-29T12:00:00Z') }).stale).toBe(false);
    // ... checked Monday 2026-11-30 22:00 UTC: 1 + 24 market hours, stale
    expect(marketHoursBetween('2026-11-27T21:00:00.000Z', Date.parse('2026-11-30T22:00:00Z'))).toBe(25);
    // a manual entry keeps the day-based limit
    expect(rateStatus({ ...c('2026-11-25T10:00:00.000Z'), history: [{ date: '2026-11-25', rate: 100, source: 'manual' as const }] }, '2026-11-26', 4, rules).stale).toBe(false);
  });

  it('shows a saved mid-market rate as stale once it is old', async () => {
    withKey();
    // refreshes failed for three days: only a three-day-old rate is saved for USD
    expect((await api().delete(`/api/currencies/USD/history/${DAY}`)).status).toBe(200);
    stubFetch(() => json(oxr(97.3, 0.95, 60 * 24 * 3)));
    const r = await api().post('/api/currency-rates/refresh');
    expect(r.body.ok).toBe(true);
    const usd = await currency('USD');
    expect(usd.status).toMatchObject({ source: 'fetched', stale: true });
    expect(usd.status.staleReason).toMatch(/market hours old/);
    const day = await api().get('/api/currencies/USD/rate').query({ date: DAY });
    expect(day.body).toMatchObject({ stale: true });
  });
});

describe('switching back to central banks', () => {
  it('saves the choice and uses the central banks again', async () => {
    withKey();
    const s = await api().put('/api/currency-rates/settings').send({ rateBasis: 'central-bank' });
    expect(s.status).toBe(200);
    const st = await api().get('/api/currency-rates/status');
    expect(st.body.provider).toMatchObject({ basis: 'central-bank', mode: 'auto', refreshEvery: 'every 6 hours' });
    expect(st.body.provider.note).toMatch(/central-bank reference rates/);
    expect((await api().put('/api/currency-rates/settings').send({ rateBasis: 'mid-market' })).status).toBe(200);
    expect((await api().get('/api/currency-rates/status')).body.provider.basis).toBe('mid-market');
  });

  it('lets FX_RATES_PROVIDER fix the provider on the server', async () => {
    withKey();
    process.env.FX_RATES_PROVIDER = 'frankfurter';
    try {
      const st = await api().get('/api/currency-rates/status');
      expect(st.body.provider).toMatchObject({ basis: 'central-bank', basisFromEnv: true, mode: 'frankfurter' });
      expect((await api().put('/api/currency-rates/settings').send({ rateBasis: 'mid-market' })).status).toBe(400);
    } finally {
      delete process.env.FX_RATES_PROVIDER;
    }
  });
});
