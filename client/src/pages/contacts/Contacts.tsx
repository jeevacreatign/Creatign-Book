import { useState, type ReactNode } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronDown, ChevronRight, MoreHorizontal, Pencil, Plus, X, Mail, Phone, Smartphone, Paperclip, Printer, FileText, Send, Link2 } from 'lucide-react';
import { DOC_META } from '@shared/docmeta';
import { PERIODS, fmtDate, fmtDateTime, money, type PeriodKey } from '@shared/format';
import { PAYMENT_TERMS, type Contact, type ContactKind, type Expense, type Journal, type Mail as MailT, type PaymentMade, type PaymentReceived, type Project, type RecurringExpense, type TxnDoc } from '@shared/types';
import { api, qs, useAction, useApi } from '../../api';
import { useOrg } from '../../lib/app';
import { toast } from '../../lib/toast';
import { Dropdown, KV, MenuItem, Modal, SearchBox, Select, Spinner, Status, Tabs, clsx, useConfirm, DateInput } from '../../components/ui';
import { Attachments, Comments, EmailModal, Timeline } from '../../components/shared';
import { AddressBlock } from '../../components/DocumentPreview';
import { ContactForm } from './ContactForm';

type Row = Contact & { outstanding: number; unusedCredits: number };
const basePath = (k: ContactKind) => (k === 'customer' ? '/sales/customers' : '/purchases/vendors');

