# Creatign Ledger

Accounting and billing for **Creatign** (Tamil Nadu, India): items, clients and suppliers, the full sales cycle (estimate → sales order → invoice → payment), the full purchase cycle (purchase order → bill → payment made), expenses, double-entry journals and financial reports.

* Currency: Indian Rupee with Indian digit grouping, e.g. **₹1,00,000.00**
* Dates: **dd/MM/yyyy**
* Fiscal year: **April to March**

The architecture, every entity and the double-entry posting rules are documented in [docs/SCHEMA.md](docs/SCHEMA.md).

## Tech stack

| Layer | Tools |
|---|---|
| Frontend | React 18, TypeScript, Tailwind CSS 3, Vite 5, React Router 6, TanStack Query 5, Recharts, lucide-react |
| Backend | Node.js, Express 5 (run with `tsx`), multer for attachments |
| Database | MySQL 8 (or MariaDB 10.6+) through `mysql2`: one table per entity plus a `journal_lines` ledger table. Attachments go to `server/uploads/` |
| Tests | Vitest + Supertest (end-to-end API workflows) |

## Setup

Requirements: Node.js 20 or newer, npm, and a MySQL 8 (or MariaDB 10.6+) server.

1. **Start MySQL.** With Docker: `docker compose up -d mysql` (uses `docker-compose.yml`, which creates the `creatign_ledger` database and user). Or create them yourself:

   ```sql
   CREATE DATABASE creatign_ledger CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'ledger'@'%' IDENTIFIED BY 'choose-a-strong-password';
   GRANT ALL ON creatign_ledger.* TO 'ledger'@'%';
   ```

2. **Point the app at it.** Copy `.env.example` to `.env` and set `DATABASE_URL=mysql://ledger:choose-a-strong-password@localhost:3306/creatign_ledger`.

3. **Run it.**

   ```bash
   npm install
   npm run dev
   ```

* App: http://localhost:5173
* API: http://localhost:4000/api (Vite proxies `/api` and `/uploads` to it)

On first start the server creates the tables and fills them with the Creatign organisation, a chart of accounts and a little sample data (4 items, clients *Test Company* and *Ananya Textiles*, suppliers, two projects with tasks, users and time entries), so every screen has something to show.

| Command | What it does |
|---|---|
| `npm run dev` | Starts API (port 4000, auto-reload) and web app (port 5173) together |
| `npm test` | Runs the workflow tests against an in-memory database |
| `npm run typecheck` | TypeScript check for client, server and shared code |
| `npm run reset-data` | Wipes the MySQL database and reseeds sample data. `npm run reset-data -- --empty` seeds only the organisation and accounts |
| `npm run db:import -- server/data/db.json` | Moves books from the old JSON file into MySQL (add `--force` to replace books already in MySQL) |
| `npm run build` then `npm start` | Production build; the API then also serves the built app on port 4000 |

Environment variables go in a `.env` file in the project folder (copy `.env.example`): `DATABASE_URL` (required), `PORT` (default 4000) and the email settings below. `.env` is ignored by git, so passwords stay on your computer.

## Database

The books live in MySQL. Every list in the app has its own table (`transactions` for invoices, quotes, bills and other documents, `contacts`, `items`, `accounts`, `payments_received`, `payments_made`, `expenses`, `journals`, `bank_transactions`, `statement_lines`, `users`, …). Each table has:

* `id` (primary key) and `seq` (the order rows appear in the app),
* typed, indexed columns for querying and reporting, such as `date`, `contact_id`, `account_id`, `status`, `total`, `balance`,
* `data`: the full record as JSON, so nothing is lost,
* `updated_at`.

`journal_lines` holds every ledger posting (`journal_id`, `date`, `account_id`, `contact_id`, `debit`, `credit`, `source_type`, `source_id`), so you can run SQL such as account balances directly:

```sql
SELECT a.code, a.name, SUM(l.debit) - SUM(l.credit) AS balance
FROM journal_lines l JOIN accounts a ON a.id = l.account_id
WHERE l.date <= '2027-03-31' GROUP BY a.id ORDER BY a.code;
```

Single settings (organisation profile, preferences, numbering counters, transaction locks) are rows of the `settings` table.

How it runs: the server creates missing tables and columns on start, loads the books into memory, and after every change writes only the rows that changed, in one transaction, before it answers the request. Run **one** app process per database (do not put two servers on the same database), and edit data through the app rather than with SQL while it is running.

