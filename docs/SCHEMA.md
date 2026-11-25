# Creatign Books: Architecture and Data Model

This document describes how Creatign Books is put together, every entity it stores, and the double-entry rules that turn business documents into journals.

## 1. Architecture

```
┌──────────────────────────── Browser ─────────────────────────────┐
│ React 18 + TypeScript + Tailwind (Vite, port 5173)               │
│  • react-router: one route tree per module (Sales, Purchases…)   │
│  • TanStack Query: every GET is cached by its URL; every          │
│    mutation invalidates the cache, so lists/balances refresh      │
│  • recharts for dashboard / income charts                         │
└───────────────┬──────────────────────────────────────────────────┘
                │  /api/*  (JSON)      /uploads/* (files)
┌───────────────▼──────────────────────────────────────────────────┐
│ Express 5 (tsx, port 4000)  server/app.ts                        │
│  routes → services.ts (validation, numbering, actions)           │
│         → engine.ts   (recompute balances/statuses + journals)    │
│         → reports.ts  (dashboard, P&L, BS, TB, GL, aging …)       │
│         → db.ts       (load / save) → mysql.ts (tables, writes)   │
└───────────────┬──────────────────────────────────────────────────┘
                │
        MySQL (DATABASE_URL)  one table per collection + journal_lines,
                              changed rows written per request in one transaction
                              (DB_FILE=:memory: for tests)
        server/uploads/       (attachments, via multer, 10 MB per file)
```

Code that both sides need lives in `shared/`:

| File | Purpose |
|---|---|
| `shared/types.ts` | All entity types (the schema below is generated from it) |
| `shared/calc.ts` | `computeTotals()`: the single source of truth for document totals |
| `shared/format.ts` | INR formatting (`₹1,00,000.00`), `dd/MM/yyyy` dates, April–March fiscal periods, due-date and recurrence maths |
| `shared/docmeta.ts` | Per-document-kind metadata (prefix, labels, side, whether it posts) and system account ids |

### Design decisions

* **Documents are the source of truth; journals are derived.** After every mutation the server runs `recompute()`, which recalculates totals, balances and statuses and then rebuilds every automatic journal from the documents. Journals can never drift from the documents that produced them. Manual journals are stored separately and kept as entered.
* **One generic transaction document.** Quotes, sales orders, invoices, recurring invoices, delivery challans, credit notes, purchase orders, bills, recurring bills and vendor credits all share the `TxnDoc` shape. Behaviour differences are data (`DOC_META` on the server, `DOC_UI` on the client), which keeps the ten modules consistent.
* **Conversions copy, then link.** `GET /api/docs/:id/convert?to=<kind>` returns an unsaved, prefilled template (for example quote → sales order). Saving it stores the back-link (`quoteId`, `salesOrderId`, `purchaseOrderId` …) and the source's status is recomputed (`invoiced`, `billed`, `partially_invoiced` …).
* **Recurring profiles** generate child documents on boot, on the first request of each day, and on demand (`POST /api/recurring/run`).
* **Swappable persistence.** All storage goes through `db.ts`. Moving to PostgreSQL means re-implementing `getDb/persist` with the relational tables in section 3; nothing above it changes.

## 2. Formatting and calculation rules

* Currency: INR, `Intl.NumberFormat('en-IN')`, so `₹1,00,000.00`.
* Dates are stored as ISO `yyyy-MM-dd` and shown as `dd/MM/yyyy`.
* Fiscal year: 1 April to 31 March (`organization.fiscalYearStartMonth = 4`).
* Line amount = quantity × rate × (1 − line discount %).
* **Document total** = Sub Total − Discount (% of sub total) − TDS (% of sub total after discount) + TCS (% of sub total after discount) + Adjustment (+ round off to the nearest rupee when enabled).
* Payment terms drive the due date: Due on Receipt, Net 15/30/45/60, Due end of the month, Due end of next month.

## 3. Entities

In memory the books are one `Database` object; each array is a MySQL table (see `server/mysql.ts` for table and column names) and the single objects are rows of `settings`. Types below are TypeScript, with `?` meaning nullable. Ids are prefixed strings (`cus_…`, `inv_…`).

### Database (root)

