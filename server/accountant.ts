// Accountant module: chart of accounts, manual journals (drafts, templates, reversals, locking),
// recurring journals, bulk account update, base currency adjustments and transaction locking.
import type { NextFunction, Request, Response, Router } from 'express';
import { ACCOUNT_IDS as A, DOC_META } from '../shared/docmeta';
import { ACCOUNT_TYPES, LOCK_MODULES, isBankingAccount, typeOfSubType } from '../shared/accountant';
import { fmtDate, nextRecurrence, periodRange, round2, today, type PeriodKey } from '../shared/format';
import type { Account, Attachment, Database, DocKind, Journal, JournalLine, JournalTemplate, LockModule, RecurringJournal, ReportingMethod, TxnDoc } from '../shared/types';
import { getDb, newId, now } from './db';
import { logActivity, runRecurring } from './engine';
import { accountBalance } from './reports';
import { currentUser } from './projects';
import * as S from './services';

type Wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => Promise<void>;

const bad = (msg: string) => new S.HttpError(400, msg);
const notFound = (what: string) => new S.HttpError(404, `${what} not found`);
const str = (v: unknown) => (v == null ? undefined : String(v).trim() || undefined);
const num = (v: unknown) => (v === '' || v == null || Number.isNaN(Number(v)) ? 0 : Number(v));
const q = (req: Request, k: string) => (typeof req.query[k] === 'string' ? (req.query[k] as string) : undefined);
const p = (req: Request, k: string) => String(req.params[k]);
const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));
const METHODS: ReportingMethod[] = ['accrual_and_cash', 'accrual_only', 'cash_only'];

// ================================================================== transaction locking

export function lockedThrough(db: Database, module: LockModule): string | undefined {
  const l = db.transactionLocks;
  const dates = [l?.all?.date, l?.modules?.[module]?.date].filter(Boolean) as string[];
  return dates.sort().pop();
}

export function assertUnlocked(db: Database, module: LockModule, ...dates: (string | undefined)[]) {
  const through = lockedThrough(db, module);
  if (!through) return;
  if (dates.some((d) => d && d <= through)) {
    const label = LOCK_MODULES.find((m) => m.value === module)!.label;
    throw bad(`${label} transactions dated on or before ${fmtDate(through)} are locked. Unlock ${label} in Accountant > Period Close to make changes.`);
  }
}

const SALES_KINDS = new Set(['quote', 'sales_order', 'invoice', 'retainer_invoice', 'delivery_challan', 'credit_note']);
const PURCHASE_KINDS = new Set(['purchase_order', 'bill', 'vendor_credit']);

/** Which lock module and dates a mutating API call touches. */
function lockTarget(db: Database, req: Request): { module: LockModule; dates: (string | undefined)[] } | undefined {
  const [, res, id] = req.path.split('/');
  const body = (req.body || {}) as Record<string, unknown>;
  const bdate = typeof body.date === 'string' ? body.date : undefined;
  if (res === 'docs') {
    if (id === 'bulk') return undefined;
    const d = id ? db.docs.find((x) => x.id === id) : undefined;
    const kind = String(d?.kind ?? body.kind ?? '');
    const module: LockModule | undefined = SALES_KINDS.has(kind) ? 'sales' : PURCHASE_KINDS.has(kind) ? 'purchases' : undefined;
    // refunds, credit applications and payments recorded against a document carry their own date
    return module ? { module, dates: [d?.date, bdate] } : undefined;
  }
  if (res === 'payments-received') return { module: 'sales', dates: [db.paymentsReceived.find((x) => x.id === id)?.date, bdate] };
  if (res === 'payments-made') {
    if (id === 'bulk') return { module: 'purchases', dates: ((body.payments as { date?: string }[]) || []).map((x) => x.date) };
    return { module: 'purchases', dates: [db.paymentsMade.find((x) => x.id === id)?.date, bdate] };
  }
  if (res === 'expenses') {
    if (id === 'bulk') return { module: 'purchases', dates: ((body.expenses as { date?: string }[]) || []).map((x) => x.date) };
    if (id === 'bulk-delete') return { module: 'purchases', dates: ((body.ids as string[]) || []).map((x) => db.expenses.find((e) => e.id === x)?.date) };
    return { module: 'purchases', dates: [db.expenses.find((x) => x.id === id)?.date, bdate] };
  }
  if (res === 'journals' || res === 'manual-journals') {
    if (id === 'bulk-delete') return { module: 'accountant', dates: ((body.ids as string[]) || []).map((x) => db.manualJournals.find((j) => j.id === x)?.date) };
    return { module: 'accountant', dates: [db.manualJournals.find((x) => x.id === id)?.date, bdate] };
  }
  if (res === 'currency-adjustments') return { module: 'accountant', dates: [db.currencyAdjustments.find((x) => x.id === id)?.date, bdate] };
  if (res === 'banking') {
    const t = req.path.split('/');
    if (t[2] === 'transactions') return { module: 'banking', dates: [db.bankTransactions.find((x) => x.id === t[3])?.date, bdate] };
    if (t[2] === 'statement-lines' && t[3]) return { module: 'banking', dates: [db.statementLines.find((x) => x.id === t[3])?.date, bdate] };
  }
  return undefined;
}

