import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronDown, Plus, MoreHorizontal, Upload, Download, RefreshCw, Trash2, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import { DOC_META } from '@shared/docmeta';
import { fmtDate, frequencyLabel } from '@shared/format';
import { moneyIn } from '@shared/currency';
import type { DocKind, TxnDoc } from '@shared/types';
import { api, qs, useAction, useApi } from '../../api';
import { Dropdown, MenuItem, SearchBox, Spinner, Status, clsx, useConfirm } from '../../components/ui';
import { Lifecycle } from '../../components/shared';
import { DOC_UI, type Column } from './config';
import { ExportMenu } from '../../components/ExportMenu';
import { downloadRows, type ExportColumn } from '../../lib/export';

export type DocRow = TxnDoc & { contactName: string };

const DOC_EXPORT_COLUMNS: ExportColumn<DocRow>[] = [
  { header: 'Date', value: (d) => d.date },
  { header: 'Number', value: (d) => d.number },
  { header: 'Reference', value: (d) => d.referenceNumber },
  { header: 'Contact', value: (d) => d.contactName },
  { header: 'Status', value: (d) => d.status },
  { header: 'Sub Total', value: (d) => d.subTotal },
  { header: 'Tax', value: (d) => d.taxAmount ?? 0 },
  { header: 'Currency', value: (d) => d.currencyCode || 'INR' },
  { header: 'Exchange Rate', value: (d) => d.exchangeRate ?? 1 },
  { header: 'Total', value: (d) => d.total },
  { header: 'Balance', value: (d) => d.balance },
  { header: 'Total (INR)', value: (d) => d.baseTotal ?? d.total },
  { header: 'Balance (INR)', value: (d) => d.baseBalance ?? d.balance },
];

/** Amount in the document currency, with the INR equivalent underneath for foreign currencies. */
function Amount({ d, v, base }: { d: TxnDoc; v: number; base?: number }) {
  const foreign = (d.currencyCode || 'INR') !== 'INR';
  return (
    <span className="tabular-nums">
      {moneyIn(v, d.currencyCode)}
      {foreign && base != null && <span className="block text-xxs text-slate-400">{moneyIn(base, 'INR')}</span>}
    </span>
  );
}

const HEAD: Record<Column, string> = {
  date: 'Date',
  number: '#',
  reference: 'Reference Number',
  orderNumber: 'Order Number',
  contact: 'Client Name',
  status: 'Status',
  dueDate: 'Due Date',
  amount: 'Amount',
  balance: 'Balance Due',
  invoiced: 'Invoiced',
  payment: 'Payment',
  invoiceStatus: 'Invoice Status',
  profileName: 'Profile Name',
  frequency: 'Frequency',
  lastDate: 'Last Invoice Date',
  nextDate: 'Next Invoice Date',
  invoiceNumber: 'Invoice#',
  billed: 'Billed Status',
  received: 'Received',
  deliveryDate: 'Delivery Date',
  expiryDate: 'Expected Shipment',
};

function Dot({ on, half }: { on: boolean; half?: boolean }) {
  return <span className={clsx('inline-block h-2.5 w-2.5 rounded-full border', on ? 'border-emerald-500 bg-emerald-500' : half ? 'border-amber-500 bg-amber-300' : 'border-slate-300 bg-white')} />;
}

