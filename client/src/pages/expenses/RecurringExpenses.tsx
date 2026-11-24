// Recurring Expenses: full list, Zoho-style split view (profiles on the left, profile on the right),
// a toolbar with Edit | Stop/Resume | Create Expense | ... (Clone, Delete), and the profile form.
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CalendarClock, Copy, MoreHorizontal, Pause, Pencil, Play, Plus, Receipt, Trash2, X } from 'lucide-react';
import { fmtDate, frequencyLabel, money, today } from '@shared/format';
import type { Expense, RecurringExpense } from '@shared/types';
import { api, useAction, useApi } from '../../api';
import { useBoot, isCashLike } from '../../lib/app';
import { toast } from '../../lib/toast';
import { AccountSelect, Checkbox, ContactPicker, DateInput, Dropdown, Field, FormFooter, MenuItem, MoneyInput, PageHeader, Spinner, Status, Tabs, clsx, useConfirm } from '../../components/ui';
import { Lifecycle, Timeline } from '../../components/shared';
import { RepeatSelect, ReportingTags, TagChips } from './parts';

type RRow = RecurringExpense & { accountName?: string; vendorName?: string; customerName?: string; children: number };
type RDetail = RecurringExpense & { accountName?: string; paidThroughName?: string; vendorName?: string; customerName?: string; children: Expense[] };

const STATUS_VIEWS = [
  { value: 'all', label: 'All Profiles' },
  { value: 'active', label: 'Active' },
  { value: 'stopped', label: 'Stopped' },
  { value: 'expired', label: 'Expired' },
];

function useProfiles(status: string) {
  const q = useApi<RRow[]>('/recurring-expenses');
  return { ...q, data: (q.data || []).filter((r) => status === 'all' || r.status === status) };
}

function StatusPicker({ status, setStatus }: { status: string; setStatus: (s: string) => void }) {
  return (
    <Dropdown button={() => <button className="text-[15px] font-semibold text-slate-900">{STATUS_VIEWS.find((v) => v.value === status)?.label} ▾</button>}>
      {STATUS_VIEWS.map((v) => (
        <MenuItem key={v.value} onClick={() => setStatus(v.value)}>
          {v.label}
        </MenuItem>
      ))}
    </Dropdown>
  );
}