/** Express middleware: refuse changes to transactions inside a locked period. */
export function lockGuard(req: Request, _res: Response, next: NextFunction) {
  if (req.method === 'GET') return next();
  try {
    const db = getDb();
    const t = lockTarget(db, req);
    if (t) assertUnlocked(db, t.module, ...t.dates);
    next();
  } catch (e) {
    next(e);
  }
}

// ================================================================== chart of accounts

function saveAccount(db: Database, b: Partial<Account>, existing?: Account): Account {
  const name = str(b.name) ?? existing?.name;
  if (!name) throw bad('Account Name is required');
  const subType = (b.subType ?? existing?.subType) as Account['subType'] | undefined;
  const type = subType ? typeOfSubType(subType) : undefined;
  if (!subType || !type) throw bad('Account Type is required');
  if (existing && existing.system && subType !== existing.subType) throw bad('The type of a system account cannot be changed');
  if (db.accounts.some((a) => a.id !== existing?.id && a.name.toLowerCase() === name.toLowerCase())) throw bad('An account with this name already exists');
  const code = str(b.code) ?? (b.code === '' ? '' : existing?.code ?? '');
  if (code && db.accounts.some((a) => a.id !== existing?.id && a.code === code)) throw bad(`Account code ${code} is already used`);
  const parentId = b.parentId === '' ? undefined : str(b.parentId) ?? (b.parentId === undefined ? existing?.parentId : undefined);
  if (parentId) {
    const parent = db.accounts.find((a) => a.id === parentId);
    if (!parent) throw bad('Parent account not found');
    if (parent.type !== type) throw bad('The parent account must be of the same account type');
    if (existing && (parentId === existing.id || ancestors(db, parentId).includes(existing.id))) throw bad('An account cannot be its own parent');
  }
  const out: Account = {
    ...(existing ?? { id: newId('acc'), active: true }),
    name,
    code: code || '',
    type,
    subType,
    description: b.description !== undefined ? str(b.description) : existing?.description,
    parentId,
    watchlist: b.watchlist !== undefined ? Boolean(b.watchlist) : existing?.watchlist,
    accountNumber: b.accountNumber !== undefined ? str(b.accountNumber) : existing?.accountNumber,
    bankName: b.bankName !== undefined ? str(b.bankName) : existing?.bankName,
    ifsc: b.ifsc !== undefined ? str(b.ifsc)?.toUpperCase() : existing?.ifsc,
    currencyCode: str(b.currencyCode) ?? existing?.currencyCode ?? (isBankingAccount({ subType }) ? 'INR' : undefined),
    primary: b.primary !== undefined ? Boolean(b.primary) : existing?.primary,
    attachments: (b.attachments as Attachment[] | undefined) ?? existing?.attachments,
    active: b.active !== undefined ? Boolean(b.active) : existing?.active ?? true,
  } as Account;
  if (out.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(out.ifsc)) throw bad('Enter a valid IFSC (for example HDFC0001234)');
  if (out.primary) for (const a of db.accounts) if (a.id !== out.id && isBankingAccount(a)) a.primary = false;
  if (existing) Object.assign(existing, out);
  else db.accounts.push(out);
  return existing ?? out;
}

function ancestors(db: Database, id: string): string[] {
  const out: string[] = [];
  let cur = db.accounts.find((a) => a.id === id);
  while (cur?.parentId && !out.includes(cur.parentId)) {
    out.push(cur.parentId);
    cur = db.accounts.find((a) => a.id === cur!.parentId);
  }
  return out;
}

function accountInUse(db: Database, id: string) {
  return (
    db.journals.some((j) => j.lines.some((l) => l.accountId === id)) ||
    db.manualJournals.some((j) => j.lines.some((l) => l.accountId === id)) ||
    db.items.some((i) => i.salesAccountId === id || i.purchaseAccountId === id) ||
    db.statementLines.some((l) => l.accountId === id) ||
    db.accounts.some((a) => a.parentId === id)
  );
}

function deleteAccount(db: Database, id: string) {
  const a = db.accounts.find((x) => x.id === id);
  if (!a) throw notFound('Account');
  if (a.system) throw bad(`${a.name} is a system account and cannot be deleted`);
  if (accountInUse(db, id)) throw bad(`${a.name} has transactions, items or sub-accounts and cannot be deleted. Mark it inactive instead.`);
  db.accounts = db.accounts.filter((x) => x.id !== id);
}

const SOURCE_LABEL: Record<string, string> = {
  invoice: 'Invoice',
  credit_note: 'Credit Note',
  payment_received: 'Client Payment',
  payment_refund: 'Refund',
  credit_note_refund: 'Credit Note Refund',
  write_off: 'Write Off',
  bill: 'Bill',
  vendor_credit: 'Debit Notes',
  payment_made: 'Supplier Payment',
  expense: 'Expense',
  opening_balance: 'Opening Balance',
  bank_transaction: 'Bank Transaction',
  manual: 'Journal',
};
export const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? s;

