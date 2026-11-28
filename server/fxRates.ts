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
import { addDays, today } from '../shared/format';
import type { Currency, Database } from '../shared/types';
import { flushDb, getDb, now } from './db';
import { commit } from './services';

/** One rate source, as shown in Settings > Currencies. */
export interface SourceInfo {
  id: 'own' | 'ecb' | 'pegs' | 'exchangerate-api' | 'openexchangerates';
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
  rateType: 'ECB euro reference rates (indicative mid rates), through the Frankfurter API: EUR, and about 30 other currencies whose own central bank has no free daily API (USD, JPY, SGD, CHF, HKD ...)',
};
const OWN_BASE: SourceInfo = {
  id: 'own',
  name: 'Own central bank',
  website: 'https://www.bankofcanada.ca/valet/docs',
  apiKeyRequired: false,
  apiKeyConfigured: false,
  updates: 'Each bank publishes once a working day',
  rateType: 'The currency\'s own central bank, where it publishes its rate against INR through a free, documented feed: EUR from the European Central Bank, GBP from the Bank of England, AUD from the Reserve Bank of Australia, CAD from the Bank of Canada, NOK from Norges Bank, CZK from the Czech National Bank. A rate more than 5% away from the ECB rate, or older than the stale limit, is not used',
};
const PEGS: SourceInfo = {
  id: 'pegs',
  name: 'Central bank peg',
  website: 'https://www.imf.org/en/Publications/Annual-Report-on-Exchange-Arrangements-and-Exchange-Restrictions',
  apiKeyRequired: false,
  apiKeyConfigured: false,
  updates: 'With every ECB update',
  rateType: `The issuing central bank's official fixed rate (${Object.keys(CENTRAL_BANK_PEGS).join(', ')}) applied to the ECB's USD or EUR rate`,
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
  const fred = !!env('FRED_API_KEY');
  const OWN: SourceInfo = {
    ...OWN_BASE,
    apiKeyRequired: true,
    apiKeyConfigured: fred,
    rateType: `${OWN_BASE.rateType}. USD from the Federal Reserve (weekly, through FRED): ${fred ? 'FRED API key set on the server' : 'needs a free FRED API key in FRED_API_KEY on the server; until then USD uses the ECB rate'}`,
  };
  if (mode === 'openexchangerates') {
    const set = !!env('OPENEXCHANGERATES_APP_ID');
    return { mode, name: OXR.name, sources: [{ ...OXR, apiKeyConfigured: set }], apiKeyRequired: true, apiKeyConfigured: set };
  }
  if (mode === 'frankfurter') return { mode, name: 'Central banks', sources: [OWN, PEGS, ECB], apiKeyRequired: false, apiKeyConfigured: false };
  if (mode === 'exchangerate-api') return { mode, name: ERAPI.name, sources: [ERAPI], apiKeyRequired: false, apiKeyConfigured: false };
  return { mode: 'auto', name: 'Central banks, then ExchangeRate-API', sources: [OWN, PEGS, ECB, ERAPI], apiKeyRequired: false, apiKeyConfigured: false };
}

export function fxRateSettings(db: Database): FxRateSettings {
  const s = (db.preferences.fxRates ?? {}) as Partial<FxRateSettings>;
  return { autoRefresh: s.autoRefresh !== false, lastRun: s.lastRun, lastSuccessAt: s.lastSuccessAt };
}

const TIMEOUT_MS = 15_000;
/** A plain client name; some statistics sites refuse requests without one. */
const UA = 'CreatignLedger/1.0 (exchange-rate refresh)';

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
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

