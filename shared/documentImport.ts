import { DOC_META } from './docmeta';
import { parseStatementDate } from './bankImport';
import { csvField } from './contactImport';
import { parseEstimateImport } from './estimateImport';
import { TAX_RATES } from './gst';
import type { DocKind, PaymentTerms, RepeatEvery } from './types';

export interface DocumentImportLine {
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

function parsePaymentTerms(value: string | undefined): PaymentTerms | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ');
  const terms: Record<string, PaymentTerms> = {
    'due on receipt': 'due_on_receipt',
    '0': 'due_on_receipt',
    'net 15': 'net_15',
    'net 15 days': 'net_15',
    '15': 'net_15',
    '15 days': 'net_15',
    'net 30': 'net_30',
    'net 30 days': 'net_30',
    '30': 'net_30',
    '30 days': 'net_30',
    'net 45': 'net_45',
    'net 45 days': 'net_45',
    '45': 'net_45',
    '45 days': 'net_45',
    'net 60': 'net_60',
    'net 60 days': 'net_60',
    '60': 'net_60',
    '60 days': 'net_60',
    'due end of month': 'due_end_of_month',
    'due end of next month': 'due_end_of_next_month',
  };
  const result = terms[normalized];
  if (!result) throw new Error(`Unsupported payment terms "${value}"`);
  return result;
}

export interface DocumentImportRecord {
  rowNumber: number;
  number: string;
  profileName?: string;
  date: string;
  customerName: string;
  referenceNumber?: string;
  orderNumber?: string;
  dueDate?: string;
  paymentTerms?: PaymentTerms;
  expiryDate?: string;
  expectedShipmentDate?: string;
  deliveryDate?: string;
  subject?: string;
  projectName?: string;
  salesperson?: string;
  deliveryMethod?: string;
  shipmentPreference?: string;
  challanType?: string;
  customerNotes?: string;
  terms?: string;
  discountPercent?: number;
  tdsRate?: number;
  tcsRate?: number;
  adjustment?: number;
  adjustmentLabel?: string;
  taxInclusive?: boolean;
  sourceTotal?: number;
  sourceStatus?: string;
  repeatEvery?: RepeatEvery;
  startOn?: string;
  endsOn?: string;
  neverExpires?: boolean;
  lineItems: DocumentImportLine[];
  error?: string;
}

export interface DocumentImportError {
  rowNumber: number;
  message: string;
}

const NUMBER_HEADERS: Partial<Record<DocKind, string[]>> = {
  quote: ['Quote Number', 'Estimate Number', 'Estimate#', 'Quote#', 'Number'],
  sales_order: ['Sales Order Number', 'SalesOrder Number', 'Sales Order#', 'SalesOrder#', 'Order Number', 'Number'],
  invoice: ['Invoice Number', 'Invoice#', 'Number'],
  recurring_invoice: ['Profile Name', 'Recurring Invoice Name', 'Number'],
  delivery_challan: ['Delivery Challan Number', 'Delivery Challan#', 'Challan Number', 'Number'],
  credit_note: ['Credit Note Number', 'Credit Note#', 'Number'],
  purchase_order: ['Purchase Order Number', 'Purchase Order#', 'Number'],
  bill: ['Bill Number', 'Bill#', 'Vendor Invoice Number', 'Number'],
  recurring_bill: ['Profile Name', 'Recurring Bill Name', 'Number'],
  vendor_credit: ['Debit Note Number', 'Debit Note#', 'Credit Note Number', 'Number'],
};

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
  const parsed = Number(value.replace(/[₹,\s]|INR|Rs\.?/gi, '').replace(/%$/, ''));
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

function parseBoolean(value: string | undefined, field: string) {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (/^(true|yes|1)$/.test(normalized)) return true;
  if (/^(false|no|0)$/.test(normalized)) return false;
  throw new Error(`${field} must be true or false`);
}

