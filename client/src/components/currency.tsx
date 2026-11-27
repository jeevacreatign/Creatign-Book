// Currency helpers for the UI: the currency list, the exchange-rate input with its INR preview, and the
// strip that shows a foreign-currency record's currency, rate and base (INR) amounts.
import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRightLeft } from 'lucide-react';
import { BASE_CURRENCY, fxOf, moneyIn, rateLabel, toBase, type RateStatus } from '@shared/currency';
import { fmtDate } from '@shared/format';
import type { Currency } from '@shared/types';
import { useApi } from '../api';
import { clsx } from './ui';

export type CurrencyRow = Currency & { base?: boolean; usage?: number; status?: RateStatus };

/** The default rate on a date, where it comes from and whether it is out of date. */
export interface DayRate {
  rate: number;
  source?: 'manual' | 'fetched' | 'unknown';
  rateDate?: string;
  provider?: string;
  stale?: boolean;
  staleReason?: string;
}

/** "Fetched" / "Manual" tag for a rate. */
export function RateSourceTag({ source, provider }: { source?: string; provider?: string }) {
  if (source === 'fetched')
    return (
      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-200" title={provider ? `Fetched from ${provider}` : 'Fetched'}>
        Fetched
      </span>
    );
  if (source === 'manual') return <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 ring-1 ring-slate-200">Manual</span>;
  return <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 ring-1 ring-slate-200">Not dated</span>;
}

/** Note under a rate field: where the suggested rate came from, with a warning when it is old. */
export function DayRateNote({ info }: { info?: DayRate }) {
  if (!info) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500" data-testid="rate-source">
      <RateSourceTag source={info.source} provider={info.provider} />
      <span>
        {info.source === 'fetched' ? `Rate of ${fmtDate(info.rateDate!)} from ${info.provider ?? 'the rate provider'}` : info.rateDate ? `Rate entered for ${fmtDate(info.rateDate)}` : 'No dated rate for this currency'}
      </span>
      {info.stale && (
        <span className="inline-flex items-center gap-1 font-medium text-amber-700" data-testid="rate-stale">
          <AlertTriangle size={12} /> {info.staleReason}. Refresh rates in Settings &gt; Currencies or check the rate.
        </span>
      )}
    </div>
  );
}

export function useCurrencies() {
  return useApi<CurrencyRow[]>('/currencies');
}

/** "USD - United States Dollar" options, INR (base) first. */
export function currencyOptions(list: CurrencyRow[]) {
  return list.map((c) => ({ value: c.code, label: `${c.code} - ${c.name}${c.code === BASE_CURRENCY ? ' (base)' : ''}` }));
}

/** Badge such as "USD" next to amounts. */
export function CurrencyBadge({ code, className }: { code?: string; className?: string }) {
  const c = code || BASE_CURRENCY;
  return <span className={clsx('chip font-mono text-[11px]', c !== BASE_CURRENCY && 'bg-amber-50 text-amber-800 ring-amber-200', className)}>{c}</span>;
}

/**
 * Exchange rate field: "1 USD = [ 83.2575 ] INR" and the base-currency equivalent of the amount.
 * Hidden for INR, which is always at rate 1.
 */
export function RateInput({
  code,
  value,
  onChange,
  amount,
  amountLabel = 'Total',
  locked,
  defaultRate,
  info,
  id = 'exchange-rate',
}: {
  code: string;
  value: string;
  onChange: (v: string) => void;
  amount?: number;
  amountLabel?: string;
  locked?: boolean;
  defaultRate?: number;
  /** where the suggested rate for the date comes from (new records only) */
  info?: DayRate;
  id?: string;
}) {
  if (!code || code === BASE_CURRENCY) return null;
  const rate = Number(value);
  const valid = rate > 0;
  return (
    <div>
      <div className="flex max-w-sm">
        <span className="flex shrink-0 items-center whitespace-nowrap rounded-l-md border border-r-0 border-slate-300 bg-slate-50 px-2.5 text-[13px]">1 {code} =</span>
        <input id={id} aria-label={`Exchange rate, INR per ${code}`} className={clsx('input min-w-0 rounded-none tabular-nums', !valid && 'border-red-400')} inputMode="decimal" value={value} disabled={locked} onChange={(e) => onChange(e.target.value)} />
        <span className="flex shrink-0 items-center rounded-r-md border border-l-0 border-slate-300 bg-slate-50 px-2.5 text-[13px]">INR</span>
      </div>
      {!valid && <div className="mt-1 text-xs text-red-600">Enter an exchange rate greater than zero</div>}
      {valid && amount != null && !amount && (
        <div className="mt-1 text-xs text-slate-500" data-testid="base-preview">
          {rateLabel(code, rate)}. Add items to see the {amountLabel.toLowerCase()} in INR.
        </div>
      )}
      {valid && amount != null && !!amount && (
        <div className="mt-1 text-xs text-slate-500" data-testid="base-preview">
          {amountLabel} in INR: <b className="text-slate-700">{moneyIn(toBase(amount, rate), BASE_CURRENCY)}</b>
          {defaultRate && Math.abs(defaultRate - rate) > 1e-9 && <span className="ml-2 text-amber-700">(rate on this date: {defaultRate})</span>}
        </div>
      )}
      <DayRateNote info={info} />
    </div>
  );
}

