// Banking, Accountant (chart of accounts, manual journals) and Reports.
import { useState, type ReactNode } from 'react';
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Trash2, X, Printer, Landmark, Wallet, BarChart3 } from 'lucide-react';
import { DOC_META } from '@shared/docmeta';
import { PERIODS, fmtDate, money, today, type PeriodKey } from '@shared/format';
import type { Account, Journal, JournalLine } from '@shared/types';
import { api, qs, useAction, useApi } from '../../api';
import { useBoot, useOrg } from '../../lib/app';
import { toast } from '../../lib/toast';
import { AccountSelect, DateInput, Field, FormFooter, Modal, PageHeader, Select, Spinner, clsx, useConfirm } from '../../components/ui';
import { JournalTable } from '../../components/shared';

type AccRow = Account & { balance: number };

// ------------------------------------------------------------ banking

export function Banking() {
  const { data = [] } = useApi<AccRow[]>('/accounts');
  const [sel, setSel] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const banks = data.filter((a) => ['cash', 'bank', 'credit_card'].includes(a.subType));
  const active = sel || banks[0]?.id;
  const { data: gl } = useApi<{ accounts: { entries: { date: string; number: string; sourceType: string; sourceId?: string; reference?: string; contact?: string; debit: number; credit: number; balance: number }[]; opening: number; closing: number }[] }>(active ? `/reports/general-ledger${qs({ accountId: active, from: '1900-01-01', to: '2999-12-31' })}` : null);
  const entries = gl?.accounts[0]?.entries ?? [];
  return (
    <div>
      <PageHeader title="Banking Overview">
        <button className="btn-primary" onClick={() => setAddOpen(true)}>
          <Plus size={15} /> Add Bank or Credit Card
        </button>
      </PageHeader>
      <div className="grid gap-4 p-5 md:grid-cols-3">
        {banks.map((b) => (
          <button key={b.id} onClick={() => setSel(b.id)} className={clsx('card p-4 text-left hover:border-brand-300', active === b.id && 'border-brand-500 ring-2 ring-brand-100')}>
            <div className="flex items-center gap-2 text-slate-500">
              {b.subType === 'cash' ? <Wallet size={16} /> : <Landmark size={16} />}
              <span className="text-xs uppercase">{b.subType.replace('_', ' ')}</span>
            </div>
            <div className="mt-1 font-semibold">{b.name}</div>
            <div className="mt-2 text-lg font-semibold tabular-nums">{money(b.balance)}</div>
            <div className="text-xxs text-slate-400">Balance in Creatign Books</div>
          </button>
        ))}
      </div>
      <div className="px-5">
        <div className="mb-2 font-semibold">Transactions</div>
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Reference#</th>
              <th>Type</th>
              <th>Contact</th>
              <th className="text-right">Deposits</th>
              <th className="text-right">Withdrawals</th>
              <th className="text-right">Running Balance</th>
            </tr>
          </thead>
          <tbody>
            {entries
              .slice()
              .reverse()
              .map((e, i) => (
                <tr key={i}>
                  <td>{fmtDate(e.date)}</td>
                  <td>{e.reference || e.number}</td>
                  <td className="capitalize">{e.sourceType.replace(/_/g, ' ')}</td>
                  <td>{e.contact}</td>
                  <td className="text-right tabular-nums">{e.debit ? money(e.debit) : ''}</td>
                  <td className="text-right tabular-nums">{e.credit ? money(e.credit) : ''}</td>
                  <td className="text-right tabular-nums">{money(e.balance)}</td>
                </tr>
              ))}
            {!entries.length && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  No transactions in this account yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {addOpen && <AccountModal onClose={() => setAddOpen(false)} preset={{ type: 'asset', subType: 'bank' }} />}
    </div>
  );
}

function AccountModal({ onClose, preset, existing }: { onClose: () => void; preset?: Partial<Account>; existing?: Account }) {
  const [f, setF] = useState<Partial<Account>>(existing || { type: 'asset', subType: 'bank', ...preset });
  const SUB: Record<string, { value: Account['subType']; label: string }[]> = {
    asset: [
      { value: 'cash', label: 'Cash' },
      { value: 'bank', label: 'Bank' },
      { value: 'other_current_asset', label: 'Other Current Asset' },
      { value: 'fixed_asset', label: 'Fixed Asset' },
      { value: 'accounts_receivable', label: 'Accounts Receivable' },
    ],
    liability: [
      { value: 'credit_card', label: 'Credit Card' },
      { value: 'other_current_liability', label: 'Other Current Liability' },
      { value: 'accounts_payable', label: 'Accounts Payable' },
    ],
    equity: [{ value: 'equity', label: 'Equity' }],
    income: [
      { value: 'income', label: 'Income' },
      { value: 'other_income', label: 'Other Income' },
    ],
    expense: [
      { value: 'expense', label: 'Expense' },
      { value: 'cost_of_goods_sold', label: 'Cost Of Goods Sold' },
      { value: 'other_expense', label: 'Other Expense' },
    ],
  };
  const save = useAction(() => api(existing ? `/accounts/${existing.id}` : '/accounts', { method: existing ? 'PUT' : 'POST', body: f }), existing ? 'Account updated' : 'Account created');
  return (
    <Modal open onClose={onClose} title={existing ? 'Edit Account' : 'Create Account'} footer={<><button className="btn-primary" onClick={() => save.mutate(undefined, { onSuccess: onClose })}>Save</button><button className="btn-secondary" onClick={onClose}>Cancel</button></>}>
      <div className="space-y-3">
        <Field label="Account Type" required>
          <div className="flex gap-2">
            <Select disabled={!!existing} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as Account['type'], subType: SUB[e.target.value][0].value })} options={Object.keys(SUB).map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1) }))} />
            <Select disabled={!!existing} value={f.subType} onChange={(e) => setF({ ...f, subType: e.target.value as Account['subType'] })} options={SUB[f.type || 'asset']} />
          </div>
        </Field>
        <Field label="Account Name" required>
          <input className="input" value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
        </Field>
        <Field label="Account Code">
          <input className="input" value={f.code || ''} onChange={(e) => setF({ ...f, code: e.target.value })} />
        </Field>
        <Field label="Description">
          <textarea className="input" rows={2} value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ chart of accounts

