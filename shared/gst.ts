// Indian GST as Zoho Books (India edition) models it on purchases:
//  - every line carries a tax (GST0 ... GST28, Exempt, Non-GST, Out of Scope)
//  - intra-state supply (source of supply = destination of supply) splits the rate into CGST + SGST,
//    inter-state supply charges IGST
//  - amounts can be entered tax exclusive or tax inclusive
//  - under reverse charge the tax is not paid to the vendor: it is booked as input tax credit
//    against "Reverse Charge Tax Payable"
import { round2 } from './format';

export interface GstState {
  code: string;
  name: string;
}

/** States and union territories with their GST state codes. */
export const INDIAN_STATES: GstState[] = [
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '18', name: 'Assam' },
  { code: '10', name: 'Bihar' },
  { code: '04', name: 'Chandigarh' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: '07', name: 'Delhi' },
  { code: '30', name: 'Goa' },
  { code: '24', name: 'Gujarat' },
  { code: '06', name: 'Haryana' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '20', name: 'Jharkhand' },
  { code: '29', name: 'Karnataka' },
  { code: '32', name: 'Kerala' },
  { code: '38', name: 'Ladakh' },
  { code: '31', name: 'Lakshadweep' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '27', name: 'Maharashtra' },
  { code: '14', name: 'Manipur' },
  { code: '17', name: 'Meghalaya' },
  { code: '15', name: 'Mizoram' },
  { code: '13', name: 'Nagaland' },
  { code: '21', name: 'Odisha' },
  { code: '34', name: 'Puducherry' },
  { code: '03', name: 'Punjab' },
  { code: '08', name: 'Rajasthan' },
  { code: '11', name: 'Sikkim' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '36', name: 'Telangana' },
  { code: '16', name: 'Tripura' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '19', name: 'West Bengal' },
  { code: '97', name: 'Other Territory' },
];

export const stateLabel = (name?: string) => {
  const s = INDIAN_STATES.find((x) => x.name === name);
  return s ? `[${s.code}] - ${s.name}` : name || '';
};

/** First two digits of a GSTIN are the state code. */
export const stateFromGstin = (gstin?: string) => INDIAN_STATES.find((s) => s.code === (gstin || '').slice(0, 2))?.name;

export type GstTreatment = 'registered_business' | 'registered_composition' | 'unregistered_business' | 'consumer' | 'overseas' | 'special_economic_zone' | 'deemed_export' | 'tax_deductor' | 'sez_developer';

export const GST_TREATMENTS: { value: GstTreatment; label: string; hint: string; gstin: boolean }[] = [
  { value: 'registered_business', label: 'Registered Business - Regular', hint: 'Business that is registered under GST', gstin: true },
  { value: 'registered_composition', label: 'Registered Business - Composition', hint: 'Business that is registered under the Composition Scheme in GST', gstin: true },
  { value: 'unregistered_business', label: 'Unregistered Business', hint: 'Business that has not been registered under GST', gstin: false },
  { value: 'consumer', label: 'Consumer', hint: 'A customer who is a regular consumer', gstin: false },
  { value: 'overseas', label: 'Overseas', hint: 'Persons with whom you do import or export of supplies outside India', gstin: false },
  { value: 'special_economic_zone', label: 'Special Economic Zone', hint: 'Business (unit) that is located in a Special Economic Zone (SEZ) of India or a SEZ Developer', gstin: true },
  { value: 'deemed_export', label: 'Deemed Export', hint: 'Supply of goods to an Export Oriented Unit or against Advanced Authorization/Export Promotion Capital Goods', gstin: true },
  { value: 'tax_deductor', label: 'Tax Deductor', hint: 'State or Central government departments that deduct TDS under GST', gstin: true },
  { value: 'sez_developer', label: 'SEZ Developer', hint: 'A person or organisation who owns at least 26% equity in creating business units in a SEZ', gstin: true },
];

export const treatmentLabel = (t?: string) => GST_TREATMENTS.find((x) => x.value === t)?.label || '';
export const treatmentNeedsGstin = (t?: string) => !!GST_TREATMENTS.find((x) => x.value === t)?.gstin;

export interface TaxRate {
  id: string;
  /** label for intra-state supply, e.g. GST18 */
  name: string;
  rate: number;
  kind: 'gst' | 'exempt' | 'non_gst' | 'out_of_scope';
}

