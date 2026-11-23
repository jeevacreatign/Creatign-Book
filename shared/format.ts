// Formatting and date helpers for INR, dd/MM/yyyy and the April–March fiscal year.
import type { PaymentTerms, RepeatEvery } from './types';

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const round2 = (n: number) => Math.round((Number(n) || 0) * 100 + Number.EPSILON) / 100;

/** ₹1,00,000.00 */
export function money(n: number | undefined | null, symbol = '₹'): string {
  const v = round2(Number(n) || 0);
  const s = inr.format(Math.abs(v));
  return `${v < 0 ? '-' : ''}${symbol}${s}`;
}

/** 1,00,000.00 (no symbol) */
export function num(n: number | undefined | null): string {
  return inr.format(round2(Number(n) || 0));
}

const pad = (n: number) => String(n).padStart(2, '0');

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function today(): string {
  return toISO(new Date());
}

export function parseISO(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** 'yyyy-MM-dd' -> 'dd/MM/yyyy' */
export function fmtDate(s?: string | null): string {
  if (!s) return '';
  const [y, m, d] = s.slice(0, 10).split('-');
  if (!y || !m || !d) return s;
  return `${d}/${m}/${y}`;
}

/** 'dd/MM/yyyy' -> 'yyyy-MM-dd' (or '' if invalid) */
export function parseDisplayDate(s: string): string {
  const m = s.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!m) return '';
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return '';
  return toISO(dt);
}

export function fmtDateTime(s?: string): string {
  if (!s) return '';
  const d = new Date(s);
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(h)}:${pad(d.getMinutes())} ${ampm}`;
}

export function addDays(iso: string, days: number): string {
  const d = parseISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

export function addMonths(iso: string, months: number): string {
  const d = parseISO(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toISO(d);
}

export function endOfMonth(iso: string, offsetMonths = 0): string {
  const d = parseISO(iso);
  return toISO(new Date(d.getFullYear(), d.getMonth() + 1 + offsetMonths, 0));
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000);
}

export function dueDateFor(date: string, terms?: PaymentTerms): string {
  switch (terms) {
    case 'net_15':
      return addDays(date, 15);
    case 'net_30':
      return addDays(date, 30);
    case 'net_45':
      return addDays(date, 45);
    case 'net_60':
      return addDays(date, 60);
    case 'due_end_of_month':
      return endOfMonth(date);
    case 'due_end_of_next_month':
      return endOfMonth(date, 1);
    default:
      return date;
  }
}

export function nextRecurrence(iso: string, r: RepeatEvery): string {
  const n = Math.max(1, r.n || 1);
  switch (r.unit) {
    case 'day':
      return addDays(iso, n);
    case 'week':
      return addDays(iso, 7 * n);
    case 'year':
      return addMonths(iso, 12 * n);
    default:
      return addMonths(iso, n);
  }
}

export function frequencyLabel(r?: RepeatEvery): string {
  if (!r) return '';
  const names = { day: 'Day', week: 'Week', month: 'Month', year: 'Year' } as const;
  const ly = { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' } as const;
  if (r.n === 1) return ly[r.unit];
  return `Every ${r.n} ${names[r.unit]}s`;
}

// ---------- Fiscal year (April–March by default) ----------

export interface Range {
  from: string;
  to: string;
  label: string;
}

export function fiscalYearRange(ref: string, startMonth = 4, offset = 0): Range {
  const d = parseISO(ref);
  let y = d.getMonth() + 1 >= startMonth ? d.getFullYear() : d.getFullYear() - 1;
  y += offset;
  const from = toISO(new Date(y, startMonth - 1, 1));
  const to = toISO(new Date(y + 1, startMonth - 1, 0));
  return { from, to, label: `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}` };
}

export type PeriodKey =
  | 'today'
  | 'this_week'
  | 'this_month'
  | 'this_quarter'
  | 'this_fiscal_year'
  | 'previous_month'
  | 'previous_quarter'
  | 'previous_fiscal_year'
  | 'last_6_months'
  | 'last_12_months'
  | 'all';

export const PERIODS: { value: PeriodKey; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'this_quarter', label: 'This Quarter' },
  { value: 'this_fiscal_year', label: 'This Fiscal Year' },
  { value: 'previous_month', label: 'Previous Month' },
  { value: 'previous_quarter', label: 'Previous Quarter' },
  { value: 'previous_fiscal_year', label: 'Previous Fiscal Year' },
  { value: 'last_6_months', label: 'Last 6 Months' },
  { value: 'last_12_months', label: 'Last 12 Months' },
  { value: 'all', label: 'All Time' },
];

export function periodRange(key: PeriodKey, ref = today(), fyStart = 4): Range {
  const d = parseISO(ref);
  const label = PERIODS.find((p) => p.value === key)?.label ?? key;
  switch (key) {
    case 'today':
      return { from: ref, to: ref, label };
    case 'this_week': {
      const dow = (d.getDay() + 6) % 7;
      const from = addDays(ref, -dow);
      return { from, to: addDays(from, 6), label };
    }
    case 'this_month':
      return { from: toISO(new Date(d.getFullYear(), d.getMonth(), 1)), to: endOfMonth(ref), label };
    case 'previous_month': {
      const pm = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      return { from: toISO(pm), to: endOfMonth(toISO(pm)), label };
    }
    case 'this_quarter':
    case 'previous_quarter': {
      // Quarters aligned to the fiscal year start (Apr–Jun, Jul–Sep, ...)
      const monthsIntoFy = (d.getMonth() + 12 - (fyStart - 1)) % 12;
      const qStartMonth = d.getMonth() - (monthsIntoFy % 3) - (key === 'previous_quarter' ? 3 : 0);
      const from = new Date(d.getFullYear(), qStartMonth, 1);
      const to = new Date(from.getFullYear(), from.getMonth() + 3, 0);
      return { from: toISO(from), to: toISO(to), label };
    }
    case 'this_fiscal_year':
      return { ...fiscalYearRange(ref, fyStart), label };
    case 'previous_fiscal_year':
      return { ...fiscalYearRange(ref, fyStart, -1), label };
    case 'last_6_months':
      return { from: toISO(new Date(d.getFullYear(), d.getMonth() - 5, 1)), to: endOfMonth(ref), label };
    case 'last_12_months':
      return { from: toISO(new Date(d.getFullYear(), d.getMonth() - 11, 1)), to: endOfMonth(ref), label };
    default:
      return { from: '1900-01-01', to: '2999-12-31', label };
  }
}

/** List of month buckets [{key:'2026-04', label:'Apr 2026'}] covering a range. */
export function monthsIn(range: { from: string; to: string }): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const start = parseISO(range.from);
  const end = parseISO(range.to);
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  while (cur <= end && out.length < 60) {
    out.push({ key: `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}`, label: `${names[cur.getMonth()]} ${cur.getFullYear()}` });
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

export function statusLabel(s: string): string {
  return s.replace(/_/g, ' ').toUpperCase();
}
