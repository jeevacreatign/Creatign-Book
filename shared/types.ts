// Shared domain model for Creatign Books. Used by both the API server and the React client.
// All money values are stored as numbers in INR, rounded to 2 decimals.
// All dates are ISO strings 'yyyy-MM-dd' (timestamps are full ISO strings).

export type ID = string;

export interface Address {
  attention?: string;
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  pin?: string;
  country?: string;
  phone?: string;
}

export interface Attachment {
  id: ID;
  name: string;
  size: number;
  mimeType: string;
  url: string;
  uploadedAt: string;
}

export interface Organization {
  id: ID;
  name: string;
  email: string;
  phone?: string;
  state: string;
  country: string;
  currencyCode: string; // INR
  currencySymbol: string; // ₹
  dateFormat: string; // dd/MM/yyyy
  fiscalYearStartMonth: number; // 4 = April
  gstin?: string;
  pan?: string;
  address?: Address;
  logoText?: string;
  migrationDate?: string;
}

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
export type AccountSubType =
  | 'cash'
  | 'bank'
  | 'credit_card'
  | 'accounts_receivable'
  | 'accounts_payable'
  | 'other_current_asset'
  | 'fixed_asset'
  | 'other_current_liability'
  | 'equity'
  | 'income'
  | 'other_income'
  | 'cost_of_goods_sold'
  | 'expense'
  | 'other_expense';

export interface Account {
  id: ID;
  code: string;
  name: string;
  type: AccountType;
  subType: AccountSubType;
  description?: string;
  system?: boolean; // system accounts cannot be deleted
  active: boolean;
}

export type ItemType = 'goods' | 'service';

