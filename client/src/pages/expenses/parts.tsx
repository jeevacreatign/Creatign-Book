// Building blocks shared by Expenses and Recurring Expenses: the Zoho-style repeat picker,
// the reporting-tag editor, the receipt drop zone and the "Make Recurring" side drawer.
import { useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, FileImage, FileText, ImagePlus, Paperclip, Plus, Tag, Trash2, Upload } from 'lucide-react';
import { fmtDate, nextRecurrence, today } from '@shared/format';
import type { Attachment, Expense, ExpenseGst, ExpenseLine, RecurringExpense, RepeatEvery } from '@shared/types';
import { api, useAction, useApi } from '../../api';
import { computeTax, isIntraState } from '@shared/gst';
import { toast } from '../../lib/toast';
import { Checkbox, DateInput, Drawer, Dropdown, Field, MenuItem, Select, clsx } from '../../components/ui';

// ------------------------------------------------------------ GST preview (mirrors server/engine expenseGst)

export function expenseTaxPreview(f: ExpenseGst & { amount?: number; itemized?: boolean; lines?: ExpenseLine[] }, mileage = false) {
  const intra = isIntraState(f.sourceOfSupply, f.destinationOfSupply, f.gstTreatment);
  const inclusive = f.taxInclusive !== false && !f.reverseCharge;
  const itemized = !!f.itemized && !mileage;
  const lines = itemized ? (f.lines || []).map((l) => ({ amount: Number(l.amount) || 0, taxId: l.taxId })) : [{ amount: Number(f.amount) || 0, taxId: mileage ? undefined : f.taxId }];
  const t = computeTax(lines, { intra, inclusive });
  const gross = lines.reduce((s, l) => s + l.amount, 0);
  return { intra, breakdown: t.breakdown, taxTotal: t.taxTotal, subTotal: inclusive ? gross - t.taxTotal : gross, total: inclusive || f.reverseCharge ? gross : gross + t.taxTotal };
}

// ------------------------------------------------------------ projects

export function ProjectPicker({ customerId, value, onChange }: { customerId?: string; value?: string; onChange: (v: string | undefined) => void }) {
  const { data = [] } = useApi<{ id: string; name: string; customerId?: string; status: string }[]>('/projects');
  const list = data.filter((p) => p.status !== 'inactive' && (!p.customerId || p.customerId === customerId));
  return (
    <Field label="Project">
      <Select className="max-w-sm" value={value || ''} onChange={(e) => onChange(e.target.value || undefined)} placeholder={list.length ? 'Select a project' : 'No projects for this customer'} options={list.map((p) => ({ value: p.id, label: p.name }))} />
    </Field>
  );
}

// ------------------------------------------------------------ repeat every

export const REPEAT_PRESETS: { label: string; value: RepeatEvery }[] = [
  { label: 'Week', value: { n: 1, unit: 'week' } },
  { label: '2 Weeks', value: { n: 2, unit: 'week' } },
  { label: 'Month', value: { n: 1, unit: 'month' } },
  { label: '2 Months', value: { n: 2, unit: 'month' } },
  { label: '3 Months', value: { n: 3, unit: 'month' } },
  { label: '6 Months', value: { n: 6, unit: 'month' } },
  { label: 'Year', value: { n: 1, unit: 'year' } },
  { label: '2 Years', value: { n: 2, unit: 'year' } },
  { label: '3 Years', value: { n: 3, unit: 'year' } },
];

const presetIndex = (r?: RepeatEvery) => REPEAT_PRESETS.findIndex((p) => r && p.value.n === r.n && p.value.unit === r.unit);