async function getText(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'text/csv, text/plain, */*', 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    const why = e instanceof Error && e.name === 'TimeoutError' ? 'it did not answer within 15 seconds' : e instanceof Error ? e.message : String(e);
    throw new Error(`Could not reach the rate provider: ${why}`);
  }
  if (!res.ok) throw new Error(`The rate provider answered ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);
  return res.text();
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

// ---------------------------------------------------------------- each currency's own central bank
// Central banks that publish their own currency's rate against INR through a free, documented feed.
// Each is asked only for its own currency; if it fails, the ECB rate is used and the failure is shown.

/** Bank of Canada Valet API: FXINRCAD is CAD per 1 INR. https://www.bankofcanada.ca/valet/docs */
async function fetchBankOfCanada(): Promise<Quote> {
  const url = env('FX_URL_BOC') || 'https://www.bankofcanada.ca/valet/observations/FXINRCAD/json?recent=1';
  const body = (await getJson(url)) as { observations?: { d?: unknown; FXINRCAD?: { v?: unknown } }[] };
  const o = body?.observations?.[body.observations.length - 1];
  const v = Number(o?.FXINRCAD?.v);
  if (!o || !isDate(o.d) || !goodNum(v)) throw new Error('The rate provider sent an unexpected response');
  return { rate: roundRate(1 / v), date: o.d, source: 'Bank of Canada' };
}

/** Norges Bank SDMX API (CSV): NOK per 100 INR. https://www.norges-bank.no/en/topics/Statistics/open-data/ */
async function fetchNorgesBank(): Promise<Quote> {
  const url = env('FX_URL_NORGES') || 'https://data.norges-bank.no/api/data/EXR/B.INR.NOK.SP?format=csv&lastNObservations=1&locale=en&bom=exclude';
  const text = (await getText(url)).trim();
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('The rate provider sent an unexpected response');
  const sep = lines[0].includes(';') ? ';' : ',';
  const cols = lines[0].split(sep).map((c) => c.replace(/"/g, '').trim());
  const row = lines[lines.length - 1].split(sep).map((c) => c.replace(/"/g, '').trim());
  const at = (k: string) => row[cols.indexOf(k)];
  const date = at('TIME_PERIOD');
  const value = Number(at('OBS_VALUE'));
  const mult = Number(at('UNIT_MULT') ?? 0) || 0;
  if (!isDate(date) || !goodNum(value)) throw new Error('The rate provider sent an unexpected response');
  // value NOK = 10^mult INR
  return { rate: roundRate(10 ** mult / value), date, source: 'Norges Bank' };
}

const MONTHS: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
/** Czech National Bank daily fixing (text): "India|rupee|100|INR|23.456" is CZK per 100 INR. */
async function fetchCzechNationalBank(): Promise<Quote> {
  const url = env('FX_URL_CNB') || 'https://www.cnb.cz/en/financial-markets/foreign-exchange-market/central-bank-exchange-rate-fixing/central-bank-exchange-rate-fixing/daily.txt';
  const lines = (await getText(url)).trim().split(/\r?\n/);
  const head = /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})/.exec(lines[0] ?? '');
  const row = lines.find((l) => l.split('|')[3] === 'INR')?.split('|');
  const amount = Number(row?.[2]);
  const value = Number(row?.[4]?.replace(',', '.'));
  if (!head || !MONTHS[head[2]] || !goodNum(amount) || !goodNum(value)) throw new Error('The rate provider sent an unexpected response');
  return { rate: roundRate(amount / value), date: `${head[3]}-${MONTHS[head[2]]}-${head[1].padStart(2, '0')}`, source: 'Czech National Bank' };
}

/** "27-Nov-2026" or "27 Nov 2026" to "2026-11-27". */
function dmyDate(s: string | undefined): string | undefined {
  const m = /^(\d{1,2})[- ]([A-Z][a-z]{2})[- ](\d{4})$/.exec((s ?? '').trim());
  return m && MONTHS[m[2]] ? `${m[3]}-${MONTHS[m[2]]}-${m[1].padStart(2, '0')}` : undefined;
}
const csvCells = (line: string) => line.split(',').map((c) => c.replace(/^"|"$/g, '').trim());

/** Reserve Bank of Australia, statistical table F11.1 (CSV): series FXRINR is INR per 1 AUD. */
async function fetchReserveBankOfAustralia(): Promise<Quote> {
  const url = env('FX_URL_RBA') || 'https://www.rba.gov.au/statistics/tables/csv/f11.1-data.csv';
  const lines = (await getText(url)).split(/\r?\n/);
  const ids = lines.find((l) => /^"?Series ID/.test(l));
  const col = ids ? csvCells(ids).indexOf('FXRINR') : -1;
  if (col < 0) throw new Error('The rate provider sent an unexpected response (no FXRINR series)');
  for (let i = lines.length - 1; i >= 0; i--) {
    const cells = csvCells(lines[i]);
    const date = dmyDate(cells[0]);
    const v = Number(cells[col]);
    if (date && cells[col] && goodNum(v)) return { rate: roundRate(v), date, source: 'Reserve Bank of Australia' };
  }
  throw new Error('The rate provider sent an unexpected response');
}

/** Bank of England database (CSV): spot rate of the Indian rupee into sterling, INR per 1 GBP. */
async function fetchBankOfEngland(): Promise<Quote> {
  const series = env('FX_BOE_SERIES') || 'XUDLBK64';
  const from = new Date(Date.now() - 21 * 86400000);
  const mon = Object.keys(MONTHS)[from.getUTCMonth()];
  const url =
    env('FX_URL_BOE') ||
    `https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom=${String(from.getUTCDate()).padStart(2, '0')}/${mon}/${from.getUTCFullYear()}&Dateto=now&SeriesCodes=${series}&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N`;
  const lines = (await getText(url)).split(/\r?\n/).filter((l) => l.trim());
  const head = csvCells(lines[0] ?? '');
  const col = head.indexOf(series);
  if (head[0]?.toUpperCase() !== 'DATE' || col < 0) throw new Error('The rate provider sent an unexpected response');
  let best: Quote | undefined;
  for (const l of lines.slice(1)) {
    const cells = csvCells(l);
    const date = dmyDate(cells[0]);
    const v = Number(cells[col]);
    if (date && goodNum(v) && (!best || date > best.date)) best = { rate: roundRate(v), date, source: 'Bank of England' };
  }
  if (!best) throw new Error('The rate provider sent an unexpected response');
  return best;
}

/**
 * Federal Reserve H.10 rate through FRED, the St. Louis Fed's data service: series DEXINUS is INR per 1 USD
 * (noon buying rates in New York). The Fed publishes H.10 once a week, so the latest rate can be several
 * days old. FRED needs a free API key in FRED_API_KEY; it is sent only to FRED and never logged or shown.
 */
async function fetchFederalReserve(): Promise<Quote> {
  const key = env('FRED_API_KEY');
  if (!key) throw new Error('FRED_API_KEY is not set');
  const base = (env('FX_URL_FRED') || 'https://api.stlouisfed.org/fred').replace(/\/+$/, '');
  let body: { observations?: { date?: unknown; value?: unknown }[] };
  try {
    body = (await getJson(`${base}/series/observations?series_id=DEXINUS&file_type=json&sort_order=desc&limit=15&api_key=${encodeURIComponent(key)}`)) as typeof body;
  } catch (e) {
    // never echo anything that could carry the key
    throw new Error(e instanceof Error ? e.message.replace(key, '***') : 'Could not reach the rate provider');
  }
  // "." marks a day without a rate
  const o = (body?.observations ?? []).find((x) => isDate(x.date) && goodNum(Number(x.value)));
  if (!o) throw new Error('The rate provider sent an unexpected response');
  return { rate: roundRate(Number(o.value)), date: o.date as string, source: 'Federal Reserve' };
}

/** Currencies fetched from their own central bank (EUR comes from the ECB, the pegs from their issuers). */
export const OWN_CENTRAL_BANKS: Record<string, { bank: string; website: string; load: () => Promise<Quote>; needsKey?: string; maxAgeDays?: number }> = {
  CAD: { bank: 'Bank of Canada', website: 'https://www.bankofcanada.ca/valet/docs', load: fetchBankOfCanada },
  NOK: { bank: 'Norges Bank', website: 'https://www.norges-bank.no/en/topics/Statistics/open-data/', load: fetchNorgesBank },
  CZK: { bank: 'Czech National Bank', website: 'https://www.cnb.cz/en/financial-markets/foreign-exchange-market/central-bank-exchange-rate-fixing/', load: fetchCzechNationalBank },
  AUD: { bank: 'Reserve Bank of Australia', website: 'https://www.rba.gov.au/statistics/tables/#exchange-rates', load: fetchReserveBankOfAustralia },
  GBP: { bank: 'Bank of England', website: 'https://www.bankofengland.co.uk/boeapps/database/', load: fetchBankOfEngland },
  // published weekly: a rate up to 10 days old is still the Fed's latest
  USD: { bank: 'Federal Reserve', website: 'https://fred.stlouisfed.org/series/DEXINUS', load: fetchFederalReserve, needsKey: 'FRED_API_KEY', maxAgeDays: 10 },
};

/** Days after which a bank's latest rate counts as stale, for banks that publish less often than daily. */
export const providerStaleDays = (): Record<string, number> =>
  Object.fromEntries(Object.values(OWN_CENTRAL_BANKS).filter((b) => b.maxAgeDays).map((b) => [b.bank, b.maxAgeDays!]));

/** An own-bank rate this far from the ECB's cross rate is treated as bad data (wrong series, unit or day). */
const MAX_GAP_FROM_ECB = 0.05;

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
    // 1. each currency's own central bank, where it has a free documented feed (fetched alongside the ECB)
    const own = wanted.filter((c) => OWN_CENTRAL_BANKS[c] && (!OWN_CENTRAL_BANKS[c].needsKey || env(OWN_CENTRAL_BANKS[c].needsKey!)));
    const ownRuns = own.map((c) => ({ c, run: { source: OWN_CENTRAL_BANKS[c].bank, ok: false, count: 0 } as SourceRun }));
    const ecbRun: SourceRun = { source: ECB.name, ok: false, count: 0 };
    runs.push(...ownRuns.map((x) => x.run), ecbRun);
    const [ownQuotes, ecb] = await Promise.all([
      Promise.all(
        ownRuns.map(async ({ c, run }) => {
          try {
            return { c, run, q: await OWN_CENTRAL_BANKS[c].load() };
          } catch (e) {
            run.error = `${e instanceof Error ? e.message : String(e)}; the ECB rate is used for ${c}`;
            return { c, run, q: undefined };
          }
        }),
      ),
      fetchEcb().then(
        (q) => {
          ecbRun.ok = true;
          return q;
        },
        (e) => {
          ecbRun.error = e instanceof Error ? e.message : String(e);
          return undefined;
        },
      ),
    ]);
    for (const { c, run, q } of ownQuotes) {
      if (!q) continue;
      const check = ecb?.get(c);
      const gap = check ? Math.abs(q.rate / check.rate - 1) : 0;
      if (q.date < addDays(today(), -(OWN_CENTRAL_BANKS[c].maxAgeDays ?? staleDays()))) run.error = `its latest rate is of ${q.date}, too old; the ECB rate is used for ${c}`;
      else if (gap > MAX_GAP_FROM_ECB) run.error = `its rate ${q.rate} is ${(gap * 100).toFixed(1)}% away from the ECB's ${check!.rate}, so it was not used; the ECB rate is used for ${c}`;
      else {
        run.ok = true;
        run.rateDate = q.date;
        run.count = 1;
        quotes.set(c, q);
      }
    }
    // 2. the ECB (EUR is its own currency) for the rest, and the pegs of currencies fixed to the USD or EUR
    if (ecb) take(ecb, ecbRun);
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
  const ownBank = OWN_CENTRAL_BANKS[c.code]?.bank === q.source;
  // a currency's own central bank replaces later rates that only stood in for it (fetched from another source)
  c.history = (c.history ?? []).filter((h) => h.date !== q.date && !(ownBank && h.date > q.date && h.source === 'fetched' && h.provider !== q.source));
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
