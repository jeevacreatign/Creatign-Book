// Accountant tools: Batch Reclassify, Base FX Revaluations, Period Close.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Lock, LockOpen, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { LOCK_MODULES } from '@shared/accountant';
import { PERIODS, fmtDate, fmtDateTime, money, today, type PeriodKey } from '@shared/format';
import type { Currency, CurrencyAdjustment, LockModule, TransactionLocks } from '@shared/types';
import { api, qs, useAction, useApi } from '../../api';
import { useBoot } from '../../lib/app';
import { AccountSelect, DateInput, Dropdown, Field, MenuItem, Modal, Spinner, clsx, useConfirm } from '../../components/ui';
import { ListHeader, useSelection } from '../../components/split';
import { AnyContactPicker } from './common';

// ------------------------------------------------------------ bulk update

type BulkFilter = { accountId: string; contactId?: string; from?: string; to?: string; minAmount?: string; maxAmount?: string };
type BulkRow = { type: string; kind: string; id: string; number: string; date: string; contact?: string; total: number; lines: number; amount: number };

export function BulkUpdate() {
  const { accounts } = useBoot();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<BulkFilter | null>(null);
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [newAccount, setNewAccount] = useState('');
  const sel = useSelection(rows.map((r) => r.id));
  const search = useAction((f: BulkFilter) => api<BulkRow[]>('/bulk-update/search', { body: f }));
  const update = useAction(() => api<{ updated: number }>('/bulk-update', { body: { ...filter, newAccountId: newAccount, ids: sel.selected } }), (r) => `${r.updated} transaction(s) updated`);
  const confirm = useConfirm();
  const run = (f: BulkFilter) =>
    search.mutate(f, {
      onSuccess: (r) => {
        setFilter(f);
        setRows(r);
        setOpen(false);
      },
    });
  const acctName = (id?: string) => accounts.find((a) => a.id === id)?.name;
  if (!filter)
    return (
      <div className="flex flex-col items-center px-6 py-20 text-center">
        <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-orange-300 text-white shadow-lg">
          <ShieldCheck size={36} />
        </div>
        <h1 className="text-[20px] font-medium">Batch Reclassify Transactions</h1>
        <p className="mt-1 text-[13px] text-slate-600">Filter transactions (Invoices, Credit Notes, Purchase Orders, Expenses, Bills, Debit Notes) and bulk-update its accounts with a new account</p>
        <div className="mt-5 flex max-w-lg items-start gap-3 rounded-lg bg-orange-50 px-4 py-3 text-left text-[13px] text-slate-700">
          <AlertCircle size={20} className="shrink-0 text-amber-500" />
          Bulk-updating accounts in transactions will cause significant changes to the financial data of your business. We recommend that you do this with the assistance of an accountant.
        </div>
        <button className="btn-primary mt-6" onClick={() => setOpen(true)}>
          Filter and Batch Reclassify
        </button>
        {open && <BulkFilterModal initial={filter ?? undefined} busy={search.isPending} onClose={() => setOpen(false)} onSearch={run} />}
      </div>
    );
  return (
    <div className="px-5 py-4">
      <h1 className="mb-3 text-[20px] font-medium">Batch Reclassify Transactions</h1>
      <div className="mb-5 max-w-4xl rounded-lg bg-emerald-50/70 px-4 py-3 text-[13px]">
        <div className="mb-1 text-xs font-medium italic text-emerald-700">Filtered based on</div>
        <ul className="list-inside list-disc space-y-0.5 text-slate-700">
          <li>
            Account Name: <b>{acctName(filter.accountId)}</b>
          </li>
          {filter.contactId && <li>Contact: <b>{rows[0]?.contact ?? filter.contactId}</b></li>}
          {filter.from && <li>Start Date: <b>{fmtDate(filter.from)}</b></li>}
          {filter.to && <li>End Date: <b>{fmtDate(filter.to)}</b></li>}
          {(filter.minAmount || filter.maxAmount) && <li>Total Amount Range {filter.minAmount || 0} - {filter.maxAmount || '∞'}</li>}
        </ul>
        <button className="link mt-2 text-[13px]" onClick={() => setOpen(true)}>
          Change Filter Criteria →
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="py-10 text-center text-[13px] text-slate-500">No transactions (Invoices, Credit Notes, Purchase Orders, Expenses, Bills, Debit Notes) Available. Please change the filter criteria and try again.</div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <span className="text-[13px] text-slate-600">{sel.selected.length} of {rows.length} selected. Move to</span>
            <AccountSelect className="w-64" accounts={accounts} value={newAccount} onChange={setNewAccount} filter={(a) => a.id !== filter.accountId} placeholder="Select the new account" />
            <button
              className="btn-primary"
              disabled={!sel.selected.length || !newAccount}
              onClick={() => confirm.ask('Update accounts', `Change ${acctName(filter.accountId)} to ${acctName(newAccount)} on ${sel.selected.length} transaction(s)?`, () => update.mutate(undefined, { onSuccess: () => { sel.clear(); run(filter); } }), { label: 'Update' })}
            >
              Update Accounts
            </button>
          </div>
          <table className="table rounded-md border border-slate-200">
            <thead>
              <tr>
                <th className="w-10">
                  <input type="checkbox" className="accent-brand-600" checked={sel.all} onChange={sel.toggleAll} aria-label="Select all" />
                </th>
                <th>Date</th>
                <th>Transaction</th>
                <th>Number</th>
                <th>Contact</th>
                <th className="text-right">Lines</th>
                <th className="text-right">Amount in Account</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <input type="checkbox" className="accent-brand-600" checked={sel.selected.includes(r.id)} onChange={() => sel.toggle(r.id)} aria-label={`Select ${r.number}`} />
                  </td>
                  <td>{fmtDate(r.date)}</td>
                  <td>{r.type}</td>
                  <td className="text-brand-600">{r.number}</td>
                  <td>{r.contact}</td>
                  <td className="text-right">{r.lines}</td>
                  <td className="text-right tabular-nums">{money(r.amount)}</td>
                  <td className="text-right tabular-nums">{money(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {open && <BulkFilterModal initial={filter} busy={search.isPending} onClose={() => setOpen(false)} onSearch={run} />}
      {confirm.node}
    </div>
  );
}

function BulkFilterModal({ initial, onClose, onSearch, busy }: { initial?: BulkFilter; onClose: () => void; onSearch: (f: BulkFilter) => void; busy: boolean }) {
  const { accounts } = useBoot();
  const [f, setF] = useState<BulkFilter>(initial ?? { accountId: '' });
  return (
    <Modal
      open
      width="max-w-2xl"
      onClose={onClose}
      title="Filter Transactions"
      footer={
        <>
          <button className="btn-primary" disabled={!f.accountId || busy} onClick={() => onSearch(f)}>
            Search
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <p className="mb-4 text-[13px] text-slate-600">Select an account and enter your ranges to filter your transaction</p>
      <div className="space-y-3">
        <Field label="Account" required>
          <AccountSelect accounts={accounts} value={f.accountId} onChange={(v) => setF({ ...f, accountId: v })} />
        </Field>
        <Field label="Contact">
          <AnyContactPicker value={f.contactId} onChange={(v) => setF({ ...f, contactId: v || undefined })} />
        </Field>
        <Field label="Date Range">
          <div className="flex items-center gap-3">
            <DateInput value={f.from} onChange={(v) => setF({ ...f, from: v })} />
            <span>-</span>
            <DateInput value={f.to} onChange={(v) => setF({ ...f, to: v })} />
          </div>
        </Field>
        <Field label="Total Amount Range">
          <div className="flex items-center gap-3">
            <input className="input" inputMode="decimal" value={f.minAmount ?? ''} onChange={(e) => setF({ ...f, minAmount: e.target.value })} />
            <span>-</span>
            <input className="input" inputMode="decimal" value={f.maxAmount ?? ''} onChange={(e) => setF({ ...f, maxAmount: e.target.value })} />
          </div>
        </Field>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ currency adjustments

export function CurrencyAdjustments() {
  const [period, setPeriod] = useState<PeriodKey>('this_month');
  const { data = [], isLoading } = useApi<CurrencyAdjustment[]>(`/currency-adjustments${qs({ period })}`);
  const { data: currencies = [] } = useApi<Currency[]>('/currencies');
  const [open, setOpen] = useState(false);
  const del = useAction((id: string) => api(`/currency-adjustments/${id}`, { method: 'DELETE' }), 'Adjustment deleted');
  const sel = useSelection(data.map((a) => a.id));
  return (
    <div>
      <ListHeader title={<h1 className="text-[19px]">FX Revaluations</h1>}>
        <button className="btn-primary" onClick={() => setOpen(true)} title="Make an Adjustment">
          <Plus size={15} /> New
        </button>
      </ListHeader>
      <div className="border-b border-slate-100 px-5 py-2.5">
        <Dropdown button={() => <button className="rounded-md border border-slate-200 px-2.5 py-1 text-[12px] text-slate-600">Filter By: <b className="text-slate-800">{PERIODS.find((p) => p.value === period)?.label}</b> ▾</button>}>
          {PERIODS.map((p) => (
            <MenuItem key={p.value} onClick={() => setPeriod(p.value)}>
              {p.label}
            </MenuItem>
          ))}
        </Dropdown>
      </div>
      {isLoading ? (
        <Spinner />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th className="w-10 pl-5">
                <input type="checkbox" className="accent-brand-600" checked={sel.all} onChange={sel.toggleAll} aria-label="Select all" />
              </th>
              <th>Date</th>
              <th>Currency</th>
              <th>Exchange Rate</th>
              <th className="text-right">Gain or Loss</th>
              <th>Notes</th>
              <th className="pr-5" />
            </tr>
          </thead>
          <tbody>
            {data.map((a) => (
              <tr key={a.id} className="group">
                <td className="pl-5">
                  <input type="checkbox" className="accent-brand-600" checked={sel.selected.includes(a.id)} onChange={() => sel.toggle(a.id)} />
                </td>
                <td>{fmtDate(a.date)}</td>
                <td>{a.currencyCode}</td>
                <td>
                  1 {a.currencyCode} = {a.rate} INR
                </td>
                <td className="text-right tabular-nums">{money(a.gainOrLoss)}</td>
                <td className="max-w-sm truncate">{a.notes}</td>
                <td className="pr-5 text-right">
                  <button className="invisible text-slate-400 hover:text-red-500 group-hover:visible" onClick={() => del.mutate(a.id)} aria-label="Delete">
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
            {!data.length && (
              <tr>
                <td colSpan={7} className="py-10 text-center text-slate-500">
                  Record a Base FX Revaluation to correct fluctuations in exchange rates
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      <div className="mx-5 mt-6 max-w-3xl rounded-lg border border-slate-200 p-4">
        <div className="mb-2 font-semibold">Exchange rates</div>
        <table className="table">
          <thead>
            <tr>
              <th>Currency</th>
              <th>Symbol</th>
              <th className="text-right">Rate (INR per unit)</th>
            </tr>
          </thead>
          <tbody>
            {currencies.map((c) => (
              <tr key={c.code}>
                <td>
                  {c.code} - {c.name} {c.code === 'INR' && <span className="ml-1 rounded bg-emerald-600 px-1 text-[10px] text-white">BASE</span>}
                </td>
                <td>{c.symbol}</td>
                <td className="text-right tabular-nums">{c.rate}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500">Every transaction in Creatign Ledger is recorded in INR, so adjustments revalue no open balances and the gain or loss is 0.</p>
      </div>
      {open && <AdjustmentModal currencies={currencies.filter((c) => c.code !== 'INR')} onClose={() => setOpen(false)} />}
    </div>
  );
}

function AdjustmentModal({ currencies, onClose }: { currencies: Currency[]; onClose: () => void }) {
  const [f, setF] = useState({ currencyCode: currencies[0]?.code ?? '', date: today(), rate: String(currencies[0]?.rate ?? ''), notes: '' });
  const save = useAction(() => api('/currency-adjustments', { body: { ...f, rate: Number(f.rate) } }), 'Adjustment recorded');
  return (
    <Modal
      open
      onClose={onClose}
      title="Base FX Revaluation"
      footer={
        <>
          <button className="btn-primary" onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            Continue
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field inline={false} label="Currency" required>
          <select className="input" value={f.currencyCode} onChange={(e) => setF({ ...f, currencyCode: e.target.value, rate: String(currencies.find((c) => c.code === e.target.value)?.rate ?? '') })}>
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}- {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field inline={false} label="Date of Adjustment" required>
          <DateInput value={f.date} onChange={(v) => setF({ ...f, date: v })} />
        </Field>
        <Field inline={false} label="Exchange Rate" required>
          <div className="flex">
            <span className="flex items-center rounded-l-md border border-r-0 border-slate-300 bg-slate-50 px-2.5 text-[13px]">1 {f.currencyCode} =</span>
            <input className="input rounded-none" inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
            <span className="flex items-center rounded-r-md border border-l-0 border-slate-300 bg-slate-50 px-2.5 text-[13px]">INR</span>
          </div>
        </Field>
        <Field inline={false} label="Notes" required>
          <textarea className="input" rows={3} maxLength={500} placeholder="Max. 500 characters" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ transaction locking

export function TransactionLocking() {
  const { data, isLoading } = useApi<TransactionLocks>('/transaction-locks');
  const [modal, setModal] = useState<{ module: LockModule | 'all'; mode: 'lock' | 'unlock' } | null>(null);
  if (isLoading || !data) return <Spinner />;
  const all = data.all;
  return (
    <div className="pb-24">
      <ListHeader title={<h1 className="text-[19px]">Period Close</h1>} />
      <div className="max-w-4xl px-5 py-4">
        <p className="mb-4 text-[13px] text-slate-600">Transaction locking prevents you and your users from making any changes to transactions that might affect your accounts. Once transactions are locked, users cannot edit, modify, or delete any transactions that were recorded before the specified date in this module.</p>
        {all ? (
          <LockCard title="All Transactions" hint="Every module is locked at once." lock={all} onLock={() => setModal({ module: 'all', mode: 'lock' })} onUnlock={() => setModal({ module: 'all', mode: 'unlock' })} />
        ) : (
          <div className="space-y-3">
            {LOCK_MODULES.map((m) => (
              <LockCard key={m.value} title={m.label} hint={m.hint} lock={data.modules[m.value]} onLock={() => setModal({ module: m.value, mode: 'lock' })} onUnlock={() => setModal({ module: m.value, mode: 'unlock' })} />
            ))}
          </div>
        )}
        {!!data.history.length && (
          <div className="mt-8">
            <div className="mb-2 text-[13px] font-semibold text-slate-700">History</div>
            <div className="rounded-md border border-slate-200">
              {data.history
                .slice()
                .reverse()
                .slice(0, 15)
                .map((h, i) => (
                  <div key={i} className="flex gap-4 border-b border-slate-100 px-4 py-2 text-[13px] last:border-0">
                    <span className="w-40 shrink-0 text-slate-500">{fmtDateTime(h.at)}</span>
                    <span>
                      {h.module === 'all' ? 'All transactions' : LOCK_MODULES.find((m) => m.value === h.module)?.label} {h.action === 'lock' ? `locked up to ${fmtDate(h.date)}` : 'unlocked'}
                      {h.reason && <span className="text-slate-500"> · {h.reason}</span>}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
      <div className="fixed bottom-0 left-[220px] right-0 flex items-center justify-between border-t border-orange-100 bg-orange-50 px-6 py-3">
        <div>
          <div className="font-semibold">{all ? 'Locking modules individually' : 'Lock All Transactions At Once'}</div>
          <div className="text-[13px] text-slate-600">{all ? 'Unlock all transactions to set a separate lock date for each module.' : 'You can freeze all transactions at once instead of locking the Sales, Purchases, Banking and Account transactions individually.'}</div>
        </div>
        {!all && (
          <button className="link text-[13px]" onClick={() => setModal({ module: 'all', mode: 'lock' })}>
            Switch to Lock All Transactions →
          </button>
        )}
      </div>
      {modal && <LockModal {...modal} current={modal.module === 'all' ? all : data.modules[modal.module]} onClose={() => setModal(null)} />}
    </div>
  );
}

function LockCard({ title, hint, lock, onLock, onUnlock }: { title: string; hint: string; lock?: { date: string; reason?: string }; onLock: () => void; onUnlock: () => void }) {
  return (
    <div className="flex items-start gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className={clsx('flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border', lock ? 'border-red-200 bg-red-50 text-red-500' : 'border-slate-200 bg-slate-50 text-slate-500')}>{lock ? <Lock size={18} /> : <LockOpen size={18} />}</div>
      <div className="flex-1">
        <div className="text-[16px] font-semibold" title={hint}>
          {title}
        </div>
        <div className="text-[13px] text-slate-600">{lock ? <>Transactions up to <b>{fmtDate(lock.date)}</b> are locked.{lock.reason && <span className="text-slate-500"> Reason: {lock.reason}</span>}</> : 'You have not locked the transactions in this module.'}</div>
      </div>
      <div className="flex gap-3 text-[13px]">
        {lock && (
          <button className="link inline-flex items-center gap-1" onClick={onUnlock}>
            <LockOpen size={13} /> Unlock
          </button>
        )}
        <button className="link inline-flex items-center gap-1" onClick={onLock}>
          <Lock size={13} /> {lock ? 'Edit Lock' : 'Lock'}
        </button>
      </div>
    </div>
  );
}

function LockModal({ module, mode, current, onClose }: { module: LockModule | 'all'; mode: 'lock' | 'unlock'; current?: { date: string; reason?: string }; onClose: () => void }) {
  const [date, setDate] = useState(current?.date ?? '');
  const [reason, setReason] = useState('');
  const label = module === 'all' ? 'All Transactions' : LOCK_MODULES.find((m) => m.value === module)?.label;
  const go = useAction(() => api(`/transaction-locks/${module}/${mode}`, { body: { date, reason } }), mode === 'lock' ? `${label} locked` : `${label} unlocked`);
  return (
    <Modal
      open
      onClose={onClose}
      title={`${mode === 'lock' ? 'Lock' : 'Unlock'} - ${label}`}
      footer={
        <>
          <button className="btn-primary" onClick={() => go.mutate(undefined, { onSuccess: onClose })}>
            {mode === 'lock' ? 'Lock' : 'Unlock'}
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {mode === 'lock' && (
          <Field inline={false} label="Lock Date" required hint="Transactions dated on or before this date cannot be created, edited or deleted.">
            <DateInput value={date} onChange={setDate} />
          </Field>
        )}
        <Field inline={false} label="Reason" required>
          <textarea className="input" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {mode === 'unlock' && <p className="text-[13px] text-slate-600">Unlocking lets everyone edit transactions dated up to {fmtDate(current?.date)} again.</p>}
        <p className="text-xs text-slate-500">
          See <Link className="link" to="/reports/activity-logs">Activity Logs</Link> for changes made to locked periods.
        </p>
      </div>
    </Modal>
  );
}
