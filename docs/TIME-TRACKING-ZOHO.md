# Time Tracking: Zoho Books analysis and the Creatign build

This note studies Zoho Books' **Time Tracking** module (Projects and Timesheet), using the ten
screenshots supplied from `books.zoho.in` plus Zoho's documented behaviour, and maps every part to
what Creatign Books now does.

## 1. How Zoho Books structures time tracking

Time Tracking is a sidebar group with two pages, **Projects** and **Timesheet**. Projects hold
the commercial terms (who pays, how, how much); timesheet entries hold the work (who did what,
for how long, on which task); invoices turn unbilled work into revenue.

```
Customer ─┬─ Project (billing method, rate/cost, budget, users, tasks)
          │     ├─ Time entries (date, task, user, HH:MM, billable → unbilled / invoiced)
          │     ├─ Expenses, Bills, POs, Vendor credits   (Purchases tab)
          │     ├─ Invoices, Quotes, Sales orders, Credit notes (Sales tab)
          │     ├─ Manual journals (Journals tab)
          │     └─ Budgets (income / expense accounts per period)
          └─ Invoice ← "Invoice project" pulls unbilled time (+ billable expenses)
```

## 2. Projects

### All Projects list (screenshot 1)
- Title is a view picker: **All Projects ▾** (All, Active, Inactive).
- Columns: Customer Name, Project Name (link), Billing Method, Rate. Row checkboxes for bulk
  actions; a column-chooser icon and an in-table search icon.
- Toolbar: **list / split view** toggle, **Start** (timer), **New** with a dropdown, and a **⋯**
  menu (import, export, refresh).
- Rate shows the project cost for fixed-cost projects and the hourly rate for hourly ones.

### Billing methods (Zoho's four)
| Method | What "Rate" means | How time is valued on the invoice |
| --- | --- | --- |
| Fixed Cost for Project | Total project cost | Not by hours. You bill a *project fee* (all or part of the cost). Unbilled = cost − billed fees. |
| Based on Project Hours | One hourly rate | hours × project rate |
| Based on Task Hours | Rate on each task | hours × task rate |
| Based on Staff Hours | Rate on each user | hours × user rate |

### Project detail (screenshots 2–9)
Header: back arrow, project name, **Edit**, **Log Time** (primary), **New Transaction ▾**,
**attachments** (paperclip), **More ▾** (mark inactive, clone, delete, watchlist), close ✕.
Tabs: Overview, Timesheet, Purchases, Sales, Budget Configuration, Journals, Activity Logs, and a
**Comments** link at the right.

- **Overview**: left card with Project Code, Billing Method, Total Project Cost (or rate),
  "Add to dashboard watchlist: Enabled – Disable", **Unbilled Amount** (green) and **Billed
  Amount** (red). Right: a **Logged Hours** bar chart by day with a period picker, and a Logged
  Hours total with its value. Below: **Users** (name + email, logged hours, role, + Add User)
  and **Project Tasks** (+ Add Task; "No project tasks have been added.").
- **Timesheet**: VIEW BY Status (All / Unbilled / Invoiced) and Period; columns Date, Task (sortable),
  User, Time, Billing Status. Empty state "There are no timesheets."
- **Purchases**: "Go to transactions ▾" plus four collapsible cards, each with its own
  Status filter: **Expenses** (Date, Expense Account, Reference#, Vendor, Paid Through, Customer,
  Amount, Status), **Bills** (Date, Bill#, Reference#, Vendor, Project Cost, Amount, Balance Due,
  Status), **Purchase Orders** (PO#, Reference#, Date, Vendor, Delivery Date, Project Cost, Amount,
  Status), **Vendor Credits** (Date, Credit Note#, Reference#, Vendor, Project Cost, Balance,
  Amount, Status).
- **Sales**: four cards with Status filters, "Total Count: View" and pagination: **Invoices**
  (Date, Invoice#, Reference#, Project Fee, Amount, Balance Due, Status), **Quotes** (Date, Quote#,
  Reference#, Amount, Status), **Sales Orders** (Sales Order#, Reference#, Date, Shipment Date,
  Project Fee, Amount, Status), **Credit Notes** (Credit Date, Credit Note#, Reference#, Project
  Fee, Balance, Amount, Status). The seen data shows a ₹100 project fee on an invoice reducing a
  ₹1,00,000 fixed-cost project's unbilled amount to ₹99,900.
