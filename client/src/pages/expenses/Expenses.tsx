import { useEffect, useState } from 'react';
import { Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Download, MoreHorizontal, Plus, Trash2, X, Inbox, ScanLine, Repeat } from 'lucide-react';
import { fmtDate, money, today } from '@shared/format';
import type { Expense, ExpenseLine } from '@shared/types';
import { api, qs, useAction, useApi } from '../../api';
import { useBoot, isCashLike } from '../../lib/app';
import { toast } from '../../lib/toast';
import { AccountSelect, Checkbox, ContactPicker, DateInput, Dropdown, Field, FormFooter, MenuItem, MoneyInput, PageHeader, SearchBox, Spinner, Status, Tabs, clsx, useConfirm } from '../../components/ui';
import { Lifecycle } from '../../components/shared';
import { ExpenseSplitView, ViewPicker, useExpenseView, type ExpenseRow as Row } from './ExpenseDetail';
import { ReceiptDrop, ReportingTags } from './parts';

function exportCsv(rows: Row[]) {
  const head = ['Date', 'Expense Account', 'Reference#', 'Vendor Name', 'Paid Through', 'Customer Name', 'Status', 'Amount'];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const body = rows.map((e) => [e.date, e.isMileage ? 'Mileage' : e.accountName, e.invoiceNumber, e.vendorName, e.paidThroughName, e.customerName, e.status, e.amount].map(esc).join(','));
  const blob = new Blob([[head.join(','), ...body].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `expenses-${today()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function ExpenseList() {
  const navigate = useNavigate();
  const [view, setView] = useExpenseView();
  const [tab, setTab] = useState<'inbox' | 'all'>('all');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const { data = [], isLoading } = useApi<Row[]>(`/expenses${qs({ view, q })}`);
  const confirm = useConfirm();
  const toInvoice = useAction((id: string) => api<{ id: string }>(`/expenses/${id}/convert-to-invoice`, { body: {} }), 'Draft invoice created');
  const bulkDelete = useAction((ids: string[]) => api<{ deleted: number }>('/expenses/bulk-delete', { body: { ids } }), (r) => `${r.deleted} expense(s) deleted`);
  const allChecked = data.length > 0 && data.every((e) => selected.includes(e.id));
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const total = data.reduce((s, e) => s + e.amount, 0);
  return (
    <div>
      {selected.length ? (
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3">
          <div className="flex items-center gap-3">
            <button
              className="btn-secondary btn-sm text-red-600"
              onClick={() => confirm.ask('Delete expenses', `Delete ${selected.length} expense(s)? This cannot be undone.`, () => bulkDelete.mutate(selected, { onSuccess: () => setSelected([]) }), { danger: true, label: 'Delete' })}
            >
              <Trash2 size={13} /> Delete
            </button>
            <button className="btn-secondary btn-sm" onClick={() => exportCsv(data.filter((e) => selected.includes(e.id)))}>
              <Download size={13} /> Export Selected
            </button>
            <span className="text-[13px] text-slate-600">{selected.length} selected</span>
          </div>
          <button className="btn-ghost w-8 px-0" aria-label="Clear selection" onClick={() => setSelected([])}>
            <X size={16} />
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div className="flex items-center gap-6">
            <button className={clsx('tab pb-0', tab === 'inbox' && 'tab-active')} onClick={() => setTab('inbox')}>
              <Inbox size={14} className="mr-1 inline" /> Receipts Inbox
            </button>
            <div onClick={() => setTab('all')}>
              <ViewPicker view={view} setView={(v) => { setView(v); setTab('all'); setSelected([]); }} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-60">
              <SearchBox value={q} onChange={setQ} placeholder="Search expenses" />
            </div>
            <button className="btn-primary" onClick={() => navigate('/purchases/expenses/new')}>
              <Plus size={15} /> New
            </button>
            <Dropdown align="right" button={() => <button className="btn-icon" aria-label="More"><MoreHorizontal size={15} /></button>}>
              <MenuItem onClick={() => navigate('/purchases/expenses/new?tab=bulk')}>Bulk Add Expenses</MenuItem>
              <MenuItem onClick={() => navigate('/purchases/expenses/new?tab=mileage')}>Record Mileage</MenuItem>
              <MenuItem onClick={() => navigate('/settings/import')}>Import Expenses</MenuItem>
              <MenuItem icon={<Download size={13} />} onClick={() => exportCsv(data)}>
                Export Expenses
              </MenuItem>
            </Dropdown>
          </div>
        </div>
      )}
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
      ) : !data.length && view === 'all' && !q ? (
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
              <th className="w-8">
                <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" checked={allChecked} onChange={() => setSelected(allChecked ? [] : data.map((e) => e.id))} aria-label="Select all" />
              </th>
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
              <tr key={e.id} className={clsx('row-link', selected.includes(e.id) && 'bg-brand-50/50')} onClick={() => navigate(`/purchases/expenses/${e.id}`)}>
                <td onClick={(ev) => ev.stopPropagation()}>
                  <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" checked={selected.includes(e.id)} onChange={() => toggle(e.id)} aria-label="Select expense" />
                </td>
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
                <td colSpan={10} className="py-10 text-center text-slate-400">
                  No expenses in this view.
                </td>
              </tr>
            )}
          </tbody>
          {data.length > 0 && (
            <tfoot>
              <tr className="font-semibold">
                <td colSpan={8} className="text-right text-slate-500">
                  Total ({data.length})
                </td>
                <td className="text-right tabular-nums">{money(total)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      )}
      {confirm.node}
    </div>
  );
}

function ExpenseForm() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const boot = useBoot();
  const { accounts } = boot;
  const cloneId = search.get('clone');
  const { data: existing } = useApi<Expense>(id ? `/expenses/${id}` : cloneId ? `/expenses/${cloneId}` : null);
  const [tab, setTab] = useState<'record' | 'mileage' | 'bulk'>((search.get('tab') as 'bulk') || 'record');
  const blank = (): Partial<Expense> => ({ date: today(), paidThroughAccountId: 'acc_petty_cash', vendorId: search.get('vendorId') || undefined, customerId: search.get('customerId') || undefined, itemized: false, lines: [], receipts: [], billable: false, reportingTags: {}, ratePerKm: Number(boot.preferences.mileageRatePerKm) || 8 });
  const [f, setF] = useState<Partial<Expense> | null>(id || cloneId ? null : blank());
  const [bulk, setBulk] = useState<Partial<Expense>[]>([blank(), blank(), blank()]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (existing && !f) {
      if (id) setF(existing);
      else {
        // clone: same details, new date, no receipts and no links to invoices or profiles
        const { id: _id, invoiceId: _inv, recurringProfileId: _rp, status: _st, createdAt: _c, updatedAt: _u, ...rest } = existing;
        setF({ ...rest, date: today(), receipts: [], lines: rest.lines.map((l) => ({ ...l, id: '' })) });
      }
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
      <PageHeader title={id ? 'Edit Expense' : cloneId ? 'New Expense (Clone)' : 'New Expense'}>
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
              <Field label="Reporting Tags">
                <div className="max-w-xl pt-1.5">
                  <ReportingTags value={f.reportingTags || {}} onChange={(v) => set({ reportingTags: v })} />
                </div>
              </Field>
            </div>
            <div>
              <ReceiptDrop value={f.receipts || []} onChange={(v) => set({ receipts: v })} className="min-h-[260px]" />
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

export default function Expenses() {
  return (
    <Routes>
      <Route index element={<ExpenseList />} />
      <Route path="new" element={<ExpenseForm />} />
      <Route path=":id/edit" element={<ExpenseForm />} />
      <Route path=":id" element={<ExpenseSplitView />} />
    </Routes>
  );
}

export { RecurringExpenses } from './RecurringExpenses';