**Moving from the JSON file**: if you used an earlier version, your books are in `server/data/db.json`. Set `DATABASE_URL`, then run `npm run db:import -- server/data/db.json`. Keep the JSON file until you have checked everything in the app.

**Backups**: use `mysqldump creatign_ledger > backup.sql` (or your host's MySQL backups). Admins can also download a JSON copy from **Settings → Data & Backup**.

**Tests** run against an in-memory copy and need no database. `tests/mysql.test.ts` also checks the MySQL layer when `TEST_DATABASE_URL` points at an empty test database, for example `TEST_DATABASE_URL=mysql://ledger:pass@localhost:3306/creatign_ledger_test npm test`.

## Deploying to AWS

`./deploy/aws/deploy.sh` builds the Docker image and creates the whole setup on AWS: CloudFront (HTTPS), a load balancer, ECS Fargate, RDS for MySQL 8.4 and EFS for attachments. `./deploy/aws/import.sh` moves existing books into RDS. See [docs/DEPLOY-AWS.md](docs/DEPLOY-AWS.md) for the steps, the cost and day-to-day commands.

To run the same image anywhere else: `docker build -t creatign-ledger .` then `docker run -p 4000:4000 -e DATABASE_URL=mysql://... creatign-ledger`.

## Sign-up and sign-in

The staff app and its API need a signed-in team member.

* **First run**: opening the app shows **Set up Creatign Ledger**. The first person to sign up becomes the **Admin**. If their email matches a user already on file (the sample data has *accounts@creatign.example*), that user record is claimed. On a public server set `ADMIN_EMAIL` so that only the owner's address can do this.
* **Later sign-ups** (`/signup`) wait as *Awaiting approval* until an Admin approves them in **Settings → Users & Access**, where the Admin also picks their role (Admin, Staff or Timesheet Staff).
* **Invitations**: **Settings → Users & Access → Invite User** emails a link (valid 7 days, single use) to set a password. If email is not set up, the link is shown to copy.
* **Forgot password** emails a reset link valid for 2 hours. Resetting signs out every other browser.
* **Sessions** are random tokens in an HttpOnly, SameSite=Lax cookie (14 days with *Keep me signed in*, otherwise until the browser closes). Only a hash is stored. Passwords are hashed with scrypt; 8 wrong attempts lock the account for 15 minutes, and sign-in, sign-up and reset requests are rate limited.
* Requests that change data must carry the `X-CL-Request: 1` header the app sends, so other websites cannot post forms to the API. `/uploads` files also need a session.
* **My Account** (profile menu) changes your name and password. **Sign out** is in the same menu.
* `AUTH_DISABLED=1` turns sign-in off. The automated tests use it; never set it on a server others can reach.

## Sending email

Email is set up in **Settings → Emails**, which shows which transport is in use and has a **Send Test** button. The app tries, in order:

1. a **Gmail account linked with OAuth** (see below),
2. **SMTP saved in Settings → Emails** (host, port, STARTTLS / SSL, username, password, From name and address, Reply-To). Works with Gmail app passwords, Microsoft 365, Amazon SES, Mailgun and others. The password is encrypted with `APP_SECRET`, or with a random key generated once into `server/data/app-secret.json` (git-ignored; keep it with your backups of `db.json`),
3. **SMTP from `.env`** (below),
4. the **outbox**: with nothing set up, emails are kept in **Settings → Emails → Email Log** with the exact HTML the client would get, marked *Outbox*, and can be sent later with **Retry Sending**. Set `MAIL_TRANSPORT=outbox` to force this during development.

To use Gmail over SMTP from `.env` instead of the Settings screen:

1. Turn on **2-Step Verification** for the Gmail account (Google Account → Security).
2. Open https://myaccount.google.com/apppasswords, create an app password (name it e.g. *Creatign Ledger*) and copy the 16 letters. Use this, not your normal Gmail password.
3. In the project folder, copy `.env.example` to `.env` (Windows: `copy .env.example .env`, macOS/Linux: `cp .env.example .env`) and fill in:
   ```
   SMTP_USER=yourname@gmail.com
   SMTP_PASS=abcd efgh ijkl mnop
   MAIL_FROM_NAME=Creatign
   ```
4. Restart `npm run dev`.

If the mail server rejects the login or can't be reached, the email is logged as **Failed** with the reason and the document is not marked as sent. For another provider, also set `SMTP_HOST` and `SMTP_PORT`. If your network uses SMTP TLS inspection and the server certificate chain is signed by a private CA, set `SMTP_TLS_CA_FILE` to that CA's PEM file and restart the server. Obtain the certificate from your network administrator; do not disable certificate validation.

### Client emails

**Send → Send Email** on an estimate, sales order, invoice, credit note, purchase order, payment or statement opens the composer:

* **Template** picker (Settings → Emails → Templates). Each kind has a built-in template that can be edited or restored, and you can add your own and choose the default. Placeholders such as `%CustomerName%`, `%DocumentNumber%`, `%Total%`, `%BalanceDue%`, `%DueDate%`, `%DaysOverdue%`, `%PaymentAmount%`, `%ClosingBalance%` or `%DocumentLink%` are filled in from the transaction. Overdue invoices start from the **Payment Reminder** template.
* **To / Cc / Bcc** as recipient chips, with the client's email and contact persons suggested.
* **Attachments**: the transaction PDF (drawn with its PDF template), the transaction's own attachments, and extra uploaded files (20 MB total).
* **Add a "View Invoice" button**: creates a secure share link (valid for 90 days by default) so the client can open the document online, download the PDF, accept an estimate or see how to pay.
* **Preview** shows the branded HTML email: your logo (sent inline so Gmail shows it), a summary card with the amount and dates, your message, the button, and your address in the footer.

Every email is logged with its status (**Sent**, **Outbox**, **Failed**) and the exact HTML. The log is in the **Emails** tab of each transaction, the **Mails** tab of each contact, and **Settings → Emails → Email Log**, with **Send Again / Retry Sending**.

### Link a Gmail account with OAuth

**Link Gmail Account** in **Settings → Emails** connects one Gmail sender for the app. Once linked, outgoing app email uses the Gmail API with the `gmail.send` permission; otherwise the SMTP settings above continue to be used.

1. In Google Cloud Console, create/select a project, enable the **Gmail API**, and configure the OAuth consent screen. For an app in Testing mode, add your Gmail address as a test user.
2. Create an OAuth client ID of type **Web application** and add this authorized redirect URI:
   `http://localhost:4000/api/mail/google/callback`
3. Add the client values to the project-root `.env`:
   ```env
   GOOGLE_OAUTH_CLIENT_ID=your-client-id
   GOOGLE_OAUTH_CLIENT_SECRET=your-client-secret
   GOOGLE_OAUTH_REDIRECT_URI=http://localhost:4000/api/mail/google/callback
   APP_ORIGIN=http://localhost:5173
   ```
4. Restart the app, open **Settings → Emails**, and choose **Link Gmail Account**. Google will ask you to authorize sending mail. The refresh token is encrypted locally in `server/data/google-mail-auth.json`; the OAuth client secret must remain in `.env` so the app can decrypt it. **Disconnect** revokes the Google authorization and removes the local token.

For deployments on a different host, set the exact public callback URL in both Google Cloud Console and `GOOGLE_OAUTH_REDIRECT_URI`, and set `APP_ORIGIN` to the app's origin. Google OAuth apps left in Testing mode may have refresh tokens expire after seven days; publish/configure the consent screen for continued use.

You can also reset from the app: **Settings → Data & Backup**.

## Project structure

```
shared/        types, totals calculation, INR/date/fiscal formatting, document metadata
server/
  app.ts       REST routes (/api/...)
  services.ts  validation, numbering, document actions, payments, credits, expenses
  engine.ts    recompute balances/statuses and rebuild journals after each change
  reports.ts   dashboard, P&L, balance sheet, trial balance, ledgers, aging, sales reports
  db.ts        load / save the books   mysql.ts  MySQL tables and writes     seed.ts  organisation, accounts, samples
client/src/
  components/  layout (sidebar + top bar), form controls, document preview, shared panels
  pages/       Home, items, contacts, docs (all 10 sales/purchase documents), payments,
               expenses, time (projects, timesheet, timer), misc (banking, accountant, reports, settings, print)
  email.ts     email templates, placeholders, branded HTML, attachments, email log
  mailer.ts    transports: Gmail OAuth, SMTP (settings or .env), outbox
  portal.ts    client portal API, invitations, sessions, shared links, payment notices
client/src/client/  client-facing pages: /portal and /share/:token
deploy/aws/    ledger.yml (CloudFormation), deploy.sh, import.sh   Dockerfile  production image
tests/               workflow, approval, PDF template, email and portal tests
docs/SCHEMA.md       architecture and data model
```

## Modules

* **Dashboard**: dashboard with receivables and payables (current and overdue buckets), cash flow, income and expense (accrual or cash), top expenses, projects, bank and credit card balances; Getting Started; Recent Updates.
* **Products & Services**: goods and services with sales and purchase information.
* **Receivables**: Clients, Estimates, Sales Orders, Invoices, Invoice Schedules, Delivery Challans, Client Payments, Credit Notes.
* **Payables**: Suppliers, Expenses (including mileage and bulk), Expense Schedules, Purchase Orders, Purchase Bills, Bill Schedules, Supplier Payments, Debit Notes.
* **Projects & Time**: projects with four billing methods (fixed cost, project hours, task hours, staff hours), tasks, users, hours and cost budgets and a dashboard watchlist; a project page with Overview, Timesheet, Purchases, Sales, Budget Configuration, Journals, Activity Logs and Comments; a Timesheet with list, calendar and summary views, filters, weekly logs and a running timer in the top bar; invoicing of unbilled time (per project, task, user or entry) and fixed-cost project fees.
* **Cash & Bank**: bank and card accounts, statement import, matching and posting statement lines, auto-categorization rules, transfers and reconciliation.
* **General Ledger**: Journal Vouchers, Voucher Schedules, Batch Reclassify, FX Revaluation, Chart of Accounts, Budget Planner and Period Close.
* **Financial Reports**: the Report Library with financial statements, receivables, payables, GST returns (GSTR-1, GSTR-3B, HSN), ledgers and audit trail, with PDF, CSV and Excel export.
* **Document Vault**: Uploads and Bank Statements inbox, folders, trash, preview and attaching files to transactions.
* **Settings**.
* **Payroll** and **Payment Gateway** appear in the sidebar as placeholders for future integrations.

Major list pages support selecting rows and exporting the visible or selected records as CSV or Excel (.xlsx). **Settings → Import Data** accepts CSV files for products, clients, suppliers and all document types, including estimates and sales orders. Document files use one row per item line, grouped by document number; the related customer or supplier must already exist, matching items and accounts are linked when present, and regular documents are saved as drafts. Recurring schedules are saved as stopped and must be reviewed before activation. Zoho quote headers such as `Quote Date`, `Quote Number`, `Item Desc`, `Item Price` and `Entity Discount Percent` are supported. Source statuses are not restored; source totals that differ from Creatign Ledger's calculated totals are reported per document. The downloadable templates list supported columns. Contact imports map common Zoho headers including `Contact Name`, `EmailID`, `MobilePhone`, `Opening Balance`, PAN, GSTIN, payment terms, billing/shipping addresses, contact-person fields and portal status. Re-importing a contact with the same display name updates it; empty CSV fields leave existing details unchanged. Portal status imports the enabled flag only; it does not migrate portal users or logins. Projects, Timesheet, Journal Vouchers, Voucher Schedules and Budgets also provide module-level CSV import buttons with downloadable header templates and row-level results. Journal vouchers and schedules use one row per account line; budgets use one row per account with period amounts separated by `|`.

Every document supports PDF/print, email, share link, comments, activity history, attachments and a journal tab where it posts to the ledger. Conversions are one click: estimate → sales order or invoice, sales order → invoice, delivery challan → invoice, purchase order → bill, expense → invoice.

## Verify the workflows

Run `npm run reset-data` first for a clean start, then `npm run dev` and open http://localhost:5173.

### A. Item → Estimate → Sales Order → Invoice → Journal and Client Payment

1. **Create an item.** Products & Services → **New**. Name *Website Audit*, type Service, Selling Price `24000`, Sales Account *Sales*. Save.
2. **Create an estimate.** Receivables → Estimates → **New**. Client *Test Company*, add the item *Website Audit* (qty 1). Check the total reads ₹24,000.00. Click **Save and Send**, then **Send** in the email dialog. The estimate's status becomes **Sent**.
3. **Convert to a sales order.** On the estimate, open **More → Convert to Sales Order**. The form opens prefilled with the client and lines; click **Save and Submit**. The new order `SO-00001` is linked back to the estimate and shows **Pending Approval** (sales orders need approval by default, see below). Click **Approve**, then **Mark as Confirmed**.
4. **Convert to an invoice.** On the sales order, click **Convert to Invoice** and then **Save and Send** (or Save as Draft, then Mark as Sent). The sales order's Invoiced indicator turns green. The invoice gets number `INV-00001`, a due date from the client's payment terms (Net 15), and status **Open/Due**.
5. **Check the journal.** Open the invoice's **Journal** tab:
   Accounts Receivable debit ₹24,000.00, Sales credit ₹24,000.00.
6. **Record the payment.** On the invoice, **Record Payment → Record Payment**. The invoice is prefilled with ₹24,000. Choose mode *Cash* (Deposit To *Petty Cash*) and **Save as Paid**.
   * The invoice shows **PAID** with balance ₹0.00.
   * The payment's journal shows Petty Cash debit ₹24,000.00 and Accounts Receivable credit ₹24,000.00.
   * Test Company's **Statement** and **Transactions** tabs list the invoice and the payment; its Overview shows ₹0.00 outstanding and the income chart shows ₹24,000 for this month.
7. **Check the ledger.** Reports → **Trial Balance**: total debits equal total credits.

Try also: an estimate with 10% discount and 2% TDS (`₹1,00,000 → ₹88,200`), partial payments, overpayment (the excess becomes an unused credit), a credit note applied to an invoice and refunded.

### B. Supplier → Bill → Supplier Payment

1. **Create a supplier.** Payables → Suppliers → **New**. Display name *Madurai Box Works*, payment terms *Due on Receipt*. Save.
2. **Create a bill.** Payables → Purchase Bills → **New**. Supplier *Madurai Box Works*, Bill# `MBW-771`, one line (pick an item such as *Printed Brochure*, or type a description), qty 1, rate `6000`. **Save as Open**. The bill shows ₹6,000.00 due and its journal shows the line's purchase account debited and Accounts Payable credited ₹6,000.00.
3. **Pay the bill.** On the bill, **Record Payment** (or Payables → Supplier Payments → **New**). The bill is prefilled with ₹6,000; choose Paid Through *Petty Cash*, **Save as Paid**.
   * The bill shows **PAID**.
   * The payment's journal shows Accounts Payable debit and Petty Cash credit ₹6,000.00.
   * The supplier's payables drop to ₹0.00 and the Dashboard's Total Payables updates.

Try also: a purchase order converted to a bill (the PO becomes **Billed**), bills with TDS (TDS Payable is credited), debit notes, and expenses (Payables → Expenses), which post straight to the expense account.

### C. Submit for Approval

Settings → **Approvals** turns approval on or off per module (Estimates, Sales Orders, Invoices, Credit Notes, Purchase Orders, Bills, Debit Notes). Sales orders require approval out of the box; the others are off until you turn them on.

1. Create a sales order and click **Save as Draft**. The detail page shows a **Submit for Approval** toolbar button, a **What's next?** banner with **Submit for Approval** and **Approve**, and a diagonal **Draft** ribbon on the preview.
2. Click **Submit for Approval**. Status becomes **Pending Approval** and the toolbar offers **Approve** and **Reject**. Send, Share, Mark as Confirmed and Convert to Invoice stay hidden until it is approved, and the API refuses them.
3. **Reject** asks for a reason, shown on the banner. Edit the order (the primary button reads **Save and Submit**) or click **Submit for Approval** to send it back.
4. **Approve** moves it to **Approved**. The banner then offers **Send Sales Order** or **Mark as Confirmed**, which makes it **Confirmed** as before.
5. The **Activity** tab lists every submission, rejection (with reason) and approval.

Documents that are draft, pending approval, approved or rejected never post to the ledger, receivables/payables or reports. Editing an approved document sends it back for approval.

### D. PDF templates

Every transaction's **Details** tab shows the PDF preview with a **Show PDF View** switch and a **Customize** button:

* **Change Template** opens a drawer with a live thumbnail of each template rendered with the current document. Click one to use it for this document, or the star to make it the default for the module.
* **Edit Template** opens the full-screen editor: General (name, paper size A5 / A4 / Letter, orientation, margins, layout, font, colours, background), Header & Footer, Transaction Details, Table, Total and Other Details (notes, terms, bank details, signature). **Select Color Theme** recolours the template; the preview updates live and **Refresh Preview** redraws it.
* **Update Logo & Address** uploads the organisation logo (jpg, png, gif, bmp up to 1 MB) and edits the address, phone, fax, website and industry printed on PDFs.
* **Manage Custom Fields** adds fields to the module's form (text, number, date, dropdown, …); fields marked *Show in all PDFs* print with the document details. The **Preferences** tab sets the module's default template, notes and terms.
* **Terms & Conditions** edits the notes and terms of this document, with *Use this in future for all … of all clients* to make them the default.

Six designs ship with the app: Standard, Modern, Classic, Bold, Minimal and Spreadsheet. Settings → **PDF Templates** lists them with New, Clone, Edit and Delete, and picks a default template per module. The browser print view and the PDF attached to emails are drawn from the same template, with embedded fonts that print ₹.

### E. Shared links and the client portal

**Share links.** **Share** on a sent estimate, sales order, invoice or credit note creates a public link (`/share/<token>`) with an expiry date or *Never expires*. The page shows the document, its status and amount, **Download** / **Print** (server PDF), and, if allowed in Settings → Client Portal, **Accept / Decline** for estimates and **How to pay** plus **I've made a payment** for invoices. The Share dialog lists active links with view counts and lets you disable one or all. Drafts and documents waiting for approval cannot be shared, and the link hides internal notes.

**Client portal** (`/portal`):

1. **Settings → Client Portal**: turn the portal on, choose what clients can do (accept estimates, statements, report payments, act from shared links, email me when they do), set the portal name and public URL used in email links, a welcome message, and payment instructions (UPI ID for a QR code and *Pay with UPI* button, bank transfer details).
2. Open a client → **More → Client Portal Access**, tick the primary email and/or contact persons, **Send Invitation**. The invitation email has an **Accept Invitation** button valid for 7 days. If email is not set up, the dialog shows the invitation link to share yourself. Resend, disable, remove a user, or turn off portal access for the client from the same dialog; the client's overview shows the portal status.
3. The client sets a password and lands on the dashboard: outstanding and overdue amounts, invoices to pay, estimates awaiting a response, recent payments and documents. They can list and open **Estimates, Sales Orders, Invoices, Credit Notes**, download PDFs, **accept or decline** estimates (name and comment recorded), see **how to pay** and **report a payment** with its UTR reference, download **payment receipts**, view and download their **statement** for any period, and change their name and password. **Forgot password** emails a reset link valid for 2 hours.
4. Back in Creatign Ledger: the estimate shows **Accepted by … via the client portal** with the comment, and its status changes; documents show **Viewed by the client**; an invoice with a reported payment shows a banner with **Record Payment** (choose the deposit account; the payment is applied to the invoice) or **Dismiss**. All reported payments are also listed in Settings → Client Portal → Reported Payments. Everything is in the Activity timeline with the client's name, and the organisation email gets a notification.

Security: passwords are hashed with scrypt; sessions are random tokens stored hashed, in an HttpOnly SameSite=Lax cookie that expires after 14 days; invitation, reset and share tokens are 256-bit random values (invitation and reset tokens are stored hashed); five wrong passwords lock the account for 15 minutes and sign-in, reset and public actions are rate limited; clients only ever see their own documents that were sent to them.

### Automated check

`npm test` runs the workflows end to end through the API (65 tests, including email templates and the outbox, shared links, the client portal, approvals and PDF templates): totals with discount, TDS and TCS, number series, due dates, conversions and back-links, balanced journals, partial, full and excess payments, credit notes and refunds, PO → bill, payments made, expenses, the dashboard, P&L, balance sheet, trial balance, and a weekly recurring invoice profile that generates its invoices and then expires.

## Notes and limits

* **Email** is delivered through Gmail or SMTP once set up (see *Sending email*); otherwise it waits in the outbox. Attached PDFs use the document's PDF template and the fonts in `client/public/fonts`. Automatic, scheduled payment reminders are not implemented; send reminders from the invoice (the Payment Reminder template is picked for overdue invoices).
* **Online payments**: the portal shows UPI and bank details and lets clients report payments for you to confirm; there is no card or net-banking gateway, so nothing is charged online.
* **Exposing the app on the internet**: the staff app needs sign-in, and the portal and share links have their own authentication. Serve it over HTTPS so cookies are marked Secure, and keep `AUTH_DISABLED` unset. Set `APP_ORIGIN` (or the Portal URL setting) to the public address so email links point there.
* **PDF** uses the browser's print-to-PDF from the PDF/Print buttons (pages under `/print/...`), sized to the template's paper and margins. Emailed PDFs embed JPG and PNG logos only, and page numbers appear on emailed PDFs only.
* Recurring invoices, bills and expenses generate due documents when the server starts, on the first request each day, and from **More → Generate due invoices now**.
* Single organisation and single user. GST tax lines, multi-currency, bank feeds and reconciliation are not implemented.
* One app process serves one MySQL database; it keeps the books in memory and writes each change through. Scaling out to several app servers would need the services to query MySQL directly.
