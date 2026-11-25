// Shared time tracking UI: types, the log entry dialog, the running timer in the top bar,
// filter pills and the "Invoice project" dialog.
import { useMe } from '../../auth';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Clock, Pause, Play, Square, Trash2, X } from 'lucide-react';
import { fmtDate, money, today } from '@shared/format';
import { BILLING_STATUS_LABEL, fmtClock, fmtHours, hoursBetween, parseHours, TIME_PERIODS, type BillingStatus } from '@shared/projects';
import type { Project, ProjectTask, ProjectUser, RunningTimer, TimeEntry, TxnDoc, User } from '@shared/types';
import { api, qs, useAction, useApi } from '../../api';
import { Checkbox, Combo, DateInput, Dropdown, Field, MenuItem, Modal, MoneyInput, Radio, Select, clsx, useOutside } from '../../components/ui';

// ------------------------------------------------------------ types

export interface ProjectStats {
  customerName?: string;
  billingMethodLabel: string;
  loggedHours: number;
  billableHours: number;
  nonBillableHours: number;
  billedHours: number;
  unbilledHours: number;
  unbilledAmount: number;
  unbilledExpenses: number;
  billedAmount: number;
  budgetHours: number;
}
export type ProjectRow = Project & ProjectStats;
export type ProjectDetail = Omit<ProjectRow, 'users' | 'tasks'> & {
  users: (ProjectUser & { name: string; email?: string; role: string; loggedHours: number })[];
  tasks: (ProjectTask & { loggedHours: number })[];
};
export type EntryRow = TimeEntry & {
  projectName?: string;
  customerId?: string;
  customerName?: string;
  taskName?: string;
  userName?: string;
  billingMethod?: string;
  rate: number;
  amount: number;
  billingStatus: BillingStatus;
  billingStatusLabel: string;
  invoiceNumber?: string;
};
export type TimerView = RunningTimer & { elapsedMs: number; projectName?: string; customerName?: string; taskName?: string };

export const useProjects = (view = 'active') => useApi<ProjectRow[]>(`/projects${qs({ view })}`);
export const useUsers = () => useApi<User[]>('/users');

const STATUS_TONE: Record<BillingStatus, string> = { unbilled: 'text-amber-600', invoiced: 'text-emerald-600', non_billable: 'text-slate-500' };
export function BillingStatusText({ status, invoice }: { status: BillingStatus; invoice?: string }) {
  return (
    <span className={clsx('text-[12px] font-medium', STATUS_TONE[status])} title={invoice ? `Invoice ${invoice}` : undefined}>
      {BILLING_STATUS_LABEL[status]}
    </span>
  );
}

// ------------------------------------------------------------ filter pills (VIEW BY: Period: All ▾)

export function FilterPill({ label, value, options, onChange, icon, placeholder }: { label?: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; icon?: ReactNode; placeholder?: string }) {
  const current = options.find((o) => o.value === value);
  return (
    <Dropdown
      button={() => (
        <button className="flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-[13px] text-slate-600 hover:border-slate-400">
          {icon}
          {label && <span>{label}:</span>}
          <span className={clsx(current ? 'font-medium text-slate-900' : 'text-slate-400')}>{current?.label ?? placeholder}</span>
          <ChevronDown size={13} className="text-slate-400" />
        </button>
      )}
    >
      <div className="max-h-80 overflow-auto">
        {options.map((o) => (
          <MenuItem key={o.value} onClick={() => onChange(o.value)}>
            <span className={clsx(o.value === value && 'font-semibold text-brand-700')}>{o.label}</span>
          </MenuItem>
        ))}
      </div>
    </Dropdown>
  );
}