/** Zoho's "Repeat Every" select: common periods plus a Custom option (every N days/weeks/months/years). */
export function RepeatSelect({ value, onChange }: { value?: RepeatEvery; onChange: (r: RepeatEvery) => void }) {
  const idx = presetIndex(value);
  const [custom, setCustom] = useState(idx < 0 && !!value);
  return (
    <div className="space-y-2">
      <select
        className="input"
        value={custom ? 'custom' : String(idx < 0 ? 0 : idx)}
        onChange={(e) => {
          if (e.target.value === 'custom') {
            setCustom(true);
            onChange({ n: value?.n || 1, unit: value?.unit === 'week' ? 'day' : value?.unit || 'day' });
          } else {
            setCustom(false);
            onChange(REPEAT_PRESETS[Number(e.target.value)].value);
          }
        }}
      >
        {REPEAT_PRESETS.map((p, i) => (
          <option key={p.label} value={i}>
            {p.label}
          </option>
        ))}
        <option value="custom">Custom</option>
      </select>
      {custom && (
        <div className="flex items-center gap-2 text-[13px] text-slate-600">
          Every
          <input type="number" min={1} className="input w-20" value={value?.n ?? 1} onChange={(e) => onChange({ n: Math.max(1, Number(e.target.value) || 1), unit: value?.unit || 'day' })} />
          <select className="input w-32" value={value?.unit || 'day'} onChange={(e) => onChange({ n: value?.n || 1, unit: e.target.value as RepeatEvery['unit'] })}>
            <option value="day">Day(s)</option>
            <option value="week">Week(s)</option>
            <option value="month">Month(s)</option>
            <option value="year">Year(s)</option>
          </select>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ reporting tags

/** "Associate Tags": a small key/value editor (Zoho reporting tags such as Region or Department). */
export function ReportingTags({ value, onChange }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  const entries = Object.entries(value || {});
  const [open, setOpen] = useState(entries.length > 0);
  const rows = entries.length ? entries : [['', '']];
  const update = (list: [string, string][]) => onChange(Object.fromEntries(list.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v])));
  if (!open)
    return (
      <button type="button" className="link inline-flex items-center gap-1 text-[13px]" onClick={() => setOpen(true)}>
        <Tag size={13} className="fill-brand-600" /> Associate Tags
      </button>
    );
  return (
    <div className="space-y-2">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            className="input w-36"
            placeholder="Tag (e.g. Region)"
            value={k}
            onChange={(e) => update(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)) as [string, string][])}
          />
          <input className="input flex-1" placeholder="Option (e.g. South)" value={v} onChange={(e) => update(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)) as [string, string][])} />
          <button type="button" className="text-slate-400 hover:text-red-500" aria-label="Remove tag" onClick={() => update(rows.filter((_, j) => j !== i) as [string, string][])}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button type="button" className="link inline-flex items-center gap-1 text-xs" onClick={() => onChange({ ...value, [`Tag ${rows.length + 1}`]: '' })}>
        <Plus size={12} /> Add another tag
      </button>
    </div>
  );
}