function cell(c: Column, d: DocRow, all: DocRow[]) {
  switch (c) {
    case 'date':
      return fmtDate(d.date);
    case 'number':
      return <span className="text-brand-600">{d.number}</span>;
    case 'reference':
      return d.referenceNumber;
    case 'orderNumber':
      return d.orderNumber;
    case 'contact':
      return d.contactName;
    case 'status':
      return <Status status={d.status} dueDate={d.dueDate} />;
    case 'dueDate':
      return fmtDate(d.dueDate);
    case 'amount':
      return <Amount d={d} v={d.total} base={d.baseTotal} />;
    case 'balance':
      return <Amount d={d} v={d.balance} base={d.baseBalance} />;
    case 'invoiced':
      return <Dot on={d.invoiceStatus === 'invoiced'} half={d.invoiceStatus === 'partially_invoiced'} />;
    case 'payment':
      return <Dot on={d.paymentStatus === 'paid'} half={d.paymentStatus === 'partially_paid'} />;
    case 'invoiceStatus':
      return <Status status={d.invoiceStatus || 'not_invoiced'} />;
    case 'profileName':
      return <span className="text-brand-600">{d.profileName}</span>;
    case 'frequency':
      return frequencyLabel(d.repeatEvery);
    case 'lastDate':
      return fmtDate(d.lastGeneratedDate) || '-';
    case 'nextDate':
      return d.status === 'active' ? fmtDate(d.nextDate) : '-';
    case 'invoiceNumber':
      return all.find((x) => x.id === d.invoiceId)?.number ?? '';
    case 'billed':
      return <Status status={d.billedStatus || 'not_billed'} />;
    case 'received':
      return <Dot on={!!d.received} />;
    case 'deliveryDate':
      return fmtDate(d.deliveryDate);
    case 'expiryDate':
      return fmtDate(d.expectedShipmentDate);
  }
}

export function useDocList(kind: DocKind, status: string, q: string) {
  return useApi<DocRow[]>(`/docs${qs({ kind, status: status === 'all' ? undefined : status, q })}`);
}

function headerFor(kind: DocKind, c: Column) {
  const meta = DOC_META[kind];
  if (c === 'number') return meta.numberLabel;
  if (c === 'contact') return meta.side === 'sales' ? 'Client Name' : 'Supplier Name';
  if (c === 'lastDate') return kind === 'recurring_bill' ? 'Last Bill Date' : 'Last Invoice Date';
  if (c === 'nextDate') return kind === 'recurring_bill' ? 'Next Bill Date' : 'Next Invoice Date';
  if (c === 'date' && kind === 'purchase_order') return 'Date';
  return HEAD[c];
}

function ListHeader({ kind, status, setStatus, compact, rows }: { kind: DocKind; status: string; setStatus: (s: string) => void; compact?: boolean; rows?: DocRow[] }) {
  const meta = DOC_META[kind];
  const ui = DOC_UI[kind];
  const navigate = useNavigate();
  const runRecurring = useAction(() => api<{ created: number }>('/recurring/run', { body: {} }), (r) => `${r.created} document(s) generated from recurring profiles`);
  const label = ui.filters.find((f) => f.value === status)?.label ?? 'All';
  return (
    <div className={clsx('flex items-center justify-between gap-2 border-b border-slate-200 bg-white', compact ? 'px-3 py-2.5' : 'px-5 py-3')}>
      <Dropdown
        button={() => (
          <button className="flex items-center gap-1 text-[15px] font-semibold text-slate-900 hover:text-brand-700">
            <span className="max-w-[160px] truncate">
              {label === 'All' ? 'All' : label} {meta.plural}
            </span>
            <ChevronDown size={15} className="text-brand-600" />
          </button>
        )}
      >
        {ui.filters.map((f) => (
          <MenuItem key={f.value} onClick={() => setStatus(f.value)}>
            {f.label}
          </MenuItem>
        ))}
      </Dropdown>
      <div className="flex items-center gap-1.5">
        <button className={compact ? 'btn-primary w-8 px-0' : 'btn-primary'} onClick={() => navigate(`${meta.path}/new`)} aria-label={`New ${meta.label}`}>
          <Plus size={15} />
          {!compact && 'New'}
        </button>
        <Dropdown align="right" button={() => <button className="btn-icon" aria-label="More options"><MoreHorizontal size={15} /></button>}>
          {meta.recurring && (
            <MenuItem icon={<RefreshCw size={13} />} onClick={() => runRecurring.mutate()}>
              Generate due {kind === 'recurring_bill' ? 'bills' : 'invoices'} now
            </MenuItem>
          )}
          <MenuItem icon={<Download size={13} />} onClick={() => { void exportDocs(kind, 'csv', rows); }}>Export {meta.plural} (CSV)</MenuItem>
          <MenuItem icon={<Download size={13} />} onClick={() => { void exportDocs(kind, 'xlsx', rows); }}>Export {meta.plural} (Excel)</MenuItem>
          <MenuItem icon={<Upload size={13} />} onClick={() => navigate(`/settings/import?kind=${kind}`)}>
            Import {meta.plural}
          </MenuItem>
        </Dropdown>
      </div>
    </div>
  );
}