export function PeriodPill({ value, onChange, custom, setCustom }: { value: string; onChange: (v: string) => void; custom: { from?: string; to?: string }; setCustom: (c: { from?: string; to?: string }) => void }) {
  return (
    <div className="flex items-center gap-2">
      <FilterPill label="Period" value={value} onChange={onChange} options={TIME_PERIODS.map((p) => ({ value: p.value, label: p.label }))} />
      {value === 'custom' && (
        <div className="flex items-center gap-1">
          <DateInput className="w-32" value={custom.from} onChange={(from) => setCustom({ ...custom, from })} />
          <span className="text-slate-400">–</span>
          <DateInput className="w-32" value={custom.to} onChange={(to) => setCustom({ ...custom, to })} />
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ HH:MM input

export function HoursInput({ value, onChange, className, autoFocus }: { value: string; onChange: (v: string) => void; className?: string; autoFocus?: boolean }) {
  const ok = !value || parseHours(value) >= 0;
  return (
    <input
      className={clsx('input tabular-nums', !ok && 'border-red-400', className)}
      placeholder="HH:MM"
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => {
        const h = parseHours(value);
        if (h >= 0 && value) onChange(fmtHours(h));
      }}
    />
  );
}

// ------------------------------------------------------------ project + task pickers

function TaskPicker({ project, value, freeName, onChange }: { project?: ProjectRow; value?: string; freeName?: string; onChange: (taskId?: string, taskName?: string) => void }) {
  const opts = (project?.tasks ?? []).map((t) => ({ value: t.id, label: t.name, sub: t.billable ? undefined : 'Non-billable' }));
  return (
    <Combo
      options={opts}
      value={value}
      allowFree
      freeValue={freeName}
      onFree={(name) => onChange(undefined, name)}
      onChange={(id) => onChange(id, undefined)}
      placeholder={project ? (opts.length ? 'Select a task or type a new one' : 'Type a task name') : 'Select a project first'}
      disabled={!project}
    />
  );
}

// ------------------------------------------------------------ log entry dialog

interface EntryForm {
  date: string;
  projectId?: string;
  taskId?: string;
  taskName?: string;
  userId?: string;
  time: string;
  useRange: boolean;
  startTime: string;
  endTime: string;
  billable: boolean;
  notes: string;
}

export function LogEntryModal({ open, onClose, entry, defaults }: { open: boolean; onClose: () => void; entry?: EntryRow; defaults?: { projectId?: string; date?: string; userId?: string } }) {
  const { data: projects = [] } = useProjects('all');
  const { data: users = [] } = useUsers();
  const blank = (): EntryForm => ({
    date: entry?.date ?? defaults?.date ?? today(),
    projectId: entry?.projectId ?? defaults?.projectId,
    taskId: entry?.taskId,
    userId: entry?.userId ?? defaults?.userId,
    time: entry ? fmtHours(entry.hours) : '',
    useRange: Boolean(entry?.startTime),
    startTime: entry?.startTime ?? '09:00',
    endTime: entry?.endTime ?? '',
    billable: entry?.billable ?? true,
    notes: entry?.notes ?? '',
  });
  const [f, setF] = useState<EntryForm>(blank);
  useEffect(() => {
    if (open) setF(blank());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry?.id]);
  const me = useMe();
  useEffect(() => {
    // default to the signed-in user
    if (open && !f.userId && users.length) setF((x) => ({ ...x, userId: (users.find((u) => u.id === me.user.id) ?? users.find((u) => u.role === 'Admin' && u.status === 'active') ?? users[0]).id }));
  }, [open, users.length, f.userId]);
  const project = projects.find((p) => p.id === f.projectId);
  const selectable = projects.filter((p) => p.status === 'active' || p.id === f.projectId);
  const locked = entry?.invoiced;
  const body = () => ({
    date: f.date,
    projectId: f.projectId,
    taskId: f.taskId,
    taskName: f.taskName,
    userId: f.userId || undefined,
    hours: f.useRange ? undefined : f.time,
    startTime: f.useRange ? f.startTime : undefined,
    endTime: f.useRange ? f.endTime : undefined,
    billable: f.billable,
    notes: f.notes,
  });
  const save = useAction((again: boolean) => (entry ? api(`/time-entries/${entry.id}`, { method: 'PUT', body: body() }) : api('/time-entries', { body: body() })).then(() => again), entry ? 'Time entry updated' : 'Time logged');
  const startTimer = useAction(() => api('/timer/start', { body: { projectId: f.projectId, taskId: f.taskId, notes: f.notes, billable: f.billable } }), 'Timer started');
  const rangeHours = f.useRange && f.startTime && f.endTime ? hoursBetween(f.startTime, f.endTime) : NaN;
  const userOpts = users.filter((u) => u.status === 'active').map((u) => ({ value: u.id, label: u.name }));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={entry ? 'Edit Log Entry' : 'New Log Entry'}
      width="max-w-xl"
      footer={
        <div className="flex w-full items-center gap-2">
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(false, { onSuccess: () => onClose() })}>
            Save
          </button>
          {!entry && (
            <button className="btn-secondary" disabled={save.isPending} onClick={() => save.mutate(true, { onSuccess: () => setF({ ...blank(), projectId: f.projectId, date: f.date, userId: f.userId }) })}>
              Save and New
            </button>
          )}
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          {!entry && (
            <button className="btn-ghost ml-auto text-brand-700" disabled={!f.projectId || startTimer.isPending} onClick={() => startTimer.mutate(undefined, { onSuccess: () => onClose() })} title="Start a timer instead of typing the time">
              <Play size={13} /> Start Timer
            </button>
          )}
        </div>
      }
    >
      {locked && <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">This entry is on invoice {entry?.invoiceNumber}. Only the notes can be changed.</div>}
      <div className="space-y-4">
        <Field label="Date" required>
          <DateInput className="max-w-[180px]" value={f.date} onChange={(date) => setF({ ...f, date })} disabled={locked} />
        </Field>
        <Field label="Project Name" required>
          <Select
            value={f.projectId || ''}
            disabled={locked}
            onChange={(e) => {
              const p = projects.find((x) => x.id === e.target.value);
              setF({ ...f, projectId: e.target.value || undefined, taskId: undefined, taskName: undefined, billable: p?.billingMethod === 'fixed' ? f.billable : true });
            }}
            placeholder="Select a project"
            options={selectable.map((p) => ({ value: p.id, label: p.customerName ? `${p.name} (${p.customerName})` : p.name }))}
          />
        </Field>
        <Field label="Task Name" required={Boolean(project?.tasks.length)}>
          <TaskPicker
            project={project}
            value={f.taskId}
            freeName={f.taskName}
            onChange={(taskId, taskName) => {
              const t = project?.tasks.find((k) => k.id === taskId);
              setF({ ...f, taskId, taskName, billable: t ? t.billable : f.billable });
            }}
          />
        </Field>
        <Field label="Time Spent" required>
          <div className="space-y-2">
            <Radio
              name="timemode"
              value={f.useRange ? 'range' : 'spent'}
              onChange={(v) => setF({ ...f, useRange: v === 'range' })}
              options={[
                { value: 'spent', label: 'Time spent (HH:MM)' },
                { value: 'range', label: 'Start and end time' },
              ]}
            />
            {f.useRange ? (
              <div className="flex items-center gap-2">
                <input type="time" className="input w-32" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} disabled={locked} aria-label="Start time" />
                <span className="text-slate-400">to</span>
                <input type="time" className="input w-32" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} disabled={locked} aria-label="End time" />
                {rangeHours > 0 && <span className="text-[13px] text-slate-500">= {fmtHours(rangeHours)}</span>}
              </div>
            ) : locked ? (
              <input className="input w-32" value={f.time} disabled />
            ) : (
              <HoursInput className="w-32" value={f.time} onChange={(time) => setF({ ...f, time })} />
            )}
          </div>
        </Field>
        <Field label="User" required>
          <Select value={f.userId || ''} onChange={(e) => setF({ ...f, userId: e.target.value })} placeholder="Select a user" options={userOpts} disabled={locked} />
        </Field>
        {project?.billingMethod !== 'fixed' && (
          <Field label="">
            <Checkbox checked={f.billable} onChange={(billable) => setF({ ...f, billable })} label="Billable" disabled={locked} />
          </Field>
        )}
        <Field label="Notes">
          <textarea className="input h-20 py-1.5" value={f.notes} maxLength={500} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="What did you work on?" />
        </Field>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ running timer (top bar)

const OPEN_EVENT = 'creatign:timer-open';
/** Open the timer popover in the top bar (optionally prefilled with a project). */
export function openTimer(defaults?: { projectId?: string }) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: defaults ?? {} }));
}

