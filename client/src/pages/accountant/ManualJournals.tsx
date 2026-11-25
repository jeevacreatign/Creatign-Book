// Accountant > Journal Vouchers: list with period/status views, split view with
// Overview / Activity Logs, the New Journal form (reverse date, reporting method, contacts, drafts,
// attachments) and journal templates.
import { useEffect, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronDown, Copy, FileText, Lock, LockOpen, Pencil, Plus, Printer, RefreshCcw, Repeat, Send, StickyNote, Trash2, X } from 'lucide-react';
import { REPORTING_METHODS, reportingMethodLabel } from '@shared/accountant';
import { PERIODS, fmtDate, fmtDateTime, money, today, type PeriodKey } from '@shared/format';
import type { Activity, Attachment, Journal, JournalTemplate, ReportingMethod } from '@shared/types';
import { api, qs, useAction, useApi } from '../../api';
import { useBoot, useOrg } from '../../lib/app';
import { toast } from '../../lib/toast';
import { DateInput, Dropdown, Field, FormFooter, MenuItem, Modal, Radio, Select, Spinner, Status, clsx, useConfirm } from '../../components/ui';
import { Attachments } from '../../components/shared';
import { DetailHeader, ListHeader, MoreMenu, SplitList, TabStrip, Toolbar, ToolbarBtn, ToolbarMore, ViewPicker, csvOf, downloadText, useSelection } from '../../components/split';
import { AnyContactPicker, JournalLinesEditor, lineTotals, type DraftLine } from './common';

type JRow = Journal & { amount: number; contactNames: string[] };
type JDetail = Omit<JRow, "lines"> & {
  lines: (Journal['lines'][number] & { accountName: string; contactName?: string })[];
  projectName?: string;
  reversal: { id: string; number: string; date: string }[];
  reversalOfJournal?: { id: string; number: string };
  activities: Activity[];
};

const BASE = '/accountant/manual-journals';
const VIEWS = [
  { value: 'all', label: 'All Journal Vouchers' },
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
];

function useJournals(status: string, period: string) {
  return useApi<JRow[]>(`/manual-journals${qs({ status, period })}`);
}

function NewButton({ compact }: { compact?: boolean }) {
  const navigate = useNavigate();
  return (
    <div className="flex">
      <button className={clsx('btn-primary rounded-r-none', compact && 'w-8 px-0')} onClick={() => navigate(`${BASE}/new`)} aria-label="New Journal">
        <Plus size={15} /> {!compact && 'New'}
      </button>
      <Dropdown align="right" button={() => <button className="btn-primary rounded-l-none border-l border-brand-500 px-1.5" aria-label="More new options"><ChevronDown size={14} /></button>}>
        <MenuItem onClick={() => navigate(`${BASE}/new`)}>New Journal</MenuItem>
        <MenuItem onClick={() => navigate(`${BASE}/templates?pick=1`)}>Create from Template</MenuItem>
        <MenuItem onClick={() => navigate(`${BASE}/templates/new`)}>New Template</MenuItem>
      </Dropdown>
    </div>
  );
}

function PeriodFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1 text-[13px] text-slate-600">
      Period:
      <Dropdown button={() => <button className="font-medium text-slate-800">{value === 'all' ? 'All' : PERIODS.find((p) => p.value === value)?.label} ▾</button>}>
        {[{ value: 'all', label: 'All' }, ...PERIODS.filter((p) => p.value !== 'all')].map((p) => (
          <MenuItem key={p.value} onClick={() => onChange(p.value)}>
            {p.label}
          </MenuItem>
        ))}
      </Dropdown>
    </div>
  );
}

function exportJournals(rows: JRow[], accounts: { id: string; name: string }[]) {
  const name = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;
  const out: (string | number | undefined)[][] = [['Journal Date', 'Journal Number', 'Reference Number', 'Status', 'Notes', 'Reporting Method', 'Account', 'Description', 'Debit', 'Credit']];
  for (const j of rows) for (const l of j.lines) out.push([j.date, j.number, j.reference, j.status, j.notes, reportingMethodLabel(j.reportingMethod), name(l.accountId), l.description, l.debit || '', l.credit || '']);
  downloadText(`manual-journals-${today()}.csv`, csvOf(out));
}

