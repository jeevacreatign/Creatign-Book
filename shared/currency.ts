// Currencies. Every transaction carries its currency and the exchange rate on its date, written as
// units of the base currency (INR) per 1 unit of the transaction currency. Amounts on a document stay
// in its own currency; the ledger, reports and dashboards always work in the base currency.
import { money, round2 } from './format';
import type { Currency, Database, RateEntry } from './types';

export const BASE_CURRENCY = 'INR';
/** Exchange rates are kept to 6 decimal places (0.012345 INR per JPY ... 106.400000 INR per GBP). */
export const RATE_DECIMALS = 6;
export const roundRate = (r: number) => Math.round((Number(r) || 0) * 1e6) / 1e6;

let isoCache: Set<string> | undefined;
/** ISO 4217 codes known to the runtime (no external service). */
export function isoCodes(): Set<string> {
  if (!isoCache) {
    try {
      isoCache = new Set((Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('currency'));
    } catch {
      isoCache = new Set(['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY', 'CHF', 'CNY', 'HKD', 'NZD', 'SAR', 'QAR', 'MYR', 'THB', 'LKR', 'NPR', 'BDT', 'ZAR', 'SEK', 'NOK', 'DKK']);
    }
  }
  return isoCache;
}
export const isIsoCode = (code: string) => /^[A-Z]{3}$/.test(code) && isoCodes().has(code);

/** English name and the narrow symbol for an ISO code ("$", "€", "AED"). */
export function isoInfo(code: string): { name: string; symbol: string } {
  let name = code;
  let symbol = code;
  try {
    name = new Intl.DisplayNames(['en'], { type: 'currency' }).of(code) || code;
  } catch {
    /* older runtimes */
  }
  try {
    const parts = new Intl.NumberFormat('en-US', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(0);
    symbol = parts.find((p) => p.type === 'currency')?.value || code;
  } catch {
    /* unknown code */
  }
  if (code === 'INR') symbol = '₹';
  return { name, symbol };
}

const western = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Amount in a currency: ₹1,00,000.00 for INR (Indian grouping), $1,234.50 / AED 1,234.50 for others. */
export function moneyIn(n: number | undefined | null, code: string | undefined = BASE_CURRENCY, symbol?: string): string {
  const c = code || BASE_CURRENCY;
  if (c === BASE_CURRENCY) return money(n);
  const v = round2(Number(n) || 0);
  const sym = symbol || isoInfo(c).symbol;
  const sep = /^[A-Z]{2,}$/.test(sym) ? ' ' : '';
  return `${v < 0 ? '-' : ''}${sym}${sep}${western.format(Math.abs(v))}`;
}

/** The currency and rate a record carries (records saved before multi-currency are INR at 1). */
export function fxOf(x: { currencyCode?: string; exchangeRate?: number } | undefined): { code: string; rate: number } {
  const code = x?.currencyCode || BASE_CURRENCY;
  const rate = code === BASE_CURRENCY ? 1 : Number(x?.exchangeRate) > 0 ? Number(x!.exchangeRate) : 1;
  return { code, rate };
}

/**
 * Amount in the base currency, rounded half-up to paise. Computed on whole cents and micro-rate units so
 * the result does not depend on binary floating point (1000.33 x 83.2575 = 83,284.974975 -> 83,284.97)
 * and the browser preview, the ledger and the reports always agree.
 */
export function toBase(amount: number, rate: number): number {
  // toFixed drops binary noise first (1.005 * 100 = 100.49999999999999 -> 100.5 -> 101 cents)
  const a = Math.round(Number(((Number(amount) || 0) * 100).toFixed(6)));
  const r = Math.round(Number(((Number(rate) || 1) * 1e6).toFixed(3)));
  const micro = a * r; // cents x 1e6
  if (!Number.isSafeInteger(micro)) return round2((Number(amount) || 0) * (rate || 1));
  const sign = micro < 0 ? -1 : 1;
  return (sign * Math.floor((Math.abs(micro) + 500000) / 1e6)) / 100;
}

/** Rate on a date: the latest entry of the currency's rate history on or before it, else its current rate. */
export function rateOn(c: Pick<Currency, 'code' | 'rate' | 'history'> | undefined, date: string): number {
  if (!c || c.code === BASE_CURRENCY) return 1;
  const past = (c.history ?? []).filter((h) => h.date <= date).sort((a, b) => a.date.localeCompare(b.date));
  return past.length ? past[past.length - 1].rate : c.rate;
}

/** The history entry that sets the rate on a date (latest on or before it), if any. */
export function rateEntryOn(c: Pick<Currency, 'history'> | undefined, date: string): RateEntry | undefined {
  const past = (c?.history ?? []).filter((h) => h.date <= date).sort((a, b) => a.date.localeCompare(b.date));
  return past[past.length - 1];
}

/** A rate older than this many days is flagged as stale (central-bank rates skip weekends and holidays). */
export const DEFAULT_STALE_DAYS = 4;

export interface RateStatus {
  rate: number;
  /** date of the rate in use for new transactions today */
  date?: string;
  source: 'manual' | 'fetched' | 'unknown';
  provider?: string;
  recordedAt?: string;
  /** provider timestamp of an intraday rate */
  asOf?: string;
  ageDays?: number;
  /** market hours since asOf (weekend closure not counted), for intraday rates */
  ageHours?: number;
  stale: boolean;
  staleReason?: string;
}

/** Options for rateStatus beyond the day-based stale limit. */
export interface StaleRules {
  /** stale limit in days for providers that publish less often than daily */
  staleDaysByProvider?: Record<string, number>;
  /** stale limit in market hours for intraday providers (checked against the rate's asOf time) */
  staleHoursByProvider?: Record<string, number>;
  /** now, in ms (tests) */
  now?: number;
}

const HOUR = 3600_000;
/**
 * Hours between two instants during which the currency market is open: the weekly closure from Friday
 * 22:00 UTC to Sunday 22:00 UTC is not counted, so Friday's closing rate stays fresh over the weekend.
 */
export function marketHoursBetween(fromIso: string, toMs: number): number {
  const from = Date.parse(fromIso);
  if (!Number.isFinite(from) || toMs <= from) return 0;
  let closed = 0;
  // each weekly closure that overlaps the interval
  const d = new Date(from);
  const fri = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 2) % 7), 22);
  for (let start = fri - 7 * 24 * HOUR; start < toMs; start += 7 * 24 * HOUR) {
    const end = start + 48 * HOUR;
    closed += Math.max(0, Math.min(end, toMs) - Math.max(start, from));
  }
  return Math.max(0, Math.round(((toMs - from - closed) / HOUR) * 10) / 10);
}

