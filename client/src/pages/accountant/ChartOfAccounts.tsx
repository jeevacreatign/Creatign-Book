// Accountant > Chart of Accounts: list with views, lock icon on system accounts, sub-accounts,
// bulk actions, Create Account modal with the full type list, and the account split view.
import { useMemo, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { Info, Lock, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { ACCOUNT_TYPES, accountTypeLabel } from '@shared/accountant';
import { fmtDate, money } from '@shared/format';
import type { Account } from '@shared/types';
import { api, useAction, useApi } from '../../api';
import { toast } from '../../lib/toast';
import { Checkbox, Field, MenuItem, Modal, Spinner, clsx, useConfirm } from '../../components/ui';
import { DetailHeader, ListHeader, MoreMenu, SplitList, Toolbar, ToolbarBtn, ToolbarMore, ViewPicker, csvOf, downloadText, useSelection } from '../../components/split';
import { ExportMenu } from '../../components/ExportMenu';
import { downloadRows } from '../../lib/export';
import { AccountTypeSelect } from './common';

type ARow = Account & { balance: number; parentName?: string; documents: number };
type ADetail = ARow & { closingBalance: number; side: 'Dr' | 'Cr'; inUse: boolean; recent: { date: string; journalId: string; sourceType: string; sourceId?: string; type: string; details: string; debit: number; credit: number }[] };

const ACCOUNT_EXPORT_COLUMNS = [
  { header: 'Account Name', value: (a: ARow) => a.name },
  { header: 'Account Code', value: (a: ARow) => a.code },
  { header: 'Account Type', value: (a: ARow) => accountTypeLabel(a.subType) },
  { header: 'Parent Account', value: (a: ARow) => a.parentName },
  { header: 'Description', value: (a: ARow) => a.description },
  { header: 'Status', value: (a: ARow) => a.active ? 'Active' : 'Inactive' },
  { header: 'Balance', value: (a: ARow) => a.balance },
];

const BASE = '/accountant/chart-of-accounts';
const VIEWS = [
  { value: 'active', label: 'Active Accounts' },
  { value: 'inactive', label: 'Inactive Accounts' },
  { value: 'all', label: 'All Accounts' },
  { value: 'asset', label: 'Asset Accounts' },
  { value: 'liability', label: 'Liability Accounts' },
  { value: 'equity', label: 'Equity Accounts' },
  { value: 'income', label: 'Income Accounts' },
  { value: 'expense', label: 'Expense Accounts' },
];

function useAccountsView(view: string, q: string) {
  const { data = [], isLoading } = useApi<ARow[]>('/accounts');
  const rows = useMemo(() => {
    const filtered = data.filter((a) => (view === 'active' ? a.active : view === 'inactive' ? !a.active : view === 'all' ? true : a.type === view) && (!q || `${a.name} ${a.code}`.toLowerCase().includes(q.toLowerCase())));
    // parents first, sub-accounts indented right under them
    const order = ACCOUNT_TYPES.map((t) => t.subType);
    const byType = (a: ARow, b: ARow) => order.indexOf(a.subType) - order.indexOf(b.subType) || a.name.localeCompare(b.name);
    const top = filtered.filter((a) => !a.parentId || !filtered.some((p) => p.id === a.parentId)).sort(byType);
    const out: (ARow & { depth: number })[] = [];
    const walk = (a: ARow, depth: number) => {
      out.push({ ...a, depth });
      filtered.filter((c) => c.parentId === a.id).sort(byType).forEach((c) => walk(c, depth + 1));
    };
    top.forEach((a) => walk(a, 0));
    return out;
  }, [data, view, q]);
  return { rows, isLoading, all: data };
}

function AccountList() {
  const navigate = useNavigate();
  const [view, setView] = useState('active');
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(false);
  const { rows, isLoading } = useAccountsView(view, q);
  const sel = useSelection(rows.filter((a) => !a.system).map((a) => a.id));
  const confirm = useConfirm();
  const bulk = useAction((b: { ids: string[]; action: string }) => api<{ errors: string[] }>('/accounts/bulk', { body: b }), (r) => (r.errors.length ? undefined : 'Accounts updated'));
  const runBulk = (action: string) => bulk.mutate({ ids: sel.selected, action }, { onSuccess: (r) => { r.errors.forEach((e) => toast.error(e)); sel.clear(); } });
  return (
    <div>
      <ListHeader title={<ViewPicker value={view} onChange={(v) => { setView(v); sel.clear(); }} options={VIEWS} />}>
        <div className="relative">
          <Search size={14} className="absolute left-2 top-2.5 text-slate-400" />
          <input className="input w-56 pl-7" placeholder="Search accounts" value={q} onChange={(e) => { setQ(e.target.value); sel.clear(); }} />
        </div>
        <button className="btn-primary" onClick={() => setModal(true)}>
          <Plus size={15} /> New
        </button>
        <MoreMenu>
          <MenuItem onClick={() => downloadText('chart-of-accounts.csv', csvOf([['Account Name', 'Account Code', 'Account Type', 'Parent Account', 'Description', 'Status', 'Balance'], ...rows.map((a) => [a.name, a.code, accountTypeLabel(a.subType), a.parentName, a.description, a.active ? 'Active' : 'Inactive', a.balance])]))}>Export Accounts (CSV)</MenuItem>
          <MenuItem onClick={() => downloadRows('chart-of-accounts', rows, ACCOUNT_EXPORT_COLUMNS, 'xlsx')}>Export Accounts (Excel)</MenuItem>
        </MoreMenu>
      </ListHeader>
      {sel.selected.length > 0 && (
        <div className="flex items-center gap-2 border-b border-slate-100 bg-brand-50/40 px-5 py-2 text-[13px]">
          <span className="mr-2 text-slate-600">{sel.selected.length} selected</span>
          <ExportMenu rows={rows.filter((a) => sel.selected.includes(a.id))} filename="chart-of-accounts" columns={ACCOUNT_EXPORT_COLUMNS} label="Export Selected" />
          <button className="btn-secondary btn-sm" onClick={() => runBulk('activate')}>
            Mark as Active
          </button>
          <button className="btn-secondary btn-sm" onClick={() => runBulk('deactivate')}>
            Mark as Inactive
          </button>
          <button className="btn-secondary btn-sm text-red-600" onClick={() => confirm.ask('Delete accounts', 'Accounts with transactions cannot be deleted and will be skipped.', () => runBulk('delete'), { danger: true, label: 'Delete' })}>
            <Trash2 size={13} /> Delete
          </button>
        </div>
      )}
      {isLoading ? (
        <Spinner />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th className="w-10 pl-5">
                <input type="checkbox" className="accent-brand-600" checked={sel.all} onChange={sel.toggleAll} aria-label="Select all" />
              </th>
              <th>Account Name</th>
              <th>Account Code</th>
              <th>Account Type</th>
              <th>Documents</th>
              <th>Parent Account Name</th>
              <th className="pr-5 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className={clsx('row-link', !a.active && 'opacity-60')} onClick={() => navigate(`${BASE}/${a.id}`)}>
                <td className="pl-5" onClick={(e) => e.stopPropagation()}>
                  {a.system ? <Lock size={13} className="text-slate-400" aria-label="System account" /> : <input type="checkbox" className="accent-brand-600" checked={sel.selected.includes(a.id)} onChange={() => sel.toggle(a.id)} aria-label={`Select ${a.name}`} />}
                </td>
                <td className="font-medium text-brand-600" style={{ paddingLeft: 12 + a.depth * 20 }}>
                  {a.depth > 0 && <span className="mr-1 text-slate-300">└</span>}
                  {a.name}
                  {!a.active && <span className="ml-2 text-[11px] font-normal text-slate-400">Inactive</span>}
                </td>
                <td>{a.code}</td>
                <td>{accountTypeLabel(a.subType)}</td>
                <td>{a.documents || ''}</td>
                <td>{a.parentName}</td>
                <td className="pr-5 text-right tabular-nums">{money(a.balance)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-400">
                  No accounts in this view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {modal && <AccountModal onClose={() => setModal(false)} onSaved={(id) => navigate(`${BASE}/${id}`)} />}
      {confirm.node}
    </div>
  );
}

export function AccountModal({ onClose, existing, onSaved, preset }: { onClose: () => void; existing?: Account; onSaved?: (id: string) => void; preset?: Partial<Account> }) {
  const { data: all = [] } = useApi<ARow[]>('/accounts');
  const [f, setF] = useState<Partial<Account>>(existing ?? { subType: 'other_asset', ...preset });
  const [sub, setSub] = useState(!!existing?.parentId);
  const info = ACCOUNT_TYPES.find((t) => t.subType === f.subType);
  const parents = all.filter((a) => a.id !== existing?.id && a.type === info?.type && a.active);
  const save = useAction(() => api<Account>(existing ? `/accounts/${existing.id}` : '/accounts', { method: existing ? 'PUT' : 'POST', body: { ...f, parentId: sub ? f.parentId || '' : '' } }), existing ? 'Account updated' : 'Account created');
  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-3xl"
      title={existing ? 'Edit Account' : 'Create Account'}
      footer={
        <>
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: (a) => { onClose(); onSaved?.(a.id); } })}>
            Save
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_240px]">
        <div className="space-y-3">
          <Field label="Account Type" required>
            <AccountTypeSelect value={f.subType} disabled={existing?.system} onChange={(v) => setF({ ...f, subType: v, parentId: undefined })} />
          </Field>
          <Field label="Account Name" required>
            <input className="input" autoFocus value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <div className="pl-[150px]">
            <Checkbox checked={sub} onChange={setSub} label="Make this a sub-account" />
          </div>
          {sub && (
            <Field label="Parent Account" required>
              <select className="input" value={f.parentId || ''} onChange={(e) => setF({ ...f, parentId: e.target.value })}>
                <option value="">Select an account</option>
                {parents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Account Code">
            <input className="input max-w-[200px]" value={f.code || ''} onChange={(e) => setF({ ...f, code: e.target.value })} />
          </Field>
          <Field label="Description">
            <textarea className="input" rows={3} maxLength={500} placeholder="Max. 500 characters" value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </Field>
          <div className="pl-[150px]">
            <Checkbox checked={!!f.watchlist} onChange={(v) => setF({ ...f, watchlist: v })} label="Add to the watchlist on my dashboard" />
          </div>
        </div>
        {info && (
          <div className="h-fit rounded-lg bg-slate-800 p-4 text-[13px] text-white shadow">
            <div className="mb-1 flex items-center gap-1.5 font-semibold">
              <Info size={13} /> {info.group}
            </div>
            <div className="font-medium text-slate-200">{info.label}</div>
            <p className="mt-1 text-slate-300">{info.hint}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

function AccountPane() {
  const { id } = useParams();
  const [view, setView] = useState('active');
  const { rows } = useAccountsView(view, '');
  const [modal, setModal] = useState(false);
  const navigate = useNavigate();
  return (
    <SplitList
      header={
        <>
          <ViewPicker compact value={view} onChange={setView} options={VIEWS} />
          <button className="btn-primary w-8 px-0" onClick={() => setModal(true)} aria-label="New account">
            <Plus size={15} />
          </button>
        </>
      }
    >
      {rows.map((a) => (
        <Link key={a.id} to={`${BASE}/${a.id}`} className={clsx('flex items-start gap-2 border-b border-slate-100 px-3 py-3 hover:bg-slate-50', a.id === id && 'bg-brand-50/70')}>
          <span className="mt-0.5 w-4 shrink-0 text-slate-300">{a.system && <Lock size={12} />}</span>
          <span className="min-w-0">
            <span className="block truncate font-medium text-slate-800">{a.name}</span>
            <span className="block text-xs text-slate-500">{accountTypeLabel(a.subType)}</span>
          </span>
        </Link>
      ))}
      {modal && <AccountModal onClose={() => setModal(false)} onSaved={(nid) => navigate(`${BASE}/${nid}`)} />}
    </SplitList>
  );
}

const SOURCE_PATH: Record<string, string> = {
  invoice: '/sales/invoices',
  write_off: '/sales/invoices',
  credit_note: '/sales/credit-notes',
  credit_note_refund: '/sales/credit-notes',
  bill: '/purchases/bills',
  vendor_credit: '/purchases/vendor-credits',
  payment_received: '/sales/payments-received',
  payment_refund: '/sales/payments-received',
  payment_made: '/purchases/payments-made',
  expense: '/purchases/expenses',
  manual: '/accountant/manual-journals',
};

export function sourceLink(sourceType: string, sourceId: string | undefined, journalId: string) {
  if (sourceType === 'manual') return `/accountant/manual-journals/${journalId}`;
  if (sourceId && SOURCE_PATH[sourceType]) return `${SOURCE_PATH[sourceType]}/${sourceId}`;
  return `/accountant/journals/${journalId}`;
}

function AccountDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: a, isLoading } = useApi<ADetail>(`/accounts/${id}`);
  const [edit, setEdit] = useState(false);
  const confirm = useConfirm();
  const del = useAction(() => api(`/accounts/${id}`, { method: 'DELETE' }), 'Account deleted');
  const toggle = useAction(() => api(`/accounts/${id}`, { method: 'PUT', body: { active: !a?.active } }), a?.active ? 'Account marked as inactive' : 'Account marked as active');
  if (isLoading || !a) return <Spinner />;
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <DetailHeader kicker={accountTypeLabel(a.subType)} title={a.name}>
        <button className="btn-ghost w-8 px-0 text-red-500" title="Close" onClick={() => navigate(BASE)}>
          <X size={18} />
        </button>
      </DetailHeader>
      <Toolbar>
        <ToolbarBtn icon={<Pencil size={14} />} onClick={() => setEdit(true)}>
          Edit
        </ToolbarBtn>
        {!a.system && (
          <ToolbarMore>
            <MenuItem onClick={() => toggle.mutate()}>{a.active ? 'Mark as Inactive' : 'Mark as Active'}</MenuItem>
            <MenuItem danger icon={<Trash2 size={13} />} disabled={a.inUse} onClick={() => confirm.ask('Delete account', `Delete ${a.name}?`, () => del.mutate(undefined, { onSuccess: () => navigate(BASE) }), { danger: true, label: 'Delete' })}>
              Delete
            </MenuItem>
          </ToolbarMore>
        )}
      </Toolbar>
      <div className="flex-1 overflow-y-auto">
        <div className="border-b border-dashed border-slate-300 bg-slate-50/70 px-5 py-5">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Closing Balance</div>
          <div className="mt-1 text-[26px] font-semibold text-brand-600 tabular-nums">
            {money(a.closingBalance)} <span className="text-base font-normal">({a.side})</span>
          </div>
          {a.description && (
            <p className="mt-2 text-[13px]">
              <span className="italic text-slate-600">Description :</span> {a.description}
            </p>
          )}
          {a.parentName && <p className="mt-1 text-[13px] text-slate-600">Sub-account of {a.parentName}</p>}
          {a.system && <p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><Lock size={11} /> System account: it can be renamed but not deleted.</p>}
        </div>
        <div className="px-5 py-5">
          <div className="mb-3 text-[17px] font-semibold">Recent Transactions</div>
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Transaction Details</th>
                <th>Type</th>
                <th className="text-right">Debit</th>
                <th className="text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {a.recent.map((r, i) => (
                <tr key={i} className="row-link" onClick={() => navigate(sourceLink(r.sourceType, r.sourceId, r.journalId))}>
                  <td>{fmtDate(r.date)}</td>
                  <td>{r.details}</td>
                  <td>{r.type}</td>
                  <td className="text-right tabular-nums">{r.debit ? money(r.debit) : ''}</td>
                  <td className="text-right tabular-nums">{r.credit ? money(r.credit) : ''}</td>
                </tr>
              ))}
              {!a.recent.length && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">
                    There are no transactions in this account yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <Link className="link mt-3 inline-block text-[13px] underline" to={`/reports/account-transactions?accountId=${a.id}&period=all`}>
            Show more details
          </Link>
        </div>
      </div>
      {edit && <AccountModal existing={a} onClose={() => setEdit(false)} />}
      {confirm.node}
    </div>
  );
}

export default function ChartOfAccounts() {
  return (
    <Routes>
      <Route index element={<AccountList />} />
      <Route
        path=":id"
        element={
          <div className="flex h-full">
            <AccountPane />
            <AccountDetail />
          </div>
        }
      />
    </Routes>
  );
}
