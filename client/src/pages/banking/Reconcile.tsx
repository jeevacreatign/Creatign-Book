// Reconciliation: history per account, start a reconciliation, tick cleared transactions until the difference is zero.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, X } from 'lucide-react';
import { fmtDate, money, today } from '@shared/format';
import type { Reconciliation } from '@shared/types';
import { api, useAction, useApi } from '../../api';
import { DateInput, Field, FormFooter, Modal, MoneyInput, Spinner, Status, clsx, useConfirm } from '../../components/ui';
import { ListHeader } from '../../components/split';
import type { BankAccountRow, BookEntry } from './common';

type RecRow = Reconciliation & { clearedBalance: number; difference: number; count: number };
type RecView = Reconciliation & { accountName: string; accountSubType: string; entries: (BookEntry & { cleared: boolean })[]; clearedDeposits: number; clearedWithdrawals: number; clearedBalance: number; difference: number; booksBalance: number };

export function ReconcileHistory() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: acc } = useApi<BankAccountRow>(`/banking/accounts/${id}`);
  const { data = [], isLoading } = useApi<RecRow[]>(`/banking/accounts/${id}/reconciliations`);
  const [starting, setStarting] = useState(false);
  const draft = data.find((r) => r.status === 'draft');
  return (
    <div>
      <ListHeader
        title={
          <div>
            <div className="text-xs text-slate-500">{acc?.name}</div>
            <h1 className="text-[19px]">Reconciliations</h1>
          </div>
        }
      >
        {draft ? (
          <button className="btn-primary" onClick={() => navigate(`/banking/${id}/reconcile/${draft.id}`)}>
            Continue Reconciliation
          </button>
        ) : (
          <button className="btn-primary" onClick={() => setStarting(true)}>
            <Plus size={15} /> Reconcile Now
          </button>
        )}
        <button className="btn-ghost w-8 px-0" onClick={() => navigate(`/banking/${id}`)} aria-label="Close">
          <X size={18} />
        </button>
      </ListHeader>
      {isLoading ? (
        <Spinner />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th className="pl-5">Period</th>
              <th>Status</th>
              <th className="text-right">Opening Balance</th>
              <th className="text-right">Closing Balance</th>
              <th className="text-right">Cleared Transactions</th>
              <th className="pr-5">Reconciled On</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id} className="row-link" onClick={() => navigate(`/banking/${id}/reconcile/${r.id}`)}>
                <td className="pl-5 font-medium text-brand-700">
                  {fmtDate(r.startDate)} - {fmtDate(r.endDate)}
                </td>
                <td>
                  <Status status={r.status === 'reconciled' ? 'reconciled' : 'draft'} />
                </td>
                <td className="text-right tabular-nums">{money(r.openingBalance)}</td>
                <td className="text-right tabular-nums">{money(r.closingBalance)}</td>
                <td className="text-right tabular-nums">{r.count}</td>
                <td className="pr-5">{r.reconciledAt ? fmtDate(r.reconciledAt.slice(0, 10)) : '-'}</td>
              </tr>
            ))}
            {!data.length && (
              <tr>
                <td colSpan={6} className="py-16 text-center text-slate-500">
                  This account has not been reconciled yet. Reconcile it against your bank statement to confirm every transaction in your books.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {starting && <StartModal accountId={id} last={data.find((r) => r.status === 'reconciled')} onClose={() => setStarting(false)} />}
    </div>
  );
}

