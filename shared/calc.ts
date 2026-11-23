// Document total calculations shared by client (live form totals) and server (authoritative).
import { round2 } from './format';
import type { LineItem } from './types';

export interface TotalsInput {
  lineItems: Pick<LineItem, 'quantity' | 'rate' | 'discountPercent'>[];
  discountPercent?: number;
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
  total: number;
}

export function lineAmount(l: Pick<LineItem, 'quantity' | 'rate' | 'discountPercent'>): number {
  const gross = (Number(l.quantity) || 0) * (Number(l.rate) || 0);
  return round2(gross * (1 - (Number(l.discountPercent) || 0) / 100));
}

/**
 * Total = Sub Total - Discount - TDS + TCS + Adjustment (+ round off)
 *  - Discount is a % of the sub total.
 *  - TDS is withheld by the counter-party on (sub total - discount).
 *  - TCS is collected on (sub total - discount).
 */
export function computeTotals(input: TotalsInput): Totals {
  const lineAmounts = input.lineItems.map(lineAmount);
  const subTotal = round2(lineAmounts.reduce((a, b) => a + b, 0));
  const discountAmount = round2((subTotal * (Number(input.discountPercent) || 0)) / 100);
  const taxable = subTotal - discountAmount;
  const tdsAmount = round2((taxable * (Number(input.tdsRate) || 0)) / 100);
  const tcsAmount = round2((taxable * (Number(input.tcsRate) || 0)) / 100);
  const adjustment = round2(Number(input.adjustment) || 0);
  let total = round2(subTotal - discountAmount - tdsAmount + tcsAmount + adjustment);
  let roundOffAmount = 0;
  if (input.roundOff) {
    const r = Math.round(total);
    roundOffAmount = round2(r - total);
    total = r;
  }
  return { lineAmounts, subTotal, discountAmount, tdsAmount, tcsAmount, adjustment, roundOffAmount, total };
}