function RecurringList() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('all');
  const { data, isLoading } = useProfiles(status);
  if (isLoading) return <Spinner />;
  const empty = !data.length && status === 'all';
  return (
    <div>
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <StatusPicker status={status} setStatus={setStatus} />
        <div className="flex gap-2">
          <button className="btn-primary" onClick={() => navigate('/purchases/recurring-expenses/new')}>
            <Plus size={15} /> New
          </button>
          <Dropdown align="right" button={() => <button className="btn-icon" aria-label="More"><MoreHorizontal size={15} /></button>}>
            <MenuItem onClick={() => navigate('/settings/import')}>Import Recurring Expenses</MenuItem>
          </Dropdown>
        </div>
      </div>
      {empty ? (
        <Lifecycle
          title="Create. Set. Repeat."
          subtitle="Do you have recurring expenses that you pay at regular intervals? Create a profile and the expenses are recorded for you."
          steps={['CREATE RECURRING EXPENSE', ['BILLABLE', 'NON-BILLABLE']]}
          actions={
            <>
              <button className="btn-primary" onClick={() => navigate('/purchases/recurring-expenses/new')}>
                NEW RECURRING EXPENSE
              </button>
              <button className="btn-secondary" onClick={() => navigate('/settings/import')}>
                Import Recurring Expenses
              </button>
            </>
          }
        />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Profile Name</th>
              <th>Expense Account</th>
              <th>Vendor Name</th>
              <th>Frequency</th>
              <th>Last Expense Date</th>
              <th>Next Expense Date</th>
              <th>Status</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id} className="row-link" onClick={() => navigate(`/purchases/recurring-expenses/${r.id}`)}>
                <td className="text-brand-600">{r.profileName}</td>
                <td>{r.accountName}</td>
                <td>{r.vendorName}</td>
                <td>{frequencyLabel(r.repeatEvery)}</td>
                <td>{fmtDate(r.lastGeneratedDate) || '-'}</td>
                <td>{r.status === 'active' ? fmtDate(r.nextDate) : '-'}</td>
                <td>
                  <Status status={r.status} />
                </td>
                <td className="text-right tabular-nums">{money(r.amount)}</td>
              </tr>
            ))}
            {!data.length && (
              <tr>
                <td colSpan={8} className="py-10 text-center text-slate-400">
                  No profiles in this view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function RecurringListPane() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('all');
  const { data } = useProfiles(status);
  return (
    <div className="no-print flex w-[320px] shrink-0 flex-col border-r border-slate-200">
      <div className="flex h-[57px] items-center justify-between border-b border-slate-200 px-3">
        <StatusPicker status={status} setStatus={setStatus} />
        <button className="btn-primary w-8 px-0" onClick={() => navigate('/purchases/recurring-expenses/new')} aria-label="New profile">
          <Plus size={15} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {data.map((r) => (
          <Link key={r.id} to={`/purchases/recurring-expenses/${r.id}`} className={clsx('block border-b border-slate-100 px-3 py-3 hover:bg-slate-50', r.id === id && 'bg-brand-50/70')}>
            <div className="flex justify-between gap-2">
              <span className="truncate font-medium text-slate-800">{r.profileName}</span>
              <span className="shrink-0 tabular-nums">{money(r.amount)}</span>
            </div>
            <div className="mt-0.5 truncate text-xs text-slate-500">
              {r.accountName} • {frequencyLabel(r.repeatEvery)}
            </div>
            <Status status={r.status} className="mt-0.5 block" />
          </Link>
        ))}
        {!data.length && <div className="px-4 py-10 text-center text-[13px] text-slate-400">No profiles in this view.</div>}
      </div>
    </div>
  );
}

function ToolbarBtn({ children, icon, onClick }: { children: ReactNode; icon?: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-10 items-center gap-1.5 border-r border-slate-200 px-3.5 text-[13px] text-slate-700 hover:bg-white hover:text-brand-700">
      {icon}
      {children}
    </button>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 py-1.5 text-[13px]">
      <div className="text-slate-500">{label}</div>
      <div className="text-slate-800">{children || '-'}</div>
    </div>
  );
}

function RecurringDetailPane() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: r, isLoading, error } = useApi<RDetail>(`/recurring-expenses/${id}`);
  const [tab, setTab] = useState<'expenses' | 'history'>('expenses');
  const act = useAction(
    (a: string) => api<RecurringExpense & { createdExpenseId?: string }>(`/recurring-expenses/${id}/actions/${a}`, { body: {} }),
    (res) => (res.createdExpenseId ? 'Expense created' : res.status === 'stopped' ? 'Profile stopped' : 'Profile resumed'),
  );
  const del = useAction(() => api(`/recurring-expenses/${id}`, { method: 'DELETE' }), 'Profile deleted');
  const confirm = useConfirm();
  useEffect(() => setTab('expenses'), [id]);
  if (isLoading) return <Spinner />;
  if (error || !r) return <div className="p-8 text-red-600">{(error as Error)?.message || 'Profile not found'}</div>;
  const total = r.children.reduce((s, c) => s + c.amount, 0);
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="no-print flex h-[57px] items-center justify-between border-b border-slate-200 px-5">
        <div className="min-w-0">
          <div className="text-xs text-slate-500">Recurring Expense</div>
          <h1 className="truncate text-[17px] font-semibold">{r.profileName}</h1>
        </div>
        <button className="btn-ghost w-8 px-0 text-red-500" title="Close" onClick={() => navigate('/purchases/recurring-expenses')}>
          <X size={18} />
        </button>
      </div>
      <div className="no-print flex flex-wrap items-center border-b border-slate-200 bg-slate-50/70 px-2">
        <ToolbarBtn icon={<Pencil size={14} />} onClick={() => navigate(`/purchases/recurring-expenses/${r.id}/edit`)}>
          Edit
        </ToolbarBtn>
        {r.status === 'active' ? (
          <ToolbarBtn icon={<Pause size={14} />} onClick={() => act.mutate('stop')}>
            Stop
          </ToolbarBtn>
        ) : (
          r.status === 'stopped' && (
            <ToolbarBtn icon={<Play size={14} />} onClick={() => act.mutate('resume')}>
              Resume
            </ToolbarBtn>
          )
        )}
        <ToolbarBtn icon={<Receipt size={14} />} onClick={() => act.mutate('create_expense', { onSuccess: (res) => res.createdExpenseId && navigate(`/purchases/expenses/${res.createdExpenseId}`) })}>
          Create Expense
        </ToolbarBtn>
        <Dropdown button={() => <button className="btn-ghost h-10 rounded-none border-r border-slate-200 px-3" aria-label="More actions"><MoreHorizontal size={16} /></button>}>
          <MenuItem icon={<Copy size={13} />} onClick={() => navigate(`/purchases/recurring-expenses/new?clone=${r.id}`)}>
            Clone
          </MenuItem>
          <MenuItem
            danger
            icon={<Trash2 size={13} />}
            onClick={() => confirm.ask('Delete profile', 'The profile will be deleted. Expenses already created from it stay as they are.', () => del.mutate(undefined, { onSuccess: () => navigate('/purchases/recurring-expenses') }), { danger: true, label: 'Delete' })}
          >
            Delete
          </MenuItem>
        </Dropdown>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {r.status === 'active' && r.nextDate && (
          <div className="mb-4 flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-4 py-2.5 text-[13px] text-sky-900">
            <CalendarClock size={15} />
            <span>
              The next expense will be created on <b>{fmtDate(r.nextDate)}</b>.
            </span>
          </div>
        )}
        {r.status === 'stopped' && <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900">This profile is stopped. Resume it to continue creating expenses.</div>}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded-lg border border-slate-200 p-5">
            <div className="text-xs text-slate-500">Expense Amount</div>
            <div className="text-[24px] font-medium text-red-500 tabular-nums">{money(r.amount)}</div>
            <div className="mb-3 text-[13px] font-medium uppercase tracking-wide text-slate-600">{r.billable ? 'Billable' : 'Non-Billable'}</div>
            <span className="rounded bg-sky-100 px-3 py-1 text-xs text-sky-900">{r.accountName}</span>
            <div className="mt-4">
              <Detail label="Paid Through">{r.paidThroughName}</Detail>
              <Detail label="Paid To">{r.vendorId ? <Link className="link" to={`/purchases/vendors/${r.vendorId}`}>{r.vendorName}</Link> : null}</Detail>
              <Detail label="Customer">{r.customerId ? <Link className="link" to={`/sales/customers/${r.customerId}`}>{r.customerName}</Link> : null}</Detail>
              {r.notes && <Detail label="Notes">{r.notes}</Detail>}
              {Object.keys(r.reportingTags || {}).length > 0 && (
                <Detail label="Reporting Tags">
                  <TagChips tags={r.reportingTags} />
                </Detail>
              )}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 p-5">
            <div className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">Profile</div>
            <Detail label="Status">
              <Status status={r.status} />
            </Detail>
            <Detail label="Repeats">{frequencyLabel(r.repeatEvery)}</Detail>
            <Detail label="Start Date">{fmtDate(r.startOn)}</Detail>
            <Detail label="End Date">{r.neverExpires ? 'Never Expires' : fmtDate(r.endsOn)}</Detail>
            <Detail label="Last Expense">{fmtDate(r.lastGeneratedDate)}</Detail>
            <Detail label="Next Expense">{r.status === 'active' ? fmtDate(r.nextDate) : '-'}</Detail>
            <Detail label="Expenses Created">
              {r.children.length} ({money(total)})
            </Detail>
          </div>
        </div>
        <Tabs
          tabs={[
            { value: 'expenses', label: `Child Expenses (${r.children.length})` },
            { value: 'history', label: 'History' },
          ]}
          value={tab}
          onChange={setTab}
          className="mb-4 mt-8"
        />
        {tab === 'expenses' && (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Expense Account</th>
                <th>Status</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {r.children.map((c) => (
                <tr key={c.id} className="row-link" onClick={() => navigate(`/purchases/expenses/${c.id}`)}>
                  <td>{fmtDate(c.date)}</td>
                  <td className="text-brand-600">{r.accountName}</td>
                  <td>
                    <Status status={c.status} />
                  </td>
                  <td className="text-right tabular-nums">{money(c.amount)}</td>
                </tr>
              ))}
              {!r.children.length && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-slate-400">
                    Expenses are created automatically on each due date. Use Create Expense to record one now.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
        {tab === 'history' && <Timeline entityId={r.id} />}
      </div>
      {confirm.node}
    </div>
  );
}

function RecurringForm() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { accounts } = useBoot();
  const fromExpense = search.get('fromExpense');
  const cloneId = search.get('clone');
  const { data: existing } = useApi<RecurringExpense>(id ? `/recurring-expenses/${id}` : cloneId ? `/recurring-expenses/${cloneId}` : null);
  const { data: src } = useApi<Expense>(fromExpense ? `/expenses/${fromExpense}` : null);
  const [f, setF] = useState<Partial<RecurringExpense> | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (f) return;
    if (id || cloneId) {
      if (!existing) return;
      if (id) setF(existing);
      else {
        const { id: _id, lastGeneratedDate: _l, nextDate: _n, createdAt: _c, updatedAt: _u, status: _s, ...rest } = existing;
        setF({ ...rest, profileName: `${rest.profileName} (copy)`, startOn: today() });
      }
      return;
    }
    if (fromExpense && !src) return;
    setF({ repeatEvery: { n: 1, unit: 'month' }, startOn: today(), neverExpires: true, paidThroughAccountId: 'acc_petty_cash', billable: false, reportingTags: {}, ...(src ? { accountId: src.accountId, amount: src.amount, vendorId: src.vendorId, customerId: src.customerId, notes: src.notes, paidThroughAccountId: src.paidThroughAccountId, billable: src.billable } : {}) });
  }, [existing, src, f, id, cloneId, fromExpense]);
  if (!f) return <Spinner />;
  const set = (p: Partial<RecurringExpense>) => setF({ ...f, ...p });
  async function save() {
    setSaving(true);
    try {
      const saved = await api<RecurringExpense>(id ? `/recurring-expenses/${id}` : '/recurring-expenses', { method: id ? 'PUT' : 'POST', body: f });
      toast.success('Recurring expense saved');
      navigate(`/purchases/recurring-expenses/${saved.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader title={id ? 'Edit Recurring Expense' : 'New Recurring Expense'}>
        <button className="btn-ghost w-8 px-0" onClick={() => navigate(-1)} aria-label="Close">
          <X size={18} />
        </button>
      </PageHeader>
      <div className="max-w-3xl flex-1 space-y-3.5 px-5 py-5">
        <Field label="Profile Name" required>
          <input className="input max-w-sm" value={f.profileName || ''} onChange={(e) => set({ profileName: e.target.value })} />
        </Field>
        <Field label="Repeat Every" required>
          <div className="max-w-sm">
            <RepeatSelect value={f.repeatEvery} onChange={(r) => set({ repeatEvery: r })} />
          </div>
        </Field>
        <Field label="Start Date">
          <DateInput className="max-w-[200px]" value={f.startOn} onChange={(v) => set({ startOn: v })} />
        </Field>
        <Field label="Ends On">
          <div className="flex items-center gap-4">
            <DateInput className="max-w-[200px]" value={f.endsOn} disabled={f.neverExpires} onChange={(v) => set({ endsOn: v })} />
            <Checkbox checked={!!f.neverExpires} onChange={(v) => set({ neverExpires: v, endsOn: v ? undefined : f.endsOn })} label="Never Expires" />
          </div>
        </Field>
        <Field label="Expense Account" required>
          <AccountSelect className="max-w-sm" accounts={accounts} value={f.accountId} onChange={(v) => set({ accountId: v })} filter={(a) => a.type === 'expense' || a.subType === 'fixed_asset' || a.subType === 'other_current_asset'} />
        </Field>
        <Field label="Amount" required>
          <MoneyInput className="max-w-xs" value={f.amount} onChange={(v) => set({ amount: v as unknown as number })} />
        </Field>
        <Field label="Paid Through" required>
          <AccountSelect className="max-w-sm" accounts={accounts} value={f.paidThroughAccountId} onChange={(v) => set({ paidThroughAccountId: v })} filter={(a) => isCashLike(a) || a.subType === 'other_current_liability' || a.subType === 'equity' || a.subType === 'other_current_asset'} />
        </Field>
        <Field label="Vendor">
          <div className="max-w-sm">
            <ContactPicker kind="vendor" value={f.vendorId} onChange={(v) => set({ vendorId: v || undefined })} />
          </div>
        </Field>
        <Field label="Notes">
          <textarea className="input max-w-xl" rows={3} maxLength={500} placeholder="Max. 500 characters" value={f.notes || ''} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
        <Field label="Customer Name">
          <div className="flex max-w-xl items-center gap-4">
            <div className="flex-1">
              <ContactPicker kind="customer" value={f.customerId} onChange={(v) => set({ customerId: v || undefined, billable: v ? f.billable : false })} />
            </div>
            <Checkbox checked={!!f.billable} disabled={!f.customerId} onChange={(v) => set({ billable: v })} label="Billable" />
          </div>
        </Field>
        <Field label="Reporting Tags">
          <div className="max-w-xl pt-1.5">
            <ReportingTags value={f.reportingTags || {}} onChange={(v) => set({ reportingTags: v })} />
          </div>
        </Field>
      </div>
      <FormFooter>
        <button className="btn-primary" disabled={saving} onClick={save}>
          Save
        </button>
        <button className="btn-secondary" onClick={() => navigate(-1)}>
          Cancel
        </button>
      </FormFooter>
    </div>
  );
}

function KeyedForm() {
  const { search } = useLocation();
  return <RecurringForm key={search} />;
}

export function RecurringExpenses() {
  return (
    <Routes>
      <Route index element={<RecurringList />} />
      <Route path="new" element={<KeyedForm />} />
      <Route path=":id/edit" element={<RecurringForm />} />
      <Route
        path=":id"
        element={
          <div className="flex h-full">
            <RecurringListPane />
            <RecurringDetailPane />
          </div>
        }
      />
    </Routes>
  );
}