function StartModal({ accountId, last, onClose }: { accountId: string; last?: RecRow; onClose: () => void }) {
  const navigate = useNavigate();
  const nextDay = (d: string) => {
    const x = new Date(`${d}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + 1);
    return x.toISOString().slice(0, 10);
  };
  const [f, setF] = useState({ startDate: last ? nextDay(last.endDate) : '', endDate: today(), openingBalance: '' as string | number, closingBalance: '' as string | number });
  const start = useAction(() => api<Reconciliation>(`/banking/accounts/${accountId}/reconciliations`, { body: f }));
  return (
    <Modal
      open
      onClose={onClose}
      title="Reconcile Account"
      footer={
        <>
          <button className="btn-primary" disabled={start.isPending} onClick={() => start.mutate(undefined, { onSuccess: (r) => navigate(`/banking/${accountId}/reconcile/${r.id}`) })}>
            Proceed to Reconcile
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <p className="mb-4 text-[13px] text-slate-600">Enter the dates and the closing balance from your bank statement.</p>
      <div className="space-y-3">
        <Field label="Start Date" required>
          <DateInput value={f.startDate} disabled={!!last} onChange={(v) => setF({ ...f, startDate: v })} />
        </Field>
        <Field label="End Date" required>
          <DateInput value={f.endDate} onChange={(v) => setF({ ...f, endDate: v })} />
        </Field>
        {last ? (
          <Field label="Opening Balance">
            <div className="pt-1.5 tabular-nums">{money(last.closingBalance)}</div>
          </Field>
        ) : (
          <Field label="Opening Balance">
            <MoneyInput value={f.openingBalance} onChange={(v) => setF({ ...f, openingBalance: v })} placeholder="0.00" />
          </Field>
        )}
        <Field label="Closing Balance" required>
          <MoneyInput value={f.closingBalance} onChange={(v) => setF({ ...f, closingBalance: v })} />
        </Field>
      </div>
    </Modal>
  );
}

export function ReconcileView() {
  const { id = '', recId = '' } = useParams();
  const navigate = useNavigate();
  const { data: r, isLoading } = useApi<RecView>(`/banking/reconciliations/${recId}`);
  const [cleared, setCleared] = useState<string[]>([]);
  const [closing, setClosing] = useState<string | number>('');
  useEffect(() => {
    if (r) {
      setCleared(r.cleared);
      setClosing(r.closingBalance);
    }
  }, [r?.id, r?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveDraft = useAction(() => api(`/banking/reconciliations/${recId}`, { method: 'PUT', body: { cleared, closingBalance: closing } }), 'Saved for later');
  const complete = useAction(async () => {
    await api(`/banking/reconciliations/${recId}`, { method: 'PUT', body: { closingBalance: closing } });
    return api(`/banking/reconciliations/${recId}/complete`, { body: { cleared } });
  }, 'Account reconciled');
  const undo = useAction(() => api(`/banking/reconciliations/${recId}/undo`, { body: {} }), 'Reconciliation undone');
  const del = useAction(() => api(`/banking/reconciliations/${recId}`, { method: 'DELETE' }), 'Reconciliation deleted');
  const confirm = useConfirm();
  const [show, setShow] = useState<'all' | 'deposits' | 'withdrawals'>('all');

  const totals = useMemo(() => {
    if (!r) return { dep: 0, wd: 0, bal: 0, diff: 0 };
    const set = new Set(cleared);
    const dep = r.entries.filter((e) => set.has(e.journalId)).reduce((s, e) => s + e.deposit, 0);
    const wd = r.entries.filter((e) => set.has(e.journalId)).reduce((s, e) => s + e.withdrawal, 0);
    const sign = r.accountSubType === 'credit_card' ? -1 : 1;
    const bal = Math.round((r.openingBalance + sign * (dep - wd)) * 100) / 100;
    return { dep, wd, bal, diff: Math.round(((Number(closing) || 0) - bal) * 100) / 100 };
  }, [r, cleared, closing]);

  if (isLoading || !r) return <Spinner />;
  const locked = r.status === 'reconciled';
  const rows = r.entries.filter((e) => (show === 'deposits' ? e.deposit > 0 : show === 'withdrawals' ? e.withdrawal > 0 : true));
  const allIds = rows.map((e) => e.journalId);
  const allOn = allIds.length > 0 && allIds.every((x) => cleared.includes(x));
  return (
    <div className="flex min-h-full flex-col">
      <ListHeader
        title={
          <div>
            <div className="text-xs text-slate-500">
              <Link className="link" to={`/banking/${id}/reconcile`}>
                {r.accountName}
              </Link>
            </div>
            <h1 className="text-[19px]">
              Reconcile: {fmtDate(r.startDate)} - {fmtDate(r.endDate)}
            </h1>
          </div>
        }
      >
        {locked ? (
          <>
            <Status status="reconciled" />
            <button className="btn-secondary" onClick={() => confirm.ask('Undo reconciliation', 'The transactions in this reconciliation will be marked as uncleared. You can reconcile again afterwards.', () => undo.mutate())}>
              Undo Reconciliation
            </button>
          </>
        ) : (
          <button className="btn-secondary text-red-600" onClick={() => confirm.ask('Delete reconciliation', 'Delete this reconciliation in progress?', () => del.mutate(undefined, { onSuccess: () => navigate(`/banking/${id}/reconcile`) }), { danger: true, label: 'Delete' })}>
            Delete
          </button>
        )}
        <button className="btn-ghost w-8 px-0" onClick={() => navigate(`/banking/${id}/reconcile`)} aria-label="Close">
          <X size={18} />
        </button>
      </ListHeader>
      <div className="grid grid-cols-2 gap-px border-b border-slate-200 bg-slate-200 md:grid-cols-5">
        <Box label="Opening Balance" value={money(r.openingBalance)} />
        <Box label="Cleared Deposits" value={money(totals.dep)} />
        <Box label="Cleared Withdrawals" value={money(totals.wd)} />
        <Box label="Cleared Balance" value={money(totals.bal)} />
        <div className="bg-white px-5 py-3">
          <div className="text-xs text-slate-500">Closing Balance (statement)</div>
          {locked ? <div className="mt-0.5 text-[17px] font-semibold tabular-nums">{money(r.closingBalance)}</div> : <MoneyInput className="mt-1" value={closing} onChange={setClosing} />}
        </div>
      </div>
      <div className={clsx('flex items-center justify-between px-5 py-2.5 text-[13px]', Math.abs(totals.diff) < 0.005 ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800')}>
        <span>{Math.abs(totals.diff) < 0.005 ? 'The cleared balance matches your statement.' : 'Tick the transactions that appear on your statement until the difference is zero.'}</span>
        <span className="font-semibold tabular-nums">Difference: {money(totals.diff)}</span>
      </div>
      <div className="flex-1 px-5 py-3">
        <div className="mb-2 flex items-center gap-2 text-[13px]">
          {(['all', 'deposits', 'withdrawals'] as const).map((v) => (
            <button key={v} className={clsx('rounded-full px-3 py-1 capitalize', show === v ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')} onClick={() => setShow(v)}>
              {v}
            </button>
          ))}
          <span className="ml-auto text-xs text-slate-500">Books balance on {fmtDate(r.endDate)}: {money(r.booksBalance)}</span>
        </div>
        <table className="table rounded-md border border-slate-200">
          <thead>
            <tr>
              <th className="w-8 pl-3">
                <input type="checkbox" className="accent-brand-600" disabled={locked} checked={allOn} onChange={() => setCleared(allOn ? cleared.filter((x) => !allIds.includes(x)) : Array.from(new Set([...cleared, ...allIds])))} aria-label="Clear all" />
              </th>
              <th>Date</th>
              <th>Transaction</th>
              <th>Type</th>
              <th className="text-right">Deposits</th>
              <th className="pr-4 text-right">Withdrawals</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const on = cleared.includes(e.journalId);
              return (
                <tr key={e.journalId} className={clsx(!locked && 'cursor-pointer hover:bg-slate-50', on && 'bg-emerald-50/40')} onClick={() => !locked && setCleared(on ? cleared.filter((x) => x !== e.journalId) : [...cleared, e.journalId])}>
                  <td className="pl-3">
                    <input type="checkbox" className="accent-brand-600" disabled={locked} checked={on} readOnly aria-label="Cleared" />
                  </td>
                  <td className={clsx(e.date < r.startDate && 'text-amber-700')}>{fmtDate(e.date)}</td>
                  <td>
                    <div className="font-medium">{e.number || e.reference || '-'}</div>
                    {(e.contact || e.description) && <div className="max-w-[360px] truncate text-xs text-slate-500">{[e.contact, e.description].filter(Boolean).join(' · ')}</div>}
                  </td>
                  <td>{e.type}</td>
                  <td className="text-right tabular-nums">{e.deposit ? money(e.deposit) : ''}</td>
                  <td className="pr-4 text-right tabular-nums">{e.withdrawal ? money(e.withdrawal) : ''}</td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="py-12 text-center text-slate-500">
                  No uncleared transactions up to {fmtDate(r.endDate)}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500">Dates in amber are before the start date and were not cleared in an earlier reconciliation.</p>
      </div>
      {!locked && (
        <FormFooter>
          <button className="btn-primary" disabled={Math.abs(totals.diff) > 0.004 || complete.isPending} onClick={() => complete.mutate()}>
            Reconcile
          </button>
          <button className="btn-secondary" onClick={() => saveDraft.mutate()}>
            Save and Reconcile Later
          </button>
        </FormFooter>
      )}
      {confirm.node}
    </div>
  );
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-5 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 text-[17px] font-semibold tabular-nums">{value}</div>
    </div>
  );
}
