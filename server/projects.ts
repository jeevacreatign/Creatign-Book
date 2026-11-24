// Time tracking: projects (four billing methods, tasks, users, budgets), timesheet entries,
// the running timer, and invoicing unbilled time. Mirrors Zoho Books' Projects + Timesheet.
import type { Request, RequestHandler, Router } from 'express';
import { DOC_META } from '../shared/docmeta';
import { round2, today } from '../shared/format';
import { BILLING_STATUS_LABEL, billingLabel, billingStatus, budgetBuckets, entryRate, hoursBetween, normalizeBillingMethod, parseHours, timePeriodRange } from '../shared/projects';
import type { Attachment, Budget, Database, DocKind, Journal, Project, ProjectTask, RunningTimer, TimeEntry, TxnDoc, User } from '../shared/types';
import { getDb, newId, now } from './db';
import { logActivity } from './engine';
import * as S from './services';

type Handler = (req: Request) => unknown;
type Wrap = (fn: Handler) => RequestHandler;

const bad = (msg: string) => new S.HttpError(400, msg);
const notFound = (what: string) => new S.HttpError(404, `${what} not found`);
const str = (v: unknown) => (v == null ? undefined : String(v).trim() || undefined);
const num = (v: unknown) => (v === '' || v == null || Number.isNaN(Number(v)) ? undefined : Number(v));
const q = (req: Request, k: string) => (typeof req.query[k] === 'string' ? (req.query[k] as string) : undefined);
const p = (req: Request, k: string) => String(req.params[k]);
const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));

// ================================================================== data upgrade

/** Fill in fields added by the time tracking rebuild (old projects, entries and users). Safe to run repeatedly. */
export function normalizeTimeTracking(db: Database) {
  db.users ||= [];
  db.timers ||= [];
  db.budgets ||= [];
  if (!db.users.length) {
    const name = (db.preferences.salespersons as string[] | undefined)?.[0] || 'Admin';
    db.users.push({ id: 'usr_admin', name, email: db.organization.email, role: 'Admin', status: 'active', createdAt: now() });
  }
  const me = db.users[0].id;
  for (const x of db.projects) {
    x.billingMethod = normalizeBillingMethod(x.billingMethod);
    x.users ||= [];
    x.tasks ||= [];
    x.attachments ||= [];
    x.watchlist ??= false;
    if (x.budgetHours && !x.budgetHoursType) x.budgetHoursType = 'total';
    if (!x.users.length) x.users.push({ userId: me });
  }
  for (const t of db.timeEntries) {
    t.userId ||= me;
    // legacy free-text tasks become project tasks so they can carry a rate
    if (!t.taskId && t.task) {
      const prj = db.projects.find((x) => x.id === t.projectId);
      if (prj) {
        let task = prj.tasks.find((k) => k.name.toLowerCase() === t.task!.toLowerCase());
        if (!task) prj.tasks.push((task = { id: newId('tsk'), name: t.task, billable: true }));
        t.taskId = task.id;
      }
    }
  }
}

// ================================================================== helpers

export const currentUser = (db: Database): User => db.users.find((u) => u.role === 'Admin' && u.status === 'active') ?? db.users[0];

function getProject(db: Database, id: string) {
  const x = db.projects.find((y) => y.id === id);
  if (!x) throw notFound('Project');
  return x;
}

/** Project a document belongs to (by id, or by name for documents saved before ids were stored). */
export function docProjectId(db: Database, d: Pick<TxnDoc, 'projectId' | 'projectName'>) {
  if (d.projectId) return d.projectId;
  if (d.projectName) return db.projects.find((x) => x.name === d.projectName)?.id;
  return undefined;
}

const projectFee = (d: TxnDoc) => round2(d.projectFee ?? d.subTotal ?? 0);

function projectInvoices(db: Database, id: string) {
  return db.docs.filter((d) => d.kind === 'invoice' && d.status !== 'void' && docProjectId(db, d) === id);
}

function stats(db: Database, prj: Project) {
  const entries = db.timeEntries.filter((t) => t.projectId === prj.id);
  const hours = (f: (t: TimeEntry) => boolean) => sum(entries.filter(f).map((t) => t.hours));
  const billedAmount = sum(projectInvoices(db, prj.id).map(projectFee));
  const unbilledEntries = entries.filter((t) => t.billable && !t.invoiced);
  const unbilledExpenses = db.expenses.filter((e) => e.projectId === prj.id && e.billable && e.status === 'unbilled');
  const unbilledAmount =
    prj.billingMethod === 'fixed'
      ? round2(Math.max(0, prj.rate - billedAmount))
      : sum(unbilledEntries.map((t) => t.hours * entryRate(prj, t)));
  const budgetHours =
    prj.budgetHoursType === 'total' ? prj.budgetHours || 0 : prj.budgetHoursType === 'per_task' ? sum(prj.tasks.map((t) => t.budgetHours || 0)) : prj.budgetHoursType === 'per_staff' ? sum(prj.users.map((u) => u.budgetHours || 0)) : 0;
  return {
    loggedHours: hours(() => true),
    billableHours: hours((t) => t.billable),
    nonBillableHours: hours((t) => !t.billable),
    billedHours: hours((t) => t.invoiced),
    unbilledHours: hours((t) => t.billable && !t.invoiced),
    unbilledAmount,
    unbilledExpenses: sum(unbilledExpenses.map((e) => e.amount)),
    billedAmount,
    budgetHours,
  };
}

function projectRow(db: Database, x: Project) {
  return { ...x, customerName: S.contactName(db, x.customerId), billingMethodLabel: billingLabel(x.billingMethod), ...stats(db, x) };
}

function projectDetail(db: Database, x: Project) {
  const entries = db.timeEntries.filter((t) => t.projectId === x.id);
  const hoursBy = (f: (t: TimeEntry) => boolean) => sum(entries.filter(f).map((t) => t.hours));
  return {
    ...projectRow(db, x),
    customer: db.contacts.find((c) => c.id === x.customerId),
    users: x.users.map((u) => {
      const user = db.users.find((y) => y.id === u.userId);
      return { ...u, name: user?.name ?? 'Unknown user', email: user?.email, role: user?.role ?? 'Staff', loggedHours: hoursBy((t) => t.userId === u.userId) };
    }),
    tasks: x.tasks.map((t) => ({ ...t, loggedHours: hoursBy((e) => e.taskId === t.id) })),
  };
}

