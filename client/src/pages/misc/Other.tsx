// Time tracking, documents, settings, app placeholders, print pages and the public share page.
import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Trash2, Wallet, CreditCard, FileText, Upload } from 'lucide-react';
import { APPROVAL_KINDS } from '@shared/approval';
import { DOC_META } from '@shared/docmeta';
import { fmtDate, fmtDateTime, money, today } from '@shared/format';
import type { Attachment, Contact, Organization, PaymentMade, PaymentReceived, Project, TimeEntry, TxnDoc } from '@shared/types';
import { api, qs, useAction, useApi } from '../../api';
import { useBoot } from '../../lib/app';
import { toast } from '../../lib/toast';
import { Checkbox, ContactPicker, DateInput, Field, Modal, PageHeader, Select, Spinner, Status, clsx } from '../../components/ui';
import { DocumentPreview, ReceiptPreview } from '../../components/DocumentPreview';
import { TemplatesSettings, useDocTemplate } from '../../components/pdf/Customize';
import type { PdfTemplate } from '@shared/pdfTemplate';
import { StatementView } from '../contacts/Contacts';

// ------------------------------------------------------------ time tracking

type PRow = Project & { customerName?: string; hours: number };

function Projects() {
  const { data = [] } = useApi<PRow[]>('/projects');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Partial<Project>>({ billingMethod: 'hourly', rate: 1000 });
  const save = useAction(() => api('/projects', { body: f }), 'Project created');
  const invoice = useAction((id: string) => api<TxnDoc>(`/projects/${id}/invoice`, { body: {} }), 'Draft invoice created from unbilled hours');
  const del = useAction((id: string) => api(`/projects/${id}`, { method: 'DELETE' }), 'Project deleted');
  return (
    <div>
      <PageHeader title="Projects">
        <button className="btn-primary" onClick={() => setOpen(true)}>
          <Plus size={15} /> New Project
        </button>
      </PageHeader>
      <table className="table">
        <thead>
          <tr>
            <th>Project Name</th>
            <th>Customer Name</th>
            <th>Billing Method</th>
            <th className="text-right">Rate</th>
            <th className="text-right">Logged Hours</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.map((p) => (
            <tr key={p.id}>
              <td className="font-medium">{p.name}</td>
              <td>{p.customerName}</td>
              <td className="capitalize">{p.billingMethod === 'hourly' ? 'Based on project hours' : 'Fixed cost'}</td>
              <td className="text-right">{money(p.rate)}</td>
              <td className="text-right">
                {p.hours}
                {p.budgetHours ? ` / ${p.budgetHours}` : ''}
              </td>
              <td className="text-right">
                <button className="link mr-3 text-xs" onClick={() => invoice.mutate(p.id, { onSuccess: (inv) => (window.location.href = `/sales/invoices/${inv.id}`) })}>
                  Invoice unbilled hours
                </button>
                <button className="text-slate-400 hover:text-red-500" onClick={() => del.mutate(p.id)} aria-label="Delete">
                  <Trash2 size={13} />
                </button>
              </td>
            </tr>
          ))}
          {!data.length && (
            <tr>
              <td colSpan={6} className="py-10 text-center text-slate-400">
                No projects yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <Modal open={open} onClose={() => setOpen(false)} title="New Project" footer={<><button className="btn-primary" onClick={() => save.mutate(undefined, { onSuccess: () => setOpen(false) })}>Save</button><button className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button></>}>
        <div className="space-y-3">
          <Field label="Project Name" required>
            <input className="input" value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Customer Name" required>
            <ContactPicker kind="customer" value={f.customerId} onChange={(v) => setF({ ...f, customerId: v || undefined })} />
          </Field>
          <Field label="Billing Method">
            <Select value={f.billingMethod} onChange={(e) => setF({ ...f, billingMethod: e.target.value as 'hourly' })} options={[{ value: 'hourly', label: 'Based on project hours' }, { value: 'fixed', label: 'Fixed cost for project' }]} />
          </Field>
          <Field label={f.billingMethod === 'fixed' ? 'Total Project Cost' : 'Rate per Hour'}>
            <input type="number" className="input" value={f.rate ?? ''} onChange={(e) => setF({ ...f, rate: Number(e.target.value) })} />
          </Field>
          <Field label="Budget Hours">
            <input type="number" className="input" value={f.budgetHours ?? ''} onChange={(e) => setF({ ...f, budgetHours: Number(e.target.value) })} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

function Timesheet() {
  const { data: projects = [] } = useApi<PRow[]>('/projects');
  const { data = [] } = useApi<(TimeEntry & { projectName?: string })[]>('/time-entries');
  const [f, setF] = useState<Partial<TimeEntry>>({ date: today(), hours: 1, billable: true });
  const save = useAction(() => api('/time-entries', { body: f }), 'Time logged');
  const del = useAction((id: string) => api(`/time-entries/${id}`, { method: 'DELETE' }), 'Entry deleted');
  return (
    <div>
      <PageHeader title="Timesheet" />
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 px-5 py-4">
        <Field label="Date" inline={false}>
          <DateInput className="w-40" value={f.date} onChange={(v) => setF({ ...f, date: v })} />
        </Field>
        <Field label="Project" inline={false} required>
          <Select className="w-56" value={f.projectId || ''} onChange={(e) => setF({ ...f, projectId: e.target.value })} placeholder="Select a project" options={projects.map((p) => ({ value: p.id, label: p.name }))} />
        </Field>
        <Field label="Task" inline={false}>
          <input className="input w-56" value={f.task || ''} onChange={(e) => setF({ ...f, task: e.target.value })} />
        </Field>
        <Field label="Hours" inline={false} required>
          <input type="number" step="0.25" className="input w-24" value={f.hours ?? ''} onChange={(e) => setF({ ...f, hours: Number(e.target.value) })} />
        </Field>
        <div className="pb-1.5">
          <Checkbox checked={!!f.billable} onChange={(v) => setF({ ...f, billable: v })} label="Billable" />
        </div>
        <button className="btn-primary" onClick={() => save.mutate()}>
          Log Time
        </button>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Project</th>
            <th>Task</th>
            <th className="text-right">Hours</th>
            <th>Billing</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.map((t) => (
            <tr key={t.id}>
              <td>{fmtDate(t.date)}</td>
              <td>{t.projectName}</td>
              <td>{t.task}</td>
              <td className="text-right">{t.hours}</td>
              <td>
                <Status status={t.invoiced ? 'invoiced' : t.billable ? 'unbilled' : 'non_billable'} />
              </td>
              <td className="text-right">
                <button className="text-slate-400 hover:text-red-500" onClick={() => del.mutate(t.id)} aria-label="Delete">
                  <Trash2 size={13} />
                </button>
              </td>
            </tr>
          ))}
          {!data.length && (
            <tr>
              <td colSpan={6} className="py-10 text-center text-slate-400">
                No time logged yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function TimeTracking() {
  return (
    <Routes>
      <Route path="timesheet" element={<Timesheet />} />
      <Route path="*" element={<Projects />} />
    </Routes>
  );
}

// ------------------------------------------------------------ documents

export function Documents() {
  const { data = [] } = useApi<(Attachment & { source: string; sourceId: string; sourceLabel: string })[]>('/documents');
  const path = (s: string, id: string) => (s in DOC_META ? `${DOC_META[s as keyof typeof DOC_META].path}/${id}` : s === 'customer' ? `/sales/customers/${id}` : s === 'vendor' ? `/purchases/vendors/${id}` : s === 'expense' ? `/purchases/expenses/${id}` : s === 'payment_received' ? `/sales/payments-received/${id}` : `/purchases/payments-made/${id}`);
  return (
    <div>
      <PageHeader title="Documents" sub="Every file attached to a transaction, contact or expense" />
      <table className="table">
        <thead>
          <tr>
            <th>File Name</th>
            <th>Attached To</th>
            <th>Size</th>
            <th>Uploaded</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={`${d.id}-${d.sourceId}`}>
              <td>
                <a className="link inline-flex items-center gap-1.5" href={d.url} target="_blank" rel="noreferrer">
                  <FileText size={13} /> {d.name}
                </a>
              </td>
              <td>
                <Link className="link" to={path(d.source, d.sourceId)}>
                  {d.sourceLabel}
                </Link>
              </td>
              <td>{(d.size / 1024).toFixed(1)} KB</td>
              <td>{fmtDateTime(d.uploadedAt)}</td>
            </tr>
          ))}
          {!data.length && (
            <tr>
              <td colSpan={4} className="py-12 text-center text-slate-400">
                No documents yet. Files you attach to invoices, bills, expenses and contacts appear here.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------ settings

function OrgProfile() {
  const boot = useBoot();
  const [f, setF] = useState<Organization>(boot.organization);
  const save = useAction(() => api('/organization', { method: 'PUT', body: f }), 'Organization profile saved');
  return (
    <div className="max-w-2xl space-y-3.5">
      <Field label="Organization Name" required>
        <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </Field>
      <Field label="Email">
        <input className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      </Field>
      <Field label="Phone">
        <input className="input" value={f.phone || ''} onChange={(e) => setF({ ...f, phone: e.target.value })} />
      </Field>
      <Field label="Address">
        <input className="input" value={f.address?.street1 || ''} onChange={(e) => setF({ ...f, address: { ...f.address, street1: e.target.value } })} />
      </Field>
      <Field label="State">
        <input className="input" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} />
      </Field>
      <Field label="Country">
        <input className="input" value={f.country} disabled />
      </Field>
      <Field label="GSTIN">
        <input className="input uppercase" value={f.gstin || ''} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} />
      </Field>
      <Field label="PAN">
        <input className="input uppercase" value={f.pan || ''} onChange={(e) => setF({ ...f, pan: e.target.value.toUpperCase() })} />
      </Field>
      <Field label="Base Currency">
        <input className="input" value={`${f.currencyCode} - Indian Rupee (${f.currencySymbol})`} disabled />
      </Field>
      <Field label="Fiscal Year">
        <input className="input" value="April - March" disabled />
      </Field>
      <Field label="Date Format">
        <input className="input" value="dd/MM/yyyy" disabled />
      </Field>
      <Field label="Logo Letter">
        <input className="input w-20" maxLength={2} value={f.logoText || ''} onChange={(e) => setF({ ...f, logoText: e.target.value })} />
      </Field>
      <button className="btn-primary" onClick={() => save.mutate()}>
        Save
      </button>
    </div>
  );
}

function Preferences() {
  const boot = useBoot();
  const p = boot.preferences;
  const [f, setF] = useState({ salespersons: (p.salespersons || []).join(', '), challanTypes: (p.challanTypes || []).join(', '), deliveryMethods: (p.deliveryMethods || []).join(', '), invoiceTerms: p.invoiceTerms || '', customerNotes: p.customerNotes || '', quoteNotes: p.quoteNotes || '', mileageRatePerKm: String(p.mileageRatePerKm ?? 8) });
  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const save = useAction(() => api('/preferences', { method: 'PUT', body: { salespersons: list(f.salespersons), challanTypes: list(f.challanTypes), deliveryMethods: list(f.deliveryMethods), invoiceTerms: f.invoiceTerms, customerNotes: f.customerNotes, quoteNotes: f.quoteNotes, mileageRatePerKm: Number(f.mileageRatePerKm) } }), 'Preferences saved');
  return (
    <div className="max-w-2xl space-y-3.5">
      <Field label="Salespersons" hint="Comma separated">
        <input className="input" value={f.salespersons} onChange={(e) => setF({ ...f, salespersons: e.target.value })} />
      </Field>
      <Field label="Challan Types" hint="Comma separated">
        <input className="input" value={f.challanTypes} onChange={(e) => setF({ ...f, challanTypes: e.target.value })} />
      </Field>
      <Field label="Delivery Methods" hint="Comma separated">
        <input className="input" value={f.deliveryMethods} onChange={(e) => setF({ ...f, deliveryMethods: e.target.value })} />
      </Field>
      <Field label="Default Invoice Terms">
        <textarea className="input" rows={2} value={f.invoiceTerms} onChange={(e) => setF({ ...f, invoiceTerms: e.target.value })} />
      </Field>
      <Field label="Default Customer Notes">
        <textarea className="input" rows={2} value={f.customerNotes} onChange={(e) => setF({ ...f, customerNotes: e.target.value })} />
      </Field>
      <Field label="Default Quote Notes">
        <textarea className="input" rows={2} value={f.quoteNotes} onChange={(e) => setF({ ...f, quoteNotes: e.target.value })} />
      </Field>
      <Field label="Mileage Rate (₹/km)">
        <input type="number" className="input w-32" value={f.mileageRatePerKm} onChange={(e) => setF({ ...f, mileageRatePerKm: e.target.value })} />
      </Field>
      <button className="btn-primary" onClick={() => save.mutate()}>
        Save
      </button>
    </div>
  );
}

function Approvals() {
  const boot = useBoot();
  const [on, setOn] = useState<Record<string, boolean>>(boot.approvals || {});
  const save = useAction(() => api('/preferences', { method: 'PUT', body: { approvals: on } }), 'Approval preferences saved');
  return (
    <div className="max-w-2xl">
      <div className="mb-1 text-[15px] font-semibold">Transaction Approval</div>
      <div className="mb-4 text-slate-600">
        When approval is on for a module, new transactions are saved as <b>Draft</b>. Submit them for approval to move them to <b>Pending Approval</b>; once approved they can be sent, confirmed or opened. Pending transactions stay out of your books and reports until then.
      </div>
      <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
        {APPROVAL_KINDS.map((k) => (
          <label key={k} className="flex cursor-pointer items-center justify-between px-4 py-2.5">
            <span>{DOC_META[k].plural}</span>
            <span className="flex items-center gap-2 text-xs text-slate-500">
              {on[k] ? 'Approval required' : 'No approval'}
              <button
                type="button"
                role="switch"
                aria-checked={!!on[k]}
                aria-label={`Require approval for ${DOC_META[k].plural}`}
                onClick={() => setOn({ ...on, [k]: !on[k] })}
                className={clsx('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition', on[k] ? 'bg-brand-600' : 'bg-slate-300')}
              >
                <span className={clsx('inline-block h-4 w-4 rounded-full bg-white shadow transition', on[k] ? 'translate-x-[18px]' : 'translate-x-0.5')} />
              </button>
            </span>
          </label>
        ))}
      </div>
      <button className="btn-primary mt-4" onClick={() => save.mutate()}>
        Save
      </button>
    </div>
  );
}

function Features() {
  const features = ['Quotes', 'Sales Orders', 'Delivery Challans', 'Recurring Invoices', 'Purchase Orders', 'Recurring Bills', 'Vendor Credits', 'Time Tracking', 'Projects', 'Customer Portal', 'Vendor Portal'];
  return (
    <div className="max-w-2xl">
      <div className="mb-3 text-slate-600">All modules are enabled for Creatign. Turning a module off hides it from the sidebar in a future release; the data stays intact.</div>
      <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
        {features.map((f) => (
          <div key={f} className="flex items-center justify-between px-4 py-2.5">
            <span>{f}</span>
            <span className="rounded bg-emerald-50 px-2 py-0.5 text-xxs font-semibold text-emerald-700">ENABLED</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ImportData() {
  const [kind, setKind] = useState<'items' | 'customer' | 'vendor'>('items');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  async function run(file: File) {
    setBusy(true);
    const text = await file.text();
    const [head, ...rows] = text.trim().split(/\r?\n/).map((l) => l.split(',').map((c) => c.replace(/^"|"$/g, '').trim()));
    const idx = (n: string) => head.findIndex((h) => h.toLowerCase() === n.toLowerCase());
    const out: string[] = [];
    for (const r of rows) {
      const get = (n: string) => (idx(n) >= 0 ? r[idx(n)] : undefined);
      try {
        if (kind === 'items') await api('/items', { body: { name: get('Name'), type: (get('Type') || 'goods').toLowerCase(), unit: get('Unit'), sellingPrice: Number(get('Rate') || get('Selling Price') || 0), costPrice: Number(get('Purchase Rate') || get('Cost Price') || 0), salesDescription: get('Description'), purchaseDescription: get('Purchase Description') } });
        else await api('/contacts', { body: { kind, displayName: get('Display Name') || get('Name'), companyName: get('Company Name'), email: get('Email'), workPhone: get('Phone') || get('Work Phone') } });
        out.push(`✓ ${r[0]}`);
      } catch (e) {
        out.push(`✗ ${r[0]}: ${(e as Error).message}`);
      }
    }
    setLog(out);
    setBusy(false);
    toast.success('Import finished');
  }
  return (
    <div className="max-w-2xl space-y-4">
      <div className="text-slate-600">Import a CSV file. The first row must contain column headers.</div>
      <Field label="Import">
        <Select className="max-w-xs" value={kind} onChange={(e) => setKind(e.target.value as 'items')} options={[{ value: 'items', label: 'Items' }, { value: 'customer', label: 'Customers' }, { value: 'vendor', label: 'Vendors' }]} />
      </Field>
      <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">Columns: {kind === 'items' ? 'Name, Type, Unit, Rate, Purchase Rate, Description, Purchase Description' : 'Display Name, Company Name, Email, Phone'}</div>
      <label className="btn-primary cursor-pointer">
        <Upload size={14} /> {busy ? 'Importing…' : 'Choose CSV file'}
        <input type="file" accept=".csv" hidden onChange={(e) => e.target.files?.[0] && run(e.target.files[0])} />
      </label>
      {log.length > 0 && <pre className="rounded-md border border-slate-200 p-3 text-xs">{log.join('\n')}</pre>}
    </div>
  );
}

function DataAdmin() {
  const [confirm, setConfirm] = useState(false);
  const reset = useAction((samples: boolean) => api('/admin/reset', { body: { samples } }), 'Data reset');
  return (
    <div className="max-w-2xl space-y-3">
      <div className="text-slate-600">Data is stored in <code className="rounded bg-slate-100 px-1">server/data/db.json</code>. Back it up by copying that file.</div>
      <button className="btn-danger" onClick={() => setConfirm(true)}>
        Reset all data
      </button>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Reset all data?" footer={<><button className="btn-danger" onClick={() => { reset.mutate(true); setConfirm(false); }}>Reset with sample data</button><button className="btn-secondary" onClick={() => { reset.mutate(false); setConfirm(false); }}>Reset empty</button></>}>
        Every transaction, contact and item will be erased. This cannot be undone.
      </Modal>
    </div>
  );
}

export function Settings() {
  const tabs = [
    { to: '/settings', label: 'Organization Profile', end: true },
    { to: '/settings/preferences', label: 'Preferences' },
    { to: '/settings/approvals', label: 'Approvals' },
    { to: '/settings/templates', label: 'PDF Templates' },
    { to: '/settings/features', label: 'Configure Features' },
    { to: '/settings/import', label: 'Import Data' },
    { to: '/settings/data', label: 'Data & Backup' },
  ];
  return (
    <div className="flex h-full">
      <div className="w-56 shrink-0 border-r border-slate-200 p-3">
        <div className="mb-2 px-2 text-xs font-semibold uppercase text-slate-400">Settings</div>
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => clsx('block rounded-md px-3 py-1.5 text-[13px]', isActive ? 'bg-brand-50 font-medium text-brand-700' : 'hover:bg-slate-50')}>
            {t.label}
          </NavLink>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <Routes>
          <Route index element={<OrgProfile />} />
          <Route path="preferences" element={<Preferences />} />
          <Route path="approvals" element={<Approvals />} />
          <Route path="templates" element={<TemplatesSettings />} />
          <Route path="features" element={<Features />} />
          <Route path="import" element={<ImportData />} />
          <Route path="data" element={<DataAdmin />} />
        </Routes>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ app placeholders

export function AppPlaceholder({ app }: { app: 'payroll' | 'payments' }) {
  const payroll = app === 'payroll';
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-24 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-brand-50 text-brand-600">{payroll ? <Wallet size={26} /> : <CreditCard size={26} />}</div>
      <div className="text-lg font-semibold">{payroll ? 'Payroll' : 'Payment Gateway'}</div>
      <div className="max-w-md text-slate-500">{payroll ? 'Run payroll, compute PF, ESI and TDS on salaries, and post salary journals to Creatign Books.' : 'Collect invoice payments online by card, UPI and net banking, and reconcile them automatically.'} This integration is a placeholder and is not connected yet.</div>
      <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">Coming soon</span>
    </div>
  );
}

// ------------------------------------------------------------ print & share

function useAutoPrint(ready: boolean) {
  const [search] = useSearchParams();
  useEffect(() => {
    if (ready && search.get('auto') === '1') setTimeout(() => window.print(), 400);
  }, [ready, search]);
}

function PrintShell({ children, ready }: { children: React.ReactNode; ready: boolean }) {
  useAutoPrint(ready);
  return (
    <div className="min-h-full bg-slate-100 px-4 py-8 print:bg-white print:p-0">
      <div className="no-print mx-auto mb-4 flex max-w-[900px] items-center justify-between text-[13px] text-slate-600">
        <span>Use your browser's “Save as PDF” destination to download a PDF.</span>
        <button className="btn-primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>
      {children}
    </div>
  );
}

export function PrintDoc() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const { organization, preferences } = useBoot();
  const { data } = useApi<TxnDoc & { contact?: Contact }>(`/docs/${id}`);
  const template = useDocTemplate(data?.kind || 'invoice', search.get('template') || data?.templateId);
  return <PrintShell ready={!!data}>{data ? <DocumentPreview doc={data} org={organization} contact={data.contact} template={template} preferences={preferences} ribbon={false} /> : <Spinner />}</PrintShell>;
}

export function PrintPayment({ made }: { made?: boolean }) {
  const { id } = useParams();
  const [search] = useSearchParams();
  const { organization } = useBoot();
  const { data } = useApi<(PaymentReceived | PaymentMade) & { contact?: Contact; invoices?: { amount: number; doc?: TxnDoc }[]; bills?: { amount: number; doc?: TxnDoc }[] }>(made ? `/payments-made/${id}` : `/payments-received/${id}`);
  const template = useDocTemplate('payment', search.get('template') || undefined);
  const rows = (data?.invoices || data?.bills || []).filter((x) => x.doc).map((x) => ({ number: x.doc!.number, date: x.doc!.date, total: x.doc!.total, amount: x.amount }));
  return <PrintShell ready={!!data}>{data ? <ReceiptPreview payment={data} org={organization} contact={data.contact} kind={made ? 'made' : 'received'} rows={rows} template={template} /> : <Spinner />}</PrintShell>;
}

export function PrintStatement() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const { organization } = useBoot();
  const { data: c } = useApi<Contact>(`/contacts/${id}`);
  const { data: s } = useApi<Parameters<typeof StatementView>[0]['s']>(`/contacts/${id}/statement${qs(Object.fromEntries(search.entries()))}`);
  return <PrintShell ready={!!(c && s)}>{c && s ? <StatementView c={c} s={s} org={organization} /> : <Spinner />}</PrintShell>;
}

export function SharePage() {
  const { token } = useParams();
  const { data, error } = useApi<{ doc: TxnDoc & { contact?: Contact }; organization: Organization; template: PdfTemplate; preferences: Record<string, unknown> }>(`/public/share/${token}`, { retry: false });
  if (error) return <div className="p-16 text-center text-slate-500">{(error as Error).message}</div>;
  if (!data) return <Spinner />;
  return (
    <div className="min-h-full bg-slate-100 py-8">
      <div className="mx-auto mb-4 flex max-w-[820px] items-center justify-between">
        <div className="text-[13px] text-slate-600">
          {DOC_META[data.doc.kind].label} from <b>{data.organization.name}</b>
        </div>
        <div className="flex gap-2">
          {data.doc.kind === 'invoice' && data.doc.balance > 0 && <span className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white">Balance due {money(data.doc.balance)}</span>}
          <button className="btn-secondary" onClick={() => window.print()}>
            Download PDF
          </button>
        </div>
      </div>
      <div className="mx-auto max-w-[900px] px-4">
        <DocumentPreview doc={data.doc} org={data.organization} contact={data.doc.contact} template={data.template} preferences={data.preferences} ribbon={false} />
      </div>
    </div>
  );
}
