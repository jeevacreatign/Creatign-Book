// Live exchange rates. Rates are fetched on the server (never from the browser) and saved in each
// currency's dated rate history. A refresh only changes the default rate offered to new transactions:
// every saved transaction keeps the rate it was recorded with.
//
// FX_RATES_PROVIDER=auto (default) layers three sources, best first, and records which one set each rate:
//   1. European Central Bank reference rates through Frankfurter (https://frankfurter.dev): no API key,
//      once a working day at about 16:00 CET, about 30 currencies.
//   2. Official central-bank pegs (AED, SAR, QAR, OMR, BHD, JOD, XOF, XAF ...): the fixed parity set by the
//      issuing central bank, applied to the ECB's USD or EUR rate.
//   3. ExchangeRate-API open access (https://www.exchangerate-api.com/docs/free): no API key, once a day,
//      about 160 currencies, for whatever the first two do not cover. Its terms ask for attribution,
//      shown in Settings > Currencies.
// Other values: frankfurter (ECB and pegs only), exchangerate-api (that source only),
// openexchangerates (needs OPENEXCHANGERATES_APP_ID; hourly, about 170 currencies).
// FX_RATES_URL overrides the ECB/Frankfurter or Open Exchange Rates address; FX_FALLBACK_URL the
// ExchangeRate-API one (for a self-hosted mirror or a test stand-in).
import { BASE_CURRENCY, DEFAULT_STALE_DAYS, rateOn, roundRate } from '../shared/currency';
import { today } from '../shared/format';
import type { Currency, Database } from '../shared/types';
import { flushDb, getDb, now } from './db';
import { commit } from './services';

/** One rate source, as shown in Settings > Currencies. */
export interface SourceInfo {
  id: 'ecb' | 'pegs' | 'exchangerate-api' | 'openexchangerates';
  name: string;
  website: string;
  apiKeyRequired: boolean;
  apiKeyConfigured: boolean;
  updates: string;
  rateType: string;
  /** credit line the source's terms ask for */
  attribution?: { text: string; url: string };
}

export interface ProviderInfo {
  mode: 'auto' | 'frankfurter' | 'exchangerate-api' | 'openexchangerates';
  name: string;
  /** sources in the order they are tried; a currency takes its rate from the first that quotes it */
  sources: SourceInfo[];
  apiKeyRequired: boolean;
  apiKeyConfigured: boolean;
}

export interface SourceRun {
  source: string;
  ok: boolean;
  rateDate?: string;
  /** currencies this source set */
  count: number;
  error?: string;
}

export interface RefreshResult {
  ok: boolean;
  provider: string;
  /** the date of the main source's rates */
  rateDate?: string;
  fetchedAt: string;
  updated: { code: string; previousRate: number; rate: number; date: string; source?: string }[];
  /** currencies no source quotes */
  unsupported: string[];
  /** currencies whose default rate stays a later manual entry */
  keptManual: { code: string; date: string; rate: number }[];
  sources?: SourceRun[];
  /** why nothing could be fetched, or the errors of the sources that failed */
  error?: string;
  trigger: 'manual' | 'automatic';
}

export interface FxRateSettings {
  autoRefresh: boolean;
  lastRun?: RefreshResult;
  lastSuccessAt?: string;
}

const env = (k: string) => process.env[k]?.trim() || undefined;
export const staleDays = () => Number(env('FX_RATES_STALE_DAYS')) || DEFAULT_STALE_DAYS;

/**
 * Fixed parities set by the issuing central bank: units of the currency per 1 USD or 1 EUR. Applied to
 * the ECB's own USD and EUR rates, so these stay central-bank rates end to end.
 */
