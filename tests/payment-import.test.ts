import { describe, expect, it } from 'vitest';
import { parsePaymentImportRows } from '../shared/paymentImport';

const headers = ['Payment#', 'Date', 'Customer Name', 'Payment Mode', 'Deposit To', 'Amount', 'Invoice Number', 'Amount Applied'];
const row = (values: string[], rowNumber = 2) => ({ rowNumber, headers, values });

describe('payment CSV import', () => {
  it('parses Zoho-style headers and groups allocations for a payment', () => {
    const parsed = parsePaymentImportRows([
      row(['PMT-01', '04/03/2026', 'Acme', 'Bank Transfer', 'HDFC Bank', '1,000.00', 'INV-01', '600.00']),
      row(['PMT-01', '04/03/2026', 'Acme', 'Bank Transfer', 'HDFC Bank', '1,000.00', 'INV-02', '400.00'], 3),
    ]);

    expect(parsed.errors).toEqual([]);
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.groups[0]).toMatchObject({
      number: 'PMT-01',
      date: '2026-03-04',
      amount: 1000,
      rowNumbers: [2, 3],
      allocations: [{ invoiceNumber: 'INV-01', amount: 600 }, { invoiceNumber: 'INV-02', amount: 400 }],
    });
  });

  it('uses the payment amount for a single invoice when no applied amount is exported', () => {
    const parsed = parsePaymentImportRows([
      row(['PMT-02', '2026-03-04', 'Acme', 'Cash', 'Petty Cash', '250', 'INV-03', '']),
    ]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.groups[0].allocations).toEqual([{ invoiceNumber: 'INV-03', amount: 250 }]);
  });

  it('rejects ambiguous multi-invoice allocation and conflicting payment totals', () => {
    const missingAllocation = parsePaymentImportRows([
      row(['PMT-03', '2026-03-04', 'Acme', 'Cash', 'Petty Cash', '250', 'INV-04', '']),
      row(['PMT-03', '2026-03-04', 'Acme', 'Cash', 'Petty Cash', '250', 'INV-05', ''], 3),
    ]);
    expect(missingAllocation.groups).toEqual([]);
    expect(missingAllocation.errors[0].message).toContain('Amount Applied is required');

    const conflictingAmount = parsePaymentImportRows([
      row(['PMT-04', '2026-03-04', 'Acme', 'Cash', 'Petty Cash', '250', '', '']),
      row(['PMT-04', '2026-03-04', 'Acme', 'Cash', 'Petty Cash', '300', '', ''], 3),
    ]);
    expect(conflictingAmount.groups).toEqual([]);
    expect(conflictingAmount.errors[0].message).toContain('Amount differs');
  });

  it('reports invalid amounts and missing required payment details', () => {
    const parsed = parsePaymentImportRows([
      row(['PMT-05', 'not-a-date', 'Acme', 'Cash', 'Petty Cash', 'oops', '', '']),
    ]);
    expect(parsed.groups).toEqual([]);
    expect(parsed.errors[0].message).toContain('Amount must be a valid amount');
  });
});
