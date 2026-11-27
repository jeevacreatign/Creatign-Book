// Settings > Currencies: INR is the base currency. Other ISO 4217 currencies are added with a manually
// entered exchange rate (INR per unit) and a dated rate history. New transactions default to the latest
// rate on or before their date; saved transactions keep the rate they were created with.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, History, Coins } from 'lucide-react';
import { fmtDate, today } from '@shared/format';
import { rateLabel } from '@shared/currency';
import { api, useAction, useApi } from '../../api';
import { useMe } from '../../auth';
import { DateInput, Field, Modal, Spinner, clsx, useConfirm } from '../../components/ui';
import { CurrencyBadge, useCurrencies, type CurrencyRow } from '../../components/currency';

export default function Currencies() {
  const admin = useMe().user.role !== 'Timesheet Staff';
  const { data = [], isLoading } = useCurrencies();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CurrencyRow | null>(null);
  const confirm = useConfirm();
  const del = useAction((code: string) => api(`/currencies/${code}`, { method: 'DELETE' }), 'Currency deleted');
  if (isLoading) return <Spinner />;
  return (
    <div className="max-w-5xl">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-[19px]">
          <Coins size={18} className="text-brand-600" /> Currencies
        </h1>
        {admin && (
          <button className="btn-primary" onClick={() => setAdding(true)}>
            <Plus size={15} /> New Currency
          </button>
        )}
      </div>
      <p className="mb-5 max-w-3xl text-[13px] text-slate-500">
        The base currency is <b className="text-slate-700">INR - Indian Rupee</b>. The ledger, reports and dashboards are always in INR. Clients and suppliers can bill in another currency; each of their transactions keeps the exchange rate of its date. Rates are entered by hand, no paid rate service is used. Revalue open balances at month end in{' '}
        <Link className="link" to="/accountant/currency-adjustments">
          FX Revaluations
        </Link>
        .
      </p>
      <table className="table rounded-md border border-slate-200">
        <thead>
          <tr>
            <th className="pl-4">Currency</th>
            <th>Symbol</th>
            <th className="text-right">Exchange Rate</th>
            <th>Last Rate Entry</th>
            <th className="text-right">Used By</th>
            <th className="pr-4" />
          </tr>
        </thead>
        <tbody>
          {data.map((c) => (
            <tr key={c.code} className="group">
              <td className="pl-4">
                <div className="flex items-center gap-2">
                  <CurrencyBadge code={c.code} />
                  <span className="font-medium">{c.name}</span>
                  {c.base && <span className="rounded bg-ink-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-300">Base currency</span>}
                </div>
              </td>
              <td>{c.symbol}</td>
              <td className="text-right tabular-nums">{c.base ? '1' : rateLabel(c.code, c.rate)}</td>
              <td className="text-slate-500">{c.history?.[0] ? `${fmtDate(c.history[0].date)}: ${c.history[0].rate}` : '-'}</td>
              <td className="text-right tabular-nums text-slate-500">{c.usage ? `${c.usage} record${c.usage === 1 ? '' : 's'}` : '-'}</td>
              <td className="pr-4 text-right">
                {!c.base && admin && (
                  <span className="flex justify-end gap-3">
                    <button className="link text-xs" onClick={() => setEditing(c)} aria-label={`Edit rate ${c.code}`}>
                      Update Rate
                    </button>
                    {!c.usage && (
                      <button className="text-slate-400 hover:text-red-500" onClick={() => confirm.ask(`Delete ${c.code}`, `${c.name} will be removed from the list of currencies.`, () => del.mutate(c.code), { danger: true, label: 'Delete' })} aria-label={`Delete ${c.code}`}>
                        <Trash2 size={13} />
                      </button>
                    )}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {adding && <AddCurrency onClose={() => setAdding(false)} existing={data.map((c) => c.code)} />}
      {editing && <EditRate c={editing} onClose={() => setEditing(null)} />}
      {confirm.node}
    </div>
  );
}

function AddCurrency({ onClose, existing }: { onClose: () => void; existing: string[] }) {
  const { data: iso = [] } = useApi<{ code: string; name: string; symbol: string }[]>('/currencies/iso');
  const [f, setF] = useState({ code: '', rate: '', date: today() });
  const save = useAction(() => api<{ code: string }>('/currencies', { body: { ...f, rate: Number(f.rate) } }), (c) => `${c.code} added`);
  const picked = iso.find((x) => x.code === f.code.toUpperCase());
  return (
    <Modal
      open
      onClose={onClose}
      title="New Currency"
      footer={
        <>
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            Save
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field inline={false} label="Currency Code (ISO 4217)" required hint={picked ? `${picked.name} (${picked.symbol})` : f.code.length === 3 ? 'Not an ISO 4217 code' : 'Three letters, for example USD'}>
          <input className="input uppercase" list="iso-codes" maxLength={3} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} aria-label="Currency code" />
          <datalist id="iso-codes">
            {iso
              .filter((x) => !existing.includes(x.code))
              .map((x) => (
                <option key={x.code} value={x.code}>
                  {x.name}
                </option>
              ))}
          </datalist>
        </Field>
        <Field inline={false} label="Exchange Rate" required>
          <div className="flex">
            <span className="flex items-center rounded-l-md border border-r-0 border-slate-300 bg-slate-50 px-2.5 text-[13px]">1 {f.code || 'XXX'} =</span>
            <input className="input rounded-none" inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} aria-label="Exchange rate" />
            <span className="flex items-center rounded-r-md border border-l-0 border-slate-300 bg-slate-50 px-2.5 text-[13px]">INR</span>
          </div>
        </Field>
        <Field inline={false} label="Rate Effective From">
          <DateInput value={f.date} onChange={(v) => setF({ ...f, date: v })} />
        </Field>
      </div>
    </Modal>
  );
}

function EditRate({ c, onClose }: { c: CurrencyRow; onClose: () => void }) {
  const [f, setF] = useState({ rate: String(c.rate), date: today() });
  const save = useAction(() => api(`/currencies/${c.code}`, { method: 'PUT', body: { rate: Number(f.rate), date: f.date } }), 'Exchange rate saved');
  const drop = useAction((date: string) => api(`/currencies/${c.code}/history/${date}`, { method: 'DELETE' }), 'Rate entry removed');
  return (
    <Modal
      open
      onClose={onClose}
      title={`Exchange Rate: ${c.code} - ${c.name}`}
      footer={
        <>
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            Save Rate
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">Saving a rate never changes existing transactions. It is offered for new transactions dated on or after the date below.</div>
        <Field inline={false} label="Exchange Rate" required>
          <div className="flex">
            <span className="flex items-center rounded-l-md border border-r-0 border-slate-300 bg-slate-50 px-2.5 text-[13px]">1 {c.code} =</span>
            <input className="input rounded-none" inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} aria-label="New exchange rate" />
            <span className="flex items-center rounded-r-md border border-l-0 border-slate-300 bg-slate-50 px-2.5 text-[13px]">INR</span>
          </div>
        </Field>
        <Field inline={false} label="Effective From" required>
          <DateInput value={f.date} onChange={(v) => setF({ ...f, date: v })} />
        </Field>
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase text-slate-500">
            <History size={12} /> Rate history
          </div>
          {!(c.history ?? []).length && <div className="text-xs text-slate-400">No dated rates yet.</div>}
          <ul className="divide-y divide-slate-100 text-[13px]">
            {(c.history ?? []).map((h) => (
              <li key={h.date} className={clsx('flex items-center justify-between py-1.5')}>
                <span>{fmtDate(h.date)}</span>
                <span className="tabular-nums">{rateLabel(c.code, h.rate)}</span>
                <button className="text-slate-400 hover:text-red-500" onClick={() => drop.mutate(h.date)} aria-label={`Remove rate of ${h.date}`}>
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}

