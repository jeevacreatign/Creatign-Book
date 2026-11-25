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
    notesLabel: 'Client Notes',
  },
  sales_order: {
    kind: 'sales_order',
    columns: ['date', 'number', 'reference', 'contact', 'status', 'invoiced', 'payment', 'amount', 'expiryDate'],
    filters: [ALL, DRAFT, ...APPROVAL_FILTERS, { value: 'confirmed', label: 'Confirmed' }, { value: 'closed', label: 'Closed' }, { value: 'void', label: 'Void' }],
    fields: ['reference', 'expectedShipment', 'terms', 'deliveryMethod', 'salesperson', 'project', 'subject', 'addresses'],
    attachments: { max: 10, mb: 5 },
    saveLabels: { draft: 'Save as Draft', open: 'Save', send: 'Save and Send' },
    notesLabel: 'Client Notes',
  },
  invoice: {
    kind: 'invoice',
    columns: ['date', 'number', 'orderNumber', 'contact', 'status', 'dueDate', 'amount', 'balance'],
    filters: [ALL, DRAFT, ...APPROVAL_FILTERS, { value: 'unpaid', label: 'Unpaid' }, { value: 'open', label: 'Open' }, { value: 'sent', label: 'Sent' }, { value: 'due_today', label: 'Due Today' }, { value: 'overdue', label: 'Overdue' }, { value: 'partially_paid', label: 'Partially Paid' }, { value: 'paid', label: 'Paid' }, { value: 'void', label: 'Void' }],
    fields: ['orderNumber', 'terms', 'dueDate', 'account', 'salesperson', 'project', 'subject', 'addresses', 'makeRecurring'],
    attachments: { max: 10, mb: 10 },
    saveLabels: { draft: 'Save as Draft', open: 'Save', send: 'Save and Send' },
    notesLabel: 'Client Notes',
  },
  recurring_invoice: {
    kind: 'recurring_invoice',
    columns: ['contact', 'profileName', 'frequency', 'lastDate', 'nextDate', 'status', 'amount'],
    filters: [ALL, { value: 'active', label: 'Active' }, { value: 'stopped', label: 'Stopped' }, { value: 'expired', label: 'Expired' }],
    fields: ['orderNumber', 'recurrence', 'terms', 'account', 'salesperson', 'project', 'subject', 'createAsDraft', 'addresses'],
    roundOff: true,
    attachments: { max: 5, mb: 10 },
    saveLabels: { open: 'Save' },
    notesLabel: 'Client Notes',
  },
  delivery_challan: {
    kind: 'delivery_challan',
    columns: ['date', 'number', 'reference', 'contact', 'status', 'invoiceStatus', 'amount'],
    filters: [ALL, DRAFT, { value: 'open', label: 'Open' }, { value: 'delivered', label: 'Delivered' }, { value: 'void', label: 'Void' }],
    fields: ['reference', 'challanType', 'addresses'],
    attachments: { max: 5, mb: 10 },
    saveLabels: { draft: 'Save as Draft', open: 'Save as Open', send: 'Save and Send' },
    notesLabel: 'Client Notes',
  },
  credit_note: {
    kind: 'credit_note',
    columns: ['date', 'number', 'reference', 'contact', 'invoiceNumber', 'status', 'amount', 'balance'],
    filters: [ALL, DRAFT, ...APPROVAL_FILTERS, { value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }, { value: 'void', label: 'Void' }],
    fields: ['reference', 'invoiceRef', 'account', 'salesperson', 'project', 'subject', 'addresses', 'emailComms'],
    lineAccount: true,
    attachments: { max: 5, mb: 10 },
    saveLabels: { draft: 'Save as Draft', open: 'Save as Open', send: 'Save and Send' },
    notesLabel: 'Client Notes',
  },
  purchase_order: {
    kind: 'purchase_order',
    columns: ['date', 'number', 'reference', 'contact', 'status', 'billed', 'received', 'deliveryDate', 'amount'],
    filters: [ALL, DRAFT, ...APPROVAL_FILTERS, { value: 'issued', label: 'Issued' }, { value: 'partially_billed', label: 'Partially Billed' }, { value: 'billed', label: 'Billed' }, { value: 'cancelled', label: 'Cancelled' }],
    fields: ['deliveryAddress', 'reference', 'deliveryDate', 'terms', 'shipmentPreference', 'project'],
    lineAccount: true,
    attachments: { max: 10, mb: 5 },
    saveLabels: { draft: 'Save as Draft', open: 'Save', send: 'Save and Send' },
    notesLabel: 'Notes',
    lifecycle: { title: 'Plan purchases before you buy', subtitle: 'Send purchase orders to suppliers, then turn them into bills when the goods arrive.', steps: ['ISSUE ORDER', 'GOODS RECEIVED', 'BILL CREATED', 'SUPPLIER PAID'], cta: 'NEW PURCHASE ORDER' },
  },
  bill: {
    kind: 'bill',
    columns: ['date', 'number', 'reference', 'contact', 'status', 'dueDate', 'amount', 'balance'],
    filters: [ALL, DRAFT, ...APPROVAL_FILTERS, { value: 'unpaid', label: 'Unpaid' }, { value: 'open', label: 'Open' }, { value: 'overdue', label: 'Overdue' }, { value: 'partially_paid', label: 'Partially Paid' }, { value: 'paid', label: 'Paid' }, { value: 'void', label: 'Void' }],
    fields: ['orderNumber', 'dueDate', 'terms', 'account', 'project', 'subject', 'makeRecurring'],
    lineAccount: true,
    lineDiscount: true,
    lineCustomer: true,
    attachments: { max: 5, mb: 10 },
    saveLabels: { draft: 'Save as Draft', open: 'Save as Open' },
    notesLabel: 'Notes',
    lifecycle: { title: 'Keep track of what you owe', subtitle: 'Record supplier bills as they arrive and settle them in full or in parts.', steps: ['GOODS OR SERVICES', 'BILL RECORDED', ['PART PAYMENT', 'FULL PAYMENT']], cta: 'NEW BILL' },
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
    lifecycle: { title: 'Automate regular bills', subtitle: 'Rent, subscriptions and retainers: set up a schedule once and each bill is raised on its due date.', steps: ['REGULAR SUPPLY', 'SCHEDULE SET', 'BILL RAISED', 'SUPPLIER PAID'], cta: 'NEW BILL SCHEDULE' },
  },
  vendor_credit: {
    kind: 'vendor_credit',
    columns: ['date', 'number', 'reference', 'contact', 'status', 'amount', 'balance'],
    filters: [ALL, DRAFT, ...APPROVAL_FILTERS, { value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }, { value: 'void', label: 'Void' }],
    fields: ['reference', 'orderNumber', 'account', 'project', 'subject'],
    lineAccount: true,
    attachments: { max: 5, mb: 10 },
    saveLabels: { draft: 'Save as Draft', open: 'Save as Open' },
    notesLabel: 'Notes',
    lifecycle: { title: 'Handle returns and supplier adjustments', subtitle: 'Issue a debit note for returned or short-supplied goods and set it off against open bills or take a refund.', steps: ['GOODS RETURNED', 'DEBIT NOTE ISSUED', ['SET OFF AGAINST BILLS', 'REFUND RECEIVED']], cta: 'NEW DEBIT NOTE' },
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