function accountDetail(db: Database, a: Account) {
  const entries = db.journals
    .flatMap((j) => j.lines.filter((l) => l.accountId === a.id).map((l) => ({ j, l })))
    .sort((x, y) => y.j.date.localeCompare(x.j.date))
    .slice(0, 10)
    .map(({ j, l }) => ({ date: j.date, journalId: j.id, sourceType: j.sourceType, sourceId: j.sourceId, type: sourceLabel(j.sourceType), details: S.contactName(db, l.contactId || j.contactId) || j.reference || j.notes || '', debit: l.debit, credit: l.credit }));
  const dr = sum(db.journals.flatMap((j) => j.lines.filter((l) => l.accountId === a.id).map((l) => l.debit - l.credit)));
  return { ...a, balance: accountBalance(db, a.id), closingBalance: Math.abs(dr), side: dr >= 0 ? 'Dr' : 'Cr', parentName: db.accounts.find((x) => x.id === a.parentId)?.name, recent: entries, inUse: accountInUse(db, a.id) };
}

// ================================================================== manual journals

function cleanLines(db: Database, raw: Partial<JournalLine>[] | undefined): JournalLine[] {
  const lines = (raw || [])
    .filter((l) => l.accountId && (num(l.debit) || num(l.credit)))
    .map((l) => ({ accountId: String(l.accountId), debit: round2(num(l.debit)), credit: round2(num(l.credit)), description: str(l.description), contactId: str(l.contactId) }));
  for (const l of lines) {
    if (!db.accounts.some((a) => a.id === l.accountId)) throw bad('Select a valid account on every line');
    if (l.debit && l.credit) throw bad('A line can have either a debit or a credit, not both');
    if (l.debit < 0 || l.credit < 0) throw bad('Amounts cannot be negative');
    if (l.contactId && !db.contacts.some((c) => c.id === l.contactId)) throw bad('Contact not found');
  }
  if (lines.length < 2) throw bad('A journal needs at least two lines with an account and an amount');
  const dr = sum(lines.map((l) => l.debit));
  const cr = sum(lines.map((l) => l.credit));
  if (Math.abs(dr - cr) > 0.004) throw bad(`Debits (${dr.toFixed(2)}) and credits (${cr.toFixed(2)}) must be equal`);
  return lines;
}

function nextJournalNumber(db: Database, take = false) {
  const n = (db.counters.manual_journal || 0) + 1;
  if (take) db.counters.manual_journal = n;
  return `MJ-${String(n).padStart(5, '0')}`;
}

export function saveManualJournal(db: Database, b: Partial<Journal>, existing?: Journal): Journal {
  if (existing?.locked) throw bad('This journal is locked. Unlock it to make changes.');
  const date = str(b.date) ?? existing?.date ?? today();
  const notes = str(b.notes) ?? (b.notes === undefined ? existing?.notes : undefined);
  const status = b.status ?? existing?.status ?? 'published';
  if (!['draft', 'published'].includes(status)) throw bad('Unknown status');
  if (status === 'published' && !notes) throw bad('Notes are required');
  if (notes && notes.length > 500) throw bad('Notes can be at most 500 characters');
  const reportingMethod = (b.reportingMethod ?? existing?.reportingMethod ?? 'accrual_and_cash') as ReportingMethod;
  if (!METHODS.includes(reportingMethod)) throw bad('Unknown reporting method');
  const reverseDate = b.reverseDate === '' ? undefined : str(b.reverseDate) ?? (b.reverseDate === undefined ? existing?.reverseDate : undefined);
  if (reverseDate && reverseDate <= date) throw bad('The reverse journal date must be after the journal date');
  const lines = cleanLines(db, b.lines ?? existing?.lines);
  let number = str(b.number) ?? existing?.number;
  if (!number) number = nextJournalNumber(db, true);
  else if (!existing && number === nextJournalNumber(db)) nextJournalNumber(db, true);
  if (db.manualJournals.some((j) => j.id !== existing?.id && j.number === number)) throw bad(`Journal# ${number} already exists`);
  const projectId = b.projectId !== undefined ? (b.projectId && db.projects.some((x) => x.id === b.projectId) ? b.projectId : undefined) : existing?.projectId;
  const out: Journal = {
    id: existing?.id ?? newId('mj'),
    number,
    date,
    sourceType: 'manual',
    reference: b.reference !== undefined ? str(b.reference) : existing?.reference,
    notes,
    projectId,
    lines,
    status,
    reportingMethod,
    reverseDate,
    reversalOf: existing?.reversalOf ?? (str(b.reversalOf) || undefined),
    attachments: (b.attachments as Attachment[] | undefined) ?? existing?.attachments ?? [],
    locked: existing?.locked ?? false,
    createdBy: existing?.createdBy ?? currentUser(db)?.name ?? db.organization.name,
    recurringProfileId: existing?.recurringProfileId,
    createdAt: existing?.createdAt ?? now(),
    updatedAt: existing ? now() : undefined,
  };
  if (existing) Object.assign(existing, out);
  else db.manualJournals.push(out);
  const j = existing ?? out;
  logActivity(db, 'journal', j.id, undefined, existing ? `Journal ${j.number} updated` : `Journal ${j.number} created${status === 'draft' ? ' as draft' : ''}`);
  // "Reverse Journal Date": a reversing journal is published on that date
  if (reverseDate && status === 'published' && !db.manualJournals.some((x) => x.reversalOf === j.id)) createReverse(db, j, reverseDate);
  return j;
}

