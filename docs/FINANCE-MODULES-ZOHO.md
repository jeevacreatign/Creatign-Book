# Banking, Accountant, Reports and Documents: Zoho Books vs Creatign Books

Sources: the 42 Zoho Books screenshots in the reference document (Creatign trial org, India edition, Nov 2026) and the Zoho Books help pages for
[match and categorize](https://www.zoho.com/books/help/banking/match-categorize.html),
[transaction rules](https://www.zoho.com/us/books/help/banking/transaction-rule.md),
[GST returns](https://www.zoho.com/in/books/kb/gst/gst-returns.html),
[GSTR-3B contents](https://www.zoho.com/ae/books/kb/gst/gst-3b-contents.html) and the
[reports KB](https://www.zoho.com/in/books/kb/reports).

"Before" is Creatign Books on main after PR #10. "After" is this change.

## 1. Banking

| Zoho Books feature | Before | After |
|---|---|---|
| Banking Overview: account cards, "All Accounts" balance chart (last 30 days etc.), Add Bank Account or Credit Card, Manage Transaction Rules, More menu | Cards for cash/bank/card accounts and one ledger table | Overview with totals, balance-over-time chart with period picker, per-account rows (balance in books, balance per bank statement, uncategorized count) |
| Add Bank Account or Credit Card: type Bank / Credit Card, name, code, currency, account number, bank name, IFSC, description, primary account | Generic account modal | Dedicated form with all of these fields, edit, mark inactive, delete |
| Connect bank feeds (Yodlee, partner banks) | None | Not possible without a feed provider contract. Statement import (CSV) and the Documents > Bank Statements inbox cover the same flow |
| Import statement: upload CSV/TSV, map columns (date, description, reference, withdrawals, deposits or a signed amount), date format, preview | None | Done, with a mapping step and duplicate detection |
| Uncategorized transactions with Match (suggested ledger transactions with the same amount near the date) and Categorize | None | Done. Match links a statement line to an existing payment, expense, journal or transfer. Categorize creates the transaction |
| Categorize as: Expense, Vendor Payment, Transfer To/From Another Account, Card Payment, Owner Drawings, Owner's Contribution, Customer Payment, Deposit/Other Income, Interest Income, Refund | None | Done (customer and vendor payments are recorded as real Payments Received / Payments Made) |
| Exclude / restore / delete statement lines, uncategorize | None | Done |
| Manual "Add transaction" from the account (Money In / Money Out) | None | Done |
| Transfer funds between accounts | None | Done (transfer transaction posts Dr destination / Cr source) |
| Transaction rules: name, apply to Deposits or Withdrawals, mark as Recognized or Categorized, any/all criteria (description, reference, payee, amount), record as, account, reference, associated accounts | None | Done. Rules run on import and on demand; "Recognized" pre-fills the categorize form, "Categorized" records it automatically |
| Reconcile: statement period, closing balance, tick cleared transactions, difference must be zero, history, undo | None | Done; reconciled transactions show a lock and cannot be uncleared except by undoing the reconciliation |
| Auto-upload bank statements from email | None | Not built: needs an inbound mail server. Upload works from Documents and Banking |

## 2. Accountant

| Zoho Books feature | Before | After |
|---|---|---|
| Manual Journals list: period filter, Journal#, reference, status (Draft/Published), notes icon, amount, created by, reporting method | Simple table mixing system journals | Zoho list and split view, status and period filters, sort, export CSV |
| New Journal: date, reverse journal date, journal# with auto numbering, reference, notes (required), reporting method (Accrual and Cash / Accrual Only / Cash Only), currency, lines with account, description, contact, debits, credits, sub total, difference, attachments, Save and Publish / Save as Draft | Date, reference, notes, project, lines | All fields. Drafts stay out of the ledger. Reporting method drives cash vs accrual reports |
| Journal detail: Overview / Activity Logs, Edit, PDF/Print, More: Clone, Clone Reverse Entry, Create Reverse Journal, Create Template, Delete, Lock Journal | View and delete | All of these |
| Journal templates: list (Use, Edit, Delete), New Template with "Enter an amount" toggle and Dr/Cr type per line; New > Create from Template | None | Done |
| Recurring journals | None | Profiles (repeat every n days/weeks/months/years, start, end or never expires), generated on boot and on demand, stop/resume |
| Bulk Update: filter by account (required), contact, date range, amount range across invoices, credit notes, purchase orders, expenses, bills, vendor credits, then move to a new account | None | Done |
| Base Currency Adjustments: list with date filter, New: currency, date, exchange rate, notes | None | Currencies and exchange rates are recorded and adjustments are listed. Gain/loss is 0 because Creatign Books records every transaction in INR (no foreign currency transactions yet) |
| Chart of Accounts: Active/Inactive/All and per-type views, lock icon on system accounts, account code, type, documents, parent account, search, bulk activate/deactivate/delete | Flat table | Done, with parent (sub) accounts and per-type views |
| Create Account: full Zoho type list with descriptions (Other Asset, Other Current Asset, Cash, Bank, Fixed Asset, Stock, Payment Clearing, Input Tax, Credit Card, Long Term Liability, Other Current Liability, Overseas Tax Payable, Output Tax, Other Liability, Equity, Income, Other Income, Expense, Cost of Goods Sold, Other Expense), code, description, watchlist | Two selects | Done |
| Account detail: closing balance (Dr/Cr), description, recent transactions, Show more details (account transactions report), attachments | Jumped to general ledger | Split view with all of these |
| Budgets: list (name, fiscal year, period), New Budget (name, FY, Monthly/Quarterly/Half-yearly/Yearly, income and expense accounts, include asset/liability/equity), grid per period, Budget vs Actuals with budget, actual, over budget, basis, export | Only inside projects | Standalone module with the grid editor, Budget vs Actuals report and export |
| Transaction Locking: Sales, Purchases, Banking, Accountant lock date and reason, unlock, Lock All Transactions At Once, negative-stock setting | None | Locking per module and lock-all, enforced by the API on create, edit and delete. The negative-stock option is not applicable (no inventory tracking) |

## 3. Reports

Zoho shows 82 system reports in the Reports Center with Home, Favorites, Shared Reports, My Reports, Scheduled Reports and report categories, a search box, Create New Report (from an existing report or from scratch) and Schedule Report Export / Configure Report Layout.

Before: 12 reports with a period picker and print.

After: a Reports Center with the same left rail, favourites, search, last-visited tracking, custom reports saved from any report with its filters ("Save as Custom Report"), and a common report viewer: date range (presets and custom from/to), report basis (Accrual/Cash) where Zoho offers it, contact/account filters, Customize Report Columns (show/hide), and Export as PDF (print layout), CSV, XLS and XLSX-compatible Excel.

Catalogue (implemented):

- Business Overview: Profit and Loss, Profit and Loss (Schedule III), Horizontal Profit and Loss, Cash Flow Statement, Balance Sheet, Horizontal Balance Sheet, Balance Sheet (Schedule III), Business Performance Ratios, Movement of Equity
- Sales: Sales by Customer, Sales by Item, Sales by Sales Person, Sales Summary
- Receivables: AR Aging Summary, AR Aging Details, Invoice Details, Sales Order Details, Delivery Challan Details, Quote Details, Customer Balance Summary, Receivable Summary, Receivable Details, Bad Debts, Bank Charges
- Payments Received: Payments Received, Time to Get Paid, Credit Note Details, Refund History (customers), Withholding Tax (TDS by customers)
- Recurring Invoices: Recurring Invoice Details
- Payables: Vendor Balance Summary, AP Aging Summary, AP Aging Details, Bill Details, Vendor Credit Details, Payments Made, Refund History (vendors), Purchase Order Details, Purchase Orders by Vendor, Purchase Order by Item, Payable Summary, Payable Details
- Purchases and Expenses: Purchases by Vendor, Purchases by Item, Expense Details, Expenses by Category, Expenses by Customer, Expenses by Project, Billable Expense Details, Mileage Expenses
- Taxes (India): GSTR-1 Summary (B2B, B2C Large, B2C Small, Credit/Debit Notes, Exports, Nil/Exempt, HSN, Documents Issued), GSTR-3B Summary (3.1, 3.2, 4, 5), GSTR-2 style Inward Supplies, HSN/SAC Summary, GST Summary by rate, Reverse Charge Summary, TDS Receivable Summary, TDS Payable Summary, TCS Summary
- Banking: Reconciliation Status, Bank Statement Lines (uncategorized/categorized)
- Projects and Timesheet: Timesheet Details, Project Summary, Project Details (cost/revenue)
- Accountant: Account Transactions, Account Type Summary, Account Type Transactions, General Ledger, Detailed General Ledger, Journal Report, Trial Balance
- Budgets: Budget vs Actuals
- Currency: Realized Gain or Loss, Unrealized Gain or Loss (0 for an INR-only book, see Accountant)
- Activity: System Mails, Activity Logs, Portal Activities

Not built: filing GSTR-1/3B with the GST portal (needs a GSP), Zoho Sheet export, emailed scheduled exports (the schedule is not sent because there is no job runner), the drag-and-drop custom report builder ("Create an entirely new report").

## 4. Documents

| Zoho Books feature | Before | After |
|---|---|---|
| Documents home: All Documents, Inboxes (Files, Bank Statements), Folders with Create New Folder, Trash | One table listing attachments | Same left rail and views |
| Files inbox: drag and drop, Choose files to upload (images, PDF, docs, sheets), upload from desktop | None | Done (10 files, 10MB each) |
| File actions: preview, download, rename, move to folder, attach to a transaction, delete to trash, restore, delete permanently | None | Done. Attaching adds the file to the transaction's attachments and the file shows as "Associated" |
| New Folder: name, permissions (all users with access / custom) | None | Done (custom permission is stored; there is no multi-user login yet) |
| Bank Statements inbox: upload statements and Add Statements to Bank | None | Upload CSV statements and import them into a bank account from the inbox |
| Autoscan (OCR via Veryfi), email forwarding address | None | Not built: needs a paid OCR provider and an inbound mail server |
| All Documents includes files attached anywhere in the books | Yes | Yes, with search and an Associated / Unassociated filter |
| Attach from Documents on a transaction form (invoice, bill, payment, journal, contact) | None | Done. The file shows as associated once the transaction is saved, and drops back to unassociated if the transaction is deleted |
