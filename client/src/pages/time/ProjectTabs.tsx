// The project page: header actions and the Overview, Timesheet, Purchases, Sales,
// Budget Configuration, Journals and Activity Logs tabs, plus the Comments panel.
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowLeft, ChevronDown, ChevronRight, Clock, Filter, MessageSquare, Paperclip, Pencil, Play, Plus, Settings2, Trash2, Upload, X } from 'lucide-react';
import { DOC_META } from '@shared/docmeta';
import { fmtDate, fmtDateTime, money, statusLabel, today } from '@shared/format';
import { budgetBuckets, fiscalYearLabel, fmtHours, TIME_PERIODS } from '@shared/projects';
import type { Account, Activity, Attachment, Budget, BudgetPeriod, DocKind } from '@shared/types';
import { api, qs, useAction, useApi } from '../../api';
import { useBoot } from '../../lib/app';
import { toast } from '../../lib/toast';
import { Checkbox, Drawer, Dropdown, Empty, Field, MenuItem, Modal, MoneyInput, Select, Spinner, Status, clsx, useConfirm } from '../../components/ui';
import { Comments } from '../../components/shared';
import { BillingStatusText, FilterPill, InvoiceProjectModal, LogEntryModal, openTimer, PeriodPill, type EntryRow, type ProjectDetail } from './common';
import { NewUserModal } from './Projects';

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'timesheet', label: 'Timesheet' },
  { value: 'purchases', label: 'Purchases' },
  { value: 'sales', label: 'Sales' },
  { value: 'budget', label: 'Budget Configuration' },
  { value: 'journals', label: 'Journals' },
  { value: 'activity', label: 'Activity Logs' },
] as const;
type Tab = (typeof TABS)[number]['value'];

// ------------------------------------------------------------ page

export function ProjectPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const tab = (search.get('tab') as Tab) || 'overview';
  const setTab = (t: Tab) => setSearch(t === 'overview' ? {} : { tab: t }, { replace: true });
  const { data: p, isLoading, error } = useApi<ProjectDetail>(`/projects/${id}`);
  const [logOpen, setLogOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [comments, setComments] = useState(false);
  const confirm = useConfirm();
  const action = useAction((a: string) => api(`/projects/${id}/actions/${a}`, { body: {} }), (r) => (r && (r as { name?: string }).name && (r as { id: string }).id !== id ? 'Project cloned' : 'Project updated'));
  const watch = useAction((off: boolean) => api(`/projects/${id}/actions/watchlist`, { body: { off } }), (r) => ((r as { watchlist: boolean }).watchlist ? 'Added to the dashboard watchlist' : 'Removed from the dashboard watchlist'));
  const del = useAction(() => api(`/projects/${id}`, { method: 'DELETE' }), 'Project deleted');
  if (isLoading) return <Spinner />;
  if (!p) return <Empty title={(error as Error)?.message || 'Project not found'} />;
  const newTxn = (path: string, withCustomer = true) => navigate(`${path}/new${qs({ projectId: p.id, ...(withCustomer ? { contactId: p.customerId, customerId: p.customerId } : {}) })}`);
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex min-h-[60px] items-center justify-between gap-3 border-b border-slate-200 px-5">
        <div className="flex min-w-0 items-center gap-3">
          <button className="btn-icon shrink-0" onClick={() => navigate('/time-tracking/projects')} aria-label="Back to projects">
            <ArrowLeft size={15} />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-[19px] font-semibold text-slate-900">{p.name}</h1>
            <div className="truncate text-xs text-slate-500">
              {p.customerName}
              {p.status === 'inactive' && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">Inactive</span>}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button className="btn-secondary" onClick={() => navigate(`/time-tracking/projects/${p.id}/edit`)}>
            Edit
          </button>
          <button className="btn-primary" onClick={() => setLogOpen(true)} disabled={p.status === 'inactive'}>
            Log Time
          </button>
          <Dropdown
            align="right"
            button={() => (
              <button className="btn-secondary">
                New Transaction <ChevronDown size={13} />
              </button>
            )}
          >
            <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Sales</div>
            <MenuItem onClick={() => setInvoiceOpen(true)}>Invoice unbilled {p.billingMethod === 'fixed' ? 'project fee' : 'time'}</MenuItem>
            <MenuItem onClick={() => newTxn('/sales/invoices')}>Invoice</MenuItem>
            <MenuItem onClick={() => newTxn('/sales/quotes')}>Quote</MenuItem>
            <MenuItem onClick={() => newTxn('/sales/sales-orders')}>Sales Order</MenuItem>
            <MenuItem onClick={() => newTxn('/sales/credit-notes')}>Credit Note</MenuItem>
            <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Purchases</div>
            <MenuItem onClick={() => newTxn('/purchases/expenses')}>Expense</MenuItem>
            <MenuItem onClick={() => newTxn('/purchases/bills', false)}>Bill</MenuItem>
            <MenuItem onClick={() => newTxn('/purchases/purchase-orders', false)}>Purchase Order</MenuItem>
            <MenuItem onClick={() => newTxn('/purchases/vendor-credits', false)}>Vendor Credit</MenuItem>
            <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Accountant</div>
            <MenuItem onClick={() => navigate(`/accountant/manual-journals/new?projectId=${p.id}`)}>Journal</MenuItem>
          </Dropdown>
          <Attachments projectId={p.id} files={p.attachments} />
          <Dropdown
            align="right"
            button={() => (
              <button className="btn-secondary">
                More <ChevronDown size={13} />
              </button>
            )}
          >
            <MenuItem icon={<Play size={13} />} onClick={() => openTimer({ projectId: p.id })} disabled={p.status === 'inactive'}>
              Start Timer
            </MenuItem>
            <MenuItem onClick={() => watch.mutate(p.watchlist)}>{p.watchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}</MenuItem>
            <MenuItem onClick={() => action.mutate(p.status === 'active' ? 'deactivate' : 'activate')}>{p.status === 'active' ? 'Mark as Inactive' : 'Mark as Active'}</MenuItem>
            <MenuItem onClick={() => action.mutate('clone', { onSuccess: (r) => navigate(`/time-tracking/projects/${(r as { id: string }).id}/edit`) })}>Clone</MenuItem>
            <MenuItem danger icon={<Trash2 size={13} />} onClick={() => confirm.ask('Delete project', `Delete ${p.name}? Its unbilled time entries are deleted too.`, () => del.mutate(undefined, { onSuccess: () => navigate('/time-tracking/projects') }), { danger: true, label: 'Delete' })}>
              Delete
            </MenuItem>
          </Dropdown>
          <button className="btn-ghost w-8 px-0" onClick={() => navigate('/time-tracking/projects')} aria-label="Close">
            <X size={18} />
          </button>
        </div>
      </div>
      <div className="flex items-end justify-between border-b border-slate-200 px-5">
        <div className="flex gap-6 overflow-x-auto">
          {TABS.map((t) => (
            <button key={t.value} className={clsx('tab whitespace-nowrap pt-3', tab === t.value && 'tab-active')} onClick={() => setTab(t.value)}>
              {t.label}
            </button>
          ))}
        </div>
        <button className="mb-2 flex items-center gap-1 text-[13px] text-slate-600 hover:text-brand-700" onClick={() => setComments(true)}>
          <MessageSquare size={14} /> Comments
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {tab === 'overview' && <Overview p={p} onInvoice={() => setInvoiceOpen(true)} onWatch={() => watch.mutate(p.watchlist)} />}
        {tab === 'timesheet' && <ProjectTimesheet p={p} onLog={() => setLogOpen(true)} />}
        {tab === 'purchases' && <Purchases p={p} />}
        {tab === 'sales' && <Sales p={p} onInvoice={() => setInvoiceOpen(true)} />}
        {tab === 'budget' && <Budgets p={p} />}
        {tab === 'journals' && <Journals p={p} />}
        {tab === 'activity' && <ActivityLogs id={p.id} />}
      </div>
      <LogEntryModal open={logOpen} onClose={() => setLogOpen(false)} defaults={{ projectId: p.id }} />
      <InvoiceProjectModal project={p} open={invoiceOpen} onClose={() => setInvoiceOpen(false)} />
      <Drawer open={comments} onClose={() => setComments(false)} title="Comments" width="max-w-lg">
        <Comments entityType="project" entityId={p.id} />
      </Drawer>
      {confirm.node}
    </div>
  );
}