| Collection | Entity |
|---|---|
| organization | Organization (single row) |
| accounts | Account |
| items | Item |
| contacts | Contact (customers and vendors) |
| docs | TxnDoc (all ten document kinds) |
| paymentsReceived | PaymentReceived |
| paymentsMade | PaymentMade |
| expenses / recurringExpenses | Expense / RecurringExpense |
| journals | Journal (+ JournalLine) |
| comments, activities, mails | Comment, Activity, Mail |
| shareLinks | ShareLink |
| emailTemplates | EmailTemplate (one built-in per kind, plus your own) |
| portalUsers, portalSessions | PortalUser, PortalSession (customer portal sign-in) |
| paymentNotices | PaymentNotice (payments customers report from the portal or a shared link) |
| projects, timeEntries, users, timers, budgets | Project, TimeEntry, User, RunningTimer, Budget |
| counters | Next number per series, e.g. `INV → 3` |
| pdfTemplates | PdfTemplate (six built-in, plus your own) |
| preferences | `smtp` (SMTP settings, password encrypted), `portal` (PortalSettings), salespersons, challan types, delivery methods, default notes and terms, mileage rate, `defaultTemplates` (module → template id), `docDefaults` (module → notes / terms), `customFields` (module → CustomFieldDef[]) |

### Organization

`id, name, email, phone?, state, country, currencyCode (INR), currencySymbol (₹), dateFormat (dd/MM/yyyy), fiscalYearStartMonth (4), gstin?, pan?, address?, logoText?, logo? (data: URL), website?, fax?, industry?, migrationDate?`

### PdfTemplate

Defined in `shared/pdfTemplate.ts`; one template drives the on-screen preview, browser print and the emailed PDF.

`id, name, layout (standard | modern | classic | bold | minimal | spreadsheet), builtIn?, paperSize (A4 | A5 | Letter), orientation, margins {top, bottom, left, right} in inches, font, fontSize (pt), textColor, labelColor, theme, accentColor, tintColor, backgroundColor, backgroundImage?, header {…}, details {…}, table {…, labels}, total {…}, other {…}`

A document prints with `TxnDoc.templateId`, else `preferences.defaultTemplates[kind]`, else the Standard template. Custom field values live in `TxnDoc.customFields` keyed by field id; mandatory fields are enforced on save.

### Account (chart of accounts)

`id, code, name, type (asset | liability | equity | income | expense), subType, description?, system?, active`

`subType` covers cash, bank, accounts_receivable, accounts_payable, other_current_asset, fixed_asset, other_current_liability, equity, income, other_income, expense, cost_of_goods_sold, other_expense and so on. About 36 system accounts are seeded (Accounts Receivable, Accounts Payable, Sales, Cost of Goods Sold, Petty Cash, HDFC Bank, TDS Receivable, TDS Payable, TCS Payable, Discount, Bank Charges, Bad Debt, Opening Balance Adjustments …). System accounts cannot be deleted.

### Item

`id, name (unique), type (goods | service), unit?, sku?, sellable, sellingPrice, salesAccountId → Account, salesDescription?, purchasable, costPrice, purchaseAccountId → Account, purchaseDescription?, preferredVendorId? → Contact, status, createdAt, updatedAt`

### Contact (customer or vendor)

`id, kind (customer | vendor), customerType (business | individual), salutation?, firstName?, lastName?, companyName?, displayName, email?, workPhone?, mobile?, language, pan?, gstin?, msmeRegistered?, msmeType?, tdsRate?, currencyCode, accountId? → Account (AR/AP), openingBalance, paymentTerms, portalEnabled, website?, department?, designation?, x?, skype?, facebook?, billingAddress, shippingAddress, contactPersons[], bankDetails[], customFields{}, reportingTags{}, remarks?, documents[], linkedContactId? → Contact, status, createdAt, updatedAt`

Child records (separate tables in a relational design):

* **Address**: `attention?, street1?, street2?, city?, state?, pin?, country?, phone?`
* **ContactPerson**: `id, salutation?, firstName?, lastName?, email?, workPhone?, mobile?, designation?, department?`
* **BankDetail**: `id, accountHolderName?, bankName?, accountNumber?, ifsc?`
* **Attachment** (also used by documents, payments and expenses): `id, name, size, mimeType, url, uploadedAt`

Derived on read: `outstanding` (receivable or payable) and `unusedCredits`.

### TxnDoc (all transaction documents)

`kind` is one of `quote, sales_order, invoice, recurring_invoice, delivery_challan, credit_note, purchase_order, bill, recurring_bill, vendor_credit`.