export function useTimer() {
  return useApi<{ timer: TimerView | null }>('/timer', { refetchInterval: 60_000 });
}

/** Ticking elapsed time for the current timer. */
function useElapsed(t?: TimerView | null) {
  const [, force] = useState(0);
  const fetchedAt = useRef(Date.now());
  useEffect(() => {
    fetchedAt.current = Date.now();
  }, [t?.elapsedMs, t?.running]);
  useEffect(() => {
    if (!t?.running) return;
    const i = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(i);
  }, [t?.running]);
  if (!t) return 0;
  return t.elapsedMs + (t.running ? Date.now() - fetchedAt.current : 0);
}

export function TimerChip() {
  const qc = useQueryClient();
  const { data } = useTimer();
  const t = data?.timer;
  const ms = useElapsed(t);
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<{ projectId?: string }>({});
  const box = useRef<HTMLDivElement>(null);
  useOutside(box, () => setOpen(false));
  useEffect(() => {
    const h = (e: Event) => {
      setPreset((e as CustomEvent).detail ?? {});
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, h);
    return () => window.removeEventListener(OPEN_EVENT, h);
  }, []);
  useEffect(() => {
    document.title = t?.running ? `${fmtClock(ms)} · Creatign Ledger` : 'Creatign Ledger';
  }, [t?.running, Math.floor(ms / 1000)]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!t && !open) return null;
  return (
    <div ref={box} className="relative">
      {t ? (
        <button
          className={clsx('flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium tabular-nums', t.running ? 'bg-emerald-500/90 text-white hover:bg-emerald-500' : 'bg-amber-400/90 text-ink-900 hover:bg-amber-400')}
          onClick={() => setOpen((o) => !o)}
          title={t.projectName ? `Timer · ${t.projectName}` : 'Timer'}
        >
          <Clock size={13} className={clsx(t.running && 'animate-pulse')} />
          {fmtClock(ms)}
        </button>
      ) : (
        <button className="flex h-7 items-center gap-1.5 rounded-md bg-white/10 px-2.5 text-[13px] text-white" onClick={() => setOpen(false)}>
          <Clock size={13} /> Timer
        </button>
      )}
      {open && (
        <div className="menu right-0 w-[360px] p-0 text-slate-800">
          {t ? <RunningTimerPanel t={t} ms={ms} onDone={() => setOpen(false)} /> : <StartTimerPanel preset={preset} onDone={() => { setOpen(false); qc.invalidateQueries(); }} />}
        </div>
      )}
    </div>
  );
}

