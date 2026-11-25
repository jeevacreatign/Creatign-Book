import type { DocKind } from './types';

export interface DocMeta {
  kind: DocKind;
  side: 'sales' | 'purchase';
  label: string; // "Invoice"
  plural: string; // "Invoices"
  prefix: string; // number prefix
  numberLabel: string; // "Invoice#"
  dateLabel: string;
  path: string; // client route
  title: string; // PDF heading
  recurring?: boolean;
  /** document posts to the general ledger */
  posts?: boolean;
  initialStatus: string;
}

export const DOC_META: Record<DocKind, DocMeta> = {
  quote: { kind: 'quote', side: 'sales', label: 'Estimate', plural: 'Estimates', prefix: 'QT-', numberLabel: 'Estimate#', dateLabel: 'Estimate Date', path: '/sales/quotes', title: 'ESTIMATE', initialStatus: 'draft' },
  sales_order: { kind: 'sales_order', side: 'sales', label: 'Sales Order', plural: 'Sales Orders', prefix: 'SO-', numberLabel: 'Sales Order#', dateLabel: 'Sales Order Date', path: '/sales/sales-orders', title: 'SALES ORDER', initialStatus: 'draft' },
  invoice: { kind: 'invoice', side: 'sales', label: 'Invoice', plural: 'Invoices', prefix: 'INV-', numberLabel: 'Invoice#', dateLabel: 'Invoice Date', path: '/sales/invoices', title: 'TAX INVOICE', posts: true, initialStatus: 'draft' },
  recurring_invoice: { kind: 'recurring_invoice', side: 'sales', label: 'Invoice Schedule', plural: 'Invoice Schedules', prefix: 'RI-', numberLabel: 'Profile Name', dateLabel: 'Start On', path: '/sales/recurring-invoices', title: 'INVOICE SCHEDULE', recurring: true, initialStatus: 'active' },
  delivery_challan: { kind: 'delivery_challan', side: 'sales', label: 'Delivery Challan', plural: 'Delivery Challans', prefix: 'DC-', numberLabel: 'Delivery Challan#', dateLabel: 'Delivery Challan Date', path: '/sales/delivery-challans', title: 'DELIVERY CHALLAN', initialStatus: 'draft' },
  credit_note: { kind: 'credit_note', side: 'sales', label: 'Credit Note', plural: 'Credit Notes', prefix: 'CN-', numberLabel: 'Credit Note#', dateLabel: 'Credit Note Date', path: '/sales/credit-notes', title: 'CREDIT NOTE', posts: true, initialStatus: 'draft' },
  purchase_order: { kind: 'purchase_order', side: 'purchase', label: 'Purchase Order', plural: 'Purchase Orders', prefix: 'PO-', numberLabel: 'Purchase Order#', dateLabel: 'Date', path: '/purchases/purchase-orders', title: 'PURCHASE ORDER', initialStatus: 'draft' },
  bill: { kind: 'bill', side: 'purchase', label: 'Bill', plural: 'Bills', prefix: 'BILL-', numberLabel: 'Bill#', dateLabel: 'Bill Date', path: '/purchases/bills', title: 'BILL', posts: true, initialStatus: 'open' },
  recurring_bill: { kind: 'recurring_bill', side: 'purchase', label: 'Bill Schedule', plural: 'Bill Schedules', prefix: 'RB-', numberLabel: 'Profile Name', dateLabel: 'Start On', path: '/purchases/recurring-bills', title: 'BILL SCHEDULE', recurring: true, initialStatus: 'active' },
  vendor_credit: { kind: 'vendor_credit', side: 'purchase', label: 'Debit Note', plural: 'Debit Notes', prefix: 'VC-', numberLabel: 'Credit Note#', dateLabel: 'Debit Note Date', path: '/purchases/vendor-credits', title: 'DEBIT NOTE', posts: true, initialStatus: 'draft' },
};

export const ACCOUNT_IDS = {
  pettyCash: 'acc_petty_cash',
  undepositedFunds: 'acc_undeposited',
  bank: 'acc_bank_hdfc',
  ar: 'acc_ar',
  ap: 'acc_ap',
  tdsReceivable: 'acc_tds_receivable',
  tdsPayable: 'acc_tds_payable',
  tcsReceivable: 'acc_tcs_receivable',
  tcsPayable: 'acc_tcs_payable',
  sales: 'acc_sales',
  generalIncome: 'acc_general_income',
  discount: 'acc_discount',
  otherCharges: 'acc_other_charges',
  cogs: 'acc_cogs',
  purchaseDiscount: 'acc_purchase_discount',
  bankCharges: 'acc_bank_charges',
  badDebt: 'acc_bad_debt',
  openingBalanceAdj: 'acc_opening_adj',
  ownersEquity: 'acc_owners_equity',
  officeSupplies: 'acc_office_supplies',
  travel: 'acc_travel',
  rent: 'acc_rent',
  internet: 'acc_internet',
  fuel: 'acc_fuel',
  salaries: 'acc_salaries',
  advertising: 'acc_advertising',
  prepaid: 'acc_prepaid',
  employeeAdvance: 'acc_employee_advance',
} as const;
