// Time tracking, documents, settings, app placeholders, print pages and the public share page.
import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { Wallet, CreditCard, Download, FileText, Upload } from 'lucide-react';
import { APPROVAL_KINDS } from '@shared/approval';
import { parseDelimited } from '@shared/bankImport';
import { csvField, mapContactImportRow } from '@shared/contactImport';
import { DOC_META } from '@shared/docmeta';
import { fmtDate, fmtDateTime, money } from '@shared/format';
import type { Account, Attachment, Contact, DocKind, Item, Organization, PaymentMade, PaymentReceived, TxnDoc } from '@shared/types';
import { documentImportHeaders, parseDocumentImport } from '@shared/documentImport';
import { api, qs, useAction, useApi } from '../../api';
import { useBoot } from '../../lib/app';
import { toast } from '../../lib/toast';
import { Field, Modal, PageHeader, Select, Spinner, clsx } from '../../components/ui';
import { DocumentPreview, ReceiptPreview } from '../../components/DocumentPreview';
import { TemplatesSettings, useDocTemplate } from '../../components/pdf/Customize';
import type { PdfTemplate } from '@shared/pdfTemplate';
import { StatementView } from '../contacts/Contacts';
import { CsvImportButton, type CsvImportRecord, type CsvImportResult } from '../../components/CsvImportButton';
import EmailSettings from '../settings/Emails';
import type { ExpenseDetailData } from '../expenses/ExpenseDetail';
import PortalSettingsPage from '../settings/Portal';
import { MyAccount, UsersAccess } from '../settings/Team';
import { useMe } from '../../auth';


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
      <Field label="Default Client Notes">
        <textarea className="input" rows={2} value={f.customerNotes} onChange={(e) => setF({ ...f, customerNotes: e.target.value })} />
      </Field>
      <Field label="Default Estimate Notes">
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
  const features = ['Estimates', 'Sales Orders', 'Delivery Challans', 'Invoice Schedules', 'Purchase Orders', 'Bill Schedules', 'Debit Notes', 'Projects & Time', 'Projects', 'Client Portal', 'Supplier Portal'];
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
  const [searchParams] = useSearchParams();
  const requestedKind = searchParams.get('kind');
  const initialKind = requestedKind && Object.prototype.hasOwnProperty.call(DOC_META, requestedKind) ? requestedKind as DocKind : 'items';
  const [kind, setKind] = useState<'items' | 'customer' | 'vendor' | DocKind>(initialKind);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  async function importDocuments(documentKind: DocKind, records: CsvImportRecord[]): Promise<CsvImportResult[]> {
    if (!records.length) return [];
    const { documents, errors } = parseDocumentImport(documentKind, records[0].headers, records.map((record) => record.values));
    const meta = DOC_META[documentKind];
    const contactKind = meta.side === 'sales' ? 'customer' : 'vendor';
    const results: CsvImportResult[] = errors.map((error) => ({
      rowNumber: error.rowNumber,
      label: meta.label,
      success: false,
      message: error.message,
    }));
    const [contacts, items, accounts, existingDocuments] = await Promise.all([
      api<Contact[]>(`/contacts?kind=${contactKind}&status=all`),
      api<Item[]>('/items'),
      api<Account[]>('/accounts'),
      api<TxnDoc[]>(`/docs?kind=${documentKind}&status=all`),
    ]);
    const duplicateKey = (number: string, contactId?: string) => documentKind === 'bill'
      ? `${number.toLowerCase()}|${contactId || ''}`
      : number.toLowerCase();
    const existingNumbers = new Set(existingDocuments.map((document) => duplicateKey(document.number, document.contactId)));
    for (const document of documents) {
      const label = meta.recurring ? `Profile ${document.profileName || document.number}` : `${meta.label} ${document.number}`;
      try {
        if (document.error) throw new Error(document.error);
        const contact = contacts.find((entry) =>
          entry.displayName.toLowerCase() === document.customerName.toLowerCase()
          || entry.companyName?.toLowerCase() === document.customerName.toLowerCase(),
        );
        if (!contact) throw new Error(`${meta.side === 'sales' ? 'Customer' : 'Supplier'} "${document.customerName}" was not found; import the contact first`);
        const key = duplicateKey(document.number, contact.id);
        if (existingNumbers.has(key)) throw new Error(`${meta.numberLabel} ${document.number} already exists`);
        const unmatchedAccounts: string[] = [];
        const lineItems = document.lineItems.map((line) => {
          const item = items.find((entry) => entry.name.toLowerCase() === line.itemName.toLowerCase());
          const accountName = line.accountName?.toLowerCase();
          const account = accountName ? accounts.find((entry) => entry.name.toLowerCase() === accountName) : undefined;
          if (line.accountName && !account) unmatchedAccounts.push(line.accountName);
          return {
            itemId: item?.id,
            name: line.itemName,
            description: line.description,
            quantity: line.quantity,
            rate: line.rate,
            unit: line.unit,
            discountPercent: line.discountPercent,
            taxId: line.taxId ?? '',
            hsnSac: line.hsnSac,
            accountId: account?.id,
          };
        });
        const imported = await api<TxnDoc>('/docs', {
          body: {
            kind: documentKind,
            mode: 'draft',
            number: document.number,
            profileName: document.profileName,
            date: document.date,
            startOn: document.startOn || document.date,
            endsOn: document.endsOn,
            neverExpires: document.neverExpires,
            repeatEvery: document.repeatEvery,
            status: meta.recurring ? 'stopped' : 'draft',
            dueDate: document.dueDate,
            paymentTerms: document.paymentTerms,
            expiryDate: document.expiryDate,
            expectedShipmentDate: document.expectedShipmentDate,
            deliveryDate: document.deliveryDate,
            referenceNumber: document.referenceNumber,
            orderNumber: document.orderNumber,
            subject: document.subject,
            projectName: document.projectName,
            salesperson: document.salesperson,
            deliveryMethod: document.deliveryMethod,
            shipmentPreference: document.shipmentPreference,
            challanType: document.challanType,
            customerNotes: document.customerNotes,
            terms: document.terms,
            discountPercent: document.discountPercent,
            tdsRate: document.tdsRate,
            tcsRate: document.tcsRate,
            adjustment: document.adjustment,
            adjustmentLabel: document.adjustmentLabel,
            taxInclusive: document.taxInclusive,
            contactId: contact.id,
            lineItems,
          },
        });
        existingNumbers.add(key);
        const warnings: string[] = [];
        if (document.sourceStatus && document.sourceStatus.toLowerCase() !== 'draft') {
          warnings.push(`Source status "${document.sourceStatus}" was imported as ${meta.recurring ? 'Stopped' : 'Draft'}`);
        }
        if (document.sourceTotal !== undefined && Math.abs(imported.total - document.sourceTotal) >= 0.01) {
          warnings.push(`Source total ${document.sourceTotal.toFixed(2)} differs from imported total ${imported.total.toFixed(2)}`);
        }
        if (unmatchedAccounts.length) warnings.push(`Account(s) not found; using document defaults: ${[...new Set(unmatchedAccounts)].join(', ')}`);
        if (meta.recurring) warnings.push('Schedule imported as Stopped; review and activate it manually when ready');
        results.push({ rowNumber: document.rowNumber, label, success: true, message: warnings.join('; ') || undefined });
      } catch (error) {
        results.push({
          rowNumber: document.rowNumber,
          label,
          success: false,
          message: error instanceof Error ? error.message : `Could not import ${meta.label.toLowerCase()}`,
        });
      }
    }
    return results.sort((a, b) => a.rowNumber - b.rowNumber);
  }
  async function run(file: File) {
    setBusy(true);
    setLog([]);
    try {
      const text = await file.text();
      const [head, ...rows] = parseDelimited(text);
      if (!head?.length || !rows.length) throw new Error('The CSV must include a header row and at least one data row.');
      const out: string[] = [];
      const existingContacts = kind === 'customer' || kind === 'vendor' ? await api<Contact[]>(`/contacts?kind=${kind}&status=all`) : [];
      for (const r of rows) {
        const get = (n: string, ...aliases: string[]) => csvField(head, r, n, ...aliases);
        const label = get('Display Name', 'Contact Name', 'Name') || r[0] || 'Row';
        try {
          if (kind === 'items') {
            await api('/items', { body: { name: get('Name'), type: (get('Type') || 'goods').toLowerCase(), unit: get('Unit'), sellingPrice: Number(get('Rate') || get('Selling Price') || 0), costPrice: Number(get('Purchase Rate') || get('Cost Price') || 0), salesDescription: get('Description'), purchaseDescription: get('Purchase Description') } });
          } else if (kind === 'customer' || kind === 'vendor') {
            const contact = mapContactImportRow(kind, head, r);
            if (!contact.displayName) throw new Error('Display Name (or Contact Name) is required');
            const existing = existingContacts.find((item) => item.displayName.toLowerCase() === contact.displayName?.toLowerCase());
            const saved = existing
              ? await api<Contact>(`/contacts/${existing.id}`, { method: 'PUT', body: contact })
              : await api<Contact>('/contacts', { body: contact });
            if (!existing) existingContacts.push(saved);
            out.push(`✓ ${existing ? 'Updated' : 'Imported'} ${contact.displayName}`);
            continue;
          } else throw new Error('Choose a document type to use the document CSV importer');
          out.push(`✓ Imported ${label}`);
        } catch (e) {
          out.push(`✗ ${label}: ${(e as Error).message}`);
        }
      }
      setLog(out);
      const failed = out.filter((entry) => entry.startsWith('✗')).length;
      const succeeded = out.length - failed;
      if (failed) toast.error(`Import finished: ${succeeded} succeeded, ${failed} failed. See the row report.`);
      else toast.success(`Imported ${succeeded} record(s).`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="max-w-2xl space-y-4">
      <div className="text-slate-600">
        {Object.prototype.hasOwnProperty.call(DOC_META, kind)
          ? 'Import one row per document line from a CSV. Matching document numbers are grouped; the related customer or supplier must already exist.'
          : 'Import a CSV file with column headers in the first row. Contacts with a matching display name are updated; blank CSV fields leave existing details unchanged. Portal status imports the enabled flag, not portal users or logins.'}
      </div>
      <Field label="Import">
        <Select className="max-w-xs" value={kind} onChange={(e) => setKind(e.target.value as 'items' | 'customer' | 'vendor' | DocKind)} options={[{ value: 'items', label: 'Items' }, { value: 'customer', label: 'Clients' }, { value: 'vendor', label: 'Suppliers' }, ...Object.values(DOC_META).map((meta) => ({ value: meta.kind, label: meta.plural }))]} />
      </Field>
      {Object.prototype.hasOwnProperty.call(DOC_META, kind) ? (
        <CsvImportButton
          title={DOC_META[kind as DocKind].plural}
          filename={DOC_META[kind as DocKind].plural.toLowerCase().replace(/ /g, '-')}
          headers={documentImportHeaders(kind as DocKind)}
          instructions={`Use one row per item line; lines with the same document number are grouped. The ${DOC_META[kind as DocKind].side === 'sales' ? 'customer' : 'supplier'} must already exist. ${DOC_META[kind as DocKind].recurring ? 'Schedules are imported as Stopped; activate them only after review.' : 'Documents are imported as Draft and are not sent, approved or posted automatically.'}`}
          onImport={(records) => importDocuments(kind as DocKind, records)}
        />
      ) : (
        <>
          <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">Columns: {kind === 'items' ? 'Name, Type, Unit, Rate, Purchase Rate, Description, Purchase Description' : 'Contact Name, Company Name, Email/EmailID, Phone, Mobile/MobilePhone, Customer Type, Currency Code, Payment Terms, Opening Balance, PAN, GSTIN, Website, Billing and Shipping address fields, Contact Person fields, Portal Status, Notes'}</div>
          <label className="btn-primary cursor-pointer">
            <Upload size={14} /> {busy ? 'Importing…' : 'Choose CSV file'}
            <input type="file" accept=".csv" hidden onChange={(e) => e.target.files?.[0] && run(e.target.files[0])} />
          </label>
        </>
      )}
      {log.length > 0 && <pre className="rounded-md border border-slate-200 p-3 text-xs">{log.join('\n')}</pre>}
    </div>
  );
}

function DataAdmin() {
  const [confirm, setConfirm] = useState(false);
  const reset = useAction((samples: boolean) => api('/admin/reset', { body: { samples } }), 'Data reset');
  return (
    <div className="max-w-2xl space-y-3">
      <div className="text-slate-600">
        Your books are stored in the MySQL database set in <code className="rounded bg-slate-100 px-1">DATABASE_URL</code>. Schedule regular backups with <code className="rounded bg-slate-100 px-1">mysqldump</code> or your hosting provider's backups. You can also download a copy of everything as JSON (sign-in passwords and sessions are left out).
      </div>
      <a className="btn-secondary" href="/api/admin/backup" download>
        <Download size={14} /> Download Backup (JSON)
      </a>
      <button className="btn-danger" onClick={() => setConfirm(true)}>
        Reset all data
      </button>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Reset all data?" footer={<><button className="btn-danger" onClick={() => { reset.mutate(true); setConfirm(false); }}>Reset with sample data</button><button className="btn-secondary" onClick={() => { reset.mutate(false); setConfirm(false); }}>Reset empty</button></>}>
        Every transaction, contact and item will be erased. Users and their sign-ins are kept. This cannot be undone.
      </Modal>
    </div>
  );
}

export function Settings() {
  const me = useMe();
  const tabs = [
    { to: '/settings', label: 'Organization Profile', end: true },
    { to: '/settings/account', label: 'My Account' },
    ...(me.user.role === 'Admin' ? [{ to: '/settings/users', label: 'Users & Access' }] : []),
    { to: '/settings/preferences', label: 'Preferences' },
    { to: '/settings/approvals', label: 'Approvals' },
    { to: '/settings/templates', label: 'PDF Templates' },
    { to: '/settings/emails', label: 'Emails' },
    { to: '/settings/portal', label: 'Client Portal' },
    { to: '/settings/features', label: 'Feature Settings' },
    { to: '/settings/import', label: 'Import Data' },
    ...(me.user.role === 'Admin' ? [{ to: '/settings/data', label: 'Data & Backup' }] : []),
  ].filter((t) => me.user.role !== 'Timesheet Staff' || t.to === '/settings/account');
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
          <Route path="account" element={<MyAccount />} />
          <Route path="users" element={<UsersAccess />} />
          <Route path="preferences" element={<Preferences />} />
          <Route path="approvals" element={<Approvals />} />
          <Route path="templates" element={<TemplatesSettings />} />
          <Route path="emails/*" element={<EmailSettings />} />
          <Route path="portal" element={<PortalSettingsPage />} />
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
      <div className="max-w-md text-slate-500">{payroll ? 'Run payroll, compute PF, ESI and TDS on salaries, and post salary journals to Creatign Ledger.' : 'Collect invoice payments online by card, UPI and net banking, and reconcile them automatically.'} This integration is a placeholder and is not connected yet.</div>
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

/** Printable expense voucher. */
export function PrintExpense() {
  const { id } = useParams();
  const { organization: org, accounts } = useBoot();
  const { data: e } = useApi<ExpenseDetailData>(`/expenses/${id}`);
  const acct = (a?: string) => accounts.find((x) => x.id === a)?.name || '';
  const lines = e ? (e.itemized && e.lines.length ? e.lines.map((l) => ({ account: acct(l.accountId), notes: l.notes, amount: l.amount })) : [{ account: e.isMileage ? `Mileage (${e.distance} km @ ${money(e.ratePerKm)})` : e.accountName || acct(e.accountId), notes: e.notes, amount: e.amount }]) : [];
  return (
    <PrintShell ready={!!e}>
      {!e ? (
        <Spinner />
      ) : (
        <div className="mx-auto max-w-[900px] bg-white p-12 text-[13px] text-slate-800 shadow print:shadow-none">
          <div className="flex items-start justify-between border-b border-slate-200 pb-6">
            <div>
              {org.logo ? <img src={org.logo} alt="" className="mb-2 h-12" /> : null}
              <div className="text-lg font-semibold">{org.name}</div>
              <div className="text-slate-500">{[org.address?.street1, org.address?.city, org.address?.state].filter(Boolean).join(', ')}</div>
              {org.gstin && <div className="text-slate-500">GSTIN {org.gstin}</div>}
            </div>
            <div className="text-right">
              <div className="text-2xl font-light uppercase tracking-wide text-slate-700">Expense</div>
              <div className="mt-2 text-slate-500">Date: {fmtDate(e.date)}</div>
              {e.invoiceNumber && <div className="text-slate-500">Ref#: {e.invoiceNumber}</div>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-6 py-6">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-400">Paid To</div>
              <div className="font-medium">{e.vendorName || '-'}</div>
              <div className="mt-3 text-xs uppercase tracking-wide text-slate-400">Paid Through</div>
              <div className="font-medium">{e.paidThroughName}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-400">Client</div>
              <div className="font-medium">{e.customerName || '-'}</div>
              <div className="mt-3 text-xs uppercase tracking-wide text-slate-400">Status</div>
              <div className="font-medium">{e.billable ? 'Billable' : 'Non-Billable'}</div>
            </div>
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-800 text-left text-white">
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Expense Account</th>
                <th className="px-3 py-2 font-medium">Notes</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-b border-slate-200">
                  <td className="px-3 py-2">{i + 1}</td>
                  <td className="px-3 py-2">{l.account}</td>
                  <td className="px-3 py-2 text-slate-500">{l.notes}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 flex justify-end">
            <div className="w-64 rounded bg-slate-50 px-4 py-3 text-right">
              <div className="text-xs text-slate-500">Total</div>
              <div className="text-xl font-semibold">{money(e.amount)}</div>
            </div>
          </div>
          {e.receipts.length > 0 && <div className="mt-8 text-xs text-slate-500">Receipts attached: {e.receipts.map((r) => r.name).join(', ')}</div>}
        </div>
      )}
    </PrintShell>
  );
}

export function PrintStatement() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const { organization } = useBoot();
  const { data: c } = useApi<Contact>(`/contacts/${id}`);
  const { data: s } = useApi<Parameters<typeof StatementView>[0]['s']>(`/contacts/${id}/statement${qs(Object.fromEntries(search.entries()))}`);
  return <PrintShell ready={!!(c && s)}>{c && s ? <StatementView c={c} s={s} org={organization} /> : <Spinner />}</PrintShell>;
}
