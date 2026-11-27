// Live exchange rates. Rates are fetched on the server (never from the browser) from a documented
// public provider and saved in each currency's dated rate history. A refresh only changes the default
// rate offered to new transactions: every saved transaction keeps the rate it was recorded with.
//
// Providers (choose with FX_RATES_PROVIDER):
//   frankfurter (default) - https://frankfurter.dev, open source, no API key. Publishes the European
//     Central Bank's euro foreign exchange reference rates, once a working day at about 16:00 CET.
//     About 30 currencies (INR, USD, GBP, JPY, SGD, AUD, CAD, CHF, CNY, ...); others are reported as
//     not supported. FX_RATES_URL can point at a self-hosted Frankfurter instance.
//   openexchangerates - https://openexchangerates.org, needs an App ID in OPENEXCHANGERATES_APP_ID.
//     Hourly market rates for about 170 currencies (base USD on the free plan).
import { BASE_CURRENCY, DEFAULT_STALE_DAYS, rateOn, roundRate } from '../shared/currency';
import { today } from '../shared/format';
import type { Currency, Database } from '../shared/types';
import { flushDb, getDb, now } from './db';
import { commit } from './services';

export interface ProviderInfo {
  id: 'frankfurter' | 'openexchangerates';
  name: string;
  website: string;
  apiKeyRequired: boolean;
  apiKeyConfigured: boolean;
  updates: string;
  rateType: string;
}

export interface RefreshResult {
  ok: boolean;
  provider: string;
  /** the provider's date for the rates */
  rateDate?: string;
  fetchedAt: string;
  updated: { code: string; previousRate: number; rate: number; date: string }[];
  unsupported: string[];
  /** currencies whose default rate stays a later manual entry */
  keptManual: { code: string; date: string; rate: number }[];
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

export function providerInfo(): ProviderInfo {
  if (env('FX_RATES_PROVIDER') === 'openexchangerates')
    return {
      id: 'openexchangerates',
      name: 'Open Exchange Rates',
      website: 'https://openexchangerates.org',
      apiKeyRequired: true,
      apiKeyConfigured: !!env('OPENEXCHANGERATES_APP_ID'),
      updates: 'Hourly (depends on your plan)',
      rateType: 'Market mid rates blended from several sources',
    };
  return {
    id: 'frankfurter',
    name: 'Frankfurter (European Central Bank)',
    website: 'https://frankfurter.dev',
    apiKeyRequired: false,
    apiKeyConfigured: false,
    updates: 'Once a working day, about 16:00 CET (20:30 IST); none on weekends and TARGET holidays',
    rateType: 'ECB euro foreign exchange reference rates (indicative mid rates)',
  };
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

/** INR per 1 unit of each currency the provider quotes, and the provider's rate date. */
export async function fetchInrRates(): Promise<{ date: string; rates: Map<string, number> }> {
  const info = providerInfo();
  if (info.id === 'openexchangerates') {
    const appId = env('OPENEXCHANGERATES_APP_ID');
    if (!appId) throw new Error('OPENEXCHANGERATES_APP_ID is not set in the server environment');
    const base = (env('FX_RATES_URL') || 'https://openexchangerates.org/api').replace(/\/+$/, '');
    // the App ID travels in a header, never in the logged URL
    const body = (await getJson(`${base}/latest.json`, { Authorization: `Token ${appId}` })) as { timestamp?: number; rates?: Record<string, unknown> };
    const r = body?.rates;
    if (!r || !goodNum(r.INR) || !goodNum(body.timestamp)) throw new Error('The rate provider response has no INR rate');
    const rates = new Map<string, number>();
    for (const [code, v] of Object.entries(r)) if (goodNum(v)) rates.set(code, roundRate((r.INR as number) / v));
    return { date: new Date(body.timestamp * 1000).toISOString().slice(0, 10), rates };
  }
  const base = (env('FX_RATES_URL') || 'https://api.frankfurter.dev/v1').replace(/\/+$/, '');
  // EUR is the ECB's own base, so cross rates through it keep the published precision
  const body = (await getJson(`${base}/latest?base=EUR`)) as { base?: string; date?: unknown; rates?: Record<string, unknown> };
  const r = body?.rates;
  if (!r || body.base !== 'EUR' || !isDate(body.date)) throw new Error('The rate provider sent an unexpected response');
  if (!goodNum(r.INR)) throw new Error('The rate provider response has no INR rate');
  const inrPerEur = r.INR as number;
  const rates = new Map<string, number>([['EUR', roundRate(inrPerEur)]]);
  for (const [code, v] of Object.entries(r)) if (code !== 'INR' && goodNum(v)) rates.set(code, roundRate(inrPerEur / v));
  return { date: body.date, rates };
}

/**
 * Fetch the latest rates and save one dated, "fetched" history entry per configured currency. Saved
 * transactions are never touched. On failure nothing changes and the error is recorded and returned.
 */
export async function refreshRates(trigger: RefreshResult['trigger'] = 'manual'): Promise<RefreshResult> {
  const info = providerInfo();
  const fetchedAt = now();
  const result: RefreshResult = { ok: false, provider: info.name, fetchedAt, updated: [], unsupported: [], keptManual: [], trigger };
  let fetched: Awaited<ReturnType<typeof fetchInrRates>> | undefined;
  try {
    fetched = await fetchInrRates();
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  }
  // the database may have been replaced while waiting for the provider
  const db = getDb();
  if (fetched) {
    result.ok = true;
    result.rateDate = fetched.date;
    const day = today();
    for (const c of db.currencies.filter((x) => x.code !== BASE_CURRENCY)) {
      const rate = fetched.rates.get(c.code);
      if (!rate) {
        result.unsupported.push(c.code);
        continue;
      }
      applyFetchedRate(c, fetched.date, rate, info.name, fetchedAt, day, result);
    }
  }
  const prev = fxRateSettings(db);
  db.preferences.fxRates = { ...prev, lastRun: result, lastSuccessAt: result.ok ? fetchedAt : prev.lastSuccessAt } satisfies FxRateSettings;
  commit();
  await flushDb();
  return result;
}

function applyFetchedRate(c: Currency, date: string, rate: number, provider: string, recordedAt: string, day: string, result: RefreshResult) {
  const previousRate = rateOn(c, day);
  c.history = (c.history ?? []).filter((h) => h.date !== date);
  c.history.push({ date, rate, source: 'fetched', provider, recordedAt });
  // the default for new transactions is the latest dated rate on or before today
  c.rate = rateOn(c, day);
  const later = c.history.filter((h) => h.date > date && h.date <= day).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (later) result.keptManual.push({ code: c.code, date: later.date, rate: later.rate });
  else result.updated.push({ code: c.code, previousRate, rate, date });
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
