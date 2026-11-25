import type { Account, Contact, Database, Item } from '../shared/types';
import { addDays, today } from '../shared/format';
import { ACCOUNT_IDS as A } from '../shared/docmeta';
import { builtInTemplates } from '../shared/pdfTemplate';
import { builtInEmailTemplates } from '../shared/email';

const ts = () => new Date().toISOString();

function acc(id: string, code: string, name: string, type: Account['type'], subType: Account['subType'], description?: string): Account {
  return { id, code, name, type, subType, description, system: true, active: true };
}

export const DEFAULT_ACCOUNTS: Account[] = [
  acc(A.pettyCash, '1000', 'Petty Cash', 'asset', 'cash', 'Small cash on hand for day-to-day expenses'),
  acc(A.undepositedFunds, '1010', 'Undeposited Funds', 'asset', 'cash', 'Payments received but not yet deposited'),
  { ...acc(A.bank, '1020', 'HDFC Current Account', 'asset', 'bank'), bankName: 'HDFC Bank', currencyCode: 'INR', primary: true },
  acc(A.ar, '1100', 'Accounts Receivable', 'asset', 'accounts_receivable'),
  acc(A.tdsReceivable, '1150', 'TDS Receivable', 'asset', 'other_current_asset', 'Tax deducted at source by clients'),
  acc(A.tcsReceivable, '1160', 'TCS Receivable', 'asset', 'other_current_asset', 'Tax collected at source by suppliers'),
  acc(A.prepaid, '1170', 'Prepaid Expenses', 'asset', 'other_current_asset'),
  acc(A.employeeAdvance, '1180', 'Employee Advance', 'asset', 'other_current_asset'),
  acc('acc_input_cgst', '1190', 'Input CGST', 'asset', 'other_current_asset', 'CGST paid on purchases (input tax credit)'),
  acc('acc_input_sgst', '1191', 'Input SGST', 'asset', 'other_current_asset', 'SGST paid on purchases (input tax credit)'),
  acc('acc_input_igst', '1192', 'Input IGST', 'asset', 'other_current_asset', 'IGST paid on purchases (input tax credit)'),
  acc('acc_furniture', '1500', 'Furniture and Equipment', 'asset', 'fixed_asset'),
  acc(A.ap, '2000', 'Accounts Payable', 'liability', 'accounts_payable'),
  acc(A.tdsPayable, '2100', 'TDS Payable', 'liability', 'other_current_liability', 'TDS withheld from suppliers'),
  acc(A.tcsPayable, '2110', 'TCS Payable', 'liability', 'other_current_liability', 'TCS collected from clients'),
  acc('acc_gst_payable', '2120', 'GST Payable', 'liability', 'other_current_liability'),
  acc('acc_output_cgst', '2130', 'Output CGST', 'liability', 'other_current_liability', 'CGST collected on sales'),
  acc('acc_output_sgst', '2131', 'Output SGST', 'liability', 'other_current_liability', 'SGST collected on sales'),
  acc('acc_output_igst', '2132', 'Output IGST', 'liability', 'other_current_liability', 'IGST collected on sales'),
  acc('acc_rcm_payable', '2140', 'Reverse Charge Tax Payable', 'liability', 'other_current_liability', 'GST payable by you on purchases under reverse charge'),
  acc(A.ownersEquity, '3000', "Owner's Equity", 'equity', 'equity'),
  acc(A.openingBalanceAdj, '3100', 'Opening Balance Adjustments', 'equity', 'equity'),
  acc('acc_retained', '3200', 'Retained Earnings', 'equity', 'equity'),
  acc(A.sales, '4000', 'Sales', 'income', 'income'),
  acc(A.generalIncome, '4100', 'General Income', 'income', 'income'),
  acc(A.otherCharges, '4200', 'Other Charges', 'income', 'other_income', 'Adjustments and round-off on sales documents'),
  acc('acc_interest_income', '4300', 'Interest Income', 'income', 'other_income'),
  acc(A.discount, '4900', 'Discount', 'income', 'income', 'Contra income: discounts given to clients'),
  acc(A.cogs, '5000', 'Cost of Goods Sold', 'expense', 'cost_of_goods_sold'),
  acc(A.purchaseDiscount, '5050', 'Purchase Discounts', 'expense', 'cost_of_goods_sold', 'Contra expense: discounts received from suppliers'),
  acc(A.advertising, '6000', 'Advertising And Marketing', 'expense', 'expense'),
  acc(A.bankCharges, '6010', 'Bank Fees and Charges', 'expense', 'expense'),
  acc(A.badDebt, '6020', 'Bad Debt', 'expense', 'expense'),
  acc(A.officeSupplies, '6030', 'Office Supplies', 'expense', 'expense'),
  acc(A.rent, '6040', 'Rent Expense', 'expense', 'expense'),
  acc(A.internet, '6050', 'IT and Internet Expenses', 'expense', 'expense'),
  acc(A.travel, '6060', 'Travel Expense', 'expense', 'expense'),
  acc(A.fuel, '6070', 'Fuel/Mileage Expenses', 'expense', 'expense'),
  acc(A.salaries, '6080', 'Salaries and Employee Wages', 'expense', 'expense'),
  acc('acc_repairs', '6090', 'Repairs and Maintenance', 'expense', 'expense'),
  acc('acc_printing', '6100', 'Printing and Stationery', 'expense', 'expense'),
  acc('acc_meals', '6110', 'Meals and Entertainment', 'expense', 'expense'),
  acc('acc_other_expense', '6900', 'Other Expenses', 'expense', 'other_expense', 'Adjustments and round-off on purchase documents'),
];

