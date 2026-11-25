// Accountant module metadata shared by the API and the client: account types,
// reporting methods, transaction-locking modules and journal helpers.
import type { AccountSubType, AccountType, BankTxnType, LockModule, ReportingMethod } from './types';

export interface AccountTypeInfo {
  subType: AccountSubType;
  type: AccountType;
  label: string;
  group: 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense';
  hint: string;
}

/** "Account Type" list, in the order of the Create Account dropdown. */
export const ACCOUNT_TYPES: AccountTypeInfo[] = [
  { subType: 'other_asset', type: 'asset', group: 'Asset', label: 'Other Asset', hint: 'Track special assets like goodwill and other intangible assets' },
  { subType: 'other_current_asset', type: 'asset', group: 'Asset', label: 'Other Current Asset', hint: 'Any short term asset that can be converted into cash within a year: prepaid expenses, advances, deposits' },
  { subType: 'cash', type: 'asset', group: 'Asset', label: 'Cash', hint: 'To keep track of cash and other cash equivalents like petty cash and undeposited funds' },
  { subType: 'bank', type: 'asset', group: 'Asset', label: 'Bank', hint: 'To keep track of bank accounts like savings, current and over-draft accounts' },
  { subType: 'fixed_asset', type: 'asset', group: 'Asset', label: 'Fixed Asset', hint: 'Any long term investment or an asset that cannot be converted into cash easily: land, buildings, furniture, vehicles' },
  { subType: 'stock', type: 'asset', group: 'Asset', label: 'Stock', hint: 'To keep track of your inventory assets' },
  { subType: 'payment_clearing', type: 'asset', group: 'Asset', label: 'Payment Clearing Account', hint: 'To keep track of funds moving in and out via payment processors like Stripe or Razorpay' },
  { subType: 'input_tax', type: 'asset', group: 'Asset', label: 'Input Tax', hint: 'Any tax paid on purchases that can be claimed as input tax credit' },
  { subType: 'accounts_receivable', type: 'asset', group: 'Asset', label: 'Accounts Receivable', hint: 'Money owed to you by clients' },
  { subType: 'credit_card', type: 'liability', group: 'Liability', label: 'Credit Card', hint: 'Create a credit card account to track your card spends' },
  { subType: 'long_term_liability', type: 'liability', group: 'Liability', label: 'Long Term Liability', hint: 'Liabilities that mature after a minimum period of one year: notes payable, debentures, long term loans' },
  { subType: 'other_current_liability', type: 'liability', group: 'Liability', label: 'Other Current Liability', hint: 'Any short term liability: client deposits, tax payable' },
  { subType: 'overseas_tax_payable', type: 'liability', group: 'Liability', label: 'Overseas Tax Payable', hint: 'Track taxes charged on digital services sold to overseas clients' },
  { subType: 'output_tax', type: 'liability', group: 'Liability', label: 'Output Tax', hint: 'Any tax collected on sales that is payable to the government' },
  { subType: 'other_liability', type: 'liability', group: 'Liability', label: 'Other Liability', hint: 'Obligations that do not fit in the other liability types' },
  { subType: 'accounts_payable', type: 'liability', group: 'Liability', label: 'Accounts Payable', hint: 'Money you owe your suppliers' },
  { subType: 'equity', type: 'equity', group: 'Equity', label: 'Equity', hint: "Owner's or stakeholders' interest in the assets of the business after deducting all the liabilities" },
  { subType: 'income', type: 'income', group: 'Income', label: 'Income', hint: 'Income or revenue earned from normal business activities' },
  { subType: 'other_income', type: 'income', group: 'Income', label: 'Other Income', hint: 'Income or revenue earned from activities not directly related to your business: interest, dividends' },
  { subType: 'expense', type: 'expense', group: 'Expense', label: 'Expense', hint: 'Reflects expenditure incurred for running normal business operations' },
  { subType: 'cost_of_goods_sold', type: 'expense', group: 'Expense', label: 'Cost Of Goods Sold', hint: 'Direct costs attributable to the production of the goods sold' },
  { subType: 'other_expense', type: 'expense', group: 'Expense', label: 'Other Expense', hint: 'Expenses not directly related to your business: depreciation, interest paid' },
];

export const accountTypeLabel = (subType?: string) => ACCOUNT_TYPES.find((t) => t.subType === subType)?.label ?? (subType || '').replace(/_/g, ' ');
export const typeOfSubType = (subType: string): AccountType | undefined => ACCOUNT_TYPES.find((t) => t.subType === subType)?.type;

export const REPORTING_METHODS: { value: ReportingMethod; label: string }[] = [
  { value: 'accrual_and_cash', label: 'Accrual and Cash' },
  { value: 'accrual_only', label: 'Accrual Only' },
  { value: 'cash_only', label: 'Cash Only' },
];
export const reportingMethodLabel = (m?: ReportingMethod) => REPORTING_METHODS.find((x) => x.value === (m || 'accrual_and_cash'))!.label;

export const LOCK_MODULES: { value: LockModule; label: string; hint: string }[] = [
  { value: 'sales', label: 'Sales', hint: 'Estimates, sales orders, invoices, delivery challans, credit notes and payments received' },
  { value: 'purchases', label: 'Purchases', hint: 'Purchase orders, bills, debit notes, expenses and supplier payments' },
  { value: 'banking', label: 'Banking', hint: 'Transfers, deposits, statement categorization and other transactions recorded from Banking' },
  { value: 'accountant', label: 'Accountant', hint: 'Manual journals and base currency adjustments' },
];

export interface BankTxnTypeInfo {
  value: BankTxnType;
  label: string;
  direction: 'in' | 'out';
  /** which accounts the "other side" picker offers */
  offset: 'bank' | 'income' | 'equity' | 'expense' | 'card' | 'any';
}

export const BANK_TXN_TYPES: BankTxnTypeInfo[] = [
  { value: 'deposit', label: 'Deposit', direction: 'in', offset: 'any' },
  { value: 'transfer_in', label: 'Transfer From Another Account', direction: 'in', offset: 'bank' },
  { value: 'owner_contribution', label: "Owner's Contribution", direction: 'in', offset: 'equity' },
  { value: 'other_income', label: 'Other Income', direction: 'in', offset: 'income' },
  { value: 'interest_income', label: 'Interest Income', direction: 'in', offset: 'income' },
  { value: 'expense_refund', label: 'Expense Refund', direction: 'in', offset: 'expense' },
  { value: 'expense', label: 'Expense', direction: 'out', offset: 'expense' },
  { value: 'transfer_out', label: 'Transfer To Another Account', direction: 'out', offset: 'bank' },
  { value: 'card_payment', label: 'Card Payment', direction: 'out', offset: 'card' },
  { value: 'owner_drawings', label: 'Owner Drawings', direction: 'out', offset: 'equity' },
];
export const bankTxnLabel = (t?: string) => BANK_TXN_TYPES.find((x) => x.value === t)?.label ?? (t || '').replace(/_/g, ' ');

/** True for bank, cash and credit card accounts (the accounts Banking shows). */
export const isBankingAccount = (a: { subType: string }) => a.subType === 'bank' || a.subType === 'cash' || a.subType === 'credit_card' || a.subType === 'payment_clearing';
