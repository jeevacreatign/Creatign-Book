// Accountant > Voucher Schedules: profiles that publish the same journal on a schedule.
import { useEffect, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Pause, Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import { REPORTING_METHODS, reportingMethodLabel } from '@shared/accountant';
import { fmtDate, frequencyLabel, money, today } from '@shared/format';
import type { RecurringJournal, RepeatEvery, ReportingMethod } from '@shared/types';
import { api, useAction, useApi } from '../../api';
import { useBoot } from '../../lib/app';
import { toast } from '../../lib/toast';
import { Checkbox, DateInput, Field, FormFooter, Radio, Spinner, Status, useConfirm } from '../../components/ui';
import { DetailHeader, Detail, ListHeader, Toolbar, ToolbarBtn } from '../../components/split';
import { RepeatSelect } from '../expenses/parts';
import { JournalLinesEditor, lineTotals, type DraftLine } from './common';

const BASE = '/accountant/recurring-journals';
type RRow = RecurringJournal & { amount: number; children: number };
type RDetail = Omit<RecurringJournal, 'lines'> & { amount: number; lines: (RecurringJournal['lines'][number] & { accountName?: string; contactName?: string })[]; children: { id: string; number: string; date: string; amount: number; status?: string }[] };

function List() {
  const navigate = useNavigate();
  const { data = [], isLoading } = useApi<RRow[]>('/recurring-journals');
  return (
    <div>
      <ListHeader title={<h1 className="text-[19px]">Voucher Schedules</h1>}>
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
              <th className="pl-5">Profile Name</th>
              <th>Frequency</th>
              <th>Last Journal Date</th>
              <th>Next Journal Date</th>
              <th>Status</th>
              <th className="pr-5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id} className="row-link" onClick={() => navigate(`${BASE}/${r.id}`)}>
                <td className="pl-5 font-medium text-brand-600">{r.profileName}</td>
                <td>{frequencyLabel(r.repeatEvery)}</td>
                <td>{fmtDate(r.lastGeneratedDate) || '-'}</td>
                <td>{r.status === 'active' ? fmtDate(r.nextDate) : '-'}</td>
                <td>
                  <Status status={r.status} />
                </td>
                <td className="pr-5 text-right tabular-nums">{money(r.amount)}</td>
              </tr>
            ))}
            {!data.length && (
              <tr>
                <td colSpan={6} className="py-16 text-center text-slate-500">
                  No recurring journals. Automate entries you post every period, such as depreciation or accrued rent.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Form() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { accounts } = useBoot();
  const fromJournal = search.get('from');
  const { data: existing } = useApi<RDetail>(id ? `/recurring-journals/${id}` : null);
  const { data: src } = useApi<{ reference?: string; notes?: string; reportingMethod?: ReportingMethod; lines: DraftLine[] }>(fromJournal ? `/manual-journals/${fromJournal}` : null);
  const [f, setF] = useState<{ profileName: string; repeatEvery: RepeatEvery; startOn: string; endsOn: string; neverExpires: boolean; reference: string; notes: string; reportingMethod: ReportingMethod }>({ profileName: '', repeatEvery: { n: 1, unit: 'month' }, startOn: today(), endsOn: '', neverExpires: true, reference: '', notes: '', reportingMethod: 'accrual_and_cash' });
  const [lines, setLines] = useState<DraftLine[]>([{}, {}]);
  useEffect(() => {
    const s = existing ?? src;
    if (!s) return;
    if (existing) setF({ profileName: existing.profileName, repeatEvery: existing.repeatEvery, startOn: existing.startOn, endsOn: existing.endsOn || '', neverExpires: existing.neverExpires, reference: existing.reference || '', notes: existing.notes || '', reportingMethod: existing.reportingMethod });
    else setF((x) => ({ ...x, reference: s.reference || '', notes: s.notes || '', reportingMethod: s.reportingMethod || 'accrual_and_cash' }));
    setLines(s.lines.map((l) => ({ accountId: l.accountId, description: l.description, contactId: l.contactId, debit: Number(l.debit) || '', credit: Number(l.credit) || '' })));
  }, [existing, src]);
  const save = useAction(() => (id ? api<RecurringJournal>(`/recurring-journals/${id}`, { method: 'PUT', body: { ...f, lines } }) : api<RecurringJournal>('/recurring-journals', { body: { ...f, lines } })), 'Recurring journal saved');
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <h1 className="text-[19px]">{id ? 'Edit Voucher Schedule' : 'New Voucher Schedule'}</h1>
        <button className="btn-ghost w-8 px-0" onClick={() => navigate(-1)} aria-label="Close">
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 space-y-6 px-5 py-5">
        <div className="max-w-2xl space-y-3">
          <Field label="Profile Name" required>
            <input className="input max-w-[300px]" autoFocus value={f.profileName} onChange={(e) => setF({ ...f, profileName: e.target.value })} />
          </Field>
          <Field label="Repeat Every" required>
            <div className="max-w-[300px]">
              <RepeatSelect value={f.repeatEvery} onChange={(r) => setF({ ...f, repeatEvery: r })} />
            </div>
          </Field>
          <Field label="Start On" required>
            <DateInput className="max-w-[300px]" value={f.startOn} onChange={(v) => setF({ ...f, startOn: v })} />
          </Field>
          <Field label="Ends On">
            <div className="flex max-w-md items-center gap-3">
              <DateInput disabled={f.neverExpires} value={f.endsOn} onChange={(v) => setF({ ...f, endsOn: v })} />
              <Checkbox checked={f.neverExpires} onChange={(v) => setF({ ...f, neverExpires: v })} label="Never Expires" />
            </div>
          </Field>
          <Field label="Reference#">
            <input className="input max-w-[300px]" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
          </Field>
          <Field label="Notes" required>
            <textarea className="input max-w-[300px]" rows={3} maxLength={500} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </Field>
          <Field label="Reporting Method">
            <Radio name="rrm" value={f.reportingMethod} onChange={(v) => setF({ ...f, reportingMethod: v })} options={REPORTING_METHODS} />
          </Field>
        </div>
        <JournalLinesEditor accounts={accounts} lines={lines} onChange={setLines} />
      </div>
      <FormFooter>
        <button className="btn-primary" onClick={() => (lineTotals(lines).diff ? toast.error('Debits and credits must be equal') : save.mutate(undefined, { onSuccess: (r) => navigate(`${BASE}/${r.id}`) }))}>
          Save
        </button>
        <button className="btn-secondary" onClick={() => navigate(-1)}>
          Cancel
        </button>
      </FormFooter>
    </div>
  );
}