function ContactList({ kind }: { kind: ContactKind }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState('active');
  const [q, setQ] = useState('');
  const { data = [], isLoading } = useApi<Row[]>(`/contacts${qs({ kind, status, q })}`);
  const label = kind === 'customer' ? 'Customers' : 'Vendors';
  const views = [
    { value: 'active', label: `Active ${label}` },
    { value: 'inactive', label: `Inactive ${label}` },
    { value: 'all', label: `All ${label}` },
  ];
  if (isLoading) return <Spinner />;
  const empty = !data.length && status === 'active' && !q;
  return (
    <div>
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <Dropdown button={() => <button className="flex items-center gap-1 text-[15px] font-semibold">{views.find((v) => v.value === status)?.label} <ChevronDown size={15} className="text-brand-600" /></button>}>
          {views.map((v) => (
            <MenuItem key={v.value} onClick={() => setStatus(v.value)}>
              {v.label}
            </MenuItem>
          ))}
        </Dropdown>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={() => navigate(`${basePath(kind)}/new`)}>
            <Plus size={15} /> New
          </button>
          <Dropdown align="right" button={() => <button className="btn-icon" aria-label="More"><MoreHorizontal size={15} /></button>}>
            <MenuItem onClick={() => navigate('/settings/import')}>Import {label}</MenuItem>
          </Dropdown>
        </div>
      </div>
      {empty ? (
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <div className="text-lg font-semibold">{kind === 'vendor' ? 'Business is no fun without people.' : 'Get started with your first customer.'}</div>
          <div className="text-slate-500">Create and manage your {label.toLowerCase()}, all in one place.</div>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={() => navigate(`${basePath(kind)}/new`)}>
              + Create New {kind === 'vendor' ? 'Vendor' : 'Customer'}
            </button>
            <button className="btn-secondary" onClick={() => navigate('/settings/import')}>
              Import File
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="px-5 py-3">
            <div className="w-72">
              <SearchBox value={q} onChange={setQ} placeholder={`Search ${label.toLowerCase()}`} />
            </div>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Company Name</th>
                <th>Email</th>
                <th>Work Phone</th>
                <th className="text-right">{kind === 'customer' ? 'Receivables (BCY)' : 'Payables (BCY)'}</th>
                <th className="text-right">Unused Credits (BCY)</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="row-link" onClick={() => navigate(`${basePath(kind)}/${c.id}`)}>
                  <td className="font-medium text-brand-600">{c.displayName}</td>
                  <td>{c.companyName}</td>
                  <td>{c.email}</td>
                  <td>{c.workPhone}</td>
                  <td className="text-right tabular-nums">{money(c.outstanding)}</td>
                  <td className="text-right tabular-nums">{money(c.unusedCredits)}</td>
                </tr>
              ))}
              {!data.length && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400">
                    No {label.toLowerCase()} found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function ContactListPane({ kind }: { kind: ContactKind }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data = [] } = useApi<Row[]>(`/contacts${qs({ kind, status: 'all' })}`);
  return (
    <div className="no-print flex w-[280px] shrink-0 flex-col border-r border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5">
        <span className="font-semibold">All {kind === 'customer' ? 'Customers' : 'Vendors'}</span>
        <button className="btn-primary w-8 px-0" onClick={() => navigate(`${basePath(kind)}/new`)} aria-label="New">
          <Plus size={15} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {data.map((c) => (
          <Link key={c.id} to={`${basePath(kind)}/${c.id}`} className={clsx('block border-b border-slate-100 px-3 py-2.5 hover:bg-slate-50', c.id === id && 'bg-brand-50/70')}>
            <div className="flex justify-between gap-2">
              <span className="truncate font-medium">{c.displayName}</span>
              <span className="tabular-nums text-slate-700">{money(c.outstanding)}</span>
            </div>
            {c.status === 'inactive' && <div className="text-xxs uppercase text-slate-400">Inactive</div>}
          </Link>
        ))}
      </div>
    </div>
  );
}

function ContactDetail({ kind }: { kind: ContactKind }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: c } = useApi<Row>(`/contacts/${id}`);
  const [tab, setTab] = useState('overview');
  const [mergeOpen, setMergeOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const confirm = useConfirm();
  const status = useAction((s: string) => api(`/contacts/${id}/status`, { body: { status: s } }), 'Status updated');
  const del = useAction(() => api(`/contacts/${id}`, { method: 'DELETE' }), 'Deleted');
  const clone = useAction(() => api<Contact>(`/contacts/${id}/clone`, { body: {} }), 'Cloned');
  const portal = useAction(() => api(`/contacts/${id}`, { method: 'PUT', body: { portalEnabled: !c?.portalEnabled } }), 'Portal settings updated');
  const saveDocs = useAction((documents: Contact['documents']) => api(`/contacts/${id}`, { method: 'PUT', body: { documents } }), 'Attachments updated');
  if (!c) return <Spinner />;
  const vendor = kind === 'vendor';
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <h1 className="truncate text-lg">{c.displayName}</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button className="btn-secondary w-9 px-0" onClick={() => setAttachOpen((o) => !o)} aria-label="Attachments">
              <Paperclip size={14} />
              {c.documents.length > 0 && <span className="text-xxs">{c.documents.length}</span>}
            </button>
            {attachOpen && (
              <div className="menu right-0 w-96 p-3">
                <div className="mb-2 font-semibold">Attachments</div>
                <Attachments compact value={c.documents} onChange={(v) => saveDocs.mutate(v)} max={10} maxMB={10} />
              </div>
            )}
          </div>
          <button className="btn-secondary" onClick={() => navigate(`${basePath(kind)}/${c.id}/edit`)}>
            <Pencil size={14} /> Edit
          </button>
          <Dropdown align="right" button={() => <button className="btn-primary">New Transaction <ChevronDown size={13} /></button>}>
            {(vendor ? ['bill', 'purchase_order', 'vendor_credit', 'recurring_bill'] : ['invoice', 'quote', 'sales_order', 'delivery_challan', 'recurring_invoice', 'credit_note']).map((k) => (
              <MenuItem key={k} onClick={() => navigate(`${DOC_META[k as keyof typeof DOC_META].path}/new?contactId=${c.id}`)}>
                {DOC_META[k as keyof typeof DOC_META].label}
              </MenuItem>
            ))}
            <MenuItem onClick={() => navigate(vendor ? `/purchases/payments-made/new?contactId=${c.id}` : `/sales/payments-received/new?contactId=${c.id}`)}>{vendor ? 'Payment Made' : 'Customer Payment'}</MenuItem>
            {vendor && <MenuItem onClick={() => navigate(`/purchases/expenses/new?vendorId=${c.id}`)}>Expense</MenuItem>}
          </Dropdown>
          <Dropdown align="right" button={() => <button className="btn-secondary">More <ChevronDown size={13} /></button>}>
            {vendor && <MenuItem onClick={() => toast.success('PDF templates associated with this vendor')}>Associate Templates</MenuItem>}
            <MenuItem onClick={() => portal.mutate()}>{c.portalEnabled ? 'Disable Portal Access' : `Configure ${vendor ? 'Vendor' : 'Customer'} Portal`}</MenuItem>
            {vendor && <MenuItem onClick={() => navigate(`${basePath(kind)}/${c.id}/edit`)}>Add Bank Account</MenuItem>}
            <MenuItem onClick={() => setLinkOpen(true)}>Link to {vendor ? 'Customer' : 'Vendor'}</MenuItem>
            <MenuItem onClick={() => clone.mutate(undefined, { onSuccess: (r) => navigate(`${basePath(kind)}/${r.id}/edit`) })}>Clone</MenuItem>
            <MenuItem onClick={() => setMergeOpen(true)}>Merge {vendor ? 'Vendors' : 'Customers'}</MenuItem>
            <MenuItem onClick={() => status.mutate(c.status === 'active' ? 'inactive' : 'active')}>Mark as {c.status === 'active' ? 'Inactive' : 'Active'}</MenuItem>
            <MenuItem danger onClick={() => confirm.ask(`Delete ${c.displayName}`, 'This cannot be undone.', () => del.mutate(undefined, { onSuccess: () => navigate(basePath(kind)) }), { danger: true, label: 'Delete' })}>
              Delete
            </MenuItem>
          </Dropdown>
          <button className="btn-ghost w-8 px-0" onClick={() => navigate(basePath(kind))} aria-label="Close">
            <X size={18} />
          </button>
        </div>
      </div>
      <div className="px-5 pt-3">
        <Tabs
          tabs={[
            { value: 'overview', label: 'Overview' },
            { value: 'comments', label: 'Comments' },
            { value: 'transactions', label: 'Transactions' },
            { value: 'mails', label: 'Mails' },
            { value: 'statement', label: 'Statement' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {tab === 'overview' && <Overview c={c} />}
        {tab === 'comments' && <Comments entityType="contact" entityId={c.id} />}
        {tab === 'transactions' && <Transactions c={c} />}
        {tab === 'mails' && <Mails c={c} />}
        {tab === 'statement' && <Statement c={c} />}
      </div>
      {mergeOpen && <MergeModal c={c} onClose={() => setMergeOpen(false)} />}
      {linkOpen && <LinkModal c={c} onClose={() => setLinkOpen(false)} />}
      {confirm.node}
    </div>
  );
}

function Overview({ c }: { c: Row }) {
  const [period, setPeriod] = useState<PeriodKey>('last_6_months');
  const [basis, setBasis] = useState<'accrual' | 'cash'>('accrual');
  const { data: income } = useApi<{ total: number; series: { month: string; amount: number }[] }>(`/contacts/${c.id}/income${qs({ period, basis })}`);
  const vendor = c.kind === 'vendor';
  return (
    <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
      <div className="space-y-5">
        <div className="rounded-md border border-slate-200 p-4">
          <div className="text-xs text-slate-500">{c.companyName}</div>
          <div className="flex items-center gap-3 pt-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 font-semibold text-slate-600">{(c.firstName || c.displayName)[0]}</div>
            <div>
              <div className="font-medium">{[c.salutation, c.firstName, c.lastName].filter(Boolean).join(' ') || c.displayName}</div>
              {c.email && (
                <div className="flex items-center gap-1 text-xs text-slate-600">
                  <Mail size={11} /> {c.email}
                </div>
              )}
              {c.workPhone && (
                <div className="flex items-center gap-1 text-xs text-slate-600">
                  <Phone size={11} /> {c.workPhone}
                </div>
              )}
              {c.mobile && (
                <div className="flex items-center gap-1 text-xs text-slate-600">
                  <Smartphone size={11} /> {c.mobile}
                </div>
              )}
            </div>
          </div>
        </div>
        <Block title="Address">
          <div className="mb-1 text-xs text-slate-500">Billing Address</div>
          <AddressBlock a={c.billingAddress} />
          <div className="mb-1 mt-3 text-xs text-slate-500">Shipping Address</div>
          <AddressBlock a={c.shippingAddress} />
        </Block>
        <Block title="Other Details">
          {!vendor && <KV k="Customer Type" v={c.customerType === 'business' ? 'Business' : 'Individual'} />}
          <KV k="Default Currency" v={c.currencyCode} />
          <KV k="PAN" v={c.pan} />
          {vendor && <KV k="MSME Registered" v={c.msmeRegistered ? 'Yes' : 'No'} />}
          <KV k="Portal Status" v={c.portalEnabled ? <span className="text-emerald-600">Enabled</span> : <span className="text-slate-500">Disabled</span>} />
          <KV k={`${vendor ? 'Vendor' : 'Customer'} Language`} v={c.language} />
          <KV k="Website" v={c.website} />
          {c.remarks && <KV k="Remarks" v={c.remarks} />}
        </Block>
        <Block title={`Contact Persons (${c.contactPersons.length})`}>
          {c.contactPersons.length === 0 && <div className="text-slate-400">No contact persons found.</div>}
          {c.contactPersons.map((p) => (
            <div key={p.id} className="py-1">
              <div className="font-medium">{[p.salutation, p.firstName, p.lastName].filter(Boolean).join(' ')}</div>
              <div className="text-xs text-slate-500">{[p.email, p.workPhone, p.mobile].filter(Boolean).join(' · ')}</div>
            </div>
          ))}
        </Block>
        <Block title="Record Info">
          <KV k={`${vendor ? 'Vendor' : 'Customer'} ID`} v={c.id} />
          <KV k="Created On" v={fmtDate(c.createdAt.slice(0, 10))} />
          <KV k="Created By" v="Creatign" />
        </Block>
      </div>
      <div className="space-y-6">
        <div className="text-[13px] text-slate-600">
          Payment due period: <span className="font-medium text-slate-800">{PAYMENT_TERMS.find((t) => t.value === c.paymentTerms)?.label}</span>
        </div>
        <div>
          <div className="mb-2 font-semibold">{vendor ? 'Payables' : 'Receivables'}</div>
          <table className="table rounded-md border border-slate-200">
            <thead>
              <tr>
                <th>Currency</th>
                <th className="text-right">{vendor ? 'Outstanding Payables' : 'Outstanding Receivables'}</th>
                <th className="text-right">Unused Credits</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>INR- Indian Rupee</td>
                <td className="text-right tabular-nums">{money(c.outstanding)}</td>
                <td className="text-right tabular-nums">{money(c.unusedCredits)}</td>
              </tr>
            </tbody>
          </table>
          {c.openingBalance !== 0 && <div className="mt-1 text-xs text-slate-500">View Opening Balance: {money(c.openingBalance)}</div>}
        </div>
        <div className="rounded-md border border-slate-200 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-semibold">{vendor ? 'Expenses' : 'Income'}</div>
            <div className="flex items-center gap-3">
              <Select className="h-7 w-40 text-xs" value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)} options={PERIODS.filter((p) => ['last_6_months', 'last_12_months', 'this_fiscal_year', 'previous_fiscal_year'].includes(p.value))} />
              <div className="flex overflow-hidden rounded-md border border-slate-300 text-xs">
                {(['accrual', 'cash'] as const).map((b) => (
                  <button key={b} className={clsx('px-2 py-0.5 capitalize', basis === b ? 'bg-brand-600 text-white' : 'bg-white')} onClick={() => setBasis(b)}>
                    {b}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="h-48">
            <ResponsiveContainer>
              <BarChart data={income?.series || []} margin={{ left: 0, right: 8, top: 4 }}>
                <CartesianGrid vertical={false} stroke="#eef2f7" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} tickFormatter={(m: string) => m.slice(0, 3)} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={50} />
                <Tooltip formatter={(v: number) => money(v)} cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="amount" name={vendor ? 'Expenses' : 'Income'} fill="#2a78d6" radius={[4, 4, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 text-[13px]">
            Total {vendor ? 'Expenses' : 'Income'} ({PERIODS.find((p) => p.value === period)?.label}) - <b>{money(income?.total ?? 0)}</b>
          </div>
        </div>
        <div>
          <div className="mb-3 font-semibold">Activity</div>
          <Timeline contactId={c.id} />
        </div>
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button className="mb-2 flex w-full items-center justify-between border-b border-slate-200 pb-1 text-left text-xs font-semibold uppercase tracking-wide text-slate-500" onClick={() => setOpen((o) => !o)}>
        {title} {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {open && <div className="text-[13px]">{children}</div>}
    </div>
  );
}

type TxnGroups = {
  invoices: TxnDoc[];
  quotes: TxnDoc[];
  salesOrders: TxnDoc[];
  deliveryChallans: TxnDoc[];
  recurringInvoices: TxnDoc[];
  creditNotes: TxnDoc[];
  bills: TxnDoc[];
  purchaseOrders: TxnDoc[];
  recurringBills: TxnDoc[];
  vendorCredits: TxnDoc[];
  customerPayments: PaymentReceived[];
  billPayments: PaymentMade[];
  expenses: Expense[];
  recurringExpenses: RecurringExpense[];
  projects: Project[];
  journals: Journal[];
};

function Transactions({ c }: { c: Row }) {
  const { data } = useApi<TxnGroups>(`/contacts/${c.id}/transactions`);
  const navigate = useNavigate();
  if (!data) return <Spinner />;
  const docSection = (title: string, docs: TxnDoc[], kind: keyof typeof DOC_META) => ({
    title,
    count: docs.length,
    newTo: `${DOC_META[kind].path}/new?contactId=${c.id}`,
    head: ['Date', DOC_META[kind].numberLabel, 'Reference#', 'Status', 'Amount', 'Balance'],
    rows: docs.map((d) => ({ key: d.id, to: `${DOC_META[kind].path}/${d.id}`, cells: [fmtDate(d.date), d.number || d.profileName, d.referenceNumber, <Status key="s" status={d.status} dueDate={d.dueDate} />, money(d.total), money(d.balance)] })),
  });
  const sections =
    c.kind === 'customer'
      ? [
          docSection('Invoices', data.invoices, 'invoice'),
          {
            title: 'Customer Payments',
            count: data.customerPayments.length,
            newTo: `/sales/payments-received/new?contactId=${c.id}`,
            head: ['Date', 'Payment#', 'Reference#', 'Mode', 'Amount', 'Unused'],
            rows: data.customerPayments.map((p) => ({ key: p.id, to: `/sales/payments-received/${p.id}`, cells: [fmtDate(p.date), p.number, p.referenceNumber, p.mode, money(p.amount), money(p.unusedAmount)] })),
          },
          docSection('Quotes', data.quotes, 'quote'),
          docSection('Sales Orders', data.salesOrders, 'sales_order'),
          docSection('Delivery Challans', data.deliveryChallans, 'delivery_challan'),
          docSection('Recurring Invoices', data.recurringInvoices, 'recurring_invoice'),
          expenseSection(data.expenses, c, 'Expenses'),
          { title: 'Recurring Expenses', count: data.recurringExpenses.length, newTo: '/purchases/recurring-expenses/new', head: ['Profile', 'Frequency', 'Status', 'Amount'], rows: data.recurringExpenses.map((r) => ({ key: r.id, to: `/purchases/recurring-expenses/${r.id}`, cells: [r.profileName, `${r.repeatEvery.n} ${r.repeatEvery.unit}`, <Status key="s" status={r.status} />, money(r.amount)] })) },
          { title: 'Projects', count: data.projects.length, newTo: '/time-tracking/projects', head: ['Project', 'Billing', 'Rate', 'Status'], rows: data.projects.map((p) => ({ key: p.id, to: '/time-tracking/projects', cells: [p.name, p.billingMethod, money(p.rate), <Status key="s" status={p.status} />] })) },
          journalSection(data.journals),
          docSection('Bills', data.bills, 'bill'),
          docSection('Credit Notes', data.creditNotes, 'credit_note'),
        ]
      : [
          docSection('Bills', data.bills, 'bill'),
          {
            title: 'Bill Payments',
            count: data.billPayments.length,
            newTo: `/purchases/payments-made/new?contactId=${c.id}`,
            head: ['Date', 'Payment#', 'Reference#', 'Mode', 'Amount', 'Unused'],
            rows: data.billPayments.map((p) => ({ key: p.id, to: `/purchases/payments-made/${p.id}`, cells: [fmtDate(p.date), p.number, p.referenceNumber, p.mode, money(p.amount), money(p.unusedAmount)] })),
          },
          expenseSection(data.expenses, c, 'Expenses'),
          docSection('Recurring Bills', data.recurringBills, 'recurring_bill'),
          { title: 'Recurring Expenses', count: data.recurringExpenses.length, newTo: '/purchases/recurring-expenses/new', head: ['Profile', 'Frequency', 'Status', 'Amount'], rows: data.recurringExpenses.map((r) => ({ key: r.id, to: `/purchases/recurring-expenses/${r.id}`, cells: [r.profileName, `${r.repeatEvery.n} ${r.repeatEvery.unit}`, <Status key="s" status={r.status} />, money(r.amount)] })) },
          docSection('Purchase Orders', data.purchaseOrders, 'purchase_order'),
          docSection('Vendor Credits', data.vendorCredits, 'vendor_credit'),
          journalSection(data.journals),
        ];
  return (
    <div className="space-y-3">
      {sections.map((s) => (
        <TxnSection key={s.title} {...s} onRow={(to) => navigate(to)} />
      ))}
    </div>
  );
}

function expenseSection(expenses: Expense[], c: Row, title: string) {
  return {
    title,
    count: expenses.length,
    newTo: `/purchases/expenses/new${c.kind === 'vendor' ? `?vendorId=${c.id}` : ''}`,
    head: ['Date', 'Reference#', 'Status', 'Amount'],
    rows: expenses.map((e) => ({ key: e.id, to: `/purchases/expenses/${e.id}`, cells: [fmtDate(e.date), e.invoiceNumber, <Status key="s" status={e.status} />, money(e.amount)] })),
  };
}
function journalSection(journals: Journal[]) {
  return {
    title: 'Journals',
    count: journals.length,
    newTo: '/accountant/manual-journals/new',
    head: ['Date', 'Journal#', 'Type', 'Reference', 'Debit'],
    rows: journals.map((j) => ({ key: j.id, to: `/accountant/journals/${j.id}`, cells: [fmtDate(j.date), j.number, j.sourceType.replace(/_/g, ' '), j.reference, money(j.lines.reduce((s, l) => s + l.debit, 0))] })),
  };
}

function TxnSection({ title, count, newTo, head, rows, onRow }: { title: string; count: number; newTo: string; head: string[]; rows: { key: string; to: string; cells: ReactNode[] }[]; onRow: (to: string) => void }) {
  const [open, setOpen] = useState(count > 0 && ['Invoices', 'Bills', 'Customer Payments', 'Bill Payments'].includes(title));
  const navigate = useNavigate();
  return (
    <div className="rounded-md border border-slate-200">
      <div className="flex items-center justify-between bg-slate-50 px-3 py-2">
        <button className="flex items-center gap-1.5 font-medium" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {title}
          <span className="text-xs text-slate-400">({count})</span>
        </button>
        <button className="link inline-flex items-center gap-1 text-xs" onClick={() => navigate(newTo)}>
          <Plus size={12} /> New
        </button>
      </div>
      {open && (
        <table className="table">
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="row-link" onClick={() => onRow(r.to)}>
                {r.cells.map((cell, i) => (
                  <td key={i}>{cell}</td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={head.length} className="py-4 text-center text-slate-400">
                  There are no {title.toLowerCase()}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Mails({ c }: { c: Row }) {
  const { data = [] } = useApi<MailT[]>(`/mails${qs({ contactId: c.id })}`);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="max-w-4xl">
      <div className="mb-3 flex items-center justify-between">
        <div className="font-semibold">System Mails</div>
        <button className="link inline-flex items-center gap-1 text-xs" onClick={() => toast.success('Email accounts can be linked once an SMTP server is configured (see README).')}>
          <Link2 size={12} /> Link Email account
        </button>
      </div>
      {data.length === 0 && <div className="rounded-md border border-dashed border-slate-300 p-6 text-center text-slate-400">No emails sent to this contact yet.</div>}
      <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
        {data.map((m) => (
          <li key={m.id} className="cursor-pointer px-4 py-3 hover:bg-slate-50" onClick={() => setOpen(open === m.id ? null : m.id)}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                  <Send size={13} />
                </div>
                <div>
                  <div className="text-xs text-slate-500">To {m.to.join(', ')}</div>
                  <div className="font-medium">{m.subject}</div>
                  {m.attachments.length > 0 && <div className="text-xxs text-slate-500">📎 {m.attachments.join(', ')}</div>}
                </div>
              </div>
              <div className="shrink-0 text-xxs text-slate-400">{fmtDateTime(m.createdAt)}</div>
            </div>
            {open === m.id && <pre className="mt-3 whitespace-pre-wrap rounded bg-slate-50 p-3 font-sans text-[13px] text-slate-700">{m.body}</pre>}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface StatementData {
  from: string;
  to: string;
  opening: number;
  invoiced: number;
  paid: number;
  closing: number;
  rows: { date: string; type: string; number: string; details: string; amount: number; payment: number; balance: number }[];
}

export function StatementView({ c, s, org }: { c: Contact; s: StatementData; org: ReturnType<typeof useOrg> }) {
  const vendor = c.kind === 'vendor';
  return (
    <div className="print-area mx-auto max-w-[820px] bg-white p-10 text-[12.5px] shadow-sm ring-1 ring-slate-200">
      <div className="flex justify-between">
        <div>
          <div className="text-base font-bold">{org.name}</div>
          <div className="text-xs text-slate-600">
            {org.state}, {org.country}
            <br />
            {org.email}
          </div>
          <div className="mt-6 text-xs text-slate-500">To</div>
          <div className="font-semibold text-brand-700">{c.displayName}</div>
          <AddressBlock a={c.billingAddress} />
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold">{vendor ? 'Vendor Statement' : 'Statement of Accounts'}</div>
          <div className="mt-1 border-y border-slate-300 py-1 text-xs">
            {fmtDate(s.from)} To {fmtDate(s.to)}
          </div>
          <div className="mt-4 w-64 text-left">
            <div className="bg-slate-100 px-2 py-1 text-xs font-semibold">Account Summary</div>
            <div className="flex justify-between px-2 py-1">
              <span>Opening Balance</span>
              <span>{money(s.opening)}</span>
            </div>
            <div className="flex justify-between px-2 py-1">
              <span>{vendor ? 'Billed Amount' : 'Invoiced Amount'}</span>
              <span>{money(s.invoiced)}</span>
            </div>
            <div className="flex justify-between px-2 py-1">
              <span>{vendor ? 'Amount Paid' : 'Amount Received'}</span>
              <span>{money(s.paid)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-300 px-2 py-1 font-semibold">
              <span>Balance Due</span>
              <span>{money(s.closing)}</span>
            </div>
          </div>
        </div>
      </div>
      <table className="mt-8 w-full text-left text-xs">
        <thead>
          <tr className="bg-ink-900 text-white">
            <th className="px-2 py-2">Date</th>
            <th className="px-2 py-2">Transactions</th>
            <th className="px-2 py-2">Details</th>
            <th className="px-2 py-2 text-right">Amount</th>
            <th className="px-2 py-2 text-right">Payments</th>
            <th className="px-2 py-2 text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-slate-200">
            <td className="px-2 py-2">{fmtDate(s.from)}</td>
            <td className="px-2 py-2">***Opening Balance***</td>
            <td />
            <td className="px-2 py-2 text-right">{money(s.opening, '')}</td>
            <td />
            <td className="px-2 py-2 text-right">{money(s.opening, '')}</td>
          </tr>
          {s.rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-200">
              <td className="px-2 py-2">{fmtDate(r.date)}</td>
              <td className="px-2 py-2">{r.type}</td>
              <td className="px-2 py-2">
                {r.number} {r.details && <span className="text-slate-500">- {r.details.replace(/\d{4}-\d{2}-\d{2}/, (m) => fmtDate(m))}</span>}
              </td>
              <td className="px-2 py-2 text-right">{r.amount ? money(r.amount, '') : ''}</td>
              <td className="px-2 py-2 text-right">{r.payment ? money(r.payment, '') : ''}</td>
              <td className="px-2 py-2 text-right">{money(r.balance, '')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex justify-end">
        <div className="flex w-64 justify-between border-t border-slate-300 py-2 font-semibold">
          <span>Balance Due</span>
          <span>{money(s.closing)}</span>
        </div>
      </div>
    </div>
  );
}

function Statement({ c }: { c: Row }) {
  const org = useOrg();
  const [period, setPeriod] = useState<PeriodKey | 'custom'>('this_month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [filter, setFilter] = useState<'all' | 'outstanding'>('all');
  const [emailOpen, setEmailOpen] = useState(false);
  const params = period === 'custom' ? { from, to, filter } : { period, filter };
  const { data: s } = useApi<StatementData>(`/contacts/${c.id}/statement${qs(params)}`);
  const printUrl = `/print/statement/${c.id}${qs(params)}`;
  return (
    <div>
      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <Select className="w-44" value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)} options={[...PERIODS.filter((p) => p.value !== 'all'), { value: 'custom', label: 'Custom' }]} />
        {period === 'custom' && (
          <>
            <DateInput className="w-36" value={from} onChange={setFrom} />
            <span>to</span>
            <DateInput className="w-36" value={to} onChange={setTo} />
          </>
        )}
        <span className="text-xs text-slate-500">Filter By:</span>
        <Select className="w-36" value={filter} onChange={(e) => setFilter(e.target.value as 'all')} options={[{ value: 'all', label: 'All' }, { value: 'outstanding', label: 'Outstanding' }]} />
        <div className="ml-auto flex gap-2">
          <button className="btn-secondary" onClick={() => window.open(`${printUrl}&auto=1`, '_blank')}>
            <Printer size={14} /> Print
          </button>
          <button className="btn-secondary" onClick={() => window.open(printUrl, '_blank')}>
            <FileText size={14} /> PDF
          </button>
          <button className="btn-primary" onClick={() => setEmailOpen(true)}>
            <Mail size={14} /> Send Email
          </button>
        </div>
      </div>
      {s ? <StatementView c={c} s={s} org={org} /> : <Spinner />}
      {emailOpen && s && (
        <EmailModal
          open
          onClose={() => setEmailOpen(false)}
          title={`Email statement to ${c.displayName}`}
          to={c.email ? [c.email] : []}
          subject={`Account Statement from ${fmtDate(s.from)} to ${fmtDate(s.to)}`}
          body={`Dear ${c.displayName},\n\nIt's been a great experience working with you. Attached is your statement of accounts for the period ${fmtDate(s.from)} to ${fmtDate(s.to)}. The balance due is ${money(s.closing)}.\n\nRegards,\n${org.name}`}
          contactId={c.id}
          attachmentOptions={[
            ...(c.kind === 'customer' ? [{ key: 'unpaid', label: 'Attach Unpaid invoices List', defaultChecked: false }] : []),
            { key: 'statement', label: c.kind === 'customer' ? 'Attach Customer Statement' : 'Attach Vendor Statement' },
          ]}
        />
      )}
    </div>
  );
}

function MergeModal({ c, onClose }: { c: Row; onClose: () => void }) {
  const navigate = useNavigate();
  const { data = [] } = useApi<Row[]>(`/contacts${qs({ kind: c.kind, status: 'all' })}`);
  const [src, setSrc] = useState('');
  const merge = useAction(() => api(`/contacts/${c.id}/merge`, { body: { sourceId: src } }), 'Merged successfully');
  return (
    <Modal open onClose={onClose} title={`Merge ${c.kind === 'customer' ? 'Customers' : 'Vendors'}`} footer={<><button className="btn-primary" disabled={!src} onClick={() => merge.mutate(undefined, { onSuccess: () => { onClose(); navigate(`${basePath(c.kind)}/${c.id}`); } })}>Continue</button><button className="btn-secondary" onClick={onClose}>Cancel</button></>}>
      <div className="mb-3 text-[13px]">
        Select a {c.kind} to merge into <b>{c.displayName}</b>. All of its transactions move here and it is deleted.
      </div>
      <Select value={src} onChange={(e) => setSrc(e.target.value)} placeholder={`Select a ${c.kind}`} options={data.filter((x) => x.id !== c.id).map((x) => ({ value: x.id, label: x.displayName }))} />
    </Modal>
  );
}

function LinkModal({ c, onClose }: { c: Row; onClose: () => void }) {
  const other = c.kind === 'customer' ? 'vendor' : 'customer';
  const { data = [] } = useApi<Row[]>(`/contacts${qs({ kind: other })}`);
  const [sel, setSel] = useState(c.linkedContactId || '');
  const save = useAction(() => api(`/contacts/${c.id}`, { method: 'PUT', body: { linkedContactId: sel || undefined } }), 'Link saved');
  return (
    <Modal open onClose={onClose} title={`Link to ${other === 'customer' ? 'Customer' : 'Vendor'}`} footer={<><button className="btn-primary" onClick={() => save.mutate(undefined, { onSuccess: onClose })}>Link</button><button className="btn-secondary" onClick={onClose}>Cancel</button></>}>
      <div className="mb-3 text-[13px]">Link {c.displayName} to a {other} to see receivables and payables together.</div>
      <Select value={sel} onChange={(e) => setSel(e.target.value)} placeholder={`Select a ${other}`} options={data.map((x) => ({ value: x.id, label: x.displayName }))} />
    </Modal>
  );
}

export default function Contacts({ kind }: { kind: ContactKind }) {
  return (
    <Routes>
      <Route index element={<ContactList kind={kind} />} />
      <Route path="new" element={<ContactForm kind={kind} />} />
      <Route path=":id/edit" element={<ContactForm kind={kind} />} />
      <Route
        path=":id"
        element={
          <div className="flex h-full">
            <ContactListPane kind={kind} />
            <ContactDetail kind={kind} />
          </div>
        }
      />
    </Routes>
  );
}
