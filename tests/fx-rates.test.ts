// Live exchange rates: refresh from the rate sources (stubbed here, no network): ECB first, central-bank
// pegs, then the worldwide fallback; failures, currencies no source quotes, stale rates, and that a
// refresh only changes the default for new documents.
// All records are clearly named test data.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { addDays, today } from '../shared/format';

process.env.DB_FILE = ':memory:';
process.env.UPLOAD_DIR = '/tmp/creatign-ledger-test-uploads';
delete process.env.FX_RATES_PROVIDER;
delete process.env.FX_RATES_URL;
delete process.env.FX_FALLBACK_URL;

let app: Express;
const api = () => request(app);
const inr = (amount: number, rate: number) => Math.floor((Math.round(amount * 100) * Math.round(rate * 1e6) + 500000) / 1e6) / 100;
const DAY = today();

/** A Frankfurter-shaped answer: units per 1 EUR (EUR 1 = INR 101.92, USD 1.0512 ...). AED is not quoted (it comes from its central-bank peg). */
const ecb = (date = DAY, inrPerEur = 101.92) => ({ amount: 1, base: 'EUR', date, rates: { INR: inrPerEur, USD: 1.0512, GBP: 0.8341, JPY: 161.2, SGD: 1.4021 } });
/** An ExchangeRate-API-shaped answer: units per 1 USD. KWD is only here; KPW is quoted nowhere. */
const erapi = (inrPerUsd = 96.95) => ({ result: 'success', base_code: 'USD', time_last_update_unix: Math.floor(Date.parse(`${DAY}T00:02:31Z`) / 1000), rates: { USD: 1, INR: inrPerUsd, KWD: 0.3071, EUR: 0.95, AED: 3.6725 } });
const ECB_URL = 'https://api.frankfurter.dev/v1/latest?base=EUR';
const ER_URL = 'https://open.er-api.com/v6/latest/USD';
const stubFetch = (impl: (url: string) => Promise<Response> | Response) => {
  const fn = vi.fn(async (url: string | URL) => impl(String(url)));
  vi.stubGlobal('fetch', fn);
  return fn;
};
const both = (ecbBody: unknown = ecb(), erBody: unknown = erapi()) => (url: string) => (url === ECB_URL ? json(ecbBody) : url === ER_URL ? json(erBody) : json({}, 404));
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
  it('takes ECB rates first, central-bank pegs next and the worldwide fallback last', async () => {
    // KWD (fallback only) and KPW (no source) are added by hand first
    expect((await api().post('/api/currencies').send({ code: 'KWD', rate: 300, date: OLD_DATE })).status).toBe(200);
    expect((await api().post('/api/currencies').send({ code: 'KPW', rate: 0.1, date: OLD_DATE })).status).toBe(200);
    const f = stubFetch(both());
    const r = await api().post('/api/currency-rates/refresh');
    expect(r.status).toBe(200);
    expect(f.mock.calls.map((c) => String(c[0]))).toEqual([ECB_URL, ER_URL]);
    expect(r.body).toMatchObject({ ok: true, rateDate: DAY });
    expect(r.body.error).toBeUndefined();
    const by = (code: string) => r.body.updated.find((u: { code: string }) => u.code === code);
    expect(by('EUR')).toMatchObject({ previousRate: 89.2, rate: 101.92, date: DAY, source: 'European Central Bank' });
    // cross rates through EUR: INR per USD = 101.92 / 1.0512
    const usd = Math.round((101.92 / 1.0512) * 1e6) / 1e6;
    expect(by('USD')).toMatchObject({ rate: usd, source: 'European Central Bank' });
    // AED: the UAE central bank's fixed 3.6725 per USD on the ECB's USD rate, not the fallback's figure
    expect(by('AED').rate).toBe(Math.round((usd / 3.6725) * 1e6) / 1e6);
    expect(by('AED').source).toBe('Central bank peg: Central Bank of the UAE, 1 USD = 3.6725 AED');
    // KWD: only the worldwide fallback quotes it
    expect(by('KWD')).toMatchObject({ rate: Math.round((96.95 / 0.3071) * 1e6) / 1e6, source: 'ExchangeRate-API' });
    expect(r.body.unsupported).toEqual(['KPW']);
    expect(r.body.sources).toEqual([
      expect.objectContaining({ source: 'European Central Bank', ok: true, rateDate: DAY }),
      expect.objectContaining({ source: 'Central bank peg', ok: true, count: 1 }),
      expect.objectContaining({ source: 'ExchangeRate-API', ok: true, count: 1 }),
    ]);

    const eur = await currency('EUR');
    expect(eur.rate).toBe(101.92);
    expect(eur.status).toMatchObject({ source: 'fetched', stale: false, date: DAY, provider: 'European Central Bank' });
    expect(eur.history.find((h) => h.date === DAY)).toMatchObject({ rate: 101.92, source: 'fetched' });
    expect(eur.history.find((h) => h.date === OLD_DATE)).toMatchObject({ rate: 89.2, source: 'manual' });
    expect((await currency('AED')).status).toMatchObject({ source: 'fetched', stale: false });
    // KPW was not quoted: unchanged, still its old manual rate and flagged stale
    expect((await currency('KPW')).status).toMatchObject({ source: 'manual', stale: true });
    const st = await api().get('/api/currency-rates/status');
    expect(st.body.lastRun).toMatchObject({ ok: true, rateDate: DAY });
    expect(st.body.provider).toMatchObject({ mode: 'auto', apiKeyRequired: false });
    expect(st.body.provider.sources.map((x: { id: string }) => x.id)).toEqual(['own', 'pegs', 'ecb', 'exchangerate-api']);
  });

  it('skips the fallback when the ECB and pegs cover every currency', async () => {
    await api().delete('/api/currencies/KWD');
    await api().delete('/api/currencies/KPW');
    const f = stubFetch(both());
    const r = await api().post('/api/currency-rates/refresh');
    expect(r.body.ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    expect(r.body.unsupported).toEqual([]);
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
    stubFetch(both(ecb(yesterday, 100.5)));
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

  it('fetches the rate of a currency added without one', async () => {
    stubFetch(both());
    const r = await api().post('/api/currencies').send({ code: 'KWD' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ code: 'KWD', rate: Math.round((96.95 / 0.3071) * 1e6) / 1e6 });
    expect(r.body.history[0]).toMatchObject({ source: 'fetched', provider: 'ExchangeRate-API', date: DAY });
    const peg = await api().post('/api/currencies').send({ code: 'SAR' });
    expect(peg.body.history[0].provider).toBe('Central bank peg: Saudi Central Bank, 1 USD = 3.75 SAR');
    const none = await api().post('/api/currencies').send({ code: 'KPW' });
    expect(none.status).toBe(400);
    expect(none.body.error).toBe('No rate source quotes KPW. Enter the rate by hand.');
    expect((await currency('KPW'))).toBeUndefined();
    await api().delete('/api/currencies/KWD');
    await api().delete('/api/currencies/SAR');
  });
});

describe("each currency's own central bank", () => {
  const BOC = 'https://www.bankofcanada.ca/valet/observations/FXINRCAD/json?recent=1';
  const NORGES = 'https://data.norges-bank.no/api/data/EXR/B.INR.NOK.SP?format=csv&lastNObservations=1&locale=en&bom=exclude';
  const CNB = 'https://www.cnb.cz/en/financial-markets/foreign-exchange-market/central-bank-exchange-rate-fixing/central-bank-exchange-rate-fixing/daily.txt';
  const ymd = DAY.split('-');
  const cnbDate = `${Number(ymd[2])} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(ymd[1]) - 1]} ${ymd[0]}`;
  const ecbWithOwn = { amount: 1, base: 'EUR', date: DAY, rates: { INR: 101.92, USD: 1.0512, GBP: 0.8341, JPY: 161.2, SGD: 1.4021, CAD: 1.4703, NOK: 11.71, CZK: 24.28 } };
  const banks = (fail: string[] = []) => (url: string) => {
    if (fail.includes(url)) return json({ message: 'down' }, 503);
    if (url === ECB_URL) return json(ecbWithOwn);
    if (url === ER_URL) return json(erapi());
    if (url === BOC) return json({ terms: {}, seriesDetail: { FXINRCAD: { label: 'INR/CAD' } }, observations: [{ d: DAY, FXINRCAD: { v: '0.01443' } }] });
    if (url === NORGES)
      return new Response(`FREQ;Frequency;BASE_CUR;Base Currency;QUOTE_CUR;Quote Currency;TENOR;Tenor;DECIMALS;CALCULATED;UNIT_MULT;Unit Multiplier;COLLECTION;Collection Indicator;TIME_PERIOD;OBS_VALUE\nB;Business;INR;Indian rupee;NOK;Norwegian krone;SP;Spot;4;false;2;Hundreds;C;ECB concertation time 14:15 CET;${DAY};11.4892\n`, { status: 200 });
    if (url === CNB) return new Response(`${cnbDate} #231\nCountry|Currency|Amount|Code|Rate\nAustralia|dollar|1|AUD|15.021\nIndia|rupee|100|INR|23.822\nUSA|dollar|1|USD|23.084\n`, { status: 200 });
    return json({}, 404);
  };

  it('takes CAD, NOK and CZK from their own central banks and EUR from the ECB', async () => {
    for (const code of ['CAD', 'NOK', 'CZK']) expect((await api().post('/api/currencies').send({ code, rate: 1, date: OLD_DATE })).status).toBe(200);
    const f = stubFetch(banks());
    const r = await api().post('/api/currency-rates/refresh');
    expect(r.body.ok).toBe(true);
    expect(r.body.error).toBeUndefined();
    const urls = f.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual(expect.arrayContaining([BOC, NORGES, CNB, ECB_URL]));
    expect(urls).not.toContain(ER_URL);
    const by = (code: string) => r.body.updated.find((u: { code: string }) => u.code === code);
    expect(by('CAD')).toMatchObject({ rate: Math.round((1 / 0.01443) * 1e6) / 1e6, source: 'Bank of Canada', date: DAY });
    expect(by('NOK')).toMatchObject({ rate: Math.round((100 / 11.4892) * 1e6) / 1e6, source: 'Norges Bank', date: DAY });
    expect(by('CZK')).toMatchObject({ rate: Math.round((100 / 23.822) * 1e6) / 1e6, source: 'Czech National Bank', date: DAY });
    expect(by('EUR')).toMatchObject({ rate: 101.92, source: 'European Central Bank' });
    expect(by('AED').source).toMatch(/^Central bank peg: Central Bank of the UAE/);
    expect((await currency('CAD')).status.provider).toBe('Bank of Canada');
  });

  it("falls back to the ECB rate when a currency's own central bank is down, and says so", async () => {
    stubFetch(banks([BOC]));
    const r = await api().post('/api/currency-rates/refresh');
    expect(r.body.ok).toBe(true);
    expect(r.body.error).toMatch(/Bank of Canada: The rate provider answered 503; the ECB rate is used for CAD/);
    expect(r.body.updated.find((u: { code: string }) => u.code === 'CAD')).toMatchObject({ source: 'European Central Bank', rate: Math.round((101.92 / 1.4703) * 1e6) / 1e6 });
    // a malformed answer is an error too
    stubFetch((url) => (url === CNB ? new Response('nothing useful', { status: 200 }) : banks()(url)));
    const r2 = await api().post('/api/currency-rates/refresh');
    expect(r2.body.error).toMatch(/Czech National Bank: The rate provider sent an unexpected response/);
    expect(r2.body.updated.find((u: { code: string }) => u.code === 'CZK').source).toBe('European Central Bank');
    for (const code of ['CAD', 'NOK', 'CZK']) await api().delete(`/api/currencies/${code}`);
  });
});

describe('provider failures', () => {
  it('reports an outage of every source and changes nothing', async () => {
    const before = await currency('EUR');
    stubFetch(() => json({ message: 'unavailable' }, 503));
    const r = await api().post('/api/currency-rates/refresh');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: false, updated: [] });
    expect(r.body.error).toMatch(/European Central Bank: The rate provider answered 503/);
    expect(r.body.error).toMatch(/ExchangeRate-API: The rate provider answered 503/);
    const after = await currency('EUR');
    expect(after.rate).toBe(before.rate);
    expect(after.history).toEqual(before.history);
    const st = await api().get('/api/currency-rates/status');
    expect(st.body.lastRun).toMatchObject({ ok: false });
    expect(st.body.lastSuccessAt).toBeTruthy();
  });

  it('falls back to the worldwide source when the ECB is down, and says so', async () => {
    stubFetch((url) => (url === ECB_URL ? json({}, 500) : json(erapi(97.1))));
    const r = await api().post('/api/currency-rates/refresh');
    expect(r.body.ok).toBe(true);
    expect(r.body.error).toMatch(/European Central Bank: The rate provider answered 500/);
    expect(r.body.updated.find((u: { code: string }) => u.code === 'EUR')).toMatchObject({ source: 'ExchangeRate-API', rate: Math.round((97.1 / 0.95) * 1e6) / 1e6 });
    expect((await currency('EUR')).status.provider).toBe('ExchangeRate-API');
    // put the ECB rate back for the tests below
    stubFetch(both());
    await api().post('/api/currency-rates/refresh');
  });

  it('reports a network error and a malformed response', async () => {
    stubFetch(() => Promise.reject(new TypeError('fetch failed')));
    const r = await api().post('/api/currency-rates/refresh');
    expect(r.body).toMatchObject({ ok: false });
    expect(r.body.error).toMatch(/Could not reach the rate provider: fetch failed/);
    stubFetch(both({ base: 'EUR', date: DAY, rates: { USD: 1.05 } }, { result: 'error', 'error-type': 'unsupported-code' }));
    const r2 = await api().post('/api/currency-rates/refresh');
    expect(r2.body.ok).toBe(false);
    expect(r2.body.error).toMatch(/European Central Bank: The rate provider response has no INR rate/);
    expect(r2.body.error).toMatch(/ExchangeRate-API: The rate provider reported an error: unsupported-code/);
    stubFetch(both({ base: 'EUR', date: DAY, rates: { INR: -4 } }, { result: 'success', rates: { INR: 'x' } }));
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
