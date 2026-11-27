// Accountant > Budgets: list, New Budget (name, fiscal year, period, income/expense accounts,
// optional balance sheet accounts) and the Profit and Loss budget grid in the standard grouping.
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
import { ExportMenu } from '../../components/ExportMenu';
import { CsvImportButton, type CsvImportRecord, type CsvImportResult } from '../../components/CsvImportButton';

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

/** Group the P&L budget as Income (Income, Other Income) and Expense (COGS, Expense, Other Expense). */
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
  const { accounts } = useBoot();
  const [selected, setSelected] = useState<string[]>([]);
  const { data = [], isLoading } = useApi<BudgetView[]>('/budgets');
  const { data: projects = [] } = useApi<{ id: string; name: string }[]>('/projects?view=all');
  const allSelected = data.length > 0 && data.every((b) => selected.includes(b.id));
  const exportRows = selected.length ? data.filter((b) => selected.includes(b.id)) : data;
  const totalFor = (b: BudgetView, type: string) => b.lines.filter((l) => l.accountType === type).reduce((s, l) => s + l.total, 0);
  const importBudgets = async (records: CsvImportRecord[]): Promise<CsvImportResult[]> => {
    type ImportedBudget = { key: string; rowNumber: number; name: string; fiscalYearStart: string; period: BudgetPeriod; projectId?: string; lines: { accountId: string; amounts: number[] }[]; includeBalanceSheet: boolean; invalid?: string };
    const groups = new Map<string, ImportedBudget>();
    const results: CsvImportResult[] = [];
    for (const record of records) {
      const name = record.get('Budget Name', 'Name');
      if (!name) {
        results.push({ rowNumber: record.rowNumber, label: 'Budget', success: false, message: 'Budget Name is required' });
        continue;
      }
      const projectText = record.get('Project', 'Project Name');
      const project = projectText ? projects.find((item) => item.id === projectText || item.name.toLowerCase() === projectText.toLowerCase()) : undefined;
      const key = `${name.toLowerCase()}|${project?.id || projectText || ''}`;
      const existing = groups.get(key);
      const row = existing ?? {
        key,
        rowNumber: record.rowNumber,
        name,
        fiscalYearStart: '',
        period: 'monthly' as BudgetPeriod,
        projectId: project?.id,
        lines: [],
        includeBalanceSheet: false,
      };
      try {
        if (projectText && !project) throw new Error(`Project "${projectText}" was not found`);
        const fiscalYearStart = record.get('Fiscal Year Start', 'FY Start');
        if (!fiscalYearStart || !/^\d{4}-\d{2}-01$/.test(fiscalYearStart) || Number.isNaN(Date.parse(`${fiscalYearStart}T00:00:00`))) {
          throw new Error('Fiscal Year Start must be the first day of a month in YYYY-MM-01 format');
        }
        const periodText = (record.get('Budget Period', 'Period') || 'monthly').toLowerCase().replace(/[\s-]/g, '_');
        const period = periodText === 'month' ? 'monthly' : periodText === 'quarter' ? 'quarterly' : periodText === 'half_year' ? 'half_yearly' : periodText === 'year' ? 'yearly' : periodText;
        if (!['monthly', 'quarterly', 'half_yearly', 'yearly'].includes(period)) throw new Error(`Unknown Budget Period "${periodText}"`);
        if (existing && (existing.fiscalYearStart !== fiscalYearStart || existing.period !== period || existing.projectId !== project?.id)) {
          throw new Error('Rows in the same budget must use matching fiscal year, period, and project');
        }
        const accountText = record.get('Account', 'Account Name', 'Account ID');
        const account = accounts.find((item) => item.id === accountText || item.name.toLowerCase() === accountText?.toLowerCase());
        if (!account) throw new Error(`Account "${accountText || ''}" was not found`);
        const bucketCount = period === 'monthly' ? 12 : period === 'quarterly' ? 4 : period === 'half_yearly' ? 2 : 1;
        const amountText = record.get('Amounts', 'Budget Amounts');
        const amountValues = amountText
          ? amountText.split('|')
          : Array.from({ length: bucketCount }, (_, index) => record.get(`Period ${index + 1}`, `Amount ${index + 1}`));
        if (amountValues.length > bucketCount) throw new Error(`This budget period accepts at most ${bucketCount} amount(s) per account`);
        const amounts = Array.from({ length: bucketCount }, (_, index) => {
          const value = amountValues[index];
          const amount = value ? Number(value.replace(/[^\d.-]/g, '')) : 0;
          if (!Number.isFinite(amount) || amount < 0) throw new Error('Amounts must be non-negative numbers');
          return amount;
        });
        if (row.lines.some((line) => line.accountId === account.id)) throw new Error(`Account "${account.name}" appears more than once in this budget`);
        row.fiscalYearStart = fiscalYearStart;
        row.period = period as BudgetPeriod;
        row.includeBalanceSheet ||= ['asset', 'liability', 'equity'].includes(account.type);
        row.lines.push({ accountId: account.id, amounts });
        groups.set(key, row);
      } catch (error) {
        row.invalid = error instanceof Error ? error.message : 'Import failed';
        groups.set(key, row);
      }
    }
    for (const group of groups.values()) {
      if (group.invalid) {
        results.push({ rowNumber: group.rowNumber, label: group.name, success: false, message: group.invalid });
        continue;
      }
      try {
        await api('/budgets', { body: {
          name: group.name,
          fiscalYearStart: group.fiscalYearStart,
          period: group.period,
          projectId: group.projectId,
          includeBalanceSheet: group.includeBalanceSheet,
          lines: group.lines,
        } });
        results.push({ rowNumber: group.rowNumber, label: group.name, success: true });
      } catch (error) {
        results.push({ rowNumber: group.rowNumber, label: group.name, success: false, message: error instanceof Error ? error.message : 'Import failed' });
      }
    }
    return results;
  };
  return (
    <div>
      <ListHeader title={<h1 className="text-[19px]">Budget Planner</h1>}>
        <CsvImportButton
          title="Budgets"
          filename="budgets"
          headers={['Budget Name', 'Fiscal Year Start', 'Budget Period', 'Project', 'Account', 'Amounts']}
          instructions="Import one account per row and repeat the same budget details on every row in that budget. Fiscal Year Start must be YYYY-MM-01. Amounts is a | separated list in fiscal-period order (12 monthly, 4 quarterly, 2 half-yearly, or 1 yearly value). Project is optional."
          onImport={importBudgets}
        />
        <ExportMenu rows={exportRows} filename="budgets" label={selected.length ? 'Export Selected' : 'Export'} columns={[
          { header: 'Name', value: (b) => b.name },
          { header: 'Fiscal Year', value: (b) => fiscalYearLabel(b.fiscalYearStart) },
          { header: 'Budget Period', value: (b) => periodLabel(b.period) },
          { header: 'Project', value: (b) => b.projectName },
          { header: 'Budgeted Income', value: (b) => totalFor(b, 'income') },
          { header: 'Budgeted Expense', value: (b) => totalFor(b, 'expense') },
        ]} />
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
              <th className="w-8 pl-4">
                <input type="checkbox" className="accent-brand-600" checked={allSelected} onChange={() => setSelected(allSelected ? [] : data.map((b) => b.id))} aria-label="Select all" />
              </th>
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
            <tr key={b.id} className={clsx('row-link', selected.includes(b.id) && 'bg-brand-50/50')} onClick={() => navigate(`${BASE}/${b.id}`)}>
              <td className="pl-4" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" className="accent-brand-600" checked={selected.includes(b.id)} onChange={() => setSelected((s) => s.includes(b.id) ? s.filter((x) => x !== b.id) : [...s, b.id])} aria-label={`Select ${b.name}`} />
              </td>
                <td className="pl-5 font-medium text-brand-600">{b.name}</td>
                <td>{fiscalYearLabel(b.fiscalYearStart)}</td>
                <td>{periodLabel(b.period)}</td>
                <td>{b.projectName || '-'}</td>
                <td className="text-right tabular-nums">{money(totalFor(b, 'income'))}</td>
                <td className="pr-5 text-right tabular-nums">{money(totalFor(b, 'expense'))}</td>
              </tr>
            ))}
            {!data.length && (
              <tr>
                <td colSpan={7} className="py-16 text-center">
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
