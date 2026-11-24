// Zoho-style expense split view: the "All Expenses" list on the left and Expense Details on the right,
// with the Edit | Make Recurring | PDF/Print | ... toolbar, the receipt drop zone and the Journal tab.
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRightLeft, BookOpen, CheckCircle2, ChevronDown, Copy, FileText, MessageSquare, MoreHorizontal, Pencil, Plus, Printer, Repeat, Trash2, X } from 'lucide-react';
import { fmtDate, money } from '@shared/format';
import type { Attachment, Expense, Journal } from '@shared/types';
import { api, qs, useAction, useApi } from '../../api';
import { useBoot } from '../../lib/app';
import { Dropdown, MenuItem, Spinner, Status, Tabs, clsx, useConfirm } from '../../components/ui';
import { Comments, Timeline } from '../../components/shared';
import { MakeRecurringDrawer, ReceiptDrop, TagChips } from './parts';

export type ExpenseRow = Expense & { accountName?: string; paidThroughName?: string; vendorName?: string; customerName?: string };
export type ExpenseDetailData = ExpenseRow & {
  profile?: { id: string; profileName: string; status: string };
  invoice?: { id: string; number: string; status: string };
  journals: Journal[];
};

export const EXPENSE_VIEWS = [
  { value: 'all', label: 'All' },
  { value: 'unbilled', label: 'Unbilled' },
  { value: 'invoiced', label: 'Invoiced' },
  { value: 'reimbursed', label: 'Reimbursed' },
  { value: 'billable', label: 'Billable' },
  { value: 'non_billable', label: 'Non-Billable' },
  { value: 'with_receipts', label: 'With Receipts' },
  { value: 'without_receipts', label: 'Without Receipts' },
];

export const viewTitle = (view: string) => (view === 'all' ? 'All Expenses' : `${EXPENSE_VIEWS.find((v) => v.value === view)?.label} Expenses`);

const VIEW_KEY = 'creatign.expenses.view';
export function useExpenseView() {
  const [view, setViewState] = useState(() => {
    try {
      return sessionStorage.getItem(VIEW_KEY) || 'all';
    } catch {
      return 'all';
    }
  });
  const setView = (v: string) => {
    setViewState(v);
    try {
      sessionStorage.setItem(VIEW_KEY, v);
    } catch {
      /* private mode */
    }
  };
  return [view, setView] as const;
}

export function ViewPicker({ view, setView, compact }: { view: string; setView: (v: string) => void; compact?: boolean }) {
  return (
    <Dropdown
      button={() => (
        <button className={clsx('flex items-center gap-1 font-semibold text-slate-900', compact ? 'text-[15px]' : 'text-[17px]')}>
          {viewTitle(view)} <ChevronDown size={15} className="text-brand-600" />
        </button>
      )}
    >
      {EXPENSE_VIEWS.map((v) => (
        <MenuItem key={v.value} onClick={() => setView(v.value)}>
          <span className={clsx(v.value === view && 'font-semibold text-brand-700')}>{v.label}</span>
        </MenuItem>
      ))}
    </Dropdown>
  );
}

const rowTitle = (e: ExpenseRow) => (e.isMileage ? 'Mileage' : e.accountName || 'Expense');