function entryRow(db: Database, t: TimeEntry) {
  const prj = db.projects.find((x) => x.id === t.projectId);
  const task = prj?.tasks.find((k) => k.id === t.taskId);
  const rate = prj ? entryRate(prj, t) : 0;
  const status = billingStatus(t);
  const inv = t.invoiceId ? db.docs.find((d) => d.id === t.invoiceId) : undefined;
  return {
    ...t,
    projectName: prj?.name,
    customerId: prj?.customerId,
    customerName: S.contactName(db, prj?.customerId),
    taskName: task?.name ?? t.task,
    userName: db.users.find((u) => u.id === t.userId)?.name,
    billingMethod: prj?.billingMethod,
    rate,
    amount: prj?.billingMethod === 'fixed' ? 0 : round2(t.hours * rate),
    billingStatus: status,
    billingStatusLabel: BILLING_STATUS_LABEL[status],
    invoiceNumber: inv?.number,
  };
}

function filterEntries(db: Database, req: Request) {
  const fy = db.organization.fiscalYearStartMonth;
  const r = timePeriodRange(q(req, 'period') || 'all', today(), fy, { from: q(req, 'from'), to: q(req, 'to') });
  const projectId = q(req, 'projectId');
  const customerId = q(req, 'customerId');
  const userId = q(req, 'userId');
  const status = q(req, 'status');
  const search = q(req, 'q')?.toLowerCase();
  return db.timeEntries
    .filter((t) => t.date >= r.from && t.date <= r.to)
    .filter((t) => !projectId || t.projectId === projectId)
    .filter((t) => !userId || t.userId === userId)
    .filter((t) => !status || status === 'all' || billingStatus(t) === status)
    .map((t) => entryRow(db, t))
    .filter((t) => !customerId || t.customerId === customerId)
    .filter((t) => !search || [t.projectName, t.customerName, t.taskName, t.userName, t.notes].some((x) => x?.toLowerCase().includes(search)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

/** Resolve the task of an entry: an existing task id, or a new task name added to the project. */
function resolveTask(prj: Project, taskId?: string, taskName?: string): ProjectTask | undefined {
  if (taskId) {
    const t = prj.tasks.find((k) => k.id === taskId);
    if (!t) throw bad('Select a task from this project');
    return t;
  }
  const name = str(taskName);
  if (!name) return undefined;
  let t = prj.tasks.find((k) => k.name.toLowerCase() === name.toLowerCase());
  if (!t) prj.tasks.push((t = { id: newId('tsk'), name, billable: true }));
  return t;
}

function ensureProjectUser(db: Database, prj: Project, userId: string) {
  if (!db.users.some((u) => u.id === userId)) throw bad('Select a user');
  if (!prj.users.some((u) => u.userId === userId)) {
    prj.users.push({ userId });
    logActivity(db, 'project', prj.id, prj.customerId, `User ${db.users.find((u) => u.id === userId)?.name} added`, undefined, currentUser(db).name);
  }
}

/** Validate and build an entry from a request body (new or edit). */
function buildEntry(db: Database, b: Record<string, unknown>, existing?: TimeEntry): TimeEntry {
  const prj = getProject(db, String(b.projectId ?? existing?.projectId ?? ''));
  if (prj.status === 'inactive' && !existing) throw bad('This project is inactive. Mark it as active to log time.');
  const task = resolveTask(prj, str(b.taskId) ?? (b.taskName ? undefined : existing?.taskId), str(b.taskName));
  if (!task && prj.tasks.length) throw bad('Task Name is required');
  const userId = str(b.userId) ?? existing?.userId ?? currentUser(db).id;
  ensureProjectUser(db, prj, userId);
  const startTime = str(b.startTime);
  const endTime = str(b.endTime);
  let hours = startTime && endTime ? hoursBetween(startTime, endTime) : parseHours((b.hours ?? b.time ?? existing?.hours) as string);
  if (!(hours > 0)) throw bad('Enter the time spent (HH:MM)');
  if (hours > 24) throw bad('Time spent cannot be more than 24 hours a day');
  hours = Math.round(hours * 60) / 60;
  const date = str(b.date) ?? existing?.date ?? today();
  const billable = prj.billingMethod === 'fixed' ? b.billable !== false && b.billable !== 'false' : b.billable === undefined ? (existing?.billable ?? task?.billable ?? true) : Boolean(b.billable);
  return {
    id: existing?.id ?? newId('te'),
    projectId: prj.id,
    taskId: task?.id,
    task: task ? undefined : existing?.task,
    userId,
    date,
    hours,
    startTime: startTime && endTime ? startTime : undefined,
    endTime: startTime && endTime ? endTime : undefined,
    notes: b.notes === undefined ? existing?.notes : str(b.notes),
    billable,
    invoiced: existing?.invoiced ?? false,
    invoiceId: existing?.invoiceId,
    createdAt: existing?.createdAt ?? now(),
    updatedAt: existing ? now() : undefined,
  };
}

function saveProject(db: Database, b: Partial<Project> & { users?: Project['users']; tasks?: Project['tasks'] }, existing?: Project): Project {
  const name = str(b.name) ?? existing?.name;
  if (!name) throw bad('Project Name is required');
  if (db.projects.some((x) => x.name.toLowerCase() === name.toLowerCase() && x.id !== existing?.id)) throw bad(`A project named "${name}" already exists`);
  const customerId = str(b.customerId) ?? existing?.customerId;
  const customer = db.contacts.find((c) => c.id === customerId && c.kind === 'customer');
  if (!customer) throw bad('Customer Name is required');
  const code = str(b.code) ?? (b.code === '' ? undefined : existing?.code);
  if (code && db.projects.some((x) => x.code === code && x.id !== existing?.id)) throw bad(`Project code ${code} is already used`);
  const billingMethod = normalizeBillingMethod(b.billingMethod ?? existing?.billingMethod);
  const rate = num(b.rate) ?? existing?.rate ?? 0;
  if (billingMethod === 'fixed' && !(rate > 0)) throw bad('Total Project Cost is required');
  if (billingMethod === 'project_hours' && !(rate > 0)) throw bad('Rate per Hour is required');
  const tasks = (b.tasks ?? existing?.tasks ?? [])
    .filter((t) => str(t.name))
    .map((t) => ({ id: t.id && !String(t.id).startsWith('new') ? t.id : newId('tsk'), name: str(t.name)!, description: str(t.description), ratePerHour: num(t.ratePerHour), budgetHours: num(t.budgetHours), billable: t.billable !== false }));
  const seen = new Set<string>();
  for (const t of tasks) {
    if (seen.has(t.name.toLowerCase())) throw bad(`Task "${t.name}" is listed twice`);
    seen.add(t.name.toLowerCase());
  }
  const users = (b.users ?? existing?.users ?? []).filter((u) => u.userId && db.users.some((x) => x.id === u.userId)).map((u) => ({ userId: u.userId, ratePerHour: num(u.ratePerHour), budgetHours: num(u.budgetHours) }));
  if (!users.length) users.push({ userId: currentUser(db).id, ratePerHour: undefined, budgetHours: undefined });
  if (new Set(users.map((u) => u.userId)).size !== users.length) throw bad('A user is listed twice');
  if (billingMethod === 'task_hours' && !tasks.length) throw bad('Add at least one task with a rate for Based on Task Hours');
  // tasks that have time logged cannot be removed
  if (existing) {
    const keep = new Set(tasks.map((t) => t.id));
    const used = existing.tasks.find((t) => !keep.has(t.id) && db.timeEntries.some((e) => e.taskId === t.id));
    if (used) throw bad(`Task "${used.name}" has time logged and cannot be removed`);
    const keepU = new Set(users.map((u) => u.userId));
    const usedU = existing.users.find((u) => !keepU.has(u.userId) && db.timeEntries.some((e) => e.projectId === existing.id && e.userId === u.userId));
    if (usedU) throw bad(`${db.users.find((x) => x.id === usedU.userId)?.name ?? 'This user'} has time logged and cannot be removed`);
  }
  const budgetHoursType = b.budgetHoursType ?? existing?.budgetHoursType ?? 'none';
  const out: Project = {
    id: existing?.id ?? newId('prj'),
    name,
    code,
    customerId: customer.id,
    billingMethod,
    rate: billingMethod === 'fixed' || billingMethod === 'project_hours' ? round2(rate) : 0,
    description: b.description === undefined ? existing?.description : str(b.description),
    costBudget: b.costBudget === undefined ? existing?.costBudget : num(b.costBudget),
    revenueBudget: b.revenueBudget === undefined ? existing?.revenueBudget : num(b.revenueBudget),
    budgetHoursType,
    budgetHours: budgetHoursType === 'total' ? num(b.budgetHours) ?? existing?.budgetHours : undefined,
    users,
    tasks,
    watchlist: b.watchlist === undefined ? existing?.watchlist ?? false : Boolean(b.watchlist),
    attachments: existing?.attachments ?? [],
    status: existing?.status ?? 'active',
    createdAt: existing?.createdAt ?? now(),
    updatedAt: existing ? now() : undefined,
  };
  const me = currentUser(db).name;
  if (existing) {
    const changes: string[] = [];
    if (existing.billingMethod !== out.billingMethod) changes.push(`billing method changed to ${billingLabel(out.billingMethod)}`);
    if (existing.rate !== out.rate) changes.push(`${out.billingMethod === 'fixed' ? 'project cost' : 'rate'} changed to ₹${out.rate}`);
    for (const t of out.tasks) if (!existing.tasks.some((k) => k.id === t.id)) logActivity(db, 'project', out.id, out.customerId, `Task ${t.name} added`, undefined, me);
    for (const u of out.users) if (!existing.users.some((k) => k.userId === u.userId)) logActivity(db, 'project', out.id, out.customerId, `User ${db.users.find((x) => x.id === u.userId)?.name} added`, undefined, me);
    Object.assign(existing, out);
    logActivity(db, 'project', out.id, out.customerId, 'Project updated', changes.join('; ') || undefined, me);
    // keep the display name on linked documents in step
    for (const d of db.docs) if (d.projectId === out.id) d.projectName = out.name;
    return existing;
  }
  db.projects.push(out);
  logActivity(db, 'project', out.id, out.customerId, 'Project created', undefined, me);
  for (const u of out.users) logActivity(db, 'project', out.id, out.customerId, `User ${db.users.find((x) => x.id === u.userId)?.name} added`, undefined, me);
  for (const t of out.tasks) logActivity(db, 'project', out.id, out.customerId, `Task ${t.name} added`, undefined, me);
  return out;
}

function deleteProject(db: Database, id: string) {
  const prj = getProject(db, id);
  if (db.timeEntries.some((t) => t.projectId === id && t.invoiced)) throw bad(`${prj.name} has invoiced time and cannot be deleted. Mark it as inactive instead.`);
  const linked = db.docs.find((d) => docProjectId(db, d) === id && !DOC_META[d.kind].recurring);
  if (linked) throw bad(`${prj.name} is used in ${DOC_META[linked.kind].label} ${linked.number}. Mark it as inactive instead.`);
  db.projects = db.projects.filter((x) => x.id !== id);
  db.timeEntries = db.timeEntries.filter((t) => t.projectId !== id);
  db.timers = db.timers.filter((t) => t.projectId !== id);
  db.budgets = db.budgets.filter((b) => b.projectId !== id);
  for (const e of db.expenses) if (e.projectId === id) e.projectId = undefined;
  for (const r of db.recurringExpenses) if (r.projectId === id) r.projectId = undefined;
  for (const j of db.journals) if (j.projectId === id) j.projectId = undefined;
  for (const d of db.docs) if (d.projectId === id) d.projectId = undefined;
  return prj;
}

// ================================================================== invoicing

export type InvoiceGrouping = 'project' | 'task' | 'staff' | 'entry';

interface InvoiceRequest {
  from?: string;
  to?: string;
  groupBy?: InvoiceGrouping;
  includeExpenses?: boolean;
  entryIds?: string[];
  expenseIds?: string[];
  /** fixed-cost projects: the fee to bill now */
  fee?: number;
  date?: string;
}

function unbilled(db: Database, prj: Project, r: InvoiceRequest) {
  const entries = db.timeEntries
    .filter((t) => t.projectId === prj.id && t.billable && !t.invoiced)
    .filter((t) => (!r.from || t.date >= r.from) && (!r.to || t.date <= r.to))
    .filter((t) => !r.entryIds || r.entryIds.includes(t.id));
  const expenses = db.expenses
    .filter((e) => e.projectId === prj.id && e.billable && e.status === 'unbilled' && e.customerId === prj.customerId)
    .filter((e) => (!r.from || e.date >= r.from) && (!r.to || e.date <= r.to))
    .filter((e) => !r.expenseIds || r.expenseIds.includes(e.id));
  return { entries, expenses };
}

function timeLines(db: Database, prj: Project, entries: TimeEntry[], groupBy: InvoiceGrouping) {
  const taskName = (t: TimeEntry) => prj.tasks.find((k) => k.id === t.taskId)?.name ?? t.task ?? 'General';
  const userName = (t: TimeEntry) => db.users.find((u) => u.id === t.userId)?.name ?? 'Staff';
  const key = (t: TimeEntry) => (groupBy === 'project' ? '' : groupBy === 'task' ? taskName(t) : groupBy === 'staff' ? userName(t) : t.id);
  // a line can only carry one rate, so group by rate as well
  const groups = new Map<string, TimeEntry[]>();
  for (const t of [...entries].sort((a, b) => a.date.localeCompare(b.date))) {
    const k = `${key(t)}|${entryRate(prj, t)}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return [...groups.values()].map((list) => {
    const first = list[0];
    const hours = Math.round(sum(list.map((t) => t.hours)) * 100) / 100;
    const name =
      groupBy === 'project' ? prj.name : groupBy === 'task' ? `${prj.name} - ${taskName(first)}` : groupBy === 'staff' ? `${prj.name} - ${userName(first)}` : `${prj.name} - ${taskName(first)}`;
    const dates = [...new Set(list.map((t) => t.date))];
    const description =
      groupBy === 'entry'
        ? [first.date.split('-').reverse().join('/'), userName(first), first.notes].filter(Boolean).join(' · ')
        : `${dates.length > 1 ? `${dates[0].split('-').reverse().join('/')} to ${dates[dates.length - 1].split('-').reverse().join('/')}` : dates[0].split('-').reverse().join('/')}`;
    return { id: newId('li'), name, description, quantity: hours, unit: 'hrs', rate: entryRate(prj, first), amount: 0 };
  });
}

export function invoiceProject(db: Database, id: string, r: InvoiceRequest): TxnDoc {
  const prj = getProject(db, id);
  if (!prj.customerId) throw bad('Associate a customer with this project first');
  const { entries, expenses } = unbilled(db, prj, r);
  const lines: TxnDoc['lineItems'] = [];
  let fee = 0;
  if (prj.billingMethod === 'fixed') {
    const left = stats(db, prj).unbilledAmount;
    fee = round2(Number(r.fee ?? left));
    if (!(fee > 0)) throw bad('Enter the project fee to invoice');
    if (fee > left + 0.004) throw bad(`Only ₹${left.toFixed(2)} of the project cost is left to bill`);
    lines.push({ id: newId('li'), name: prj.name, description: 'Project fee', quantity: 1, unit: 'nos', rate: fee, amount: 0 });
  } else {
    if (!entries.length && !(r.includeExpenses && expenses.length)) throw bad('There are no unbilled hours for this project in the selected period');
    const tl = timeLines(db, prj, entries, r.groupBy ?? 'project');
    if (tl.some((l) => !(l.rate > 0))) throw bad(prj.billingMethod === 'task_hours' ? 'Set a rate on every task before invoicing' : prj.billingMethod === 'staff_hours' ? 'Set a rate for every user before invoicing' : 'Set the project rate before invoicing');
    lines.push(...tl);
    fee = sum(tl.map((l) => l.quantity * l.rate));
  }
  const billExpenses = r.includeExpenses ? expenses : [];
  for (const e of billExpenses) {
    const acct = db.accounts.find((a) => a.id === e.accountId);
    lines.push({ id: newId('li'), name: e.isMileage ? 'Mileage' : acct?.name ?? 'Expense', description: [e.date.split('-').reverse().join('/'), e.notes].filter(Boolean).join(' · '), quantity: 1, unit: 'nos', rate: e.amount, accountId: 'acc_general_income', amount: 0 });
  }
  const inv = S.saveDoc(
    'invoice',
    { contactId: prj.customerId, date: r.date || today(), projectId: prj.id, projectName: prj.name, projectFee: round2(fee), lineItems: lines, discountPercent: 0, tdsRate: 0, tcsRate: 0, adjustment: 0 } as Partial<TxnDoc>,
    'draft',
  );
  if (prj.billingMethod !== 'fixed')
    for (const t of entries) {
      t.invoiced = true;
      t.invoiceId = inv.id;
    }
  for (const e of billExpenses) {
    e.status = 'invoiced';
    e.invoiceId = inv.id;
  }
  logActivity(db, 'project', prj.id, prj.customerId, `Invoice ${inv.number} created`, prj.billingMethod === 'fixed' ? `Project fee ₹${fee.toFixed(2)}` : `${entries.length} time entr${entries.length === 1 ? 'y' : 'ies'} billed`, currentUser(db).name);
  return inv;
}

/** Called when an invoice is deleted: its time goes back to Unbilled. */
export function releaseInvoicedTime(db: Database, invoiceId: string) {
  for (const t of db.timeEntries)
    if (t.invoiceId === invoiceId) {
      t.invoiced = false;
      t.invoiceId = undefined;
    }
}

// ================================================================== timer

function myTimer(db: Database) {
  const me = currentUser(db).id;
  return db.timers.find((t) => t.userId === me);
}

function elapsedMs(t: RunningTimer, at = Date.now()) {
  return t.accumulatedMs + (t.running && t.startedAt ? at - Date.parse(t.startedAt) : 0);
}

function timerView(db: Database, t?: RunningTimer) {
  if (!t) return null;
  const prj = db.projects.find((x) => x.id === t.projectId);
  return { ...t, elapsedMs: elapsedMs(t), serverNow: now(), projectName: prj?.name, customerName: S.contactName(db, prj?.customerId), taskName: prj?.tasks.find((k) => k.id === t.taskId)?.name };
}

// ================================================================== budgets

function journalProjectId(db: Database, j: Journal) {
  if (j.projectId) return j.projectId;
  if (!j.sourceId) return undefined;
  if (j.sourceType === 'expense') return db.expenses.find((e) => e.id === j.sourceId)?.projectId;
  const d = db.docs.find((x) => x.id === j.sourceId);
  return d ? docProjectId(db, d) : undefined;
}

function budgetView(db: Database, b: Budget) {
  const buckets = budgetBuckets(b.fiscalYearStart, b.period);
  const journals = db.journals.filter((j) => !b.projectId || journalProjectId(db, j) === b.projectId);
  const lines = b.lines.map((l) => {
    const acct = db.accounts.find((a) => a.id === l.accountId);
    const sign = acct && (acct.type === 'income' || acct.type === 'liability' || acct.type === 'equity') ? -1 : 1;
    const actuals = buckets.map((k) =>
      sum(journals.filter((j) => j.date >= k.from && j.date <= k.to).flatMap((j) => j.lines.filter((x) => x.accountId === l.accountId).map((x) => sign * ((x.debit || 0) - (x.credit || 0))))),
    );
    return { ...l, accountName: acct?.name ?? 'Unknown account', accountType: acct?.type, actuals, total: sum(l.amounts), actualTotal: sum(actuals) };
  });
  return { ...b, buckets, lines, projectName: db.projects.find((x) => x.id === b.projectId)?.name };
}

function saveBudget(db: Database, body: Partial<Budget>, existing?: Budget): Budget {
  const name = str(body.name) ?? existing?.name;
  if (!name) throw bad('Name is required');
  const fiscalYearStart = str(body.fiscalYearStart) ?? existing?.fiscalYearStart;
  if (!fiscalYearStart || !/^\d{4}-\d{2}-01$/.test(fiscalYearStart)) throw bad('Fiscal Year is required');
  const period = body.period ?? existing?.period ?? 'monthly';
  if (!['monthly', 'quarterly', 'yearly'].includes(period)) throw bad('Budget Period is required');
  const projectId = str(body.projectId) ?? existing?.projectId;
  if (projectId) getProject(db, projectId);
  if (db.budgets.some((x) => x.name.toLowerCase() === name.toLowerCase() && x.projectId === projectId && x.id !== existing?.id)) throw bad(`A budget named "${name}" already exists`);
  const n = budgetBuckets(fiscalYearStart, period).length;
  const includeBalanceSheet = Boolean(body.includeBalanceSheet ?? existing?.includeBalanceSheet);
  const lines = (body.lines ?? existing?.lines ?? [])
    .filter((l) => db.accounts.some((a) => a.id === l.accountId))
    .map((l) => ({ accountId: l.accountId, amounts: Array.from({ length: n }, (_, i) => round2(Number(l.amounts?.[i]) || 0)) }));
  if (!includeBalanceSheet && lines.some((l) => !['income', 'expense'].includes(db.accounts.find((a) => a.id === l.accountId)!.type))) throw bad('Only income and expense accounts can be budgeted unless asset, liability and equity accounts are included');
  if (new Set(lines.map((l) => l.accountId)).size !== lines.length) throw bad('An account is listed twice');
  const out: Budget = { id: existing?.id ?? newId('bdg'), name, fiscalYearStart, period, projectId, includeBalanceSheet, lines, createdAt: existing?.createdAt ?? now(), updatedAt: existing ? now() : undefined };
  if (existing) Object.assign(existing, out);
  else db.budgets.push(out);
  if (projectId) logActivity(db, 'project', projectId, undefined, `Budget ${name} ${existing ? 'updated' : 'created'}`, undefined, currentUser(db).name);
  return existing ?? out;
}

// ================================================================== routes

export function registerProjectRoutes(api: Router, h: Wrap, m: Wrap) {
  // ---------------------------------------------------------------- users
  api.get('/users', h(() => getDb().users));
  api.post('/users', m((req) => {
    const db = getDb();
    const b = req.body as Partial<User>;
    const name = str(b.name);
    if (!name) throw bad('Name is required');
    const email = str(b.email);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Enter a valid email address');
    if (email && db.users.some((u) => u.email?.toLowerCase() === email.toLowerCase())) throw bad('A user with this email already exists');
    const u: User = { id: newId('usr'), name, email, role: b.role === 'Admin' || b.role === 'Timesheet Staff' ? b.role : 'Staff', status: 'active', createdAt: now() };
    db.users.push(u);
    return u;
  }));

  // ---------------------------------------------------------------- projects
  api.get('/projects', h((req) => {
    const db = getDb();
    const view = q(req, 'view') || 'all';
    const search = q(req, 'q')?.toLowerCase();
    return db.projects
      .filter((x) => view === 'all' || x.status === view)
      .filter((x) => !q(req, 'customerId') || x.customerId === q(req, 'customerId'))
      .map((x) => projectRow(db, x))
      .filter((x) => !search || [x.name, x.code, x.customerName].some((t) => t?.toLowerCase().includes(search)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }));
  api.get('/projects/watchlist', h(() => {
    const db = getDb();
    return db.projects.filter((x) => x.watchlist && x.status === 'active').map((x) => projectRow(db, x));
  }));
  api.get('/projects/:id', h((req) => {
    const db = getDb();
    return projectDetail(db, getProject(db, p(req, 'id')));
  }));
  api.post('/projects', m((req) => saveProject(getDb(), req.body)));
  api.put('/projects/:id', m((req) => {
    const db = getDb();
    return saveProject(db, req.body, getProject(db, p(req, 'id')));
  }));
  api.delete('/projects/:id', m((req) => {
    const db = getDb();
    const prj = deleteProject(db, p(req, 'id'));
    logActivity(db, 'project', prj.id, prj.customerId, 'Project deleted', prj.name, currentUser(db).name);
  }));
  api.post('/projects/bulk', m((req) => {
    const db = getDb();
    const { action, ids } = req.body as { action: string; ids: string[] };
    if (!Array.isArray(ids) || !ids.length) throw bad('Select at least one project');
    let done = 0;
    for (const id of ids) {
      const prj = getProject(db, id);
      if (action === 'delete') deleteProject(db, id);
      else if (action === 'activate' || action === 'deactivate') {
        prj.status = action === 'activate' ? 'active' : 'inactive';
        logActivity(db, 'project', prj.id, prj.customerId, `Project marked as ${prj.status}`, undefined, currentUser(db).name);
      } else throw bad('Unknown action');
      done++;
    }
    return { done };
  }));
  api.post('/projects/:id/actions/:action', m((req) => {
    const db = getDb();
    const prj = getProject(db, p(req, 'id'));
    const me = currentUser(db).name;
    switch (p(req, 'action')) {
      case 'activate':
      case 'deactivate':
        prj.status = p(req, 'action') === 'activate' ? 'active' : 'inactive';
        logActivity(db, 'project', prj.id, prj.customerId, `Project marked as ${prj.status}`, undefined, me);
        return prj;
      case 'watchlist':
        prj.watchlist = !(req.body as { off?: boolean }).off;
        logActivity(db, 'project', prj.id, prj.customerId, prj.watchlist ? 'Added to dashboard watchlist' : 'Removed from dashboard watchlist', undefined, me);
        return prj;
      case 'clone': {
        let name = `${prj.name} (Copy)`;
        for (let i = 2; db.projects.some((x) => x.name === name); i++) name = `${prj.name} (Copy ${i})`;
        return saveProject(db, { ...prj, id: undefined, name, code: undefined, tasks: prj.tasks.map((t) => ({ ...t, id: 'new' })), watchlist: false } as unknown as Project);
      }
      default:
        throw bad('Unknown action');
    }
  }));
  api.post('/projects/:id/tasks', m((req) => {
    const db = getDb();
    const prj = getProject(db, p(req, 'id'));
    const b = req.body as Partial<ProjectTask>;
    const name = str(b.name);
    if (!name) throw bad('Task Name is required');
    if (prj.tasks.some((t) => t.name.toLowerCase() === name.toLowerCase())) throw bad(`Task "${name}" already exists`);
    const t: ProjectTask = { id: newId('tsk'), name, description: str(b.description), ratePerHour: num(b.ratePerHour), budgetHours: num(b.budgetHours), billable: b.billable !== false };
    prj.tasks.push(t);
    logActivity(db, 'project', prj.id, prj.customerId, `Task ${name} added`, undefined, currentUser(db).name);
    return t;
  }));
  api.put('/projects/:id/tasks/:taskId', m((req) => {
    const db = getDb();
    const prj = getProject(db, p(req, 'id'));
    const t = prj.tasks.find((k) => k.id === p(req, 'taskId'));
    if (!t) throw notFound('Task');
    const b = req.body as Partial<ProjectTask>;
    const name = str(b.name) ?? t.name;
    if (prj.tasks.some((k) => k.id !== t.id && k.name.toLowerCase() === name.toLowerCase())) throw bad(`Task "${name}" already exists`);
    Object.assign(t, { name, description: b.description === undefined ? t.description : str(b.description), ratePerHour: b.ratePerHour === undefined ? t.ratePerHour : num(b.ratePerHour), budgetHours: b.budgetHours === undefined ? t.budgetHours : num(b.budgetHours), billable: b.billable === undefined ? t.billable : Boolean(b.billable) });
    return t;
  }));
  api.delete('/projects/:id/tasks/:taskId', m((req) => {
    const db = getDb();
    const prj = getProject(db, p(req, 'id'));
    const t = prj.tasks.find((k) => k.id === p(req, 'taskId'));
    if (!t) throw notFound('Task');
    if (db.timeEntries.some((e) => e.taskId === t.id)) throw bad(`Task "${t.name}" has time logged and cannot be deleted`);
    prj.tasks = prj.tasks.filter((k) => k.id !== t.id);
    logActivity(db, 'project', prj.id, prj.customerId, `Task ${t.name} deleted`, undefined, currentUser(db).name);
  }));
  api.post('/projects/:id/users', m((req) => {
    const db = getDb();
    const prj = getProject(db, p(req, 'id'));
    const b = req.body as { userId?: string; name?: string; email?: string; role?: User['role']; ratePerHour?: number; budgetHours?: number };
    let userId = str(b.userId);
    if (!userId) {
      const name = str(b.name);
      if (!name) throw bad('Select a user or enter a name');
      const email = str(b.email);
      const found = email ? db.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) : undefined;
      if (found) userId = found.id;
      else {
        const u: User = { id: newId('usr'), name, email, role: b.role === 'Admin' || b.role === 'Timesheet Staff' ? b.role : 'Staff', status: 'active', createdAt: now() };
        db.users.push(u);
        userId = u.id;
      }
    }
    if (prj.users.some((u) => u.userId === userId)) throw bad('This user is already on the project');
    ensureProjectUser(db, prj, userId);
    const pu = prj.users.find((u) => u.userId === userId)!;
    pu.ratePerHour = num(b.ratePerHour);
    pu.budgetHours = num(b.budgetHours);
    return pu;
  }));
  api.put('/projects/:id/users/:userId', m((req) => {
    const prj = getProject(getDb(), p(req, 'id'));
    const pu = prj.users.find((u) => u.userId === p(req, 'userId'));
    if (!pu) throw notFound('User');
    const b = req.body as { ratePerHour?: number; budgetHours?: number };
    if (b.ratePerHour !== undefined) pu.ratePerHour = num(b.ratePerHour);
    if (b.budgetHours !== undefined) pu.budgetHours = num(b.budgetHours);
    return pu;
  }));
  api.delete('/projects/:id/users/:userId', m((req) => {
    const db = getDb();
    const prj = getProject(db, p(req, 'id'));
    const uid = p(req, 'userId');
    if (db.timeEntries.some((e) => e.projectId === prj.id && e.userId === uid)) throw bad('This user has time logged on the project and cannot be removed');
    if (prj.users.length <= 1) throw bad('A project needs at least one user');
    prj.users = prj.users.filter((u) => u.userId !== uid);
    logActivity(db, 'project', prj.id, prj.customerId, `User ${db.users.find((u) => u.id === uid)?.name} removed`, undefined, currentUser(db).name);
  }));
  api.post('/projects/:id/attachments', m((req) => {
    const db = getDb();
    const prj = getProject(db, p(req, 'id'));
    const files = ((req.body as { attachments?: Attachment[] }).attachments ?? []).filter((a) => a?.id && a.url);
    if (prj.attachments.length + files.length > 10) throw bad('You can attach a maximum of 10 files');
    prj.attachments.push(...files);
    for (const f of files) logActivity(db, 'project', prj.id, prj.customerId, `Attachment ${f.name} added`, undefined, currentUser(db).name);
    return prj.attachments;
  }));
  api.delete('/projects/:id/attachments/:aid', m((req) => {
    const prj = getProject(getDb(), p(req, 'id'));
    prj.attachments = prj.attachments.filter((a) => a.id !== p(req, 'aid'));
    return prj.attachments;
  }));

  /** Daily or monthly logged hours for the Overview chart. */
  api.get('/projects/:id/hours', h((req) => {
    const db = getDb();
    const prj = getProject(db, p(req, 'id'));
    const r = timePeriodRange(q(req, 'period') || 'this_week', today(), db.organization.fiscalYearStartMonth);
    const entries = db.timeEntries.filter((t) => t.projectId === prj.id && t.date >= r.from && t.date <= r.to);
    const days = (Date.parse(r.to) - Date.parse(r.from)) / 86400000 + 1;
    const buckets: { key: string; from: string; to: string }[] = [];
    if (days <= 31) {
      for (let d = r.from; d <= r.to; d = new Date(Date.parse(d) + 86400000).toISOString().slice(0, 10)) buckets.push({ key: d, from: d, to: d });
    } else {
      const [y, mth] = r.from.split('-').map(Number);
      for (let i = 0; ; i++) {
        const a = new Date(Date.UTC(y, mth - 1 + i, 1)).toISOString().slice(0, 10);
        if (a > r.to) break;
        const b = new Date(Date.UTC(y, mth + i, 0)).toISOString().slice(0, 10);
        buckets.push({ key: a.slice(0, 7), from: a, to: b });
      }
    }
    const inB = (k: { from: string; to: string }, f: (t: TimeEntry) => boolean) => sum(entries.filter((t) => t.date >= k.from && t.date <= k.to && f(t)).map((t) => t.hours));
    return {
      from: r.from,
      to: r.to,
      unit: days <= 31 ? 'day' : 'month',
      buckets: buckets.map((k) => ({ key: k.key, billable: inB(k, (t) => t.billable), nonBillable: inB(k, (t) => !t.billable) })),
      loggedHours: sum(entries.map((t) => t.hours)),
      billableHours: sum(entries.filter((t) => t.billable).map((t) => t.hours)),
      amount: sum(entries.filter((t) => t.billable).map((t) => t.hours * entryRate(prj, t))),
    };
  }));

  /** Everything linked to the project, for the Purchases, Sales and Journals tabs. */
  api.get('/projects/:id/transactions', h((req) => {
    const db = getDb();
    const prj = getProject(db, p(req, 'id'));
    const docs = (kind: DocKind) =>
      db.docs
        .filter((d) => d.kind === kind && docProjectId(db, d) === prj.id)
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((d) => ({ id: d.id, kind: d.kind, number: d.number, referenceNumber: d.referenceNumber ?? d.orderNumber, date: d.date, dueDate: d.dueDate, deliveryDate: d.deliveryDate, expectedShipmentDate: d.expectedShipmentDate, contactName: S.contactName(db, d.contactId), status: d.status, total: d.total, balance: d.balance, projectFee: projectFee(d) }));
    const expenses = db.expenses
      .filter((e) => e.projectId === prj.id)
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((e) => ({ id: e.id, date: e.date, accountName: e.isMileage ? 'Mileage' : db.accounts.find((a) => a.id === e.accountId)?.name, referenceNumber: e.invoiceNumber, vendorName: S.contactName(db, e.vendorId), paidThroughName: db.accounts.find((a) => a.id === e.paidThroughAccountId)?.name, customerName: S.contactName(db, e.customerId), amount: e.amount, status: e.status }));
    const journals = db.journals
      .filter((j) => j.sourceType === 'manual' && j.projectId === prj.id)
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((j) => ({ id: j.id, number: j.number, date: j.date, reference: j.reference, notes: j.notes, amount: sum(j.lines.map((l) => l.debit)) }));
    return {
      expenses,
      bills: docs('bill'),
      purchaseOrders: docs('purchase_order'),
      vendorCredits: docs('vendor_credit'),
      invoices: docs('invoice'),
      quotes: docs('quote'),
      salesOrders: docs('sales_order'),
      creditNotes: docs('credit_note'),
      journals,
    };
  }));

  /** What "Invoice project" would bill (preview for the dialog). */
  api.get('/projects/:id/unbilled', h((req) => {
    const db = getDb();
    const prj = getProject(db, p(req, 'id'));
    const { entries, expenses } = unbilled(db, prj, { from: q(req, 'from'), to: q(req, 'to') });
    return {
      billingMethod: prj.billingMethod,
      projectCost: prj.rate,
      ...stats(db, prj),
      entries: entries.map((t) => entryRow(db, t)).sort((a, b) => a.date.localeCompare(b.date)),
      expenses: expenses.map((e) => ({ id: e.id, date: e.date, accountName: e.isMileage ? 'Mileage' : db.accounts.find((a) => a.id === e.accountId)?.name, notes: e.notes, amount: e.amount })),
    };
  }));
  api.post('/projects/:id/invoice', m((req) => invoiceProject(getDb(), p(req, 'id'), req.body as InvoiceRequest)));

  // ---------------------------------------------------------------- time entries
  api.get('/time-entries', h((req) => filterEntries(getDb(), req)));
  api.get('/time-entries/summary', h((req) => {
    const db = getDb();
    const rows = filterEntries(db, req);
    const by = (k: (t: (typeof rows)[number]) => string | undefined) => {
      const mp = new Map<string, { name: string; hours: number; billable: number; amount: number }>();
      for (const t of rows) {
        const name = k(t) || '—';
        const x = mp.get(name) ?? { name, hours: 0, billable: 0, amount: 0 };
        x.hours += t.hours;
        if (t.billable) x.billable += t.hours;
        x.amount += t.amount;
        mp.set(name, x);
      }
      return [...mp.values()].map((x) => ({ ...x, hours: round2(x.hours), billable: round2(x.billable), amount: round2(x.amount) })).sort((a, b) => b.hours - a.hours);
    };
    const hrs = (f: (t: (typeof rows)[number]) => boolean) => sum(rows.filter(f).map((t) => t.hours));
    return {
      count: rows.length,
      loggedHours: hrs(() => true),
      billableHours: hrs((t) => t.billable),
      nonBillableHours: hrs((t) => !t.billable),
      unbilledHours: hrs((t) => t.billingStatus === 'unbilled'),
      invoicedHours: hrs((t) => t.billingStatus === 'invoiced'),
      unbilledAmount: sum(rows.filter((t) => t.billingStatus === 'unbilled').map((t) => t.amount)),
      byProject: by((t) => t.projectName),
      byUser: by((t) => t.userName),
      byCustomer: by((t) => t.customerName),
    };
  }));
  api.get('/time-entries/:id', h((req) => {
    const db = getDb();
    const t = db.timeEntries.find((x) => x.id === p(req, 'id'));
    if (!t) throw notFound('Time entry');
    return entryRow(db, t);
  }));
  api.post('/time-entries', m((req) => {
    const db = getDb();
    const t = buildEntry(db, req.body);
    db.timeEntries.push(t);
    const prj = getProject(db, t.projectId);
    logActivity(db, 'project', prj.id, prj.customerId, 'Time logged', `${entryRow(db, t).userName}: ${Math.floor(t.hours)}h ${Math.round((t.hours % 1) * 60)}m on ${t.date.split('-').reverse().join('/')}`, currentUser(db).name);
    return entryRow(db, t);
  }));
  api.put('/time-entries/:id', m((req) => {
    const db = getDb();
    const t = db.timeEntries.find((x) => x.id === p(req, 'id'));
    if (!t) throw notFound('Time entry');
    if (t.invoiced) {
      // invoiced time is locked; only the notes can change
      t.notes = str((req.body as { notes?: string }).notes) ?? t.notes;
      return entryRow(db, t);
    }
    Object.assign(t, buildEntry(db, req.body, t));
    return entryRow(db, t);
  }));
  api.delete('/time-entries/:id', m((req) => {
    const db = getDb();
    const t = db.timeEntries.find((x) => x.id === p(req, 'id'));
    if (!t) throw notFound('Time entry');
    if (t.invoiced) throw bad('Invoiced time cannot be deleted. Delete the invoice first.');
    db.timeEntries = db.timeEntries.filter((x) => x.id !== t.id);
    db.timers = db.timers.filter((x) => x.entryId !== t.id);
  }));
  api.post('/time-entries/:id/clone', m((req) => {
    const db = getDb();
    const t = db.timeEntries.find((x) => x.id === p(req, 'id'));
    if (!t) throw notFound('Time entry');
    const c: TimeEntry = { ...t, id: newId('te'), date: str((req.body as { date?: string }).date) ?? today(), invoiced: false, invoiceId: undefined, billable: t.billable, createdAt: now(), updatedAt: undefined };
    db.timeEntries.push(c);
    return entryRow(db, c);
  }));
  api.post('/time-entries/bulk', m((req) => {
    const db = getDb();
    const { action, ids } = req.body as { action: string; ids: string[] };
    if (!Array.isArray(ids) || !ids.length) throw bad('Select at least one entry');
    const list = db.timeEntries.filter((t) => ids.includes(t.id));
    if (list.some((t) => t.invoiced)) throw bad('Some of the selected entries are invoiced. Invoiced time cannot be changed.');
    if (action === 'delete') db.timeEntries = db.timeEntries.filter((t) => !ids.includes(t.id));
    else if (action === 'billable' || action === 'non_billable') for (const t of list) t.billable = action === 'billable';
    else throw bad('Unknown action');
    return { done: list.length };
  }));
  /** Weekly log: one row per project+task with seven daily times. */
  api.post('/time-entries/weekly', m((req) => {
    const db = getDb();
    const b = req.body as { weekStart: string; userId?: string; rows: { projectId: string; taskId?: string; taskName?: string; billable?: boolean; hours: (string | number)[] }[] };
    if (!b.weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(b.weekStart)) throw bad('Select a week');
    const rows = (b.rows ?? []).filter((r) => r.projectId);
    if (!rows.length) throw bad('Add at least one project');
    const made: TimeEntry[] = [];
    rows.forEach((r) => {
      (r.hours ?? []).slice(0, 7).forEach((h, i) => {
        if (h === '' || h == null || Number(parseHours(h)) === 0) return;
        const date = new Date(Date.parse(b.weekStart) + i * 86400000).toISOString().slice(0, 10);
        made.push(buildEntry(db, { projectId: r.projectId, taskId: r.taskId, taskName: r.taskName, userId: b.userId, billable: r.billable, hours: h, date }));
      });
    });
    if (!made.length) throw bad('Enter time for at least one day');
    db.timeEntries.push(...made);
    return { created: made.length, hours: sum(made.map((t) => t.hours)) };
  }));

  // ---------------------------------------------------------------- timer
  api.get('/timer', h(() => ({ timer: timerView(getDb(), myTimer(getDb())) })));
  api.post('/timer/start', m((req) => {
    const db = getDb();
    const b = req.body as Partial<RunningTimer>;
    if (myTimer(db)) throw bad('A timer is already running. Stop it before starting another.');
    let { projectId, taskId } = b;
    let billable = b.billable !== false;
    let notes = str(b.notes);
    const entryId = str(b.entryId);
    if (entryId) {
      const e = db.timeEntries.find((x) => x.id === entryId);
      if (!e) throw notFound('Time entry');
      if (e.invoiced) throw bad('This entry is invoiced. Start a new timer instead.');
      projectId = e.projectId;
      taskId = e.taskId;
      billable = e.billable;
      notes = e.notes;
    }
    if (projectId) {
      const prj = getProject(db, projectId);
      if (prj.status === 'inactive') throw bad('This project is inactive');
      if (taskId && !prj.tasks.some((k) => k.id === taskId)) throw bad('Select a task from this project');
    }
    const t: RunningTimer = { id: newId('tmr'), userId: currentUser(db).id, projectId: projectId || undefined, taskId: taskId || undefined, notes, billable, entryId, startedAt: now(), accumulatedMs: 0, running: true, createdAt: now() };
    db.timers.push(t);
    return timerView(db, t);
  }));
  api.put('/timer', m((req) => {
    const db = getDb();
    const t = myTimer(db);
    if (!t) throw bad('No timer is running');
    const b = req.body as Partial<RunningTimer>;
    if (!t.entryId) {
      if (b.projectId !== undefined) t.projectId = str(b.projectId);
      if (b.taskId !== undefined) t.taskId = str(b.taskId);
      if (b.billable !== undefined) t.billable = Boolean(b.billable);
    }
    if (b.notes !== undefined) t.notes = str(b.notes);
    return timerView(db, t);
  }));
  api.post('/timer/pause', m(() => {
    const db = getDb();
    const t = myTimer(db);
    if (!t) throw bad('No timer is running');
    if (t.running) {
      t.accumulatedMs = elapsedMs(t);
      t.running = false;
      t.startedAt = undefined;
    }
    return timerView(db, t);
  }));
  api.post('/timer/resume', m(() => {
    const db = getDb();
    const t = myTimer(db);
    if (!t) throw bad('No timer is running');
    if (!t.running) {
      t.running = true;
      t.startedAt = now();
    }
    return timerView(db, t);
  }));
  api.post('/timer/stop', m((req) => {
    const db = getDb();
    const t = myTimer(db);
    if (!t) throw bad('No timer is running');
    const b = req.body as Partial<RunningTimer> & { taskName?: string };
    const hours = Math.max(1, Math.round(elapsedMs(t) / 60000)) / 60;
    let entry: TimeEntry;
    if (t.entryId && db.timeEntries.some((e) => e.id === t.entryId)) {
      entry = db.timeEntries.find((e) => e.id === t.entryId)!;
      if (entry.invoiced) throw bad('This entry was invoiced while the timer ran. Discard the timer instead.');
      entry.hours = Math.round((entry.hours + hours) * 60) / 60;
      entry.startTime = entry.endTime = undefined;
      if (b.notes !== undefined) entry.notes = str(b.notes);
      entry.updatedAt = now();
    } else {
      const projectId = str(b.projectId) ?? t.projectId;
      if (!projectId) throw bad('Select a project to save the time');
      entry = buildEntry(db, { projectId, taskId: str(b.taskId) ?? t.taskId, taskName: b.taskName, notes: b.notes ?? t.notes, billable: b.billable ?? t.billable, hours, date: today(), userId: t.userId });
      db.timeEntries.push(entry);
    }
    db.timers = db.timers.filter((x) => x.id !== t.id);
    const prj = getProject(db, entry.projectId);
    logActivity(db, 'project', prj.id, prj.customerId, 'Time logged from the timer', `${Math.round(hours * 60)} minutes`, currentUser(db).name);
    return entryRow(db, entry);
  }));
  api.delete('/timer', m(() => {
    const db = getDb();
    const t = myTimer(db);
    db.timers = db.timers.filter((x) => x.id !== t?.id);
  }));

  // ---------------------------------------------------------------- budgets
  api.get('/budgets', h((req) => {
    const db = getDb();
    return db.budgets.filter((b) => !q(req, 'projectId') || b.projectId === q(req, 'projectId')).map((b) => budgetView(db, b));
  }));
  api.get('/budgets/:id', h((req) => {
    const db = getDb();
    const b = db.budgets.find((x) => x.id === p(req, 'id'));
    if (!b) throw notFound('Budget');
    return budgetView(db, b);
  }));
  api.post('/budgets', m((req) => saveBudget(getDb(), req.body)));
  api.put('/budgets/:id', m((req) => {
    const db = getDb();
    const b = db.budgets.find((x) => x.id === p(req, 'id'));
    if (!b) throw notFound('Budget');
    return saveBudget(db, req.body, b);
  }));
  api.delete('/budgets/:id', m((req) => {
    const db = getDb();
    db.budgets = db.budgets.filter((x) => x.id !== p(req, 'id'));
  }));
}
