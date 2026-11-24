# Purchases module: Zoho Books comparison

Reviewed against Zoho Books (India edition) Purchases: Vendors, Expenses, Recurring Expenses,
Purchase Orders, Bills, Recurring Bills, Payments Made and Vendor Credits.

## Gaps found and closed in this change

| Area | Zoho Books | Creatign before | Now |
| --- | --- | --- | --- |
| Expenses | Split view: "All Expenses" list on the left, Expense Details on the right | Full-page detail, no list | Split view with view picker, + and ... menu, row checkboxes |
| Expenses | Toolbar: Edit, Make Recurring, PDF/Print, ... (Clone, Delete, View Journal) | Edit and a ... menu only | Same toolbar; Convert to Invoice and Mark as Reimbursed kept |
| Expenses | Make Recurring opens a side drawer (Profile Name, Repeat Every, Start On, Ends On, Never Expires, Reporting Tags) | Opened a separate form page | Side drawer; first run defaults to one period after the expense so it is not duplicated |
| Expenses | Amount "on date", billable status, account tag, Paid Through, Customer and Paid To links | Plain key/value card | Matches Zoho's layout |
| Expenses | Drag and drop receipts straight onto the detail page (10MB each) | Receipts could only be added in the edit form | Drop zone on the detail page saves immediately, with thumbnails |
| Expenses | Journal tab with "Amount is displayed in your base currency INR" and "Expense - date" | Generic journal table | Zoho-style journal plus Comments and History tabs |
| Expenses | Expense PDF/Print | None | Printable expense voucher at /print/expense/:id |
| Expenses | Clone | None | Clone prefills a new expense (no receipts, no invoice link) |
| Expenses | Bulk select and delete, export | None | Checkboxes, bulk delete, CSV export, search, list total |
| Expenses | Invoiced expenses cannot be deleted | Could be deleted | Blocked until the invoice is deleted |
| Expenses | Reporting tags on the expense | Stored but not editable | "Associate Tags" editor on the form and drawer |
| Recurring Expenses | Split view, toolbar with Edit, Stop/Resume, Create Expense, ... (Clone, Delete) | Full-page detail, no Create Expense or Clone | Split view, all actions, next-run banner, child expenses, History |
| Recurring Expenses | Repeat Every presets (Week, 2 Weeks, Month, 2/3/6 Months, Year, 2/3 Years, Custom) | Number + unit only | Zoho presets plus Custom |
| Payments Made | Refund an excess payment or vendor advance | Not possible | Refund modal, refund history, journal (Dr bank, Cr Accounts Payable), delete refund |

## Already at parity (no change needed)

- Vendors: list, split view, overview, transactions, mails, statement, portal, merge, link.
- Purchase Orders: issue, receive goods, convert to bill, cancel/reopen, clone, PDF, email, approvals.
- Bills: open, record payment, make recurring, vendor credits, void, journal, approvals.
- Recurring Bills: profiles, create bill now, stop/resume.
- Payments Made: bill payments, vendor advances, PDF, email, void.
- Vendor Credits: open, apply to bills, refund, void, journal.

## Closed in the second pass (full replica)

- GST engine (shared/gst.ts): GST0 to GST28, Exempt, Non-GST and Out of Scope; CGST + SGST when the
  source and destination of supply are the same state, IGST otherwise (and for overseas and SEZ).
- GST treatment, GSTIN, source and destination of supply and reverse charge on Bills, Recurring Bills,
  Purchase Orders, Vendor Credits, Expenses and Recurring Expenses, with Tax Exclusive / Tax Inclusive amounts.
- Input tax credit journals (Input CGST/SGST/IGST accounts); reverse charge books the tax to
  "Reverse Charge Tax Payable" instead of the vendor.
- Tax column, tax breakdown and GST facts on forms, detail pages, PDFs and CSV exports.
- Vendors: GST treatment, GSTIN (validated, source of supply read from it), place of supply.
- Items: HSN/SAC, tax preference and default tax rate.
- Expenses: Tax, Amount Is, Expense Type (goods/services) with HSN/SAC, projects for billable expenses.
- Bills: "Credits Available" banner to apply vendor credits and advances from the bill.
- Bills list: select rows to record a bulk payment (one payment per vendor), export or delete.
- Payments Made: apply an unused vendor advance to bills.

## Not done (larger pieces of work, left for later)

- Receipt OCR (Autoscan): needs an OCR provider.
- Multi-currency and exchange rates.
- Billable mileage rates per employee.
