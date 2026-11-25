// GST inputs used across purchase forms: GST treatment, GSTIN,
// source/destination of supply, reverse charge, tax-inclusive switch and the tax picker.
import { GST_TREATMENTS, INDIAN_STATES, taxOptions, treatmentNeedsGstin, type TaxBreakdownRow } from '@shared/gst';
import { num } from '@shared/format';
import { Checkbox, Field, Select, clsx } from './ui';

export function StateSelect({ value, onChange, className, placeholder = 'Select a state' }: { value?: string; onChange: (v: string) => void; className?: string; placeholder?: string }) {
  return <Select className={className} value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} options={INDIAN_STATES.map((s) => ({ value: s.name, label: `[${s.code}] - ${s.name}` }))} />;
}

export function TreatmentSelect({ value, onChange, className }: { value?: string; onChange: (v: string) => void; className?: string }) {
  return (
    <div className={className}>
      <Select value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder="Select a GST treatment" options={GST_TREATMENTS.map((t) => ({ value: t.value, label: t.label }))} />
      {value && <div className="mt-1 text-xxs text-slate-500">{GST_TREATMENTS.find((t) => t.value === value)?.hint}</div>}
    </div>
  );
}

export function TaxSelect({ value, onChange, intra, className, disabled }: { value?: string; onChange: (v: string | undefined) => void; intra: boolean; className?: string; disabled?: boolean }) {
  return <Select className={className} disabled={disabled} value={value || ''} onChange={(e) => onChange(e.target.value || undefined)} placeholder="Select a Tax" options={taxOptions(intra)} />;
}

export interface GstValue {
  gstTreatment?: string;
  gstin?: string;
  sourceOfSupply?: string;
  destinationOfSupply?: string;
  reverseCharge?: boolean;
}

/** The GST block shown under the vendor on bills, purchase orders, vendor credits and expenses. */
export function GstFields<T extends GstValue>({ value, onChange, gstinKey = 'gstin', reverseCharge = true, destination = true }: { value: T; onChange: (patch: Partial<T>) => void; gstinKey?: 'gstin' | 'vendorGstin'; reverseCharge?: boolean; destination?: boolean }) {
  const gstin = (value as Record<string, unknown>)[gstinKey] as string | undefined;
  return (
    <>
      <Field label="GST Treatment" required>
        <TreatmentSelect className="max-w-sm" value={value.gstTreatment} onChange={(v) => onChange({ gstTreatment: v || undefined } as Partial<T>)} />
      </Field>
      {treatmentNeedsGstin(value.gstTreatment) && (
        <Field label="GSTIN" required>
          <input className="input max-w-sm uppercase" maxLength={15} placeholder="33ABCDE1234F1Z5" value={gstin || ''} onChange={(e) => onChange({ [gstinKey]: e.target.value.toUpperCase() } as Partial<T>)} />
        </Field>
      )}
      <Field label="Source of Supply" required>
        <StateSelect className="max-w-sm" value={value.sourceOfSupply} onChange={(v) => onChange({ sourceOfSupply: v } as Partial<T>)} />
      </Field>
      {destination && (
        <Field label="Destination of Supply" required>
          <StateSelect className="max-w-sm" value={value.destinationOfSupply} onChange={(v) => onChange({ destinationOfSupply: v } as Partial<T>)} />
        </Field>
      )}
      {reverseCharge && (
        <Field label="">
          <Checkbox checked={!!value.reverseCharge} onChange={(v) => onChange({ reverseCharge: v } as Partial<T>)} label="This transaction is applicable for reverse charge" />
        </Field>
      )}
    </>
  );
}

export function TaxInclusiveSelect({ value, onChange, disabled }: { value?: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="inline-flex items-center gap-2 text-[13px] text-slate-600">
      Amounts are
      <select className="input h-8 w-40 py-0" disabled={disabled} value={value ? 'inclusive' : 'exclusive'} onChange={(e) => onChange(e.target.value === 'inclusive')}>
        <option value="exclusive">Tax Exclusive</option>
        <option value="inclusive">Tax Inclusive</option>
      </select>
    </label>
  );
}

/** CGST/SGST/IGST rows for a totals box. */
export function TaxRows({ rows, reverseCharge, inclusive, className }: { rows?: TaxBreakdownRow[]; reverseCharge?: boolean; inclusive?: boolean; className?: string }) {
  if (!rows?.length) return null;
  return (
    <>
      {rows.map((t) => (
        <div key={t.key} className={clsx('flex justify-between py-1 text-[13px]', className)}>
          <span className="text-slate-600">
            {t.component.toUpperCase()}
            {t.rate} [{t.rate}%]{reverseCharge && <span className="ml-1 text-xxs text-amber-700">(Reverse charge)</span>}
            {inclusive && <span className="ml-1 text-xxs text-slate-400">(included)</span>}
          </span>
          <span className="tabular-nums">{num(t.amount)}</span>
        </div>
      ))}
    </>
  );
}