| Group | Fields |
|---|---|
| Identity | `id, kind, number (QT-/SO-/INV-/RI-/DC-/CN-/PO-/BILL-/RB-/VC- + 5 digits; bills use the vendor's bill#), referenceNumber?, orderNumber?` |
| Party and dates | `contactId → Contact, date, dueDate?, expiryDate?, expectedShipmentDate?, deliveryDate?, paymentTerms?, accountId? (AR or AP)` |
| Sales/delivery detail | `salesperson?, projectId?, projectName?, projectFee?, subject?, deliveryMethod?, shipmentPreference?, challanType?, deliveryAddressType?, deliveryCustomerId?, billingAddress?, shippingAddress?` |
| Lines | `lineItems[]: { id, itemId? → Item, name, description?, accountId? → Account, quantity, unit?, rate, discountPercent?, customerId? → Contact, amount }` |
| Inputs to totals | `discountPercent, tdsRate, tcsRate, adjustment, adjustmentLabel?, roundOff?` |
| Computed totals | `subTotal, discountAmount, tdsAmount, tcsAmount, total, balance` |
| Status | `status` (per kind, below), `invoiceStatus?, billedStatus?, shipmentStatus?, paymentStatus?, amountPaid?, creditsUsed?, received?, locked, sentAt?` |
| Approval | `approvedAt?, approvedBy?, rejection?: { reason?, at, by }` |
| Text | `customerNotes?, terms?, notes?, emailRecipients[], attachments[]` |
| Links | `quoteId?, salesOrderId?, deliveryChallanId?, purchaseOrderId?, invoiceId? (credit note against invoice), recurringProfileId?` |
| Credits | `creditApplications[]: { id, invoiceId, amount, date }`, `refunds[]: { id, amount, date, mode, referenceNumber?, accountId, description? }` |
| Collections | `writeOff?: { amount, date, reason? }, expectedPaymentDate?, remindersStopped?` |
| Recurring profile | `profileName?, repeatEvery? { n, unit: day/week/month/year }, startOn?, endsOn?, neverExpires?, lastGeneratedDate?, nextDate?, createAsDraft?, childCount?` |
| Audit | `createdAt, updatedAt` |

Statuses per kind:

| Kind | Statuses |
|---|---|
| Quote | draft, sent, accepted, declined, invoiced, expired |
| Sales order | draft, confirmed (open), closed, void; invoiceStatus and shipmentStatus alongside |
| Invoice / Bill | draft, open (sent), overdue, partially_paid, paid, void, written-off |
| Recurring invoice / bill | active, stopped, expired |
| Delivery challan | draft, open, delivered, invoiced, returned |
| Credit note / Vendor credit | draft, open, closed, void |
| Purchase order | draft, issued (open), billed, partially_billed, closed, cancelled; received flag |

Approval workflow (`shared/approval.ts`): for quotes, sales orders, invoices, credit notes, purchase orders, bills and vendor credits, when `preferences.approvals[kind]` is on (default: sales orders only), a document moves `draft → pending_approval → approved` (or `pending_approval → rejected → pending_approval`) before it can reach its first open status (sent / confirmed / open / issued). Actions: `submit_for_approval`, `approve`, `reject { reason }`. `draft, pending_approval, approved, rejected` are all *unposted*: no journal, no receivable/payable, excluded from reports.

### PaymentReceived

`id, number, contactId → Contact, amount, bankCharges, date, mode, depositToAccountId → Account, referenceNumber?, tdsDeducted, tdsAmount, allocations[]: { docId → invoice, amount }, notes?, attachments[], sendThankYou, status (draft | paid | void), refunds[], locked, usedAmount, refundedAmount, unusedAmount (computed), createdAt, updatedAt`

Unused amount = amount + TDS − allocated − refunded. It shows on the customer as an unused credit and can be applied to later invoices or refunded.

### PaymentMade

`id, number, type (bill_payment | vendor_advance), contactId → Contact, amount, date, mode, paidThroughAccountId → Account, referenceNumber?, allocations[]: { docId → bill, amount }, tdsRate?, depositToAccountId?, notes?, attachments[], status, usedAmount, unusedAmount, createdAt, updatedAt`

### Expense and RecurringExpense

Expense: `id, date, accountId → Account, amount, itemized, lines[]: { id, accountId, amount, notes? }, paidThroughAccountId, vendorId?, invoiceNumber?, notes?, customerId?, billable, status (unbilled | invoiced | reimbursed | non_billable), isMileage, distance?, ratePerKm?, receipts[], recurringProfileId?, invoiceId?, reportingTags{}, createdAt, updatedAt`

RecurringExpense: `id, profileName, repeatEvery, startOn, endsOn?, neverExpires, accountId, amount, paidThroughAccountId, vendorId?, notes?, customerId?, billable, reportingTags{}, status (active | stopped | expired), lastGeneratedDate?, nextDate?, createdAt, updatedAt`