function JournalList() {
  const navigate = useNavigate();
  const { accounts } = useBoot();
  const [status, setStatus] = useState('all');
  const [period, setPeriod] = useState('all');
  const { data = [], isLoading } = useJournals(status, period);
  const sel = useSelection(data.map((j) => j.id));
  const confirm = useConfirm();
  const del = useAction((ids: string[]) => api('/manual-journals/bulk-delete', { body: { ids } }), 'Journals deleted');
  return (
    <div>
      <ListHeader title={<ViewPicker value={status} onChange={setStatus} options={VIEWS} />}>
        <NewButton />
        <MoreMenu>
          <MenuItem onClick={() => navigate(`${BASE}/templates`)}>Manage Templates</MenuItem>
          <MenuItem onClick={() => navigate('/accountant/recurring-journals')}>Voucher Schedules</MenuItem>
          <MenuItem onClick={() => exportJournals(data, accounts)}>Export Journals (CSV)</MenuItem>
        </MoreMenu>
      </ListHeader>
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-5 py-2.5">
        <PeriodFilter value={period} onChange={setPeriod} />
        {sel.selected.length > 0 && (
          <div className="flex items-center gap-2 text-[13px]">
            <span className="text-slate-500">{sel.selected.length} selected</span>
            <button className="btn-secondary btn-sm text-red-600" onClick={() => confirm.ask('Delete journals', `Delete ${sel.selected.length} journal(s)? This cannot be undone.`, () => del.mutate(sel.selected, { onSuccess: sel.clear }), { danger: true, label: 'Delete' })}>
              <Trash2 size={13} /> Delete
            </button>
          </div>
        )}
      </div>
      {isLoading ? (
        <Spinner />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th className="w-10 pl-5">
                <input type="checkbox" className="accent-brand-600" checked={sel.all} onChange={sel.toggleAll} aria-label="Select all" />
              </th>
              <th>Date</th>
              <th>Journal#</th>
              <th>Reference Number</th>
              <th>Status</th>
              <th>Notes</th>
              <th className="text-right">Amount</th>
              <th>Created By</th>
              <th className="pr-5">Reporting Method</th>
            </tr>
          </thead>
          <tbody>
            {data.map((j) => (
              <tr key={j.id} className="row-link" onClick={() => navigate(`${BASE}/${j.id}`)}>
                <td className="pl-5" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" className="accent-brand-600" checked={sel.selected.includes(j.id)} onChange={() => sel.toggle(j.id)} aria-label={`Select ${j.number}`} />
                </td>
                <td>{fmtDate(j.date)}</td>
                <td className="text-brand-600">
                  {j.number} {j.locked && <Lock size={11} className="ml-1 inline text-slate-400" />}
                </td>
                <td>{j.reference}</td>
                <td>
                  <Status status={j.status || 'published'} />
                </td>
                <td>{j.notes && <span title={j.notes}><StickyNote size={14} className="text-slate-500" /></span>}</td>
                <td className="text-right tabular-nums">{money(j.amount)}</td>
                <td>{j.createdBy}</td>
                <td className="pr-5">{reportingMethodLabel(j.reportingMethod)}</td>
              </tr>
            ))}
            {!data.length && (
              <tr>
                <td colSpan={9} className="py-16 text-center">
                  <div className="text-[15px] font-medium text-slate-700">No manual journals {status !== 'all' || period !== 'all' ? 'in this view' : 'yet'}</div>
                  <div className="mt-1 text-slate-500">Record adjustments such as depreciation, accruals, provisions or owner contributions.</div>
                  <button className="btn-primary mt-4" onClick={() => navigate(`${BASE}/new`)}>
                    <Plus size={14} /> New Journal
                  </button>
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

function JournalPane() {
  const { id } = useParams();
  const [status, setStatus] = useState('all');
  const [period, setPeriod] = useState('all');
  const { data = [] } = useJournals(status, period);
  return (
    <SplitList
      header={
        <>
          <ViewPicker compact value={status} onChange={setStatus} options={VIEWS} />
          <NewButton compact />
        </>
      }
    >
      <div className="border-b border-slate-100 px-3 py-2">
        <PeriodFilter value={period} onChange={setPeriod} />
      </div>
      {data.map((j) => (
        <Link key={j.id} to={`${BASE}/${j.id}`} className={clsx('block border-b border-slate-100 px-3 py-3 hover:bg-slate-50', j.id === id && 'bg-brand-50/70')}>
          <div className="flex justify-between gap-2">
            <span className="font-medium text-slate-800">{fmtDate(j.date)}</span>
            <span className="tabular-nums">{money(j.amount)}</span>
          </div>
          <div className="mt-0.5 flex justify-between gap-2 text-xs">
            <span className="truncate text-brand-600">{j.number}</span>
            <Status status={j.status || 'published'} />
          </div>
        </Link>
      ))}
      {!data.length && <div className="px-4 py-10 text-center text-[13px] text-slate-400">No journals in this view.</div>}
    </SplitList>
  );
}

function JournalDoc({ j }: { j: JDetail }) {
  const org = useOrg();
  const dr = j.lines.reduce((s, l) => s + l.debit, 0);
  const cr = j.lines.reduce((s, l) => s + l.credit, 0);
  return (
    <div className="print-area rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-5 flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400">{org.name}</div>
          <div className="mt-1 flex items-center gap-2 text-[22px] font-semibold">
            {j.number}
            <span className={clsx('rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', j.status === 'draft' ? 'bg-slate-100 text-slate-600' : 'bg-emerald-600 text-white')}>{j.status === 'draft' ? 'Draft' : 'Published'}</span>
            {j.locked && (
              <span className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-600">
                <Lock size={10} /> Locked
              </span>
            )}
          </div>
        </div>
        <div className="text-right text-xs text-slate-500">JOURNAL</div>
      </div>
      <div className="grid gap-x-10 md:grid-cols-2">
        <div>
          <Row k="Journal#" v={j.number} />
          <Row k="Journal Date" v={fmtDate(j.date)} />
          <Row k="Currency" v="INR" />
          <Row k="Notes" v={j.notes} />
          {j.projectName && <Row k="Project" v={j.projectName} />}
        </div>
        <div>
          <Row k="Reference Number" v={j.reference || '-'} />
          <Row k="Transaction Type" v="Journal" />
          <Row k="Reporting Method" v={reportingMethodLabel(j.reportingMethod)} />
          {j.reverseDate && <Row k="Reverse Journal Date" v={fmtDate(j.reverseDate)} />}
          {j.reversalOfJournal && (
            <Row
              k="Reversal Of"
              v={
                <Link className="link" to={`${BASE}/${j.reversalOfJournal.id}`}>
                  {j.reversalOfJournal.number}
                </Link>
              }
            />
          )}
          {j.reversal.map((r) => (
            <Row
              key={r.id}
              k="Reversed By"
              v={
                <Link className="link" to={`${BASE}/${r.id}`}>
                  {r.number} ({fmtDate(r.date)})
                </Link>
              }
            />
          ))}
        </div>
      </div>
      <div className="mt-6 mb-2 text-[15px] font-semibold">Journal Details</div>
      <table className="table border-t border-slate-200">
        <thead>
          <tr>
            <th>Item</th>
            <th>Contact</th>
            <th className="w-32 text-right">Debit</th>
            <th className="w-32 text-right">Credit</th>
          </tr>
        </thead>
        <tbody>
          {j.lines.map((l, i) => (
            <tr key={i}>
              <td>
                <div className="font-medium">{l.accountName}</div>
                {l.description && <div className="text-xs text-slate-500">{l.description}</div>}
              </td>
              <td>{l.contactName}</td>
              <td className="text-right tabular-nums">{l.debit ? money(l.debit, '') : ''}</td>
              <td className="text-right tabular-nums">{l.credit ? money(l.credit, '') : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ml-auto mt-3 w-full max-w-sm space-y-2 text-[13px]">
        <div className="grid grid-cols-[1fr_100px_100px]">
          <span className="text-slate-500">Sub Total</span>
          <span className="text-right tabular-nums">{money(dr, '')}</span>
          <span className="text-right tabular-nums">{money(cr, '')}</span>
        </div>
        <div className="grid grid-cols-[1fr_100px_100px] border-t border-slate-200 pt-2 text-[15px] font-semibold">
          <span>Total Amount</span>
          <span className="text-right tabular-nums">{money(dr, '')}</span>
          <span className="text-right tabular-nums">{money(cr, '')}</span>
        </div>
      </div>
      {!!j.attachments?.length && (
        <div className="mt-6">
          <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Attachments</div>
          {j.attachments.map((a) => (
            <a key={a.id} className="link mr-4 inline-flex items-center gap-1 text-[13px]" href={a.url} target="_blank" rel="noreferrer">
              <FileText size={13} /> {a.name}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_minmax(0,1fr)] py-1.5 text-[13px]">
      <span className="text-slate-500">{k}</span>
      <span className="font-medium text-slate-800">{v || '-'}</span>
    </div>
  );
}

function JournalDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: j, isLoading, error } = useApi<JDetail>(`/manual-journals/${id}`);
  const [tab, setTab] = useState<'overview' | 'activity'>('overview');
  const [reverseOpen, setReverseOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const confirm = useConfirm();
  const act = useAction((a: { action: string; body?: Record<string, unknown> }) => api<Journal>(`/manual-journals/${id}/actions/${a.action}`, { body: a.body ?? {} }));
  const del = useAction(() => api(`/manual-journals/${id}`, { method: 'DELETE' }), 'Journal deleted');
  useEffect(() => setTab('overview'), [id]);
  if (isLoading) return <Spinner />;
  if (error || !j) return <div className="p-8 text-red-600">{(error as Error)?.message || 'Journal not found'}</div>;
  const run = (action: string, msg: string, body?: Record<string, unknown>, go?: boolean) => act.mutate({ action, body }, { onSuccess: (r) => { toast.success(msg); if (go) navigate(`${BASE}/${r.id}`); } });
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <DetailHeader title={j.number}>
        <button className="btn-ghost w-8 px-0 text-red-500" title="Close" onClick={() => navigate(BASE)}>
          <X size={18} />
        </button>
      </DetailHeader>
      <Toolbar>
        <ToolbarBtn icon={<Pencil size={14} />} disabled={j.locked} onClick={() => navigate(`${BASE}/${j.id}/edit`)}>
          Edit
        </ToolbarBtn>
        <ToolbarBtn icon={<Printer size={14} />} onClick={() => window.print()}>
          PDF/Print
        </ToolbarBtn>
        {j.status === 'draft' && (
          <ToolbarBtn icon={<Send size={14} />} onClick={() => run('publish', 'Journal published')}>
            Publish
          </ToolbarBtn>
        )}
        <ToolbarMore>
          <MenuItem icon={<Copy size={13} />} onClick={() => navigate(`${BASE}/new?clone=${j.id}`)}>
            Clone
          </MenuItem>
          <MenuItem icon={<RefreshCcw size={13} />} onClick={() => navigate(`${BASE}/new?clone=${j.id}&reverse=1`)}>
            Clone Reverse Entry
          </MenuItem>
          <MenuItem icon={<Repeat size={13} />} disabled={j.status === 'draft'} onClick={() => setReverseOpen(true)}>
            Create Reverse Journal
          </MenuItem>
          <MenuItem icon={<FileText size={13} />} onClick={() => setTplOpen(true)}>
            Create Template
          </MenuItem>
          <MenuItem icon={<Repeat size={13} />} onClick={() => navigate(`/accountant/recurring-journals/new?from=${j.id}`)}>
            Make Recurring
          </MenuItem>
          <div className="my-1 border-t border-slate-100" />
          <MenuItem danger icon={<Trash2 size={13} />} disabled={j.locked} onClick={() => confirm.ask('Delete journal', `Delete journal ${j.number}? This cannot be undone.`, () => del.mutate(undefined, { onSuccess: () => navigate(BASE) }), { danger: true, label: 'Delete' })}>
            Delete
          </MenuItem>
          <div className="my-1 border-t border-slate-100" />
          {j.locked ? (
            <MenuItem icon={<LockOpen size={13} />} onClick={() => run('unlock', 'Journal unlocked')}>
              Unlock Journal
            </MenuItem>
          ) : (
            <MenuItem icon={<Lock size={13} />} onClick={() => run('lock', 'Journal locked')}>
              Lock Journal
            </MenuItem>
          )}
        </ToolbarMore>
      </Toolbar>
      <div className="flex-1 overflow-y-auto bg-slate-50/50 px-5 py-4">
        <div className="mx-auto max-w-4xl">
          <TabStrip className="no-print mb-4" value={tab} onChange={setTab} tabs={[{ value: 'overview', label: 'Overview' }, { value: 'activity', label: 'Activity Logs' }]} />
          {tab === 'overview' ? (
            <JournalDoc j={j} />
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white p-5">
              {j.activities.map((a) => (
                <div key={a.id} className="flex gap-4 border-b border-slate-100 py-2.5 text-[13px] last:border-0">
                  <span className="w-40 shrink-0 text-slate-500">{fmtDateTime(a.createdAt)}</span>
                  <span>
                    {a.message} <span className="text-slate-400">by {a.author}</span>
                  </span>
                </div>
              ))}
              {!j.activities.length && <div className="text-slate-400">No activity yet.</div>}
            </div>
          )}
        </div>
      </div>
      {reverseOpen && <ReverseModal j={j} onClose={() => setReverseOpen(false)} onDone={(rid) => navigate(`${BASE}/${rid}`)} />}
      {tplOpen && <TemplateNameModal j={j} onClose={() => setTplOpen(false)} />}
      {confirm.node}
    </div>
  );
}

function ReverseModal({ j, onClose, onDone }: { j: JDetail; onClose: () => void; onDone: (id: string) => void }) {
  const [date, setDate] = useState(today() < j.date ? j.date : today());
  const go = useAction(() => api<Journal>(`/manual-journals/${j.id}/actions/reverse`, { body: { date } }), 'Reverse journal created');
  return (
    <Modal open onClose={onClose} title="Create Reverse Journal" footer={<><button className="btn-primary" onClick={() => go.mutate(undefined, { onSuccess: (r) => { onClose(); onDone(r.id); } })}>Create</button><button className="btn-secondary" onClick={onClose}>Cancel</button></>}>
      <p className="mb-4 text-[13px] text-slate-600">A new published journal swaps the debits and credits of {j.number}, cancelling its effect from the date you choose.</p>
      <Field label="Reverse Journal Date" required>
        <DateInput value={date} onChange={setDate} />
      </Field>
    </Modal>
  );
}

function TemplateNameModal({ j, onClose }: { j: JDetail; onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState(`${j.number} template`);
  const go = useAction(() => api<JournalTemplate>(`/manual-journals/${j.id}/actions/save-as-template`, { body: { name } }), 'Template created');
  return (
    <Modal open onClose={onClose} title="Create Template" footer={<><button className="btn-primary" onClick={() => go.mutate(undefined, { onSuccess: () => { onClose(); navigate(`${BASE}/templates`); } })}>Save</button><button className="btn-secondary" onClick={onClose}>Cancel</button></>}>
      <Field label="Template Name" required>
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
    </Modal>
  );
}

// ------------------------------------------------------------ form

function JournalForm() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { accounts } = useBoot();
  const cloneId = search.get('clone');
  const reverse = search.get('reverse') === '1';
  const templateId = search.get('template');
  const { data: existing } = useApi<JDetail>(id ? `/manual-journals/${id}` : cloneId ? `/manual-journals/${cloneId}` : null);
  const { data: tpl } = useApi<JournalTemplate>(templateId ? `/journal-templates/${templateId}` : null);
  const { data: next } = useApi<{ number: string }>(id ? null : '/manual-journals/next-number');
  const { data: projects = [] } = useApi<{ id: string; name: string }[]>('/projects?view=active');
  const [f, setF] = useState<{ date: string; reverseDate: string; number: string; reference: string; notes: string; reportingMethod: ReportingMethod; projectId: string; attachments: Attachment[] }>({ date: today(), reverseDate: '', number: '', reference: '', notes: '', reportingMethod: 'accrual_and_cash', projectId: search.get('projectId') || '', attachments: [] });
  const [publishReverseOnly, setPublishReverseOnly] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([{}, {}]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (loaded) return;
    if (existing) {
      const ls = existing.lines.map((l) => ({ accountId: l.accountId, description: l.description, contactId: l.contactId, debit: (reverse ? l.credit : l.debit) || '', credit: (reverse ? l.debit : l.credit) || '' }));
      setLines(ls);
      setF({ date: id ? existing.date : today(), reverseDate: id ? existing.reverseDate || '' : '', number: id ? existing.number : '', reference: existing.reference || '', notes: existing.notes || '', reportingMethod: existing.reportingMethod || 'accrual_and_cash', projectId: existing.projectId || '', attachments: id ? existing.attachments || [] : [] });
      setLoaded(true);
    } else if (tpl) {
      setLines(tpl.lines.map((l) => ({ accountId: l.accountId, description: l.description, contactId: l.contactId, debit: l.type === 'debit' ? l.amount || '' : '', credit: l.type === 'credit' ? l.amount || '' : '' })));
      setF((x) => ({ ...x, reference: tpl.reference || '', notes: tpl.notes || '', reportingMethod: tpl.reportingMethod }));
      setLoaded(true);
    }
  }, [existing, tpl, loaded, id, reverse]);
  const number = f.number || next?.number || '';
  const save = useAction((status: 'draft' | 'published') => {
    const body = { ...f, number, status, lines, projectId: f.projectId || undefined, reverseDate: f.reverseDate || '' };
    return id ? api<Journal>(`/manual-journals/${id}`, { method: 'PUT', body }) : api<Journal>('/manual-journals', { body });
  }, (r) => `Journal ${r.number} saved`);
  const t = lineTotals(lines);
  const submit = (status: 'draft' | 'published') => {
    if (!f.notes.trim() && status === 'published') return toast.error('Notes are required');
    if (t.diff) return toast.error('Debits and credits must be equal');
    save.mutate(status, { onSuccess: (r) => navigate(`${BASE}/${r.id}`) });
  };
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <h1 className="text-[19px]">{id ? 'Edit Journal' : 'New Journal'}</h1>
        <div className="flex items-center gap-3">
          {!id && (
            <Link className="link text-[13px]" to={`${BASE}/templates?pick=1`}>
              Choose Template
            </Link>
          )}
          <button className="btn-ghost w-8 px-0" onClick={() => navigate(-1)} aria-label="Close">
            <X size={18} />
          </button>
        </div>
      </div>
      <div className="flex-1 space-y-6 px-5 py-5">
        <div className="max-w-2xl space-y-3">
          <Field label="Date" required>
            <DateInput className="max-w-[300px]" value={f.date} onChange={(v) => setF({ ...f, date: v })} />
          </Field>
          <Field label="Reverse Journal Date">
            <div className="max-w-[300px]">
              <DateInput value={f.reverseDate} onChange={(v) => setF({ ...f, reverseDate: v })} />
              <label className="mt-1.5 flex items-center gap-1.5 text-[12px] text-slate-600">
                <input type="checkbox" className="accent-brand-600" checked={publishReverseOnly} onChange={(e) => setPublishReverseOnly(e.target.checked)} />
                Publish reverse journal only on the reverse journal date
              </label>
            </div>
          </Field>
          <Field label="Journal#" required>
            <input className="input max-w-[300px]" value={number} onChange={(e) => setF({ ...f, number: e.target.value })} />
          </Field>
          <Field label="Reference#">
            <input className="input max-w-[300px]" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
          </Field>
          <Field label="Notes" required>
            <textarea className="input max-w-[300px]" rows={3} maxLength={500} placeholder="Max. 500 characters" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </Field>
          <Field label="Reporting Method">
            <Radio name="rm" value={f.reportingMethod} onChange={(v) => setF({ ...f, reportingMethod: v })} options={REPORTING_METHODS} />
          </Field>
          <Field label="Currency">
            <Select className="max-w-[300px]" value="INR" onChange={() => undefined} options={[{ value: 'INR', label: 'INR- Indian Rupee' }]} />
          </Field>
          {projects.length > 0 && (
            <Field label="Project">
              <Select className="max-w-[300px]" value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })} placeholder="Select a project" options={projects.map((p) => ({ value: p.id, label: p.name }))} />
            </Field>
          )}
        </div>
        <JournalLinesEditor accounts={accounts} lines={lines} onChange={setLines} />
        <div className="max-w-md">
          <div className="mb-1 text-[13px] text-slate-600">Attachments</div>
          <Attachments value={f.attachments} onChange={(a) => setF({ ...f, attachments: a })} label="Upload File" compact />
          <div className="mt-1 text-xs text-slate-400">You can upload a maximum of 10 files, 10MB each</div>
        </div>
      </div>
      <FormFooter>
        <button className="btn-primary" disabled={save.isPending} onClick={() => submit('published')}>
          Save and Publish
        </button>
        <button className="btn-secondary" disabled={save.isPending} onClick={() => submit('draft')}>
          Save as Draft
        </button>
        <button className="btn-secondary" onClick={() => navigate(-1)}>
          Cancel
        </button>
      </FormFooter>
    </div>
  );
}

// ------------------------------------------------------------ templates

type TRow = JournalTemplate & { amount?: number };

function Templates() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const { data = [], isLoading } = useApi<TRow[]>('/journal-templates');
  const del = useAction((id: string) => api(`/journal-templates/${id}`, { method: 'DELETE' }), 'Template deleted');
  const confirm = useConfirm();
  return (
    <div>
      <ListHeader
        title={
          <div className="flex items-center gap-3">
            <button className="btn-icon" onClick={() => navigate(BASE)} aria-label="Back">
              ‹
            </button>
            <div>
              <div className="text-xs text-slate-500">Journal Vouchers</div>
              <div className="text-[17px] font-semibold">{search.get('pick') ? 'Choose a Template' : 'Journal Templates'}</div>
            </div>
          </div>
        }
      >
        <button className="btn-primary" onClick={() => navigate(`${BASE}/templates/new`)}>
          <Plus size={15} /> New
        </button>
      </ListHeader>
      {isLoading ? (
        <Spinner />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th className="pl-5">Template Name</th>
              <th>Amount</th>
              <th>Notes</th>
              <th>Reporting Method</th>
              <th className="pr-5" />
            </tr>
          </thead>
          <tbody>
            {data.map((t) => (
              <tr key={t.id} className="group">
                <td className="pl-5 font-medium">{t.name}</td>
                <td className="tabular-nums">{t.amount != null ? money(t.amount) : '-'}</td>
                <td className="max-w-xs truncate">{t.notes}</td>
                <td>{reportingMethodLabel(t.reportingMethod)}</td>
                <td className="pr-5 text-right">
                  <div className="inline-flex gap-1">
                    <button className="btn-secondary btn-sm" onClick={() => navigate(`${BASE}/new?template=${t.id}`)}>
                      Use
                    </button>
                    <button className="btn-secondary btn-sm" onClick={() => navigate(`${BASE}/templates/${t.id}/edit`)}>
                      Edit
                    </button>
                    <button className="btn-secondary btn-sm text-slate-500 hover:text-red-600" aria-label="Delete" onClick={() => confirm.ask('Delete template', `Delete ${t.name}?`, () => del.mutate(t.id), { danger: true, label: 'Delete' })}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!data.length && (
              <tr>
                <td colSpan={5} className="py-14 text-center text-slate-500">
                  No templates yet. Save journals you post often, like monthly depreciation, as templates.
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

function TemplateForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { accounts } = useBoot();
  const { data: existing } = useApi<JournalTemplate>(id ? `/journal-templates/${id}` : null);
  const [f, setF] = useState<Partial<JournalTemplate>>({ reportingMethod: 'accrual_and_cash', enterAmount: false, lines: [{ accountId: '', type: 'debit' }, { accountId: '', type: 'credit' }] });
  useEffect(() => {
    if (existing) setF(existing);
  }, [existing]);
  const lines = f.lines || [];
  const up = (i: number, p: Partial<JournalTemplate['lines'][number]>) => setF({ ...f, lines: lines.map((l, j) => (j === i ? { ...l, ...p } : l)) });
  const save = useAction(() => (id ? api(`/journal-templates/${id}`, { method: 'PUT', body: f }) : api('/journal-templates', { body: f })), 'Template saved');
  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b border-slate-200 px-5 py-3">
        <h1 className="text-[19px]">{id ? 'Edit Template' : 'New Template'}</h1>
      </div>
      <div className="flex-1 space-y-6 px-5 py-5">
        <div className="max-w-2xl space-y-3">
          <Field label="Template Name" required>
            <input className="input max-w-[300px]" autoFocus value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Reference#">
            <input className="input max-w-[300px]" value={f.reference || ''} onChange={(e) => setF({ ...f, reference: e.target.value })} />
          </Field>
          <Field label="Notes" required>
            <textarea className="input max-w-[300px]" rows={3} maxLength={500} placeholder="Max. 500 characters" value={f.notes || ''} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </Field>
          <Field label="Reporting Method">
            <Radio name="trm" value={f.reportingMethod || 'accrual_and_cash'} onChange={(v) => setF({ ...f, reportingMethod: v })} options={REPORTING_METHODS} />
          </Field>
          <Field label="Currency">
            <Select className="max-w-[300px]" value="INR" onChange={() => undefined} options={[{ value: 'INR', label: 'INR- Indian Rupee' }]} />
          </Field>
        </div>
        <div className="max-w-5xl">
          <label className="mb-2 flex items-center justify-end gap-1.5 text-[13px]">
            <input type="checkbox" className="accent-brand-600" checked={!!f.enterAmount} onChange={(e) => setF({ ...f, enterAmount: e.target.checked })} />
            Enter an amount
          </label>
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="table min-w-[720px]">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Description</th>
                  <th>Contact (INR)</th>
                  <th className="w-32">Type</th>
                  {f.enterAmount && <th className="w-32 text-right">Amount</th>}
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <select className="input" value={l.accountId} onChange={(e) => up(i, { accountId: e.target.value })}>
                        <option value="">Select an account</option>
                        {accounts.filter((a) => a.active).map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input className="input" placeholder="Description" value={l.description || ''} onChange={(e) => up(i, { description: e.target.value })} />
                    </td>
                    <td>
                      <AnyContactPicker value={l.contactId} onChange={(v) => up(i, { contactId: v || undefined })} />
                    </td>
                    <td>
                      <Select value={l.type} onChange={(e) => up(i, { type: e.target.value as 'debit' | 'credit' })} options={[{ value: 'debit', label: 'Debit' }, { value: 'credit', label: 'Credit' }]} />
                    </td>
                    {f.enterAmount && (
                      <td>
                        <input inputMode="decimal" className="input text-right" value={l.amount ?? ''} onChange={(e) => up(i, { amount: e.target.value as unknown as number })} />
                      </td>
                    )}
                    <td>
                      <button className="mt-2 text-slate-400 hover:text-red-500" disabled={lines.length <= 2} onClick={() => setF({ ...f, lines: lines.filter((_, j) => j !== i) })} aria-label="Remove row">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn-secondary btn-sm mt-3 text-brand-700" onClick={() => setF({ ...f, lines: [...lines, { accountId: '', type: 'debit' }] })}>
            <Plus size={13} /> Add New Row
          </button>
        </div>
      </div>
      <FormFooter>
        <button className="btn-primary" onClick={() => save.mutate(undefined, { onSuccess: () => navigate(`${BASE}/templates`) })}>
          Save
        </button>
        <button className="btn-secondary" onClick={() => navigate(-1)}>
          Cancel
        </button>
      </FormFooter>
    </div>
  );
}

function SplitJournal() {
  return (
    <div className="flex h-full">
      <JournalPane />
      <JournalDetail />
    </div>
  );
}

export default function ManualJournals() {
  return (
    <Routes>
      <Route index element={<JournalList />} />
      <Route path="new" element={<JournalForm />} />
      <Route path="templates" element={<Templates />} />
      <Route path="templates/new" element={<TemplateForm />} />
      <Route path="templates/:id/edit" element={<TemplateForm />} />
      <Route path=":id/edit" element={<JournalForm />} />
      <Route path=":id" element={<SplitJournal />} />
    </Routes>
  );
}
