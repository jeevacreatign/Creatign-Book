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
import { Checkbox, DateInput, Field, FormFooter, Radio, Spinner, Status, clsx, useConfirm } from '../../components/ui';
import { DetailHeader, Detail, ListHeader, Toolbar, ToolbarBtn } from '../../components/split';
import { ExportMenu } from '../../components/ExportMenu';
import { CsvImportButton, type CsvImportRecord, type CsvImportResult } from '../../components/CsvImportButton';
import { RepeatSelect } from '../expenses/parts';
import { JournalLinesEditor, lineTotals, type DraftLine } from './common';

const BASE = '/accountant/recurring-journals';
type RRow = RecurringJournal & { amount: number; children: number };
type RDetail = Omit<RecurringJournal, 'lines'> & { amount: number; lines: (RecurringJournal['lines'][number] & { accountName?: string; contactName?: string })[]; children: { id: string; number: string; date: string; amount: number; status?: string }[] };

function List() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string[]>([]);
  const { data = [], isLoading } = useApi<RRow[]>('/recurring-journals');
  const { accounts } = useBoot();
  const allSelected = data.length > 0 && data.every((r) => selected.includes(r.id));
  const exportRows = selected.length ? data.filter((r) => selected.includes(r.id)) : data;
  const importSchedules = async (records: CsvImportRecord[]): Promise<CsvImportResult[]> => {
    type ImportedSchedule = { key: string; rowNumber: number; repeatEvery: RepeatEvery; startOn: string; endsOn?: string; neverExpires: boolean; reference?: string; notes?: string; reportingMethod: ReportingMethod; lines: { accountId: string; description?: string; debit: number; credit: number }[]; status: string; invalid?: string };
    const groups = new Map<string, ImportedSchedule>();
    const results: CsvImportResult[] = [];
    for (const record of records) {
      const key = record.get('Profile Name', 'Name');
      if (!key) {
        results.push({ rowNumber: record.rowNumber, label: 'Voucher Schedule', success: false, message: 'Profile Name is required' });
        continue;
      }
      const existing = groups.get(key);
      const row = existing ?? {
        key,
        rowNumber: record.rowNumber,
        repeatEvery: { n: 1, unit: 'month' as const },
        startOn: '',
        neverExpires: true,
        reportingMethod: 'accrual_and_cash' as ReportingMethod,
        lines: [],
        status: 'active',
      };
      try {
        const frequency = (record.get('Repeat Every', 'Frequency') || 'Monthly').trim().toLowerCase();
        const frequencyMatch = /^(?:every\s+)?(\d+)?\s*(daily|day|days|weekly|week|weeks|monthly|month|months|yearly|year|years)$/.exec(frequency);
        if (!frequencyMatch) throw new Error('Frequency must be Daily, Weekly, Monthly, Yearly, or Every N units');
        const unit = /^(daily|day|days)$/.test(frequencyMatch[2]) ? 'day' : /^(weekly|week|weeks)$/.test(frequencyMatch[2]) ? 'week' : /^(yearly|year|years)$/.test(frequencyMatch[2]) ? 'year' : 'month';
        const repeatEvery: RepeatEvery = { n: Number(frequencyMatch[1] || 1), unit };
        if (repeatEvery.n < 1) throw new Error('Repeat interval must be at least 1');
        const dateValue = (value: string | undefined) => {
          if (!value) return '';
          const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value);
          return match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : value;
        };
        const startOn = dateValue(record.get('Start On', 'Start Date'));
        if (!/^\d{4}-\d{2}-\d{2}$/.test(startOn) || Number.isNaN(Date.parse(`${startOn}T00:00:00`))) throw new Error('Start On must be YYYY-MM-DD or DD/MM/YYYY');
        const endsOn = dateValue(record.get('Ends On', 'End Date')) || undefined;
        const neverValue = (record.get('Never Expires') || '').toLowerCase();
        const neverExpires = neverValue ? !/^(false|no|0|n)$/i.test(neverValue) : !endsOn;
        const notes = record.get('Notes');
        if (!notes) throw new Error('Notes are required');
        const status = (record.get('Status') || 'active').toLowerCase();
        if (!['active', 'stopped'].includes(status)) throw new Error('Status must be Active or Stopped');
        const methodText = (record.get('Reporting Method') || '').toLowerCase();
        const reportingMethod: ReportingMethod = methodText === 'accrual_only' || methodText === 'accrual only' ? 'accrual_only'
          : methodText === 'cash_only' || methodText === 'cash only' ? 'cash_only'
            : methodText === 'accrual_and_cash' || methodText === 'accrual and cash' || !methodText ? 'accrual_and_cash'
              : (() => { throw new Error(`Unknown Reporting Method "${methodText}"`); })();
        if (existing && (existing.repeatEvery.n !== repeatEvery.n || existing.repeatEvery.unit !== repeatEvery.unit || existing.startOn !== startOn || existing.endsOn !== endsOn || existing.notes !== notes || existing.neverExpires !== neverExpires || existing.reportingMethod !== reportingMethod)) {
          throw new Error('Rows in the same profile must use matching schedule details');
        }
        const accountText = record.get('Account', 'Account Name', 'Account ID');
        const account = accounts.find((item) => item.id === accountText || item.name.toLowerCase() === accountText?.toLowerCase());
        if (!account) throw new Error(`Account "${accountText || ''}" was not found`);
        const amount = (value: string | undefined) => value ? Number(value.replace(/[^\d.-]/g, '')) : 0;
        const debit = amount(record.get('Debit'));
        const credit = amount(record.get('Credit'));
        if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0 || (debit > 0 && credit > 0) || !(debit || credit)) {
          throw new Error('Each line needs a non-negative Debit or Credit amount (not both)');
        }
        if (!existing) Object.assign(row, { repeatEvery, startOn, endsOn, neverExpires, reference: record.get('Reference Number', 'Reference'), notes, reportingMethod, status });
        row.lines.push({ accountId: account.id, description: record.get('Description'), debit, credit });
        groups.set(key, row);
      } catch (error) {
        row.invalid = error instanceof Error ? error.message : 'Import failed';
        groups.set(key, row);
      }
    }
    for (const group of groups.values()) {
      if (group.invalid) {
        results.push({ rowNumber: group.rowNumber, label: group.key, success: false, message: group.invalid });
        continue;
      }
      try {
        const created = await api<RecurringJournal>('/recurring-journals', { body: {
          profileName: group.key,
          repeatEvery: group.repeatEvery,
          startOn: group.startOn,
          endsOn: group.endsOn,
          neverExpires: group.neverExpires,
          reference: group.reference,
          notes: group.notes,
          reportingMethod: group.reportingMethod,
          lines: group.lines,
        } });
        if (group.status === 'stopped') await api(`/recurring-journals/${created.id}/actions/stop`, { body: {} });
        results.push({ rowNumber: group.rowNumber, label: group.key, success: true });
      } catch (error) {
        results.push({ rowNumber: group.rowNumber, label: group.key, success: false, message: error instanceof Error ? error.message : 'Import failed' });
      }
    }
    return results;
  };
  return (
    <div>
      <ListHeader title={<h1 className="text-[19px]">Voucher Schedules</h1>}>
        <CsvImportButton
          title="Voucher Schedules"
          filename="voucher-schedules"
          headers={['Profile Name', 'Repeat Every', 'Start On', 'Ends On', 'Never Expires', 'Reference Number', 'Notes', 'Reporting Method', 'Status', 'Account', 'Description', 'Debit', 'Credit']}
          instructions="Import one journal line per row. Repeat Profile Name for each line in a schedule. Account must match an existing account name or ID; every profile must balance. Frequency accepts Daily, Weekly, Monthly, Yearly, or Every N units."
          onImport={importSchedules}
        />
        <ExportMenu rows={exportRows} filename="voucher-schedules" label={selected.length ? 'Export Selected' : 'Export'} columns={[
          { header: 'Profile Name', value: (r) => r.profileName },
          { header: 'Frequency', value: (r) => frequencyLabel(r.repeatEvery) },
          { header: 'Last Journal Date', value: (r) => r.lastGeneratedDate },
          { header: 'Next Journal Date', value: (r) => r.status === 'active' ? r.nextDate : '' },
          { header: 'Status', value: (r) => r.status },
          { header: 'Amount', value: (r) => r.amount },
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
                <input type="checkbox" className="accent-brand-600" checked={allSelected} onChange={() => setSelected(allSelected ? [] : data.map((r) => r.id))} aria-label="Select all" />
              </th>
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
            <tr key={r.id} className={clsx('row-link', selected.includes(r.id) && 'bg-brand-50/50')} onClick={() => navigate(`${BASE}/${r.id}`)}>
              <td className="pl-4" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" className="accent-brand-600" checked={selected.includes(r.id)} onChange={() => setSelected((s) => s.includes(r.id) ? s.filter((x) => x !== r.id) : [...s, r.id])} aria-label={`Select ${r.profileName}`} />
              </td>
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
                <td colSpan={7} className="py-16 text-center text-slate-500">
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
