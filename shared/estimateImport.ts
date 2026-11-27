import { TAX_RATES } from './gst';
import { parseStatementDate } from './bankImport';
import { csvField } from './contactImport';

export interface EstimateImportLine {
  rowNumber: number;
  itemName: string;
  description?: string;
  quantity: number;
  rate: number;
  unit?: string;
  discountPercent?: number;
  taxId?: string;
  hsnSac?: string;
  accountName?: string;
}

export interface EstimateImportRecord {
  rowNumber: number;
  number: string;
  date: string;
  customerName: string;
  referenceNumber?: string;
  expiryDate?: string;
  subject?: string;
  projectName?: string;
  salesperson?: string;
  customerNotes?: string;
  terms?: string;
  discountPercent?: number;
  tdsRate?: number;
  tcsRate?: number;
  taxInclusive?: boolean;
  sourceTotal?: number;
  sourceStatus?: string;
  lineItems: EstimateImportLine[];
  error?: string;
}

export interface EstimateImportError {
  rowNumber: number;
  message: string;
}

function parseDate(value: string) {
  return parseStatementDate(value, 'dd/MM/yyyy')
    || parseStatementDate(value, 'yyyy-MM-dd')
    || parseStatementDate(value, 'dd MMM yyyy');
}

function parseNumber(value: string | undefined, field: string, required = false): number | undefined {
  if (!value) {
    if (required) throw new Error(`${field} is required`);
    return undefined;
  }
  const normalized = value.replace(/[₹,\s]|INR|Rs\.?/gi, '').replace(/%$/, '');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a number`);
  return parsed;
}

function parseTaxId(value: string | undefined) {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  const exact = TAX_RATES.find((tax) => tax.id.toLowerCase() === normalized || tax.name.toLowerCase() === normalized);
  if (exact) return exact.id;
  if (normalized.includes('exempt')) return 'exempt';
  if (normalized.includes('non-gst') || normalized.includes('non gst')) return 'non_gst';
  if (normalized.includes('out of scope')) return 'out_of_scope';
  const rateText = normalized.match(/^(\d+(?:\.\d+)?)$/)?.[1]
    ?? normalized.match(/(\d+(?:\.\d+)?)\s*%/)?.[1]
    ?? normalized.match(/(?:gst|igst)\s*(\d+(?:\.\d+)?)/)?.[1];
  if (rateText !== undefined) {
    const rate = Number(rateText);
    const match = TAX_RATES.find((tax) => tax.kind === 'gst' && tax.rate === rate);
    if (match) return match.id;
  }
  throw new Error(`Unsupported tax "${value}"`);
}

function assignOptional(record: EstimateImportRecord, field: 'referenceNumber' | 'expiryDate' | 'subject' | 'projectName' | 'salesperson' | 'customerNotes' | 'terms' | 'sourceStatus', value: string | undefined, rowNumber: number) {
  if (!value) return;
  const current = record[field];
  if (current && current !== value) {
    record.error = `Row ${rowNumber}: conflicting ${field} values for estimate ${record.number}`;
    return;
  }
  record[field] = value;
}

function assignNumber(record: EstimateImportRecord, field: 'discountPercent' | 'tdsRate' | 'tcsRate' | 'sourceTotal', value: number | undefined, rowNumber: number) {
  if (value === undefined) return;
  const current = record[field];
  if (current !== undefined && current !== value) {
    record.error = `Row ${rowNumber}: conflicting ${field} values for estimate ${record.number}`;
    return;
  }
  record[field] = value;
}

function parseBoolean(value: string | undefined, field: string) {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (/^(true|yes|1)$/.test(normalized)) return true;
  if (/^(false|no|0)$/.test(normalized)) return false;
  throw new Error(`${field} must be true or false`);
}

export function parseEstimateImport(headers: string[], rows: string[][]): { estimates: EstimateImportRecord[]; errors: EstimateImportError[] } {
  const estimates = new Map<string, EstimateImportRecord>();
  const errors: EstimateImportError[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const get = (...names: string[]) => csvField(headers, row, ...names);
    const number = get('Estimate Number', 'Quote Number', 'Estimate#', 'Estimate No', 'Number');
    if (!number) {
      errors.push({ rowNumber, message: 'Estimate Number (or Quote Number) is required' });
      return;
    }
    const key = number.toLowerCase();
    let estimate = estimates.get(key);
    try {
      const customerName = get('Customer Name', 'Contact Name', 'Client Name', 'Customer');
      const rawDate = get('Estimate Date', 'Quote Date', 'Date');
      const date = rawDate ? parseDate(rawDate) : undefined;
      if (rawDate && !date) throw new Error(`Invalid estimate date "${rawDate}"`);
      if (!estimate && !date) throw new Error('Estimate Date (or Date) is required');
      if (!estimate && !customerName) throw new Error('Customer Name is required');
      if (estimate && customerName && estimate.customerName.toLowerCase() !== customerName.toLowerCase()) {
        estimate.error = `Row ${rowNumber}: conflicting customer names for estimate ${number}`;
      }
      if (estimate && date && estimate.date !== date) {
        estimate.error = `Row ${rowNumber}: conflicting dates for estimate ${number}`;
      }
      if (!estimate) {
        estimate = { rowNumber, number, date: date!, customerName: customerName!, lineItems: [] };
        estimates.set(key, estimate);
      }

      const expiry = get('Expiry Date', 'Expiration Date', 'Valid Until');
      if (expiry) {
        const expiryDate = parseDate(expiry);
        if (!expiryDate) throw new Error(`Invalid expiry date "${expiry}"`);
        assignOptional(estimate, 'expiryDate', expiryDate, rowNumber);
      }
      assignOptional(estimate, 'referenceNumber', get('Reference Number', 'Reference ID', 'PurchaseOrder', 'Reference'), rowNumber);
      assignOptional(estimate, 'subject', get('Subject', 'Estimate Name'), rowNumber);
      assignOptional(estimate, 'projectName', get('Project Name'), rowNumber);
      assignOptional(estimate, 'salesperson', get('Salesperson', 'Sales person'), rowNumber);
      assignOptional(estimate, 'customerNotes', get('Customer Notes', 'Notes'), rowNumber);
      assignOptional(estimate, 'terms', get('Terms & Conditions', 'Terms and Conditions', 'Terms'), rowNumber);
      assignOptional(estimate, 'sourceStatus', get('Quote Status', 'Estimate Status', 'Status'), rowNumber);
      const entityDiscount = parseNumber(get('Entity Discount Percent'), 'Entity Discount Percent');
      const discountType = get('Discount Type')?.toLowerCase();
      if (discountType === 'entity_level' || (!discountType && entityDiscount !== undefined)) {
        assignNumber(estimate, 'discountPercent', entityDiscount, rowNumber);
      }
      assignNumber(estimate, 'tdsRate', parseNumber(get('TDS Percentage', 'TDS Rate'), 'TDS Percentage'), rowNumber);
      assignNumber(estimate, 'tcsRate', parseNumber(get('TCS Percentage', 'TCS Rate'), 'TCS Percentage'), rowNumber);
      assignNumber(estimate, 'sourceTotal', parseNumber(get('Total'), 'Total'), rowNumber);
      const taxInclusive = parseBoolean(get('Is Inclusive Tax', 'Tax Inclusive'), 'Is Inclusive Tax');
      if (taxInclusive !== undefined) {
        if (estimate.taxInclusive !== undefined && estimate.taxInclusive !== taxInclusive) {
          estimate.error = `Row ${rowNumber}: conflicting inclusive-tax settings for estimate ${number}`;
        } else estimate.taxInclusive = taxInclusive;
      }

      const itemName = get('Item Name', 'Item', 'Product Name', 'Service Name');
      if (!itemName) throw new Error('Item Name is required on each estimate line');
      const quantity = parseNumber(get('Quantity', 'Qty'), 'Quantity', true)!;
      if (quantity <= 0) throw new Error('Quantity must be greater than zero');
      const rate = parseNumber(get('Rate', 'Item Rate', 'Item Price', 'Unit Price', 'Price'), 'Rate', true)!;
      if (rate < 0) throw new Error('Rate cannot be negative');
      const rawDiscount = get('Discount %', 'Discount(%)', 'Discount Percent', 'Discount Rate', 'Discount');
      let discountPercent = parseNumber(rawDiscount, 'Discount');
      const discountAmount = parseNumber(get('Discount Amount'), 'Discount Amount');
      if (discountAmount !== undefined && discountAmount > 0 && quantity * rate > 0) {
        discountPercent = discountAmount * 100 / (quantity * rate);
      }
      if (discountPercent !== undefined && (discountPercent < 0 || discountPercent > 100)) throw new Error('Discount must be between 0 and 100');
      const taxText = get('Tax Name', 'Tax Rate', 'Tax', 'Item Tax');
      const taxId = parseTaxId(taxText) ?? parseTaxId(get('Item Tax %'));
      estimate.lineItems.push({
        rowNumber,
        itemName,
        description: get('Item Description', 'Item Desc', 'Description', 'Product Description'),
        quantity,
        rate,
        unit: get('Unit', 'Usage unit'),
        discountPercent,
        taxId,
        hsnSac: get('HSN/SAC', 'HSN', 'SAC'),
        accountName: get('Account', 'Account Name'),
      });
    } catch (error) {
      if (estimate) estimate.error = `Row ${rowNumber}: ${error instanceof Error ? error.message : 'Invalid estimate data'}`;
      else errors.push({ rowNumber, message: error instanceof Error ? error.message : 'Invalid estimate data' });
    }
  });

  return { estimates: [...estimates.values()], errors };
}
