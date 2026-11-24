// Accountant > Budgets: list, New Budget (name, fiscal year, period, income/expense accounts,
// optional balance sheet accounts) and the Profit and Loss budget grid grouped like Zoho.
import { Fragment, useEffect, useState } from 'react';
import { Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { MinusCircle, Pencil, Plus, Printer, Trash2, X } from 'lucide-react';
import { accountTypeLabel } from '@shared/accountant';
import { budgetBuckets, fiscalYearLabel } from '@shared/projects';
import { money, today } from '@shared/format';
import type { Account, Budget, BudgetPeriod } from '@shared/types';
import { api, useAction, useApi } from '../../api';
import { useBoot } from '../../lib/app';
import { Dropdown, Field, MenuItem, Select, Spinner, clsx, useConfirm } from '../../components/ui';
import { ListHeader } from '../../components/split';

type BudgetView = Omit<Budget, 'lines'> & { projectName?: string; buckets: { from: string; to: string; label: string }[]; lines: (Budget['lines'][number] & { accountName: string; accountType?: string; actuals: number[]; total: number; actualTotal: number })[] };

const BASE = '/accountant/budgets';
const PERIODS: { value: BudgetPeriod; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'half_yearly', label: 'Half-yearly' },
  { value: 'yearly', label: 'Yearly' },
];
const periodLabel = (p: string) => PERIODS.find((x) => x.value === p)?.label ?? p;

const fyStarts = (fyMonth: number) => {
  const t = today();
  const y = Number(t.slice(0, 4)) - (Number(t.slice(5, 7)) < fyMonth ? 1 : 0);
  return [-1, 0, 1, 2].map((o) => `${y + o}-${String(fyMonth).padStart(2, '0')}-01`);
};

/** Zoho groups the P&L budget as Income (Income, Other Income) and Expense (COGS, Expense, Other Expense). */
const SECTIONS: { title: string; groups: { title: string; subTypes: string[] }[] }[] = [
  { title: 'Income', groups: [{ title: 'Income', subTypes: ['income'] }, { title: 'Other Income', subTypes: ['other_income'] }] },
  { title: 'Expense', groups: [{ title: 'Cost Of Goods Sold', subTypes: ['cost_of_goods_sold'] }, { title: 'Expense', subTypes: ['expense'] }, { title: 'Other Expense', subTypes: ['other_expense'] }] },
];
const BS_SECTIONS: { title: string; type: string }[] = [
  { title: 'Assets', type: 'asset' },
  { title: 'Liabilities', type: 'liability' },
  { title: 'Equity', type: 'equity' },
];