function reversedLines(lines: JournalLine[]) {
  return lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
}

function createReverse(db: Database, j: Journal, date: string): Journal {
  const r: Journal = {
    id: newId('mj'),
    number: nextJournalNumber(db, true),
    date,
    sourceType: 'manual',
    reference: j.reference,
    notes: `Reversal of journal ${j.number}${j.notes ? `: ${j.notes}` : ''}`.slice(0, 500),
    lines: reversedLines(j.lines),
    status: 'published',
    reportingMethod: j.reportingMethod,
    reversalOf: j.id,
    projectId: j.projectId,
    attachments: [],
    locked: false,
    createdBy: currentUser(db)?.name ?? db.organization.name,
    createdAt: now(),
  };
  db.manualJournals.push(r);
  logActivity(db, 'journal', j.id, undefined, `Reverse journal ${r.number} created for ${fmtDate(date)}`);
  logActivity(db, 'journal', r.id, undefined, `Created as the reversal of journal ${j.number}`);
  return r;
}

function getManual(db: Database, id: string) {
  const j = db.manualJournals.find((x) => x.id === id);
  if (!j) throw notFound('Journal');
  return j;
}

function journalRow(db: Database, j: Journal) {
  return { ...j, amount: sum(j.lines.map((l) => l.debit)), contactNames: [...new Set(j.lines.map((l) => S.contactName(db, l.contactId)).filter(Boolean))] };
}

function journalDetail(db: Database, j: Journal) {
  return {
    ...journalRow(db, j),
    lines: j.lines.map((l) => ({ ...l, accountName: db.accounts.find((a) => a.id === l.accountId)?.name ?? l.accountId, contactName: S.contactName(db, l.contactId) })),
    projectName: db.projects.find((x) => x.id === j.projectId)?.name,
    reversal: db.manualJournals.filter((x) => x.reversalOf === j.id).map((x) => ({ id: x.id, number: x.number, date: x.date })),
    reversalOfJournal: j.reversalOf ? (({ id, number }) => ({ id, number }))(db.manualJournals.find((x) => x.id === j.reversalOf) ?? { id: j.reversalOf, number: '' }) : undefined,
    activities: db.activities.filter((a) => a.entityId === j.id).slice().reverse(),
  };
}

function journalAction(db: Database, id: string, action: string, body: Record<string, unknown>) {
  const j = getManual(db, id);
  switch (action) {
    case 'publish':
      if (j.status === 'published') throw bad('This journal is already published');
      if (!j.notes) throw bad('Add notes before publishing this journal');
      j.status = 'published';
      logActivity(db, 'journal', j.id, undefined, `Journal ${j.number} published`);
      if (j.reverseDate && !db.manualJournals.some((x) => x.reversalOf === j.id)) createReverse(db, j, j.reverseDate);
      return j;
    case 'lock':
      j.locked = true;
      logActivity(db, 'journal', j.id, undefined, `Journal ${j.number} locked`);
      return j;
    case 'unlock':
      j.locked = false;
      logActivity(db, 'journal', j.id, undefined, `Journal ${j.number} unlocked`);
      return j;
    case 'reverse': {
      const date = str(body.date) ?? today();
      if (date < j.date) throw bad('The reverse journal date cannot be before the journal date');
      assertUnlocked(db, 'accountant', date);
      return createReverse(db, j, date);
    }
    case 'save-as-template': {
      const name = str(body.name) ?? `${j.number} template`;
      return saveTemplate(db, { name, reference: j.reference, notes: j.notes, reportingMethod: j.reportingMethod, enterAmount: true, lines: j.lines.map((l) => ({ accountId: l.accountId, description: l.description, contactId: l.contactId, type: l.debit ? 'debit' : 'credit', amount: l.debit || l.credit })) });
    }
    default:
      throw bad(`Unknown action ${action}`);
  }
}

function deleteJournal(db: Database, id: string) {
  const j = getManual(db, id);
  if (j.locked) throw bad(`Journal ${j.number} is locked. Unlock it before deleting.`);
  db.manualJournals = db.manualJournals.filter((x) => x.id !== id);
  for (const r of db.manualJournals) if (r.reversalOf === id) r.reversalOf = undefined;
  for (const l of db.statementLines) if (l.match?.type === 'journal' && l.match.id === id) {
    l.match = undefined;
    l.status = 'uncategorized';
  }
}

// ------------------------------------------------------------ templates

