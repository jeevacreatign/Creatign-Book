// One report: filters kept in the URL, Zoho-style statement layout, customize columns, save as a
// custom report and export to PDF (print), CSV and XLS.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Columns3, Download, FileSpreadsheet, FileText, Printer, Save, Star } from 'lucide-react';
import { PERIODS, today } from '@shared/format';
import { api, qs, useAction, useApi } from '../../api';
import { useBoot, useOrg } from '../../lib/app';
import { AccountSelect, ContactPicker, DateInput, Dropdown, Field, MenuItem, Modal, Spinner, clsx } from '../../components/ui';
import { downloadText } from '../../components/split';
import { favourites, formatCell, markVisited, toCsv, toggleFavourite, toXls, useStored, type Catalog, type Col, type ReportResult } from './common';

const STATUS_OPTIONS: Record<string, { value: string; label: string }[]> = {
  'hsn-summary': [
    { value: '', label: 'Outward supplies (sales)' },
    { value: 'inward', label: 'Inward supplies (purchases)' },
  ],
  'bank-statement-lines': ['uncategorized', 'categorized', 'matched', 'excluded'].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })),
  'recurring-invoice-details': ['active', 'stopped', 'expired'].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })),
};
const DOC_STATUSES = ['draft', 'open', 'sent', 'overdue', 'partially_paid', 'paid', 'void', 'accepted', 'declined', 'invoiced', 'closed', 'billed'];