export const DEFAULT_CURRENCIES = [
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', rate: 1 },
  { code: 'USD', name: 'United States Dollar', symbol: '$', rate: 84.5 },
  { code: 'EUR', name: 'Euro', symbol: '€', rate: 89.2 },
  { code: 'GBP', name: 'Pound Sterling', symbol: '£', rate: 106.4 },
  { code: 'AED', name: 'UAE Dirham', symbol: 'AED', rate: 23.0 },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', rate: 63.1 },
];

function contact(p: Partial<Contact> & Pick<Contact, 'id' | 'kind' | 'displayName'>): Contact {
  return {
    customerType: 'business',
    language: 'English',
    currencyCode: 'INR',
    accountId: p.kind === 'customer' ? A.ar : A.ap,
    openingBalance: 0,
    paymentTerms: 'due_on_receipt',
    portalEnabled: false,
    billingAddress: {},
    shippingAddress: {},
    contactPersons: [],
    bankDetails: [],
    customFields: {},
    reportingTags: {},
    documents: [],
    status: 'active',
    createdAt: ts(),
    updatedAt: ts(),
    ...p,
  };
}

function item(p: Partial<Item> & Pick<Item, 'id' | 'name'>): Item {
  return {
    type: 'service',
    sellable: true,
    sellingPrice: 0,
    salesAccountId: A.sales,
    purchasable: true,
    costPrice: 0,
    purchaseAccountId: A.cogs,
    status: 'active',
    createdAt: ts(),
    updatedAt: ts(),
    ...p,
  };
}