function parseFrequency(value: string | undefined, unitValue: string | undefined): RepeatEvery | undefined {
  const unitAliases: Record<string, RepeatEvery['unit']> = {
    day: 'day', daily: 'day', days: 'day',
    week: 'week', weekly: 'week', weeks: 'week',
    month: 'month', monthly: 'month', months: 'month',
    year: 'year', yearly: 'year', annual: 'year', annually: 'year', years: 'year',
  };
  const unit = unitValue ? unitAliases[unitValue.trim().toLowerCase()] : undefined;
  const raw = value?.trim().toLowerCase();
  if (unitValue && !unit) throw new Error(`Unsupported recurrence unit "${unitValue}"`);
  if (raw && unit) {
    const n = parseNumber(raw, 'Repeat Every');
    if (n === undefined || n <= 0) throw new Error('Repeat Every must be greater than zero');
    return { n, unit };
  }
  if (!raw) return undefined;
  if (raw === 'quarterly') return { n: 3, unit: 'month' };
  const match = raw.match(/^(?:(\d+)\s*)?(day|days|daily|week|weeks|weekly|month|months|monthly|year|years|yearly|annual|annually)$/);
  if (!match) throw new Error(`Unsupported recurrence frequency "${value}"`);
  const frequencyUnit = unitAliases[match[2]];
  return { n: Number(match[1] || 1), unit: frequencyUnit };
}

function assignString(record: DocumentImportRecord, field: 'referenceNumber' | 'orderNumber' | 'dueDate' | 'expiryDate' | 'expectedShipmentDate' | 'deliveryDate' | 'subject' | 'projectName' | 'salesperson' | 'deliveryMethod' | 'shipmentPreference' | 'challanType' | 'customerNotes' | 'terms' | 'adjustmentLabel' | 'sourceStatus' | 'profileName' | 'startOn' | 'endsOn', value: string | undefined, rowNumber: number) {
  if (!value) return;
  const current = record[field];
  if (current && current !== value) {
    record.error = `Row ${rowNumber}: conflicting ${field} values for document ${record.number}`;
    return;
  }
  record[field] = value;
}

function assignNumber(record: DocumentImportRecord, field: 'discountPercent' | 'tdsRate' | 'tcsRate' | 'adjustment' | 'sourceTotal', value: number | undefined, rowNumber: number) {
  if (value === undefined) return;
  const current = record[field];
  if (current !== undefined && current !== value) {
    record.error = `Row ${rowNumber}: conflicting ${field} values for document ${record.number}`;
    return;
  }
  record[field] = value;
}

function assignDate(record: DocumentImportRecord, field: 'dueDate' | 'expiryDate' | 'expectedShipmentDate' | 'deliveryDate' | 'startOn' | 'endsOn', raw: string | undefined, fieldLabel: string, rowNumber: number) {
  if (!raw) return;
  const date = parseDate(raw);
  if (!date) throw new Error(`Invalid ${fieldLabel} "${raw}"`);
  assignString(record, field, date, rowNumber);
}

