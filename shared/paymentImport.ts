import { DATE_FORMATS, parseStatementDate } from './bankImport';

export interface PaymentImportInput {
  rowNumber: number;
  headers: string[];
  values: string[];
}

export interface PaymentImportAllocation {
  invoiceNumber: string;
  amount: number;
}

export interface PaymentImportGroup {
  rowNumber: number;
  rowNumbers: number[];
  number?: string;
  date: string;
  customerName: string;
  mode: string;
  depositTo: string;
  amount: number;
  bankCharges: number;
  referenceNumber?: string;
  tdsDeducted: boolean;
  tdsAmount: number;
  notes?: string;
  allocations: PaymentImportAllocation[];
}

export interface PaymentImportError {
  rowNumber: number;
  label: string;
  message: string;
}

export function paymentCsvField(headers: string[], values: string[], ...names: string[]) {
  const normalize = (value: string) => value.replace(/^\uFEFF/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const aliases = new Set(names.map(normalize));
  const index = headers.findIndex((header) => aliases.has(normalize(header)));
  return index < 0 ? undefined : values[index]?.trim() || undefined;
}

function paymentDate(value: string | undefined) {
  if (!value) return undefined;
  for (const format of DATE_FORMATS) {
    const date = parseStatementDate(value, format);
    if (date) return date;
  }
  return undefined;
}

function paymentAmount(value: string | undefined, field: string) {
  if (!value) return undefined;
  let normalized = value.trim();
  const negative = /^\(.*\)$/.test(normalized) || /\bdr\.?$/i.test(normalized);
  normalized = normalized
    .replace(/^\((.*)\)$/, '$1')
    .replace(/\b(?:INR|Rs\.?)\b/gi, '')
    .replace(/\b(?:dr|cr)\.?$/i, '')
    .replace(/[₹$€£,\s]/g, '');
  if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error(`${field} must be a valid amount`);
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || negative || amount < 0) throw new Error(`${field} cannot be negative`);
  return Math.round(amount * 100) / 100;
}

function paymentFlag(value: string | undefined) {
  if (!value) return undefined;
  if (/^(yes|true|1|deducted)$/i.test(value)) return true;
  if (/^(no|false|0|not deducted)$/i.test(value)) return false;
  throw new Error(`Unsupported Tax Deducted value "${value}"`);
}

function merge<T>(current: T | undefined, next: T | undefined, field: string): T | undefined {
  if (current === undefined) return next;
  if (next === undefined) return current;
  const equal = typeof current === 'string' && typeof next === 'string'
    ? current.trim().toLowerCase() === next.trim().toLowerCase()
    : current === next;
  if (!equal) throw new Error(`${field} differs between rows for this payment`);
  return current;
}

interface RawPayment {
  rowNumber: number;
  number?: string;
  date?: string;
  customerName?: string;
  mode?: string;
  depositTo?: string;
  amount?: number;
  bankCharges?: number;
  referenceNumber?: string;
  tdsDeducted?: boolean;
  tdsAmount?: number;
  notes?: string;
  invoiceNumber?: string;
  allocationAmount?: number;
}