/** Strip under a foreign-currency document or payment: currency, rate and INR amounts. */
export function CurrencyFacts({ x, amounts }: { x: { currencyCode?: string; exchangeRate?: number }; amounts: [string, number | undefined][] }) {
  const { code, rate } = fxOf(x);
  if (code === BASE_CURRENCY) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-md border border-amber-200 bg-amber-50/60 px-4 py-2 text-[13px]" data-testid="currency-facts">
      <span className="inline-flex items-center gap-1.5 font-medium text-amber-900">
        <ArrowRightLeft size={13} /> {code} transaction
      </span>
      <span>
        Exchange rate: <b>{rateLabel(code, rate)}</b>
      </span>
      {amounts.map(([label, v]) =>
        v == null ? null : (
          <span key={label}>
            {label}: <b>{moneyIn(v, code)}</b> = <b>{moneyIn(toBase(v, rate), BASE_CURRENCY)}</b>
          </span>
        ),
      )}
    </div>
  );
}

/**
 * Exchange-rate state for a payment form: the currency of the selected contact, the rate on the payment
 * date for new payments, the saved rate for existing ones, and the confirmation a changed rate needs.
 */
export function usePaymentRate(contactCurrency: string | undefined, date: string | undefined, existing?: { currencyCode?: string; exchangeRate?: number }) {
  const code = contactCurrency || existing?.currencyCode || BASE_CURRENCY;
  const foreign = code !== BASE_CURRENCY;
  const { data: dayRate } = useApi<DayRate>(foreign ? `/currencies/${code}/rate?date=${date || ''}` : null);
  const [rateStr, setRateStr] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (existing && rateStr === null) setRateStr(String(existing.exchangeRate ?? 1));
  }, [existing, rateStr]);
  useEffect(() => {
    if (!existing && dayRate && !touched) setRateStr(String(dayRate.rate));
  }, [dayRate, existing, touched]);
  const rate = foreign ? Number(rateStr) : 1;
  const original = existing ? fxOf(existing).rate : undefined;
  const changed = !!existing && foreign && rate > 0 && original !== undefined && Math.abs(rate - original) > 1e-9;
  return {
    code,
    foreign,
    rate,
    rateStr: rateStr ?? '',
    setRate: (v: string) => {
      setRateStr(v);
      setTouched(true);
    },
    dayRate: dayRate?.rate,
    dayInfo: existing ? undefined : dayRate,
    original,
    changed,
    confirm,
    setConfirm,
    /** fields to send with the payment, or an error message */
    body(): { error?: string; fields: Record<string, unknown> } {
      if (!foreign) return { fields: { currencyCode: BASE_CURRENCY, exchangeRate: undefined } };
      if (!(rate > 0)) return { error: `Enter the exchange rate for ${code} (INR per 1 ${code})`, fields: {} };
      if (changed && !confirm) return { error: `This payment was recorded at ${rateLabel(code, original!)}. Tick the confirmation to change the exchange rate.`, fields: {} };
      return { fields: { currencyCode: code, exchangeRate: rate, confirmRateChange: changed ? true : undefined } };
    },
  };
}

/** Rate field for payment forms, with the confirmation shown when a saved rate is changed. */
export function PaymentRateField({ fx, amount, allocations, made }: { fx: ReturnType<typeof usePaymentRate>; amount: number; allocations?: { amount: number; rate: number }[]; made?: boolean }) {
  if (!fx.foreign) return null;
  // realized gain (+) / loss (-) preview: settled at the payment rate against each document's own rate
  const realized = (made ? -1 : 1) * (allocations?.length ? allocations.reduce((s, a) => s + toBase(a.amount, fx.rate) - toBase(a.amount, a.rate), 0) : 0);
  return (
    <div>
      <RateInput code={fx.code} value={fx.rateStr} onChange={fx.setRate} amount={amount} amountLabel="Amount" defaultRate={fx.original === undefined ? fx.dayRate : undefined} info={fx.dayInfo} id="payment-rate" />
      {fx.rate > 0 && Math.abs(realized) > 0.004 && (
        <div className={clsx('mt-1 text-xs', realized > 0 ? 'text-emerald-700' : 'text-red-600')} data-testid="fx-preview">
          Exchange {realized > 0 ? 'gain' : 'loss'} on the applied amount: {moneyIn(Math.abs(Math.round(realized * 100) / 100), BASE_CURRENCY)}
        </div>
      )}
      {fx.changed && (
        <div className="mt-2 max-w-md rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          This payment was recorded at {rateLabel(fx.code, fx.original!)}.
          <label className="mt-1 flex items-center gap-2">
            <input type="checkbox" className="accent-brand-600" checked={fx.confirm} onChange={(e) => fx.setConfirm(e.target.checked)} />
            I confirm the new rate {rateLabel(fx.code, fx.rate)}
          </label>
        </div>
      )}
    </div>
  );
}