const hiddenKey = (key: string) => `cb.reports.columns.${key}`;
function storedHidden(key: string): string[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(hiddenKey(key)) || 'null');
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export default function ReportView() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const org = useOrg();
  const { accounts } = useBoot();
  const [sp, setSp] = useSearchParams();
  const { data: catalog } = useApi<Catalog>('/report-catalog');
  const meta = catalog?.reports.find((r) => r.key === key);
  const saved = catalog?.saved.find((s) => s.id === sp.get('saved'));
  const params = Object.fromEntries([...sp.entries()].filter(([k]) => k !== 'saved'));
  // links from other screens pass accountId / customerId / budgetId
  if (params.accountId && !params.account) params.account = params.accountId;
  const query = qs(params);
  const { data: rep, isLoading, error } = useApi<ReportResult>(meta ? `/report-data/${key}${query}` : null);
  const favs = useStored(favourites);
  const [hidden, setHidden] = useState<string[] | null>(null);
  const [customizing, setCustomizing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (meta) markVisited(meta.key);
  }, [meta]);
  useEffect(() => {
    setHidden(null);
  }, [key, saved?.id]);

  const cols: Col[] = useMemo(() => {
    if (!rep) return [];
    const h = hidden ?? saved?.hiddenColumns ?? storedHidden(key) ?? rep.columns.filter((c) => c.hidden).map((c) => c.key);
    return rep.columns.filter((c, i) => i === 0 || !h.includes(c.key));
  }, [rep, hidden, saved, key]);

  const set = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if ('account' in patch) next.delete('accountId');
    setSp(next, { replace: true });
  };

  if (!catalog) return <Spinner />;
  if (!meta)
    return (
      <div className="p-10 text-slate-500">
        This report does not exist. <Link className="link" to="/reports">Back to Reports Center</Link>
      </div>
    );

  const f = new Set(meta.filters);
  const period = params.period || (params.from || params.to ? 'custom' : meta.period || 'this_fiscal_year');
  const fileBase = `${meta.name}${saved ? ` - ${saved.name}` : ''}`.replace(/[^\w\- ()]+/g, '');

  return (
    <div className="flex min-h-full flex-col">
      <div className="no-print flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <button className="btn-ghost w-8 px-0" onClick={() => navigate('/reports')} aria-label="Back to Reports Center">
            <ArrowLeft size={17} />
          </button>
          <div className="min-w-0">
            <div className="text-xs text-slate-500">{meta.category}</div>
            <h1 className="flex items-center gap-2 truncate text-[17px] font-semibold">
              {saved ? saved.name : meta.name}
              <button onClick={() => toggleFavourite(meta.key)} aria-label="Favourite" className={favs.includes(meta.key) ? 'text-amber-400' : 'text-slate-300 hover:text-amber-400'}>
                <Star size={15} fill={favs.includes(meta.key) ? 'currentColor' : 'none'} />
              </button>
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary" onClick={() => setCustomizing(true)} disabled={!rep}>
            <Columns3 size={14} /> Customize Columns
          </button>
          <button className="btn-secondary" onClick={() => setSaving(true)} disabled={!rep}>
            <Save size={14} /> Save as Custom Report
          </button>
          <Dropdown
            align="right"
            button={() => (
              <button className="btn-primary" disabled={!rep}>
                <Download size={14} /> Export
              </button>
            )}
          >
            <MenuItem icon={<Printer size={13} />} onClick={() => window.print()}>
              PDF / Print
            </MenuItem>
            <MenuItem icon={<FileText size={13} />} onClick={() => rep && downloadText(`${fileBase}.csv`, toCsv(rep, cols))}>
              CSV (Comma Separated)
            </MenuItem>
            <MenuItem icon={<FileSpreadsheet size={13} />} onClick={() => rep && downloadText(`${fileBase}.xls`, toXls(rep, cols, org.name), 'application/vnd.ms-excel')}>
              XLS (Microsoft Excel)
            </MenuItem>
          </Dropdown>
        </div>
      </div>

      <div className="no-print flex flex-wrap items-end gap-3 border-b border-slate-200 bg-slate-50/70 px-5 py-3">
        {f.has('period') && (
          <label className="text-xs text-slate-500">
            Date Range
            <select className="input mt-1 w-44" value={period} onChange={(e) => set(e.target.value === 'custom' ? { period: undefined, from: params.from || today().slice(0, 8) + '01', to: params.to || today() } : { period: e.target.value, from: undefined, to: undefined })}>
              {PERIODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </label>
        )}
        {f.has('period') && period === 'custom' && (
          <>
            <label className="text-xs text-slate-500">
              From
              <DateInput className="mt-1 w-36" value={params.from} onChange={(v) => set({ from: v })} />
            </label>
            <label className="text-xs text-slate-500">
              To
              <DateInput className="mt-1 w-36" value={params.to} onChange={(v) => set({ to: v })} />
            </label>
          </>
        )}
        {f.has('asOf') && !f.has('period') && (
          <label className="text-xs text-slate-500">
            As of
            <DateInput className="mt-1 w-36" value={params.to || today()} onChange={(v) => set({ to: v })} />
          </label>
        )}
        {f.has('basis') && (
          <div className="text-xs text-slate-500">
            Report Basis
            <div className="mt-1 flex overflow-hidden rounded-md border border-slate-300 bg-white">
              {(['accrual', 'cash'] as const).map((b) => (
                <button key={b} className={clsx('h-8 px-3 text-[13px] capitalize', (params.basis || 'accrual') === b ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50')} onClick={() => set({ basis: b === 'accrual' ? undefined : b })}>
                  {b}
                </button>
              ))}
            </div>
          </div>
        )}
        {f.has('customer') && (
          <label className="w-56 text-xs text-slate-500">
            Customer
            <div className="mt-1">
              <ContactPicker kind="customer" value={params.customer || params.customerId} onChange={(v) => set({ customer: v, customerId: undefined })} placeholder="All customers" />
            </div>
          </label>
        )}
        {f.has('vendor') && (
          <label className="w-56 text-xs text-slate-500">
            Vendor
            <div className="mt-1">
              <ContactPicker kind="vendor" value={params.vendor || params.vendorId} onChange={(v) => set({ vendor: v, vendorId: undefined })} placeholder="All vendors" />
            </div>
          </label>
        )}
        {f.has('account') && (
          <label className="text-xs text-slate-500">
            Account
            <AccountSelect className="mt-1 w-56" accounts={accounts} value={params.account} onChange={(v) => set({ account: v })} placeholder="All accounts" />
          </label>
        )}
        {f.has('item') && <ItemFilter value={params.item} onChange={(v) => set({ item: v })} />}
        {f.has('project') && <ProjectFilter value={params.project || params.projectId} onChange={(v) => set({ project: v, projectId: undefined })} />}
        {f.has('budget') && <BudgetFilter value={params.budget || params.budgetId} onChange={(v) => set({ budget: v, budgetId: undefined })} />}
        {f.has('status') && (
          <label className="text-xs text-slate-500">
            {key === 'hsn-summary' ? 'Supplies' : 'Status'}
            <select className="input mt-1 w-48" value={params.status || ''} onChange={(e) => set({ status: e.target.value })}>
              {key !== 'hsn-summary' && <option value="">All</option>}
              {(STATUS_OPTIONS[key] ?? DOC_STATUSES.map((v) => ({ value: v, label: v.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()) }))).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {Object.keys(params).length > 0 && (
          <button className="link mb-2 text-[13px]" onClick={() => setSp(saved ? { saved: saved.id } : {}, { replace: true })}>
            Reset filters
          </button>
        )}
      </div>

      <div className="flex-1 px-5 py-6">
        {isLoading || !rep ? (
          error ? <div className="text-red-600">{(error as Error).message}</div> : <Spinner />
        ) : (
          <div className="print-area mx-auto max-w-6xl rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-6 pb-4 pt-6 text-center">
              <div className="text-xs uppercase tracking-wide text-slate-500">{org.name}</div>
              <h2 className="mt-1 text-xl font-semibold">{saved ? saved.name : rep.title}</h2>
              <div className="mt-0.5 text-[13px] text-slate-500">{rep.subtitle}</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    {cols.map((c, i) => (
                      <th key={c.key} className={clsx('whitespace-nowrap px-4 py-2.5 font-semibold', isNum(c) ? 'text-right' : 'text-left', i === 0 && 'pl-6', i === cols.length - 1 && 'pr-6')}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rep.rows.map((r, ri) => (
                    <tr
                      key={ri}
                      className={clsx(
                        'border-b border-slate-100',
                        r.kind === 'section' && 'bg-slate-50/70 font-semibold text-slate-800',
                        r.kind === 'sub' && 'font-medium',
                        r.kind === 'total' && 'border-t border-slate-300 font-semibold',
                        r.kind === 'grand' && 'border-t-2 border-slate-400 bg-slate-50 font-bold',
                        r.link && !r.kind && 'hover:bg-brand-50/40',
                      )}
                    >
                      {cols.map((c, i) => {
                        const v = r.c[c.key];
                        const text = formatCell(v, c.type);
                        const neg = typeof v === 'number' && v < 0 && (c.type === 'money' || c.type === 'number');
                        return (
                          <td key={c.key} className={clsx('px-4 py-2', isNum(c) ? 'whitespace-nowrap text-right tabular-nums' : 'text-left', i === 0 && 'pl-6', i === cols.length - 1 && 'pr-6', neg && 'text-red-600')} style={i === 0 && r.level ? { paddingLeft: 24 + r.level * 18 } : undefined}>
                            {i === 0 && r.link ? (
                              <Link className={clsx(r.kind ? 'hover:underline' : 'text-brand-700 hover:underline')} to={r.link}>
                                {text}
                              </Link>
                            ) : (
                              text
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {!rep.rows.length && (
                    <tr>
                      <td colSpan={cols.length} className="px-6 py-16 text-center text-slate-500">
                        There are no transactions for the selected filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {rep.notes?.length ? (
              <div className="space-y-1 border-t border-slate-100 px-6 py-3 text-xs text-slate-500">
                {rep.notes.map((n) => (
                  <p key={n}>{n}</p>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>
      {customizing && rep && (
        <CustomizeColumns
          columns={rep.columns}
          hidden={rep.columns.filter((c) => !cols.includes(c)).map((c) => c.key)}
          onClose={() => setCustomizing(false)}
          onApply={(h) => {
            setHidden(h);
            try {
              localStorage.setItem(hiddenKey(key), JSON.stringify(h));
            } catch {
              // per-viewer preference only
            }
            setCustomizing(false);
          }}
        />
      )}
      {saving && rep && <SaveReport report={key} params={params} hidden={rep.columns.filter((c) => !cols.includes(c)).map((c) => c.key)} defaultName={meta.name} onClose={() => setSaving(false)} />}
    </div>
  );
}

const isNum = (c: Col) => c.type === 'money' || c.type === 'number' || c.type === 'percent' || c.type === 'hours';

function CustomizeColumns({ columns, hidden, onApply, onClose }: { columns: Col[]; hidden: string[]; onApply: (h: string[]) => void; onClose: () => void }) {
  const [h, setH] = useState(hidden);
  return (
    <Modal
      open
      onClose={onClose}
      title="Customize Report Columns"
      footer={
        <>
          <button className="btn-primary" onClick={() => onApply(h)}>
            Apply
          </button>
          <button className="btn-secondary" onClick={() => setH(columns.filter((c) => c.hidden).map((c) => c.key))}>
            Restore Defaults
          </button>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        {columns.map((c, i) => (
          <label key={c.key} className={clsx('flex items-center gap-2 rounded-md border px-3 py-2 text-[13px]', h.includes(c.key) ? 'border-slate-200 text-slate-500' : 'border-brand-200 bg-brand-50/50')}>
            <input type="checkbox" className="accent-brand-600" disabled={i === 0} checked={!h.includes(c.key)} onChange={(e) => setH(e.target.checked ? h.filter((x) => x !== c.key) : [...h, c.key])} />
            {c.label}
            {i === 0 && <span className="ml-auto text-xxs text-slate-400">Always shown</span>}
          </label>
        ))}
      </div>
    </Modal>
  );
}

function SaveReport({ report, params, hidden, defaultName, onClose }: { report: string; params: Record<string, string>; hidden: string[]; defaultName: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState(`${defaultName} (custom)`);
  const save = useAction(() => api<{ id: string }>('/saved-reports', { body: { name, report, params, hiddenColumns: hidden } }), 'Custom report saved');
  return (
    <Modal
      open
      onClose={onClose}
      title="Save as Custom Report"
      footer={
        <>
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: (r) => navigate(`/reports/${report}${qs({ ...params, saved: r.id })}`, { replace: true }) })}>
            Save
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <Field label="Report Name" required>
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <p className="mt-3 text-xs text-slate-500">The current filters and column choices are saved. It appears under Custom Reports in the Reports Center for everyone in this organization.</p>
    </Modal>
  );
}

function ItemFilter({ value, onChange }: { value?: string; onChange: (v: string) => void }) {
  const { data = [] } = useApi<{ id: string; name: string }[]>('/items');
  return (
    <label className="text-xs text-slate-500">
      Item
      <select className="input mt-1 w-52" value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">All items</option>
        {data.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function ProjectFilter({ value, onChange }: { value?: string; onChange: (v: string) => void }) {
  const { data = [] } = useApi<{ id: string; name: string }[]>('/projects?view=all');
  return (
    <label className="text-xs text-slate-500">
      Project
      <select className="input mt-1 w-52" value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">All projects</option>
        {data.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function BudgetFilter({ value, onChange }: { value?: string; onChange: (v: string) => void }) {
  const { data = [] } = useApi<{ id: string; name: string }[]>('/budgets');
  return (
    <label className="text-xs text-slate-500">
      Budget
      <select className="input mt-1 w-56" value={value || ''} onChange={(e) => onChange(e.target.value)}>
        {!value && <option value="">{data.length ? 'Latest budget' : 'No budgets yet'}</option>}
        {data.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
          </option>
        ))}
      </select>
    </label>
  );
}