/** Left pane of the split view. */
function ExpenseListPane() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [view, setView] = useExpenseView();
  const { data = [] } = useApi<ExpenseRow[]>(`/expenses${qs({ view })}`);
  const [selected, setSelected] = useState<string[]>([]);
  const confirm = useConfirm();
  const bulkDelete = useAction((ids: string[]) => api<{ deleted: number }>('/expenses/bulk-delete', { body: { ids } }), (r) => `${r.deleted} expense(s) deleted`);
  const toggle = (x: string) => setSelected((s) => (s.includes(x) ? s.filter((y) => y !== x) : [...s, x]));
  return (
    <div className="no-print flex w-[340px] shrink-0 flex-col border-r border-slate-200">
      {selected.length ? (
        <div className="flex h-[57px] items-center justify-between border-b border-slate-200 bg-slate-50 px-3">
          <span className="text-[13px] font-medium">{selected.length} selected</span>
          <div className="flex gap-2">
            <button
              className="btn-secondary btn-sm text-red-600"
              onClick={() =>
                confirm.ask('Delete expenses', `Delete ${selected.length} expense(s)? This cannot be undone.`, () => bulkDelete.mutate(selected, { onSuccess: () => { if (id && selected.includes(id)) navigate('/purchases/expenses'); setSelected([]); } }), { danger: true, label: 'Delete' })
              }
            >
              <Trash2 size={13} /> Delete
            </button>
            <button className="btn-ghost w-8 px-0" aria-label="Clear selection" onClick={() => setSelected([])}>
              <X size={16} />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex h-[57px] items-center justify-between border-b border-slate-200 px-3">
          <ViewPicker view={view} setView={setView} compact />
          <div className="flex gap-1.5">
            <button className="btn-primary w-8 px-0" onClick={() => navigate('/purchases/expenses/new')} aria-label="New expense">
              <Plus size={15} />
            </button>
            <Dropdown align="right" button={() => <button className="btn-icon" aria-label="More"><MoreHorizontal size={15} /></button>}>
              <MenuItem onClick={() => navigate('/purchases/expenses/new?tab=bulk')}>Bulk Add Expenses</MenuItem>
              <MenuItem onClick={() => navigate('/purchases/expenses/new?tab=mileage')}>Record Mileage</MenuItem>
              <MenuItem onClick={() => navigate('/settings/import')}>Import Expenses</MenuItem>
            </Dropdown>
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {data.map((e) => (
          <div key={e.id} className={clsx('flex gap-2.5 border-b border-slate-100 px-3 py-3 hover:bg-slate-50', e.id === id && 'bg-brand-50/70 hover:bg-brand-50')}>
            <input type="checkbox" className="mt-1 h-3.5 w-3.5 shrink-0 accent-brand-600" checked={selected.includes(e.id)} onChange={() => toggle(e.id)} aria-label={`Select ${rowTitle(e)}`} />
            <Link to={`/purchases/expenses/${e.id}`} className="min-w-0 flex-1">
              <div className="flex justify-between gap-2">
                <span className="truncate font-medium text-slate-800">
                  {rowTitle(e)}
                  {e.recurringProfileId && <Repeat size={11} className="ml-1 inline text-slate-400" />}
                </span>
                <span className="shrink-0 tabular-nums text-slate-800">{money(e.amount)}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500">
                <span>{fmtDate(e.date)}</span>
                {(e.vendorName || e.customerName) && (
                  <>
                    <span>•</span>
                    <span className="truncate">{e.vendorName || e.customerName}</span>
                  </>
                )}
              </div>
              {e.status !== 'non_billable' && <Status status={e.status} className="mt-0.5 block" />}
            </Link>
          </div>
        ))}
        {!data.length && <div className="px-4 py-10 text-center text-[13px] text-slate-400">No expenses in this view.</div>}
      </div>
      {confirm.node}
    </div>
  );
}

function ToolbarBtn({ children, icon, onClick, active }: { children: ReactNode; icon?: ReactNode; onClick?: () => void; active?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={clsx('inline-flex h-10 items-center gap-1.5 border-r border-slate-200 px-3.5 text-[13px] text-slate-700 hover:bg-white hover:text-brand-700', active && 'bg-white text-brand-700')}>
      {icon}
      {children}
    </button>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 text-[13px] text-slate-800">{children}</div>
    </div>
  );
}

/** Journal in Zoho's format: base-currency note, "Expense - date" heading and the double entry table. */
function ExpenseJournal({ e }: { e: ExpenseDetailData }) {
  const { accounts, organization } = useBoot();
  const name = (aid: string) => accounts.find((a) => a.id === aid)?.name ?? aid;
  if (!e.journals.length) return <div className="rounded-md border border-dashed border-slate-300 p-4 text-center text-slate-500">No journal entries for this expense.</div>;
  return (
    <div>
      <div className="mb-3 flex items-center gap-1.5 text-xs text-slate-500">
        Amount is displayed in your base currency
        <span className="rounded bg-emerald-600 px-1.5 py-px text-[10px] font-bold text-white">{organization.currencyCode || 'INR'}</span>
      </div>
      {e.journals.map((j) => {
        const dr = j.lines.reduce((s, l) => s + l.debit, 0);
        const cr = j.lines.reduce((s, l) => s + l.credit, 0);
        return (
          <div key={j.id} className="mb-5">
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="text-[16px] font-semibold text-slate-900">
                Expense <span className="mx-1">-</span> {fmtDate(j.date)}
              </h3>
              <span className="text-xs text-slate-400">{j.number}</span>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="text-right">Debit</th>
                  <th className="text-right">Credit</th>
                </tr>
              </thead>
              <tbody>
                {j.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{name(l.accountId)}</td>
                    <td className="text-right tabular-nums">{money(l.debit, '')}</td>
                    <td className="text-right tabular-nums">{money(l.credit, '')}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td />
                  <td className="text-right tabular-nums">{money(dr, '')}</td>
                  <td className="text-right tabular-nums">{money(cr, '')}</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function ExpenseDetailPane() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { accounts } = useBoot();
  const { data: e, isLoading, error } = useApi<ExpenseDetailData>(`/expenses/${id}`);
  const [tab, setTab] = useState<'journal' | 'comments' | 'history'>('journal');
  const [recurring, setRecurring] = useState(false);
  const confirm = useConfirm();
  const del = useAction(() => api(`/expenses/${id}`, { method: 'DELETE' }), 'Expense deleted');
  const toInvoice = useAction(() => api<{ id: string }>(`/expenses/${id}/convert-to-invoice`, { body: {} }), 'Draft invoice created');
  const reimburse = useAction(() => api(`/expenses/${id}/reimburse`, { body: {} }), 'Marked as reimbursed');
  const saveReceipts = useAction((receipts: Attachment[]) => api(`/expenses/${id}`, { method: 'PUT', body: { receipts } }), 'Receipts updated');
  useEffect(() => setTab('journal'), [id]);

  if (isLoading) return <Spinner />;
  if (error || !e) return <div className="p-8 text-red-600">{(error as Error)?.message || 'Expense not found'}</div>;
  const acct = (a?: string) => accounts.find((x) => x.id === a)?.name;
  const accountTags = e.isMileage ? ['Mileage'] : e.itemized ? Array.from(new Set(e.lines.map((l) => acct(l.accountId) || ''))).filter(Boolean) : [e.accountName || acct(e.accountId) || ''];

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="no-print flex h-[57px] items-center justify-between border-b border-slate-200 px-5">
        <h1 className="text-[18px] font-semibold">Expense Details</h1>
        <div className="flex items-center gap-1">
          <button className={clsx('btn-ghost w-8 px-0', tab === 'comments' && 'text-brand-700')} title="Comments" onClick={() => setTab('comments')}>
            <MessageSquare size={16} />
          </button>
          <button className="btn-ghost w-8 px-0 text-red-500 hover:text-red-600" title="Close" onClick={() => navigate('/purchases/expenses')}>
            <X size={18} />
          </button>
        </div>
      </div>
      <div className="no-print flex flex-wrap items-center border-b border-slate-200 bg-slate-50/70 px-2">
        <ToolbarBtn icon={<Pencil size={14} />} onClick={() => navigate(`/purchases/expenses/${e.id}/edit`)}>
          Edit
        </ToolbarBtn>
        {!e.isMileage && !e.itemized && (
          <ToolbarBtn icon={<Repeat size={14} />} onClick={() => setRecurring(true)} active={recurring}>
            Make Recurring
          </ToolbarBtn>
        )}
        <Dropdown button={() => <ToolbarBtn icon={<FileText size={14} />}>PDF/Print <ChevronDown size={12} /></ToolbarBtn>}>
          <MenuItem icon={<FileText size={13} />} onClick={() => window.open(`/print/expense/${e.id}`, '_blank')}>
            PDF
          </MenuItem>
          <MenuItem icon={<Printer size={13} />} onClick={() => window.open(`/print/expense/${e.id}?auto=1`, '_blank')}>
            Print
          </MenuItem>
        </Dropdown>
        {e.status === 'unbilled' && (
          <ToolbarBtn icon={<ArrowRightLeft size={14} />} onClick={() => toInvoice.mutate(undefined, { onSuccess: (inv) => navigate(`/sales/invoices/${inv.id}`) })}>
            Convert to Invoice
          </ToolbarBtn>
        )}
        <Dropdown align="left" button={() => <button className="btn-ghost h-10 rounded-none border-r border-slate-200 px-3" aria-label="More actions"><MoreHorizontal size={16} /></button>}>
          <MenuItem icon={<Copy size={13} />} onClick={() => navigate(`/purchases/expenses/new?clone=${e.id}`)}>
            Clone
          </MenuItem>
          {e.status !== 'reimbursed' && e.status !== 'invoiced' && (
            <MenuItem icon={<CheckCircle2 size={13} />} onClick={() => reimburse.mutate()}>
              Mark as Reimbursed
            </MenuItem>
          )}
          <MenuItem
            icon={<Trash2 size={13} />}
            danger
            onClick={() => confirm.ask('Delete expense', 'The expense and its journal entry will be deleted permanently. This cannot be undone.', () => del.mutate(undefined, { onSuccess: () => navigate('/purchases/expenses') }), { danger: true, label: 'Delete' })}
          >
            Delete
          </MenuItem>
          <MenuItem
            icon={<BookOpen size={13} />}
            onClick={() => {
              setTab('journal');
              document.getElementById('expense-tabs')?.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            View Journal
          </MenuItem>
        </Dropdown>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div>
            <div className="text-xs text-slate-500">Expense Amount</div>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-1.5">
              <span className="text-[26px] font-medium leading-tight text-red-500 tabular-nums">{money(e.amount)}</span>
              <span className="text-xs text-slate-500">on {fmtDate(e.date)}</span>
            </div>
            <div className="mt-1 text-[13px] font-medium uppercase tracking-wide text-slate-600">
              {e.status === 'non_billable' ? 'Non-Billable' : <Status status={e.status} className="text-[13px]" />}
            </div>
            <div className="mt-5 flex flex-wrap gap-1.5">
              {accountTags.map((t) => (
                <span key={t} className="rounded bg-sky-100 px-3 py-1 text-xs text-sky-900">
                  {t}
                </span>
              ))}
            </div>

            {e.itemized && (
              <table className="table mt-4 max-w-lg rounded-md border border-slate-200">
                <thead>
                  <tr>
                    <th>Expense Account</th>
                    <th>Notes</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {e.lines.map((l) => (
                    <tr key={l.id}>
                      <td>{acct(l.accountId)}</td>
                      <td className="text-slate-500">{l.notes}</td>
                      <td className="text-right tabular-nums">{money(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="mt-7">
              <Detail label="Paid Through">{e.paidThroughName || acct(e.paidThroughAccountId)}</Detail>
              {e.isMileage && (
                <Detail label="Distance">
                  {e.distance} km @ {money(e.ratePerKm)} per km
                </Detail>
              )}
              {e.customerId && (
                <Detail label="Customer">
                  <Link className="link" to={`/sales/customers/${e.customerId}`}>
                    {e.customerName}
                  </Link>
                </Detail>
              )}
              {e.vendorId && (
                <Detail label="Paid To">
                  <Link className="link" to={`/purchases/vendors/${e.vendorId}`}>
                    {e.vendorName}
                  </Link>
                </Detail>
              )}
              {e.invoiceNumber && <Detail label="Invoice#">{e.invoiceNumber}</Detail>}
              {e.invoice && (
                <Detail label="Invoiced In">
                  <Link className="link" to={`/sales/invoices/${e.invoice.id}`}>
                    {e.invoice.number}
                  </Link>
                </Detail>
              )}
              {e.profile && (
                <Detail label="Recurring Profile">
                  <Link className="link" to={`/purchases/recurring-expenses/${e.profile.id}`}>
                    {e.profile.profileName}
                  </Link>
                </Detail>
              )}
              {e.notes && (
                <Detail label="Notes">
                  <span className="whitespace-pre-wrap">{e.notes}</span>
                </Detail>
              )}
              {Object.keys(e.reportingTags || {}).length > 0 && (
                <Detail label="Reporting Tags">
                  <TagChips tags={e.reportingTags} />
                </Detail>
              )}
            </div>
          </div>
          <div className="no-print">
            <ReceiptDrop value={e.receipts} onChange={(receipts) => saveReceipts.mutateAsync(receipts)} className="min-h-[300px]" />
          </div>
        </div>

        <div id="expense-tabs" className="mt-8">
          <Tabs
            tabs={[
              { value: 'journal', label: 'Journal' },
              { value: 'comments', label: 'Comments' },
              { value: 'history', label: 'History' },
            ]}
            value={tab}
            onChange={setTab}
            className="no-print mb-4"
          />
          {tab === 'journal' && <ExpenseJournal e={e} />}
          {tab === 'comments' && <Comments entityType="expense" entityId={e.id} />}
          {tab === 'history' && <Timeline entityId={e.id} />}
        </div>
      </div>
      {recurring && <MakeRecurringDrawer expense={e} onClose={() => setRecurring(false)} />}
      {confirm.node}
    </div>
  );
}

export function ExpenseSplitView() {
  return (
    <div className="flex h-full">
      <ExpenseListPane />
      <ExpenseDetailPane />
    </div>
  );
}