function saveTemplate(db: Database, b: Partial<JournalTemplate>, existing?: JournalTemplate): JournalTemplate {
  const name = str(b.name) ?? existing?.name;
  if (!name) throw bad('Template Name is required');
  if (db.journalTemplates.some((t) => t.id !== existing?.id && t.name.toLowerCase() === name.toLowerCase())) throw bad(`A template named "${name}" already exists`);
  const enterAmount = b.enterAmount ?? existing?.enterAmount ?? false;
  const lines = (b.lines ?? existing?.lines ?? [])
    .filter((l) => l.accountId)
    .map((l) => ({ accountId: String(l.accountId), description: str(l.description), contactId: str(l.contactId), type: (l.type === 'credit' ? 'credit' : 'debit') as 'debit' | 'credit', amount: enterAmount ? round2(num(l.amount)) : undefined }));
  if (lines.length < 2) throw bad('A template needs at least two accounts');
  for (const l of lines) if (!db.accounts.some((a) => a.id === l.accountId)) throw bad('Select a valid account on every line');
  if (enterAmount) {
    const dr = sum(lines.filter((l) => l.type === 'debit').map((l) => l.amount || 0));
    const cr = sum(lines.filter((l) => l.type === 'credit').map((l) => l.amount || 0));
    if (Math.abs(dr - cr) > 0.004) throw bad('Debit and credit amounts in the template must be equal');
  }
  const out: JournalTemplate = { id: existing?.id ?? newId('jtpl'), name, reference: b.reference !== undefined ? str(b.reference) : existing?.reference, notes: b.notes !== undefined ? str(b.notes) : existing?.notes, reportingMethod: (b.reportingMethod ?? existing?.reportingMethod ?? 'accrual_and_cash') as ReportingMethod, enterAmount, lines, createdAt: existing?.createdAt ?? now() };
  if (existing) Object.assign(existing, out);
  else db.journalTemplates.push(out);
  return existing ?? out;
}

// ------------------------------------------------------------ recurring journals

function saveRecurringJournal(db: Database, b: Partial<RecurringJournal>, existing?: RecurringJournal): RecurringJournal {
  const profileName = str(b.profileName) ?? existing?.profileName;
  if (!profileName) throw bad('Profile Name is required');
  const repeatEvery = b.repeatEvery ?? existing?.repeatEvery ?? { n: 1, unit: 'month' };
  if (!(repeatEvery.n >= 1) || !['day', 'week', 'month', 'year'].includes(repeatEvery.unit)) throw bad('Choose how often the journal repeats');
  const startOn = str(b.startOn) ?? existing?.startOn;
  if (!startOn) throw bad('Start date is required');
  const neverExpires = b.neverExpires ?? existing?.neverExpires ?? true;
  const endsOn = neverExpires ? undefined : str(b.endsOn) ?? existing?.endsOn;
  if (!neverExpires && !endsOn) throw bad('Choose an end date or select Never Expires');
  if (endsOn && endsOn < startOn) throw bad('The end date must be after the start date');
  const notes = str(b.notes) ?? existing?.notes;
  if (!notes) throw bad('Notes are required');
  const lines = cleanLines(db, b.lines ?? existing?.lines);
  const out: RecurringJournal = {
    id: existing?.id ?? newId('rj'),
    profileName,
    repeatEvery: { n: Math.floor(Number(repeatEvery.n)), unit: repeatEvery.unit },
    startOn,
    endsOn,
    neverExpires,
    reference: b.reference !== undefined ? str(b.reference) : existing?.reference,
    notes,
    reportingMethod: (b.reportingMethod ?? existing?.reportingMethod ?? 'accrual_and_cash') as ReportingMethod,
    lines,
    status: existing?.status ?? 'active',
    lastGeneratedDate: existing?.lastGeneratedDate,
    nextDate: existing?.lastGeneratedDate ? nextRecurrence(existing.lastGeneratedDate, repeatEvery) : startOn,
    createdAt: existing?.createdAt ?? now(),
    updatedAt: existing ? now() : undefined,
  };
  if (out.nextDate! < startOn) out.nextDate = startOn;
  if (existing) Object.assign(existing, out);
  else db.recurringJournals.push(out);
  return existing ?? out;
}

// ================================================================== bulk update

const BULK_KINDS: DocKind[] = ['invoice', 'credit_note', 'purchase_order', 'bill', 'vendor_credit'];

interface BulkFilter {
  accountId: string;
  contactId?: string;
  from?: string;
  to?: string;
  minAmount?: number;
  maxAmount?: number;
}

