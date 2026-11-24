import type { DocKind } from '@shared/types';

export type Column =
  | 'date'
  | 'number'
  | 'reference'
  | 'orderNumber'
  | 'contact'
  | 'status'
  | 'dueDate'
  | 'amount'
  | 'balance'
  | 'invoiced'
  | 'payment'
  | 'invoiceStatus'
  | 'profileName'
  | 'frequency'
  | 'lastDate'
  | 'nextDate'
  | 'invoiceNumber'
  | 'billed'
  | 'received'
  | 'deliveryDate'
  | 'expiryDate';

export type FormField =
  | 'reference'
  | 'orderNumber'
  | 'dueDate'
  | 'terms'
  | 'expiryDate'
  | 'expectedShipment'
  | 'deliveryDate'
  | 'deliveryMethod'
  | 'shipmentPreference'
  | 'salesperson'
  | 'project'
  | 'subject'
  | 'challanType'
  | 'deliveryAddress'
  | 'account'
  | 'recurrence'
  | 'createAsDraft'
  | 'makeRecurring'
  | 'addresses'
  | 'invoiceRef'
  | 'emailComms';

export interface DocUI {
  kind: DocKind;
  columns: Column[];
  filters: { value: string; label: string }[];
  fields: FormField[];
  lineAccount?: boolean;
  lineDiscount?: boolean;
  lineCustomer?: boolean;
  roundOff?: boolean;
  attachments: { max: number; mb: number };
  saveLabels: { draft?: string; open: string; send?: string };
  notesLabel: string;
  lifecycle?: { title: string; subtitle: string; steps: (string | string[])[]; cta: string };
}