- **Budget Configuration**: table Name / Fiscal Year / Budget Period with **+ New Budget**. The
  form takes Name*, Fiscal Year* (Apr 2026 – Mar 2027), Budget Period* (Monthly…), Project
  (fixed), Income Accounts and Expense Accounts ("Add Accounts"), and "Include Asset, Liability,
  and Equity Accounts in Budget".
- **Journals**: manual journals tagged to the project ("There are no journals associated with
  this project.").
- **Activity Logs**: a timeline such as "Project created by Jeeva V", "User Jeeva V added".
- **Comments**: a side panel of comments on the project.

## 3. Timesheet (screenshot 10)
- Title view picker **All Timesheets ▾** (All, Unbilled, Invoiced).
- Toolbar: **Summary** (chart icon), **list / calendar** toggle, **Start** (timer),
  **New Log Entry ▾** (also weekly log), **⋯** (export).
- VIEW BY: Period (All, Today, This Week, …), Select customer, Select a project, Select user.
- Columns: Date, Project (link), Customer, Task (sortable), User, Time (HH:MM), Billing Status.
  On hover a row shows **Start** (continue timing this entry), edit ✎ and a gear menu.

### Log entry and the timer
- Log entry: Date*, Project*, Task*, User*, Time spent (HH:MM, or start and end time),
  Billable, Notes, with **Start Timer** as an alternative to typing hours.
- Timer: one running timer per user, shown in the top bar with elapsed time; pause/resume,
  stop and save (creates or extends the entry), or discard. The per-row Start resumes an
  existing entry and adds the new time to it.

### Invoicing unbilled time
From a project (New Transaction › Invoice) or the customer's new invoice, Zoho offers "Invoice
project": pick the date range of unbilled time and how lines are shown (one line for the project,
one per task, per staff, or per time entry), optionally include billable expenses. The entries
become **Invoiced** and link to the invoice; deleting the invoice puts them back to **Unbilled**.
Fixed-cost projects bill a project fee instead of hours.

## 4. What Creatign had before this change
A flat Projects table (name, customer, two billing methods, a rate, a total-hours count, a
one-click "invoice everything") and a Timesheet form with a list. No project page, no tasks,
users, timer, calendar, filters, budgets, purchases/sales linkage, journals, activity or comments.

## 5. What Creatign does now
| Zoho feature | Creatign |
| --- | --- |
| All Projects list with views, list/split toggle, Start, New, ⋯ | Yes; Active/Inactive views, split view, CSV export, bulk activate/deactivate/delete |
| Four billing methods | Yes; old "hourly" projects migrate to Based on Project Hours |
| Project form: code, customer, method, cost/rate, description, budget, users, tasks, watchlist | Yes |
| Project detail header: Edit, Log Time, New Transaction, attachments, More | Yes |
| Overview: details card, unbilled/billed, logged-hours chart, users, tasks | Yes, plus budget-hours progress |
| Timesheet tab with Status and Period | Yes |
| Purchases tab: expenses, bills, POs, vendor credits, status filters | Yes (project picker added to bills, POs and vendor credits) |
| Sales tab: invoices, quotes, sales orders, credit notes, project fee | Yes (project picker stores the project id on all of them) |
| Budget Configuration: new budget with FY, period, income/expense accounts | Yes, with per-period amounts and budget vs actuals |
| Journals tab | Yes (manual journals can be tagged to a project) |
| Activity Logs and Comments | Yes |
| Timesheet: views, Summary, list/calendar, Start, New Log Entry, weekly log, filters, per-row Start, billing status | Yes |
| Running timer in the top bar | Yes (pause, resume, stop and save, discard) |
| Invoice unbilled time (project/task/staff/entry lines, date range, billable expenses) | Yes; deleting the invoice returns time to Unbilled |
| Fixed-cost project fee invoicing | Yes |
| Dashboard watchlist | Yes, a Projects card on Home |

Not built: timesheet approvals, customer approval of timesheets in the portal, and Zoho's
separate project reports (Timesheet Details / Project Summary).