function bulkSearch(db: Database, f: BulkFilter) {
  if (!f.accountId) throw bad('Select an account');
  const inRange = (date: string, total: number, contactId?: string) =>
    (!f.from || date >= f.from) && (!f.to || date <= f.to) && (f.minAmount == null || total >= f.minAmount) && (f.maxAmount == null || total <= f.maxAmount) && (!f.contactId || contactId === f.contactId);
  const rows: { type: string; kind: string; id: string; number: string; date: string; contact?: string; total: number; lines: number; amount: number }[] = [];
  for (const d of db.docs) {
    if (!BULK_KINDS.includes(d.kind) || d.status === 'void') continue;
    const ls = d.lineItems.filter((l) => (l.accountId || defaultAccount(d)) === f.accountId);
    if (!ls.length || !inRange(d.date, d.total, d.contactId)) continue;
    rows.push({ type: DOC_META[d.kind].label, kind: d.kind, id: d.id, number: d.number, date: d.date, contact: S.contactName(db, d.contactId), total: d.total, lines: ls.length, amount: sum(ls.map((l) => l.amount)) });
  }
  for (const e of db.expenses) {
    const lines = e.itemized ? e.lines.filter((l) => l.accountId === f.accountId) : e.accountId === f.accountId ? [{ amount: e.amount }] : [];
    if (!lines.length || !inRange(e.date, e.amount, e.vendorId)) continue;
    rows.push({ type: 'Expense', kind: 'expense', id: e.id, number: e.invoiceNumber || e.date, date: e.date, contact: S.contactName(db, e.vendorId), total: e.amount, lines: lines.length, amount: sum(lines.map((l) => l.amount)) });
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

const defaultAccount = (d: TxnDoc) => (DOC_META[d.kind].side === 'sales' ? A.sales : A.cogs);

function bulkUpdate(db: Database, f: BulkFilter & { newAccountId: string; ids: string[] }) {
  if (!f.newAccountId || !db.accounts.some((a) => a.id === f.newAccountId)) throw bad('Select the new account');
  if (f.newAccountId === f.accountId) throw bad('The new account must be different from the current account');
  const from = db.accounts.find((a) => a.id === f.accountId)!;
  const to = db.accounts.find((a) => a.id === f.newAccountId)!;
  const ids = new Set(f.ids || []);
  if (!ids.size) throw bad('Select at least one transaction');
  let updated = 0;
  for (const d of db.docs) {
    if (!ids.has(d.id)) continue;
    assertUnlocked(db, DOC_META[d.kind].side === 'sales' ? 'sales' : 'purchases', d.date);
    for (const l of d.lineItems) if ((l.accountId || defaultAccount(d)) === f.accountId) l.accountId = f.newAccountId;
    d.updatedAt = now();
    logActivity(db, d.kind, d.id, d.contactId, `Account changed from ${from.name} to ${to.name} (bulk update)`);
    updated++;
  }
  for (const e of db.expenses) {
    if (!ids.has(e.id)) continue;
    assertUnlocked(db, 'purchases', e.date);
    if (e.accountId === f.accountId) e.accountId = f.newAccountId;
    for (const l of e.lines) if (l.accountId === f.accountId) l.accountId = f.newAccountId;
    e.updatedAt = now();
    logActivity(db, 'expense', e.id, e.vendorId, `Account changed from ${from.name} to ${to.name} (bulk update)`);
    updated++;
  }
  return { updated };
}

// ================================================================== routes

export function registerAccountantRoutes(api: Router, h: Wrap, m: Wrap) {
  // ---------------------------------------------------------------- accounts
  api.get('/accounts', h(() => {
    const db = getDb();
    return db.accounts.map((a) => ({ ...a, balance: accountBalance(db, a.id), parentName: db.accounts.find((x) => x.id === a.parentId)?.name, documents: a.attachments?.length || 0 }));
  }));
  api.get('/accounts/types', h(() => ACCOUNT_TYPES));
  api.get('/accounts/:id', h((req) => {
    const db = getDb();
    const a = db.accounts.find((x) => x.id === p(req, 'id'));
    if (!a) throw notFound('Account');
    return accountDetail(db, a);
  }));
  api.post('/accounts', m((req) => saveAccount(getDb(), req.body)));
  api.put('/accounts/:id', m((req) => {
    const db = getDb();
    const a = db.accounts.find((x) => x.id === p(req, 'id'));
    if (!a) throw notFound('Account');
    return saveAccount(db, { ...a, ...req.body, subType: req.body.subType ?? a.subType }, a);
  }));
  api.delete('/accounts/:id', m((req) => deleteAccount(getDb(), p(req, 'id'))));
  api.post('/accounts/bulk', m((req) => {
    const db = getDb();
    const ids = ((req.body?.ids as string[]) || []).map(String);
    const action = String(req.body?.action || '');
    const errors: string[] = [];
    for (const id of ids) {
      const a = db.accounts.find((x) => x.id === id);
      if (!a) continue;
      try {
        if (action === 'activate') a.active = true;
        else if (action === 'deactivate') {
          if (a.system) throw bad(`${a.name} is a system account and cannot be made inactive`);
          a.active = false;
        } else if (action === 'delete') deleteAccount(db, id);
        else throw bad('Unknown action');
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    return { ok: true, errors };
  }));

  // ---------------------------------------------------------------- manual journals
  api.get('/manual-journals', h((req) => {
    const db = getDb();
    const status = q(req, 'status');
    const period = q(req, 'period') as PeriodKey | undefined;
    const r = period && period !== 'all' ? periodRange(period, today(), db.organization.fiscalYearStartMonth) : undefined;
    return db.manualJournals
      .filter((j) => (!status || status === 'all' || j.status === status) && (!r || (j.date >= r.from && j.date <= r.to)))
      .map((j) => journalRow(db, j))
      .sort((a, b) => (a.date === b.date ? b.number.localeCompare(a.number) : b.date.localeCompare(a.date)));
  }));
  api.get('/manual-journals/next-number', h(() => ({ number: nextJournalNumber(getDb()) })));
  api.get('/manual-journals/:id', h((req) => journalDetail(getDb(), getManual(getDb(), p(req, 'id')))));
  api.post('/manual-journals', m((req) => saveManualJournal(getDb(), req.body)));
  api.put('/manual-journals/:id', m((req) => {
    const db = getDb();
    return saveManualJournal(db, req.body, getManual(db, p(req, 'id')));
  }));
  api.delete('/manual-journals/:id', m((req) => deleteJournal(getDb(), p(req, 'id'))));
  api.post('/manual-journals/bulk-delete', m((req) => {
    const db = getDb();
    for (const id of ((req.body?.ids as string[]) || []).map(String)) deleteJournal(db, id);
  }));
  api.post('/manual-journals/:id/actions/:action', m((req) => journalAction(getDb(), p(req, 'id'), p(req, 'action'), req.body || {})));

  // system + manual journals (journal viewer, contact and project tabs)
  api.get('/journals', h((req) => {
    const db = getDb();
    const kind = q(req, 'kind');
    const list = kind === 'manual' ? db.journals.filter((j) => j.sourceType === 'manual') : db.journals;
    return list.slice().reverse();
  }));
  api.get('/journals/:id', h((req) => {
    const db = getDb();
    const j = db.journals.find((x) => x.id === p(req, 'id')) ?? db.manualJournals.find((x) => x.id === p(req, 'id'));
    if (!j) throw notFound('Journal');
    return j;
  }));
  // older clients: POST /journals publishes a manual journal
  api.post('/journals', m((req) => saveManualJournal(getDb(), { ...req.body, status: 'published', notes: req.body?.notes ?? 'Journal entry' })));
  api.delete('/journals/:id', m((req) => deleteJournal(getDb(), p(req, 'id'))));

  // ---------------------------------------------------------------- journal templates
  api.get('/journal-templates', h(() => {
    const db = getDb();
    return db.journalTemplates.map((t) => ({ ...t, amount: t.enterAmount ? sum(t.lines.filter((l) => l.type === 'debit').map((l) => l.amount || 0)) : undefined }));
  }));
  api.get('/journal-templates/:id', h((req) => {
    const t = getDb().journalTemplates.find((x) => x.id === p(req, 'id'));
    if (!t) throw notFound('Template');
    return t;
  }));
  api.post('/journal-templates', m((req) => saveTemplate(getDb(), req.body)));
  api.put('/journal-templates/:id', m((req) => {
    const db = getDb();
    const t = db.journalTemplates.find((x) => x.id === p(req, 'id'));
    if (!t) throw notFound('Template');
    return saveTemplate(db, req.body, t);
  }));
  api.delete('/journal-templates/:id', m((req) => {
    const db = getDb();
    db.journalTemplates = db.journalTemplates.filter((x) => x.id !== p(req, 'id'));
  }));

  // ---------------------------------------------------------------- recurring journals
  api.get('/recurring-journals', h(() => {
    const db = getDb();
    return db.recurringJournals.map((r) => ({ ...r, amount: sum(r.lines.map((l) => l.debit)), children: db.manualJournals.filter((j) => j.recurringProfileId === r.id).length }));
  }));
  api.get('/recurring-journals/:id', h((req) => {
    const db = getDb();
    const r = db.recurringJournals.find((x) => x.id === p(req, 'id'));
    if (!r) throw notFound('Recurring journal');
    return { ...r, amount: sum(r.lines.map((l) => l.debit)), children: db.manualJournals.filter((j) => j.recurringProfileId === r.id).map((j) => journalRow(db, j)), lines: r.lines.map((l) => ({ ...l, accountName: db.accounts.find((a) => a.id === l.accountId)?.name, contactName: S.contactName(db, l.contactId) })) };
  }));
  api.post('/recurring-journals', m((req) => {
    const r = saveRecurringJournal(getDb(), req.body);
    runRecurring(getDb());
    return r;
  }));
  api.put('/recurring-journals/:id', m((req) => {
    const db = getDb();
    const r = db.recurringJournals.find((x) => x.id === p(req, 'id'));
    if (!r) throw notFound('Recurring journal');
    saveRecurringJournal(db, req.body, r);
    runRecurring(db);
    return r;
  }));
  api.delete('/recurring-journals/:id', m((req) => {
    const db = getDb();
    db.recurringJournals = db.recurringJournals.filter((x) => x.id !== p(req, 'id'));
  }));
  api.post('/recurring-journals/:id/actions/:action', m((req) => {
    const db = getDb();
    const r = db.recurringJournals.find((x) => x.id === p(req, 'id'));
    if (!r) throw notFound('Recurring journal');
    const action = p(req, 'action');
    if (action === 'stop') r.status = 'stopped';
    else if (action === 'resume') {
      if (r.status === 'expired') throw bad('This profile has expired. Change its end date to resume it.');
      r.status = 'active';
      if (r.nextDate && r.nextDate < today()) {
        let next = r.nextDate;
        while (next < today()) next = nextRecurrence(next, r.repeatEvery);
        r.nextDate = next;
      }
    } else throw bad('Unknown action');
    return r;
  }));

  // ---------------------------------------------------------------- bulk update
  const filterOf = (b: Record<string, unknown>): BulkFilter => ({
    accountId: String(b.accountId || ''),
    contactId: str(b.contactId),
    from: str(b.from),
    to: str(b.to),
    minAmount: b.minAmount === '' || b.minAmount == null ? undefined : Number(b.minAmount),
    maxAmount: b.maxAmount === '' || b.maxAmount == null ? undefined : Number(b.maxAmount),
  });
  api.post('/bulk-update/search', h((req) => bulkSearch(getDb(), filterOf(req.body || {}))));
  api.post('/bulk-update', m((req) => bulkUpdate(getDb(), { ...filterOf(req.body || {}), newAccountId: String(req.body?.newAccountId || ''), ids: (req.body?.ids as string[]) || [] })));

  // ---------------------------------------------------------------- currencies
  api.get('/currencies', h(() => getDb().currencies));
  api.put('/currencies/:code', m((req) => {
    const db = getDb();
    const c = db.currencies.find((x) => x.code === p(req, 'code'));
    if (!c) throw notFound('Currency');
    if (c.code === 'INR') throw bad('The base currency rate is always 1');
    const rate = Number(req.body?.rate);
    if (!(rate > 0)) throw bad('Enter a valid exchange rate');
    c.rate = round2(rate * 1e4) / 1e4;
    return c;
  }));
  api.get('/currency-adjustments', h((req) => {
    const db = getDb();
    const period = (q(req, 'period') as PeriodKey) || 'all';
    const r = periodRange(period, today(), db.organization.fiscalYearStartMonth);
    return db.currencyAdjustments.filter((a) => a.date >= r.from && a.date <= r.to).slice().sort((a, b) => b.date.localeCompare(a.date));
  }));
  api.post('/currency-adjustments/preview', h((req) => {
    // Creatign Ledger records every transaction in INR, so there are no open foreign currency balances to revalue.
    const db = getDb();
    const code = String(req.body?.currencyCode || '');
    if (!db.currencies.some((c) => c.code === code && c.code !== 'INR')) throw bad('Select a foreign currency');
    return { currencyCode: code, accounts: [], gainOrLoss: 0 };
  }));
  api.post('/currency-adjustments', m((req) => {
    const db = getDb();
    const b = req.body || {};
    const c = db.currencies.find((x) => x.code === b.currencyCode && x.code !== 'INR');
    if (!c) throw bad('Select a foreign currency');
    const date = str(b.date);
    if (!date) throw bad('Date of Adjustment is required');
    const rate = Number(b.rate);
    if (!(rate > 0)) throw bad('Enter a valid exchange rate');
    const notes = str(b.notes);
    if (!notes) throw bad('Notes are required');
    c.rate = rate;
    const adj = { id: newId('cadj'), currencyCode: c.code, date, rate, notes, gainOrLoss: 0, createdAt: now() };
    db.currencyAdjustments.push(adj);
    return adj;
  }));
  api.delete('/currency-adjustments/:id', m((req) => {
    const db = getDb();
    db.currencyAdjustments = db.currencyAdjustments.filter((x) => x.id !== p(req, 'id'));
  }));

  // ---------------------------------------------------------------- transaction locking
  api.get('/transaction-locks', h(() => getDb().transactionLocks));
  api.post('/transaction-locks/:module/lock', m((req) => {
    const db = getDb();
    const module = p(req, 'module') as LockModule | 'all';
    if (module !== 'all' && !LOCK_MODULES.some((x) => x.value === module)) throw notFound('Module');
    const date = str(req.body?.date);
    if (!date) throw bad('Lock Date is required');
    if (date > today()) throw bad('The lock date cannot be in the future');
    const reason = str(req.body?.reason);
    if (!reason) throw bad('Reason is required');
    const lock = { date, reason, lockedAt: now() };
    if (module === 'all') db.transactionLocks.all = lock;
    else db.transactionLocks.modules[module] = lock;
    db.transactionLocks.history.push({ module, action: 'lock', date, reason, at: now() });
    return db.transactionLocks;
  }));
  api.post('/transaction-locks/:module/unlock', m((req) => {
    const db = getDb();
    const module = p(req, 'module') as LockModule | 'all';
    const reason = str(req.body?.reason);
    if (!reason) throw bad('Reason is required');
    if (module === 'all') db.transactionLocks.all = undefined;
    else delete db.transactionLocks.modules[module];
    db.transactionLocks.history.push({ module, action: 'unlock', reason, at: now() });
    return db.transactionLocks;
  }));
}