/** Where today's default rate of a currency comes from, and whether it is out of date. */
export function rateStatus(c: Currency, day: string, staleDays = DEFAULT_STALE_DAYS, rules: StaleRules | Record<string, number> = {}): RateStatus {
  const r: StaleRules = 'staleDaysByProvider' in rules || 'staleHoursByProvider' in rules || 'now' in rules ? (rules as StaleRules) : { staleDaysByProvider: rules as Record<string, number> };
  if (c.code === BASE_CURRENCY) return { rate: 1, source: 'manual', stale: false };
  const e = rateEntryOn(c, day);
  if (!e) return { rate: c.rate, source: 'unknown', stale: true, staleReason: 'No dated rate: enter one or refresh rates' };
  const ageDays = Math.max(0, Math.round((Date.parse(day) - Date.parse(e.date)) / 86400000));
  const base = { rate: e.rate, date: e.date, source: e.source ?? 'manual', provider: e.provider, recordedAt: e.recordedAt, asOf: e.asOf, ageDays } as const;
  const hourLimit = e.source === 'fetched' && e.provider && e.asOf ? r.staleHoursByProvider?.[e.provider] : undefined;
  if (hourLimit !== undefined) {
    const ageHours = marketHoursBetween(e.asOf!, r.now ?? Date.now());
    const stale = ageHours > hourLimit;
    return { ...base, ageHours, stale, staleReason: stale ? `Rate is ${Math.floor(ageHours)} market hours old` : undefined };
  }
  const stale = ageDays > (e.source === 'fetched' && e.provider ? (r.staleDaysByProvider?.[e.provider] ?? staleDays) : staleDays);
  return { ...base, stale, staleReason: stale ? `Rate is ${ageDays} days old` : undefined };
}

const rateFmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: RATE_DECIMALS });
/** "1 USD = ₹83.2575" */
export const rateLabel = (code: string, rate: number) => `1 ${code} = ₹${rateFmt.format(roundRate(rate))}`;

/**
 * Multi-currency migration: records saved before currencies existed are INR at rate 1. Foreign-currency
 * records keep the rate they were saved with. Safe to run on every load.
 */
export function normalizeCurrencies(d: Database) {
  d.organization.currencyCode = 'INR';
  d.organization.currencySymbol = d.organization.currencySymbol || '₹';
  d.currencies = d.currencies ?? [];
  if (!d.currencies.some((c) => c.code === 'INR')) d.currencies.unshift({ code: 'INR', name: 'Indian Rupee', symbol: '₹', rate: 1 });
  for (const c of d.currencies) {
    if (c.code === 'INR') c.rate = 1;
    c.history = c.history ?? [];
  }
  const fix = (x: { currencyCode?: string; exchangeRate?: number }) => {
    if (!x.currencyCode) x.currencyCode = 'INR';
    if (x.currencyCode === 'INR') x.exchangeRate = 1;
    else if (!(Number(x.exchangeRate) > 0)) x.exchangeRate = d.currencies.find((c) => c.code === x.currencyCode)?.rate ?? 1;
  };
  for (const c of d.contacts ?? []) if (!c.currencyCode) c.currencyCode = 'INR';
  for (const x of d.docs ?? []) fix(x);
  for (const x of d.paymentsReceived ?? []) fix(x);
  for (const x of d.paymentsMade ?? []) fix(x);
}
