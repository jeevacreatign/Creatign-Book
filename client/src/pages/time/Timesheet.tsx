// Timesheet: All Timesheets with Summary, list and calendar views, filters for
// period, customer, project and user, per-row Start, New Log Entry and the weekly log.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BarChart3, Briefcase, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock, Download, List, MoreHorizontal, Plus, Trash2, User as UserIcon, X } from 'lucide-react';
import { addDays, fmtDate, money, parseISO, toISO, today } from '@shared/format';
import { fmtHours, parseHours } from '@shared/projects';
import type { Contact } from '@shared/types';
import { api, qs, useAction, useApi } from '../../api';
import { Dropdown, MenuItem, Modal, Select, Spinner, clsx, useConfirm } from '../../components/ui';
import { Lifecycle } from '../../components/shared';
import { BillingStatusText, FilterPill, HoursInput, LogEntryModal, openTimer, PeriodPill, useProjects, useUsers, type EntryRow } from './common';
import { EntryRowActions } from './ProjectTabs';

const VIEWS = [
  { value: 'all', label: 'All Timesheets' },
  { value: 'unbilled', label: 'Unbilled' },
  { value: 'invoiced', label: 'Invoiced' },
  { value: 'non_billable', label: 'Non-Billable' },
];

function pref<T extends string>(key: string, fallback: T) {
  try {
    return (localStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;
  }
}
function savePref(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* private mode */
  }
}