function Attachments({ projectId, files }: { projectId: string; files: Attachment[] }) {
  const input = useRef<HTMLInputElement>(null);
  const add = useAction((list: Attachment[]) => api(`/projects/${projectId}/attachments`, { body: { attachments: list } }), 'Attachment added');
  const del = useAction((aid: string) => api(`/projects/${projectId}/attachments/${aid}`, { method: 'DELETE' }), 'Attachment removed');
  const upload = async (fl: FileList | null) => {
    if (!fl?.length) return;
    const fd = new FormData();
    [...fl].forEach((f) => fd.append('files', f));
    try {
      add.mutate(await api<Attachment[]>('/uploads', { body: fd }));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Dropdown
      align="right"
      button={() => (
        <button className="btn-icon relative" aria-label="Attachments" title="Attachments">
          <Paperclip size={14} />
          {files.length > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] text-white">{files.length}</span>}
        </button>
      )}
    >
      <div className="w-72 p-2" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 px-1 text-xs font-semibold uppercase text-slate-500">Attachments</div>
        {files.length === 0 && <div className="px-1 pb-2 text-[13px] text-slate-400">No files attached.</div>}
        <ul className="mb-2 space-y-1">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 rounded px-1 py-1 hover:bg-slate-50">
              <a href={f.url} target="_blank" rel="noreferrer" className="link truncate text-[13px]">
                {f.name}
              </a>
              <button className="text-slate-400 hover:text-red-500" onClick={() => del.mutate(f.id)} aria-label={`Remove ${f.name}`}>
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
        <input ref={input} type="file" multiple hidden onChange={(e) => upload(e.target.files)} />
        <button className="btn-secondary btn-sm w-full" onClick={() => input.current?.click()}>
          <Upload size={13} /> Upload Files
        </button>
        <div className="mt-1 px-1 text-[11px] text-slate-400">Up to 10 files, 10 MB each</div>
      </div>
    </Dropdown>
  );
}

// ------------------------------------------------------------ overview

const SERIES_BILLABLE = '#2a78d6';
const SERIES_NON = '#9bbbe3';
const CHART_PERIODS = TIME_PERIODS.filter((x) => ['this_week', 'previous_week', 'this_month', 'previous_month', 'this_quarter', 'this_year'].includes(x.value));

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 text-[13px] text-slate-900">{children}</div>
    </div>
  );
}