function StartTimerPanel({ preset, onDone }: { preset: { projectId?: string }; onDone: () => void }) {
  const { data: projects = [] } = useProjects('active');
  const [projectId, setProjectId] = useState(preset.projectId);
  const [taskId, setTaskId] = useState<string>();
  const [notes, setNotes] = useState('');
  const [billable, setBillable] = useState(true);
  const project = projects.find((p) => p.id === projectId);
  const start = useAction(() => api('/timer/start', { body: { projectId, taskId, notes, billable } }), 'Timer started');
  return (
    <div>
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <div className="font-semibold">Start Timer</div>
        <button className="text-slate-400 hover:text-slate-600" onClick={onDone} aria-label="Close">
          <X size={15} />
        </button>
      </div>
      <div className="space-y-3 px-4 py-3">
        <Field label="Project" inline={false}>
          <Select value={projectId || ''} onChange={(e) => { setProjectId(e.target.value || undefined); setTaskId(undefined); }} placeholder="Select a project (optional)" options={projects.map((p) => ({ value: p.id, label: p.name }))} />
        </Field>
        <Field label="Task" inline={false}>
          <Select value={taskId || ''} onChange={(e) => { setTaskId(e.target.value || undefined); const k = project?.tasks.find((x) => x.id === e.target.value); if (k) setBillable(k.billable); }} placeholder={project ? 'Select a task' : 'Select a project first'} disabled={!project} options={(project?.tasks ?? []).map((k) => ({ value: k.id, label: k.name }))} />
        </Field>
        <Field label="Notes" inline={false}>
          <textarea className="input h-16 py-1.5" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {project?.billingMethod !== 'fixed' && <Checkbox checked={billable} onChange={setBillable} label="Billable" />}
      </div>
      <div className="flex gap-2 border-t border-slate-100 px-4 py-3">
        <button className="btn-primary" disabled={start.isPending} onClick={() => start.mutate(undefined, { onSuccess: onDone })}>
          <Play size={13} /> Start Timer
        </button>
        <button className="btn-secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function RunningTimerPanel({ t, ms, onDone }: { t: TimerView; ms: number; onDone: () => void }) {
  const navigate = useNavigate();
  const { data: projects = [] } = useProjects('active');
  const [projectId, setProjectId] = useState(t.projectId);
  const [taskId, setTaskId] = useState(t.taskId);
  const [notes, setNotes] = useState(t.notes ?? '');
  const project = projects.find((p) => p.id === projectId);
  const pause = useAction(() => api(t.running ? '/timer/pause' : '/timer/resume', { body: {} }));
  const stop = useAction(() => api<EntryRow>('/timer/stop', { body: { projectId, taskId, notes } }), (e) => `${fmtHours(e.hours)} logged to ${e.projectName}`);
  const discard = useAction(() => api('/timer', { method: 'DELETE' }), 'Timer discarded');
  const locked = Boolean(t.entryId);
  return (
    <div>
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <div>
          <div className="text-xxs font-semibold uppercase tracking-wide text-slate-400">{t.running ? 'Timer running' : 'Timer paused'}</div>
          <div className="text-2xl font-semibold tabular-nums text-slate-900">{fmtClock(ms)}</div>
        </div>
        <button className="text-slate-400 hover:text-slate-600" onClick={onDone} aria-label="Close">
          <X size={15} />
        </button>
      </div>
      <div className="space-y-3 px-4 py-3">
        {locked ? (
          <div className="rounded-md bg-slate-50 px-3 py-2 text-[13px]">
            Adding time to an existing entry: <span className="font-medium">{t.projectName}</span>
            {t.taskName && <> · {t.taskName}</>}
          </div>
        ) : (
          <>
            <Field label="Project" inline={false} required>
              <Select value={projectId || ''} onChange={(e) => { setProjectId(e.target.value || undefined); setTaskId(undefined); }} placeholder="Select a project" options={projects.map((p) => ({ value: p.id, label: p.name }))} />
            </Field>
            <Field label="Task" inline={false}>
              <Select value={taskId || ''} onChange={(e) => setTaskId(e.target.value || undefined)} placeholder={project ? 'Select a task' : 'Select a project first'} disabled={!project} options={(project?.tasks ?? []).map((k) => ({ value: k.id, label: k.name }))} />
            </Field>
          </>
        )}
        <Field label="Notes" inline={false}>
          <textarea className="input h-16 py-1.5" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-3">
        <button className="btn-primary" disabled={stop.isPending} onClick={() => stop.mutate(undefined, { onSuccess: (e) => { onDone(); navigate(`/time-tracking/timesheet?highlight=${e.id}`); } })}>
          <Square size={12} /> Stop and Save
        </button>
        <button className="btn-secondary" onClick={() => pause.mutate()}>
          {t.running ? <><Pause size={13} /> Pause</> : <><Play size={13} /> Resume</>}
        </button>
        <button className="btn-ghost ml-auto text-red-600" onClick={() => discard.mutate(undefined, { onSuccess: onDone })} title="Discard this timer">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ invoice project

type Grouping = 'project' | 'task' | 'staff' | 'entry';
interface Unbilled {
  billingMethod: string;
  projectCost: number;
  unbilledAmount: number;
  billedAmount: number;
  entries: EntryRow[];
  expenses: { id: string; date: string; accountName?: string; notes?: string; amount: number }[];
}

export function InvoiceProjectModal({ project, open, onClose }: { project: ProjectRow; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const [groupBy, setGroupBy] = useState<Grouping>('project');
  const [includeExpenses, setIncludeExpenses] = useState(true);
  const [fee, setFee] = useState('');
  const { data } = useApi<Unbilled>(open ? `/projects/${project.id}/unbilled${qs(range)}` : null);
  const [skip, setSkip] = useState<string[]>([]);
  const fixed = project.billingMethod === 'fixed';
  useEffect(() => {
    if (open && data && fixed && !fee) setFee(String(data.unbilledAmount));
  }, [open, data, fixed]); // eslint-disable-line react-hooks/exhaustive-deps
  const entries = (data?.entries ?? []).filter((e) => !skip.includes(e.id));
  const timeTotal = entries.reduce((s, e) => s + e.amount, 0);
  const expTotal = includeExpenses ? (data?.expenses ?? []).reduce((s, e) => s + e.amount, 0) : 0;
  const total = (fixed ? Number(fee) || 0 : timeTotal) + expTotal;
  const create = useAction(
    () => api<TxnDoc>(`/projects/${project.id}/invoice`, { body: { ...range, groupBy, includeExpenses, fee: fixed ? Number(fee) : undefined, entryIds: fixed ? undefined : entries.map((e) => e.id) } }),
    (inv) => `Draft invoice ${inv.number} created`,
  );
  const hours = useMemo(() => entries.reduce((s, e) => s + e.hours, 0), [entries]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Invoice ${project.name}`}
      width="max-w-3xl"
      footer={
        <>
          <button className="btn-primary" disabled={create.isPending || total <= 0} onClick={() => create.mutate(undefined, { onSuccess: (inv) => { onClose(); navigate(`/sales/invoices/${inv.id}/edit`); } })}>
            Create Invoice
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <span className="ml-auto text-[13px] text-slate-600">
            Invoice total before tax: <span className="font-semibold text-slate-900">{money(total)}</span>
          </span>
        </>
      }
    >
      <div className="space-y-4">
        {fixed ? (
          <>
            <div className="grid grid-cols-3 gap-3 rounded-md bg-slate-50 p-3 text-[13px]">
              <div>
                <div className="text-slate-500">Total Project Cost</div>
                <div className="font-semibold">{money(project.rate)}</div>
              </div>
              <div>
                <div className="text-slate-500">Billed</div>
                <div className="font-semibold text-red-600">{money(data?.billedAmount ?? 0)}</div>
              </div>
              <div>
                <div className="text-slate-500">Left to bill</div>
                <div className="font-semibold text-emerald-600">{money(data?.unbilledAmount ?? 0)}</div>
              </div>
            </div>
            <Field label="Project Fee" required hint="Bill the whole cost or a milestone part of it.">
              <MoneyInput className="max-w-[220px]" value={fee} onChange={setFee} />
            </Field>
          </>
        ) : (
          <>
            <Field label="Unbilled time from">
              <div className="flex items-center gap-2">
                <DateInput className="w-36" value={range.from} onChange={(from) => setRange({ ...range, from })} placeholder="Start" />
                <span className="text-slate-400">to</span>
                <DateInput className="w-36" value={range.to} onChange={(to) => setRange({ ...range, to })} placeholder="End" />
              </div>
            </Field>
            <Field label="Show on the invoice as">
              <Radio
                name="groupby"
                value={groupBy}
                onChange={setGroupBy}
                options={[
                  { value: 'project', label: 'Single line for the project' },
                  { value: 'task', label: 'One line per task' },
                  { value: 'staff', label: 'One line per user' },
                  { value: 'entry', label: 'One line per time entry' },
                ]}
              />
            </Field>
            <div className="overflow-hidden rounded-md border border-slate-200">
              <table className="table">
                <thead>
                  <tr>
                    <th className="w-8" />
                    <th>Date</th>
                    <th>Task</th>
                    <th>User</th>
                    <th className="text-right">Time</th>
                    <th className="text-right">Rate</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.entries ?? []).map((e) => (
                    <tr key={e.id} className={clsx(skip.includes(e.id) && 'opacity-50')}>
                      <td>
                        <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" checked={!skip.includes(e.id)} onChange={() => setSkip((s) => (s.includes(e.id) ? s.filter((x) => x !== e.id) : [...s, e.id]))} aria-label="Include entry" />
                      </td>
                      <td>{fmtDate(e.date)}</td>
                      <td>{e.taskName ?? '—'}</td>
                      <td>{e.userName}</td>
                      <td className="text-right tabular-nums">{fmtHours(e.hours)}</td>
                      <td className="text-right tabular-nums">{e.rate ? money(e.rate) : <span className="text-red-500">No rate</span>}</td>
                      <td className="text-right tabular-nums">{money(e.amount)}</td>
                    </tr>
                  ))}
                  {!data?.entries.length && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-slate-400">
                        No unbilled billable time{range.from || range.to ? ' in this period' : ''}.
                      </td>
                    </tr>
                  )}
                </tbody>
                {entries.length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-50 font-medium">
                      <td colSpan={4} className="px-3 py-2">
                        {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtHours(hours)}</td>
                      <td />
                      <td className="px-3 py-2 text-right tabular-nums">{money(timeTotal)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </>
        )}
        {(data?.expenses.length ?? 0) > 0 && (
          <div className="rounded-md border border-slate-200 p-3">
            <Checkbox checked={includeExpenses} onChange={setIncludeExpenses} label={`Include ${data!.expenses.length} unbilled billable expense(s) (${money(data!.expenses.reduce((s, e) => s + e.amount, 0))})`} />
          </div>
        )}
      </div>
    </Modal>
  );
}