export const TAX_RATES: TaxRate[] = [
  { id: 'gst0', name: 'GST0', rate: 0, kind: 'gst' },
  { id: 'gst0_25', name: 'GST0.25', rate: 0.25, kind: 'gst' },
  { id: 'gst3', name: 'GST3', rate: 3, kind: 'gst' },
  { id: 'gst5', name: 'GST5', rate: 5, kind: 'gst' },
  { id: 'gst12', name: 'GST12', rate: 12, kind: 'gst' },
  { id: 'gst18', name: 'GST18', rate: 18, kind: 'gst' },
  { id: 'gst28', name: 'GST28', rate: 28, kind: 'gst' },
  { id: 'exempt', name: 'Exempt', rate: 0, kind: 'exempt' },
  { id: 'non_gst', name: 'Non-GST Supply', rate: 0, kind: 'non_gst' },
  { id: 'out_of_scope', name: 'Out of Scope', rate: 0, kind: 'out_of_scope' },
];

export const taxRate = (id?: string) => TAX_RATES.find((t) => t.id === id);

/** "GST18 [18%]" for intra-state, "IGST18 [18%]" for inter-state. */
export function taxLabel(id: string | undefined, intra: boolean) {
  const t = taxRate(id);
  if (!t) return '';
  if (t.kind !== 'gst') return t.name;
  return `${intra ? t.name : `I${t.name}`} [${t.rate}%]`;
}

export function taxOptions(intra: boolean) {
  return TAX_RATES.map((t) => ({ value: t.id, label: taxLabel(t.id, intra), group: t.kind === 'gst' ? (intra ? 'Tax Group' : 'IGST') : 'Exemptions' }));
}

/** Supply within one state (CGST + SGST) or between states (IGST). Overseas is always inter-state. */
export function isIntraState(source?: string, destination?: string, treatment?: string) {
  if (treatment === 'overseas' || treatment === 'special_economic_zone' || treatment === 'sez_developer') return false;
  if (!source || !destination) return true;
  return source === destination;
}

/** Composition dealers, unregistered vendors (outside RCM), overseas and consumers do not charge GST on their invoices. */
export function treatmentChargesTax(treatment?: string) {
  return !treatment || treatment === 'registered_business' || treatment === 'special_economic_zone' || treatment === 'deemed_export' || treatment === 'tax_deductor' || treatment === 'sez_developer';
}

export type TaxComponent = 'cgst' | 'sgst' | 'igst';

export interface TaxBreakdownRow {
  key: string; // CGST9
  component: TaxComponent;
  rate: number;
  amount: number;
}

export interface TaxableLine {
  amount: number;
  taxId?: string;
}

export interface TaxResult {
  /** tax on each line */
  lineTax: number[];
  /** taxable value of each line (excluding tax, after the document discount) */
  lineTaxable: number[];
  breakdown: TaxBreakdownRow[];
  taxTotal: number;
}

/**
 * Tax on a set of lines.
 * - discountPercent: document-level discount, applied before tax (Zoho's default)
 * - inclusive: line amounts already contain the tax
 */
export function computeTax(lines: TaxableLine[], opts: { intra: boolean; inclusive?: boolean; discountPercent?: number }): TaxResult {
  const disc = 1 - (Number(opts.discountPercent) || 0) / 100;
  const rows = new Map<string, TaxBreakdownRow>();
  const lineTax: number[] = [];
  const lineTaxable: number[] = [];
  for (const l of lines) {
    const t = taxRate(l.taxId);
    const base = (Number(l.amount) || 0) * disc;
    const rate = t && t.kind === 'gst' ? t.rate : 0;
    const taxable = opts.inclusive && rate ? base / (1 + rate / 100) : base;
    let tax = 0;
    if (rate) {
      if (opts.intra) {
        const half = round2((taxable * rate) / 200);
        tax = half * 2;
        for (const c of ['cgst', 'sgst'] as const) {
          const key = `${c.toUpperCase()}${rate / 2}`;
          const row = rows.get(key) || { key, component: c, rate: rate / 2, amount: 0 };
          row.amount = round2(row.amount + half);
          rows.set(key, row);
        }
      } else {
        tax = round2((taxable * rate) / 100);
        const key = `IGST${rate}`;
        const row = rows.get(key) || { key, component: 'igst', rate, amount: 0 };
        row.amount = round2(row.amount + tax);
        rows.set(key, row);
      }
    }
    lineTax.push(round2(tax));
    lineTaxable.push(round2(opts.inclusive ? base - tax : base));
  }
  const breakdown = Array.from(rows.values()).sort((a, b) => a.component.localeCompare(b.component) || a.rate - b.rate);
  return { lineTax, lineTaxable, breakdown, taxTotal: round2(lineTax.reduce((a, b) => a + b, 0)) };
}

/** Accounts tax posts to (seeded as system accounts). */
export const GST_ACCOUNTS = {
  input: { cgst: 'acc_input_cgst', sgst: 'acc_input_sgst', igst: 'acc_input_igst' } as Record<TaxComponent, string>,
  output: { cgst: 'acc_output_cgst', sgst: 'acc_output_sgst', igst: 'acc_output_igst' } as Record<TaxComponent, string>,
  reverseChargePayable: 'acc_rcm_payable',
};