function parseGenericDocument(kind: DocKind, headers: string[], rows: string[][]): { documents: DocumentImportRecord[]; errors: DocumentImportError[] } {
  const documents = new Map<string, DocumentImportRecord>();
  const errors: DocumentImportError[] = [];
  const meta = DOC_META[kind];
  const recurring = !!meta.recurring;
  const numberHeaders = NUMBER_HEADERS[kind] ?? ['Number'];
  const contactHeaders = meta.side === 'sales'
    ? ['Customer Name', 'Contact Name', 'Client Name', 'Customer']
    : ['Supplier Name', 'Vendor Name', 'Contact Name', 'Supplier'];
  const dateHeaders = [...new Set([meta.dateLabel, `${meta.label} Date`, kind === 'quote' ? 'Quote Date' : '', kind === 'sales_order' ? 'Order Date' : '', kind === 'delivery_challan' ? 'Challan Date' : '', 'Date', 'Start On', 'Start Date'].filter(Boolean))];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const get = (...names: string[]) => csvField(headers, row, ...names);
    const number = get(...numberHeaders);
    if (!number) {
      errors.push({ rowNumber, message: `${recurring ? 'Profile Name' : meta.numberLabel} is required` });
      return;
    }
    const key = number.toLowerCase();
    let document = documents.get(key);
    try {
      const customerName = get(...contactHeaders);
      const rawDate = recurring ? get('Start On', 'Start Date', ...dateHeaders) : get(...dateHeaders);
      const date = rawDate ? parseDate(rawDate) : undefined;
      if (rawDate && !date) throw new Error(`Invalid ${meta.dateLabel.toLowerCase()} "${rawDate}"`);
      if (!document && !date) throw new Error(`${meta.dateLabel} is required`);
      if (!document && !customerName) throw new Error(`${meta.side === 'sales' ? 'Customer' : 'Supplier'} Name is required`);
      if (document && customerName && document.customerName.toLowerCase() !== customerName.toLowerCase()) {
        document.error = `Row ${rowNumber}: conflicting contact names for document ${number}`;
      }
      if (document && date && document.date !== date) {
        document.error = `Row ${rowNumber}: conflicting dates for document ${number}`;
      }
      if (!document) {
        document = { rowNumber, number, date: date!, customerName: customerName!, lineItems: [] };
        if (recurring) document.profileName = number;
        documents.set(key, document);
      }

      assignDate(document, 'dueDate', get('Due Date'), 'due date', rowNumber);
      assignDate(document, 'expiryDate', get('Expiry Date', 'Expiration Date', 'Valid Until'), 'expiry date', rowNumber);
      assignDate(document, 'expectedShipmentDate', get('Expected Shipment Date', 'Expected Delivery Date'), 'expected shipment date', rowNumber);
      assignDate(document, 'deliveryDate', get('Delivery Date', 'Shipment Date'), 'delivery date', rowNumber);
      document.paymentTerms = parsePaymentTerms(get('Payment Terms Label', 'Payment Terms')) ?? document.paymentTerms;
      assignString(document, 'referenceNumber', get('Reference Number', 'Reference ID', 'Reference#', 'PurchaseOrder', 'Reference'), rowNumber);
      assignString(document, 'orderNumber', get('Order Number', 'Customer PO', 'Purchase Order Number'), rowNumber);
      assignString(document, 'subject', get('Subject', 'Estimate Name'), rowNumber);
      assignString(document, 'projectName', get('Project Name'), rowNumber);
      assignString(document, 'salesperson', get('Salesperson', 'Sales person'), rowNumber);
      assignString(document, 'deliveryMethod', get('Delivery Method'), rowNumber);
      assignString(document, 'shipmentPreference', get('Shipment Preference', 'Shipment Method'), rowNumber);
      assignString(document, 'challanType', get('Challan Type', 'Delivery Challan Type'), rowNumber);
      assignString(document, 'customerNotes', get('Customer Notes', 'Notes'), rowNumber);
      assignString(document, 'terms', get('Terms & Conditions', 'Terms and Conditions', 'Terms'), rowNumber);
      assignString(document, 'adjustmentLabel', get('Adjustment Description'), rowNumber);
      assignString(document, 'sourceStatus', get('Quote Status', 'Sales Order Status', 'Invoice Status', 'Recurrence Profile Status', 'Status'), rowNumber);
      assignNumber(document, 'sourceTotal', parseNumber(get('Total'), 'Total'), rowNumber);

      const entityDiscount = parseNumber(get('Entity Discount Percent'), 'Entity Discount Percent');
      const discountType = get('Discount Type')?.toLowerCase();
      if (discountType === 'entity_level' || (!discountType && entityDiscount !== undefined)) {
        assignNumber(document, 'discountPercent', entityDiscount, rowNumber);
      }
      assignNumber(document, 'tdsRate', parseNumber(get('TDS Percentage', 'TDS Rate'), 'TDS Percentage'), rowNumber);
      assignNumber(document, 'tcsRate', parseNumber(get('TCS Percentage', 'TCS Rate'), 'TCS Percentage'), rowNumber);
      assignNumber(document, 'adjustment', parseNumber(get('Adjustment'), 'Adjustment'), rowNumber);
      const taxInclusive = parseBoolean(get('Is Inclusive Tax', 'Tax Inclusive'), 'Is Inclusive Tax');
      if (taxInclusive !== undefined) {
        if (document.taxInclusive !== undefined && document.taxInclusive !== taxInclusive) {
          document.error = `Row ${rowNumber}: conflicting inclusive-tax settings for document ${number}`;
        } else document.taxInclusive = taxInclusive;
      }

      if (recurring) {
        const frequency = parseFrequency(get('Repeat Every', 'Frequency'), get('Recurrence Frequency', 'Repeat Unit', 'Frequency Unit'));
        if (!frequency) throw new Error('Repeat Every (or Frequency) is required for schedules');
        if (document.repeatEvery && (document.repeatEvery.n !== frequency.n || document.repeatEvery.unit !== frequency.unit)) {
          document.error = `Row ${rowNumber}: conflicting recurrence values for profile ${number}`;
        } else document.repeatEvery = frequency;
        assignDate(document, 'endsOn', get('Ends On', 'End Date'), 'end date', rowNumber);
        const neverExpires = parseBoolean(get('Never Expires'), 'Never Expires');
        if (neverExpires !== undefined) {
          if (document.neverExpires !== undefined && document.neverExpires !== neverExpires) {
            document.error = `Row ${rowNumber}: conflicting expiry settings for profile ${number}`;
          } else document.neverExpires = neverExpires;
        }
      }

      const itemName = get('Item Name', 'Item', 'Product Name', 'Service Name');
      if (!itemName) throw new Error('Item Name is required on each document line');
      const quantity = parseNumber(get('Quantity', 'Qty', 'QuantityOrdered', 'Quantity Ordered'), 'Quantity', true)!;
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
      document.lineItems.push({
        rowNumber,
        itemName,
        description: get('Item Description', 'Item Desc', 'Description', 'Product Description'),
        quantity,
        rate,
        unit: get('Unit', 'Usage unit'),
        discountPercent,
        taxId: parseTaxId(taxText) ?? parseTaxId(get('Item Tax %', 'Tax %')),
        hsnSac: get('HSN/SAC', 'HSN', 'SAC'),
        accountName: get('Account', 'Account Name'),
      });
    } catch (error) {
      if (document) document.error = `Row ${rowNumber}: ${error instanceof Error ? error.message : 'Invalid document data'}`;
      else errors.push({ rowNumber, message: error instanceof Error ? error.message : 'Invalid document data' });
    }
  });

  for (const document of documents.values()) {
    if (recurring && document.neverExpires === undefined) document.neverExpires = !document.endsOn;
  }
  return { documents: [...documents.values()], errors };
}

