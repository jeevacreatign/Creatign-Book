// Banking Overview: balance trend, totals by account kind and the list of bank, cash and card accounts.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CreditCard, Landmark, Plus, Upload, Wallet, ListFilter, ChevronDown } from 'lucide-react';
import { fmtDate, money } from '@shared/format';
import { api, qs, useAction, useApi } from '../../api';
import { Dropdown, MenuItem, Spinner, clsx, useConfirm } from '../../components/ui';
import { ListHeader, MoreMenu, ViewPicker } from '../../components/split';
import type { BankAccountRow } from './common';

const SERIES = '#2a78d6';
const PERIODS = [
  { value: 'last_30_days', label: 'Last 30 days' },
  { value: 'this_month', label: 'This Month' },
  { value: 'previous_month', label: 'Previous Month' },
  { value: 'this_quarter', label: 'This Quarter' },
  { value: 'last_6_months', label: 'Last 6 Months' },
  { value: 'this_fiscal_year', label: 'This Fiscal Year' },
  { value: 'last_12_months', label: 'Last 12 Months' },
];

interface OverviewData {
  accounts: BankAccountRow[];
  totals: { cash: number; bank: number; card: number; clearing: number };
  uncategorized: number;
  series: { date: string; balance: number }[];
}

const compact = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1e7 ? `${(a / 1e7).toFixed(1)}Cr` : a >= 1e5 ? `${(a / 1e5).toFixed(1)}L` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}K` : String(Math.round(a));
  return `${n < 0 ? '-' : ''}${s}`;
};

export function AccountIcon({ subType, size = 16 }: { subType: string; size?: number }) {
  if (subType === 'credit_card') return <CreditCard size={size} />;
  if (subType === 'cash') return <Wallet size={size} />;
  return <Landmark size={size} />;
}

export default function Overview() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState('last_30_days');
  const [chartAcc, setChartAcc] = useState('');
  const [view, setView] = useState<'active' | 'inactive' | 'all'>('active');
  const { data, isLoading } = useApi<OverviewData>(`/banking/overview${qs({ period, accountId: chartAcc })}`);
  const setActive = useAction((v: { id: string; active: boolean }) => api(`/accounts/bulk`, { body: { ids: [v.id], action: v.active ? 'activate' : 'deactivate' } }), 'Account updated');
  const del = useAction((id: string) => api(`/accounts/${id}`, { method: 'DELETE' }), 'Account deleted');
  const confirm = useConfirm();
  if (isLoading || !data) return <Spinner />;
  const rows = data.accounts.filter((a) => (view === 'all' ? true : view === 'active' ? a.active !== false : a.active === false));
  const axis = { fontSize: 11, fill: '#64748b' };
  const last = data.series[data.series.length - 1]?.balance ?? 0;
  return (
    <div>
      <ListHeader title={<h1 className="text-[19px]">Cash &amp; Bank</h1>}>
        <button className="btn-secondary" onClick={() => navigate('/banking/import')}>
          <Upload size={14} /> Import Statement
        </button>
        <button className="btn-primary" onClick={() => navigate('/banking/new')}>
          <Plus size={15} /> Add Bank or Credit Card
        </button>
        <MoreMenu>
          <MenuItem onClick={() => navigate('/banking/rules')}>Manage Rules</MenuItem>
          <MenuItem onClick={() => navigate('/accountant/transaction-locking')}>Period Close</MenuItem>
        </MoreMenu>
      </ListHeader>

      <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="card p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <Dropdown
                button={() => (
                  <button className="flex items-center gap-1 text-[13px] font-semibold text-slate-700">
                    {chartAcc ? data.accounts.find((a) => a.id === chartAcc)?.name : 'All Accounts'}
                    <ChevronDown size={14} className="text-brand-600" />
                  </button>
                )}
              >
                <MenuItem onClick={() => setChartAcc('')}>All Accounts</MenuItem>
                {data.accounts
                  .filter((a) => a.active !== false)
                  .map((a) => (
                    <MenuItem key={a.id} onClick={() => setChartAcc(a.id)}>
                      {a.name}
                    </MenuItem>
                  ))}
              </Dropdown>
              <div className="mt-0.5 text-xl font-semibold tabular-nums">{money(last)}</div>
              <div className="text-xxs text-slate-400">{chartAcc ? 'Balance in Creatign Ledger' : 'Net balance of the accounts below (cards reduce it)'}</div>
            </div>
            <select className="input w-auto" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period">
              {PERIODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="h-56" aria-label="Balance by day">
            <ResponsiveContainer>
              <AreaChart data={data.series} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} stroke="#eef2f7" />
                <XAxis dataKey="date" tick={axis} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} tickFormatter={(d: string) => fmtDate(d).slice(0, 5)} minTickGap={28} />
                <YAxis tick={axis} tickFormatter={compact} tickLine={false} axisLine={false} width={52} />
                <Tooltip formatter={(v: number) => [money(v), 'Balance']} labelFormatter={(d: string) => fmtDate(d)} contentStyle={{ fontSize: 12, borderRadius: 6, borderColor: '#e2e8f0' }} />
                <Area type="stepAfter" dataKey="balance" name="Balance" stroke={SERIES} strokeWidth={2} fill={SERIES} fillOpacity={0.08} dot={false} activeDot={{ r: 4 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card divide-y divide-slate-100">
          <Total icon={<Wallet size={15} />} label="Cash In Hand" value={data.totals.cash} />
          <Total icon={<Landmark size={15} />} label="Bank Balance" value={data.totals.bank} />
          <Total icon={<CreditCard size={15} />} label="Card Balance" value={data.totals.card} />
          {data.uncategorized > 0 && (
            <div className="flex items-center gap-2 px-4 py-3 text-[13px] text-amber-700">
              <ListFilter size={15} />
              {data.uncategorized} uncategorized transaction{data.uncategorized === 1 ? '' : 's'} to review
            </div>
          )}
        </div>
      </div>

      <div className="px-5 pb-8">
        <div className="mb-2 flex items-center justify-between">
          <ViewPicker compact value={view} onChange={setView} options={[{ value: 'active', label: 'Active Accounts' }, { value: 'inactive', label: 'Inactive Accounts' }, { value: 'all', label: 'All Accounts' }]} />
        </div>
        <table className="table rounded-md border border-slate-200">
          <thead>
            <tr>
              <th className="pl-4">Account Details</th>
              <th>Uncategorized</th>
              <th className="text-right">Amount in Bank</th>
              <th className="text-right">Amount in Creatign Ledger</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="row-link" onClick={() => navigate(`/banking/${a.id}`)}>
                <td className="pl-4">
                  <div className="flex items-center gap-3">
                    <span className={clsx('flex h-8 w-8 items-center justify-center rounded-full', a.subType === 'credit_card' ? 'bg-violet-50 text-violet-600' : a.subType === 'cash' ? 'bg-emerald-50 text-emerald-600' : 'bg-brand-50 text-brand-600')}>
                      <AccountIcon subType={a.subType} />
                    </span>
                    <div>
                      <div className="font-medium text-brand-700">
                        {a.name}
                        {a.primary && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xxs font-normal text-slate-600">Primary</span>}
                        {a.active === false && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xxs font-normal text-slate-500">Inactive</span>}
                      </div>
                      <div className="text-xs text-slate-500">{[a.bankName, a.accountNumber && `xx${a.accountNumber.slice(-4)}`].filter(Boolean).join(' · ') || subTypeLabel(a.subType)}</div>
                    </div>
                  </div>
                </td>
                <td>{a.uncategorized ? <span className="font-medium text-amber-700">{a.uncategorized}</span> : <span className="text-slate-400">-</span>}</td>
                <td className="text-right tabular-nums">{a.statementBalance == null ? <span className="text-slate-400">-</span> : money(a.statementBalance)}</td>
                <td className="text-right tabular-nums">{money(a.booksBalance)}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <MoreMenu>
                    <MenuItem onClick={() => navigate(`/banking/${a.id}/import`)}>Import Statement</MenuItem>
                    <MenuItem onClick={() => navigate(`/banking/${a.id}/reconcile`)}>Reconcile</MenuItem>
                    <MenuItem onClick={() => navigate(`/banking/${a.id}/edit`)}>Edit</MenuItem>
                    {a.active === false ? <MenuItem onClick={() => setActive.mutate({ id: a.id, active: true })}>Mark as Active</MenuItem> : !a.system && <MenuItem onClick={() => setActive.mutate({ id: a.id, active: false })}>Mark as Inactive</MenuItem>}
                    {!a.system && (
                      <MenuItem danger onClick={() => confirm.ask('Delete account', `Delete ${a.name}? Accounts with transactions cannot be deleted.`, () => del.mutate(a.id), { danger: true, label: 'Delete' })}>
                        Delete
                      </MenuItem>
                    )}
                  </MoreMenu>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="py-14 text-center text-slate-500">
                  No accounts here. <Link className="link" to="/banking/new">Add a bank or credit card</Link> to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {confirm.node}
    </div>
  );
}

export const subTypeLabel = (s: string) => ({ bank: 'Bank', cash: 'Cash', credit_card: 'Credit Card', payment_clearing: 'Payment Clearing' })[s] ?? s;

function Total({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="flex items-center gap-2 text-[13px] text-slate-600">
        <span className="text-slate-400">{icon}</span>
        {label}
      </div>
      <div className="font-semibold tabular-nums">{money(value)}</div>
    </div>
  );
}
