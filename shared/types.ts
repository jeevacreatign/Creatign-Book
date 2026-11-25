import type { PdfTemplate } from './pdfTemplate';
import type { TaxBreakdownRow } from './gst';
import type { EmailTemplate } from './email';
import type { CustomerResponse, PaymentNotice, PortalSession, PortalUser } from './portal';
// Shared domain model for Creatign Ledger. Used by both the API server and the React client.
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
  /** organization logo as a data: URL, shown on PDFs and emails */
  logo?: string;
  website?: string;
  fax?: string;
  industry?: string;
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
  | 'other_expense'
  | 'other_asset'
  | 'stock'
  | 'payment_clearing'
  | 'input_tax'
  | 'long_term_liability'
  | 'output_tax'
  | 'other_liability'
  | 'overseas_tax_payable';

export interface Account {
  id: ID;
  code: string;
  name: string;
  type: AccountType;
  subType: AccountSubType;
  description?: string;
  system?: boolean; // system accounts cannot be deleted
  active: boolean;
  /** sub-account of another account of the same type */
  parentId?: ID;
  /** show on the dashboard watchlist */
  watchlist?: boolean;
  // bank and credit card accounts (Banking > Add Bank Account or Credit Card)
  accountNumber?: string;
  bankName?: string;
  ifsc?: string;
  currencyCode?: string;
  primary?: boolean;
  attachments?: Attachment[];
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
  hsnSac?: string;
  taxPreference?: 'taxable' | 'exempt' | 'non_gst' | 'out_of_scope';
  /** default GST rate for sales and purchases */
  taxId?: string;
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
  gstTreatment?: string;
  /** place of supply (state) for customers, source of supply for vendors */
  placeOfSupply?: string;
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
  /** GST rate id from shared/gst.ts (gst18, exempt, ...) */
  taxId?: string;
  hsnSac?: string;
  taxAmount?: number; // computed
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
  projectId?: ID;
  /** part of this invoice billed against a fixed-cost project (defaults to the sub total) */
  projectFee?: number;
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
  // GST (India)
  gstTreatment?: string;
  gstin?: string;
  sourceOfSupply?: string;
  destinationOfSupply?: string;
  reverseCharge?: boolean;
  taxInclusive?: boolean;
  // computed
  subTotal: number;
  discountAmount: number;
  tdsAmount: number;
  tcsAmount: number;
  taxAmount?: number;
  taxBreakdown?: TaxBreakdownRow[];
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
  /** PDF template chosen for this document (falls back to the module default) */
  templateId?: string;
  /** values of the module's custom fields, keyed by field id */
  customFields?: Record<string, string>;
  attachments: Attachment[];
  emailRecipients: string[];
  locked: boolean;
  sentAt?: string;
  // approval workflow (see shared/approval.ts)
  approvedAt?: string;
  approvedBy?: string;
  rejection?: { reason?: string; at: string; by: string };
  // customer email and portal
  /** first time the customer opened it through a shared link or the portal */
  viewedAt?: string;
  /** quote accepted/declined by the customer from the portal or a shared link */
  customerResponse?: CustomerResponse;
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
  /** refunds of an excess payment / vendor advance received back from the vendor */
  refunds?: Refund[];
  usedAmount: number;
  refundedAmount?: number;
  unusedAmount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseLine {
  id: ID;
  accountId: ID;
  amount: number;
  notes?: string;
  taxId?: string;
  taxAmount?: number;
}

/** GST fields shared by expenses and recurring expenses. */
export interface ExpenseGst {
  expenseType?: 'goods' | 'service';
  hsnSac?: string;
  gstTreatment?: string;
  vendorGstin?: string;
  sourceOfSupply?: string;
  destinationOfSupply?: string;
  reverseCharge?: boolean;
  taxId?: string;
  /** Amount Is: Tax Inclusive (true) or Tax Exclusive */
  taxInclusive?: boolean;
  /** computed: GST on the expense */
  taxAmount?: number;
  /** computed: amount before tax (what is booked to the expense account) */
  subTotal?: number;
  taxBreakdown?: TaxBreakdownRow[];
}

export interface Expense extends ExpenseGst {
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
  projectId?: ID;
  reportingTags: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringExpense extends ExpenseGst {
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
  projectId?: ID;
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
  | 'bank_transaction'
  | 'manual';

export type ReportingMethod = 'accrual_and_cash' | 'accrual_only' | 'cash_only';

export interface Journal {
  id: ID;
  number: string;
  date: string;
  sourceType: JournalSource;
  sourceId?: ID;
  contactId?: ID;
  projectId?: ID;
  reference?: string;
  notes?: string;
  lines: JournalLine[];
  createdAt: string;
  // manual journals only
  status?: 'draft' | 'published';
  reportingMethod?: ReportingMethod;
  /** date of the auto-created reversing journal */
  reverseDate?: string;
  reversalOf?: ID;
  attachments?: Attachment[];
  locked?: boolean;
  createdBy?: string;
  recurringProfileId?: ID;
  updatedAt?: string;
}

/** Accountant > Journal Vouchers > Templates */
export interface JournalTemplate {
  id: ID;
  name: string;
  reference?: string;
  notes?: string;
  reportingMethod: ReportingMethod;
  /** when false the template keeps accounts and Dr/Cr types only */
  enterAmount: boolean;
  lines: { accountId: ID; description?: string; contactId?: ID; type: 'debit' | 'credit'; amount?: number }[];
  createdAt: string;
}

export interface RecurringJournal {
  id: ID;
  profileName: string;
  repeatEvery: RepeatEvery;
  startOn: string;
  endsOn?: string;
  neverExpires: boolean;
  reference?: string;
  notes?: string;
  reportingMethod: ReportingMethod;
  lines: JournalLine[];
  status: 'active' | 'stopped' | 'expired';
  lastGeneratedDate?: string;
  nextDate?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  /** units of the base currency (INR) per 1 unit */
  rate: number;
}

export interface CurrencyAdjustment {
  id: ID;
  currencyCode: string;
  date: string;
  rate: number;
  notes: string;
  gainOrLoss: number;
  createdAt: string;
}

export type LockModule = 'sales' | 'purchases' | 'banking' | 'accountant';
export interface TransactionLock {
  date: string;
  reason?: string;
  lockedAt: string;
}
export interface TransactionLocks {
  /** "Lock All Transactions At Once" */
  all?: TransactionLock;
  modules: Partial<Record<LockModule, TransactionLock>>;
  history: { module: LockModule | 'all'; action: 'lock' | 'unlock'; date?: string; reason?: string; at: string }[];
}

// ------------------------------------------------------------------ banking

export type BankTxnType =
  | 'deposit'
  | 'other_income'
  | 'interest_income'
  | 'owner_contribution'
  | 'transfer_in'
  | 'expense_refund'
  | 'owner_drawings'
  | 'transfer_out'
  | 'card_payment'
  | 'expense';

/** Money In / Money Out recorded from Banking (transfers, deposits, owner's contribution, drawings...). */
export interface BankTransaction {
  id: ID;
  type: BankTxnType;
  date: string;
  /** the bank/cash/card account the money moved in or out of */
  accountId: ID;
  /** the other side: transfer account, income/equity/expense account */
  offsetAccountId: ID;
  amount: number;
  referenceNumber?: string;
  description?: string;
  contactId?: ID;
  /** statement line this transaction was categorized from */
  statementLineId?: ID;
  attachments?: Attachment[];
  createdAt: string;
  updatedAt?: string;
}

export interface StatementLine {
  id: ID;
  accountId: ID;
  date: string;
  description?: string;
  reference?: string;
  payee?: string;
  /** money in */
  deposit: number;
  /** money out */
  withdrawal: number;
  status: 'uncategorized' | 'categorized' | 'matched' | 'excluded';
  /** transaction this line was categorized as or matched to */
  match?: { type: 'bank_transaction' | 'expense' | 'payment_received' | 'payment_made' | 'manual' | 'journal'; id: ID; journalId?: ID };
  /** rule that recognized the line (pre-filled suggestion) */
  ruleId?: ID;
  importId?: ID;
  createdAt: string;
}

export interface StatementImport {
  id: ID;
  accountId: ID;
  fileName: string;
  lines: number;
  duplicates: number;
  from?: string;
  to?: string;
  /** closing balance read from the statement's balance column */
  closingBalance?: number;
  documentId?: ID;
  createdAt: string;
}

export interface RuleCriterion {
  field: 'description' | 'reference' | 'payee' | 'amount';
  op: 'contains' | 'not_contains' | 'equals' | 'starts_with' | 'ends_with' | 'gt' | 'lt' | 'eq';
  value: string;
}
export interface BankRule {
  id: ID;
  name: string;
  applyTo: 'deposits' | 'withdrawals';
  /** recognized: suggest; categorized: record automatically */
  markAs: 'recognized' | 'categorized';
  match: 'any' | 'all';
  criteria: RuleCriterion[];
  recordAs: BankTxnType;
  offsetAccountId: ID;
  contactId?: ID;
  referenceFrom?: 'none' | 'description' | 'reference';
  /** empty = every bank and card account */
  accountIds: ID[];
  scope: 'all' | 'banks' | 'cards' | 'custom';
  order: number;
  createdAt: string;
}

export interface Reconciliation {
  id: ID;
  accountId: ID;
  startDate: string;
  endDate: string;
  openingBalance: number;
  closingBalance: number;
  /** ledger journal ids (or journal id + line index) cleared in this reconciliation */
  cleared: string[];
  status: 'draft' | 'reconciled';
  createdAt: string;
  reconciledAt?: string;
}

// ------------------------------------------------------------------ documents

export interface DocFolder {
  id: ID;
  name: string;
  permission: 'all' | 'custom';
  userIds?: ID[];
  createdAt: string;
}

export interface DocLink {
  type: string;
  id: ID;
  label: string;
}

/** A file in Documents (inbox upload). Files attached directly to transactions stay on the transaction. */
export interface DocFile extends Attachment {
  inbox: 'files' | 'bank_statements';
  folderId?: ID;
  uploadedBy: string;
  links: DocLink[];
  trashedAt?: string;
  /** bank statement inbox: statement imported into this account */
  importedToAccountId?: ID;
}

export interface SavedReport {
  id: ID;
  name: string;
  report: string;
  params: Record<string, string>;
  hiddenColumns?: string[];
  createdAt: string;
}

export interface ReportSchedule {
  id: ID;
  report: string;
  name: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  format: 'pdf' | 'csv' | 'xls';
  to: string[];
  active: boolean;
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
  bcc?: string[];
  replyTo?: string;
  subject: string;
  /** plain-text body as written (placeholders filled) */
  body: string;
  /** branded HTML that was sent (kept so the log can show exactly what the customer saw) */
  html?: string;
  attachments: string[];
  templateId?: string;
  /** sent: accepted by the mail server; outbox: no mail server set up, kept here only; failed: the server refused it */
  status?: 'sent' | 'outbox' | 'failed';
  error?: string;
  provider?: 'google-oauth' | 'smtp' | 'outbox';
  /** link included in the email, if any */
  shareLinkId?: ID;
  delivered?: boolean; // false when no mail server was configured (recorded only)
  /** system: invites, resets and notifications rather than a composed email */
  system?: boolean;
  createdAt: string;
}

export interface ShareLink {
  id: ID;
  token: string;
  entityType: DocKind | 'payment_received';
  entityId: ID;
  expiresOn?: string;
  active: boolean;
  /** created by the composer for the email's "View" button */
  source?: 'manual' | 'email';
  views?: number;
  lastViewedAt?: string;
  createdAt: string;
}

export type ProjectBillingMethod = 'fixed' | 'project_hours' | 'task_hours' | 'staff_hours';
export type ProjectBudgetHours = 'none' | 'total' | 'per_task' | 'per_staff';

/** People who log time. */
export interface User {
  id: ID;
  name: string;
  email?: string;
  role: 'Admin' | 'Staff' | 'Timesheet Staff';
  /** pending: signed up and waiting for an admin to approve; invited: sign-in link sent, no password yet */
  status: 'active' | 'inactive' | 'pending' | 'invited';
  createdAt: string;
  // sign-in (never sent to the client)
  passwordHash?: string;
  lastLoginAt?: string;
  failedLogins?: number;
  lockedUntil?: string;
  resetTokenHash?: string;
  resetExpiresAt?: string;
  inviteTokenHash?: string;
  inviteExpiresAt?: string;
  approvedAt?: string;
}

/** A signed-in browser session of a team member (cookie holds the token; only its hash is stored). */
export interface StaffSession {
  id: ID;
  tokenHash: string;
  userId: ID;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  userAgent?: string;
}

export interface ProjectTask {
  id: ID;
  name: string;
  description?: string;
  /** used by "Based on Task Hours" */
  ratePerHour?: number;
  /** used when the hours budget is per task */
  budgetHours?: number;
  billable: boolean;
}

export interface ProjectUser {
  userId: ID;
  /** used by "Based on Staff Hours" */
  ratePerHour?: number;
  /** used when the hours budget is per staff */
  budgetHours?: number;
}

export interface Project {
  id: ID;
  name: string;
  code?: string;
  customerId?: ID;
  billingMethod: ProjectBillingMethod;
  /** Fixed: total project cost. Project hours: rate per hour. Unused for task/staff hours. */
  rate: number;
  description?: string;
  costBudget?: number;
  revenueBudget?: number;
  budgetHoursType?: ProjectBudgetHours;
  /** total project hours when budgetHoursType is 'total' */
  budgetHours?: number;
  users: ProjectUser[];
  tasks: ProjectTask[];
  watchlist: boolean;
  attachments: Attachment[];
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt?: string;
}

export interface TimeEntry {
  id: ID;
  projectId: ID;
  taskId?: ID;
  /** legacy free-text task name for entries logged before tasks existed */
  task?: string;
  userId?: ID;
  date: string;
  /** decimal hours; the UI shows HH:MM */
  hours: number;
  startTime?: string;
  endTime?: string;
  notes?: string;
  billable: boolean;
  invoiced: boolean;
  invoiceId?: ID;
  createdAt: string;
  updatedAt?: string;
}

/** The running timer (one per user). Elapsed = accumulatedMs + (now - startedAt) while running. */
export interface RunningTimer {
  id: ID;
  userId: ID;
  projectId?: ID;
  taskId?: ID;
  notes?: string;
  billable: boolean;
  /** when set, stopping the timer adds the time to this entry (row "Start" in the timesheet) */
  entryId?: ID;
  startedAt?: string;
  accumulatedMs: number;
  running: boolean;
  createdAt: string;
}

export type BudgetPeriod = 'monthly' | 'quarterly' | 'half_yearly' | 'yearly';
export interface BudgetLine {
  accountId: ID;
  /** one amount per period bucket, in order */
  amounts: number[];
}
export interface Budget {
  id: ID;
  name: string;
  /** first day of the fiscal year, e.g. 2026-04-01 */
  fiscalYearStart: string;
  period: BudgetPeriod;
  projectId?: ID;
  includeBalanceSheet: boolean;
  lines: BudgetLine[];
  createdAt: string;
  updatedAt?: string;
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
  emailTemplates: EmailTemplate[];
  portalUsers: PortalUser[];
  portalSessions: PortalSession[];
  staffSessions: StaffSession[];
  paymentNotices: PaymentNotice[];
  projects: Project[];
  timeEntries: TimeEntry[];
  users: User[];
  timers: RunningTimer[];
  budgets: Budget[];
  manualJournals: Journal[];
  journalTemplates: JournalTemplate[];
  recurringJournals: RecurringJournal[];
  currencies: Currency[];
  currencyAdjustments: CurrencyAdjustment[];
  transactionLocks: TransactionLocks;
  bankTransactions: BankTransaction[];
  statementLines: StatementLine[];
  statementImports: StatementImport[];
  bankRules: BankRule[];
  reconciliations: Reconciliation[];
  documents: DocFile[];
  docFolders: DocFolder[];
  savedReports: SavedReport[];
  reportSchedules: ReportSchedule[];
  counters: Record<string, number>;
  preferences: Record<string, unknown>;
  pdfTemplates: PdfTemplate[];
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