function ChartOfAccounts() {
  const { data = [] } = useApi<AccRow[]>('/accounts');
  const [modal, setModal] = useState<Account | 'new' | null>(null);
  const confirm = useConfirm();
  const del = useAction((id: string) => api(`/accounts/${id}`, { method: 'DELETE' }), 'Account deleted');
  const navigate = useNavigate();
  return (
    <div>
      <PageHeader title="Chart of Accounts">
        <button className="btn-primary" onClick={() => setModal('new')}>
          <Plus size={15} /> New Account
        </button>
      </PageHeader>
      <table className="table">
        <thead>
          <tr>
            <th>Account Name</th>
            <th>Account Code</th>
            <th>Account Type</th>
            <th className="text-right">Balance</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.map((a) => (
            <tr key={a.id} className="row-link group" onClick={() => navigate(`/reports/general-ledger?accountId=${a.id}`)}>
              <td className="font-medium text-brand-600">
                {a.name}
                {a.system && <span className="ml-2 text-xxs text-slate-400">system</span>}
              </td>
              <td>{a.code}</td>
              <td className="capitalize">{a.subType.replace(/_/g, ' ')}</td>
              <td className="text-right tabular-nums">{money(a.balance)}</td>
              <td className="w-20 text-right">
                <span className="invisible group-hover:visible">
                  <button
                    className="link mr-2 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      setModal(a);
                    }}
                  >
                    Edit
                  </button>
                  {!a.system && (
                    <button
                      className="text-slate-400 hover:text-red-500"
                      aria-label="Delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        confirm.ask('Delete account', `Delete ${a.name}?`, () => del.mutate(a.id), { danger: true, label: 'Delete' });
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {modal && <AccountModal onClose={() => setModal(null)} existing={modal === 'new' ? undefined : modal} />}
      {confirm.node}
    </div>
  );
}

// ------------------------------------------------------------ manual journals

function JournalList() {
  const navigate = useNavigate();
  const { data = [] } = useApi<Journal[]>('/journals');
  const [manualOnly, setManualOnly] = useState(true);
  const list = manualOnly ? data.filter((j) => j.sourceType === 'manual') : data;
  return (
    <div>
      <PageHeader title="Manual Journals">
        <Select className="w-48" value={manualOnly ? 'manual' : 'all'} onChange={(e) => setManualOnly(e.target.value === 'manual')} options={[{ value: 'manual', label: 'Manual journals' }, { value: 'all', label: 'All journals (system + manual)' }]} />
        <button className="btn-primary" onClick={() => navigate('/accountant/manual-journals/new')}>
          <Plus size={15} /> New Journal
        </button>
      </PageHeader>
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Journal#</th>
            <th>Reference Number</th>
            <th>Source</th>
            <th>Notes</th>
            <th className="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {list.map((j) => (
            <tr key={j.id} className="row-link" onClick={() => navigate(`/accountant/journals/${j.id}`)}>
              <td>{fmtDate(j.date)}</td>
              <td className="text-brand-600">{j.number}</td>
              <td>{j.reference}</td>
              <td className="capitalize">{j.sourceType.replace(/_/g, ' ')}</td>
              <td className="max-w-xs truncate">{j.notes}</td>
              <td className="text-right tabular-nums">{money(j.lines.reduce((s, l) => s + l.debit, 0))}</td>
            </tr>
          ))}
          {!list.length && (
            <tr>
              <td colSpan={6} className="py-10 text-center text-slate-400">
                No manual journals yet. Use them for adjustments such as depreciation or owner contributions.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function JournalForm() {
  const navigate = useNavigate();
  const { accounts } = useBoot();
  const [search] = useSearchParams();
  const { data: projects = [] } = useApi<{ id: string; name: string; status: string }[]>('/projects?view=active');
  const [projectId, setProjectId] = useState(search.get('projectId') || '');
  const [date, setDate] = useState(today());
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Partial<JournalLine>[]>([{}, {}]);
  const dr = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const cr = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const save = useAction(() => api<Journal>('/journals', { body: { date, reference, notes, lines, projectId: projectId || undefined } }), 'Journal posted');
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader title="New Journal">
        <button className="btn-ghost w-8 px-0" onClick={() => navigate(-1)} aria-label="Close">
          <X size={18} />
        </button>
      </PageHeader>
      <div className="flex-1 space-y-4 px-5 py-5">
        <div className="max-w-2xl space-y-3">
          <Field label="Date" required>
            <DateInput className="max-w-[200px]" value={date} onChange={setDate} />
          </Field>
          <Field label="Reference#">
            <input className="input max-w-xs" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="Notes" required>
            <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Field label="Project">
            <Select className="max-w-xs" value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="Select a project" options={projects.map((p) => ({ value: p.id, label: p.name }))} />
          </Field>
        </div>
        <table className="table max-w-5xl border border-slate-200">
          <thead>
            <tr>
              <th>Account</th>
              <th>Description</th>
              <th className="w-36 text-right">Debits</th>
              <th className="w-36 text-right">Credits</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const up = (p: Partial<JournalLine>) => setLines(lines.map((x, j) => (j === i ? { ...x, ...p } : x)));
              return (
                <tr key={i}>
                  <td>
                    <AccountSelect accounts={accounts} value={l.accountId} onChange={(v) => up({ accountId: v })} />
                  </td>
                  <td>
                    <input className="input" value={l.description || ''} onChange={(e) => up({ description: e.target.value })} />
                  </td>
                  <td>
                    <input type="number" className="input text-right" value={l.debit ?? ''} onChange={(e) => up({ debit: e.target.value as unknown as number, credit: undefined })} />
                  </td>
                  <td>
                    <input type="number" className="input text-right" value={l.credit ?? ''} onChange={(e) => up({ credit: e.target.value as unknown as number, debit: undefined })} />
                  </td>
                  <td>
                    <button className="mt-2 text-slate-400 hover:text-red-500" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}
            <tr className="font-semibold">
              <td colSpan={2} className="text-right">
                Total
              </td>
              <td className="text-right">{money(dr)}</td>
              <td className="text-right">{money(cr)}</td>
              <td />
            </tr>
          </tbody>
        </table>
        <div className="flex items-center gap-4">
          <button className="btn-secondary btn-sm text-brand-700" onClick={() => setLines([...lines, {}])}>
            <Plus size={13} /> Add New Row
          </button>
          {Math.abs(dr - cr) > 0.004 && <span className="text-[13px] text-red-600">Difference: {money(dr - cr)}. Debits and credits must be equal.</span>}
        </div>
      </div>
      <FormFooter>
        <button className="btn-primary" onClick={() => save.mutate(undefined, { onSuccess: (j) => navigate(`/accountant/journals/${j.id}`) })}>
          Save and Publish
        </button>
        <button className="btn-secondary" onClick={() => navigate(-1)}>
          Cancel
        </button>
      </FormFooter>
    </div>
  );
}

const SOURCE_PATH: Record<string, string> = {
  invoice: DOC_META.invoice.path,
  write_off: DOC_META.invoice.path,
  credit_note: DOC_META.credit_note.path,
  credit_note_refund: DOC_META.credit_note.path,
  bill: DOC_META.bill.path,
  vendor_credit: DOC_META.vendor_credit.path,
  payment_received: '/sales/payments-received',
  payment_refund: '/sales/payments-received',
  payment_made: '/purchases/payments-made',
  expense: '/purchases/expenses',
  opening_balance: '/sales/customers',
};

function JournalView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: j } = useApi<Journal>(`/journals/${id}`);
  const del = useAction(() => api(`/journals/${id}`, { method: 'DELETE' }), 'Journal deleted');
  if (!j) return <Spinner />;
  return (
    <div className="max-w-4xl px-5 py-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-xs text-slate-500">{fmtDate(j.date)}</div>
          <h1 className="text-lg">Journal {j.number}</h1>
        </div>
        <div className="flex gap-2">
          {j.sourceId && SOURCE_PATH[j.sourceType] && (
            <Link className="btn-secondary" to={`${SOURCE_PATH[j.sourceType]}/${j.sourceId}`}>
              View source transaction
            </Link>
          )}
          {j.sourceType === 'manual' && (
            <button className="btn-secondary text-red-600" onClick={() => del.mutate(undefined, { onSuccess: () => navigate('/accountant/manual-journals') })}>
              <Trash2 size={14} /> Delete
            </button>
          )}
          <button className="btn-ghost w-8 px-0" onClick={() => navigate(-1)} aria-label="Close">
            <X size={18} />
          </button>
        </div>
      </div>
      {j.notes && <div className="mb-4 text-[13px] text-slate-600">{j.notes}</div>}
      <JournalTable journals={[j]} />
    </div>
  );
}