const ALL = { value: 'all', label: 'All' };
const DRAFT = { value: 'draft', label: 'Draft' };
const APPROVAL_FILTERS = [
  { value: 'pending_approval', label: 'Pending Approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

export const DOC_UI: Record<DocKind, DocUI> = {
  quote: {
    kind: 'quote',
    columns: ['date', 'number', 'reference', 'contact', 'status', 'amount'],
    filters: [ALL, DRAFT, ...APPROVAL_FILTERS, { value: 'sent', label: 'Sent' }, { value: 'accepted', label: 'Accepted' }, { value: 'invoiced', label: 'Invoiced' }, { value: 'declined', label: 'Declined' }, { value: 'expired', label: 'Expired' }],
    fields: ['reference', 'expiryDate', 'salesperson', 'project', 'subject', 'addresses'],
    attachments: { max: 5, mb: 10 },
    saveLabels: { draft: 'Save as Draft', open: 'Save', send: 'Save and Send' },
    notesLabel: 'Customer Notes',
  },
  sales_order: {
    kind: 'sales_order',
    columns: ['date', 'number', 'reference', 'contact', 'status', 'invoiced', 'payment', 'amount', 'expiryDate'],
    filters: [ALL, DRAFT, ...APPROVAL_FILTERS, { value: 'confirmed', label: 'Confirmed' }, { value: 'closed', label: 'Closed' }, { value: 'void', label: 'Void' }],
    fields: ['reference', 'expectedShipment', 'terms', 'deliveryMethod', 'salesperson', 'project', 'subject', 'addresses'],
    attachments: { max: 10, mb: 5 },
    saveLabels: { draft: 'Save as Draft', open: 'Save', send: 'Save and Send' },
    notesLabel: 'Customer Notes',
  },
  invoice: {
    kind: 'invoice',
    columns: ['date', 'number', 'orderNumber', 'contact', 'status', 'dueDate', 'amount', 'balance'],
    filters: [ALL, DRAFT, ...APPROVAL_FILTERS, { value: 'unpaid', label: 'Unpaid' }, { value: 'open', label: 'Open' }, { value: 'sent', label: 'Sent' }, { value: 'due_today', label: 'Due Today' }, { value: 'overdue', label: 'Overdue' }, { value: 'partially_paid', label: 'Partially Paid' }, { value: 'paid', label: 'Paid' }, { value: 'void', label: 'Void' }],
    fields: ['orderNumber', 'terms', 'dueDate', 'account', 'salesperson', 'project', 'subject', 'addresses', 'makeRecurring'],
    attachments: { max: 10, mb: 10 },
    saveLabels: { draft: 'Save as Draft', open: 'Save', send: 'Save and Send' },
    notesLabel: 'Customer Notes',
  },
  recurring_invoice: {
    kind: 'recurring_invoice',
    columns: ['contact', 'profileName', 'frequency', 'lastDate', 'nextDate', 'status', 'amount'],
    filters: [ALL, { value: 'active', label: 'Active' }, { value: 'stopped', label: 'Stopped' }, { value: 'expired', label: 'Expired' }],
    fields: ['orderNumber', 'recurrence', 'terms', 'account', 'salesperson', 'project', 'subject', 'createAsDraft', 'addresses'],
    roundOff: true,
    attachments: { max: 5, mb: 10 },
    saveLabels: { open: 'Save' },
    notesLabel: 'Customer Notes',
  },
  delivery_challan: {
    kind: 'delivery_challan',
    columns: ['date', 'number', 'reference', 'contact', 'status', 'invoiceStatus', 'amount'],
    filters: [ALL, DRAFT, { value: 'open', label: 'Open' }, { value: 'delivered', label: 'Delivered' }, { value: 'void', label: 'Void' }],
    fields: ['reference', 'challanType', 'addresses'],
    attachments: { max: 5, mb: 10 },
    saveLabels: { draft: 'Save as Draft', open: 'Save as Open', send: 'Save and Send' },
    notesLabel: 'Customer Notes',
  },
  credit_note: {
    kind: 'credit_note',
    columns: ['date', 'number', 'reference', 'contact', 'invoiceNumber', 'status', 'amount', 'balance'],
    filters: [ALL, DRAFT, ...APPROVAL_FILTERS, { value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }, { value: 'void', label: 'Void' }],
    fields: ['reference', 'invoiceRef', 'account', 'salesperson', 'subject', 'addresses', 'emailComms'],
    lineAccount: true,
    attachments: { max: 5, mb: 10 },
    saveLabels: { draft: 'Save as Draft', open: 'Save as Open', send: 'Save and Send' },
    notesLabel: 'Customer Notes',
  },
  purchase_order: {
    kind: 'purchase_order',
    columns: ['date', 'number', 'reference', 'contact', 'status', 'billed', 'received', 'deliveryDate', 'amount'],
    filters: [ALL, DRAFT, ...APPROVAL_FILTERS, { value: 'issued', label: 'Issued' }, { value: 'partially_billed', label: 'Partially Billed' }, { value: 'billed', label: 'Billed' }, { value: 'cancelled', label: 'Cancelled' }],
    fields: ['deliveryAddress', 'reference', 'deliveryDate', 'terms', 'shipmentPreference'],
    lineAccount: true,
    attachments: { max: 10, mb: 5 },
    saveLabels: { draft: 'Save as Draft', open: 'Save', send: 'Save and Send' },
    notesLabel: 'Notes',
    lifecycle: { title: 'Start Managing Your Purchase Activities!', subtitle: 'Create, customize and send professional Purchase Orders to your vendors.', steps: ['RAISE PURCHASE ORDER', 'RECEIVE GOODS', 'CONVERT TO BILL', 'RECORD PAYMENT'], cta: 'CREATE NEW PURCHASE ORDER' },
  },
  bill: {
    kind: 'bill',
    columns: ['date', 'number', 'reference', 'contact', 'status', 'dueDate', 'amount', 'balance'],
    filters: [ALL, DRAFT, ...APPROVAL_FILTERS, { value: 'unpaid', label: 'Unpaid' }, { value: 'open', label: 'Open' }, { value: 'overdue', label: 'Overdue' }, { value: 'partially_paid', label: 'Partially Paid' }, { value: 'paid', label: 'Paid' }, { value: 'void', label: 'Void' }],
    fields: ['orderNumber', 'dueDate', 'terms', 'account', 'subject', 'makeRecurring'],
    lineAccount: true,
    lineDiscount: true,
    lineCustomer: true,
    attachments: { max: 5, mb: 10 },
    saveLabels: { draft: 'Save as Draft', open: 'Save as Open' },
    notesLabel: 'Notes',
    lifecycle: { title: 'Owe money? It\'s good to pay bills on time!', subtitle: 'Create bills and record payments.', steps: ['PURCHASE ITEMS', 'RECORD BILL', ['RECORD PARTIAL PAYMENT', 'RECORD PAYMENT']], cta: 'CREATE A BILL' },
  },
  recurring_bill: {
    kind: 'recurring_bill',
    columns: ['contact', 'profileName', 'frequency', 'lastDate', 'nextDate', 'status', 'amount'],
    filters: [ALL, { value: 'active', label: 'Active' }, { value: 'stopped', label: 'Stopped' }, { value: 'expired', label: 'Expired' }],
    fields: ['recurrence', 'account', 'terms', 'createAsDraft'],
    lineAccount: true,
    lineCustomer: true,
    attachments: { max: 5, mb: 10 },
    saveLabels: { open: 'Save' },
    notesLabel: 'Notes',
    lifecycle: { title: 'Create. Set. Repeat.', subtitle: 'Do you pay for items or services periodically? Create a recurring bill profile and bills will be generated automatically.', steps: ['ROUTINE PURCHASE', 'CREATE RECURRING PROFILE', 'GENERATED BILL', 'RECORD PAYMENT'], cta: 'CREATE RECURRING BILL' },
  },
  vendor_credit: {
    kind: 'vendor_credit',
    columns: ['date', 'number', 'reference', 'contact', 'status', 'amount', 'balance'],
    filters: [ALL, DRAFT, ...APPROVAL_FILTERS, { value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }, { value: 'void', label: 'Void' }],
    fields: ['reference', 'orderNumber', 'account', 'subject'],
    lineAccount: true,
    attachments: { max: 5, mb: 10 },
    saveLabels: { draft: 'Save as Draft', open: 'Save as Open' },
    notesLabel: 'Notes',
    lifecycle: { title: 'You deserve some credit too.', subtitle: 'Create vendor credits and apply them to multiple bills when buying stuff from your vendor.', steps: ['RETURN ITEMS', 'RECORD VENDOR CREDIT', ['APPLY TO BILLS', 'RECORD REFUND']], cta: 'CREATE VENDOR CREDITS' },
  },
};

export const PATH_TO_KIND: Record<string, DocKind> = {
  quotes: 'quote',
  'sales-orders': 'sales_order',
  invoices: 'invoice',
  'recurring-invoices': 'recurring_invoice',
  'delivery-challans': 'delivery_challan',
  'credit-notes': 'credit_note',
  'purchase-orders': 'purchase_order',
  bills: 'bill',
  'recurring-bills': 'recurring_bill',
  'vendor-credits': 'vendor_credit',
};
