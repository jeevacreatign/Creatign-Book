// Projects: All Projects list (list or split view), the project form and the project page.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronDown, Clock, Columns2, Download, List, MoreHorizontal, Plus, Search, Trash2, X } from 'lucide-react';
import { money } from '@shared/format';
import { BILLING_METHODS, fmtHours } from '@shared/projects';
import type { Contact, Project, ProjectBudgetHours, ProjectTask, ProjectUser } from '@shared/types';
import { api, qs, useAction, useApi } from '../../api';
import { Checkbox, ContactPicker, Dropdown, Empty, Field, FormFooter, MenuItem, Modal, MoneyInput, PageHeader, Select, Spinner, clsx, useConfirm } from '../../components/ui';
import { Lifecycle } from '../../components/shared';
import { ExportMenu } from '../../components/ExportMenu';
import { CsvImportButton, type CsvImportRecord, type CsvImportResult } from '../../components/CsvImportButton';
import { downloadRows } from '../../lib/export';
import { openTimer, useUsers, type ProjectDetail, type ProjectRow } from './common';
import { ProjectPage } from './ProjectTabs';

const VIEWS = [
  { value: 'all', label: 'All Projects' },
  { value: 'active', label: 'Active Projects' },
  { value: 'inactive', label: 'Inactive Projects' },
];

const LAYOUT_KEY = 'creatign.projects.layout';
function useLayout() {
  const [v, setV] = useState<'list' | 'split'>(() => {
    try {
      return (localStorage.getItem(LAYOUT_KEY) as 'list' | 'split') || 'list';
    } catch {
      return 'list';
    }
  });
  const set = (x: 'list' | 'split') => {
    setV(x);
    try {
      localStorage.setItem(LAYOUT_KEY, x);
    } catch {
      /* private mode */
    }
  };
  return [v, set] as const;
}

const rateText = (p: ProjectRow) => (p.billingMethod === 'fixed' || p.billingMethod === 'project_hours' ? money(p.rate) : p.billingMethod === 'task_hours' ? 'Per task' : 'Per user');

const PROJECT_EXPORT_COLUMNS = [
  { header: 'Project Name', value: (p: ProjectRow) => p.name },
  { header: 'Project Code', value: (p: ProjectRow) => p.code },
  { header: 'Client Name', value: (p: ProjectRow) => p.customerName },
  { header: 'Billing Method', value: (p: ProjectRow) => p.billingMethodLabel },
  { header: 'Rate', value: (p: ProjectRow) => p.rate },
  { header: 'Status', value: (p: ProjectRow) => p.status },
  { header: 'Logged Hours', value: (p: ProjectRow) => fmtHours(p.loggedHours) },
  { header: 'Unbilled Hours', value: (p: ProjectRow) => fmtHours(p.unbilledHours) },
  { header: 'Unbilled Amount', value: (p: ProjectRow) => p.unbilledAmount },
  { header: 'Billed Amount', value: (p: ProjectRow) => p.billedAmount },
];

function ViewTitle({ view, setView, compact }: { view: string; setView: (v: string) => void; compact?: boolean }) {
  return (
    <Dropdown
      button={() => (
        <button className={clsx('flex items-center gap-1 font-semibold text-slate-900', compact ? 'text-[15px]' : 'text-[19px]')}>
          {VIEWS.find((v) => v.value === view)?.label} <ChevronDown size={15} className="text-brand-600" />
        </button>
      )}
    >
      {VIEWS.map((v) => (
        <MenuItem key={v.value} onClick={() => setView(v.value)}>
          <span className={clsx(v.value === view && 'font-semibold text-brand-700')}>{v.label}</span>
        </MenuItem>
      ))}
    </Dropdown>
  );
}

