import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Plus, CheckCircle2, Circle } from 'lucide-react';
import { PERIODS, fmtDate, fmtDateTime, money, type PeriodKey } from '@shared/format';
import type { Activity } from '@shared/types';
import { qs, useApi } from '../api';
import { useOrg } from '../lib/app';
import { Dropdown, MenuItem, Tabs, clsx } from '../components/ui';
import { fmtHours } from '@shared/projects';

// Validated categorical slots (light surface): blue, orange
const SERIES_1 = '#2a78d6';
const SERIES_2 = '#eb6834';

interface Aging { total: number; current: number; overdue: number; buckets: Record<string, number> }
interface Dash {
  receivables: Aging;
  payables: Aging;
  cashFlow: { range: { from: string; to: string }; opening: number; incoming: number; outgoing: number; closing: number; series: { month: string; incoming: number; outgoing: number; balance: number }[] };
  incomeExpense: { totalIncome: number; totalExpense: number; series: { month: string; income: number; expense: number }[] };
  topExpenses: { items: { name: string; amount: number }[] };
  banks: { id: string; name: string; subType: string; balance: number }[];
  projects: { id: string; name: string; customer?: string; hours: number; budgetHours?: number; unbilledHours: number; unbilled: number; billed: number }[];
}

const compact = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(Math.round(n));
};

function PeriodPicker({ value, onChange }: { value: PeriodKey; onChange: (p: PeriodKey) => void }) {
  return (
    <Dropdown align="right" button={() => <button className="text-xs text-brand-600 hover:underline">{PERIODS.find((p) => p.value === value)?.label} ▾</button>}>
      {PERIODS.filter((p) => p.value !== 'today').map((p) => (
        <MenuItem key={p.value} onClick={() => onChange(p.value)}>
          {p.label}
        </MenuItem>
      ))}
    </Dropdown>
  );
}

function Card({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('card flex flex-col', className)}>
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h2 className="text-[14px] font-semibold text-slate-800">{title}</h2>
        {action}
      </div>
      <div className="flex-1 p-4">{children}</div>
    </section>
  );
}