export const CENTRAL_BANK_PEGS: Record<string, { anchor: 'USD' | 'EUR'; perAnchor: number; bank: string }> = {
  AED: { anchor: 'USD', perAnchor: 3.6725, bank: 'Central Bank of the UAE' },
  SAR: { anchor: 'USD', perAnchor: 3.75, bank: 'Saudi Central Bank' },
  QAR: { anchor: 'USD', perAnchor: 3.64, bank: 'Qatar Central Bank' },
  OMR: { anchor: 'USD', perAnchor: 0.3845, bank: 'Central Bank of Oman' },
  BHD: { anchor: 'USD', perAnchor: 0.376, bank: 'Central Bank of Bahrain' },
  JOD: { anchor: 'USD', perAnchor: 0.709, bank: 'Central Bank of Jordan' },
  BSD: { anchor: 'USD', perAnchor: 1, bank: 'Central Bank of The Bahamas' },
  BMD: { anchor: 'USD', perAnchor: 1, bank: 'Bermuda Monetary Authority' },
  PAB: { anchor: 'USD', perAnchor: 1, bank: 'Republic of Panama' },
  BZD: { anchor: 'USD', perAnchor: 2, bank: 'Central Bank of Belize' },
  BBD: { anchor: 'USD', perAnchor: 2, bank: 'Central Bank of Barbados' },
  XCD: { anchor: 'USD', perAnchor: 2.7, bank: 'Eastern Caribbean Central Bank' },
  DJF: { anchor: 'USD', perAnchor: 177.721, bank: 'Central Bank of Djibouti' },
  AWG: { anchor: 'USD', perAnchor: 1.79, bank: 'Central Bank of Aruba' },
  XOF: { anchor: 'EUR', perAnchor: 655.957, bank: 'BCEAO (West African CFA franc)' },
  XAF: { anchor: 'EUR', perAnchor: 655.957, bank: 'BEAC (Central African CFA franc)' },
  KMF: { anchor: 'EUR', perAnchor: 491.96775, bank: 'Central Bank of the Comoros' },
  CVE: { anchor: 'EUR', perAnchor: 110.265, bank: 'Bank of Cape Verde' },
  BAM: { anchor: 'EUR', perAnchor: 1.95583, bank: 'Central Bank of Bosnia and Herzegovina' },
  XPF: { anchor: 'EUR', perAnchor: 119.331742, bank: 'IEOM (CFP franc)' },
};

const ECB: SourceInfo = {
  id: 'ecb',
  name: 'European Central Bank',
  website: 'https://frankfurter.dev',
  apiKeyRequired: false,
  apiKeyConfigured: false,
  updates: 'Once a working day, about 16:00 CET (20:30 IST); none on weekends and TARGET holidays',
  rateType: 'ECB euro foreign exchange reference rates (indicative mid rates) for about 30 currencies, through the Frankfurter API',
};
const PEGS: SourceInfo = {
  id: 'pegs',
  name: 'Central bank peg',
  website: 'https://www.imf.org/en/Publications/Annual-Report-on-Exchange-Arrangements-and-Exchange-Restrictions',
  apiKeyRequired: false,
  apiKeyConfigured: false,
  updates: 'With every ECB update',
  rateType: `Official fixed parities (${Object.keys(CENTRAL_BANK_PEGS).join(', ')}) applied to the ECB's USD and EUR rates`,
};
const ERAPI: SourceInfo = {
  id: 'exchangerate-api',
  name: 'ExchangeRate-API',
  website: 'https://www.exchangerate-api.com/docs/free',
  apiKeyRequired: false,
  apiKeyConfigured: false,
  updates: 'Once a day',
  rateType: 'Daily mid rates for about 160 currencies, aggregated from central banks and other providers; used only for currencies the sources above do not quote',
  attribution: { text: 'Rates By Exchange Rate API', url: 'https://www.exchangerate-api.com' },
};
const OXR: SourceInfo = {
  id: 'openexchangerates',
  name: 'Open Exchange Rates',
  website: 'https://openexchangerates.org',
  apiKeyRequired: true,
  apiKeyConfigured: false,
  updates: 'Hourly (depends on your plan)',
  rateType: 'Market mid rates blended from several sources, about 170 currencies',
};

export function providerInfo(): ProviderInfo {
  const mode = env('FX_RATES_PROVIDER');
  if (mode === 'openexchangerates') {
    const set = !!env('OPENEXCHANGERATES_APP_ID');
    return { mode, name: OXR.name, sources: [{ ...OXR, apiKeyConfigured: set }], apiKeyRequired: true, apiKeyConfigured: set };
  }
  if (mode === 'frankfurter') return { mode, name: 'European Central Bank and central bank pegs', sources: [ECB, PEGS], apiKeyRequired: false, apiKeyConfigured: false };
  if (mode === 'exchangerate-api') return { mode, name: ERAPI.name, sources: [ERAPI], apiKeyRequired: false, apiKeyConfigured: false };
  return { mode: 'auto', name: 'European Central Bank, central bank pegs and ExchangeRate-API', sources: [ECB, PEGS, ERAPI], apiKeyRequired: false, apiKeyConfigured: false };
}

export function fxRateSettings(db: Database): FxRateSettings {
  const s = (db.preferences.fxRates ?? {}) as Partial<FxRateSettings>;
  return { autoRefresh: s.autoRefresh !== false, lastRun: s.lastRun, lastSuccessAt: s.lastSuccessAt };
}