async function exportDocs(kind: DocKind, format: 'csv' | 'xlsx', picked?: DocRow[]) {
  const rows = picked ?? (await api<DocRow[]>(`/docs${qs({ kind })}`));
  downloadRows(DOC_META[kind].plural.toLowerCase().replace(/ /g, '-'), rows, DOC_EXPORT_COLUMNS, format);
}

/** Full-width list (no record selected). */
export function DocListPage({ kind }: { kind: DocKind }) {
  const meta = DOC_META[kind];
  const ui = DOC_UI[kind];
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [status, setStatus] = useState(search.get('status') || 'all');
  const [q, setQ] = useState('');
  const { data, isLoading } = useDocList(kind, status, q);
  const [selected, setSelected] = useState<string[]>([]);
  const qc = useQueryClient();
  const confirm = useConfirm();
  const cols = ui.columns;
  if (isLoading) return <Spinner />;
  const rows = data || [];
  const allChecked = rows.length > 0 && rows.every((r) => selected.includes(r.id));
  const toggle = (rid: string) => setSelected((x) => (x.includes(rid) ? x.filter((y) => y !== rid) : [...x, rid]));
  const payable = rows.filter((r) => selected.includes(r.id) && r.kind === 'bill' && r.balance > 0 && ['open', 'overdue', 'partially_paid', 'due_today'].includes(r.status));
  async function bulkDelete() {
    let ok = 0;
    const errors: string[] = [];
    for (const rid of selected) {
      try {
        await api(`/docs/${rid}`, { method: 'DELETE' });
        ok++;
      } catch (e) {
        errors.push(`${rows.find((r) => r.id === rid)?.number}: ${(e as Error).message}`);
      }
    }
    qc.invalidateQueries();
    setSelected([]);
    if (ok) toast.success(`${ok} ${ok === 1 ? meta.label.toLowerCase() : meta.plural.toLowerCase()} deleted`);
    if (errors.length) toast.error(errors.join(' · '));
  }
  const empty = !data?.length && status === 'all' && !q;
  return (
    <div className="flex h-full flex-col">
      {selected.length ? (
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3">
          <div className="flex items-center gap-2">
            {kind === 'bill' && (
              <button className="btn-primary btn-sm" disabled={!payable.length} title={payable.length ? undefined : 'Select open bills with a balance due'} onClick={() => navigate(`/purchases/payments-made/bulk?bills=${payable.map((b) => b.id).join(',')}`)}>
                Record Payment{payable.length ? ` (${payable.length})` : ''}
              </button>
            )}
            <ExportMenu rows={rows.filter((r) => selected.includes(r.id))} filename={meta.plural.toLowerCase().replace(/ /g, '-')} columns={DOC_EXPORT_COLUMNS} label="Export Selected" />
            <button className="btn-secondary btn-sm text-red-600" onClick={() => confirm.ask(`Delete ${meta.plural}`, `Delete ${selected.length} ${selected.length === 1 ? meta.label.toLowerCase() : meta.plural.toLowerCase()}? This cannot be undone.`, bulkDelete, { danger: true, label: 'Delete' })}>
              <Trash2 size={13} /> Delete
            </button>
            <span className="ml-2 text-[13px] text-slate-600">{selected.length} selected</span>
          </div>
          <button className="btn-ghost w-8 px-0" aria-label="Clear selection" onClick={() => setSelected([])}>
            <X size={16} />
          </button>
        </div>
      ) : (
        <ListHeader kind={kind} status={status} setStatus={(v) => { setStatus(v); setSelected([]); }} rows={rows} />
      )}
      {empty ? (
        ui.lifecycle ? (
          <Lifecycle title={ui.lifecycle.title} subtitle={ui.lifecycle.subtitle} steps={ui.lifecycle.steps} actions={<><button className="btn-primary" onClick={() => navigate(`${meta.path}/new`)}>{ui.lifecycle.cta}</button><button className="btn-secondary" onClick={() => navigate(`/settings/import?kind=${kind}`)}>Import {meta.plural}</button></>} />
        ) : (
          <div className="flex flex-col items-center gap-3 py-20 text-center">
            <div className="text-lg font-semibold text-slate-800">No {meta.plural.toLowerCase()} yet</div>
            <div className="text-slate-500">Create your first {meta.label.toLowerCase()} to get started.</div>
            <button className="btn-primary" onClick={() => navigate(`${meta.path}/new`)}>
              <Plus size={14} /> New {meta.label}
            </button>
          </div>
        )
      ) : (
        <div className="flex-1 overflow-auto">
          <div className="px-5 py-3">
            <div className="w-72">
              <SearchBox value={q} onChange={setQ} placeholder={`Search ${meta.plural.toLowerCase()}`} />
            </div>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th className="w-8">
                  <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" aria-label="Select all" checked={allChecked} onChange={() => setSelected(allChecked ? [] : rows.map((r) => r.id))} />
                </th>
                {cols.map((c) => (
                  <th key={c} className={clsx(['amount', 'balance'].includes(c) && 'text-right')}>
                    {headerFor(kind, c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data!.map((d) => (
                <tr key={d.id} className={clsx('row-link', selected.includes(d.id) && 'bg-brand-50/50')} onClick={() => navigate(`${meta.path}/${d.id}`)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" aria-label={`Select ${d.number}`} checked={selected.includes(d.id)} onChange={() => toggle(d.id)} />
                  </td>
                  {cols.map((c) => (
                    <td key={c} className={clsx(['amount', 'balance'].includes(c) && 'text-right')}>
                      {cell(c, d, data!)}
                    </td>
                  ))}
                </tr>
              ))}
              {!data!.length && (
                <tr>
                  <td colSpan={cols.length + 1} className="py-10 text-center text-slate-400">
                    No {meta.plural.toLowerCase()} match this view.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {confirm.node}
    </div>
  );
}

/** Compact list shown at the left of a record (split view). */
export function DocListPane({ kind }: { kind: DocKind }) {
  const meta = DOC_META[kind];
  const { id } = useParams();
  const [status, setStatus] = useState('all');
  const { data = [] } = useDocList(kind, status, '');
  return (
    <div className="no-print flex w-[300px] shrink-0 flex-col border-r border-slate-200">
      <ListHeader kind={kind} status={status} setStatus={setStatus} compact />
      <div className="flex-1 overflow-y-auto">
        {data.map((d) => (
          <Link key={d.id} to={`${meta.path}/${d.id}`} className={clsx('block border-b border-slate-100 px-3 py-2.5 hover:bg-slate-50', d.id === id && 'bg-brand-50/70')}>
            <div className="flex justify-between gap-2">
              <span className="truncate font-medium text-slate-800">{d.contactName}</span>
              <span className="tabular-nums text-slate-800">{moneyIn(d.total, d.currencyCode)}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
              <span>{meta.recurring ? d.profileName : d.number}</span>
              <span>•</span>
              <span>{meta.recurring ? frequencyLabel(d.repeatEvery) : fmtDate(d.date)}</span>
            </div>
            <div className="mt-0.5">
              <Status status={d.status} dueDate={d.dueDate} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
