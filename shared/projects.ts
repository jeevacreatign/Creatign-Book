// Time tracking rules shared by the server and the client: billing methods, how an entry is
// valued, HH:MM time, billing status and the timesheet period filter.
import { addDays, endOfMonth, fiscalYearRange, parseISO, toISO, today } from './format';
import type { Project, ProjectBillingMethod, TimeEntry } from './types';

export const BILLING_METHODS: { value: ProjectBillingMethod; label: string }[] = [
  { value: 'fixed', label: 'Fixed Cost for Project' },
  { value: 'project_hours', label: 'Based on Project Hours' },
  { value: 'task_hours', label: 'Based on Task Hours' },
  { value: 'staff_hours', label: 'Based on Staff Hours' },
];

export const billingLabel = (m?: string) => BILLING_METHODS.find((b) => b.value === m)?.label ?? 'Based on Project Hours';

/** Old data stored 'hourly'; it is the same as Based on Project Hours. */
export function normalizeBillingMethod(m?: string): ProjectBillingMethod {
  if (m === 'hourly' || !m) return 'project_hours';
  return BILLING_METHODS.some((b) => b.value === m) ? (m as ProjectBillingMethod) : 'project_hours';
}

/** Hourly rate an entry is billed at, or 0 for fixed-cost projects. */
export function entryRate(p: Pick<Project, 'billingMethod' | 'rate' | 'tasks' | 'users'>, e: Pick<TimeEntry, 'taskId' | 'userId'>): number {
  switch (p.billingMethod) {
    case 'project_hours':
      return p.rate || 0;
    case 'task_hours':
      return p.tasks.find((t) => t.id === e.taskId)?.ratePerHour || 0;
    case 'staff_hours':
      return p.users.find((u) => u.userId === e.userId)?.ratePerHour || 0;
    default:
      return 0;
  }
}

export const isHourly = (m: ProjectBillingMethod) => m !== 'fixed';

// ------------------------------------------------------------ HH:MM

/** 1.5 -> "01:30" */
export function fmtHours(h: number | undefined | null): string {
  const mins = Math.round((Number(h) || 0) * 60);
  const sign = mins < 0 ? '-' : '';
  const a = Math.abs(mins);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

/** Accepts "1:30", "01:30", "1.5", "90m", "2h" -> decimal hours (NaN when unreadable). */
export function parseHours(s: string | number | undefined | null): number {
  if (typeof s === 'number') return s;
  const t = String(s ?? '').trim().toLowerCase();
  if (!t) return NaN;
  let m = /^(\d{1,3}):([0-5]?\d)$/.exec(t);
  if (m) return Number(m[1]) + Number(m[2]) / 60;
  m = /^(\d+(?:\.\d+)?)\s*h(?:rs?|ours?)?$/.exec(t);
  if (m) return Number(m[1]);
  m = /^(\d+)\s*m(?:in(?:s|utes?)?)?$/.exec(t);
  if (m) return Number(m[1]) / 60;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  return NaN;
}

/** "09:00" to "17:30" -> 8.5 (crossing midnight counts as the next day). */
export function hoursBetween(start: string, end: string): number {
  const toMin = (x: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(x.trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  };
  const a = toMin(start);
  const b = toMin(end);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return ((b - a + 24 * 60) % (24 * 60)) / 60;
}

/** Milliseconds -> "01:02:03" for the running timer. */
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((x) => String(x).padStart(2, '0')).join(':');
}

// ------------------------------------------------------------ billing status

export type BillingStatus = 'unbilled' | 'invoiced' | 'non_billable';
export const billingStatus = (e: Pick<TimeEntry, 'billable' | 'invoiced'>): BillingStatus => (e.invoiced ? 'invoiced' : e.billable ? 'unbilled' : 'non_billable');
export const BILLING_STATUS_LABEL: Record<BillingStatus, string> = { unbilled: 'Unbilled', invoiced: 'Invoiced', non_billable: 'Non-Billable' };

// ------------------------------------------------------------ timesheet periods

export const TIME_PERIODS = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_week', label: 'This Week' },
  { value: 'previous_week', label: 'Previous Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'previous_month', label: 'Previous Month' },
  { value: 'this_quarter', label: 'This Quarter' },
  { value: 'previous_quarter', label: 'Previous Quarter' },
  { value: 'this_year', label: 'This Year' },
  { value: 'previous_year', label: 'Previous Year' },
  { value: 'custom', label: 'Custom' },
] as const;
export type TimePeriod = (typeof TIME_PERIODS)[number]['value'];

/** Date range for a timesheet period. Weeks start on Monday; quarters and years follow the fiscal year. */
export function timePeriodRange(key: string, ref = today(), fyStart = 4, custom?: { from?: string; to?: string }): { from: string; to: string } {
  const d = parseISO(ref);
  const monday = addDays(ref, -((d.getDay() + 6) % 7));
  switch (key) {
    case 'today':
      return { from: ref, to: ref };
    case 'yesterday':
      return { from: addDays(ref, -1), to: addDays(ref, -1) };
    case 'this_week':
      return { from: monday, to: addDays(monday, 6) };
    case 'previous_week':
      return { from: addDays(monday, -7), to: addDays(monday, -1) };
    case 'this_month':
      return { from: toISO(new Date(d.getFullYear(), d.getMonth(), 1)), to: endOfMonth(ref) };
    case 'previous_month': {
      const pm = toISO(new Date(d.getFullYear(), d.getMonth() - 1, 1));
      return { from: pm, to: endOfMonth(pm) };
    }
    case 'this_quarter':
    case 'previous_quarter': {
      const into = (d.getMonth() + 12 - (fyStart - 1)) % 12;
      const from = new Date(d.getFullYear(), d.getMonth() - (into % 3) - (key === 'previous_quarter' ? 3 : 0), 1);
      return { from: toISO(from), to: toISO(new Date(from.getFullYear(), from.getMonth() + 3, 0)) };
    }
    case 'this_year':
      return fiscalYearRange(ref, fyStart);
    case 'previous_year':
      return fiscalYearRange(ref, fyStart, -1);
    case 'custom':
      return { from: custom?.from || '1900-01-01', to: custom?.to || '2999-12-31' };
    default:
      return { from: '1900-01-01', to: '2999-12-31' };
  }
}

// ------------------------------------------------------------ budgets

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mon = (x: Date) => MONTHS[x.getMonth()];

/** Period buckets of a budget: 12 months, 4 quarters or 1 year from the fiscal year start. */
export function budgetBuckets(fyStart: string, period: 'monthly' | 'quarterly' | 'yearly'): { from: string; to: string; label: string }[] {
  const d = parseISO(fyStart);
  const step = period === 'monthly' ? 1 : period === 'quarterly' ? 3 : 12;
  const out: { from: string; to: string; label: string }[] = [];
  for (let i = 0; i < 12; i += step) {
    const a = new Date(d.getFullYear(), d.getMonth() + i, 1);
    const b = new Date(d.getFullYear(), d.getMonth() + i + step, 0);
    const label = step === 1 ? `${mon(a)} ${a.getFullYear()}` : `${mon(a)} ${a.getFullYear()} - ${mon(b)} ${b.getFullYear()}`;
    out.push({ from: toISO(a), to: toISO(b), label });
  }
  return out;
}

export function fiscalYearLabel(fyStart: string) {
  const d = parseISO(fyStart);
  const end = new Date(d.getFullYear(), d.getMonth() + 12, 0);
  return `${mon(d)} ${d.getFullYear()} - ${mon(end)} ${end.getFullYear()}`;
}
