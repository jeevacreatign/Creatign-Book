import { useEffect, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronDown, MoreHorizontal, Pencil, Plus, Trash2, X, Inbox, ScanLine, ArrowRightLeft, Repeat } from 'lucide-react';
import { fmtDate, frequencyLabel, money, today } from '@shared/format';
import type { Expense, ExpenseLine, Journal, RecurringExpense } from '@shared/types';
import { api, qs, useAction, useApi } from '../../api';
import { useBoot, isCashLike } from '../../lib/app';
import { toast } from '../../lib/toast';
import { AccountSelect, Checkbox, ContactPicker, DateInput, Dropdown, Field, FormFooter, KV, MenuItem, MoneyInput, PageHeader, Select, Spinner, Status, Tabs, clsx, useConfirm } from '../../components/ui';
import { Attachments, JournalTable, Lifecycle } from '../../components/shared';

type Row = Expense & { accountName?: string; paidThroughName?: string; vendorName?: string; customerName?: string };

const VIEWS = [
  { value: 'all', label: 'All' },
  { value: 'unbilled', label: 'Unbilled' },
  { value: 'invoiced', label: 'Invoiced' },
  { value: 'reimbursed', label: 'Reimbursed' },
  { value: 'billable', label: 'Billable' },
  { value: 'non_billable', label: 'Non-Billable' },
  { value: 'with_receipts', label: 'With Receipts' },
  { value: 'without_receipts', label: 'Without Receipts' },
];