function Overview({ p, onInvoice, onWatch }: { p: ProjectDetail; onInvoice: () => void; onWatch: () => void }) {
  const [period, setPeriod] = useState('this_week');
  const { data: hours } = useApi<{ unit: 'day' | 'month'; buckets: { key: string; billable: number; nonBillable: number }[]; loggedHours: number; billableHours: number; amount: number }>(`/projects/${p.id}/hours${qs({ period })}`);
  const [addUser, setAddUser] = useState(false);
  const [taskEdit, setTaskEdit] = useState<ProjectDetail['tasks'][number] | 'new' | null>(null);
  const confirm = useConfirm();
  const removeUser = useAction((uid: string) => api(`/projects/${p.id}/users/${uid}`, { method: 'DELETE' }), 'User removed');
  const removeTask = useAction((tid: string) => api(`/projects/${p.id}/tasks/${tid}`, { method: 'DELETE' }), 'Task deleted');
  const chart = (hours?.buckets ?? []).map((b) => ({
    label: hours?.unit === 'day' ? `${Number(b.key.slice(8))} ${new Date(`${b.key}T00:00:00`).toLocaleString('en-US', { month: 'short' })}` : new Date(`${b.key}-01T00:00:00`).toLocaleString('en-US', { month: 'short' }),
    Billable: b.billable,
    'Non-billable': b.nonBillable,
  }));
  const budgetPct = p.budgetHours ? Math.min(100, (p.loggedHours / p.budgetHours) * 100) : 0;
  return (
    <div className="space-y-8 p-5">
      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-4 rounded-lg bg-slate-50 p-5">
          <Detail label="Customer">
            <Link className="link" to={`/sales/customers/${p.customerId}`}>
              {p.customerName}
            </Link>
          </Detail>
          {p.code && <Detail label="Project Code">{p.code}</Detail>}
          <Detail label="Billing Method">{p.billingMethodLabel}</Detail>
          {p.billingMethod === 'fixed' && <Detail label="Total Project Cost">{money(p.rate)}</Detail>}
          {p.billingMethod === 'project_hours' && <Detail label="Rate Per Hour">{money(p.rate)}</Detail>}
          {p.costBudget != null && <Detail label="Cost Budget">{money(p.costBudget)}</Detail>}
          {p.revenueBudget != null && <Detail label="Revenue Budget">{money(p.revenueBudget)}</Detail>}
          {p.description && <Detail label="Description">{p.description}</Detail>}
          <Detail label="Add to dashboard watchlist">
            {p.watchlist ? 'Enabled' : 'Disabled'} -{' '}
            <button className="link" onClick={onWatch}>
              {p.watchlist ? 'Disable' : 'Enable'}
            </button>
          </Detail>
          <div className="space-y-3 border-t border-slate-200 pt-4">
            <div>
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <span className="h-2 w-2 rounded-full border-2 border-emerald-500" /> Unbilled Amount
              </div>
              <div className="ml-3.5 text-[15px] font-semibold text-emerald-600">{money(p.unbilledAmount)}</div>
              {p.billingMethod !== 'fixed' && p.unbilledHours > 0 && <div className="ml-3.5 text-xs text-slate-500">{fmtHours(p.unbilledHours)} hrs unbilled</div>}
              {p.unbilledExpenses > 0 && <div className="ml-3.5 text-xs text-slate-500">+ {money(p.unbilledExpenses)} billable expenses</div>}
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <span className="h-2 w-2 rounded-full border-2 border-red-500" /> Billed Amount
              </div>
              <div className="ml-3.5 text-[15px] font-semibold text-red-600">{money(p.billedAmount)}</div>
            </div>
            {(p.unbilledAmount > 0 || p.unbilledExpenses > 0) && (
              <button className="btn-secondary btn-sm" onClick={onInvoice}>
                Create Invoice
              </button>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <div className="text-[14px] font-semibold">Logged Hours</div>
            <FilterPill value={period} onChange={setPeriod} options={CHART_PERIODS.map((x) => ({ value: x.value, label: x.label }))} />
          </div>
          <div className="h-[230px] px-3 pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ left: -10, right: 8 }}>
                <CartesianGrid vertical={false} stroke="#eef2f7" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} width={44} label={{ value: 'Hours', angle: -90, position: 'insideLeft', offset: 18, style: { fontSize: 11, fill: '#94a3b8' } }} />
                <Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(v: number) => fmtHours(v)} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
                <Bar dataKey="Billable" stackId="h" fill={SERIES_BILLABLE} radius={[0, 0, 0, 0]} maxBarSize={28} />
                <Bar dataKey="Non-billable" stackId="h" fill={SERIES_NON} radius={[3, 3, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-5 pb-3 text-xs text-slate-600">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-4 rounded-sm" style={{ background: SERIES_BILLABLE }} /> Billable
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-4 rounded-sm" style={{ background: SERIES_NON }} /> Non-billable
            </span>
          </div>
          <div className="grid grid-cols-2 divide-x divide-slate-100 border-t border-slate-100 text-center sm:grid-cols-4">
            {[
              ['Logged Hours', fmtHours(p.loggedHours), money(hours?.amount ?? 0), 'in this period: ' + fmtHours(hours?.loggedHours ?? 0)],
              ['Billable Hours', fmtHours(p.billableHours), null, null],
              ['Billed Hours', fmtHours(p.billedHours), null, null],
              ['Unbilled Hours', fmtHours(p.unbilledHours), null, null],
            ].map(([label, v, sub, sub2]) => (
              <div key={label as string} className="px-3 py-4">
                <div className="text-xs text-slate-500">{label}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-brand-700">{v}</div>
                {sub2 && <div className="text-[11px] text-slate-400">{sub2}</div>}
              </div>
            ))}
          </div>
          {p.budgetHours > 0 && (
            <div className="border-t border-slate-100 px-5 py-3">
              <div className="mb-1 flex justify-between text-xs text-slate-600">
                <span>Hours budget</span>
                <span className="tabular-nums">
                  {fmtHours(p.loggedHours)} of {fmtHours(p.budgetHours)} ({Math.round((p.loggedHours / p.budgetHours) * 100)}%)
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-100">
                <div className={clsx('h-2 rounded-full', p.loggedHours > p.budgetHours ? 'bg-red-500' : budgetPct > 80 ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${budgetPct}%` }} />
              </div>
            </div>
          )}
        </div>
      </div>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold">Users</h2>
          <button className="link text-[13px]" onClick={() => setAddUser(true)}>
            + Add User
          </button>
        </div>
        <table className="table border-t border-slate-200">
          <thead>
            <tr>
              <th>Name</th>
              {p.billingMethod === 'staff_hours' && <th className="text-right">Rate Per Hour</th>}
              {p.budgetHoursType === 'per_staff' && <th className="text-right">Budget Hours</th>}
              <th className="text-right">Logged Hours</th>
              <th className="pl-10">Role</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {p.users.map((u) => (
              <tr key={u.userId} className="group">
                <td>
                  <div className="font-medium text-slate-800">{u.name}</div>
                  {u.email && <div className="text-xs text-slate-500">{u.email}</div>}
                </td>
                {p.billingMethod === 'staff_hours' && <td className="text-right tabular-nums">{u.ratePerHour ? money(u.ratePerHour) : <span className="text-red-500">Not set</span>}</td>}
                {p.budgetHoursType === 'per_staff' && <td className="text-right tabular-nums">{u.budgetHours ?? '—'}</td>}
                <td className="text-right tabular-nums">{fmtHours(u.loggedHours)}</td>
                <td className="pl-10">{u.role}</td>
                <td>
                  <button className="invisible text-slate-400 hover:text-red-500 group-hover:visible" onClick={() => confirm.ask('Remove user', `Remove ${u.name} from ${p.name}?`, () => removeUser.mutate(u.userId), { danger: true, label: 'Remove' })} aria-label={`Remove ${u.name}`}>
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold">Project Tasks</h2>
          <button className="link text-[13px]" onClick={() => setTaskEdit('new')}>
            + Add Task
          </button>
        </div>
        {p.tasks.length === 0 ? (
          <div className="border-t border-slate-200 py-10 text-center text-slate-500">No project tasks have been added.</div>
        ) : (
          <table className="table border-t border-slate-200">
            <thead>
              <tr>
                <th>Task Name</th>
                <th>Description</th>
                {p.billingMethod === 'task_hours' && <th className="text-right">Rate Per Hour</th>}
                {p.budgetHoursType === 'per_task' && <th className="text-right">Budget Hours</th>}
                <th className="text-right">Logged Hours</th>
                <th className="pl-8">Billable</th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {p.tasks.map((t) => (
                <tr key={t.id} className="group">
                  <td className="font-medium text-slate-800">{t.name}</td>
                  <td className="text-slate-500">{t.description}</td>
                  {p.billingMethod === 'task_hours' && <td className="text-right tabular-nums">{t.ratePerHour ? money(t.ratePerHour) : <span className="text-red-500">Not set</span>}</td>}
                  {p.budgetHoursType === 'per_task' && <td className="text-right tabular-nums">{t.budgetHours ?? '—'}</td>}
                  <td className="text-right tabular-nums">{fmtHours(t.loggedHours)}</td>
                  <td className="pl-8">{t.billable ? 'Yes' : 'No'}</td>
                  <td>
                    <span className="invisible flex gap-2 group-hover:visible">
                      <button className="text-slate-400 hover:text-brand-600" onClick={() => setTaskEdit(t)} aria-label={`Edit ${t.name}`}>
                        <Pencil size={13} />
                      </button>
                      <button className="text-slate-400 hover:text-red-500" onClick={() => confirm.ask('Delete task', `Delete the task ${t.name}?`, () => removeTask.mutate(t.id), { danger: true, label: 'Delete' })} aria-label={`Delete ${t.name}`}>
                        <Trash2 size={13} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <AddUserModal p={p} open={addUser} onClose={() => setAddUser(false)} />
      <TaskModal p={p} task={taskEdit} onClose={() => setTaskEdit(null)} />
      {confirm.node}
    </div>
  );
}

function AddUserModal({ p, open, onClose }: { p: ProjectDetail; open: boolean; onClose: () => void }) {
  const { data: users = [] } = useApi<{ id: string; name: string; email?: string; status: string }[]>('/users');
  const [userId, setUserId] = useState('');
  const [rate, setRate] = useState('');
  const [budget, setBudget] = useState('');
  const [newUser, setNewUser] = useState(false);
  const add = useAction(() => api(`/projects/${p.id}/users`, { body: { userId, ratePerHour: rate, budgetHours: budget } }), 'User added to the project');
  const options = users.filter((u) => u.status === 'active' && !p.users.some((x) => x.userId === u.id));
  return (
    <>
      <Modal
        open={open && !newUser}
        onClose={onClose}
        title="Add User"
        footer={
          <>
            <button className="btn-primary" disabled={!userId || add.isPending} onClick={() => add.mutate(undefined, { onSuccess: () => { setUserId(''); setRate(''); setBudget(''); onClose(); } })}>
              Add
            </button>
            <button className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="User" required>
            <Select value={userId} onChange={(e) => (e.target.value === '__new' ? setNewUser(true) : setUserId(e.target.value))} placeholder="Select a user" options={[...options.map((u) => ({ value: u.id, label: u.email ? `${u.name} (${u.email})` : u.name })), { value: '__new', label: '+ New User' }]} />
          </Field>
          {p.billingMethod === 'staff_hours' && (
            <Field label="Rate Per Hour" required>
              <MoneyInput className="max-w-[200px]" value={rate} onChange={setRate} />
            </Field>
          )}
          {p.budgetHoursType === 'per_staff' && (
            <Field label="Budget Hours">
              <input className="input max-w-[120px]" type="number" min={0} value={budget} onChange={(e) => setBudget(e.target.value)} />
            </Field>
          )}
        </div>
      </Modal>
      <NewUserModal open={open && newUser} onClose={() => setNewUser(false)} onCreated={(id) => setUserId(id)} />
    </>
  );
}

function TaskModal({ p, task, onClose }: { p: ProjectDetail; task: ProjectDetail['tasks'][number] | 'new' | null; onClose: () => void }) {
  const editing = task && task !== 'new' ? task : undefined;
  const [f, setF] = useState({ name: '', description: '', ratePerHour: '', budgetHours: '', billable: true });
  const key = task === 'new' ? 'new' : editing?.id;
  const [loaded, setLoaded] = useState<string | undefined>();
  if (task && loaded !== key) {
    setLoaded(key);
    setF({ name: editing?.name ?? '', description: editing?.description ?? '', ratePerHour: editing?.ratePerHour != null ? String(editing.ratePerHour) : '', budgetHours: editing?.budgetHours != null ? String(editing.budgetHours) : '', billable: editing?.billable ?? true });
  }
  if (!task && loaded) setLoaded(undefined);
  const save = useAction(() => (editing ? api(`/projects/${p.id}/tasks/${editing.id}`, { method: 'PUT', body: f }) : api(`/projects/${p.id}/tasks`, { body: f })), editing ? 'Task updated' : 'Task added');
  return (
    <Modal
      open={Boolean(task)}
      onClose={onClose}
      title={editing ? 'Edit Task' : 'Add Task'}
      footer={
        <>
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            Save
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Task Name" required>
          <input className="input" autoFocus value={f.name} maxLength={100} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Description">
          <textarea className="input h-16 py-1.5" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        {p.billingMethod === 'task_hours' && (
          <Field label="Rate Per Hour" required>
            <MoneyInput className="max-w-[200px]" value={f.ratePerHour} onChange={(ratePerHour) => setF({ ...f, ratePerHour })} />
          </Field>
        )}
        {p.budgetHoursType === 'per_task' && (
          <Field label="Budget Hours">
            <input className="input max-w-[120px]" type="number" min={0} value={f.budgetHours} onChange={(e) => setF({ ...f, budgetHours: e.target.value })} />
          </Field>
        )}
        <Field label="">
          <Checkbox checked={f.billable} onChange={(billable) => setF({ ...f, billable })} label="Billable" />
        </Field>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ timesheet tab

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'unbilled', label: 'Unbilled' },
  { value: 'invoiced', label: 'Invoiced' },
  { value: 'non_billable', label: 'Non-Billable' },
];

export function EntryRowActions({ e, onEdit }: { e: EntryRow; onEdit: () => void }) {
  const confirm = useConfirm();
  const start = useAction(() => api('/timer/start', { body: { entryId: e.id } }), 'Timer started');
  const clone = useAction(() => api(`/time-entries/${e.id}/clone`, { body: { date: today() } }), 'Entry cloned to today');
  const del = useAction(() => api(`/time-entries/${e.id}`, { method: 'DELETE' }), 'Entry deleted');
  const flip = useAction(() => api(`/time-entries/bulk`, { body: { action: e.billable ? 'non_billable' : 'billable', ids: [e.id] } }), 'Entry updated');
  return (
    <div className="flex items-center justify-end gap-1.5 opacity-0 transition-opacity group-hover:opacity-100" onClick={(ev) => ev.stopPropagation()}>
      {!e.invoiced && (
        <button className="flex h-6 items-center gap-1 rounded border border-slate-300 bg-white px-1.5 text-[11px] text-slate-600 hover:border-brand-400 hover:text-brand-700" onClick={() => start.mutate()} title="Continue timing this entry">
          <Clock size={11} /> Start
        </button>
      )}
      <button className="flex h-6 w-6 items-center justify-center rounded border border-slate-300 bg-white text-slate-500 hover:text-brand-700" onClick={onEdit} aria-label="Edit entry">
        <Pencil size={11} />
      </button>
      <Dropdown align="right" button={() => <button className="flex h-6 w-6 items-center justify-center rounded border border-slate-300 bg-white text-slate-500 hover:text-brand-700" aria-label="More actions"><Settings2 size={12} /></button>}>
        <MenuItem onClick={() => clone.mutate()}>Clone to today</MenuItem>
        {!e.invoiced && <MenuItem onClick={() => flip.mutate()}>{e.billable ? 'Mark as Non-Billable' : 'Mark as Billable'}</MenuItem>}
        {e.invoiceNumber && <MenuItem onClick={() => window.location.assign(`/sales/invoices/${e.invoiceId}`)}>View invoice {e.invoiceNumber}</MenuItem>}
        <MenuItem danger disabled={e.invoiced} onClick={() => confirm.ask('Delete entry', 'Delete this time entry?', () => del.mutate(), { danger: true, label: 'Delete' })}>
          Delete
        </MenuItem>
      </Dropdown>
      {confirm.node}
    </div>
  );
}

function ProjectTimesheet({ p, onLog }: { p: ProjectDetail; onLog: () => void }) {
  const [status, setStatus] = useState('all');
  const [period, setPeriod] = useState('all');
  const [custom, setCustom] = useState<{ from?: string; to?: string }>({});
  const [sortTask, setSortTask] = useState<0 | 1 | -1>(0);
  const [edit, setEdit] = useState<EntryRow>();
  const [selected, setSelected] = useState<string[]>([]);
  const { data = [], isLoading } = useApi<EntryRow[]>(`/time-entries${qs({ projectId: p.id, status, period, ...(period === 'custom' ? custom : {}) })}`);
  const bulk = useAction((action: string) => api<{ done: number }>('/time-entries/bulk', { body: { action, ids: selected } }), (r) => `${r.done} entr${r.done === 1 ? 'y' : 'ies'} updated`);
  const rows = useMemo(() => (sortTask ? [...data].sort((a, b) => sortTask * (a.taskName ?? '').localeCompare(b.taskName ?? '')) : data), [data, sortTask]);
  const total = data.reduce((s, e) => s + e.hours, 0);
  const all = rows.length > 0 && rows.every((r) => selected.includes(r.id));
  return (
    <div>
      {selected.length ? (
        <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-5 py-2.5">
          <button className="btn-secondary btn-sm" onClick={() => bulk.mutate('billable', { onSuccess: () => setSelected([]) })}>
            Mark as Billable
          </button>
          <button className="btn-secondary btn-sm" onClick={() => bulk.mutate('non_billable', { onSuccess: () => setSelected([]) })}>
            Mark as Non-Billable
          </button>
          <button className="btn-secondary btn-sm text-red-600" onClick={() => bulk.mutate('delete', { onSuccess: () => setSelected([]) })}>
            <Trash2 size={13} /> Delete
          </button>
          <span className="text-[13px] text-slate-600">{selected.length} selected</span>
          <button className="btn-ghost ml-auto w-8 px-0" onClick={() => setSelected([])} aria-label="Clear selection">
            <X size={15} />
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 px-5 py-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">View by:</span>
          <FilterPill label="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
          <PeriodPill value={period} onChange={setPeriod} custom={custom} setCustom={setCustom} />
          <button className="btn-secondary ml-auto" onClick={onLog} disabled={p.status === 'inactive'}>
            <Plus size={14} /> Log Time
          </button>
        </div>
      )}
      <table className="table">
        <thead>
          <tr>
            <th className="w-10 pl-5">
              <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" checked={all} onChange={() => setSelected(all ? [] : rows.filter((r) => !r.invoiced).map((r) => r.id))} aria-label="Select all" />
            </th>
            <th>Date</th>
            <th>
              <button className="flex items-center gap-1 uppercase" onClick={() => setSortTask(sortTask === 1 ? -1 : 1)}>
                Task <span className="text-slate-400">{sortTask === 1 ? '▲' : sortTask === -1 ? '▼' : '⇅'}</span>
              </button>
            </th>
            <th>User</th>
            <th>Notes</th>
            <th className="text-right">Time</th>
            <th>Billing Status</th>
            <th className="w-44" />
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td colSpan={8}>
                <Spinner />
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={8} className="py-16 text-center text-slate-500">
                There are no timesheets.
              </td>
            </tr>
          ) : (
            rows.map((e) => (
              <tr key={e.id} className="group hover:bg-slate-50">
                <td className="pl-5">
                  <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" disabled={e.invoiced} checked={selected.includes(e.id)} onChange={() => setSelected((s) => (s.includes(e.id) ? s.filter((x) => x !== e.id) : [...s, e.id]))} aria-label="Select entry" />
                </td>
                <td>{fmtDate(e.date)}</td>
                <td>{e.taskName ?? '—'}</td>
                <td>{e.userName}</td>
                <td className="max-w-[260px] truncate text-slate-500">{e.notes}</td>
                <td className="text-right font-medium tabular-nums">{fmtHours(e.hours)}</td>
                <td>
                  <BillingStatusText status={e.billingStatus} invoice={e.invoiceNumber} />
                </td>
                <td className="pr-4">
                  <EntryRowActions e={e} onEdit={() => setEdit(e)} />
                </td>
              </tr>
            ))
          )}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50 text-[13px] font-medium">
              <td colSpan={5} className="px-3 py-2 pl-5">
                Total
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtHours(total)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        )}
      </table>
      <LogEntryModal open={Boolean(edit)} onClose={() => setEdit(undefined)} entry={edit} />
    </div>
  );
}

// ------------------------------------------------------------ purchases & sales tabs

interface DocRow {
  id: string;
  kind: DocKind;
  number: string;
  referenceNumber?: string;
  date: string;
  dueDate?: string;
  deliveryDate?: string;
  expectedShipmentDate?: string;
  contactName?: string;
  status: string;
  total: number;
  balance: number;
  projectFee: number;
}
interface ExpenseRow {
  id: string;
  date: string;
  accountName?: string;
  referenceNumber?: string;
  vendorName?: string;
  paidThroughName?: string;
  customerName?: string;
  amount: number;
  status: string;
}
interface Txns {
  expenses: ExpenseRow[];
  bills: DocRow[];
  purchaseOrders: DocRow[];
  vendorCredits: DocRow[];
  invoices: DocRow[];
  quotes: DocRow[];
  salesOrders: DocRow[];
  creditNotes: DocRow[];
  journals: { id: string; number: string; date: string; reference?: string; notes?: string; amount: number }[];
}

interface Col<T> {
  label: string;
  render: (r: T) => ReactNode;
  right?: boolean;
}

const PAGE = 10;
function TxnCard<T extends { id: string; status: string }>({ title, rows, cols, empty, open: openRow }: { title: string; rows: T[]; cols: Col<T>[]; empty: string; open: (r: T) => void }) {
  const [open, setOpen] = useState(true);
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(0);
  const statuses = ['all', ...new Set(rows.map((r) => r.status))];
  const list = rows.filter((r) => status === 'all' || r.status === status);
  const pageRows = list.slice(page * PAGE, page * PAGE + PAGE);
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between bg-slate-50 px-4 py-2.5">
        <button className="flex items-center gap-1.5 text-[14px] font-semibold text-slate-800" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />} {title}
          <span className="ml-1 rounded-full bg-slate-200 px-1.5 text-[11px] font-medium text-slate-600">{rows.length}</span>
        </button>
        <Dropdown
          align="right"
          button={() => (
            <button className="flex items-center gap-1 text-[13px] text-slate-600 hover:text-brand-700">
              <Filter size={12} /> Status: <span className="font-medium text-slate-800">{status === 'all' ? 'All' : statusLabel(status)}</span> <ChevronDown size={12} />
            </button>
          )}
        >
          {statuses.map((s) => (
            <MenuItem key={s} onClick={() => { setStatus(s); setPage(0); }}>
              <span className={clsx(s === status && 'font-semibold text-brand-700')}>{s === 'all' ? 'All' : statusLabel(s)}</span>
            </MenuItem>
          ))}
        </Dropdown>
      </div>
      {open && (
        <>
          <table className="table">
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c.label} className={clsx(c.right && 'text-right')}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.id} className="row-link" onClick={() => openRow(r)}>
                  {cols.map((c) => (
                    <td key={c.label} className={clsx(c.right && 'text-right tabular-nums')}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              ))}
              {!list.length && (
                <tr>
                  <td colSpan={cols.length} className="py-8 text-center text-slate-500">
                    {empty}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {list.length > 0 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-[13px] text-slate-600">
              <span>Total Count: {list.length}</span>
              <span className="flex items-center gap-2">
                <button className="btn-ghost btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page">
                  ‹
                </button>
                {page * PAGE + 1} - {Math.min(list.length, (page + 1) * PAGE)}
                <button className="btn-ghost btn-sm" disabled={(page + 1) * PAGE >= list.length} onClick={() => setPage(page + 1)} aria-label="Next page">
                  ›
                </button>
              </span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

const num = (r: DocRow) => <span className="link">{r.number}</span>;
const st = (r: { status: string; dueDate?: string }) => <Status status={r.status} dueDate={r.dueDate} />;
const docPath = (r: DocRow) => `${DOC_META[r.kind].path}/${r.id}`;

function Purchases({ p }: { p: ProjectDetail }) {
  const navigate = useNavigate();
  const { data } = useApi<Txns>(`/projects/${p.id}/transactions`);
  if (!data) return <Spinner />;
  return (
    <div className="space-y-5 p-5">
      <Dropdown
        button={() => (
          <button className="flex items-center gap-1 text-[15px] text-slate-800 hover:text-brand-700">
            Go to transactions <ChevronDown size={14} />
          </button>
        )}
      >
        <MenuItem onClick={() => navigate(`/purchases/expenses/new${qs({ projectId: p.id, customerId: p.customerId })}`)}>New Expense</MenuItem>
        <MenuItem onClick={() => navigate(`/purchases/bills/new${qs({ projectId: p.id })}`)}>New Bill</MenuItem>
        <MenuItem onClick={() => navigate(`/purchases/purchase-orders/new${qs({ projectId: p.id })}`)}>New Purchase Order</MenuItem>
        <MenuItem onClick={() => navigate(`/purchases/vendor-credits/new${qs({ projectId: p.id })}`)}>New Vendor Credit</MenuItem>
        <div className="my-1 border-t border-slate-100" />
        <MenuItem onClick={() => navigate('/purchases/expenses')}>All Expenses</MenuItem>
        <MenuItem onClick={() => navigate('/purchases/bills')}>All Bills</MenuItem>
      </Dropdown>
      <TxnCard<ExpenseRow>
        title="Expenses"
        rows={data.expenses}
        empty="There are no expenses"
        open={(r) => navigate(`/purchases/expenses/${r.id}`)}
        cols={[
          { label: 'Date', render: (r) => fmtDate(r.date) },
          { label: 'Expense Account', render: (r) => <span className="link">{r.accountName}</span> },
          { label: 'Reference#', render: (r) => r.referenceNumber },
          { label: 'Vendor Name', render: (r) => r.vendorName },
          { label: 'Paid Through', render: (r) => r.paidThroughName },
          { label: 'Customer Name', render: (r) => r.customerName },
          { label: 'Amount', render: (r) => money(r.amount), right: true },
          { label: 'Status', render: st },
        ]}
      />
      <TxnCard<DocRow>
        title="Bills"
        rows={data.bills}
        empty="There are no Bills"
        open={(r) => navigate(docPath(r))}
        cols={[
          { label: 'Date', render: (r) => fmtDate(r.date) },
          { label: 'Bill#', render: num },
          { label: 'Reference#', render: (r) => r.referenceNumber },
          { label: 'Vendor Name', render: (r) => r.contactName },
          { label: 'Project Cost', render: (r) => money(r.projectFee), right: true },
          { label: 'Amount', render: (r) => money(r.total), right: true },
          { label: 'Balance Due', render: (r) => money(r.balance), right: true },
          { label: 'Status', render: st },
        ]}
      />
      <TxnCard<DocRow>
        title="Purchase Orders"
        rows={data.purchaseOrders}
        empty="There are no Purchase Orders"
        open={(r) => navigate(docPath(r))}
        cols={[
          { label: 'Purchase Order#', render: num },
          { label: 'Reference#', render: (r) => r.referenceNumber },
          { label: 'Date', render: (r) => fmtDate(r.date) },
          { label: 'Vendor Name', render: (r) => r.contactName },
          { label: 'Delivery Date', render: (r) => fmtDate(r.deliveryDate) },
          { label: 'Project Cost', render: (r) => money(r.projectFee), right: true },
          { label: 'Amount', render: (r) => money(r.total), right: true },
          { label: 'Status', render: st },
        ]}
      />
      <TxnCard<DocRow>
        title="Vendor Credits"
        rows={data.vendorCredits}
        empty="No data to display"
        open={(r) => navigate(docPath(r))}
        cols={[
          { label: 'Date', render: (r) => fmtDate(r.date) },
          { label: 'Credit Note#', render: num },
          { label: 'Reference#', render: (r) => r.referenceNumber },
          { label: 'Vendor Name', render: (r) => r.contactName },
          { label: 'Project Cost', render: (r) => money(r.projectFee), right: true },
          { label: 'Balance', render: (r) => money(r.balance), right: true },
          { label: 'Amount', render: (r) => money(r.total), right: true },
          { label: 'Status', render: st },
        ]}
      />
    </div>
  );
}

function Sales({ p, onInvoice }: { p: ProjectDetail; onInvoice: () => void }) {
  const navigate = useNavigate();
  const { data } = useApi<Txns>(`/projects/${p.id}/transactions`);
  if (!data) return <Spinner />;
  return (
    <div className="space-y-5 p-5">
      <div className="flex items-center gap-2">
        <button className="btn-primary" onClick={onInvoice}>
          <Plus size={14} /> Invoice unbilled {p.billingMethod === 'fixed' ? 'project fee' : 'time'}
        </button>
        <button className="btn-secondary" onClick={() => navigate(`/sales/quotes/new${qs({ projectId: p.id, contactId: p.customerId })}`)}>
          New Quote
        </button>
      </div>
      <TxnCard<DocRow>
        title="Invoices"
        rows={data.invoices}
        empty="There are no invoices"
        open={(r) => navigate(docPath(r))}
        cols={[
          { label: 'Date', render: (r) => fmtDate(r.date) },
          { label: 'Invoice#', render: num },
          { label: 'Reference#', render: (r) => r.referenceNumber },
          { label: 'Project Fee', render: (r) => money(r.projectFee), right: true },
          { label: 'Amount', render: (r) => money(r.total), right: true },
          { label: 'Balance Due', render: (r) => money(r.balance), right: true },
          { label: 'Status', render: st },
        ]}
      />
      <TxnCard<DocRow>
        title="Quotes"
        rows={data.quotes}
        empty="There are no quotes"
        open={(r) => navigate(docPath(r))}
        cols={[
          { label: 'Date', render: (r) => fmtDate(r.date) },
          { label: 'Quote#', render: num },
          { label: 'Reference#', render: (r) => r.referenceNumber },
          { label: 'Amount', render: (r) => money(r.total), right: true },
          { label: 'Status', render: st },
        ]}
      />
      <TxnCard<DocRow>
        title="Sales Orders"
        rows={data.salesOrders}
        empty="There are no sales orders"
        open={(r) => navigate(docPath(r))}
        cols={[
          { label: 'Sales Order#', render: num },
          { label: 'Reference#', render: (r) => r.referenceNumber },
          { label: 'Date', render: (r) => fmtDate(r.date) },
          { label: 'Shipment Date', render: (r) => fmtDate(r.expectedShipmentDate) },
          { label: 'Project Fee', render: (r) => money(r.projectFee), right: true },
          { label: 'Amount', render: (r) => money(r.total), right: true },
          { label: 'Status', render: st },
        ]}
      />
      <TxnCard<DocRow>
        title="Credit Notes"
        rows={data.creditNotes}
        empty="There are no credit notes"
        open={(r) => navigate(docPath(r))}
        cols={[
          { label: 'Credit Date', render: (r) => fmtDate(r.date) },
          { label: 'Credit Note#', render: num },
          { label: 'Reference#', render: (r) => r.referenceNumber },
          { label: 'Project Fee', render: (r) => money(r.projectFee), right: true },
          { label: 'Balance', render: (r) => money(r.balance), right: true },
          { label: 'Amount', render: (r) => money(r.total), right: true },
          { label: 'Status', render: st },
        ]}
      />
    </div>
  );
}

// ------------------------------------------------------------ journals & activity

function Journals({ p }: { p: ProjectDetail }) {
  const navigate = useNavigate();
  const { data } = useApi<Txns>(`/projects/${p.id}/transactions`);
  if (!data) return <Spinner />;
  return (
    <div>
      <div className="flex justify-end px-5 py-3">
        <button className="btn-primary" onClick={() => navigate(`/accountant/manual-journals/new?projectId=${p.id}`)}>
          <Plus size={14} /> New Journal
        </button>
      </div>
      {data.journals.length === 0 ? (
        <div className="py-16 text-center text-slate-500">There are no journals associated with this project.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th className="pl-5">Date</th>
              <th>Journal#</th>
              <th>Reference#</th>
              <th>Notes</th>
              <th className="pr-5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.journals.map((j) => (
              <tr key={j.id} className="row-link" onClick={() => navigate(`/accountant/journals/${j.id}`)}>
                <td className="pl-5">{fmtDate(j.date)}</td>
                <td className="link">{j.number}</td>
                <td>{j.reference}</td>
                <td className="text-slate-500">{j.notes}</td>
                <td className="pr-5 text-right tabular-nums">{money(j.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ActivityLogs({ id }: { id: string }) {
  const { data = [] } = useApi<Activity[]>(`/activities${qs({ entityId: id })}`);
  if (!data.length) return <div className="py-16 text-center text-slate-500">No activity yet.</div>;
  return (
    <ol className="max-w-3xl divide-y divide-slate-100 px-8 py-4">
      {data.map((a) => (
        <li key={a.id} className="grid grid-cols-[170px_28px_minmax(0,1fr)] items-start gap-4 py-4">
          <div className="text-[13px] text-slate-500">{fmtDateTime(a.createdAt)}</div>
          <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-orange-100 text-orange-500">
            <span className="h-2 w-2 rounded-full border-2 border-orange-500" />
          </span>
          <div className="text-[13px]">
            <div className="text-slate-800">{a.message}</div>
            {a.detail && <div className="text-slate-500">{a.detail}</div>}
            <div className="text-slate-500">
              by <span className="font-medium text-slate-700">{a.author}</span>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ------------------------------------------------------------ budgets

type BudgetView = Omit<Budget, 'lines'> & {
  buckets: { from: string; to: string; label: string }[];
  lines: (Budget['lines'][number] & { accountName: string; accountType?: string; actuals: number[]; total: number; actualTotal: number })[];
};

const fyStarts = (fyMonth: number) => {
  const t = today();
  const y = Number(t.slice(0, 4)) - (Number(t.slice(5, 7)) < fyMonth ? 1 : 0);
  return [-1, 0, 1, 2].map((o) => `${y + o}-${String(fyMonth).padStart(2, '0')}-01`);
};

function Budgets({ p }: { p: ProjectDetail }) {
  const { data = [] } = useApi<BudgetView[]>(`/budgets?projectId=${p.id}`);
  const [mode, setMode] = useState<{ kind: 'list' } | { kind: 'new' } | { kind: 'edit'; b: BudgetView } | { kind: 'view'; id: string }>({ kind: 'list' });
  if (mode.kind === 'new' || mode.kind === 'edit') return <BudgetForm p={p} budget={mode.kind === 'edit' ? mode.b : undefined} onDone={(id) => setMode(id ? { kind: 'view', id } : { kind: 'list' })} />;
  if (mode.kind === 'view') {
    const b = data.find((x) => x.id === mode.id);
    if (b) return <BudgetReport b={b} onBack={() => setMode({ kind: 'list' })} onEdit={() => setMode({ kind: 'edit', b })} />;
  }
  return (
    <div>
      <div className="flex justify-end px-5 py-3">
        <button className="btn-primary" onClick={() => setMode({ kind: 'new' })}>
          <Plus size={14} /> New Budget
        </button>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th className="pl-5">Name</th>
            <th>Fiscal Year</th>
            <th>Budget Period</th>
            <th className="text-right">Budgeted</th>
            <th className="pr-5 text-right">Actual</th>
          </tr>
        </thead>
        <tbody>
          {data.map((b) => (
            <tr key={b.id} className="row-link" onClick={() => setMode({ kind: 'view', id: b.id })}>
              <td className="link pl-5">{b.name}</td>
              <td>{fiscalYearLabel(b.fiscalYearStart)}</td>
              <td className="capitalize">{b.period}</td>
              <td className="text-right tabular-nums">{money(b.lines.reduce((s, l) => s + l.total, 0))}</td>
              <td className="pr-5 text-right tabular-nums">{money(b.lines.reduce((s, l) => s + l.actualTotal, 0))}</td>
            </tr>
          ))}
          {!data.length && (
            <tr>
              <td colSpan={5} className="py-14 text-center text-slate-500">
                No budgets yet. Plan this project's income and expenses by month, quarter or year.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function AccountAdder({ accounts, picked, onAdd }: { accounts: Account[]; picked: string[]; onAdd: (id: string) => void }) {
  const avail = accounts.filter((a) => !picked.includes(a.id) && a.active !== false);
  return (
    <Dropdown button={() => <button className="flex h-8 w-full items-center rounded-md border border-dashed border-slate-300 px-2.5 text-left text-[13px] text-brand-600 hover:border-brand-400">Add Accounts</button>} className="w-full">
      <div className="max-h-72 overflow-auto">
        {avail.map((a) => (
          <MenuItem key={a.id} onClick={() => onAdd(a.id)}>
            {a.name}
          </MenuItem>
        ))}
        {!avail.length && <div className="px-3 py-2 text-[13px] text-slate-400">All accounts added</div>}
      </div>
    </Dropdown>
  );
}

function BudgetForm({ p, budget, onDone }: { p: ProjectDetail; budget?: BudgetView; onDone: (id?: string) => void }) {
  const { accounts, organization } = useBoot();
  const [name, setName] = useState(budget?.name ?? '');
  const [fy, setFy] = useState(budget?.fiscalYearStart ?? fyStarts(organization.fiscalYearStartMonth)[1]);
  const [period, setPeriod] = useState<BudgetPeriod>(budget?.period ?? 'monthly');
  const [includeBs, setIncludeBs] = useState(budget?.includeBalanceSheet ?? false);
  const [lines, setLines] = useState<{ accountId: string; amounts: (number | string)[] }[]>(budget?.lines.map((l) => ({ accountId: l.accountId, amounts: [...l.amounts] })) ?? []);
  const buckets = budgetBuckets(fy, period);
  const save = useAction(() => {
    const body = { name, fiscalYearStart: fy, period, projectId: p.id, includeBalanceSheet: includeBs, lines: lines.map((l) => ({ accountId: l.accountId, amounts: buckets.map((_, i) => Number(l.amounts[i]) || 0) })) };
    return budget ? api<Budget>(`/budgets/${budget.id}`, { method: 'PUT', body }) : api<Budget>('/budgets', { body });
  }, budget ? 'Budget updated' : 'Budget created');
  const del = useAction(() => api(`/budgets/${budget!.id}`, { method: 'DELETE' }), 'Budget deleted');
  const byType = (types: string[]) => accounts.filter((a) => types.includes(a.type));
  const picked = lines.map((l) => l.accountId);
  const add = (id: string) => setLines([...lines, { accountId: id, amounts: [] }]);
  const groups: [string, string[]][] = [
    ['Income Accounts', ['income']],
    ['Expense Accounts', ['expense']],
    ...(includeBs ? ([['Asset Accounts', ['asset']], ['Liability Accounts', ['liability']], ['Equity Accounts', ['equity']]] as [string, string[]][]) : []),
  ];
  const setAmt = (aid: string, i: number, v: string) => setLines(lines.map((l) => (l.accountId === aid ? { ...l, amounts: Object.assign([...l.amounts], { [i]: v }) } : l)));
  const fill = (aid: string) => setLines(lines.map((l) => (l.accountId === aid ? { ...l, amounts: buckets.map(() => l.amounts[0] ?? '') } : l)));
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <h2 className="text-[18px] font-semibold">{budget ? 'Edit Budget' : 'New Budget'}</h2>
        <button className="btn-ghost w-8 px-0" onClick={() => onDone(budget?.id)} aria-label="Close">
          <X size={17} />
        </button>
      </div>
      <div className="flex-1 space-y-5 px-5 py-5">
        <div className="max-w-2xl space-y-4">
          <Field label="Name" required>
            <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Fiscal Year" required>
            <Select value={fy} onChange={(e) => setFy(e.target.value)} options={fyStarts(organization.fiscalYearStartMonth).map((s) => ({ value: s, label: fiscalYearLabel(s) }))} />
          </Field>
          <Field label="Budget Period" required>
            <Select
              value={period}
              onChange={(e) => setPeriod(e.target.value as BudgetPeriod)}
              options={[
                { value: 'monthly', label: 'Monthly' },
                { value: 'quarterly', label: 'Quarterly' },
                { value: 'yearly', label: 'Yearly' },
              ]}
            />
          </Field>
          <Field label="Project">
            <div className="flex h-8 items-center gap-2 rounded-md bg-slate-50 px-2.5 text-[13px] font-medium">{p.name}</div>
          </Field>
        </div>
        <div className="max-w-2xl space-y-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Income and Expense Accounts</div>
          {groups.map(([label, types]) => (
            <Field key={label} label={label}>
              <AccountAdder accounts={byType(types)} picked={picked} onAdd={add} />
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
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="table min-w-max">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 min-w-[200px] bg-slate-50">Account</th>
                  {buckets.map((b) => (
                    <th key={b.from} className="min-w-[110px] text-right">
                      {b.label}
                    </th>
                  ))}
                  <th className="text-right">Total</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const acct = accounts.find((a) => a.id === l.accountId);
                  return (
                    <tr key={l.accountId}>
                      <td className="sticky left-0 z-10 bg-white">
                        <div className="font-medium">{acct?.name}</div>
                        <button className="text-[11px] text-brand-600 hover:underline" onClick={() => fill(l.accountId)} title="Copy the first period's amount to every period">
                          Copy first amount across
                        </button>
                      </td>
                      {buckets.map((b, i) => (
                        <td key={b.from}>
                          <input className="input text-right tabular-nums" inputMode="decimal" value={l.amounts[i] ?? ''} onChange={(e) => setAmt(l.accountId, i, e.target.value)} aria-label={`${acct?.name} ${b.label}`} />
                        </td>
                      ))}
                      <td className="text-right font-medium tabular-nums">{money(buckets.reduce((s, _, i) => s + (Number(l.amounts[i]) || 0), 0))}</td>
                      <td>
                        <button className="text-slate-400 hover:text-red-500" onClick={() => setLines(lines.filter((x) => x.accountId !== l.accountId))} aria-label="Remove account">
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="sticky bottom-0 flex items-center gap-2 border-t border-slate-200 bg-white px-5 py-3">
        <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: (b) => onDone((b as Budget).id) })}>
          {budget ? 'Save' : 'Create Budget'}
        </button>
        <button className="btn-secondary" onClick={() => onDone(budget?.id)}>
          Cancel
        </button>
        {budget && (
          <button className="btn-ghost ml-auto text-red-600" onClick={() => del.mutate(undefined, { onSuccess: () => onDone() })}>
            <Trash2 size={13} /> Delete
          </button>
        )}
      </div>
    </div>
  );
}

function BudgetReport({ b, onBack, onEdit }: { b: BudgetView; onBack: () => void; onEdit: () => void }) {
  const variance = (budget: number, actual: number, type?: string) => (type === 'expense' ? budget - actual : actual - budget);
  return (
    <div>
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <div className="flex items-center gap-3">
          <button className="btn-icon" onClick={onBack} aria-label="Back to budgets">
            <ArrowLeft size={15} />
          </button>
          <div>
            <h2 className="text-[17px] font-semibold">{b.name}</h2>
            <div className="text-xs text-slate-500">
              Budget vs Actuals · {fiscalYearLabel(b.fiscalYearStart)} · <span className="capitalize">{b.period}</span>
            </div>
          </div>
        </div>
        <button className="btn-secondary" onClick={onEdit}>
          <Pencil size={13} /> Edit
        </button>
      </div>
      <div className="overflow-x-auto p-5">
        <table className="table min-w-max rounded-md border border-slate-200">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-[200px] bg-slate-50">Account</th>
              {b.buckets.map((k) => (
                <th key={k.from} className="min-w-[120px] text-right">
                  {k.label}
                </th>
              ))}
              <th className="min-w-[120px] text-right">Total</th>
              <th className="min-w-[120px] text-right">Variance</th>
            </tr>
          </thead>
          <tbody>
            {b.lines.map((l) => {
              const v = variance(l.total, l.actualTotal, l.accountType);
              return (
                <tr key={l.accountId}>
                  <td className="sticky left-0 z-10 bg-white">
                    <div className="font-medium">{l.accountName}</div>
                    <div className="text-[11px] capitalize text-slate-400">{l.accountType}</div>
                  </td>
                  {b.buckets.map((k, i) => (
                    <td key={k.from} className="text-right tabular-nums">
                      <div className="text-slate-800">{money(l.actuals[i])}</div>
                      <div className="text-[11px] text-slate-400">of {money(l.amounts[i])}</div>
                    </td>
                  ))}
                  <td className="text-right tabular-nums">
                    <div className="font-medium">{money(l.actualTotal)}</div>
                    <div className="text-[11px] text-slate-400">of {money(l.total)}</div>
                  </td>
                  <td className={clsx('text-right font-medium tabular-nums', v < 0 ? 'text-red-600' : 'text-emerald-600')}>{money(v)}</td>
                </tr>
              );
            })}
            {!b.lines.length && (
              <tr>
                <td colSpan={b.buckets.length + 3} className="py-10 text-center text-slate-500">
                  This budget has no accounts. Edit it to add income and expense accounts.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-slate-500">Actuals come from transactions linked to this project: invoices, bills, expenses, credits and journals tagged with the project.</p>
      </div>
    </div>
  );
}