export function Accountant() {
  return (
    <Routes>
      <Route path="manual-journals" element={<JournalList />} />
      <Route path="manual-journals/new" element={<JournalForm />} />
      <Route path="journals/:id" element={<JournalView />} />
      <Route path="chart-of-accounts" element={<ChartOfAccounts />} />
      <Route path="*" element={<ChartOfAccounts />} />
    </Routes>
  );
}

// ------------------------------------------------------------ reports

const REPORTS: { group: string; items: { key: string; label: string; asOf?: boolean; noPeriod?: boolean }[] }[] = [
  { group: 'Business Overview', items: [{ key: 'profit-and-loss', label: 'Profit and Loss' }, { key: 'balance-sheet', label: 'Balance Sheet', asOf: true }] },
  { group: 'Sales', items: [{ key: 'sales-by-customer', label: 'Sales by Customer' }, { key: 'sales-by-item', label: 'Sales by Item' }] },
  { group: 'Receivables', items: [{ key: 'ar-aging', label: 'AR Aging Summary', noPeriod: true }, { key: 'customer-balances', label: 'Customer Balances', noPeriod: true }] },
  { group: 'Payables', items: [{ key: 'ap-aging', label: 'AP Aging Summary', noPeriod: true }, { key: 'vendor-balances', label: 'Vendor Balances', noPeriod: true }] },
  { group: 'Purchases and Expenses', items: [{ key: 'expenses-by-category', label: 'Expenses by Category' }] },
  { group: 'Accountant', items: [{ key: 'trial-balance', label: 'Trial Balance', asOf: true }, { key: 'general-ledger', label: 'General Ledger' }, { key: 'journal', label: 'Journal Report' }] },
];