export interface Item {
  id: ID;
  name: string;
  type: ItemType;
  unit?: string;
  sku?: string;
  sellable: boolean;
  sellingPrice: number;
  salesAccountId: ID;
  salesDescription?: string;
  purchasable: boolean;
  costPrice: number;
  purchaseAccountId: ID;
  purchaseDescription?: string;
  preferredVendorId?: ID;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export interface ContactPerson {
  id: ID;
  salutation?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  workPhone?: string;
  mobile?: string;
  designation?: string;
  department?: string;
}

export interface BankDetail {
  id: ID;
  accountHolderName?: string;
  bankName?: string;
  accountNumber?: string;
  ifsc?: string;
}

export type ContactKind = 'customer' | 'vendor';

export interface Contact {
  id: ID;
  kind: ContactKind;
  customerType: 'business' | 'individual';
  salutation?: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  displayName: string;
  email?: string;
  workPhone?: string;
  mobile?: string;
  language: string;
  pan?: string;
  gstin?: string;
  msmeRegistered?: boolean;
  msmeType?: string;
  tdsRate?: number;
  currencyCode: string;
  accountId?: ID; // Accounts Receivable / Accounts Payable
  openingBalance: number;
  paymentTerms: PaymentTerms;
  portalEnabled: boolean;
  website?: string;
  department?: string;
  designation?: string;
  x?: string;
  skype?: string;
  facebook?: string;
  billingAddress: Address;
  shippingAddress: Address;
  contactPersons: ContactPerson[];
  bankDetails: BankDetail[];
  customFields: Record<string, string>;
  reportingTags: Record<string, string>;
  remarks?: string;
  documents: Attachment[];
  linkedContactId?: ID;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export type PaymentTerms = 'due_on_receipt' | 'net_15' | 'net_30' | 'net_45' | 'net_60' | 'due_end_of_month' | 'due_end_of_next_month';

export interface RepeatEvery {
  n: number;
  unit: 'day' | 'week' | 'month' | 'year';
}

export interface LineItem {
  id: ID;
  itemId?: ID;
  name: string;
  description?: string;
  accountId?: ID;
  quantity: number;
  unit?: string;
  rate: number;
  discountPercent?: number; // line-level discount (bills)
  customerId?: ID; // billable to customer (bills / recurring bills)
  amount: number; // computed: qty * rate * (1 - discount%)
}

/** Every transaction document that carries an item table. */
export type DocKind =
  | 'quote'
  | 'sales_order'
  | 'invoice'
  | 'recurring_invoice'
  | 'delivery_challan'
  | 'credit_note'
  | 'purchase_order'
  | 'bill'
  | 'recurring_bill'
  | 'vendor_credit';

export interface CreditApplication {
  id: ID;
  invoiceId: ID; // invoice (credit notes) or bill (vendor credits)
  amount: number;
  date: string;
}

export interface Refund {
  id: ID;
  amount: number;
  date: string;
  mode: string;
  referenceNumber?: string;
  accountId: ID; // From Account (sales) / Deposit To (purchase)
  description?: string;
}

export interface TxnDoc {
  id: ID;
  kind: DocKind;
  number: string;
  referenceNumber?: string;
  orderNumber?: string;
  contactId: ID;
  date: string;
  dueDate?: string;
  expiryDate?: string;
  expectedShipmentDate?: string;
  deliveryDate?: string;
  paymentTerms?: PaymentTerms;
  salesperson?: string;
  projectName?: string;
  subject?: string;
  deliveryMethod?: string;
  shipmentPreference?: string;
  challanType?: string;
  deliveryAddressType?: 'organization' | 'customer';
  deliveryCustomerId?: ID;
  accountId?: ID; // AR (sales) or AP (purchases)
  billingAddress?: Address;
  shippingAddress?: Address;
  lineItems: LineItem[];
  discountPercent: number;
  tdsRate: number;
  tcsRate: number;
  adjustment: number;
  adjustmentLabel?: string;
  roundOff?: boolean;
  // computed
  subTotal: number;
  discountAmount: number;
  tdsAmount: number;
  tcsAmount: number;
  total: number;
  balance: number; // invoices/bills: amount due; credit notes/vendor credits: credits remaining
  // workflow
  status: string;
  invoiceStatus?: 'not_invoiced' | 'partially_invoiced' | 'invoiced';
  shipmentStatus?: 'pending' | 'fulfilled';
  billedStatus?: 'not_billed' | 'partially_billed' | 'billed';
  paymentStatus?: 'unpaid' | 'partially_paid' | 'paid';
  amountPaid?: number; // payments + credits + write-off applied (invoices/bills)
  creditsUsed?: number; // credit notes/vendor credits applied + refunded
  childCount?: number; // recurring profiles
  received?: boolean;
  customerNotes?: string;
  terms?: string;
  notes?: string;
  attachments: Attachment[];
  emailRecipients: string[];
  locked: boolean;
  sentAt?: string;
  // relationships
  quoteId?: ID;
  salesOrderId?: ID;
  deliveryChallanId?: ID;
  purchaseOrderId?: ID;
  invoiceId?: ID; // credit note against invoice
  recurringProfileId?: ID;
  manuallyAdded?: boolean;
  creditApplications: CreditApplication[];
  refunds: Refund[];
  writeOff?: { amount: number; date: string; reason?: string };
  expectedPaymentDate?: string;
  remindersStopped?: boolean;
  // recurring profiles
  profileName?: string;
  repeatEvery?: RepeatEvery;
  startOn?: string;
  endsOn?: string;
  neverExpires?: boolean;
  lastGeneratedDate?: string;
  nextDate?: string;
  createAsDraft?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Allocation {
  docId: ID; // invoice (payments received) or bill (payments made)
  amount: number;
}

export interface PaymentReceived {
  id: ID;
  number: string;
  contactId: ID;
  amount: number;
  bankCharges: number;
  date: string;
  mode: string;
  depositToAccountId: ID;
  referenceNumber?: string;
  tdsDeducted: boolean;
  tdsAmount: number;
  allocations: Allocation[];
  notes?: string;
  attachments: Attachment[];
  sendThankYou: boolean;
  status: 'draft' | 'paid' | 'void';
  refunds: Refund[];
  locked: boolean;
  // computed
  usedAmount: number;
  refundedAmount: number;
  unusedAmount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentMade {
  id: ID;
  number: string;
  type: 'bill_payment' | 'vendor_advance';
  contactId: ID;
  amount: number;
  date: string;
  mode: string;
  paidThroughAccountId: ID;
  referenceNumber?: string;
  allocations: Allocation[];
  tdsRate?: number;
  depositToAccountId?: ID;
  notes?: string;
  attachments: Attachment[];
  status: 'draft' | 'paid' | 'void';
  usedAmount: number;
  unusedAmount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseLine {
  id: ID;
  accountId: ID;
  amount: number;
  notes?: string;
}

export interface Expense {
  id: ID;
  date: string;
  accountId: ID;
  amount: number;
  itemized: boolean;
  lines: ExpenseLine[];
  paidThroughAccountId: ID;
  vendorId?: ID;
  invoiceNumber?: string;
  notes?: string;
  customerId?: ID;
  billable: boolean;
  status: 'unbilled' | 'invoiced' | 'reimbursed' | 'non_billable';
  isMileage: boolean;
  distance?: number;
  ratePerKm?: number;
  receipts: Attachment[];
  recurringProfileId?: ID;
  invoiceId?: ID;
  reportingTags: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringExpense {
  id: ID;
  profileName: string;
  repeatEvery: RepeatEvery;
  startOn: string;
  endsOn?: string;
  neverExpires: boolean;
  accountId: ID;
  amount: number;
  paidThroughAccountId: ID;
  vendorId?: ID;
  notes?: string;
  customerId?: ID;
  billable: boolean;
  reportingTags: Record<string, string>;
  status: 'active' | 'stopped' | 'expired';
  lastGeneratedDate?: string;
  nextDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface JournalLine {
  accountId: ID;
  debit: number;
  credit: number;
  description?: string;
  contactId?: ID;
}

export type JournalSource =
  | 'invoice'
  | 'credit_note'
  | 'payment_received'
  | 'payment_refund'
  | 'credit_note_refund'
  | 'write_off'
  | 'bill'
  | 'vendor_credit'
  | 'payment_made'
  | 'expense'
  | 'opening_balance'
  | 'manual';

export interface Journal {
  id: ID;
  number: string;
  date: string;
  sourceType: JournalSource;
  sourceId?: ID;
  contactId?: ID;
  reference?: string;
  notes?: string;
  lines: JournalLine[];
  createdAt: string;
}

export interface Comment {
  id: ID;
  entityType: string;
  entityId: ID;
  html: string;
  author: string;
  createdAt: string;
}

export interface Activity {
  id: ID;
  entityType: string;
  entityId: ID;
  contactId?: ID;
  message: string;
  detail?: string;
  author: string;
  createdAt: string;
}

export interface Mail {
  id: ID;
  contactId?: ID;
  entityType?: string;
  entityId?: ID;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  attachments: string[];
  delivered?: boolean; // false when no mail server was configured (recorded only)
  createdAt: string;
}

export interface ShareLink {
  id: ID;
  token: string;
  entityType: DocKind | 'payment_received';
  entityId: ID;
  expiresOn?: string;
  active: boolean;
  createdAt: string;
}

export interface Project {
  id: ID;
  name: string;
  customerId?: ID;
  billingMethod: 'fixed' | 'hourly';
  rate: number;
  budgetHours?: number;
  description?: string;
  status: 'active' | 'inactive';
  createdAt: string;
}

export interface TimeEntry {
  id: ID;
  projectId: ID;
  date: string;
  task?: string;
  hours: number;
  notes?: string;
  billable: boolean;
  invoiced: boolean;
  createdAt: string;
}

export interface Database {
  organization: Organization;
  accounts: Account[];
  items: Item[];
  contacts: Contact[];
  docs: TxnDoc[];
  paymentsReceived: PaymentReceived[];
  paymentsMade: PaymentMade[];
  expenses: Expense[];
  recurringExpenses: RecurringExpense[];
  journals: Journal[];
  comments: Comment[];
  activities: Activity[];
  mails: Mail[];
  shareLinks: ShareLink[];
  projects: Project[];
  timeEntries: TimeEntry[];
  counters: Record<string, number>;
  preferences: Record<string, unknown>;
}

export const PAYMENT_TERMS: { value: PaymentTerms; label: string }[] = [
  { value: 'due_on_receipt', label: 'Due on Receipt' },
  { value: 'net_15', label: 'Net 15' },
  { value: 'net_30', label: 'Net 30' },
  { value: 'net_45', label: 'Net 45' },
  { value: 'net_60', label: 'Net 60' },
  { value: 'due_end_of_month', label: 'Due end of the month' },
  { value: 'due_end_of_next_month', label: 'Due end of next month' },
];

export const PAYMENT_MODES = ['Cash', 'Bank Transfer', 'Cheque', 'UPI', 'Credit Card', 'Bank Remittance', 'Others'];

export const TDS_RATES = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Contractor - Individual (1%)' },
  { value: 2, label: 'Contractor - Others (2%)' },
  { value: 5, label: 'Commission or Brokerage (5%)' },
  { value: 10, label: 'Professional Fees (10%)' },
];

export const TCS_RATES = [
  { value: 0, label: 'None' },
  { value: 0.1, label: 'Sale of Goods (0.1%)' },
  { value: 1, label: 'Scrap (1%)' },
  { value: 5, label: 'Overseas Tour Package (5%)' },
];

export const UNITS = ['pcs', 'nos', 'box', 'kg', 'g', 'ltr', 'ml', 'm', 'cm', 'ft', 'in', 'hrs', 'days', 'dz', 'set'];
