// Document total calculations shared by client (live form totals) and server (authoritative).
import { round2 } from './format';
import type { LineItem } from './types';
import { computeTax, isIntraState, type TaxBreakdownRow } from './gst';

export interface TotalsInput {
  lineItems: Pick<LineItem, 'quantity' | 'rate' | 'discountPercent' | 'taxId'>[];
  discountPercent?: number;
  /** GST: where the supply comes from / goes to (state names) */
  sourceOfSupply?: string;
  destinationOfSupply?: string;
  gstTreatment?: string;
  /** line amounts include tax */
  taxInclusive?: boolean;
  /** tax is paid by the buyer to the government, not to the vendor */
  reverseCharge?: boolean;
  tdsRate?: number;
  tcsRate?: number;
  adjustment?: number;
  roundOff?: boolean;
}

export interface Totals {
  lineAmounts: number[];
  subTotal: number;
  discountAmount: number;
  tdsAmount: number;
  tcsAmount: number;
  adjustment: number;
  roundOffAmount: number;
  /** GST on the document (also when under reverse charge, where it is not part of the total) */
  taxAmount: number;
  taxBreakdown: TaxBreakdownRow[];
  lineTax: number[];
  intraState: boolean;
  total: number;
}

export function lineAmount(l: Pick<LineItem, 'quantity' | 'rate' | 'discountPercent'>): number {
  const gross = (Number(l.quantity) || 0) * (Number(l.rate) || 0);
  return round2(gross * (1 - (Number(l.discountPercent) || 0) / 100));
}

/**
 * Total = Sub Total - Discount + GST - TDS + TCS + Adjustment (+ round off)
 *  - GST is added on top for tax-exclusive amounts, and left out under reverse charge.
 *  - Discount is a % of the sub total.
 *  - TDS is withheld by the counter-party on (sub total - discount).
 *  - TCS is collected on (sub total - discount).
 */
export function computeTotals(input: TotalsInput): Totals {
  const lineAmounts = input.lineItems.map(lineAmount);
  const subTotal = round2(lineAmounts.reduce((a, b) => a + b, 0));
  const discountAmount = round2((subTotal * (Number(input.discountPercent) || 0)) / 100);
  const intraState = isIntraState(input.sourceOfSupply, input.destinationOfSupply, input.gstTreatment);
  const inclusive = !!input.taxInclusive && !input.reverseCharge;
  const tax = computeTax(
    input.lineItems.map((l, i) => ({ amount: lineAmounts[i], taxId: l.taxId })),
    { intra: intraState, inclusive, discountPercent: input.discountPercent },
  );
  // tax added on top of the amount the vendor/customer is owed (not for inclusive amounts or reverse charge)
  const taxOnTop = inclusive || input.reverseCharge ? 0 : tax.taxTotal;
  const taxable = subTotal - discountAmount - (inclusive ? tax.taxTotal : 0);
  const tdsAmount = round2((taxable * (Number(input.tdsRate) || 0)) / 100);
  const tcsAmount = round2((taxable * (Number(input.tcsRate) || 0)) / 100);
  const adjustment = round2(Number(input.adjustment) || 0);
  let total = round2(subTotal - discountAmount + taxOnTop - tdsAmount + tcsAmount + adjustment);
  let roundOffAmount = 0;
  if (input.roundOff) {
    const r = Math.round(total);
    roundOffAmount = round2(r - total);
    total = r;
  }
  return { lineAmounts, subTotal, discountAmount, tdsAmount, tcsAmount, adjustment, roundOffAmount, taxAmount: tax.taxTotal, taxBreakdown: tax.breakdown, lineTax: tax.lineTax, intraState, total };
}

/** Part of the total that is GST charged by the vendor/customer (0 when inclusive or under reverse charge). */
export function taxInTotal(d: { taxAmount?: number; taxInclusive?: boolean; reverseCharge?: boolean }) {
  return d.taxInclusive || d.reverseCharge ? 0 : d.taxAmount || 0;
}
