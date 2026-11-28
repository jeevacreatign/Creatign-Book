// Settings > Currencies: INR is the base currency. Other ISO 4217 currencies carry a dated rate history,
// fetched from the rate provider by the server (Refresh Rates) or entered by hand. New transactions
// default to the latest rate on or before their date; saved transactions keep the rate they were created with.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, History, Coins, RefreshCw, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { fmtDate, fmtDateTime, today } from '@shared/format';
import { rateLabel } from '@shared/currency';
import { api, useAction, useApi } from '../../api';
import { useMe } from '../../auth';
import { toast } from '../../lib/toast';
import { DateInput, Field, Modal, Spinner, clsx, useConfirm } from '../../components/ui';
import { CurrencyBadge, FreshTag, RateSourceTag, rateWhen, useCurrencies, type CurrencyRow } from '../../components/currency';

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
        The base currency is <b className="text-slate-700">INR - Indian Rupee</b>. The ledger, reports and dashboards are always in INR. Clients and suppliers can bill in another currency; each of their transactions keeps the exchange rate of its date. Refreshing rates or entering a new rate only changes the default for new transactions. Revalue open balances at month end in{' '}
        <Link className="link" to="/accountant/currency-adjustments">
          FX Revaluations
        </Link>
        .
      </p>
      <LiveRates admin={admin} />
      <table className="table rounded-md border border-slate-200">
        <thead>
          <tr>
            <th className="pl-4">Currency</th>
            <th>Symbol</th>
            <th className="text-right">Exchange Rate</th>
            <th>Rate Source</th>
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
              <td className="text-slate-500" data-testid={`rate-source-${c.code}`}>
                {c.base ? (
                  '-'
                ) : (
                  <div className="flex flex-col gap-0.5">
                    <span className="flex items-center gap-1.5">
                      <RateSourceTag source={c.status?.source} provider={c.status?.provider} />
                      {c.status?.source === 'fetched' && <FreshTag stale={c.status.stale} />}
                      {c.status?.date && <span className="text-xs">{rateWhen(c.status.date, c.status.asOf)}</span>}
                    </span>
                    {c.status?.source === 'fetched' && <span className="text-[11px] text-slate-400">{c.status.provider}</span>}
                    {c.status?.stale && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700" data-testid={`stale-${c.code}`}>
                        <AlertTriangle size={11} /> Stale: {c.status.staleReason}
                      </span>
                    )}
                  </div>
                )}
              </td>
              <td className="text-right tabular-nums text-slate-500">{c.usage ? `${c.usage} record${c.usage === 1 ? '' : 's'}` : '-'}</td>
              <td className="pr-4 text-right">
                {!c.base && admin && (
                  <span className="flex justify-end gap-3">
                    <button className="link whitespace-nowrap text-xs" onClick={() => setEditing(c)} aria-label={`Edit rate ${c.code}`}>
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
  const save = useAction(() => api<{ code: string }>('/currencies', { body: { ...f, rate: f.rate.trim() ? Number(f.rate) : undefined } }), (c) => `${c.code} added`);
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
        <Field inline={false} label="Exchange Rate" hint="Leave blank to fetch the latest rate from the rate sources">
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
        <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">A rate entered here is saved as a manual rate. It never changes existing transactions; it is offered for new transactions dated on or after the date below.</div>
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
              <li key={h.date} className={clsx('flex items-center justify-between gap-3 py-1.5')}>
                <span className="w-24">{fmtDate(h.date)}</span>
                <RateSourceTag source={h.source ?? 'manual'} provider={h.provider} />
                <span className="flex-1 text-right tabular-nums">{rateLabel(c.code, h.rate)}</span>
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

interface RefreshResult {
  ok: boolean;
  provider: string;
  rateDate?: string;
  rateAsOf?: string;
  fetchedAt: string;
  updated: { code: string; previousRate: number; rate: number; date: string; source?: string }[];
  unsupported: string[];
  sources?: { source: string; ok: boolean; rateDate?: string; asOf?: string; count: number; error?: string }[];
  keptManual: { code: string; date: string; rate: number }[];
  error?: string;
  trigger: 'manual' | 'automatic';
}
interface RateStatusInfo {
  provider: {
    mode: string;
    basis: 'mid-market' | 'central-bank';
    basisFromEnv: boolean;
    midMarketAvailable: boolean;
    refreshEvery: string;
    note: string;
    name: string;
    apiKeyRequired: boolean;
    apiKeyConfigured: boolean;
    sources: { id: string; name: string; website: string; apiKeyRequired: boolean; apiKeyConfigured: boolean; updates: string; rateType: string; attribution?: { text: string; url: string } }[];
  };
  staleDays: number;
  midMarketStaleHours: number;
  autoRefresh: boolean;
  lastRun?: RefreshResult;
  lastSuccessAt?: string;
}

/** Provider, Refresh Rates and the result of the last refresh. */
function LiveRates({ admin }: { admin: boolean }) {
  const { data } = useApi<RateStatusInfo>('/currency-rates/status');
  const refresh = useAction(() => api<RefreshResult>('/currency-rates/refresh', { method: 'POST' }), (r) => {
    if (r.ok) return `Rates refreshed: ${r.updated.length} updated`;
    toast.error(`Could not refresh rates: ${r.error}`);
    return undefined;
  });
  const auto = useAction((on: boolean) => api('/currency-rates/settings', { method: 'PUT', body: { autoRefresh: on } }), 'Saved');
  const basis = useAction((b: 'mid-market' | 'central-bank') => api('/currency-rates/settings', { method: 'PUT', body: { rateBasis: b } }), 'Rate type saved. Refresh Rates to fetch them now.');
  if (!data) return null;
  const run = data.lastRun ?? refresh.data;
  const p = data.provider;
  return (
    <div className="mb-5 rounded-md border border-slate-200 bg-slate-50/60 p-4 text-[13px]" data-testid="live-rates">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-0.5">
          <div className="font-semibold text-slate-800">Live exchange rates against INR</div>
          <div className="max-w-3xl text-xs text-slate-600" data-testid="rate-note">{p.note}</div>
          {admin && !p.basisFromEnv && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 py-1 text-xs" role="radiogroup" aria-label="Rate type" data-testid="rate-basis">
              <label className={clsx('flex items-center gap-1.5', !p.midMarketAvailable && 'text-slate-400')}>
                <input type="radio" name="rate-basis" className="accent-brand-600" checked={p.basis === 'mid-market'} disabled={!p.midMarketAvailable || basis.isPending} onChange={() => basis.mutate('mid-market')} />
                Live mid-market (Open Exchange Rates, hourly)
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="rate-basis" className="accent-brand-600" checked={p.basis === 'central-bank'} disabled={basis.isPending} onChange={() => basis.mutate('central-bank')} />
                Central banks (official, once a day)
              </label>
              {!p.midMarketAvailable && <span className="text-slate-400">Live mid-market rates need a free App ID from openexchangerates.org in OPENEXCHANGERATES_APP_ID on the server.</span>}
            </div>
          )}
          <div className="text-xs text-slate-500">
            {p.sources.length > 1 ? 'Each currency takes its INR rate from the first source below that quotes it. ' : ''}
            {p.apiKeyRequired ? (p.apiKeyConfigured ? 'API key set on the server. ' : 'API key missing on the server. ') : 'No API key is needed. '}
            {p.basis === 'mid-market' ? `Rates older than ${data.midMarketStaleHours} market hours (weekend closure not counted) are flagged as stale.` : `Rates older than ${data.staleDays} days are flagged as stale.`}
          </div>
          <ol className="mt-1.5 space-y-1" data-testid="rate-sources">
            {p.sources.map((src, i) => (
              <li key={src.id} className="flex gap-2">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-ink-900 text-[10px] font-semibold text-brand-300">{i + 1}</span>
                <span>
                  <a className="link font-medium" href={src.website} target="_blank" rel="noreferrer">
                    {src.name}
                  </a>
                  <span className="text-xs text-slate-500">
                    {' '}
                    - {src.rateType}. {src.updates}.
                  </span>
                </span>
              </li>
            ))}
          </ol>
          {p.sources
            .filter((src) => src.attribution)
            .map((src) => (
              <div key={src.id} className="text-[11px] text-slate-400">
                <a href={src.attribution!.url} target="_blank" rel="noreferrer" className="hover:underline">
                  {src.attribution!.text}
                </a>
              </div>
            ))}
        </div>
        {admin && (
          <button className="btn-primary" disabled={refresh.isPending} onClick={() => refresh.mutate(undefined)}>
            <RefreshCw size={14} className={refresh.isPending ? 'animate-spin' : ''} /> {refresh.isPending ? 'Refreshing...' : 'Refresh Rates'}
          </button>
        )}
      </div>
      {admin && (
        <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" className="accent-brand-600" checked={data.autoRefresh} onChange={(e) => auto.mutate(e.target.checked)} />
          Refresh automatically {p.refreshEvery}
        </label>
      )}
      {run && (
        <div className={clsx('mt-3 rounded-md border px-3 py-2', !run.ok ? 'border-red-200 bg-red-50 text-red-900' : run.error ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900')} data-testid="refresh-status">
          <div className="flex items-center gap-1.5 font-medium">
            {run.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
            {run.ok ? `Rates of ${rateWhen(run.rateDate, run.rateAsOf)} fetched` : 'Refresh failed'} {run.trigger === 'automatic' ? '(automatic)' : ''} at {fmtDateTime(run.fetchedAt)}
            {run.ok && run.error ? '. One source failed; the next one was used.' : ''}
          </div>
          {!run.ok && <div className="mt-0.5">{run.error}. No rate was changed; the rates below are the last ones saved.</div>}
          {run.ok && (
            <ul className="mt-1 space-y-0.5 text-xs">
              {(run.sources ?? []).map((r) => (
                <li key={r.source} className={clsx(!r.ok && 'text-red-700')} data-testid="source-run">
                  {r.ok ? '✓' : '✗'} {r.source}: {r.ok ? `${r.count} currenc${r.count === 1 ? 'y' : 'ies'}${r.rateDate ? `, rates of ${rateWhen(r.rateDate, r.asOf)}` : ''}` : r.error}
                </li>
              ))}
              <li>Updated: {run.updated.length ? run.updated.map((u) => `${u.code} ${u.previousRate} → ${u.rate}`).join(', ') : 'none'}</li>
              {run.unsupported.length > 0 && (
                <li className="text-amber-800" data-testid="unsupported">
                  Not updated, no rate source quotes: {run.unsupported.join(', ')}. Enter these rates by hand.
                </li>
              )}
              {run.keptManual.map((k) => (
                <li key={k.code} className="text-amber-800">
                  {k.code}: your manual rate of {fmtDate(k.date)} ({k.rate}) stays the default for new transactions.
                </li>
              ))}
            </ul>
          )}
          {!run.ok && data.lastSuccessAt && <div className="mt-0.5 text-xs">Last successful refresh: {fmtDateTime(data.lastSuccessAt)}</div>}
        </div>
      )}
    </div>
  );
}