const TIMEOUT_MS = 15_000;

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    const why = e instanceof Error && e.name === 'TimeoutError' ? 'it did not answer within 15 seconds' : e instanceof Error ? e.message : String(e);
    throw new Error(`Could not reach the rate provider: ${why}`);
  }
  if (!res.ok) throw new Error(`The rate provider answered ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);
  try {
    return await res.json();
  } catch {
    throw new Error('The rate provider sent a response that is not valid JSON');
  }
}

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const goodNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const unixDate = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

/** A quote: INR per 1 unit, the rate's date and the source that set it. */
export interface Quote {
  rate: number;
  date: string;
  source: string;
}
type Quotes = Map<string, Quote>;

/** INR per unit from rates quoted as units per 1 unit of a base (base's INR rate / currency's rate). */
function cross(rates: Record<string, unknown>, date: string, source: string, out: Quotes) {
  const inrPerBase = rates.INR as number;
  for (const [code, v] of Object.entries(rates)) if (code !== 'INR' && goodNum(v) && !out.has(code)) out.set(code, { rate: roundRate(inrPerBase / v), date, source });
}

async function fetchEcb(): Promise<Quotes> {
  const base = (env('FX_RATES_URL') || 'https://api.frankfurter.dev/v1').replace(/\/+$/, '');
  // EUR is the ECB's own base, so cross rates through it keep the published precision
  const body = (await getJson(`${base}/latest?base=EUR`)) as { base?: string; date?: unknown; rates?: Record<string, unknown> };
  const r = body?.rates;
  if (!r || body.base !== 'EUR' || !isDate(body.date)) throw new Error('The rate provider sent an unexpected response');
  if (!goodNum(r.INR)) throw new Error('The rate provider response has no INR rate');
  const out: Quotes = new Map([['EUR', { rate: roundRate(r.INR as number), date: body.date, source: ECB.name }]]);
  cross(r, body.date, ECB.name, out);
  return out;
}

/** Pegged currencies from the ECB's anchor rates. */
function pegQuotes(ecb: Quotes): Quotes {
  const out: Quotes = new Map();
  for (const [code, p] of Object.entries(CENTRAL_BANK_PEGS)) {
    const anchor = ecb.get(p.anchor);
    if (!anchor || ecb.has(code)) continue;
    out.set(code, { rate: roundRate(anchor.rate / p.perAnchor), date: anchor.date, source: `${PEGS.name}: ${p.bank}, 1 ${p.anchor} = ${p.perAnchor} ${code}` });
  }
  return out;
}

async function fetchErApi(): Promise<Quotes> {
  const base = (env('FX_FALLBACK_URL') || 'https://open.er-api.com/v6').replace(/\/+$/, '');
  const body = (await getJson(`${base}/latest/USD`)) as { result?: string; time_last_update_unix?: unknown; rates?: Record<string, unknown>; ['error-type']?: string };
  if (body?.result !== 'success') throw new Error(`The rate provider reported an error${body?.['error-type'] ? `: ${body['error-type']}` : ''}`);
  const r = body.rates;
  if (!r || !goodNum(r.INR) || !goodNum(body.time_last_update_unix)) throw new Error('The rate provider response has no INR rate');
  const out: Quotes = new Map();
  cross(r, unixDate(body.time_last_update_unix), ERAPI.name, out);
  return out;
}

async function fetchOxr(): Promise<Quotes> {
  const appId = env('OPENEXCHANGERATES_APP_ID');
  if (!appId) throw new Error('OPENEXCHANGERATES_APP_ID is not set in the server environment');
  const base = (env('FX_RATES_URL') || 'https://openexchangerates.org/api').replace(/\/+$/, '');
  // the App ID travels in a header, never in the logged URL
  const body = (await getJson(`${base}/latest.json`, { Authorization: `Token ${appId}` })) as { timestamp?: number; rates?: Record<string, unknown> };
  const r = body?.rates;
  if (!r || !goodNum(r.INR) || !goodNum(body.timestamp)) throw new Error('The rate provider response has no INR rate');
  const out: Quotes = new Map();
  cross(r, unixDate(body.timestamp), OXR.name, out);
  return out;
}

/**
 * Quotes for the wanted currencies from each source in turn. A later source is asked only for what the
 * earlier ones did not quote, and a source that fails is reported without stopping the others.
 */
export async function fetchQuotes(wanted: string[]): Promise<{ quotes: Quotes; runs: SourceRun[] }> {
  const info = providerInfo();
  const quotes: Quotes = new Map();
  const runs: SourceRun[] = [];
  const missing = () => wanted.filter((c) => !quotes.has(c));
  const take = (from: Quotes, run: SourceRun) => {
    for (const c of missing()) {
      const q = from.get(c);
      if (q) {
        quotes.set(c, q);
        run.count++;
      }
    }
    run.rateDate = [...from.values()][0]?.date;
  };
  const attempt = async (name: string, load: () => Promise<Quotes>) => {
    const run: SourceRun = { source: name, ok: false, count: 0 };
    runs.push(run);
    try {
      const got = await load();
      run.ok = true;
      take(got, run);
      return got;
    } catch (e) {
      run.error = e instanceof Error ? e.message : String(e);
      return undefined;
    }
  };
  if (info.mode === 'openexchangerates') {
    await attempt(OXR.name, fetchOxr);
    return { quotes, runs };
  }
  if (info.mode !== 'exchangerate-api') {
    const ecb = await attempt(ECB.name, fetchEcb);
    if (ecb && missing().length) {
      const run: SourceRun = { source: PEGS.name, ok: true, count: 0 };
      runs.push(run);
      take(pegQuotes(ecb), run);
    }
  }
  if (info.mode !== 'frankfurter' && missing().length) await attempt(ERAPI.name, fetchErApi);
  return { quotes, runs };
}

/** The latest rate for one currency, for a currency added without a rate. */
export async function quoteFor(code: string): Promise<Quote> {
  const { quotes, runs } = await fetchQuotes([code]);
  const q = quotes.get(code);
  if (q) return q;
  const errors = runs.filter((r) => r.error).map((r) => `${r.source}: ${r.error}`);
  throw new Error(errors.length ? `Could not fetch a rate for ${code} (${errors.join('; ')}). Enter the rate by hand.` : `No rate source quotes ${code}. Enter the rate by hand.`);
}

/**
 * Fetch the latest rates and save one dated, "fetched" history entry per configured currency. Saved
 * transactions are never touched. When every source fails nothing changes and the error is returned.
 */
export async function refreshRates(trigger: RefreshResult['trigger'] = 'manual'): Promise<RefreshResult> {
  const info = providerInfo();
  const fetchedAt = now();
  const result: RefreshResult = { ok: false, provider: info.name, fetchedAt, updated: [], unsupported: [], keptManual: [], trigger };
  const wanted = getDb()
    .currencies.filter((x) => x.code !== BASE_CURRENCY)
    .map((c) => c.code);
  const { quotes, runs } = await fetchQuotes(wanted);
  result.sources = runs;
  result.ok = runs.some((r) => r.ok);
  result.rateDate = runs.find((r) => r.ok)?.rateDate;
  const errors = runs.filter((r) => r.error).map((r) => (runs.length > 1 ? `${r.source}: ${r.error}` : r.error!));
  if (errors.length) result.error = errors.join('; ');
  // the database may have been replaced while waiting for the provider
  const db = getDb();
  if (result.ok) {
    const day = today();
    for (const c of db.currencies.filter((x) => x.code !== BASE_CURRENCY)) {
      const q = quotes.get(c.code);
      if (!q) {
        result.unsupported.push(c.code);
        continue;
      }
      applyFetchedRate(c, q, fetchedAt, day, result);
    }
  }
  const prev = fxRateSettings(db);
  db.preferences.fxRates = { ...prev, lastRun: result, lastSuccessAt: result.ok ? fetchedAt : prev.lastSuccessAt } satisfies FxRateSettings;
  commit();
  await flushDb();
  return result;
}

/** Save a fetched rate in the currency's history (same-date entries are replaced). */
export function applyFetchedRate(c: Currency, quote: Quote, recordedAt: string, day: string, result?: RefreshResult) {
  // a source a time zone ahead can date its rates tomorrow: they apply from today
  const q = quote.date > day ? { ...quote, date: day } : quote;
  const previousRate = rateOn(c, day);
  c.history = (c.history ?? []).filter((h) => h.date !== q.date);
  c.history.push({ date: q.date, rate: q.rate, source: 'fetched', provider: q.source, recordedAt });
  // the default for new transactions is the latest dated rate on or before today
  c.rate = rateOn(c, day);
  const later = c.history.filter((h) => h.date > q.date && h.date <= day).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (later) result?.keptManual.push({ code: c.code, date: later.date, rate: later.rate });
  else result?.updated.push({ code: c.code, previousRate, rate: q.rate, date: q.date, source: q.source });
}

export function saveFxRateSettings(body: { autoRefresh?: unknown }): FxRateSettings {
  const db = getDb();
  const cur = fxRateSettings(db);
  const next: FxRateSettings = { ...cur, autoRefresh: body.autoRefresh === undefined ? cur.autoRefresh : body.autoRefresh === true };
  db.preferences.fxRates = next;
  return next;
}

let timer: ReturnType<typeof setInterval> | undefined;

/**
 * Refresh rates soon after start and then every 6 hours, when automatic refresh is on in
 * Settings > Currencies and there are foreign currencies. Turn off for the server with FX_AUTO_REFRESH=0.
 */
export function startRateSchedule(everyMs = 6 * 60 * 60 * 1000) {
  if (timer) return;
  const tick = () => {
    const db = getDb();
    if (!fxRateSettings(db).autoRefresh || !db.currencies.some((c) => c.code !== BASE_CURRENCY)) return;
    refreshRates('automatic')
      .then((r) => !r.ok && console.error('[fx-rates]', r.error))
      .catch((e) => console.error('[fx-rates]', e));
  };
  setTimeout(tick, 30_000).unref?.();
  timer = setInterval(tick, everyMs);
  timer.unref?.();
}