function BudgetList() {
  const navigate = useNavigate();
  const { data = [], isLoading } = useApi<BudgetView[]>('/budgets');
  return (
    <div>
      <ListHeader title={<h1 className="text-[19px]">Budgets</h1>}>
        <button className="btn-primary" onClick={() => navigate(`${BASE}/new`)}>
          <Plus size={15} /> New
        </button>
      </ListHeader>
      {isLoading ? (
        <Spinner />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th className="pl-5">Name</th>
              <th>Fiscal Year</th>
              <th>Budget Period</th>
              <th>Project</th>
              <th className="text-right">Budgeted Income</th>
              <th className="pr-5 text-right">Budgeted Expense</th>
            </tr>
          </thead>
          <tbody>
            {data.map((b) => (
              <tr key={b.id} className="row-link" onClick={() => navigate(`${BASE}/${b.id}`)}>
                <td className="pl-5 font-medium text-brand-600">{b.name}</td>
                <td>{fiscalYearLabel(b.fiscalYearStart)}</td>
                <td>{periodLabel(b.period)}</td>
                <td>{b.projectName || '-'}</td>
                <td className="text-right tabular-nums">{money(b.lines.filter((l) => l.accountType === 'income').reduce((s, l) => s + l.total, 0))}</td>
                <td className="pr-5 text-right tabular-nums">{money(b.lines.filter((l) => l.accountType === 'expense').reduce((s, l) => s + l.total, 0))}</td>
              </tr>
            ))}
            {!data.length && (
              <tr>
                <td colSpan={6} className="py-16 text-center">
                  <div className="text-[15px] font-medium text-slate-700">Plan your year with budgets</div>
                  <div className="mt-1 text-slate-500">Set monthly, quarterly or yearly targets for income and expense accounts, then compare them with actuals.</div>
                  <button className="btn-primary mt-4" onClick={() => navigate(`${BASE}/new`)}>
                    <Plus size={14} /> New Budget
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

type Draft = { accountId: string; amounts: (number | string)[] };

function AccountAdder({ accounts, picked, onAdd }: { accounts: Account[]; picked: string[]; onAdd: (ids: string[]) => void }) {
  const avail = accounts.filter((a) => !picked.includes(a.id) && a.active);
  const chosen = accounts.filter((a) => picked.includes(a.id));
  return (
    <Dropdown
      className="w-full"
      button={() => (
        <div className="flex min-h-[32px] w-full flex-wrap items-center gap-1 rounded-md border border-dashed border-slate-300 px-2 py-1 text-left text-[13px] hover:border-brand-400">
          {chosen.map((a) => (
            <span key={a.id} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
              {a.name}
            </span>
          ))}
          <span className="text-brand-600">Add Accounts</span>
        </div>
      )}
    >
      <div className="max-h-72 overflow-auto">
        {avail.length > 1 && <MenuItem onClick={() => onAdd(avail.map((a) => a.id))}><span className="font-medium text-brand-700">Select all ({avail.length})</span></MenuItem>}
        {avail.map((a) => (
          <MenuItem key={a.id} onClick={() => onAdd([a.id])}>
            <span>{a.name}</span>
            <span className="ml-auto text-[11px] text-slate-400">{accountTypeLabel(a.subType)}</span>
          </MenuItem>
        ))}
        {!avail.length && <div className="px-3 py-2 text-[13px] text-slate-400">All accounts added</div>}
      </div>
    </Dropdown>
  );
}

/** The grouped budget grid, editable (draft amounts) or read-only. */
function BudgetGrid({ accounts, lines, buckets, includeBs, onChange }: { accounts: Account[]; lines: Draft[]; buckets: { from: string; label: string }[]; includeBs: boolean; onChange?: (l: Draft[]) => void }) {
  const acct = (id: string) => accounts.find((a) => a.id === id);
  const amt = (l: Draft, i: number) => Number(l.amounts[i]) || 0;
  const totalOf = (ls: Draft[], i?: number) => ls.reduce((s, l) => s + (i == null ? buckets.reduce((t, _, k) => t + amt(l, k), 0) : amt(l, i)), 0);
  const setAmt = (aid: string, i: number, v: string) => onChange?.(lines.map((l) => (l.accountId === aid ? { ...l, amounts: Object.assign([...l.amounts], { [i]: v }) } : l)));
  const fill = (aid: string) => onChange?.(lines.map((l) => (l.accountId === aid ? { ...l, amounts: buckets.map(() => l.amounts[0] ?? '') } : l)));
  const totalRow = (label: string, ls: Draft[], strong?: boolean) => (
    <tr className={clsx(strong ? 'bg-slate-50 font-semibold' : 'font-semibold')}>
      <td className="sticky left-0 z-10 bg-inherit pl-6">{label}</td>
      {buckets.map((b, i) => (
        <td key={b.from} className="text-right tabular-nums">
          {money(totalOf(ls, i), '')}
        </td>
      ))}
      <td className="text-right tabular-nums">{money(totalOf(ls), '')}</td>
      {onChange && <td />}
    </tr>
  );
  const accountRow = (l: Draft) => (
    <tr key={l.accountId}>
      <td className="sticky left-0 z-10 bg-white pl-10">
        <div>{acct(l.accountId)?.name}</div>
        {onChange && (
          <button className="text-[11px] text-brand-600 hover:underline" onClick={() => fill(l.accountId)}>
            Copy first amount across
          </button>
        )}
      </td>
      {buckets.map((b, i) => (
        <td key={b.from} className="text-right">
          {onChange ? <input className="input h-7 text-right tabular-nums" inputMode="decimal" value={l.amounts[i] ?? ''} onChange={(e) => setAmt(l.accountId, i, e.target.value)} aria-label={`${acct(l.accountId)?.name} ${b.label}`} /> : <span className="tabular-nums">{money(amt(l, i), '')}</span>}
        </td>
      ))}
      <td className="text-right font-medium tabular-nums">{money(totalOf([l]), '')}</td>
      {onChange && (
        <td>
          <button className="text-slate-400 hover:text-red-500" onClick={() => onChange(lines.filter((x) => x.accountId !== l.accountId))} aria-label="Remove account">
            <X size={14} />
          </button>
        </td>
      )}
    </tr>
  );
  const head = (title: string, depth: number) => (
    <tr>
      <td colSpan={buckets.length + (onChange ? 3 : 2)} className={clsx('sticky left-0 bg-white font-medium', depth ? 'pl-6' : 'pl-3')}>
        <MinusCircle size={12} className="mr-1.5 inline text-brand-600" />
        {title}
      </td>
    </tr>
  );
  const plLines = (subTypes: string[]) => lines.filter((l) => subTypes.includes(acct(l.accountId)?.subType || ''));
  const income = plLines(['income', 'other_income']);
  const expense = plLines(['cost_of_goods_sold', 'expense', 'other_expense']);
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="table min-w-max">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 min-w-[240px] bg-slate-50">Account</th>
            {buckets.map((b) => (
              <th key={b.from} className="min-w-[96px] text-right">
                {b.label}
              </th>
            ))}
            <th className="min-w-[110px] text-right">Total</th>
            {onChange && <th className="w-8" />}
          </tr>
        </thead>
        <tbody>
          {SECTIONS.map((s) => (
            <Fragment key={s.title}>
              {head(s.title, 0)}
              {s.groups.map((g) => (
                <Fragment key={g.title}>
                  {head(g.title, 1)}
                  {plLines(g.subTypes).map(accountRow)}
                  {totalRow(`Total for ${g.title}`, plLines(g.subTypes))}
                </Fragment>
              ))}
              {totalRow(`Total for ${s.title}`, s.title === 'Income' ? income : expense, true)}
            </Fragment>
          ))}
          <tr className="bg-brand-50 font-semibold">
            <td className="sticky left-0 z-10 bg-brand-50 pl-3">Total for Profit and Loss</td>
            {buckets.map((b, i) => (
              <td key={b.from} className="text-right tabular-nums">
                {money(totalOf(income, i) - totalOf(expense, i), '')}
              </td>
            ))}
            <td className="text-right tabular-nums">{money(totalOf(income) - totalOf(expense), '')}</td>
            {onChange && <td />}
          </tr>
          {includeBs &&
            BS_SECTIONS.map((s) => {
              const ls = lines.filter((l) => acct(l.accountId)?.type === s.type);
              return (
                <Fragment key={s.title}>
                  {head(s.title, 0)}
                  {ls.map(accountRow)}
                  {totalRow(`Total for ${s.title}`, ls, true)}
                </Fragment>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

function BudgetForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { accounts, organization } = useBoot();
  const { data: existing } = useApi<BudgetView>(id ? `/budgets/${id}` : null);
  const { data: projects = [] } = useApi<{ id: string; name: string }[]>('/projects?view=active');
  const [name, setName] = useState('');
  const [fy, setFy] = useState(fyStarts(organization.fiscalYearStartMonth)[1]);
  const [period, setPeriod] = useState<BudgetPeriod>('monthly');
  const [projectId, setProjectId] = useState('');
  const [includeBs, setIncludeBs] = useState(false);
  const [lines, setLines] = useState<Draft[]>([]);
  useEffect(() => {
    if (!existing) return;
    setName(existing.name);
    setFy(existing.fiscalYearStart);
    setPeriod(existing.period);
    setProjectId(existing.projectId || '');
    setIncludeBs(existing.includeBalanceSheet);
    setLines(existing.lines.map((l) => ({ accountId: l.accountId, amounts: [...l.amounts] })));
  }, [existing]);
  const buckets = budgetBuckets(fy, period);
  const save = useAction(() => {
    const body = { name, fiscalYearStart: fy, period, projectId: projectId || undefined, includeBalanceSheet: includeBs, lines: lines.map((l) => ({ accountId: l.accountId, amounts: buckets.map((_, i) => Number(l.amounts[i]) || 0) })) };
    return id ? api<Budget>(`/budgets/${id}`, { method: 'PUT', body }) : api<Budget>('/budgets', { body });
  }, id ? 'Budget updated' : 'Budget created');
  const picked = lines.map((l) => l.accountId);
  const add = (ids: string[]) => setLines([...lines, ...ids.map((a) => ({ accountId: a, amounts: [] }))]);
  const groups: [string, (a: Account) => boolean][] = [
    ['Income Accounts', (a) => a.type === 'income'],
    ['Expense Accounts', (a) => a.type === 'expense'],
    ...(includeBs ? ([['Asset Accounts', (a: Account) => a.type === 'asset'], ['Liability Accounts', (a: Account) => a.type === 'liability'], ['Equity Accounts', (a: Account) => a.type === 'equity']] as [string, (a: Account) => boolean][]) : []),
  ];
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <h1 className="text-[19px]">{id ? 'Edit Budget' : 'New Budget'}</h1>
        <button className="btn-ghost w-8 px-0" onClick={() => navigate(-1)} aria-label="Close">
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 space-y-6 py-5">
        <div className="bg-slate-50 px-5 py-4">
          <Field label="Name" required>
            <input className="input max-w-md" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <div className="max-w-2xl space-y-3 px-5">
          <Field label="Fiscal Year" required>
            <Select className="max-w-md" value={fy} onChange={(e) => setFy(e.target.value)} options={fyStarts(organization.fiscalYearStartMonth).map((s) => ({ value: s, label: fiscalYearLabel(s) }))} />
          </Field>
          <Field label="Budget Period" required>
            <Select className="max-w-md" value={period} onChange={(e) => setPeriod(e.target.value as BudgetPeriod)} options={PERIODS} />
          </Field>
          {projects.length > 0 && (
            <Field label="Project">
              <Select className="max-w-md" value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="All transactions (no project)" options={projects.map((p) => ({ value: p.id, label: p.name }))} />
            </Field>
          )}
        </div>
        <div className="max-w-2xl space-y-3 px-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Income and Expense Accounts</div>
          {groups.map(([label, pred]) => (
            <Field key={label} label={label}>
              <div className="max-w-md">
                <AccountAdder accounts={accounts.filter(pred)} picked={picked} onAdd={add} />
              </div>
            </Field>
          ))}
          {!includeBs && (
            <button className="flex items-center gap-1.5 text-[13px] text-slate-700 hover:text-brand-700" onClick={() => setIncludeBs(true)}>
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-brand-600 text-white">
                <Plus size={11} />
              </span>
              Include Asset, Liability, and Equity Accounts in Budget
            </button>
          )}
        </div>
        {lines.length > 0 && (
          <div className="px-5">
            <BudgetGrid accounts={accounts} lines={lines} buckets={buckets} includeBs={includeBs} onChange={setLines} />
          </div>
        )}
      </div>
      <div className="sticky bottom-0 flex gap-2 border-t border-slate-200 bg-white px-5 py-3">
        <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: (b) => navigate(`${BASE}/${b.id}`) })}>
          {id ? 'Save' : 'Create Budget'}
        </button>
        <button className="btn-secondary" onClick={() => navigate(-1)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function BudgetDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { accounts } = useBoot();
  const { data: b, isLoading } = useApi<BudgetView>(`/budgets/${id}`);
  const del = useAction(() => api(`/budgets/${id}`, { method: 'DELETE' }), 'Budget deleted');
  const confirm = useConfirm();
  if (isLoading || !b) return <Spinner />;
  return (
    <div>
      <div className="no-print flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <div>
          <h1 className="text-[20px]">{b.name}</h1>
          <div className="text-xs text-slate-500">
            {fiscalYearLabel(b.fiscalYearStart)} · {periodLabel(b.period)}
            {b.projectName && ` · ${b.projectName}`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-icon" title="Edit" onClick={() => navigate(`${BASE}/${b.id}/edit`)}>
            <Pencil size={14} />
          </button>
          <button className="btn-icon" title="Print" onClick={() => window.print()}>
            <Printer size={14} />
          </button>
          <button className="btn-primary" onClick={() => navigate(`/reports/budget-vs-actuals?budgetId=${b.id}`)}>
            View Budget vs Actuals
          </button>
          <button className="btn-icon text-slate-500 hover:text-red-600" title="Delete" onClick={() => confirm.ask('Delete budget', `Delete ${b.name}?`, () => del.mutate(undefined, { onSuccess: () => navigate(BASE) }), { danger: true, label: 'Delete' })}>
            <Trash2 size={14} />
          </button>
          <button className="btn-ghost w-8 px-0" onClick={() => navigate(BASE)} aria-label="Close">
            <X size={18} />
          </button>
        </div>
      </div>
      <div className="print-area p-5">
        <div className="mb-3 flex gap-6 border-b border-slate-200">
          <span className="tab tab-active">Profit and Loss</span>
        </div>
        <BudgetGrid accounts={accounts} lines={b.lines.map((l) => ({ accountId: l.accountId, amounts: l.amounts }))} buckets={b.buckets} includeBs={b.includeBalanceSheet} />
        <p className="mt-3 text-xs text-slate-500">
          **Amount is displayed in your base currency <span className="rounded bg-emerald-600 px-1 text-white">INR</span>
        </p>
      </div>
      {confirm.node}
    </div>
  );
}

export default function Budgets() {
  return (
    <Routes>
      <Route index element={<BudgetList />} />
      <Route path="new" element={<BudgetForm />} />
      <Route path=":id/edit" element={<BudgetForm />} />
      <Route path=":id" element={<BudgetDetail />} />
    </Routes>
  );
}