export function seedDatabase({ withSamples }: { withSamples: boolean }): Database {
  const db: Database = {
    organization: {
      id: 'org_creatign',
      name: 'Creatign',
      email: 'info@creatign.in',
      state: 'Tamil Nadu',
      country: 'India',
      currencyCode: 'INR',
      currencySymbol: '₹',
      dateFormat: 'dd/MM/yyyy',
      fiscalYearStartMonth: 4,
      address: { state: 'Tamil Nadu', country: 'India' },
      logoText: 'C',
    },
    accounts: DEFAULT_ACCOUNTS.map((a) => ({ ...a })),
    items: [],
    contacts: [],
    docs: [],
    paymentsReceived: [],
    paymentsMade: [],
    expenses: [],
    recurringExpenses: [],
    journals: [],
    comments: [],
    activities: [],
    mails: [],
    shareLinks: [],
    emailTemplates: builtInEmailTemplates(),
    portalUsers: [],
    portalSessions: [],
    staffSessions: [],
    paymentNotices: [],
    projects: [],
    timeEntries: [],
    users: [{ id: 'usr_admin', name: 'Jeeva V', email: 'accounts@creatign.example', role: 'Admin', status: 'active', createdAt: ts() }],
    timers: [],
    budgets: [],
    manualJournals: [],
    journalTemplates: [],
    recurringJournals: [],
    currencies: DEFAULT_CURRENCIES.map((c) => ({ ...c })),
    currencyAdjustments: [],
    transactionLocks: { modules: {}, history: [] },
    bankTransactions: [],
    statementLines: [],
    statementImports: [],
    bankRules: [],
    reconciliations: [],
    documents: [],
    docFolders: [],
    savedReports: [],
    reportSchedules: [],
    counters: {},
    pdfTemplates: builtInTemplates(),
    preferences: {
      defaultTemplates: {},
      salespersons: ['Jeeva'],
      challanTypes: ['Supply of Liquid Gas', 'Job Work', 'Supply on Approval', 'Others'],
      deliveryMethods: ['Courier', 'Hand Delivery', 'Road Transport', 'Air Freight'],
      quoteTerms: '',
      invoiceTerms: 'Payment is due as per the payment terms mentioned above.',
      customerNotes: 'Thanks for your business.',
      quoteNotes: 'Looking forward for your business.',
      mileageRatePerKm: 8,
    },
  };

  if (withSamples) {
    db.items.push(
      item({ id: 'item_web', name: 'Website Design', type: 'service', unit: 'nos', sellingPrice: 45000, costPrice: 20000, salesDescription: 'Responsive website design and development', purchaseDescription: 'Outsourced front-end work' }),
      item({ id: 'item_logo', name: 'Logo Design', type: 'service', unit: 'nos', sellingPrice: 8000, costPrice: 3000, salesDescription: 'Brand mark with 3 revisions' }),
      item({ id: 'item_brochure', name: 'Printed Brochure', type: 'goods', unit: 'pcs', sellingPrice: 25, costPrice: 12, salesDescription: 'A4 tri-fold, 170gsm art paper', purchaseDescription: 'Offset print run', preferredVendorId: 'ven_murugan' }),
      item({ id: 'item_hosting', name: 'Annual Hosting', type: 'service', unit: 'nos', sellingPrice: 6000, costPrice: 3500, salesDescription: '12 months managed hosting', preferredVendorId: 'ven_cloudhost' }),
    );
    db.contacts.push(
      contact({ id: 'cus_test', kind: 'customer', displayName: 'Test Company', companyName: 'Test Company', salutation: 'Mr.', firstName: 'Arun', lastName: 'Kumar', email: 'accounts@testcompany.in', workPhone: '+91 44 2345 6789', mobile: '+91 98400 12345', billingAddress: { street1: '12, Anna Salai', city: 'Chennai', state: 'Tamil Nadu', pin: '600002', country: 'India' }, shippingAddress: { street1: '12, Anna Salai', city: 'Chennai', state: 'Tamil Nadu', pin: '600002', country: 'India' }, paymentTerms: 'net_15' }),
      contact({ id: 'cus_ananya', kind: 'customer', displayName: 'Ananya Textiles', companyName: 'Ananya Textiles Pvt Ltd', firstName: 'Ananya', lastName: 'R', email: 'ananya@ananyatextiles.in', workPhone: '+91 421 220 3344', billingAddress: { street1: '45, Avinashi Road', city: 'Tiruppur', state: 'Tamil Nadu', pin: '641603', country: 'India' }, paymentTerms: 'net_30' }),
      contact({ id: 'ven_murugan', kind: 'vendor', displayName: 'Sri Murugan Printers', companyName: 'Sri Murugan Printers', firstName: 'Murugan', email: 'orders@srimuruganprinters.in', workPhone: '+91 422 255 6677', billingAddress: { street1: '8, Oppanakara Street', city: 'Coimbatore', state: 'Tamil Nadu', pin: '641001', country: 'India' }, msmeRegistered: true, paymentTerms: 'net_30', gstTreatment: 'registered_business', gstin: '33AAKFS1234M1Z5', placeOfSupply: 'Tamil Nadu' }),
      contact({ id: 'ven_cloudhost', kind: 'vendor', displayName: 'CloudHost India', companyName: 'CloudHost India LLP', email: 'billing@cloudhost.example', paymentTerms: 'due_on_receipt', gstTreatment: 'registered_business', gstin: '29AAGFC1234K1Z2', placeOfSupply: 'Karnataka' }),
    );
    db.users.push({ id: 'usr_priya', name: 'Priya S', email: 'priya@creatign.example', role: 'Staff', status: 'active', createdAt: ts() });
    db.projects.push(
      {
        id: 'prj_site',
        name: 'Test Project',
        code: 'TP-01',
        customerId: 'cus_test',
        billingMethod: 'project_hours',
        rate: 1500,
        description: 'Company website redesign',
        budgetHoursType: 'total',
        budgetHours: 40,
        users: [{ userId: 'usr_admin' }, { userId: 'usr_priya' }],
        tasks: [
          { id: 'tsk_design', name: 'Design', description: 'Wireframes and visual design', billable: true },
          { id: 'tsk_dev', name: 'Development', description: 'Front-end build', billable: true },
          { id: 'tsk_meet', name: 'Client meetings', billable: false },
        ],
        watchlist: true,
        attachments: [],
        status: 'active',
        createdAt: ts(),
      },
      {
        id: 'prj_brand',
        name: 'Brand Refresh',
        code: 'BR-01',
        customerId: 'cus_ananya',
        billingMethod: 'fixed',
        rate: 100000,
        description: 'Logo, colours and stationery',
        budgetHoursType: 'none',
        users: [{ userId: 'usr_admin' }],
        tasks: [{ id: 'tsk_logo', name: 'Logo design', billable: true }],
        watchlist: false,
        attachments: [],
        status: 'active',
        createdAt: ts(),
      },
    );
    const te = (id: string, projectId: string, taskId: string, userId: string, daysAgo: number, hours: number, notes?: string, billable = true) =>
      db.timeEntries.push({ id, projectId, taskId, userId, date: addDays(today(), -daysAgo), hours, notes, billable, invoiced: false, createdAt: ts() });
    te('te_1', 'prj_site', 'tsk_design', 'usr_admin', 3, 2.5, 'Home page wireframes');
    te('te_2', 'prj_site', 'tsk_design', 'usr_priya', 2, 3, 'Visual design');
    te('te_3', 'prj_site', 'tsk_dev', 'usr_priya', 1, 4.25, 'Header and footer');
    te('te_4', 'prj_site', 'tsk_meet', 'usr_admin', 1, 1, 'Weekly review', false);
    te('te_5', 'prj_brand', 'tsk_logo', 'usr_admin', 0, 2, 'Logo concepts');
  }
  return db;
}