function ReportsHome() {
  return (
    <div>
      <PageHeader title="Reports Center" />
      <div className="grid gap-6 p-5 md:grid-cols-2 xl:grid-cols-3">
        {REPORTS.map((g) => (
          <div key={g.group} className="card p-4">
            <div className="mb-2 flex items-center gap-2 font-semibold">
              <BarChart3 size={15} className="text-brand-600" /> {g.group}
            </div>
            <ul className="space-y-1">
              {g.items.map((r) => (
                <li key={r.key}>
                  <Link className="link text-[13px]" to={`/reports/${r.key}`}>
                    {r.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function ReportView() {
  const { name = '' } = useParams();
  const org = useOrg();
  const navigate = useNavigate();
  const accountId = new URLSearchParams(window.location.search).get('accountId') || undefined;
  const meta = REPORTS.flatMap((g) => g.items).find((r) => r.key === name);
  const [period, setPeriod] = useState<PeriodKey>(name === 'general-ledger' && accountId ? 'all' : 'this_fiscal_year');
  const { data } = useApi<Any>(`/reports/${name}${qs({ period, accountId })}`);
  if (!meta) return <div className="p-8">Unknown report</div>;
  const section = (title: string, rows: { name: string; amount: number }[], total?: number): ReactNode => (
    <>
      <tr className="bg-slate-50">
        <td colSpan={2} className="font-semibold">
          {title}
        </td>
      </tr>
      {rows.map((r, i) => (
        <tr key={i}>
          <td className="pl-6">{r.name}</td>
          <td className="text-right tabular-nums">{money(r.amount)}</td>
        </tr>
      ))}
      {total !== undefined && (
        <tr className="font-semibold">
          <td className="pl-6">Total for {title}</td>
          <td className="text-right tabular-nums">{money(total)}</td>
        </tr>
      )}
    </>
  );
  const sumOf = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);
  return (
    <div>
      <PageHeader title={meta.label} sub={<Link className="link" to="/reports">← Reports Center</Link>}>
        {!meta.noPeriod && <Select className="w-48" value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)} options={PERIODS} />}
        <button className="btn-secondary" onClick={() => window.print()}>
          <Printer size={14} /> Print
        </button>
      </PageHeader>
      {!data ? (
        <Spinner />
      ) : (
        <div className="print-area mx-auto my-6 max-w-4xl rounded-md border border-slate-200 bg-white p-8">
          <div className="mb-6 text-center">
            <div className="text-sm text-slate-500">{org.name}</div>
            <div className="text-lg font-semibold">{meta.label}</div>
            <div className="text-xs text-slate-500">{data.asOf ? `As of ${fmtDate(data.asOf)}` : data.from ? `From ${fmtDate(data.from)} To ${fmtDate(data.to)}` : `As of ${fmtDate(today())}`}</div>
          </div>
          <table className="table">
            {name === 'profit-and-loss' && (
              <tbody>
                {section('Operating Income', data.operatingIncome, sumOf(data.operatingIncome))}
                {section('Cost of Goods Sold', data.cogs, sumOf(data.cogs))}
                <tr className="bg-brand-50 font-semibold">
                  <td>Gross Profit</td>
                  <td className="text-right">{money(data.grossProfit)}</td>
                </tr>
                {section('Operating Expense', data.operatingExpense, sumOf(data.operatingExpense))}
                <tr className="bg-brand-50 font-semibold">
                  <td>Operating Profit</td>
                  <td className="text-right">{money(data.operatingProfit)}</td>
                </tr>
                {section('Non Operating Income', data.otherIncome, sumOf(data.otherIncome))}
                {section('Non Operating Expense', data.otherExpense, sumOf(data.otherExpense))}
                <tr className="bg-brand-100 text-base font-bold">
                  <td>Net Profit/Loss</td>
                  <td className="text-right">{money(data.netProfit)}</td>
                </tr>
              </tbody>
            )}
            {name === 'balance-sheet' && (
              <tbody>
                {section('Assets', data.assets, data.totalAssets)}
                {section('Liabilities', data.liabilities, data.totalLiabilities)}
                {section('Equities', data.equity, data.totalEquity)}
                <tr className="bg-brand-100 font-bold">
                  <td>Total Liabilities & Equities</td>
                  <td className="text-right">{money(data.totalLiabilitiesAndEquity)}</td>
                </tr>
              </tbody>
            )}
            {name === 'trial-balance' && (
              <>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th className="text-right">Net Debit</th>
                    <th className="text-right">Net Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r: Any) => (
                    <tr key={r.accountId} className="row-link" onClick={() => navigate(`/reports/general-ledger?accountId=${r.accountId}`)}>
                      <td>{r.name}</td>
                      <td className="text-right">{r.debit ? money(r.debit) : ''}</td>
                      <td className="text-right">{r.credit ? money(r.credit) : ''}</td>
                    </tr>
                  ))}
                  <tr className="font-bold">
                    <td>Total</td>
                    <td className="text-right">{money(data.totalDebit)}</td>
                    <td className="text-right">{money(data.totalCredit)}</td>
                  </tr>
                </tbody>
              </>
            )}
            {name === 'general-ledger' &&
              data.accounts.map((a: Any) => (
                <tbody key={a.accountId}>
                  <tr className="bg-slate-50">
                    <td colSpan={4} className="font-semibold">
                      {a.name} <span className="text-xs font-normal text-slate-500">Opening {money(a.opening)}</span>
                    </td>
                    <td className="text-right font-semibold">{money(a.closing)}</td>
                  </tr>
                  {a.entries.map((e: Any, i: number) => (
                    <tr key={i}>
                      <td>{fmtDate(e.date)}</td>
                      <td>
                        <Link className="link" to={`/accountant/journals/${e.journalId}`}>
                          {e.number}
                        </Link>{' '}
                        <span className="text-xs capitalize text-slate-500">{e.sourceType.replace(/_/g, ' ')}</span>
                      </td>
                      <td>{e.contact}</td>
                      <td className="text-right">{e.debit ? `Dr ${money(e.debit)}` : `Cr ${money(e.credit)}`}</td>
                      <td className="text-right">{money(e.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
            {name === 'journal' && (
              <tbody>
                {data.journals.map((j: Journal) => (
                  <tr key={j.id}>
                    <td colSpan={2}>
                      <JournalTable journals={[j]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            )}
            {(name === 'ar-aging' || name === 'ap-aging') && (
              <>
                <thead>
                  <tr>
                    <th>{name === 'ar-aging' ? 'Customer' : 'Vendor'}</th>
                    <th className="text-right">Current</th>
                    <th className="text-right">1-15 Days</th>
                    <th className="text-right">16-30 Days</th>
                    <th className="text-right">31-45 Days</th>
                    <th className="text-right">&gt; 45 Days</th>
                    <th className="text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.rows, { name: 'Total', ...data.totals, bold: true }].map((r: Any, i: number) => (
                    <tr key={i} className={clsx(r.bold && 'font-bold')}>
                      <td>{r.name}</td>
                      <td className="text-right">{money(r.buckets.current)}</td>
                      <td className="text-right">{money(r.buckets.d1_15)}</td>
                      <td className="text-right">{money(r.buckets.d16_30)}</td>
                      <td className="text-right">{money(r.buckets.d31_45)}</td>
                      <td className="text-right">{money(r.buckets.d45_plus)}</td>
                      <td className="text-right">{money(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
            {(name === 'customer-balances' || name === 'vendor-balances') && (
              <>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th className="text-right">Balance</th>
                    <th className="text-right">Unused Credits</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r: Any) => (
                    <tr key={r.contactId}>
                      <td>{r.name}</td>
                      <td className="text-right">{money(r.outstanding)}</td>
                      <td className="text-right">{money(r.unusedCredits)}</td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
            {name === 'sales-by-customer' && (
              <>
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th className="text-right">Invoice Count</th>
                    <th className="text-right">Sales</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r: Any) => (
                    <tr key={r.contactId}>
                      <td>{r.name}</td>
                      <td className="text-right">{r.count}</td>
                      <td className="text-right">{money(r.sales)}</td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
            {name === 'sales-by-item' && (
              <>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="text-right">Quantity Sold</th>
                    <th className="text-right">Amount</th>
                    <th className="text-right">Average Price</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r: Any) => (
                    <tr key={r.item}>
                      <td>{r.item}</td>
                      <td className="text-right">{r.quantity}</td>
                      <td className="text-right">{money(r.amount)}</td>
                      <td className="text-right">{money(r.average)}</td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
            {name === 'expenses-by-category' && (
              <>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r: Any) => (
                    <tr key={r.account}>
                      <td>{r.account}</td>
                      <td className="text-right">{money(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
          </table>
          {Array.isArray(data.rows) && !data.rows.length && <div className="py-6 text-center text-slate-400">There is no data for this period.</div>}
        </div>
      )}
    </div>
  );
}

export function Reports() {
  return (
    <Routes>
      <Route index element={<ReportsHome />} />
      <Route path=":name" element={<ReportView />} />
    </Routes>
  );
}

export { toast };