export function parsePaymentImportRows(rows: PaymentImportInput[]): { groups: PaymentImportGroup[]; errors: PaymentImportError[] } {
  const grouped = new Map<string, { number?: string; firstRowNumber: number; rows: RawPayment[]; errors: string[] }>();
  for (const input of rows) {
    const number = paymentCsvField(input.headers, input.values, 'Payment Number', 'Payment No', 'Payment#', 'Payment', 'Payment ID');
    const key = number ? `payment:${number.toLowerCase()}` : `row:${input.rowNumber}`;
    const group = grouped.get(key) ?? { number, firstRowNumber: input.rowNumber, rows: [], errors: [] };
    grouped.set(key, group);
    try {
      const tdsAmount = paymentAmount(paymentCsvField(input.headers, input.values, 'TDS Amount', 'Tax Amount', 'Tax Deducted Amount'), 'TDS Amount');
      const indicatedTds = paymentFlag(paymentCsvField(input.headers, input.values, 'TDS Deducted', 'Tax Deducted', 'Tax Deducted?'));
      group.rows.push({
        rowNumber: input.rowNumber,
        number,
        date: paymentDate(paymentCsvField(input.headers, input.values, 'Date', 'Payment Date')),
        customerName: paymentCsvField(input.headers, input.values, 'Customer Name', 'Client Name', 'Received From', 'Customer'),
        mode: paymentCsvField(input.headers, input.values, 'Payment Mode', 'Mode', 'Payment Type'),
        depositTo: paymentCsvField(input.headers, input.values, 'Deposit To', 'Deposit Account', 'Account Name', 'Account'),
        amount: paymentAmount(paymentCsvField(input.headers, input.values, 'Amount Received', 'Payment Amount', 'Amount'), 'Amount'),
        bankCharges: paymentAmount(paymentCsvField(input.headers, input.values, 'Bank Charges', 'Bank Charge'), 'Bank Charges'),
        referenceNumber: paymentCsvField(input.headers, input.values, 'Reference Number', 'Reference#', 'Reference', 'Transaction Reference'),
        tdsDeducted: indicatedTds,
        tdsAmount,
        notes: paymentCsvField(input.headers, input.values, 'Notes', 'Description', 'Memo'),
        invoiceNumber: paymentCsvField(input.headers, input.values, 'Invoice Number', 'Invoice No', 'Invoice#', 'Invoice'),
        allocationAmount: paymentAmount(paymentCsvField(input.headers, input.values, 'Amount Applied', 'Applied Amount', 'Payment Applied', 'Invoice Payment'), 'Amount Applied'),
      });
    } catch (error) {
      group.errors.push(`Row ${input.rowNumber}: ${error instanceof Error ? error.message : 'Invalid payment data'}`);
    }
  }

  const groups: PaymentImportGroup[] = [];
  const errors: PaymentImportError[] = [];
  for (const group of grouped.values()) {
    const rowNumbers = group.rows.map((row) => row.rowNumber);
    const rowNumber = rowNumbers[0] ?? group.firstRowNumber;
    const label = group.number ?? group.rows[0]?.customerName ?? `row ${rowNumber}`;
    try {
      if (group.errors.length) throw new Error(group.errors.join('; '));
      if (!group.rows.length) throw new Error('No valid payment rows were found');
      const date = group.rows.reduce((value, row) => merge(value, row.date, 'Payment date'), undefined as string | undefined);
      const customerName = group.rows.reduce((value, row) => merge(value, row.customerName, 'Client'), undefined as string | undefined);
      const mode = group.rows.reduce((value, row) => merge(value, row.mode, 'Payment mode'), undefined as string | undefined) ?? 'Cash';
      const depositTo = group.rows.reduce((value, row) => merge(value, row.depositTo, 'Deposit To'), undefined as string | undefined);
      const amount = group.rows.reduce((value, row) => merge(value, row.amount, 'Amount'), undefined as number | undefined);
      const bankCharges = group.rows.reduce((value, row) => merge(value, row.bankCharges, 'Bank charges'), undefined as number | undefined) ?? 0;
      const referenceNumber = group.rows.reduce((value, row) => merge(value, row.referenceNumber, 'Reference number'), undefined as string | undefined);
      const tdsDeducted = group.rows.reduce((value, row) => merge(value, row.tdsDeducted, 'Tax Deducted'), undefined as boolean | undefined);
      const tdsAmount = group.rows.reduce((value, row) => merge(value, row.tdsAmount, 'TDS amount'), undefined as number | undefined) ?? 0;
      const notes = group.rows.reduce((value, row) => merge(value, row.notes, 'Notes'), undefined as string | undefined);
      if (!date) throw new Error('Payment Date is required or invalid');
      if (!customerName) throw new Error('Client Name is required');
      if (!depositTo) throw new Error('Deposit To is required');
      if (amount === undefined || amount <= 0) throw new Error('Amount Received must be greater than zero');
      if (bankCharges > amount) throw new Error('Bank charges cannot exceed the amount received');
      if (tdsDeducted === false && tdsAmount > 0) throw new Error('TDS Amount is set but Tax Deducted is No');
      const invoiceRows = group.rows.filter((row) => row.invoiceNumber);
      const allocations = invoiceRows.map((row) => {
        const allocation = row.allocationAmount ?? (invoiceRows.length === 1 ? amount : undefined);
        if (allocation === undefined || allocation <= 0) {
          throw new Error(`Amount Applied is required for each invoice when a payment covers multiple invoices (row ${row.rowNumber})`);
        }
        return { invoiceNumber: row.invoiceNumber!, amount: allocation };
      });
      groups.push({
        rowNumber,
        rowNumbers,
        number: group.number,
        date,
        customerName,
        mode,
        depositTo,
        amount,
        bankCharges,
        referenceNumber,
        tdsDeducted: (tdsDeducted ?? tdsAmount > 0) || false,
        tdsAmount,
        notes,
        allocations,
      });
    } catch (error) {
      errors.push({ rowNumber, label, message: error instanceof Error ? error.message : 'Invalid payment data' });
    }
  }
  return { groups, errors };
}