### Journal and JournalLine

Journal: `id, number (JRN-00001), date, sourceType, sourceId?, contactId?, reference?, notes?, lines[], createdAt`

JournalLine: `accountId → Account, debit, credit, description?, contactId?`

`sourceType` is one of `invoice, credit_note, payment_received, payment_refund, credit_note_refund, write_off, bill, vendor_credit, payment_made, expense, opening_balance, manual`. Automatic journals use the id `jrn_<source>_<docId>[_<sub>]`. Every journal satisfies Σ debit = Σ credit (manual journals are rejected otherwise).

### Supporting entities

* **Comment**: `id, entityType, entityId, html (sanitised), author, createdAt`
* **Activity** (timeline): `id, entityType, entityId, contactId?, message, detail?, author, createdAt`
* **Mail** (email log): `id, contactId?, entityType?, entityId?, from, to[], cc[], bcc[]?, replyTo?, subject, body (placeholders filled), html? (exactly what was sent), attachments[] (file names), templateId?, status (sent | outbox | failed), error?, provider (google-oauth | smtp | outbox), shareLinkId?, system? (invitations, resets, notifications), createdAt`
* **EmailTemplate**: `id, kind (quote | sales_order | invoice | payment_reminder | credit_note | payment_received | statement | purchase_order | payment_made | portal_invite | portal_reset), name, subject, body, isDefault, builtIn?, updatedAt?`. Placeholders are `%Name%` tokens, listed in `shared/email.ts`.
* **ShareLink**: `id, token (256-bit random), entityType, entityId, expiresOn?, active, source (manual | email), views, lastViewedAt?, createdAt`. Public view at `/share/:token`; only documents visible to customers (not draft or in approval) can be shared.
* **PortalUser**: `id, contactId, contactPersonId?, email, name, status (invited | active | disabled), passwordHash (scrypt), inviteTokenHash?, inviteExpiresAt?, invitedAt?, resetTokenHash?, resetExpiresAt?, lastLoginAt?, failedLogins?, lockedUntil?, createdAt, updatedAt`. One login per email; signing in needs the user active, `Contact.portalEnabled` and the portal enabled.
* **PortalSession**: `id, tokenHash (sha256 of the cookie value), userId, createdAt, expiresAt (14 days), lastSeenAt`
* **PaymentNotice**: `id, contactId, invoiceId, amount, date, mode, reference, note?, submittedBy, submittedEmail?, via (portal | link), status (pending | recorded | dismissed), paymentId?, createdAt, resolvedAt?`. Recording one creates a PaymentReceived applied to the invoice.
* **TxnDoc** customer fields: `viewedAt?` (first opened by the customer), `customerResponse? { action: accepted | declined, by, email?, comment?, at, via: portal | link }` on quotes.
* **Project**: `id, name, code?, customerId, billingMethod (fixed | project_hours | task_hours | staff_hours), rate (project cost or hourly rate), description?, costBudget?, revenueBudget?, budgetHoursType (none | total | per_task | per_staff), budgetHours?, users[{userId, ratePerHour?, budgetHours?}], tasks[{id, name, description?, ratePerHour?, budgetHours?, billable}], watchlist, attachments[], status, createdAt, updatedAt?`. Old `hourly` projects load as `project_hours`.
* **TimeEntry**: `id, projectId, taskId?, userId, date, hours (decimal; shown as HH:MM), startTime?, endTime?, notes?, billable, invoiced, invoiceId?, createdAt`. Billing status is derived: Invoiced, Unbilled (billable) or Non-Billable. Deleting or voiding the invoice returns its entries to Unbilled; invoiced entries cannot be edited (except notes) or deleted.
* **User**: `id, name, email?, role (Admin | Staff | Timesheet Staff), status`. The first active Admin is the current user (the app has no sign-in yet).
* **RunningTimer**: `id, userId, projectId?, taskId?, notes?, billable, entryId? (resume an entry), startedAt?, accumulatedMs, running`. Stopping creates an entry or adds the time to `entryId`.
* **Budget**: `id, name, fiscalYearStart, period (monthly | quarterly | yearly), projectId?, includeBalanceSheet, lines[{accountId, amounts[]}]`. Actuals come from journals whose source document, expense or manual journal is linked to the project.
* **Journal** also carries `projectId?` for manual journals tagged to a project.

### Relationships