function LayoutToggle({ layout, setLayout }: { layout: 'list' | 'split'; setLayout: (v: 'list' | 'split') => void }) {
  return (
    <div className="flex h-8 items-center rounded-full border border-slate-300 bg-slate-100 p-0.5">
      <button className={clsx('flex h-full w-9 items-center justify-center rounded-full', layout === 'list' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500')} onClick={() => setLayout('list')} title="List view" aria-label="List view">
        <List size={15} />
      </button>
      <button className={clsx('flex h-full w-9 items-center justify-center rounded-full', layout === 'split' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500')} onClick={() => setLayout('split')} title="Split view" aria-label="Split view">
        <Columns2 size={15} />
      </button>
    </div>
  );
}

const VIEW_KEY = 'creatign.projects.view';
function useView() {
  const [v, setV] = useState(() => {
    try {
      return sessionStorage.getItem(VIEW_KEY) || 'all';
    } catch {
      return 'all';
    }
  });
  return [
    v,
    (x: string) => {
      setV(x);
      try {
        sessionStorage.setItem(VIEW_KEY, x);
      } catch {
        /* private mode */
      }
    },
  ] as const;
}

// ------------------------------------------------------------ All Projects

function ProjectList() {
  const navigate = useNavigate();
  const [view, setView] = useView();
  const [layout, setLayout] = useLayout();
  const [q, setQ] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const { data = [], isLoading } = useApi<ProjectRow[]>(`/projects${qs({ view, q })}`);
  const { data: customers = [] } = useApi<Contact[]>('/contacts?kind=customer');
  const confirm = useConfirm();
  const bulk = useAction((v: { action: string; ids: string[] }) => api<{ done: number }>('/projects/bulk', { body: v }), (r) => `${r.done} project(s) updated`);
  const all = data.length > 0 && data.every((p) => selected.includes(p.id));
  const exportRows = selected.length ? data.filter((p) => selected.includes(p.id)) : data;
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const importProjects = async (records: CsvImportRecord[]): Promise<CsvImportResult[]> => {
    const results: CsvImportResult[] = [];
    for (const record of records) {
      const name = record.get('Project Name', 'Name') || `row ${record.rowNumber}`;
      try {
        const projectName = record.get('Project Name', 'Name');
        const clientName = record.get('Client Name', 'Customer', 'Client');
        if (!projectName) throw new Error('Project Name is required');
        const customer = customers.find((item) => item.id === clientName || item.displayName.toLowerCase() === clientName?.toLowerCase() || item.companyName?.toLowerCase() === clientName?.toLowerCase());
        if (!customer) throw new Error(`Client "${clientName || ''}" was not found`);
        const billingInput = record.get('Billing Method')?.trim().toLowerCase();
        const billingMethod = BILLING_METHODS.find((method) => method.value === billingInput || method.label.toLowerCase() === billingInput)?.value;
        if (billingInput && !billingMethod) throw new Error(`Unknown Billing Method "${billingInput}"`);
        const rateText = record.get('Rate', 'Project Rate');
        const rate = rateText ? Number(rateText.replace(/[^\d.-]/g, '')) : 0;
        if (!Number.isFinite(rate) || rate < 0) throw new Error('Rate must be a non-negative number');
        const taskRateText = record.get('Task Rate');
        const taskRate = taskRateText ? Number(taskRateText.replace(/[^\d.-]/g, '')) : rate;
        if (!Number.isFinite(taskRate) || taskRate < 0) throw new Error('Task Rate must be a non-negative number');
        const tasks = (record.get('Tasks') || '').split('|').map((task) => task.trim()).filter(Boolean).map((task) => ({ name: task, ratePerHour: taskRate, billable: true }));
        const budgetHoursText = record.get('Budget Hours');
        const budgetHours = budgetHoursText ? Number(budgetHoursText) : undefined;
        if (budgetHours !== undefined && (!Number.isFinite(budgetHours) || budgetHours < 0)) throw new Error('Budget Hours must be a non-negative number');
        const project = await api<Project>('/projects', { body: {
          name: projectName,
          code: record.get('Project Code', 'Code'),
          customerId: customer.id,
          billingMethod: billingMethod || 'project_hours',
          rate,
          description: record.get('Description'),
          budgetHoursType: budgetHours === undefined ? 'none' : 'total',
          budgetHours,
          tasks,
        } });
        if (/^(inactive|false|no)$/i.test(record.get('Status') || '')) await api(`/projects/${project.id}/actions/deactivate`, { body: {} });
        results.push({ rowNumber: record.rowNumber, label: projectName, success: true });
      } catch (error) {
        results.push({ rowNumber: record.rowNumber, label: name, success: false, message: error instanceof Error ? error.message : 'Import failed' });
      }
    }
    return results;
  };
  useEffect(() => {
    if (layout === 'split' && data.length) navigate(`/time-tracking/projects/${data[0].id}`, { replace: true });
  }, [layout, data.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      {selected.length ? (
        <div className="flex min-h-[64px] items-center justify-between border-b border-slate-200 bg-slate-50 px-6">
          <div className="flex items-center gap-2">
            <button className="btn-secondary btn-sm" onClick={() => bulk.mutate({ action: 'activate', ids: selected }, { onSuccess: () => setSelected([]) })}>
              Mark as Active
            </button>
            <button className="btn-secondary btn-sm" onClick={() => bulk.mutate({ action: 'deactivate', ids: selected }, { onSuccess: () => setSelected([]) })}>
              Mark as Inactive
            </button>
            <ExportMenu rows={exportRows} filename="projects" columns={PROJECT_EXPORT_COLUMNS} label="Export Selected" />
            <button className="btn-secondary btn-sm text-red-600" onClick={() => confirm.ask('Delete projects', `Delete ${selected.length} project(s) and their unbilled time? Projects with invoices cannot be deleted.`, () => bulk.mutate({ action: 'delete', ids: selected }, { onSuccess: () => setSelected([]) }), { danger: true, label: 'Delete' })}>
              <Trash2 size={13} /> Delete
            </button>
            <span className="ml-2 text-[13px] text-slate-600">{selected.length} selected</span>
          </div>
          <button className="btn-ghost w-8 px-0" onClick={() => setSelected([])} aria-label="Clear selection">
            <X size={16} />
          </button>
        </div>
      ) : (
        <div className="flex min-h-[64px] items-center justify-between gap-3 border-b border-slate-200 px-6">
          <ViewTitle view={view} setView={(v) => { setView(v); setSelected([]); }} />
          <div className="flex items-center gap-2">
            <LayoutToggle layout={layout} setLayout={setLayout} />
            <CsvImportButton
              title="Projects"
              filename="projects"
              headers={['Project Name', 'Project Code', 'Client Name', 'Billing Method', 'Rate', 'Status', 'Description', 'Budget Hours', 'Tasks', 'Task Rate']}
              instructions="Import one project per row. Client Name must match an existing client. Tasks can be separated with |. Billing Method accepts fixed, project_hours, task_hours, or staff_hours (or the displayed label)."
              onImport={importProjects}
            />
            <button className="btn-secondary" onClick={() => openTimer()}>
              <Clock size={14} /> Start
            </button>
            <div className="flex">
              <button className="btn-primary rounded-r-none" onClick={() => navigate('/time-tracking/projects/new')}>
                <Plus size={15} /> New
              </button>
              <Dropdown align="right" button={() => <button className="btn-primary w-8 rounded-l-none border-l border-l-brand-700 px-0" aria-label="More new options"><ChevronDown size={14} /></button>}>
                <MenuItem onClick={() => navigate('/time-tracking/projects/new')}>New Project</MenuItem>
                <MenuItem onClick={() => navigate('/time-tracking/timesheet?new=1')}>New Log Entry</MenuItem>
              </Dropdown>
            </div>
            <Dropdown align="right" button={() => <button className="btn-icon" aria-label="More"><MoreHorizontal size={15} /></button>}>
              <MenuItem icon={<Download size={13} />} onClick={() => downloadRows('projects', data, PROJECT_EXPORT_COLUMNS, 'csv')}>Export Projects (CSV)</MenuItem>
              <MenuItem icon={<Download size={13} />} onClick={() => downloadRows('projects', data, PROJECT_EXPORT_COLUMNS, 'xlsx')}>Export Projects (Excel)</MenuItem>
              <MenuItem onClick={() => navigate('/time-tracking/timesheet')}>Go to Timesheet</MenuItem>
            </Dropdown>
          </div>
        </div>
      )}
      {isLoading ? (
        <Spinner />
      ) : !data.length && view === 'all' && !q ? (
        <Lifecycle
          title="Track time. Bill your clients."
          subtitle="Create projects for your clients, log the hours your team spends on them and turn unbilled time into invoices."
          steps={['CREATE PROJECT', 'LOG TIME', 'INVOICE UNBILLED HOURS']}
          actions={
            <button className="btn-primary" onClick={() => navigate('/time-tracking/projects/new')}>
              NEW PROJECT
            </button>
          }
        />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th className="w-10 pl-6">
                <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" checked={all} onChange={() => setSelected(all ? [] : data.map((p) => p.id))} aria-label="Select all" />
              </th>
              <th>Client Name</th>
              <th>Project Name</th>
              <th>Billing Method</th>
              <th className="text-right">Rate</th>
              <th className="text-right">Logged Hours</th>
              <th className="text-right">Unbilled Amount</th>
              <th className="w-10 pr-4 text-right">
                {searchOpen ? (
                  <span className="relative inline-flex">
                    <input autoFocus className="input h-7 w-48 pr-6 text-xs normal-case" value={q} placeholder="Search projects" onChange={(e) => { setQ(e.target.value); setSelected([]); }} />
                    <button className="absolute right-1.5 top-1.5 text-slate-400" onClick={() => { setQ(''); setSelected([]); setSearchOpen(false); }} aria-label="Close search">
                      <X size={13} />
                    </button>
                  </span>
                ) : (
                  <button className="text-slate-400 hover:text-slate-600" onClick={() => setSearchOpen(true)} aria-label="Search">
                    <Search size={14} />
                  </button>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.id} className="row-link" onClick={() => navigate(`/time-tracking/projects/${p.id}`)}>
                <td className="pl-6" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} aria-label={`Select ${p.name}`} />
                </td>
                <td>{p.customerName}</td>
                <td>
                  <span className="link">{p.name}</span>
                  {p.status === 'inactive' && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">Inactive</span>}
                </td>
                <td>{p.billingMethodLabel}</td>
                <td className="text-right tabular-nums">{rateText(p)}</td>
                <td className="text-right tabular-nums">{fmtHours(p.loggedHours)}</td>
                <td className="text-right tabular-nums">{money(p.unbilledAmount)}</td>
                <td />
              </tr>
            ))}
            {!data.length && (
              <tr>
                <td colSpan={8}>
                  <Empty title={q ? `No projects match “${q}”` : 'No projects in this view'} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {confirm.node}
    </div>
  );
}

// ------------------------------------------------------------ split view (left pane)

function ProjectListPane() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [view, setView] = useView();
  const [layout, setLayout] = useLayout();
  const { data = [] } = useApi<ProjectRow[]>(`/projects${qs({ view })}`);
  if (layout !== 'split') return null;
  return (
    <div className="no-print flex w-[320px] shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex min-h-[56px] items-center justify-between gap-2 border-b border-slate-200 px-4">
        <ViewTitle view={view} setView={setView} compact />
        <div className="flex items-center gap-1">
          <button className="btn-primary w-8 px-0" onClick={() => navigate('/time-tracking/projects/new')} aria-label="New project">
            <Plus size={15} />
          </button>
          <button className="btn-icon" onClick={() => { setLayout('list'); navigate('/time-tracking/projects'); }} title="List view" aria-label="List view">
            <List size={15} />
          </button>
        </div>
      </div>
      <ul className="flex-1 divide-y divide-slate-100 overflow-auto">
        {data.map((p) => (
          <li key={p.id}>
            <button className={clsx('flex w-full flex-col gap-0.5 px-4 py-3 text-left hover:bg-slate-50', p.id === id && 'bg-brand-50/70')} onClick={() => navigate(`/time-tracking/projects/${p.id}`)}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-slate-900">{p.name}</span>
                <span className="shrink-0 text-[13px] tabular-nums text-slate-700">{fmtHours(p.loggedHours)}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                <span className="truncate">{p.customerName}</span>
                <span className="shrink-0">{p.status === 'inactive' ? 'Inactive' : rateText(p)}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProjectRoute() {
  return (
    <div className="flex h-full min-h-0">
      <ProjectListPane />
      <div className="min-w-0 flex-1">
        <ProjectPage />
      </div>
    </div>
  );
}

// ------------------------------------------------------------ new / edit project

type FormTask = Omit<ProjectTask, 'id'> & { id: string };
type FormState = Partial<Omit<Project, 'tasks' | 'users'>> & { tasks: FormTask[]; users: ProjectUser[] };
let seq = 0;

export function NewUserModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [f, setF] = useState({ name: '', email: '', role: 'Staff' });
  const save = useAction(() => api<{ id: string }>('/users', { body: f }), 'User added');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New User"
      footer={
        <>
          <button className="btn-primary" onClick={() => save.mutate(undefined, { onSuccess: (u) => { onCreated(u.id); setF({ name: '', email: '', role: 'Staff' }); onClose(); } })}>
            Save
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" required>
          <input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Email">
          <input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label="Role">
          <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} options={['Admin', 'Staff', 'Timesheet Staff'].map((r) => ({ value: r, label: r }))} />
        </Field>
      </div>
    </Modal>
  );
}

function ProjectForm() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { data: existing } = useApi<ProjectDetail>(id ? `/projects/${id}` : null);
  const { data: users = [] } = useUsers();
  const [f, setF] = useState<FormState>({ billingMethod: 'project_hours', budgetHoursType: 'none', tasks: [], users: [], watchlist: false, customerId: search.get('customerId') || undefined });
  const [newUser, setNewUser] = useState<number | null>(null);
  useEffect(() => {
    if (existing) setF({ ...existing, tasks: existing.tasks.map((t) => ({ ...t })), users: existing.users.map((u) => ({ userId: u.userId, ratePerHour: u.ratePerHour, budgetHours: u.budgetHours })) });
  }, [existing?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!id && users.length && !f.users.length) setF((x) => ({ ...x, users: [{ userId: users[0].id }] }));
  }, [users.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useAction(() => (id ? api<Project>(`/projects/${id}`, { method: 'PUT', body: f }) : api<Project>('/projects', { body: f })), id ? 'Project updated' : 'Project created');
  const set = (patch: Partial<FormState>) => setF((x) => ({ ...x, ...patch }));
  const m = f.billingMethod;
  const setTask = (i: number, patch: Partial<FormTask>) => set({ tasks: f.tasks.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const setUser = (i: number, patch: Partial<ProjectUser>) => set({ users: f.users.map((u, j) => (j === i ? { ...u, ...patch } : u)) });
  if (id && !existing) return <Spinner />;
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={id ? `Edit ${existing?.name}` : 'New Project'}>
        <button className="btn-ghost w-8 px-0" onClick={() => navigate(-1)} aria-label="Close">
          <X size={18} />
        </button>
      </PageHeader>
      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl space-y-5 px-6 py-6">
          <Field label="Project Name" required>
            <input className="input max-w-md" autoFocus={!id} value={f.name ?? ''} maxLength={100} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Project Code">
            <input className="input max-w-[220px]" value={f.code ?? ''} maxLength={30} onChange={(e) => set({ code: e.target.value })} />
          </Field>
          <Field label="Client Name" required>
            <div className="max-w-md">
              <ContactPicker kind="customer" value={f.customerId} onChange={(customerId) => set({ customerId })} placeholder="Select client" />
            </div>
          </Field>
          <Field label="Billing Method" required>
            <Select className="max-w-md" value={m} onChange={(e) => set({ billingMethod: e.target.value as Project['billingMethod'] })} options={BILLING_METHODS} />
          </Field>
          {m === 'fixed' && (
            <Field label="Total Project Cost" required>
              <MoneyInput className="max-w-[260px]" value={f.rate} onChange={(v) => set({ rate: Number(v) })} />
            </Field>
          )}
          {m === 'project_hours' && (
            <Field label="Rate Per Hour" required>
              <MoneyInput className="max-w-[260px]" value={f.rate} onChange={(v) => set({ rate: Number(v) })} />
            </Field>
          )}
          {(m === 'task_hours' || m === 'staff_hours') && (
            <Field label="Rate Per Hour">
              <div className="pt-1.5 text-[13px] text-slate-500">Set the rate on each {m === 'task_hours' ? 'task' : 'user'} below.</div>
            </Field>
          )}
          <Field label="Description">
            <textarea className="input h-20 max-w-xl py-1.5" maxLength={2000} value={f.description ?? ''} onChange={(e) => set({ description: e.target.value })} />
          </Field>

          <div className="border-t border-slate-200 pt-5">
            <h2 className="mb-4 text-[15px] font-semibold">Budget</h2>
            <div className="space-y-4">
              <Field label="Cost Budget">
                <MoneyInput className="max-w-[260px]" value={f.costBudget ?? ''} onChange={(v) => set({ costBudget: v === '' ? undefined : Number(v) })} />
              </Field>
              <Field label="Revenue Budget">
                <MoneyInput className="max-w-[260px]" value={f.revenueBudget ?? ''} onChange={(v) => set({ revenueBudget: v === '' ? undefined : Number(v) })} />
              </Field>
              <Field label="Hours Budget">
                <div className="flex flex-wrap items-center gap-3">
                  <Select
                    className="w-56"
                    value={f.budgetHoursType ?? 'none'}
                    onChange={(e) => set({ budgetHoursType: e.target.value as ProjectBudgetHours })}
                    options={[
                      { value: 'none', label: 'No hours budget' },
                      { value: 'total', label: 'Total project hours' },
                      { value: 'per_task', label: 'Hours per task' },
                      { value: 'per_staff', label: 'Hours per staff' },
                    ]}
                  />
                  {f.budgetHoursType === 'total' && <input className="input w-28" type="number" min={0} placeholder="Hours" value={f.budgetHours ?? ''} onChange={(e) => set({ budgetHours: e.target.value === '' ? undefined : Number(e.target.value) })} />}
                </div>
              </Field>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-5">
            <h2 className="mb-3 text-[15px] font-semibold">Users</h2>
            <table className="table rounded-md border border-slate-200">
              <thead>
                <tr>
                  <th className="w-10">S.No</th>
                  <th>User</th>
                  <th>Email</th>
                  {m === 'staff_hours' && <th className="w-40">Rate Per Hour</th>}
                  {f.budgetHoursType === 'per_staff' && <th className="w-32">Budget Hours</th>}
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {f.users.map((u, i) => (
                  <tr key={i}>
                    <td className="text-slate-500">{i + 1}</td>
                    <td>
                      <Select
                        value={u.userId}
                        onChange={(e) => (e.target.value === '__new' ? setNewUser(i) : setUser(i, { userId: e.target.value }))}
                        options={[...users.filter((x) => x.status === 'active' && (x.id === u.userId || !f.users.some((y) => y.userId === x.id))).map((x) => ({ value: x.id, label: x.name })), { value: '__new', label: '+ New User' }]}
                        placeholder="Select user"
                      />
                    </td>
                    <td className="text-slate-500">{users.find((x) => x.id === u.userId)?.email}</td>
                    {m === 'staff_hours' && (
                      <td>
                        <MoneyInput value={u.ratePerHour ?? ''} onChange={(v) => setUser(i, { ratePerHour: v === '' ? undefined : Number(v) })} />
                      </td>
                    )}
                    {f.budgetHoursType === 'per_staff' && (
                      <td>
                        <input className="input" type="number" min={0} value={u.budgetHours ?? ''} onChange={(e) => setUser(i, { budgetHours: e.target.value === '' ? undefined : Number(e.target.value) })} />
                      </td>
                    )}
                    <td>
                      <button className="text-slate-400 hover:text-red-500" onClick={() => set({ users: f.users.filter((_, j) => j !== i) })} aria-label="Remove user">
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="link mt-2 text-[13px]" onClick={() => set({ users: [...f.users, { userId: '' }] })}>
              + Add User
            </button>
          </div>

          <div className="border-t border-slate-200 pt-5">
            <h2 className="mb-3 text-[15px] font-semibold">Project Tasks</h2>
            <table className="table rounded-md border border-slate-200">
              <thead>
                <tr>
                  <th className="w-10">S.No</th>
                  <th>Task Name</th>
                  <th>Description</th>
                  {m === 'task_hours' && <th className="w-40">Rate Per Hour</th>}
                  {f.budgetHoursType === 'per_task' && <th className="w-28">Budget Hours</th>}
                  <th className="w-20 text-center">Billable</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {f.tasks.map((t, i) => (
                  <tr key={t.id}>
                    <td className="text-slate-500">{i + 1}</td>
                    <td>
                      <input className="input" value={t.name} maxLength={100} onChange={(e) => setTask(i, { name: e.target.value })} placeholder="Task name" />
                    </td>
                    <td>
                      <input className="input" value={t.description ?? ''} onChange={(e) => setTask(i, { description: e.target.value })} />
                    </td>
                    {m === 'task_hours' && (
                      <td>
                        <MoneyInput value={t.ratePerHour ?? ''} onChange={(v) => setTask(i, { ratePerHour: v === '' ? undefined : Number(v) })} />
                      </td>
                    )}
                    {f.budgetHoursType === 'per_task' && (
                      <td>
                        <input className="input" type="number" min={0} value={t.budgetHours ?? ''} onChange={(e) => setTask(i, { budgetHours: e.target.value === '' ? undefined : Number(e.target.value) })} />
                      </td>
                    )}
                    <td className="text-center">
                      <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" checked={t.billable} onChange={(e) => setTask(i, { billable: e.target.checked })} aria-label="Billable" />
                    </td>
                    <td>
                      <button className="text-slate-400 hover:text-red-500" onClick={() => set({ tasks: f.tasks.filter((_, j) => j !== i) })} aria-label="Remove task">
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
                {!f.tasks.length && (
                  <tr>
                    <td colSpan={7} className="py-4 text-center text-slate-400">
                      No tasks yet. Tasks let your team log time against specific work.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <button className="link mt-2 text-[13px]" onClick={() => set({ tasks: [...f.tasks, { id: `new${++seq}`, name: '', billable: true }] })}>
              + Add Project Task
            </button>
          </div>

          <div className="border-t border-slate-200 pt-5">
            <Checkbox checked={Boolean(f.watchlist)} onChange={(watchlist) => set({ watchlist })} label="Add to the watchlist on my dashboard" />
          </div>
        </div>
      </div>
      <FormFooter>
        <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: (p) => navigate(`/time-tracking/projects/${p.id}`, { replace: true }) })}>
          Save
        </button>
        <button className="btn-secondary" onClick={() => navigate(-1)}>
          Cancel
        </button>
      </FormFooter>
      <NewUserModal open={newUser !== null} onClose={() => setNewUser(null)} onCreated={(uid) => newUser !== null && setUser(newUser, { userId: uid })} />
    </div>
  );
}

export { ProjectList, ProjectForm, ProjectRoute };
export const ProjectsHomeLink = () => <Link to="/time-tracking/projects" className="link">Projects</Link>;