function View() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: r, isLoading } = useApi<RDetail>(`/recurring-journals/${id}`);
  const act = useAction((a: string) => api(`/recurring-journals/${id}/actions/${a}`, { body: {} }), 'Profile updated');
  const del = useAction(() => api(`/recurring-journals/${id}`, { method: 'DELETE' }), 'Profile deleted');
  const confirm = useConfirm();
  if (isLoading || !r) return <Spinner />;
  return (
    <div>
      <DetailHeader kicker="Voucher Schedule" title={r.profileName}>
        <button className="btn-ghost w-8 px-0 text-red-500" onClick={() => navigate(BASE)} aria-label="Close">
          <X size={18} />
        </button>
      </DetailHeader>
      <Toolbar>
        <ToolbarBtn icon={<Pencil size={14} />} onClick={() => navigate(`${BASE}/${r.id}/edit`)}>
          Edit
        </ToolbarBtn>
        {r.status === 'active' ? (
          <ToolbarBtn icon={<Pause size={14} />} onClick={() => act.mutate('stop')}>
            Stop
          </ToolbarBtn>
        ) : (
          <ToolbarBtn icon={<Play size={14} />} onClick={() => act.mutate('resume')}>
            Resume
          </ToolbarBtn>
        )}
        <ToolbarBtn icon={<Trash2 size={14} />} onClick={() => confirm.ask('Delete profile', 'Journals already created stay as they are.', () => del.mutate(undefined, { onSuccess: () => navigate(BASE) }), { danger: true, label: 'Delete' })}>
          Delete
        </ToolbarBtn>
      </Toolbar>
      <div className="grid max-w-5xl gap-8 px-5 py-5 md:grid-cols-2">
        <div>
          <Detail label="Status">
            <Status status={r.status} />
          </Detail>
          <Detail label="Frequency">{frequencyLabel(r.repeatEvery)}</Detail>
          <Detail label="Start On">{fmtDate(r.startOn)}</Detail>
          <Detail label="Ends On">{r.neverExpires ? 'Never Expires' : fmtDate(r.endsOn)}</Detail>
          <Detail label="Next Journal">{r.status === 'active' ? fmtDate(r.nextDate) : '-'}</Detail>
        </div>
        <div>
          <Detail label="Reference#">{r.reference}</Detail>
          <Detail label="Notes">{r.notes}</Detail>
          <Detail label="Reporting Method">{reportingMethodLabel(r.reportingMethod)}</Detail>
          <Detail label="Amount">{money(r.amount)}</Detail>
        </div>
      </div>
      <div className="max-w-5xl px-5">
        <table className="table rounded-md border border-slate-200">
          <thead>
            <tr>
              <th>Account</th>
              <th>Contact</th>
              <th className="text-right">Debit</th>
              <th className="text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {r.lines.map((l, i) => (
              <tr key={i}>
                <td>
                  {l.accountName}
                  {l.description && <div className="text-xs text-slate-500">{l.description}</div>}
                </td>
                <td>{l.contactName}</td>
                <td className="text-right tabular-nums">{l.debit ? money(l.debit, '') : ''}</td>
                <td className="text-right tabular-nums">{l.credit ? money(l.credit, '') : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mb-2 mt-6 font-semibold">Journals created ({r.children.length})</div>
        <table className="table rounded-md border border-slate-200">
          <thead>
            <tr>
              <th>Date</th>
              <th>Journal#</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {r.children.map((c) => (
              <tr key={c.id}>
                <td>{fmtDate(c.date)}</td>
                <td>
                  <Link className="link" to={`/accountant/manual-journals/${c.id}`}>
                    {c.number}
                  </Link>
                </td>
                <td className="text-right tabular-nums">{money(c.amount)}</td>
              </tr>
            ))}
            {!r.children.length && (
              <tr>
                <td colSpan={3} className="py-6 text-center text-slate-400">
                  The first journal is created on {fmtDate(r.nextDate)}.
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

export default function RecurringJournals() {
  return (
    <Routes>
      <Route index element={<List />} />
      <Route path="new" element={<Form />} />
      <Route path=":id/edit" element={<Form />} />
      <Route path=":id" element={<View />} />
    </Routes>
  );
}