function ExpenseList() {
  const navigate = useNavigate();
  const [view, setView] = useState('all');
  const [tab, setTab] = useState<'inbox' | 'all'>('all');
  const { data = [], isLoading } = useApi<Row[]>(`/expenses${qs({ view })}`);
  const toInvoice = useAction((id: string) => api<{ id: string }>(`/expenses/${id}/convert-to-invoice`, { body: {} }), 'Draft invoice created');
  return (
    <div>
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <div className="flex items-center gap-6">
          <button className={clsx('tab pb-0', tab === 'inbox' && 'tab-active')} onClick={() => setTab('inbox')}>
            <Inbox size={14} className="mr-1 inline" /> Receipts Inbox
          </button>
          <Dropdown
            button={() => (
              <button className={clsx('flex items-center gap-1 text-[15px] font-semibold', tab === 'all' ? 'text-slate-900' : 'text-slate-500')} onClick={() => setTab('all')}>
                {view === 'all' ? 'All Expenses' : `${VIEWS.find((v) => v.value === view)?.label} Expenses`} <ChevronDown size={15} className="text-brand-600" />
              </button>
            )}
          >
            {VIEWS.map((v) => (
              <MenuItem
                key={v.value}
                onClick={() => {
                  setView(v.value);
                  setTab('all');
                }}
              >
                {v.label}
              </MenuItem>
            ))}
            <MenuItem onClick={() => toast.success('Custom views can be saved from Reports > Expenses by Category')}>+ New View</MenuItem>
          </Dropdown>
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={() => navigate('/purchases/expenses/new')}>
            <Plus size={15} /> New
          </button>
          <Dropdown align="right" button={() => <button className="btn-icon" aria-label="More"><MoreHorizontal size={15} /></button>}>
            <MenuItem onClick={() => navigate('/purchases/expenses/new?tab=bulk')}>Bulk Add Expenses</MenuItem>
            <MenuItem onClick={() => navigate('/settings/import')}>Import Expenses</MenuItem>
          </Dropdown>
        </div>
      </div>
      {tab === 'inbox' ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <ScanLine size={40} className="text-slate-300" />
          <div className="text-lg font-semibold">Autoscan Documents</div>
          <div className="max-w-md text-slate-500">Upload receipts here and record them as expenses. Automatic OCR scanning needs an OCR provider; until one is configured, uploaded receipts open in a new expense for you to fill in.</div>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={() => navigate('/purchases/expenses/new')}>
              Upload Receipt
            </button>
            <button className="btn-secondary" onClick={() => toast.success('Autoscan will be enabled once an OCR provider is configured in Settings')}>
              Enable Autoscan
            </button>
          </div>
        </div>
      ) : isLoading ? (
        <Spinner />
      ) : !data.length && view === 'all' ? (
        <Lifecycle
          title="Time To Manage Your Expenses!"
          subtitle="Create and manage expenses that are part of your organization's operating costs."
          steps={['BILLABLE', ['CONVERT TO INVOICE', 'GET REIMBURSED']]}
          actions={
            <>
              <button className="btn-primary" onClick={() => navigate('/purchases/expenses/new')}>
                RECORD EXPENSE
              </button>
              <button className="btn-secondary" onClick={() => navigate('/settings/import')}>
                Import Expenses
              </button>
            </>
          }
        />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Expense Account</th>
              <th>Reference#</th>
              <th>Vendor Name</th>
              <th>Paid Through</th>
              <th>Customer Name</th>
              <th>Status</th>
              <th className="text-right">Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((e) => (
              <tr key={e.id} className="row-link" onClick={() => navigate(`/purchases/expenses/${e.id}`)}>
                <td>{fmtDate(e.date)}</td>
                <td className="text-brand-600">
                  {e.isMileage ? 'Mileage' : e.accountName}
                  {e.recurringProfileId && <Repeat size={11} className="ml-1 inline text-slate-400" />}
                </td>
                <td>{e.invoiceNumber}</td>
                <td>{e.vendorName}</td>
                <td>{e.paidThroughName}</td>
                <td>{e.customerName}</td>
                <td>
                  <Status status={e.status} />
                </td>
                <td className="text-right tabular-nums">{money(e.amount)}</td>
                <td className="text-right">
                  {e.status === 'unbilled' && (
                    <button
                      className="link text-xxs"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        toInvoice.mutate(e.id, { onSuccess: (inv) => navigate(`/sales/invoices/${inv.id}`) });
                      }}
                    >
                      Convert to Invoice
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!data.length && (
              <tr>
                <td colSpan={9} className="py-10 text-center text-slate-400">
                  No expenses in this view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ExpenseForm() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const boot = useBoot();
  const { accounts } = boot;
  const { data: existing } = useApi<Expense>(id ? `/expenses/${id}` : null);
  const [tab, setTab] = useState<'record' | 'mileage' | 'bulk'>((search.get('tab') as 'bulk') || 'record');
  const blank = (): Partial<Expense> => ({ date: today(), paidThroughAccountId: 'acc_petty_cash', vendorId: search.get('vendorId') || undefined, itemized: false, lines: [], receipts: [], billable: false, ratePerKm: Number(boot.preferences.mileageRatePerKm) || 8 });
  const [f, setF] = useState<Partial<Expense> | null>(id ? null : blank());
  const [bulk, setBulk] = useState<Partial<Expense>[]>([blank(), blank(), blank()]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (existing && !f) {
      setF(existing);
      if (existing.isMileage) setTab('mileage');
    }
  }, [existing, f]);
  if (!f) return <Spinner />;
  const set = (p: Partial<Expense>) => setF({ ...f, ...p });
  const expenseFilter = (a: { type: string; subType: string }) => a.type === 'expense' || a.subType === 'fixed_asset' || a.subType === 'other_current_asset';

  async function save(again = false) {
    setSaving(true);
    try {
      if (tab === 'bulk') {
        const rows = bulk.filter((b) => Number(b.amount) > 0);
        await api('/expenses/bulk', { body: { expenses: rows } });
        toast.success(`${rows.length} expenses recorded`);
        navigate('/purchases/expenses');
        return;
      }
      const saved = await api<Expense>(id ? `/expenses/${id}` : '/expenses', { method: id ? 'PUT' : 'POST', body: { ...f, isMileage: tab === 'mileage' } });
      toast.success(`Expense ${id ? 'updated' : 'recorded'}`);
      if (again) setF(blank());
      else navigate(`/purchases/expenses/${saved.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const lines = f.lines || [];
  const setLines = (l: ExpenseLine[]) => set({ lines: l, amount: l.reduce((s, x) => s + (Number(x.amount) || 0), 0) });

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader title={id ? 'Edit Expense' : 'New Expense'}>
        <button className="btn-ghost w-8 px-0" onClick={() => navigate(-1)} aria-label="Close">
          <X size={18} />
        </button>
      </PageHeader>
      <div className="flex-1 px-5 py-4">
        <Tabs
          tabs={[
            { value: 'record', label: 'Record Expense' },
            { value: 'mileage', label: 'Record Mileage' },
            ...(id ? [] : [{ value: 'bulk' as const, label: 'Bulk Add Expenses' }]),
          ]}
          value={tab}
          onChange={setTab}
          className="mb-5"
        />
        {tab === 'bulk' ? (
          <div className="max-w-6xl">
            <table className="table border border-slate-200">
              <thead>
                <tr>
                  <th className="w-40">Date*</th>
                  <th>Expense Account*</th>
                  <th className="w-36">Amount*</th>
                  <th>Paid Through*</th>
                  <th>Vendor</th>
                  <th>Customer</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {bulk.map((b, i) => {
                  const up = (p: Partial<Expense>) => setBulk(bulk.map((x, j) => (j === i ? { ...x, ...p } : x)));
                  return (
                    <tr key={i}>
                      <td>
                        <DateInput value={b.date} onChange={(v) => up({ date: v })} />
                      </td>
                      <td>
                        <AccountSelect accounts={accounts} value={b.accountId} onChange={(v) => up({ accountId: v })} filter={expenseFilter} />
                      </td>
                      <td>
                        <input type="number" className="input text-right" value={b.amount ?? ''} onChange={(e) => up({ amount: e.target.value as unknown as number })} />
                      </td>
                      <td>
                        <AccountSelect accounts={accounts} value={b.paidThroughAccountId} onChange={(v) => up({ paidThroughAccountId: v })} filter={isCashLike} />
                      </td>
                      <td>
                        <ContactPicker kind="vendor" value={b.vendorId} onChange={(v) => up({ vendorId: v || undefined })} placeholder="Vendor" />
                      </td>
                      <td>
                        <ContactPicker kind="customer" value={b.customerId} onChange={(v) => up({ customerId: v || undefined })} placeholder="Customer" />
                      </td>
                      <td>
                        <button className="mt-2 text-slate-400 hover:text-red-500" onClick={() => setBulk(bulk.filter((_, j) => j !== i))} aria-label="Remove row">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button className="btn-secondary btn-sm mt-2 text-brand-700" onClick={() => setBulk([...bulk, blank()])}>
              <Plus size={13} /> Add More Expenses
            </button>
          </div>
        ) : (
          <div className="grid max-w-6xl gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-3.5">
              <Field label="Date" required>
                <DateInput className="max-w-[200px]" value={f.date} onChange={(v) => set({ date: v })} />
              </Field>
              {tab === 'mileage' ? (
                <>
                  <Field label="Distance (km)" required>
                    <input type="number" className="input max-w-xs" value={f.distance ?? ''} onChange={(e) => set({ distance: Number(e.target.value) })} />
                  </Field>
                  <Field label="Rate per km" hint={`Amount: ${money((Number(f.distance) || 0) * (Number(f.ratePerKm) || 0))}`}>
                    <MoneyInput className="max-w-xs" value={f.ratePerKm} onChange={(v) => set({ ratePerKm: Number(v) })} />
                  </Field>
                </>
              ) : f.itemized ? (
                <Field label="Itemize" required>
                  <table className="table border border-slate-200">
                    <thead>
                      <tr>
                        <th>Expense Account</th>
                        <th>Notes</th>
                        <th className="w-32 text-right">Amount</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, i) => (
                        <tr key={i}>
                          <td>
                            <AccountSelect accounts={accounts} value={l.accountId} onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, accountId: v } : x)))} filter={expenseFilter} />
                          </td>
                          <td>
                            <input className="input" value={l.notes || ''} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)))} />
                          </td>
                          <td>
                            <input type="number" className="input text-right" value={l.amount} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)))} />
                          </td>
                          <td>
                            <button className="mt-2 text-slate-400 hover:text-red-500" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove">
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="mt-2 flex items-center justify-between">
                    <button className="btn-secondary btn-sm text-brand-700" onClick={() => setLines([...lines, { id: '', accountId: '', amount: 0 }])}>
                      <Plus size={13} /> Add row
                    </button>
                    <span className="text-[13px]">
                      Total: <b>{money(lines.reduce((s, l) => s + (Number(l.amount) || 0), 0))}</b>
                    </span>
                  </div>
                  <button className="link mt-2 text-xs" onClick={() => set({ itemized: false })}>
                    Back to single expense
                  </button>
                </Field>
              ) : (
                <>
                  <Field label="Expense Account" required>
                    <AccountSelect className="max-w-sm" accounts={accounts} value={f.accountId} onChange={(v) => set({ accountId: v })} filter={expenseFilter} />
                    <button className="link mt-1 text-xs" onClick={() => set({ itemized: true, lines: f.accountId ? [{ id: '', accountId: f.accountId, amount: Number(f.amount) || 0 }] : [] })}>
                      Itemize
                    </button>
                  </Field>
                  <Field label="Amount" required>
                    <MoneyInput className="max-w-xs" value={f.amount} onChange={(v) => set({ amount: v as unknown as number })} />
                  </Field>
                </>
              )}
              <Field label="Paid Through" required>
                <AccountSelect className="max-w-sm" accounts={accounts} value={f.paidThroughAccountId} onChange={(v) => set({ paidThroughAccountId: v })} filter={(a) => isCashLike(a) || a.subType === 'other_current_liability' || a.subType === 'equity' || a.subType === 'other_current_asset'} />
              </Field>
              <Field label="Vendor">
                <div className="max-w-sm">
                  <ContactPicker kind="vendor" value={f.vendorId} onChange={(v) => set({ vendorId: v || undefined })} />
                </div>
              </Field>
              <Field label="Invoice#">
                <input className="input max-w-sm" value={f.invoiceNumber || ''} onChange={(e) => set({ invoiceNumber: e.target.value })} />
              </Field>
              <Field label="Notes">
                <textarea className="input max-w-xl" rows={3} maxLength={500} placeholder="Max. 500 characters" value={f.notes || ''} onChange={(e) => set({ notes: e.target.value })} />
              </Field>
              <Field label="Customer Name">
                <div className="flex max-w-xl items-center gap-4">
                  <div className="flex-1">
                    <ContactPicker kind="customer" value={f.customerId} onChange={(v) => set({ customerId: v || undefined, billable: v ? f.billable : false })} />
                  </div>
                  <Checkbox checked={!!f.billable} disabled={!f.customerId} onChange={(v) => set({ billable: v })} label="Billable" />
                </div>
              </Field>
            </div>
            <div>
              <div className="rounded-lg border-2 border-dashed border-slate-300 p-5 text-center">
                <div className="mb-2 text-slate-500">Drag or Drop your Receipts</div>
                <Attachments compact value={f.receipts || []} onChange={(v) => set({ receipts: v })} max={10} maxMB={10} />
              </div>
            </div>
          </div>
        )}
      </div>
      <FormFooter>
        <button className="btn-primary" disabled={saving} onClick={() => save(false)}>
          Save
        </button>
        {!id && tab !== 'bulk' && (
          <button className="btn-secondary" disabled={saving} onClick={() => save(true)}>
            Save and New
          </button>
        )}
        <button className="btn-ghost" onClick={() => navigate(-1)}>
          Cancel
        </button>
      </FormFooter>
    </div>
  );
}

function ExpenseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { accounts } = useBoot();
  const { data: e } = useApi<Row & { journals: Journal[] }>(`/expenses/${id}`);
  const confirm = useConfirm();
  const del = useAction(() => api(`/expenses/${id}`, { method: 'DELETE' }), 'Expense deleted');
  const toInvoice = useAction(() => api<{ id: string }>(`/expenses/${id}/convert-to-invoice`, { body: {} }), 'Draft invoice created');
  const reimburse = useAction(() => api(`/expenses/${id}/reimburse`, { body: {} }), 'Marked as reimbursed');
  if (!e) return <Spinner />;
  const acct = (a?: string) => accounts.find((x) => x.id === a)?.name;
  return (
    <div className="max-w-4xl px-5 py-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-xs text-slate-500">Expense</div>
          <h1 className="text-lg">{e.isMileage ? 'Mileage' : e.itemized ? 'Itemized expense' : acct(e.accountId)}</h1>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => navigate(`/purchases/expenses/${e.id}/edit`)}>
            <Pencil size={14} /> Edit
          </button>
          {e.status === 'unbilled' && (
            <button className="btn-primary" onClick={() => toInvoice.mutate(undefined, { onSuccess: (inv) => navigate(`/sales/invoices/${inv.id}`) })}>
              <ArrowRightLeft size={14} /> Convert to Invoice
            </button>
          )}
          <Dropdown align="right" button={() => <button className="btn-icon" aria-label="More"><MoreHorizontal size={15} /></button>}>
            {e.status !== 'reimbursed' && <MenuItem onClick={() => reimburse.mutate()}>Mark as Reimbursed</MenuItem>}
            <MenuItem onClick={() => navigate(`/purchases/recurring-expenses/new?fromExpense=${e.id}`)}>Make Recurring</MenuItem>
            <MenuItem danger onClick={() => confirm.ask('Delete expense', 'This cannot be undone.', () => del.mutate(undefined, { onSuccess: () => navigate('/purchases/expenses') }), { danger: true, label: 'Delete' })}>
              Delete
            </MenuItem>
          </Dropdown>
          <button className="btn-ghost w-8 px-0" onClick={() => navigate('/purchases/expenses')} aria-label="Close">
            <X size={18} />
          </button>
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-md border border-slate-200 p-4">
          <div className="mb-2 text-2xl font-semibold text-red-600">{money(e.amount)}</div>
          <KV k="Date" v={fmtDate(e.date)} />
          <KV k="Status" v={<Status status={e.status} />} />
          <KV k="Paid Through" v={acct(e.paidThroughAccountId)} />
          <KV k="Vendor" v={e.vendorName} />
          <KV k="Customer" v={e.customerName} />
          <KV k="Invoice#" v={e.invoiceNumber} />
          {e.isMileage && <KV k="Distance" v={`${e.distance} km @ ${money(e.ratePerKm)}`} />}
          <KV k="Notes" v={e.notes} />
          {e.invoiceId && <KV k="Invoice" v={<Link className="link" to={`/sales/invoices/${e.invoiceId}`}>View invoice</Link>} />}
        </div>
        <div className="rounded-md border border-slate-200 p-4">
          <div className="mb-2 font-semibold">Receipts</div>
          {e.receipts.length === 0 && <div className="text-slate-400">No receipts attached.</div>}
          {e.receipts.map((r) => (
            <a key={r.id} href={r.url} target="_blank" rel="noreferrer" className="link block text-[13px]">
              {r.name}
            </a>
          ))}
          {e.itemized && (
            <table className="table mt-4">
              <tbody>
                {e.lines.map((l) => (
                  <tr key={l.id}>
                    <td>{acct(l.accountId)}</td>
                    <td className="text-right">{money(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <div className="mt-6">
        <div className="mb-2 font-semibold">Journal</div>
        <JournalTable journals={e.journals} />
      </div>
      {confirm.node}
    </div>
  );
}

// ------------------------------------------------------------ recurring expenses

type RRow = RecurringExpense & { accountName?: string; vendorName?: string; customerName?: string; children: number };

function RecurringList() {
  const navigate = useNavigate();
  const { data = [], isLoading } = useApi<RRow[]>('/recurring-expenses');
  if (isLoading) return <Spinner />;
  return (
    <div>
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <div className="text-[15px] font-semibold">All Profiles</div>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={() => navigate('/purchases/recurring-expenses/new')}>
            <Plus size={15} /> New
          </button>
          <Dropdown align="right" button={() => <button className="btn-icon" aria-label="More"><MoreHorizontal size={15} /></button>}>
            <MenuItem onClick={() => navigate('/settings/import')}>Import Recurring Expenses</MenuItem>
          </Dropdown>
        </div>
      </div>
      {!data.length ? (
        <Lifecycle
          title="Create. Set. Repeat."
          subtitle="Do you have recurring expenses that you pay at regular intervals? Create a profile and the expenses are recorded for you."
          steps={['CREATE RECURRING EXPENSE', ['BILLABLE', 'NON-BILLABLE']]}
          actions={
            <>
              <button className="btn-primary" onClick={() => navigate('/purchases/recurring-expenses/new')}>
                NEW RECURRING EXPENSE
              </button>
              <button className="btn-secondary" onClick={() => navigate('/settings/import')}>
                Import Recurring Expenses
              </button>
            </>
          }
        />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Profile Name</th>
              <th>Expense Account</th>
              <th>Vendor Name</th>
              <th>Frequency</th>
              <th>Last Expense Date</th>
              <th>Next Expense Date</th>
              <th>Status</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id} className="row-link" onClick={() => navigate(`/purchases/recurring-expenses/${r.id}`)}>
                <td className="text-brand-600">{r.profileName}</td>
                <td>{r.accountName}</td>
                <td>{r.vendorName}</td>
                <td>{frequencyLabel(r.repeatEvery)}</td>
                <td>{fmtDate(r.lastGeneratedDate) || '-'}</td>
                <td>{r.status === 'active' ? fmtDate(r.nextDate) : '-'}</td>
                <td>
                  <Status status={r.status} />
                </td>
                <td className="text-right">{money(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function RecurringForm() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { accounts } = useBoot();
  const fromExpense = search.get('fromExpense');
  const { data: existing } = useApi<RecurringExpense>(id ? `/recurring-expenses/${id}` : null);
  const { data: src } = useApi<Expense>(fromExpense ? `/expenses/${fromExpense}` : null);
  const [f, setF] = useState<Partial<RecurringExpense> | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (f) return;
    if (id) {
      if (existing) setF(existing);
      return;
    }
    if (fromExpense && !src) return;
    setF({ repeatEvery: { n: 1, unit: 'month' }, startOn: today(), neverExpires: true, paidThroughAccountId: 'acc_petty_cash', billable: false, reportingTags: {}, ...(src ? { accountId: src.accountId, amount: src.amount, vendorId: src.vendorId, customerId: src.customerId, notes: src.notes, paidThroughAccountId: src.paidThroughAccountId } : {}) });
  }, [existing, src, f, id, fromExpense]);
  if (!f) return <Spinner />;
  const set = (p: Partial<RecurringExpense>) => setF({ ...f, ...p });
  async function save() {
    setSaving(true);
    try {
      const saved = await api<RecurringExpense>(id ? `/recurring-expenses/${id}` : '/recurring-expenses', { method: id ? 'PUT' : 'POST', body: f });
      toast.success('Recurring expense saved');
      navigate(`/purchases/recurring-expenses/${saved.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader title={id ? 'Edit Recurring Expense' : 'New Recurring Expense'}>
        <button className="btn-ghost w-8 px-0" onClick={() => navigate(-1)} aria-label="Close">
          <X size={18} />
        </button>
      </PageHeader>
      <div className="max-w-3xl flex-1 space-y-3.5 px-5 py-5">
        <Field label="Profile Name" required>
          <input className="input max-w-sm" value={f.profileName || ''} onChange={(e) => set({ profileName: e.target.value })} />
        </Field>
        <Field label="Repeat Every" required>
          <div className="flex max-w-sm gap-2">
            <input type="number" min={1} className="input w-20" value={f.repeatEvery?.n ?? 1} onChange={(e) => set({ repeatEvery: { n: Number(e.target.value), unit: f.repeatEvery?.unit || 'month' } })} />
            <Select value={f.repeatEvery?.unit || 'month'} onChange={(e) => set({ repeatEvery: { n: f.repeatEvery?.n || 1, unit: e.target.value as 'month' } })} options={[{ value: 'day', label: 'Day(s)' }, { value: 'week', label: 'Week(s)' }, { value: 'month', label: 'Month(s)' }, { value: 'year', label: 'Year(s)' }]} />
          </div>
        </Field>
        <Field label="Start Date">
          <DateInput className="max-w-[200px]" value={f.startOn} onChange={(v) => set({ startOn: v })} />
        </Field>
        <Field label="Ends On">
          <div className="flex items-center gap-4">
            <DateInput className="max-w-[200px]" value={f.endsOn} disabled={f.neverExpires} onChange={(v) => set({ endsOn: v })} />
            <Checkbox checked={!!f.neverExpires} onChange={(v) => set({ neverExpires: v })} label="Never Expires" />
          </div>
        </Field>
        <Field label="Expense Account" required>
          <AccountSelect className="max-w-sm" accounts={accounts} value={f.accountId} onChange={(v) => set({ accountId: v })} filter={(a) => a.type === 'expense'} />
        </Field>
        <Field label="Amount" required>
          <MoneyInput className="max-w-xs" value={f.amount} onChange={(v) => set({ amount: v as unknown as number })} />
        </Field>
        <Field label="Paid Through" required>
          <AccountSelect className="max-w-sm" accounts={accounts} value={f.paidThroughAccountId} onChange={(v) => set({ paidThroughAccountId: v })} filter={isCashLike} />
        </Field>
        <Field label="Vendor">
          <div className="max-w-sm">
            <ContactPicker kind="vendor" value={f.vendorId} onChange={(v) => set({ vendorId: v || undefined })} />
          </div>
        </Field>
        <Field label="Notes">
          <textarea className="input max-w-xl" rows={3} value={f.notes || ''} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
        <Field label="Customer Name">
          <div className="flex max-w-xl items-center gap-4">
            <div className="flex-1">
              <ContactPicker kind="customer" value={f.customerId} onChange={(v) => set({ customerId: v || undefined })} />
            </div>
            <Checkbox checked={!!f.billable} disabled={!f.customerId} onChange={(v) => set({ billable: v })} label="Billable" />
          </div>
        </Field>
        <Field label="Reporting Tags">
          <input className="input max-w-sm" placeholder="e.g. Region: South" value={Object.entries(f.reportingTags || {}).map(([k, v]) => `${k}: ${v}`).join(', ')} onChange={(e) => set({ reportingTags: Object.fromEntries(e.target.value.split(',').map((p) => p.split(':').map((s) => s.trim())).filter((p) => p[0]).map((p) => [p[0], p[1] || ''])) })} />
        </Field>
      </div>
      <FormFooter>
        <button className="btn-primary" disabled={saving} onClick={save}>
          Save
        </button>
        <button className="btn-secondary" onClick={() => navigate(-1)}>
          Cancel
        </button>
      </FormFooter>
    </div>
  );
}

function RecurringDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: r } = useApi<RecurringExpense & { vendorName?: string; customerName?: string; children: Expense[] }>(`/recurring-expenses/${id}`);
  const act = useAction((a: string) => api(`/recurring-expenses/${id}/actions/${a}`, { body: {} }), 'Updated');
  const del = useAction(() => api(`/recurring-expenses/${id}`, { method: 'DELETE' }), 'Deleted');
  const confirm = useConfirm();
  if (!r) return <Spinner />;
  return (
    <div className="max-w-5xl px-5 py-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg">{r.profileName}</h1>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => navigate(`/purchases/recurring-expenses/${r.id}/edit`)}>
            <Pencil size={14} /> Edit
          </button>
          {r.status === 'active' ? <button className="btn-secondary" onClick={() => act.mutate('stop')}>Stop</button> : r.status === 'stopped' && <button className="btn-secondary" onClick={() => act.mutate('resume')}>Resume</button>}
          <button className="btn-secondary text-red-600" onClick={() => confirm.ask('Delete profile', 'Expenses already created stay as they are.', () => del.mutate(undefined, { onSuccess: () => navigate('/purchases/recurring-expenses') }), { danger: true, label: 'Delete' })}>
            <Trash2 size={14} />
          </button>
          <button className="btn-ghost w-8 px-0" onClick={() => navigate('/purchases/recurring-expenses')} aria-label="Close">
            <X size={18} />
          </button>
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-[320px_minmax(0,1fr)]">
        <div className="rounded-md border border-slate-200 p-4">
          <div className="mb-2 text-xl font-semibold">{money(r.amount)}</div>
          <KV k="Status" v={<Status status={r.status} />} />
          <KV k="Frequency" v={frequencyLabel(r.repeatEvery)} />
          <KV k="Start Date" v={fmtDate(r.startOn)} />
          <KV k="End Date" v={r.neverExpires ? 'Never Expires' : fmtDate(r.endsOn)} />
          <KV k="Next Expense" v={r.status === 'active' ? fmtDate(r.nextDate) : '-'} />
          <KV k="Vendor" v={r.vendorName} />
          <KV k="Customer" v={r.customerName} />
          <KV k="Billable" v={r.billable ? 'Billable' : 'Non-Billable'} />
        </div>
        <div>
          <div className="mb-2 font-semibold">Child Expenses</div>
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Status</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {r.children.map((c) => (
                <tr key={c.id} className="row-link" onClick={() => navigate(`/purchases/expenses/${c.id}`)}>
                  <td>{fmtDate(c.date)}</td>
                  <td>
                    <Status status={c.status} />
                  </td>
                  <td className="text-right">{money(c.amount)}</td>
                </tr>
              ))}
              {!r.children.length && (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-slate-400">
                    Expenses are created automatically on each due date.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {confirm.node}
    </div>
  );
}

export default function Expenses() {
  return (
    <Routes>
      <Route index element={<ExpenseList />} />
      <Route path="new" element={<ExpenseForm />} />
      <Route path=":id/edit" element={<ExpenseForm />} />
      <Route path=":id" element={<ExpenseDetail />} />
    </Routes>
  );
}

export function RecurringExpenses() {
  return (
    <Routes>
      <Route index element={<RecurringList />} />
      <Route path="new" element={<RecurringForm />} />
      <Route path=":id/edit" element={<RecurringForm />} />
      <Route path=":id" element={<RecurringDetail />} />
    </Routes>
  );
}