function exportCsv(rows: EntryRow[]) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Date', 'Project', 'Client', 'Task', 'User', 'Time', 'Hours', 'Billing Status', 'Rate', 'Amount', 'Notes'];
  const body = rows.map((t) => [t.date, t.projectName, t.customerName, t.taskName, t.userName, fmtHours(t.hours), t.hours, t.billingStatusLabel, t.rate, t.amount, t.notes].map(esc).join(','));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([[head.join(','), ...body].join('\n')], { type: 'text/csv' }));
  a.download = `timesheet-${today()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

interface Summary {
  count: number;
  loggedHours: number;
  billableHours: number;
  nonBillableHours: number;
  unbilledHours: number;
  invoicedHours: number;
  unbilledAmount: number;
  byProject: { name: string; hours: number; billable: number; amount: number }[];
  byUser: { name: string; hours: number; billable: number; amount: number }[];
}

export default function Timesheet() {
  const [search, setSearch] = useSearchParams();
  const [view, setView] = useState('all');
  const [layout, setLayoutState] = useState<'list' | 'calendar'>(() => pref('creatign.timesheet.layout', 'list'));
  const [showSummary, setShowSummary] = useState(() => pref<string>('creatign.timesheet.summary', '0') === '1');
  const [period, setPeriod] = useState('all');
  const [custom, setCustom] = useState<{ from?: string; to?: string }>({});
  const [customerId, setCustomerId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [userId, setUserId] = useState('');
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [selected, setSelected] = useState<string[]>([]);
  const [edit, setEdit] = useState<EntryRow>();
  const [newOpen, setNewOpen] = useState<{ date?: string } | null>(search.get('new') ? {} : null);
  const [weekly, setWeekly] = useState(false);
  const highlight = search.get('highlight');
  const setLayout = (l: 'list' | 'calendar') => {
    setLayoutState(l);
    savePref('creatign.timesheet.layout', l);
  };
  const toggleSummary = () => {
    setShowSummary(!showSummary);
    savePref('creatign.timesheet.summary', showSummary ? '0' : '1');
  };
  useEffect(() => {
    if (search.get('new')) {
      search.delete('new');
      setSearch(search, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const monthRange = { from: `${month}-01`, to: toISO(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)) };
  const filters = { status: view, customerId, projectId, userId, ...(layout === 'calendar' ? { period: 'custom', ...monthRange } : { period, ...(period === 'custom' ? custom : {}) }) };
  const { data = [], isLoading } = useApi<EntryRow[]>(`/time-entries${qs(filters)}`);
  const { data: summary } = useApi<Summary>(showSummary ? `/time-entries/summary${qs(filters)}` : null);
  const { data: customers = [] } = useApi<Contact[]>('/contacts?kind=customer');
  const { data: projects = [] } = useProjects('all');
  const { data: users = [] } = useUsers();
  const confirm = useConfirm();
  const bulk = useAction((action: string) => api<{ done: number }>('/time-entries/bulk', { body: { action, ids: selected } }), (r) => `${r.done} entr${r.done === 1 ? 'y' : 'ies'} updated`);
  const all = data.length > 0 && data.filter((r) => !r.invoiced).every((r) => selected.includes(r.id));
  const total = data.reduce((s, t) => s + t.hours, 0);
  const anyFilter = view !== 'all' || period !== 'all' || customerId || projectId || userId;

  return (
    <div className="flex h-full flex-col">
      {selected.length ? (
        <div className="flex min-h-[60px] items-center gap-2 border-b border-slate-200 bg-slate-50 px-6">
          <button className="btn-secondary btn-sm" onClick={() => bulk.mutate('billable', { onSuccess: () => setSelected([]) })}>
            Mark as Billable
          </button>
          <button className="btn-secondary btn-sm" onClick={() => bulk.mutate('non_billable', { onSuccess: () => setSelected([]) })}>
            Mark as Non-Billable
          </button>
          <button className="btn-secondary btn-sm" onClick={() => exportCsv(data.filter((t) => selected.includes(t.id)))}>
            <Download size={13} /> Export
          </button>
          <button className="btn-secondary btn-sm text-red-600" onClick={() => confirm.ask('Delete entries', `Delete ${selected.length} time entr${selected.length === 1 ? 'y' : 'ies'}?`, () => bulk.mutate('delete', { onSuccess: () => setSelected([]) }), { danger: true, label: 'Delete' })}>
            <Trash2 size={13} /> Delete
          </button>
          <span className="ml-2 text-[13px] text-slate-600">{selected.length} selected</span>
          <button className="btn-ghost ml-auto w-8 px-0" onClick={() => setSelected([])} aria-label="Clear selection">
            <X size={16} />
          </button>
        </div>
      ) : (
        <div className="flex min-h-[60px] items-center justify-between gap-3 border-b border-slate-200 px-6">
          <Dropdown
            button={() => (
              <button className="flex items-center gap-1 text-[19px] font-semibold text-slate-900">
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
          <div className="flex items-center gap-2">
            <button className={clsx('flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px]', showSummary ? 'bg-brand-50 text-brand-700' : 'text-brand-600 hover:bg-slate-50')} onClick={toggleSummary}>
              <BarChart3 size={14} /> Summary
            </button>
            <div className="flex h-8 items-center rounded-full border border-slate-300 bg-slate-100 p-0.5">
              <button className={clsx('flex h-full w-9 items-center justify-center rounded-full', layout === 'list' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500')} onClick={() => setLayout('list')} title="List view" aria-label="List view">
                <List size={15} />
              </button>
              <button className={clsx('flex h-full w-9 items-center justify-center rounded-full', layout === 'calendar' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500')} onClick={() => setLayout('calendar')} title="Calendar view" aria-label="Calendar view">
                <CalendarDays size={15} />
              </button>
            </div>
            <button className="btn-primary" onClick={() => openTimer({ projectId: projectId || undefined })}>
              <Clock size={14} /> Start
            </button>
            <div className="flex">
              <button className="btn-primary rounded-r-none" onClick={() => setNewOpen({})}>
                <Plus size={15} /> New Log Entry
              </button>
              <Dropdown align="right" button={() => <button className="btn-primary w-8 rounded-l-none border-l border-l-brand-700 px-0" aria-label="More log options"><ChevronDown size={14} /></button>}>
                <MenuItem onClick={() => setNewOpen({})}>New Log Entry</MenuItem>
                <MenuItem onClick={() => setWeekly(true)}>New Weekly Log</MenuItem>
              </Dropdown>
            </div>
            <Dropdown align="right" button={() => <button className="btn-icon" aria-label="More"><MoreHorizontal size={15} /></button>}>
              <MenuItem icon={<Download size={13} />} onClick={() => exportCsv(data)}>
                Export Timesheet
              </MenuItem>
            </Dropdown>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-6 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">View by:</span>
        {layout === 'list' && <PeriodPill value={period} onChange={setPeriod} custom={custom} setCustom={setCustom} />}
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <FilterPill icon={<UserIcon size={13} className="text-slate-400" />} value={customerId} onChange={(v) => { setCustomerId(v); setProjectId(''); }} placeholder="Select client" options={[{ value: '', label: 'All clients' }, ...customers.map((c) => ({ value: c.id, label: c.displayName }))]} />
        <FilterPill icon={<Briefcase size={13} className="text-slate-400" />} value={projectId} onChange={setProjectId} placeholder="Select a project" options={[{ value: '', label: 'All projects' }, ...projects.filter((p) => !customerId || p.customerId === customerId).map((p) => ({ value: p.id, label: p.name }))]} />
        <FilterPill icon={<UserIcon size={13} className="text-slate-400" />} value={userId} onChange={setUserId} placeholder="Select user" options={[{ value: '', label: 'All users' }, ...users.map((u) => ({ value: u.id, label: u.name }))]} />
        {anyFilter && (
          <button className="ml-1 text-[13px] text-brand-600 hover:underline" onClick={() => { setView('all'); setPeriod('all'); setCustomerId(''); setProjectId(''); setUserId(''); }}>
            Clear filters
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {showSummary && <SummaryPanel s={summary} />}
        {layout === 'calendar' ? (
          <MonthCalendar month={month} setMonth={setMonth} entries={data} onDay={(date) => setNewOpen({ date })} onEntry={setEdit} />
        ) : isLoading ? (
          <Spinner />
        ) : !data.length && !anyFilter ? (
          <Lifecycle
            title="Log the time you spend on projects"
            subtitle="Record hours as you work with the timer, or log them later. Billable hours flow straight into invoices."
            steps={['START TIMER OR LOG TIME', 'REVIEW TIMESHEET', 'INVOICE UNBILLED HOURS']}
            actions={
              <>
                <button className="btn-primary" onClick={() => setNewOpen({})}>
                  NEW LOG ENTRY
                </button>
                <button className="btn-secondary" onClick={() => openTimer()}>
                  Start Timer
                </button>
              </>
            }
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th className="w-10 pl-6">
                  <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" checked={all} onChange={() => setSelected(all ? [] : data.filter((r) => !r.invoiced).map((r) => r.id))} aria-label="Select all" />
                </th>
                <th>Date</th>
                <th>Project</th>
                <th>Client</th>
                <th>Task</th>
                <th>User</th>
                <th className="text-right">Time</th>
                <th>Billing Status</th>
                <th className="w-44" />
              </tr>
            </thead>
            <tbody>
              {data.map((t) => (
                <tr key={t.id} className={clsx('group hover:bg-slate-50', highlight === t.id && 'bg-emerald-50/70')}>
                  <td className="pl-6">
                    <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" disabled={t.invoiced} checked={selected.includes(t.id)} onChange={() => setSelected((s) => (s.includes(t.id) ? s.filter((x) => x !== t.id) : [...s, t.id]))} aria-label="Select entry" />
                  </td>
                  <td>{fmtDate(t.date)}</td>
                  <td>
                    <Link className="link" to={`/time-tracking/projects/${t.projectId}?tab=timesheet`}>
                      {t.projectName}
                    </Link>
                  </td>
                  <td>{t.customerName}</td>
                  <td>
                    <div>{t.taskName ?? '—'}</div>
                    {t.notes && <div className="max-w-[260px] truncate text-xs text-slate-500">{t.notes}</div>}
                  </td>
                  <td>{t.userName}</td>
                  <td className="text-right font-medium tabular-nums">{fmtHours(t.hours)}</td>
                  <td>
                    <BillingStatusText status={t.billingStatus} invoice={t.invoiceNumber} />
                  </td>
                  <td className="pr-4">
                    <EntryRowActions e={t} onEdit={() => setEdit(t)} />
                  </td>
                </tr>
              ))}
              {!data.length && (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-slate-500">
                    There are no timesheets for these filters.
                  </td>
                </tr>
              )}
            </tbody>
            {data.length > 0 && (
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50 text-[13px] font-medium">
                  <td colSpan={6} className="px-3 py-2 pl-6">
                    {data.length} entr{data.length === 1 ? 'y' : 'ies'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtHours(total)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
      <LogEntryModal open={Boolean(newOpen)} onClose={() => setNewOpen(null)} defaults={{ date: newOpen?.date, projectId: projectId || undefined, userId: userId || undefined }} />
      <LogEntryModal open={Boolean(edit)} onClose={() => setEdit(undefined)} entry={edit} />
      <WeeklyLogModal open={weekly} onClose={() => setWeekly(false)} />
      {confirm.node}
    </div>
  );
}

// ------------------------------------------------------------ summary

function SummaryPanel({ s }: { s?: Summary }) {
  if (!s) return <div className="h-[168px] border-b border-slate-200 bg-slate-50" />;
  const tiles: [string, string, string?][] = [
    ['Logged Hours', fmtHours(s.loggedHours), `${s.count} entries`],
    ['Billable Hours', fmtHours(s.billableHours)],
    ['Non-Billable Hours', fmtHours(s.nonBillableHours)],
    ['Unbilled Hours', fmtHours(s.unbilledHours), money(s.unbilledAmount)],
    ['Invoiced Hours', fmtHours(s.invoicedHours)],
  ];
  const max = Math.max(1, ...s.byProject.map((x) => x.hours));
  const maxU = Math.max(1, ...s.byUser.map((x) => x.hours));
  return (
    <div className="grid gap-4 border-b border-slate-200 bg-slate-50 px-6 py-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-3">
        {tiles.map(([label, v, sub]) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
            <div className="text-xs text-slate-500">{label}</div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{v}</div>
            {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
          </div>
        ))}
      </div>
      {[
        ['Hours by project', s.byProject, max],
        ['Hours by user', s.byUser, maxU],
      ].map(([title, list, m]) => (
        <div key={title as string} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title as string}</div>
          <ul className="space-y-2">
            {(list as Summary['byProject']).slice(0, 5).map((x) => (
              <li key={x.name}>
                <div className="flex justify-between text-[13px]">
                  <span className="truncate">{x.name}</span>
                  <span className="tabular-nums text-slate-700">{fmtHours(x.hours)}</span>
                </div>
                <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full bg-[#2a78d6]" style={{ width: `${(x.billable / (m as number)) * 100}%` }} title={`Billable ${fmtHours(x.billable)}`} />
                  <div className="h-full bg-[#9bbbe3]" style={{ width: `${((x.hours - x.billable) / (m as number)) * 100}%` }} title={`Non-billable ${fmtHours(x.hours - x.billable)}`} />
                </div>
              </li>
            ))}
            {!(list as unknown[]).length && <li className="text-[13px] text-slate-400">No time logged.</li>}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------ calendar

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function MonthCalendar({ month, setMonth, entries, onDay, onEntry }: { month: string; setMonth: (m: string) => void; entries: EntryRow[]; onDay: (date: string) => void; onEntry: (e: EntryRow) => void }) {
  const first = `${month}-01`;
  const d = parseISO(first);
  const start = addDays(first, -((d.getDay() + 6) % 7));
  const lastDay = toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  const weeks = Math.ceil(((parseISO(lastDay).getTime() - parseISO(start).getTime()) / 86400000 + 1) / 7);
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
  const byDay = useMemo(() => {
    const mp = new Map<string, EntryRow[]>();
    for (const e of entries) mp.set(e.date, [...(mp.get(e.date) ?? []), e]);
    return mp;
  }, [entries]);
  const shift = (n: number) => setMonth(toISO(new Date(d.getFullYear(), d.getMonth() + n, 1)).slice(0, 7));
  const monthTotal = entries.reduce((s, e) => s + e.hours, 0);
  const t = today();
  return (
    <div className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button className="btn-icon" onClick={() => shift(-1)} aria-label="Previous month">
            <ChevronLeft size={15} />
          </button>
          <button className="btn-icon" onClick={() => shift(1)} aria-label="Next month">
            <ChevronRight size={15} />
          </button>
          <h2 className="ml-1 text-[16px] font-semibold">
            {MONTHS[d.getMonth()]} {d.getFullYear()}
          </h2>
          <button className="btn-ghost btn-sm" onClick={() => setMonth(t.slice(0, 7))}>
            Today
          </button>
        </div>
        <div className="text-[13px] text-slate-600">
          Total this month: <span className="font-semibold tabular-nums text-slate-900">{fmtHours(monthTotal)}</span>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
          {DOW.map((x) => (
            <div key={x} className="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {x}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const list = byDay.get(day) ?? [];
            const inMonth = day.slice(0, 7) === month;
            const hrs = list.reduce((s, e) => s + e.hours, 0);
            return (
              <div key={day} className={clsx('group min-h-[112px] cursor-pointer border-b border-r border-slate-100 p-1.5 hover:bg-brand-50/40', !inMonth && 'bg-slate-50/70')} onClick={() => onDay(day)}>
                <div className="mb-1 flex items-center justify-between">
                  <span className={clsx('flex h-6 w-6 items-center justify-center rounded-full text-xs', day === t ? 'bg-brand-600 font-semibold text-white' : inMonth ? 'text-slate-700' : 'text-slate-400')}>{Number(day.slice(8))}</span>
                  {hrs > 0 ? <span className="text-[11px] font-semibold tabular-nums text-slate-700">{fmtHours(hrs)}</span> : <Plus size={12} className="invisible text-slate-400 group-hover:visible" />}
                </div>
                <div className="space-y-1">
                  {list.slice(0, 3).map((e) => (
                    <button
                      key={e.id}
                      className={clsx('flex w-full items-center justify-between gap-1 truncate rounded px-1.5 py-0.5 text-left text-[11px]', e.billingStatus === 'invoiced' ? 'bg-emerald-50 text-emerald-800' : e.billable ? 'bg-brand-50 text-brand-800' : 'bg-slate-100 text-slate-600')}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onEntry(e);
                      }}
                      title={`${e.projectName} · ${e.taskName ?? ''} · ${e.userName}`}
                    >
                      <span className="truncate">{e.projectName}</span>
                      <span className="shrink-0 tabular-nums">{fmtHours(e.hours)}</span>
                    </button>
                  ))}
                  {list.length > 3 && <div className="px-1.5 text-[11px] text-slate-500">+{list.length - 3} more</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-2 flex gap-4 text-[11px] text-slate-500">
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-brand-100" /> Billable</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-slate-200" /> Non-billable</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-100" /> Invoiced</span>
        <span className="ml-auto">Click a day to log time.</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ weekly log

interface WeekRow {
  projectId: string;
  taskId?: string;
  hours: string[];
}
const mondayOf = (iso: string) => addDays(iso, -((parseISO(iso).getDay() + 6) % 7));
const emptyRow = (): WeekRow => ({ projectId: '', hours: Array(7).fill('') });

function WeeklyLogModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: projects = [] } = useProjects('active');
  const { data: users = [] } = useUsers();
  const [week, setWeek] = useState(() => mondayOf(today()));
  const [userId, setUserId] = useState('');
  const [rows, setRows] = useState<WeekRow[]>([emptyRow()]);
  useEffect(() => {
    if (open) {
      setRows([emptyRow()]);
      setWeek(mondayOf(today()));
    }
  }, [open]);
  const save = useAction(() => api<{ created: number; hours: number }>('/time-entries/weekly', { body: { weekStart: week, userId: userId || undefined, rows } }), (r) => `${r.created} entries logged (${fmtHours(r.hours)})`);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const h = (v: string) => (parseHours(v) > 0 ? parseHours(v) : 0);
  const dayTotal = (i: number) => rows.reduce((s, r) => s + h(r.hours[i]), 0);
  const setRow = (i: number, patch: Partial<WeekRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Weekly Log"
      width="max-w-6xl"
      footer={
        <>
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            Save
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <span className="ml-auto text-[13px] text-slate-600">
            Week total: <span className="font-semibold tabular-nums text-slate-900">{fmtHours(days.reduce((s, _, i) => s + dayTotal(i), 0))}</span>
          </span>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <button className="btn-icon" onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week">
            <ChevronLeft size={15} />
          </button>
          <div className="min-w-[200px] text-center text-[13px] font-medium">
            {fmtDate(week)} – {fmtDate(addDays(week, 6))}
          </div>
          <button className="btn-icon" onClick={() => setWeek(addDays(week, 7))} aria-label="Next week">
            <ChevronRight size={15} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-slate-600">User</span>
          <Select className="w-48" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="Me" options={users.map((u) => ({ value: u.id, label: u.name }))} />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="table min-w-[900px]">
          <thead>
            <tr>
              <th className="w-52">Project</th>
              <th className="w-44">Task</th>
              {days.map((x, i) => (
                <th key={x} className="w-[76px] text-center">
                  <div>{DOW[i]}</div>
                  <div className="font-normal normal-case text-slate-400">{Number(x.slice(8))}</div>
                </th>
              ))}
              <th className="w-16 text-right">Total</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const prj = projects.find((p) => p.id === r.projectId);
              return (
                <tr key={i}>
                  <td>
                    <Select value={r.projectId} onChange={(e) => setRow(i, { projectId: e.target.value, taskId: undefined })} placeholder="Select a project" options={projects.map((p) => ({ value: p.id, label: p.name }))} />
                  </td>
                  <td>
                    <Select value={r.taskId ?? ''} disabled={!prj?.tasks.length} onChange={(e) => setRow(i, { taskId: e.target.value || undefined })} placeholder={prj?.tasks.length ? 'Select a task' : 'No tasks'} options={(prj?.tasks ?? []).map((k) => ({ value: k.id, label: k.name }))} />
                  </td>
                  {r.hours.map((v, d2) => (
                    <td key={d2} className="px-1">
                      <HoursInput className="px-1.5 text-center" value={v} onChange={(x) => setRow(i, { hours: Object.assign([...r.hours], { [d2]: x }) })} />
                    </td>
                  ))}
                  <td className="text-right font-medium tabular-nums">{fmtHours(r.hours.reduce((s, x) => s + h(x), 0))}</td>
                  <td>
                    {rows.length > 1 && (
                      <button className="text-slate-400 hover:text-red-500" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove row">
                        <X size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50 text-[13px] font-medium">
              <td colSpan={2} className="px-3 py-2">
                <button className="link" onClick={() => setRows([...rows, emptyRow()])}>
                  + Add another project
                </button>
              </td>
              {days.map((x, i) => (
                <td key={x} className="px-1 py-2 text-center tabular-nums">
                  {fmtHours(dayTotal(i))}
                </td>
              ))}
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </Modal>
  );
}