function AgingCard({ title, data, newTo, newLabel, listTo }: { title: string; data: Aging; newTo: string; newLabel: string; listTo: string }) {
  const pct = data.total ? (data.current / data.total) * 100 : 0;
  const b = data.buckets;
  return (
    <Card
      title={title}
      action={
        <Link to={newTo} className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline">
          <Plus size={12} /> {newLabel}
        </Link>
      }
    >
      <div className="text-xs text-slate-500">Total Unpaid {title === 'Total Receivables' ? 'Invoices' : 'Bills'}</div>
      <Link to={listTo} className="text-lg font-semibold text-slate-900 hover:text-brand-700">
        {money(data.total)}
      </Link>
      <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Current ${money(data.current)}, overdue ${money(data.overdue)}`}>
        {data.total > 0 && (
          <>
            <div style={{ width: `${pct}%`, background: SERIES_1 }} className="h-full" />
            {pct > 0 && pct < 100 && <div className="w-[2px] bg-white" />}
            <div style={{ width: `${100 - pct}%`, background: SERIES_2 }} className="h-full" />
          </>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-5">
        <div>
          <div className="flex items-center gap-1 text-xxs uppercase text-slate-500">
            <span className="h-2 w-2 rounded-sm" style={{ background: SERIES_1 }} /> Current
          </div>
          <div className="font-medium">{money(data.current)}</div>
        </div>
        {[
          ['1-15 Days', b.d1_15],
          ['16-30 Days', b.d16_30],
          ['31-45 Days', b.d31_45],
          ['Above 45 Days', b.d45_plus],
        ].map(([k, v]) => (
          <div key={k as string}>
            <div className="flex items-center gap-1 text-xxs uppercase text-slate-500">
              <span className="h-2 w-2 rounded-sm" style={{ background: SERIES_2 }} /> Overdue {k}
            </div>
            <div className="font-medium">{money(v as number)}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ChartTip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-semibold text-slate-700">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-slate-600">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
          {p.name}: <span className="font-medium text-slate-800">{money(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

  const navigate = useNavigate();
function Dashboard() {
  const [cashPeriod, setCashPeriod] = useState<PeriodKey>('this_fiscal_year');
  const [incomePeriod, setIncomePeriod] = useState<PeriodKey>('this_fiscal_year');
  const [expensePeriod, setExpensePeriod] = useState<PeriodKey>('this_fiscal_year');
  const [basis, setBasis] = useState<'accrual' | 'cash'>('accrual');
  const { data } = useApi<Dash>(`/dashboard${qs({ cashPeriod, incomePeriod, expensePeriod, basis })}`, { placeholderData: (p) => p });
  if (!data) return <div className="p-8 text-slate-400">Loading dashboard…</div>;
  const axis = { fontSize: 11, fill: '#64748b' };
  return (
    <div className="grid gap-4 p-5 xl:grid-cols-2">
      <AgingCard title="Total Receivables" data={data.receivables} newTo="/sales/invoices/new" newLabel="New" listTo="/sales/invoices" />
      <AgingCard title="Total Payables" data={data.payables} newTo="/purchases/bills/new" newLabel="New" listTo="/purchases/bills" />

      <Card title="Cash Flow" className="xl:col-span-2" action={<PeriodPicker value={cashPeriod} onChange={setCashPeriod} />}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
          <div className="h-64" aria-label="Cash balance by month">
            <ResponsiveContainer>
              <AreaChart data={data.cashFlow.series} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} stroke="#eef2f7" />
                <XAxis dataKey="month" tick={axis} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
                <YAxis tick={axis} tickFormatter={compact} tickLine={false} axisLine={false} width={48} />
                <Tooltip content={<ChartTip />} cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }} />
                <Area type="monotone" dataKey="balance" name="Cash balance" stroke={SERIES_1} strokeWidth={2} fill={SERIES_1} fillOpacity={0.1} dot={{ r: 4, fill: SERIES_1, stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 5 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-4 border-slate-100 text-right lg:border-l lg:pl-4">
            <Stat label={`Cash as on ${fmtDate(data.cashFlow.range.from)}`} value={data.cashFlow.opening} />
            <Stat label="Incoming" value={data.cashFlow.incoming} tone="text-emerald-700" sign="+" />
            <Stat label="Outgoing" value={data.cashFlow.outgoing} tone="text-red-600" sign="-" />
            <Stat label={`Cash as on ${fmtDate(data.cashFlow.range.to)}`} value={data.cashFlow.closing} />
          </div>
        </div>
      </Card>

      <Card
        title="Income and Expense"
        action={
          <div className="flex items-center gap-3">
            <div className="flex overflow-hidden rounded-md border border-slate-300 text-xs">
              {(['accrual', 'cash'] as const).map((b) => (
                <button key={b} className={clsx('px-2 py-0.5 capitalize', basis === b ? 'bg-brand-600 text-white' : 'bg-white text-slate-600')} onClick={() => setBasis(b)}>
                  {b}
                </button>
              ))}
            </div>
            <PeriodPicker value={incomePeriod} onChange={setIncomePeriod} />
          </div>
        }
      >
        <div className="mb-3 flex gap-8">
          <div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES_1 }} /> Total Income
            </div>
            <div className="text-base font-semibold">{money(data.incomeExpense.totalIncome)}</div>
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES_2 }} /> Total Expenses
            </div>
            <div className="text-base font-semibold">{money(data.incomeExpense.totalExpense)}</div>
          </div>
        </div>
        <div className="h-60">
          <ResponsiveContainer>
            <BarChart data={data.incomeExpense.series} barGap={2} margin={{ left: 0, right: 8, top: 4 }}>
              <CartesianGrid vertical={false} stroke="#eef2f7" />
              <XAxis dataKey="month" tick={axis} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} tickFormatter={(m: string) => m.slice(0, 3)} />
              <YAxis tick={axis} tickFormatter={compact} tickLine={false} axisLine={false} width={48} />
              <Tooltip content={<ChartTip />} cursor={{ fill: '#f1f5f9' }} />
              <Bar dataKey="income" name="Income" fill={SERIES_1} radius={[4, 4, 0, 0]} maxBarSize={18} />
              <Bar dataKey="expense" name="Expense" fill={SERIES_2} radius={[4, 4, 0, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title="Top Expenses" action={<PeriodPicker value={expensePeriod} onChange={setExpensePeriod} />}>
        {data.topExpenses.items.length === 0 ? (
          <div className="flex h-full min-h-[200px] flex-col items-center justify-center text-center text-slate-400">
            No expense recorded for this period.
            <Link to="/purchases/expenses/new" className="link mt-2 text-xs">
              Record an expense
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {data.topExpenses.items.map((e) => {
              const max = data.topExpenses.items[0].amount || 1;
              return (
                <li key={e.name}>
                  <div className="mb-1 flex justify-between text-[13px]">
                    <span>{e.name}</span>
                    <span className="font-medium tabular-nums">{money(e.amount)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div className="h-2 rounded-full" style={{ width: `${(e.amount / max) * 100}%`, background: SERIES_1 }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Projects Watchlist" action={<Link to="/time-tracking/projects" className="text-xs text-brand-600 hover:underline">View all</Link>}>
        {data.projects.length === 0 ? (
          <div className="py-8 text-center text-slate-400">
            No projects on your watchlist. Turn on “Add to dashboard watchlist” on a project to follow its hours here.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Project</th>
                <th className="text-right">Logged Hours</th>
                <th className="text-right">Unbilled</th>
                <th className="text-right">Billed</th>
              </tr>
            </thead>
            <tbody>
              {data.projects.map((p) => (
                <tr key={p.id} className="row-link" onClick={() => navigate(`/time-tracking/projects/${p.id}`)}>
                  <td>
                    <div className="link">{p.name}</div>
                    <div className="text-xs text-slate-500">{p.customer}</div>
                  </td>
                  <td className="text-right tabular-nums">
                    {fmtHours(p.hours)}
                    {p.budgetHours ? <span className="text-slate-400"> / {fmtHours(p.budgetHours)}</span> : ''}
                    {p.budgetHours ? (
                      <div className="ml-auto mt-1 h-1 w-20 rounded-full bg-slate-100">
                        <div className={clsx('h-1 rounded-full', p.hours > p.budgetHours ? 'bg-red-500' : 'bg-emerald-500')} style={{ width: `${Math.min(100, (p.hours / p.budgetHours) * 100)}%` }} />
                      </div>
                    ) : null}
                  </td>
                  <td className="text-right tabular-nums text-emerald-700">{money(p.unbilled)}</td>
                  <td className="text-right tabular-nums">{money(p.billed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Bank and Credit Cards" action={<Link to="/banking" className="text-xs text-brand-600 hover:underline">Go to Banking</Link>}>
        <table className="table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Type</th>
              <th className="text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {data.banks.map((b) => (
              <tr key={b.id}>
                <td>{b.name}</td>
                <td className="capitalize text-slate-500">{b.subType.replace('_', ' ')}</td>
                <td className="text-right tabular-nums">{money(b.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone, sign }: { label: string; value: number; tone?: string; sign?: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">
        {label}
        {sign && ` (${sign})`}
      </div>
      <div className={clsx('text-base font-semibold tabular-nums', tone)}>{money(value)}</div>
    </div>
  );
}

function GettingStarted() {
  const { data: items = [] } = useApi<unknown[]>('/items');
  const { data: customers = [] } = useApi<unknown[]>('/contacts?kind=customer');
  const { data: invoices = [] } = useApi<unknown[]>('/docs?kind=invoice');
  const { data: payments = [] } = useApi<unknown[]>('/payments-received');
  const { data: vendors = [] } = useApi<unknown[]>('/contacts?kind=vendor');
  const { data: bills = [] } = useApi<unknown[]>('/docs?kind=bill');
  const navigate = useNavigate();
  const steps = [
    { done: true, label: 'Set up your organization profile (Creatign, Tamil Nadu, INR)', to: '/settings' },
    { done: items.length > 0, label: 'Add the items you sell or buy', to: '/items/new' },
    { done: customers.length > 0, label: 'Add your first customer', to: '/sales/customers/new' },
    { done: invoices.length > 0, label: 'Create a quote, sales order or invoice', to: '/sales/invoices/new' },
    { done: payments.length > 0, label: 'Record a customer payment', to: '/sales/payments-received/new' },
    { done: vendors.length > 0, label: 'Add a vendor', to: '/purchases/vendors/new' },
    { done: bills.length > 0, label: 'Record a bill and pay it', to: '/purchases/bills/new' },
  ];
  const done = steps.filter((s) => s.done).length;
  return (
    <div className="max-w-3xl p-5">
      <div className="card p-5">
        <div className="mb-1 text-base font-semibold">Welcome to Creatign Books</div>
        <div className="mb-4 text-slate-500">
          {done} of {steps.length} steps complete
        </div>
        <div className="mb-5 h-2 rounded-full bg-slate-100">
          <div className="h-2 rounded-full bg-brand-600" style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
        <ul className="divide-y divide-slate-100">
          {steps.map((s) => (
            <li key={s.label} className="flex items-center justify-between py-3">
              <span className="flex items-center gap-2">
                {s.done ? <CheckCircle2 size={18} className="text-emerald-600" /> : <Circle size={18} className="text-slate-300" />}
                <span className={clsx(s.done && 'text-slate-500 line-through')}>{s.label}</span>
              </span>
              {!s.done && (
                <button className="btn-secondary btn-sm" onClick={() => navigate(s.to)}>
                  Start
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function RecentUpdates() {
  const { data = [] } = useApi<Activity[]>('/recent-activity');
  return (
    <div className="max-w-3xl p-5">
      <div className="card divide-y divide-slate-100">
        {data.length === 0 && <div className="p-6 text-center text-slate-400">Nothing has happened yet.</div>}
        {data.map((a) => (
          <div key={a.id} className="flex items-start justify-between gap-4 px-4 py-3">
            <div>
              <div className="font-medium">{a.message}</div>
              {a.detail && <div className="text-xs text-slate-500">{a.detail}</div>}
            </div>
            <div className="shrink-0 text-xxs text-slate-400">{fmtDateTime(a.createdAt)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const org = useOrg();
  const [search, setSearch] = useSearchParams();
  const tab = (search.get('tab') as 'dashboard' | 'getting' | 'updates') || 'dashboard';
  return (
    <div className="min-h-full bg-slate-50/60">
      <div className="border-b border-slate-200 bg-white px-5 pt-4">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 text-lg font-bold text-white">{org.logoText || org.name[0]}</div>
          <div>
            <div className="text-base font-semibold">Hello, {org.name}</div>
            <div className="text-xs text-slate-500">{org.name} · {org.state}, {org.country}</div>
          </div>
        </div>
        <Tabs
          tabs={[
            { value: 'dashboard', label: 'Dashboard' },
            { value: 'getting', label: 'Getting Started' },
            { value: 'updates', label: 'Recent Updates' },
          ]}
          value={tab}
          onChange={(t) => setSearch(t === 'dashboard' ? {} : { tab: t })}
          className="border-b-0"
        />
      </div>
      {tab === 'dashboard' && <Dashboard />}
      {tab === 'getting' && <GettingStarted />}
      {tab === 'updates' && <RecentUpdates />}
    </div>
  );
}