```
Organization 1──* Account
Contact 1──* TxnDoc ──* LineItem *──1 Item
                         LineItem *──1 Account
Quote ─convert→ SalesOrder ─convert→ Invoice ←allocations── PaymentReceived
                                      ↑ creditApplications
                                  CreditNote ──refunds
PurchaseOrder ─convert→ Bill ←allocations── PaymentMade
                         ↑ creditApplications
                     VendorCredit ──refunds
RecurringInvoice 1──* Invoice     RecurringBill 1──* Bill
RecurringExpense 1──* Expense     Expense ─convert→ Invoice
Project 1──* TimeEntry ─invoiceId→ Invoice (projectId, projectFee)
Project 1──* Budget; Project ←projectId─ Docs, Expenses, manual Journals
TxnDoc / Payment / Expense 1──* Journal 1──* JournalLine *──1 Account
```

## 4. Double-entry posting rules

Only posting documents create journals: invoices, credit notes, bills, vendor credits, payments, expenses, write-offs, refunds and opening balances. Quotes, sales orders, delivery challans and purchase orders never post. Drafts and void documents never post.

| Event | Debit | Credit |
|---|---|---|
| **Invoice** | Accounts Receivable (total); TDS Receivable (TDS); Discount (discount) | Sales / line income account (each line amount); TCS Payable (TCS); Other Charges (adjustment and round off; sign flips if negative) |
| **Credit note** | Mirror of invoice: Sales per line, TCS Payable, Other Charges | Accounts Receivable, TDS Receivable, Discount |
| **Credit note refund** | Accounts Receivable | Refund-from account (cash/bank) |
| **Payment received** | Deposit-to account (amount − bank charges); Bank Charges; TDS Receivable (TDS deducted) | Accounts Receivable (amount + TDS) |
| **Payment refund** (excess payment returned) | Accounts Receivable | Refund-from account |
| **Write-off** | Bad Debt | Accounts Receivable |
| **Bill** | Purchase / expense account per line, default Cost of Goods Sold (line amount); TCS Receivable (TCS); Other Expenses (adjustment and round off; sign flips if negative) | Accounts Payable (total); TDS Payable (TDS); Purchase Discount (discount) |
| **Vendor credit** | Mirror of bill: Accounts Payable, TDS Payable, Purchase Discount | Line purchase accounts, TCS Receivable, Other Expenses |
| **Vendor credit refund** | Deposit-to account | Accounts Payable |
| **Payment made** (bill payment or vendor advance) | Accounts Payable | Paid-through account |
| **Expense** | Expense account (or each itemised line) | Paid-through account |
| **Opening balance** | Customer: Accounts Receivable. Vendor: Opening Balance Adjustments | Customer: Opening Balance Adjustments. Vendor: Accounts Payable |
| **Manual journal** | As entered | As entered (must balance) |

Applying credits (a credit note to an invoice, an excess payment to another invoice, a vendor credit to a bill) only moves balances between documents. The AR/AP effect was already posted when the credit or payment was recorded, so no new journal is created.

### Worked example (from the automated tests)

Invoice of ₹1,00,000 with 10% discount and 2% TDS:

| Account | Debit | Credit |
|---|---:|---:|
| Accounts Receivable | 88,200.00 | |
| TDS Receivable | 1,800.00 | |
| Discount | 10,000.00 | |
| Sales | | 1,00,000.00 |
| **Total** | **1,00,000.00** | **1,00,000.00** |

The customer then pays ₹50,000 by bank transfer, and later ₹40,000 in cash with ₹50 bank charges, of which ₹38,200 is applied to the invoice. The invoice becomes Paid and ₹1,800 stays on the customer as an unused credit:

| Account | Debit | Credit |
|---|---:|---:|
| HDFC Bank (payment 1) | 50,000.00 | |
| Accounts Receivable (payment 1) | | 50,000.00 |
| Petty Cash (payment 2) | 39,950.00 | |
| Bank Charges (payment 2) | 50.00 | |
| Accounts Receivable (payment 2) | | 40,000.00 |

Accounts Receivable now carries a credit balance of ₹1,800, which is exactly the customer's unused credit.

## 5. Reports

All reports are computed from journals at request time (`GET /api/reports/:name?from=&to=`): Profit and Loss, Balance Sheet, Trial Balance, General Ledger, Journal Report, Receivables and Payables Aging, Sales by Customer, Sales by Item, Expenses by Category, Customer and Vendor Balances. The dashboard (`GET /api/dashboard`) adds aging buckets, monthly cash flow, income vs expense (accrual or cash basis), top expenses, bank balances and projects for the selected fiscal period.