export function parseDocumentImport(kind: DocKind, headers: string[], rows: string[][]): { documents: DocumentImportRecord[]; errors: DocumentImportError[] } {
  if (kind !== 'quote') return parseGenericDocument(kind, headers, rows);
  const parsed = parseEstimateImport(headers, rows);
  return {
    documents: parsed.estimates.map((estimate) => ({
      ...estimate,
      sourceTotal: estimate.sourceTotal,
      lineItems: estimate.lineItems,
    })),
    errors: parsed.errors,
  };
}

export function documentImportHeaders(kind: DocKind): string[] {
  if (kind === 'quote') {
    return ['Quote Number', 'Quote Date', 'Quote Status', 'Expiry Date', 'Reference ID', 'Subject', 'Project Name', 'Sales person', 'Notes', 'Terms & Conditions', 'Discount Type', 'Entity Discount Percent', 'TDS Percentage', 'TCS Percentage', 'Is Inclusive Tax', 'Item Name', 'Item Desc', 'Quantity', 'Item Price', 'Discount', 'Discount Amount', 'Item Tax', 'Item Tax %', 'Usage unit', 'HSN/SAC', 'Total'];
  }
  const meta = DOC_META[kind];
  const contact = meta.side === 'sales' ? 'Customer Name' : 'Supplier Name';
  const common = ['Reference Number', 'Due Date', 'Expiry Date', 'Order Number', 'Expected Shipment Date', 'Delivery Date', 'Project Name', 'Salesperson', 'Subject', 'Notes', 'Terms', 'Discount %', 'TDS Percentage', 'TCS Percentage', 'Is Inclusive Tax', 'Adjustment', 'Adjustment Description', 'Item Name', 'Item Description', 'Quantity', 'Rate', 'Discount', 'Discount Amount', 'Tax Name', 'Tax %', 'Account', 'Unit', 'HSN/SAC', 'Total'];
  return meta.recurring
    ? ['Profile Name', 'Start On', contact, 'Repeat Every', 'Repeat Unit', 'Ends On', 'Never Expires', ...common]
    : ['Number', 'Date', contact, ...common];
}