export function TagChips({ tags }: { tags?: Record<string, string> }) {
  const list = Object.entries(tags || {}).filter(([k]) => k);
  if (!list.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map(([k, v]) => (
        <span key={k} className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
          <Tag size={11} /> {k}
          {v ? `: ${v}` : ''}
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------ receipts

const isImage = (a: Attachment) => a.mimeType?.startsWith('image/');

async function uploadFiles(files: File[], current: number, max: number, maxMB: number) {
  if (current + files.length > max) throw new Error(`You can upload a maximum of ${max} receipts`);
  const big = files.find((f) => f.size > maxMB * 1024 * 1024);
  if (big) throw new Error(`${big.name} is larger than ${maxMB}MB`);
  const fd = new FormData();
  files.forEach((f) => fd.append('files', f));
  return api<Attachment[]>('/uploads', { body: fd });
}

/**
 * The dashed "Drag or Drop your Receipts" card from Zoho's expense screens.
 * Uploads straight away and hands the new list to onChange (the detail page saves it immediately).
 */
export function ReceiptDrop({ value, onChange, max = 10, maxMB = 10, className }: { value: Attachment[]; onChange: (v: Attachment[]) => void | Promise<unknown>; max?: number; maxMB?: number; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  async function add(list: FileList | File[] | null) {
    if (!list || !list.length) return;
    setBusy(true);
    try {
      const up = await uploadFiles(Array.from(list), value.length, max, maxMB);
      await onChange([...value, ...up]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        add(e.dataTransfer.files);
      }}
      className={clsx('rounded-lg border border-dashed p-5 transition-colors', drag ? 'border-brand-500 bg-brand-50/60' : 'border-slate-300 bg-white', className)}
    >
      {value.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-2">
          {value.map((a) => (
            <div key={a.id} className="group relative overflow-hidden rounded-md border border-slate-200 bg-slate-50">
              <a href={a.url} target="_blank" rel="noreferrer" className="block">
                {isImage(a) ? (
                  <img src={a.url} alt={a.name} className="h-24 w-full object-cover" />
                ) : (
                  <div className="flex h-24 items-center justify-center text-slate-400">
                    <FileText size={30} />
                  </div>
                )}
                <div className="truncate border-t border-slate-200 bg-white px-2 py-1 text-xxs text-slate-600" title={a.name}>
                  {a.name}
                </div>
              </a>
              <button
                type="button"
                aria-label={`Remove ${a.name}`}
                className="absolute right-1 top-1 hidden rounded bg-white/90 p-1 text-slate-500 shadow hover:text-red-600 group-hover:block"
                onClick={() => onChange(value.filter((x) => x.id !== a.id))}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-col items-center text-center">
        {value.length === 0 && (
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-brand-700 to-brand-500 text-white shadow">
            <ImagePlus size={24} />
          </div>
        )}
        <div className="text-[13px] font-semibold text-slate-800">{value.length ? 'Add more receipts' : 'Drag or Drop your Receipts'}</div>
        <div className="mb-3 text-xxs text-slate-500">Maximum file size allowed is {maxMB}MB</div>
        <div className="inline-flex overflow-hidden rounded-md border border-slate-200 bg-slate-50">
          <button type="button" className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-slate-700 hover:bg-white" disabled={busy} onClick={() => input.current?.click()}>
            <Upload size={14} /> {busy ? 'Uploading…' : 'Upload your Files'}
          </button>
          <Dropdown
            align="right"
            button={() => (
              <button type="button" className="h-full border-l border-slate-200 px-2 text-slate-500 hover:bg-white" aria-label="More upload options">
                <ChevronDown size={14} />
              </button>
            )}
          >
            <MenuItem icon={<FileImage size={13} />} onClick={() => input.current?.click()}>
              From this computer
            </MenuItem>
            <MenuItem icon={<Paperclip size={13} />} onClick={() => toast.success('Pick a file from Documents and attach it with Upload your Files')}>
              From Documents
            </MenuItem>
          </Dropdown>
        </div>
        <div className="mt-2 text-xxs text-slate-400">
          {value.length}/{max} receipts
        </div>
      </div>
      <input ref={input} type="file" multiple hidden accept="image/*,application/pdf" onChange={(e) => add(e.target.files)} />
    </div>
  );
}

// ------------------------------------------------------------ make recurring drawer

function FieldRow({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] items-start gap-3">
      <label className={clsx('pt-2 text-[13px]', required ? 'text-red-600' : 'text-slate-700')}>
        {label}
        {required && '*'}
      </label>
      <div>{children}</div>
    </div>
  );
}

/** Side drawer opened from an expense's "Make Recurring" button. Creates a profile from the expense. */
export function MakeRecurringDrawer({ expense, onClose }: { expense: Expense & { accountName?: string; vendorName?: string }; onClose: () => void }) {
  const navigate = useNavigate();
  const initial: RepeatEvery = { n: 1, unit: 'week' };
  // the expense itself covers its own date, so the first generated expense falls one period later
  const firstRun = (r: RepeatEvery) => {
    const t = today();
    let d = nextRecurrence(expense.date, r);
    let guard = 0;
    while (d < t && guard++ < 500) d = nextRecurrence(d, r);
    return d;
  };
  const [f, setF] = useState<Partial<RecurringExpense>>({
    profileName: '',
    repeatEvery: initial,
    startOn: firstRun(initial),
    neverExpires: true,
    reportingTags: { ...(expense.reportingTags || {}) },
  });
  const [startTouched, setStartTouched] = useState(false);
  const save = useAction(
    () =>
      api<RecurringExpense>('/recurring-expenses', {
        body: {
          ...f,
          accountId: expense.accountId,
          amount: expense.taxInclusive === false ? expense.subTotal ?? expense.amount : expense.amount,
          taxId: expense.taxId,
          taxInclusive: expense.taxInclusive,
          gstTreatment: expense.gstTreatment,
          vendorGstin: expense.vendorGstin,
          sourceOfSupply: expense.sourceOfSupply,
          destinationOfSupply: expense.destinationOfSupply,
          reverseCharge: expense.reverseCharge,
          expenseType: expense.expenseType,
          hsnSac: expense.hsnSac,
          projectId: expense.projectId,
          paidThroughAccountId: expense.paidThroughAccountId,
          vendorId: expense.vendorId,
          customerId: expense.customerId,
          billable: expense.billable,
          notes: expense.notes,
        },
      }),
    'Recurring expense profile created',
  );
  return (
    <Drawer
      open
      onClose={onClose}
      width="max-w-[460px]"
      title="Make Recurring"
      footer={
        <>
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: (r) => { onClose(); navigate(`/purchases/recurring-expenses/${r.id}`); } })}>
            Save
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <FieldRow label="Profile Name" required>
          <input className="input" autoFocus value={f.profileName || ''} placeholder={expense.accountName ? `${expense.accountName} - recurring` : ''} onChange={(e) => setF({ ...f, profileName: e.target.value })} />
        </FieldRow>
        <FieldRow label="Repeat Every" required>
          <RepeatSelect value={f.repeatEvery} onChange={(r) => setF({ ...f, repeatEvery: r, startOn: startTouched ? f.startOn : firstRun(r) })} />
        </FieldRow>
        <FieldRow label="Start On">
          <DateInput
            value={f.startOn}
            onChange={(v) => {
              setStartTouched(true);
              setF({ ...f, startOn: v });
            }}
          />
          <div className="mt-1 text-xxs text-slate-500">This expense ({fmtDate(expense.date)}) is not repeated. The first new expense is created on the start date.</div>
        </FieldRow>
        <FieldRow label="Ends On">
          <DateInput value={f.endsOn} disabled={f.neverExpires} onChange={(v) => setF({ ...f, endsOn: v })} />
          <div className="mt-2">
            <Checkbox checked={!!f.neverExpires} onChange={(v) => setF({ ...f, neverExpires: v, endsOn: v ? undefined : f.endsOn })} label="Never Expires" />
          </div>
        </FieldRow>
        <FieldRow label="Reporting Tags">
          <div className="pt-1.5">
            <ReportingTags value={f.reportingTags || {}} onChange={(v) => setF({ ...f, reportingTags: v })} />
          </div>
        </FieldRow>
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Each new expense copies this expense's account, amount, Paid Through account, vendor, customer and billable setting. Receipts are not copied.
        </div>
      </div>
    </Drawer>
  );
}
