// Banking: bank, cash and credit card accounts, statement import, categorize / match,
// transaction rules, money in / money out / transfers and reconciliation.
import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response, Router, NextFunction } from 'express';
import { BANK_TXN_TYPES, isBankingAccount } from '../shared/accountant';
import { DATE_FORMATS, guessDateFormat, guessMapping, mapRows, parseDelimited, type DateFormat, type ImportMapping } from '../shared/bankImport';
import { periodRange, round2, today, type PeriodKey } from '../shared/format';
import type { Account, BankRule, BankTransaction, BankTxnType, Database, Journal, Reconciliation, RuleCriterion, StatementImport, StatementLine } from '../shared/types';
import { UPLOAD_DIR, getDb, newId, now } from './db';
import { assertUnlocked, sourceLabel } from './accountant';
import { accountBalance } from './reports';
import * as S from './services';

type Wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => Promise<void>;

const bad = (msg: string) => new S.HttpError(400, msg);
const notFound = (what: string) => new S.HttpError(404, `${what} not found`);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const q = (req: Request, k: string) => (typeof req.query[k] === 'string' ? (req.query[k] as string) : undefined);
const p = (req: Request, k: string) => String(req.params[k]);
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

export const MONEY_IN = new Set<BankTxnType>(BANK_TXN_TYPES.filter((t) => t.direction === 'in').map((t) => t.value));

function bankAccount(db: Database, id: string): Account {
  const a = db.accounts.find((x) => x.id === id);
  if (!a || !isBankingAccount(a)) throw notFound('Bank account');
  return a;
}

/** +1 when money in raises the balance (bank, cash), -1 for credit cards (a liability). */
const sideOf = (a: Account) => (a.type === 'liability' ? -1 : 1);

// ------------------------------------------------------------------ book entries

export interface BookEntry {
  journalId: string;
  date: string;
  sourceType: string;
  sourceId?: string;
  number: string;
  type: string;
  reference?: string;
  description?: string;
  contactId?: string;
  contact?: string;
  deposit: number;
  withdrawal: number;
  balance?: number;
  reconciled: boolean;
  statementLineId?: string;
}

/** Display number of the document behind a ledger journal. */
function sourceNumber(db: Database, j: Journal): string {
  switch (j.sourceType) {
    case 'invoice':
    case 'credit_note':
    case 'bill':
    case 'vendor_credit':
      return db.docs.find((d) => d.id === j.sourceId)?.number ?? j.number;
    case 'payment_received':
      return db.paymentsReceived.find((x) => x.id === j.sourceId)?.number ?? j.number;
    case 'payment_made':
      return db.paymentsMade.find((x) => x.id === j.sourceId)?.number ?? j.number;
    case 'manual':
      return j.number;
    case 'expense':
      return db.expenses.find((x) => x.id === j.sourceId)?.invoiceNumber || j.reference || '';
    default:
      return j.reference || j.number;
  }
}

function txnTypeLabel(db: Database, j: Journal, inflow: boolean) {
  if (j.sourceType === 'bank_transaction') {
    const t = db.bankTransactions.find((x) => x.id === j.sourceId);
    return BANK_TXN_TYPES.find((x) => x.value === t?.type)?.label ?? 'Bank Transaction';
  }
  if (j.sourceType === 'payment_received') return 'Client Payment';
  if (j.sourceType === 'payment_made') return inflow ? 'Supplier Refund' : 'Supplier Payment';
  return sourceLabel(j.sourceType);
}

function clearedSet(db: Database, accountId: string, exceptId?: string) {
  const s = new Set<string>();
  for (const r of db.reconciliations) if (r.accountId === accountId && r.status === 'reconciled' && r.id !== exceptId) for (const c of r.cleared) s.add(c);
  return s;
}

export function bookEntries(db: Database, accountId: string, opts: { from?: string; to?: string } = {}): BookEntry[] {
  const acc = bankAccount(db, accountId);
  const cleared = clearedSet(db, accountId);
  const matchedBy = new Map<string, string>();
  for (const l of db.statementLines) if (l.accountId === accountId && l.match?.journalId) matchedBy.set(l.match.journalId, l.id);
  const contacts = new Map(db.contacts.map((c) => [c.id, c.displayName]));
  const out: BookEntry[] = [];
  let bal = 0;
  const sorted = db.journals.slice().sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)));
  for (const j of sorted) {
    let dr = 0;
    let cr = 0;
    let desc: string | undefined;
    for (const l of j.lines)
      if (l.accountId === accountId) {
        dr += l.debit;
        cr += l.credit;
        desc ||= l.description;
      }
    if (!dr && !cr) continue;
    bal = round2(bal + sideOf(acc) * (dr - cr));
    if (opts.from && j.date < opts.from) continue;
    if (opts.to && j.date > opts.to) continue;
    const net = round2(dr - cr);
    const contactId = j.contactId ?? j.lines.find((l) => l.contactId)?.contactId;
    out.push({
      journalId: j.id,
      date: j.date,
      sourceType: j.sourceType,
      sourceId: j.sourceId,
      number: sourceNumber(db, j),
      type: txnTypeLabel(db, j, net > 0),
      reference: j.reference,
      description: desc ?? j.notes,
      contactId,
      contact: contactId ? contacts.get(contactId) : undefined,
      deposit: net > 0 ? net : 0,
      withdrawal: net < 0 ? -net : 0,
      balance: bal,
      reconciled: cleared.has(j.id),
      statementLineId: matchedBy.get(j.id),
    });
  }
  return out;
}

// ------------------------------------------------------------------ consistency

/** A line whose matched / categorized transaction was deleted elsewhere goes back to Uncategorized. */
export function syncStatementLines(db: Database) {
  const exists = (m: NonNullable<StatementLine['match']>) => {
    if (m.type === 'bank_transaction') return db.bankTransactions.some((x) => x.id === m.id);
    if (m.type === 'expense') return db.expenses.some((x) => x.id === m.id);
    if (m.type === 'payment_received') return db.paymentsReceived.some((x) => x.id === m.id && x.status !== 'void');
    if (m.type === 'payment_made') return db.paymentsMade.some((x) => x.id === m.id && x.status !== 'void');
    if (m.type === 'manual') return db.manualJournals.some((x) => x.id === m.id && x.status !== 'draft');
    return db.journals.some((x) => x.id === m.journalId);
  };
  for (const l of db.statementLines) {
    if ((l.status === 'matched' || l.status === 'categorized') && (!l.match || !exists(l.match))) {
      l.status = 'uncategorized';
      l.match = undefined;
    } else if (l.match && !l.match.journalId) {
      l.match.journalId = journalOf(db, l.match.type, l.match.id, l.accountId)?.id;
    }
  }
}

function journalOf(db: Database, type: string, id: string, accountId: string) {
  return db.journals.find((j) => j.sourceId === id && (type === 'journal' ? true : j.sourceType === type) && j.lines.some((l) => l.accountId === accountId));
}

// ------------------------------------------------------------------ rules

function criterionMatches(c: RuleCriterion, l: StatementLine) {
  if (c.field === 'amount') {
    const amt = l.deposit || l.withdrawal;
    const v = num(c.value);
    if (c.op === 'gt') return amt > v;
    if (c.op === 'lt') return amt < v;
    return Math.abs(amt - v) < 0.005;
  }
  const text = (l[c.field] || '').toLowerCase();
  const v = (c.value || '').toLowerCase();
  switch (c.op) {
    case 'contains':
      return text.includes(v);
    case 'not_contains':
      return !text.includes(v);
    case 'equals':
      return text === v;
    case 'starts_with':
      return text.startsWith(v);
    case 'ends_with':
      return text.endsWith(v);
    default:
      return false;
  }
}

export function ruleFor(db: Database, l: StatementLine): BankRule | undefined {
  const acc = db.accounts.find((a) => a.id === l.accountId);
  return db.bankRules
    .slice()
    .sort((a, b) => a.order - b.order)
    .find((r) => {
      if ((r.applyTo === 'deposits') !== l.deposit > 0) return false;
      if (r.scope === 'banks' && acc?.subType === 'credit_card') return false;
      if (r.scope === 'cards' && acc?.subType !== 'credit_card') return false;
      if (r.scope === 'custom' && !r.accountIds.includes(l.accountId)) return false;
      if (!r.criteria.length) return false;
      return r.match === 'all' ? r.criteria.every((c) => criterionMatches(c, l)) : r.criteria.some((c) => criterionMatches(c, l));
    });
}

function saveRule(db: Database, b: Partial<BankRule>, existing?: BankRule): BankRule {
  const name = str(b.name) ?? existing?.name;
  if (!name) throw bad('Rule Name is required');
  const applyTo = (b.applyTo ?? existing?.applyTo ?? 'withdrawals') as BankRule['applyTo'];
  const criteria = (b.criteria ?? existing?.criteria ?? [])
    .filter((c) => c && str(c.value))
    .map((c) => ({ field: c.field, op: c.op, value: String(c.value).trim() })) as RuleCriterion[];
  if (!criteria.length) throw bad('Add at least one criterion');
  for (const c of criteria) if (c.field === 'amount' && !Number.isFinite(Number(c.value))) throw bad('The amount in a criterion must be a number');
  const recordAs = (b.recordAs ?? existing?.recordAs) as BankTxnType;
  const info = BANK_TXN_TYPES.find((t) => t.value === recordAs);
  if (!info) throw bad('Choose what to record the transaction as');
  if ((info.direction === 'in') !== (applyTo === 'deposits')) throw bad(`${info.label} cannot be used for ${applyTo}`);
  const offsetAccountId = str(b.offsetAccountId) ?? existing?.offsetAccountId;
  if (!offsetAccountId || !db.accounts.some((a) => a.id === offsetAccountId)) throw bad('Account is required');
  const scope = (b.scope ?? existing?.scope ?? 'all') as BankRule['scope'];
  const accountIds = scope === 'custom' ? (b.accountIds ?? existing?.accountIds ?? []).filter((id) => db.accounts.some((a) => a.id === id && isBankingAccount(a))) : [];
  if (scope === 'custom' && !accountIds.length) throw bad('Choose the accounts this rule applies to');
  return {
    id: existing?.id ?? newId('rule'),
    name,
    applyTo,
    markAs: b.markAs === 'categorized' || (b.markAs === undefined && existing?.markAs === 'categorized') ? 'categorized' : 'recognized',
    match: (b.match ?? existing?.match) === 'any' ? 'any' : 'all',
    criteria,
    recordAs,
    offsetAccountId,
    contactId: b.contactId === '' ? undefined : str(b.contactId) ?? existing?.contactId,
    referenceFrom: (b.referenceFrom ?? existing?.referenceFrom ?? 'none') as BankRule['referenceFrom'],
    accountIds,
    scope,
    order: existing?.order ?? (db.bankRules.reduce((mx, r) => Math.max(mx, r.order), 0) + 1),
    createdAt: existing?.createdAt ?? now(),
  };
}

// ------------------------------------------------------------------ money in / out

function saveBankTxn(db: Database, b: Partial<BankTransaction>, existing?: BankTransaction): BankTransaction {
  const type = (b.type ?? existing?.type) as BankTxnType;
  const info = BANK_TXN_TYPES.find((t) => t.value === type);
  if (!info) throw bad('Transaction type is required');
  const accountId = str(b.accountId) ?? existing?.accountId;
  if (!accountId) throw bad('Account is required');
  const acc = bankAccount(db, accountId);
  const offsetAccountId = str(b.offsetAccountId) ?? existing?.offsetAccountId;
  const offset = db.accounts.find((a) => a.id === offsetAccountId);
  if (!offset) throw bad(info.offset === 'bank' ? (info.direction === 'in' ? 'From Account is required' : 'To Account is required') : 'Account is required');
  if (offset.id === acc.id) throw bad('Choose a different account for the other side of the transaction');
  if (info.offset === 'bank' && !isBankingAccount(offset)) throw bad('Transfers must be between bank, cash or credit card accounts');
  if (info.offset === 'card' && offset.subType !== 'credit_card') throw bad('Choose the credit card being paid');
  if (info.offset === 'equity' && offset.type !== 'equity') throw bad('Choose an equity account');
  if (info.offset === 'income' && offset.type !== 'income') throw bad('Choose an income account');
  const amount = round2(num(b.amount ?? existing?.amount));
  if (amount <= 0) throw bad('Amount must be greater than zero');
  const date = b.date ?? existing?.date ?? today();
  if (!isDate(date)) throw bad('Date is required');
  if (info.offset === 'bank') assertUnlocked(db, 'banking', date);
  return {
    id: existing?.id ?? newId('btx'),
    type,
    date,
    accountId,
    offsetAccountId: offset.id,
    amount,
    referenceNumber: b.referenceNumber === '' ? undefined : str(b.referenceNumber) ?? existing?.referenceNumber,
    description: b.description === '' ? undefined : str(b.description) ?? existing?.description,
    contactId: b.contactId === '' ? undefined : str(b.contactId) ?? existing?.contactId,
    statementLineId: existing?.statementLineId ?? b.statementLineId,
    attachments: b.attachments ?? existing?.attachments ?? [],
    createdAt: existing?.createdAt ?? now(),
    updatedAt: existing ? now() : undefined,
  };
}

// ------------------------------------------------------------------ categorize / match

type CategorizeAs = BankTxnType | 'customer_payment' | 'vendor_payment';
interface CategorizeBody {
  as: CategorizeAs;
  offsetAccountId?: string;
  contactId?: string;
  referenceNumber?: string;
  description?: string;
  allocations?: { docId: string; amount: number }[];
  taxId?: string;
  bankCharges?: number;
}

function lineAmount(l: StatementLine) {
  return l.deposit || l.withdrawal;
}

export function categorizeLine(db: Database, l: StatementLine, b: CategorizeBody, ruleId?: string) {
  if (l.status !== 'uncategorized') throw bad('Only uncategorized transactions can be categorized');
  const inflow = l.deposit > 0;
  const amount = lineAmount(l);
  const reference = str(b.referenceNumber) ?? l.reference;
  const description = str(b.description) ?? l.description;
  if (b.as === 'customer_payment') {
    if (!inflow) throw bad('Client payments can only be recorded for deposits');
    assertUnlocked(db, 'sales', l.date);
    const pmt = S.savePaymentReceived({ contactId: b.contactId, amount, date: l.date, mode: 'Bank Transfer', depositToAccountId: l.accountId, referenceNumber: reference, allocations: b.allocations ?? [], bankCharges: num(b.bankCharges), notes: description });
    l.match = { type: 'payment_received', id: pmt.id };
  } else if (b.as === 'vendor_payment') {
    if (inflow) throw bad('Supplier payments can only be recorded for withdrawals');
    assertUnlocked(db, 'purchases', l.date);
    const pmt = S.savePaymentMade({ type: (b.allocations ?? []).length ? 'bill_payment' : 'vendor_advance', contactId: b.contactId, amount, date: l.date, mode: 'Bank Transfer', paidThroughAccountId: l.accountId, referenceNumber: reference, allocations: b.allocations ?? [], notes: description });
    l.match = { type: 'payment_made', id: pmt.id };
  } else if (b.as === 'expense') {
    if (inflow) throw bad('Expenses can only be recorded for withdrawals');
    assertUnlocked(db, 'purchases', l.date);
    const e = S.saveExpense({ date: l.date, accountId: b.offsetAccountId, amount, paidThroughAccountId: l.accountId, vendorId: str(b.contactId), invoiceNumber: reference, notes: description, taxId: str(b.taxId) } as never);
    l.match = { type: 'expense', id: e.id };
  } else {
    const info = BANK_TXN_TYPES.find((t) => t.value === b.as);
    if (!info) throw bad('Choose what to categorize the transaction as');
    if ((info.direction === 'in') !== inflow) throw bad(`${info.label} cannot be used for a ${inflow ? 'deposit' : 'withdrawal'}`);
    const t = saveBankTxn(db, { type: b.as, date: l.date, accountId: l.accountId, offsetAccountId: b.offsetAccountId, amount, referenceNumber: reference, description, contactId: b.contactId, statementLineId: l.id });
    db.bankTransactions.push(t);
    l.match = { type: 'bank_transaction', id: t.id };
  }
  l.status = 'categorized';
  if (ruleId) l.ruleId = ruleId;
  return l;
}

/** Remove what categorizing created and send the line back to Uncategorized; matched lines are just unlinked. */
function uncategorize(db: Database, l: StatementLine) {
  if (l.status === 'categorized' && l.match) {
    const { type, id } = l.match;
    if (type === 'bank_transaction') db.bankTransactions = db.bankTransactions.filter((x) => x.id !== id);
    if (type === 'expense') S.deleteExpenses([id]);
    if (type === 'payment_received') db.paymentsReceived = db.paymentsReceived.filter((x) => x.id !== id);
    if (type === 'payment_made') db.paymentsMade = db.paymentsMade.filter((x) => x.id !== id);
  }
  l.status = 'uncategorized';
  l.match = undefined;
  return l;
}

/** Book entries in the same account with the same amount and direction, close in date, not matched yet. */
export function suggestions(db: Database, l: StatementLine) {
  const amount = lineAmount(l);
  const inflow = l.deposit > 0;
  const day = (d: string) => new Date(`${d}T00:00:00Z`).getTime() / 86400000;
  return bookEntries(db, l.accountId)
    .filter((e) => !e.statementLineId && !e.reconciled && Math.abs((inflow ? e.deposit : e.withdrawal) - amount) < 0.005)
    .map((e) => ({ ...e, days: Math.abs(day(e.date) - day(l.date)) }))
    .filter((e) => e.days <= 30)
    .sort((a, b) => a.days - b.days)
    .slice(0, 10);
}

function matchType(sourceType: string): NonNullable<StatementLine['match']>['type'] {
  if (sourceType === 'bank_transaction' || sourceType === 'expense' || sourceType === 'payment_received' || sourceType === 'payment_made' || sourceType === 'manual') return sourceType;
  return 'journal';
}

// ------------------------------------------------------------------ import

interface ImportBody {
  text?: string;
  documentId?: string;
  fileName?: string;
  hasHeader?: boolean;
  mapping?: ImportMapping;
  dateFormat?: DateFormat;
}

function importText(db: Database, b: ImportBody) {
  if (str(b.text)) return { text: String(b.text), fileName: str(b.fileName) ?? 'statement.csv' };
  if (b.documentId) {
    const d = db.documents.find((x) => x.id === b.documentId && !x.trashedAt);
    if (!d) throw notFound('Document');
    const file = path.join(UPLOAD_DIR, path.basename(d.url));
    if (!fs.existsSync(file)) throw bad('The file is no longer available');
    return { text: fs.readFileSync(file, 'utf8'), fileName: d.name };
  }
  throw bad('Choose a statement file to import');
}

export function previewImport(db: Database, b: ImportBody) {
  const { text } = importText(db, b);
  const rows = parseDelimited(text);
  if (!rows.length) throw bad('The file is empty');
  const hasHeader = b.hasHeader !== false;
  const headers = hasHeader ? rows[0] : rows[0].map((_, i) => `Column ${i + 1}`);
  const body = hasHeader ? rows.slice(1) : rows;
  const mapping = b.mapping ?? guessMapping(headers);
  const dateFormat = b.dateFormat ?? guessDateFormat(body.slice(0, 20).map((r) => r[mapping.date] ?? ''));
  return { headers, sample: body.slice(0, 8), total: body.length, mapping, dateFormat, dateFormats: DATE_FORMATS, parsed: mapRows(body.slice(0, 8), mapping, dateFormat) };
}

const dupKey = (x: { date: string; deposit: number; withdrawal: number; description?: string; reference?: string }) => `${x.date}|${round2(x.deposit)}|${round2(x.withdrawal)}|${(x.description || '').trim().toLowerCase()}|${(x.reference || '').trim().toLowerCase()}`;

export function importStatement(db: Database, accountId: string, b: ImportBody) {
  bankAccount(db, accountId);
  const { text, fileName } = importText(db, b);
  const rows = parseDelimited(text);
  const body = b.hasHeader !== false ? rows.slice(1) : rows;
  if (!body.length) throw bad('The file has no transactions');
  const headers = b.hasHeader !== false ? rows[0] : [];
  const mapping = b.mapping ?? guessMapping(headers);
  if (mapping.amount == null && mapping.deposit == null && mapping.withdrawal == null) throw bad('Map the Deposit and Withdrawal columns, or a single Amount column');
  const fmt = b.dateFormat ?? guessDateFormat(body.slice(0, 20).map((r) => r[mapping.date] ?? ''));
  const parsed = mapRows(body, mapping, fmt);
  const errors = parsed.filter((x) => x.error).map((x) => x.error as string);
  const good = parsed.filter((x) => !x.error);
  if (!good.length) throw bad(errors[0] ?? 'No transactions could be read from the file');
  const seen = new Set(db.statementLines.filter((l) => l.accountId === accountId).map(dupKey));
  const imp: StatementImport = { id: newId('simp'), accountId, fileName, lines: 0, duplicates: 0, documentId: b.documentId, createdAt: now() };
  let categorized = 0;
  let recognized = 0;
  // closing balance: the balance on the last row of the latest date (statements list oldest or newest first)
  const withBal = good.filter((x) => x.balance != null);
  if (withBal.length) {
    const last = withBal.reduce((a, x) => ((x.date as string) > (a.date as string) ? x : a), withBal[0]);
    const sameDay = withBal.filter((x) => x.date === last.date);
    const newestFirst = (good[0].date as string) > (good[good.length - 1].date as string);
    imp.closingBalance = (newestFirst ? sameDay[0] : sameDay[sameDay.length - 1]).balance;
  }
  for (const x of good) {
    const line: StatementLine = { id: newId('sl'), accountId, date: x.date as string, description: x.description, reference: x.reference, payee: x.payee, deposit: x.deposit, withdrawal: x.withdrawal, status: 'uncategorized', importId: imp.id, createdAt: now() };
    const key = dupKey(line);
    if (seen.has(key)) {
      imp.duplicates++;
      continue;
    }
    seen.add(key);
    db.statementLines.push(line);
    imp.lines++;
    if (!imp.from || line.date < imp.from) imp.from = line.date;
    if (!imp.to || line.date > imp.to) imp.to = line.date;
    const rule = ruleFor(db, line);
    if (!rule) continue;
    line.ruleId = rule.id;
    if (rule.markAs === 'categorized') {
      try {
        categorizeLine(db, line, ruleBody(rule, line), rule.id);
        categorized++;
      } catch {
        recognized++; // locked period or invalid account: leave it for review
      }
    } else recognized++;
  }
  db.statementImports.push(imp);
  if (b.documentId) {
    const d = db.documents.find((x) => x.id === b.documentId);
    if (d) d.importedToAccountId = accountId;
  }
  return { import: imp, imported: imp.lines, duplicates: imp.duplicates, categorized, recognized, errors };
}

function ruleBody(rule: BankRule, l: StatementLine): CategorizeBody {
  return { as: rule.recordAs, offsetAccountId: rule.offsetAccountId, contactId: rule.contactId, referenceNumber: rule.referenceFrom === 'description' ? l.description : rule.referenceFrom === 'reference' ? l.reference : undefined };
}

// ------------------------------------------------------------------ reconciliation

function lastReconciled(db: Database, accountId: string, exceptId?: string) {
  return db.reconciliations.filter((r) => r.accountId === accountId && r.status === 'reconciled' && r.id !== exceptId).sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
}

export function reconciliationView(db: Database, r: Reconciliation) {
  const acc = bankAccount(db, r.accountId);
  const others = clearedSet(db, r.accountId, r.id);
  const cleared = new Set(r.cleared);
  const entries = bookEntries(db, r.accountId, { to: r.endDate })
    .filter((e) => !others.has(e.journalId))
    .map((e) => ({ ...e, cleared: cleared.has(e.journalId), reconciled: r.status === 'reconciled' && cleared.has(e.journalId) }));
  const clearedDeposits = round2(entries.filter((e) => e.cleared).reduce((s, e) => s + e.deposit, 0));
  const clearedWithdrawals = round2(entries.filter((e) => e.cleared).reduce((s, e) => s + e.withdrawal, 0));
  const clearedBalance = round2(r.openingBalance + sideOf(acc) * (clearedDeposits - clearedWithdrawals));
  return {
    ...r,
    accountName: acc.name,
    accountSubType: acc.subType,
    entries,
    clearedDeposits,
    clearedWithdrawals,
    clearedBalance,
    difference: round2(r.closingBalance - clearedBalance),
    booksBalance: accountBalance(db, r.accountId, r.endDate),
  };
}

// ------------------------------------------------------------------ overview

/** Balance as per the bank: the latest closing balance from an imported statement (or reconciliation),
 *  rolled forward by statement lines dated after it. Unknown until a statement with balances is imported. */
function statementBalance(db: Database, accountId: string) {
  const lines = db.statementLines.filter((l) => l.accountId === accountId);
  const fromImport = db.statementImports.filter((i) => i.accountId === accountId && i.closingBalance != null && i.to).sort((a, b) => (b.to as string).localeCompare(a.to as string))[0];
  const rec = lastReconciled(db, accountId);
  const base = fromImport && (!rec || (fromImport.to as string) >= rec.endDate) ? { date: fromImport.to as string, bal: fromImport.closingBalance as number } : rec ? { date: rec.endDate, bal: rec.closingBalance } : undefined;
  if (!base) return undefined;
  return round2(base.bal + lines.filter((l) => l.date > base.date).reduce((s, l) => s + l.deposit - l.withdrawal, 0));
}

export function bankingAccounts(db: Database) {
  return db.accounts.filter(isBankingAccount).map((a) => {
    const lines = db.statementLines.filter((l) => l.accountId === a.id);
    const imports = db.statementImports.filter((i) => i.accountId === a.id).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
    const last = lastReconciled(db, a.id);
    return {
      id: a.id,
      name: a.name,
      code: a.code,
      subType: a.subType,
      type: a.type,
      accountNumber: a.accountNumber,
      bankName: a.bankName,
      ifsc: a.ifsc,
      currencyCode: a.currencyCode || 'INR',
      description: a.description,
      primary: a.primary,
      active: a.active,
      system: a.system,
      booksBalance: accountBalance(db, a.id),
      statementBalance: statementBalance(db, a.id),
      uncategorized: lines.filter((l) => l.status === 'uncategorized').length,
      lastImport: imports[0]?.createdAt,
      lastReconciled: last?.endDate,
    };
  });
}

function overview(db: Database, period: PeriodKey | 'last_30_days', accountId?: string) {
  const accounts = bankingAccounts(db);
  const pick = accounts.filter((a) => a.active !== false && (!accountId || a.id === accountId));
  const { from, to } = period === 'last_30_days' ? { from: nextDay(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)), to: today() } : periodRange(period);
  const end = to && to < today() ? to : today();
  const start = from || end;
  // daily closing balance of the chosen accounts (credit cards count as money owed, so they reduce cash)
  const days: string[] = [];
  for (let d = new Date(`${start}T00:00:00Z`); d.toISOString().slice(0, 10) <= end && days.length < 400; d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
  const ids = new Set(pick.map((a) => a.id));
  const byAcc = new Map(db.accounts.filter((a) => ids.has(a.id)).map((a) => [a.id, a]));
  const deltas = new Map<string, number>();
  let opening = 0;
  for (const j of db.journals)
    for (const l of j.lines) {
      const a = byAcc.get(l.accountId);
      if (!a) continue;
      const v = (accountId ? sideOf(a) : 1) * (l.debit - l.credit);
      if (j.date < start) opening += v;
      else if (j.date <= end) deltas.set(j.date, (deltas.get(j.date) || 0) + v);
    }
  let bal = opening;
  const series = days.map((d) => {
    bal += deltas.get(d) || 0;
    return { date: d, balance: round2(bal) };
  });
  const sumOf = (f: (a: (typeof accounts)[number]) => boolean) => round2(accounts.filter((a) => a.active !== false && f(a)).reduce((s, a) => s + a.booksBalance, 0));
  return {
    accounts,
    totals: { cash: sumOf((a) => a.subType === 'cash'), bank: sumOf((a) => a.subType === 'bank'), card: sumOf((a) => a.subType === 'credit_card'), clearing: sumOf((a) => a.subType === 'payment_clearing') },
    uncategorized: accounts.reduce((s, a) => s + a.uncategorized, 0),
    series,
  };
}

// ------------------------------------------------------------------ routes

export function registerBankingRoutes(api: Router, h: Wrap, m: Wrap) {
  const line = (db: Database, id: string) => {
    const l = db.statementLines.find((x) => x.id === id);
    if (!l) throw notFound('Transaction');
    return l;
  };

  api.get('/banking/overview', h((req) => {
    const db = getDb();
    syncStatementLines(db);
    return overview(db, (q(req, 'period') as PeriodKey | 'last_30_days') || 'last_30_days', q(req, 'accountId'));
  }));
  api.get('/banking/accounts', h(() => {
    const db = getDb();
    syncStatementLines(db);
    return bankingAccounts(db);
  }));
  api.get('/banking/accounts/:id', h((req) => {
    const db = getDb();
    syncStatementLines(db);
    const a = bankingAccounts(db).find((x) => x.id === p(req, 'id'));
    if (!a) throw notFound('Bank account');
    return { ...a, imports: db.statementImports.filter((i) => i.accountId === a.id).sort((x, y) => y.createdAt.localeCompare(x.createdAt)) };
  }));
  api.get('/banking/accounts/:id/transactions', h((req) => {
    const db = getDb();
    syncStatementLines(db);
    const { from, to } = q(req, 'period') ? periodRange(q(req, 'period') as PeriodKey) : { from: q(req, 'from'), to: q(req, 'to') };
    const search = (q(req, 'search') || '').toLowerCase();
    return bookEntries(db, p(req, 'id'), { from, to })
      .filter((e) => !search || [e.number, e.reference, e.description, e.contact, e.type].some((x) => (x || '').toLowerCase().includes(search)))
      .reverse();
  }));
  api.get('/banking/accounts/:id/statement-lines', h((req) => {
    const db = getDb();
    bankAccount(db, p(req, 'id'));
    syncStatementLines(db);
    const status = q(req, 'status');
    const rules = new Map(db.bankRules.map((r) => [r.id, r.name]));
    return db.statementLines
      .filter((l) => l.accountId === p(req, 'id') && (!status || status === 'all' || l.status === status))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      .map((l) => ({ ...l, ruleName: l.ruleId ? rules.get(l.ruleId) : undefined }));
  }));

  // import
  api.post('/banking/import/preview', h((req) => previewImport(getDb(), req.body || {})));
  api.post('/banking/accounts/:id/import', m((req) => importStatement(getDb(), p(req, 'id'), req.body || {})));
  api.delete('/banking/imports/:id', m((req) => {
    const db = getDb();
    const imp = db.statementImports.find((x) => x.id === p(req, 'id'));
    if (!imp) throw notFound('Import');
    if (db.statementLines.some((l) => l.importId === imp.id && l.status !== 'uncategorized' && l.status !== 'excluded')) throw bad('Uncategorize or unmatch the transactions from this statement before deleting it');
    db.statementLines = db.statementLines.filter((l) => l.importId !== imp.id);
    db.statementImports = db.statementImports.filter((x) => x.id !== imp.id);
  }));

  // statement lines
  api.post('/banking/accounts/:id/statement-lines', m((req) => {
    const db = getDb();
    bankAccount(db, p(req, 'id'));
    const b = req.body || {};
    if (!isDate(b.date)) throw bad('Date is required');
    const deposit = round2(Math.abs(num(b.deposit)));
    const withdrawal = round2(Math.abs(num(b.withdrawal)));
    if (!!deposit === !!withdrawal) throw bad('Enter either a deposit or a withdrawal');
    const l: StatementLine = { id: newId('sl'), accountId: p(req, 'id'), date: b.date, description: str(b.description), reference: str(b.reference), payee: str(b.payee), deposit, withdrawal, status: 'uncategorized', createdAt: now() };
    const rule = ruleFor(db, l);
    if (rule) l.ruleId = rule.id;
    db.statementLines.push(l);
    return l;
  }));
  api.get('/banking/statement-lines/:id', h((req) => {
    const db = getDb();
    syncStatementLines(db);
    const l = line(db, p(req, 'id'));
    const rule = l.ruleId ? db.bankRules.find((r) => r.id === l.ruleId) : ruleFor(db, l);
    const matched = l.match?.journalId ? bookEntries(db, l.accountId).find((e) => e.journalId === l.match?.journalId) : undefined;
    return { ...l, rule, ruleSuggestion: rule && l.status === 'uncategorized' ? ruleBody(rule, l) : undefined, suggestions: l.status === 'uncategorized' ? suggestions(db, l) : [], matched };
  }));
  api.get('/banking/statement-lines/:id/search', h((req) => {
    // "Search other transactions" for manual matching
    const db = getDb();
    const l = line(db, p(req, 'id'));
    const inflow = l.deposit > 0;
    const s = (q(req, 'search') || '').toLowerCase();
    const min = q(req, 'min') ? num(q(req, 'min')) : undefined;
    const max = q(req, 'max') ? num(q(req, 'max')) : undefined;
    return bookEntries(db, l.accountId, { from: q(req, 'from'), to: q(req, 'to') })
      .filter((e) => !e.statementLineId && !e.reconciled && (inflow ? e.deposit : e.withdrawal) > 0)
      .filter((e) => (min == null || (e.deposit || e.withdrawal) >= min) && (max == null || (e.deposit || e.withdrawal) <= max))
      .filter((e) => !s || [e.number, e.reference, e.description, e.contact].some((x) => (x || '').toLowerCase().includes(s)))
      .reverse()
      .slice(0, 50);
  }));
  api.post('/banking/statement-lines/:id/match', m((req) => {
    const db = getDb();
    syncStatementLines(db);
    const l = line(db, p(req, 'id'));
    if (l.status !== 'uncategorized') throw bad('Only uncategorized transactions can be matched');
    const journalId = String(req.body?.journalId || '');
    const e = bookEntries(db, l.accountId).find((x) => x.journalId === journalId);
    if (!e) throw notFound('Transaction');
    if (e.statementLineId) throw bad('That transaction is already matched to another statement line');
    const amount = l.deposit > 0 ? e.deposit : e.withdrawal;
    if (Math.abs(amount - lineAmount(l)) > 0.004) throw bad('The amounts of the statement line and the transaction must be the same');
    const mt = matchType(e.sourceType);
    l.match = { type: mt, id: mt === 'journal' ? e.journalId : (e.sourceId as string), journalId: e.journalId };
    l.status = 'matched';
    return l;
  }));
  api.post('/banking/statement-lines/:id/categorize', m((req) => {
    const db = getDb();
    const l = line(db, p(req, 'id'));
    const out = categorizeLine(db, l, req.body || {});
    return out;
  }));
  api.post('/banking/statement-lines/:id/apply-rule', m((req) => {
    const db = getDb();
    const l = line(db, p(req, 'id'));
    const rule = db.bankRules.find((r) => r.id === (req.body?.ruleId || l.ruleId)) ?? ruleFor(db, l);
    if (!rule) throw bad('No rule applies to this transaction');
    return categorizeLine(db, l, ruleBody(rule, l), rule.id);
  }));
  api.post('/banking/statement-lines/:id/uncategorize', m((req) => uncategorize(getDb(), line(getDb(), p(req, 'id')))));
  api.post('/banking/statement-lines/:id/exclude', m((req) => {
    const l = line(getDb(), p(req, 'id'));
    if (l.status !== 'uncategorized') throw bad('Only uncategorized transactions can be excluded');
    l.status = 'excluded';
    return l;
  }));
  api.post('/banking/statement-lines/:id/restore', m((req) => {
    const l = line(getDb(), p(req, 'id'));
    if (l.status === 'excluded') l.status = 'uncategorized';
    return l;
  }));
  api.delete('/banking/statement-lines/:id', m((req) => {
    const db = getDb();
    const l = line(db, p(req, 'id'));
    if (l.status === 'matched' || l.status === 'categorized') throw bad('Uncategorize the transaction before deleting it');
    db.statementLines = db.statementLines.filter((x) => x.id !== l.id);
  }));
  api.post('/banking/statement-lines-bulk', m((req) => {
    const db = getDb();
    const ids: string[] = (req.body?.ids || []).map(String);
    const action = String(req.body?.action || '');
    let done = 0;
    const errors: string[] = [];
    for (const id of ids) {
      const l = db.statementLines.find((x) => x.id === id);
      if (!l) continue;
      try {
        assertUnlocked(db, 'banking', l.date);
        if (action === 'exclude' && l.status === 'uncategorized') l.status = 'excluded';
        else if (action === 'restore' && l.status === 'excluded') l.status = 'uncategorized';
        else if (action === 'uncategorize' && (l.status === 'categorized' || l.status === 'matched')) uncategorize(db, l);
        else if (action === 'delete' && (l.status === 'uncategorized' || l.status === 'excluded')) db.statementLines = db.statementLines.filter((x) => x.id !== id);
        else if (action === 'apply-rule' && l.status === 'uncategorized') {
          const rule = (l.ruleId && db.bankRules.find((r) => r.id === l.ruleId)) || ruleFor(db, l);
          if (!rule) continue;
          categorizeLine(db, l, ruleBody(rule, l), rule.id);
        } else continue;
        done++;
      } catch (e) {
        errors.push(`${l.date} ${l.description || ''}: ${(e as Error).message}`);
      }
    }
    return { done, errors };
  }));

  // money in / money out / transfers
  api.get('/banking/transactions/:id', h((req) => {
    const db = getDb();
    const t = db.bankTransactions.find((x) => x.id === p(req, 'id'));
    if (!t) throw notFound('Transaction');
    const name = (id?: string) => db.accounts.find((a) => a.id === id)?.name;
    return { ...t, accountName: name(t.accountId), offsetAccountName: name(t.offsetAccountId), contactName: db.contacts.find((c) => c.id === t.contactId)?.displayName, journal: db.journals.find((j) => j.sourceType === 'bank_transaction' && j.sourceId === t.id) };
  }));
  api.post('/banking/transactions', m((req) => {
    const db = getDb();
    const t = saveBankTxn(db, req.body || {});
    db.bankTransactions.push(t);
    return t;
  }));
  api.put('/banking/transactions/:id', m((req) => {
    const db = getDb();
    const i = db.bankTransactions.findIndex((x) => x.id === p(req, 'id'));
    if (i < 0) throw notFound('Transaction');
    const existing = db.bankTransactions[i];
    if (existing.statementLineId && req.body && (req.body.amount !== undefined && round2(num(req.body.amount)) !== existing.amount)) throw bad('The amount of a transaction categorized from a bank statement cannot be changed');
    db.bankTransactions[i] = saveBankTxn(db, { ...req.body, accountId: existing.accountId }, existing);
    return db.bankTransactions[i];
  }));
  api.delete('/banking/transactions/:id', m((req) => {
    const db = getDb();
    db.bankTransactions = db.bankTransactions.filter((x) => x.id !== p(req, 'id'));
    syncStatementLines(db);
  }));

  // rules
  api.get('/banking/rules', h((req) => {
    const db = getDb();
    const acc = q(req, 'accountId');
    const name = (id?: string) => db.accounts.find((a) => a.id === id)?.name;
    return db.bankRules
      .filter((r) => !acc || r.scope === 'all' || r.accountIds.includes(acc) || (r.scope === 'banks' && db.accounts.find((a) => a.id === acc)?.subType !== 'credit_card') || (r.scope === 'cards' && db.accounts.find((a) => a.id === acc)?.subType === 'credit_card'))
      .sort((a, b) => a.order - b.order)
      .map((r) => ({ ...r, offsetAccountName: name(r.offsetAccountId), contactName: db.contacts.find((c) => c.id === r.contactId)?.displayName, matches: db.statementLines.filter((l) => l.ruleId === r.id).length }));
  }));
  api.get('/banking/rules/:id', h((req) => {
    const r = getDb().bankRules.find((x) => x.id === p(req, 'id'));
    if (!r) throw notFound('Rule');
    return r;
  }));
  api.post('/banking/rules', m((req) => {
    const db = getDb();
    const r = saveRule(db, req.body || {});
    db.bankRules.push(r);
    return r;
  }));
  api.put('/banking/rules/:id', m((req) => {
    const db = getDb();
    const i = db.bankRules.findIndex((x) => x.id === p(req, 'id'));
    if (i < 0) throw notFound('Rule');
    db.bankRules[i] = saveRule(db, req.body || {}, db.bankRules[i]);
    return db.bankRules[i];
  }));
  api.post('/banking/rules/reorder', m((req) => {
    const db = getDb();
    ((req.body?.ids as string[]) || []).forEach((id, i) => {
      const r = db.bankRules.find((x) => x.id === id);
      if (r) r.order = i + 1;
    });
  }));
  api.delete('/banking/rules/:id', m((req) => {
    const db = getDb();
    db.bankRules = db.bankRules.filter((x) => x.id !== p(req, 'id'));
    for (const l of db.statementLines) if (l.ruleId === p(req, 'id') && l.status === 'uncategorized') l.ruleId = undefined;
  }));

  // reconciliation
  api.get('/banking/accounts/:id/reconciliations', h((req) => {
    const db = getDb();
    bankAccount(db, p(req, 'id'));
    return db.reconciliations
      .filter((r) => r.accountId === p(req, 'id'))
      .sort((a, b) => b.endDate.localeCompare(a.endDate))
      .map((r) => {
        const v = reconciliationView(db, r);
        return { ...r, clearedBalance: v.clearedBalance, difference: v.difference, cleared: undefined, count: r.cleared.length };
      });
  }));
  api.post('/banking/accounts/:id/reconciliations', m((req) => {
    const db = getDb();
    const acc = bankAccount(db, p(req, 'id'));
    const b = req.body || {};
    if (db.reconciliations.some((r) => r.accountId === acc.id && r.status === 'draft')) throw bad('Finish or delete the reconciliation in progress first');
    const last = lastReconciled(db, acc.id);
    const startDate = isDate(b.startDate) ? b.startDate : last ? nextDay(last.endDate) : undefined;
    if (!startDate) throw bad('Start Date is required');
    if (!isDate(b.endDate)) throw bad('End Date is required');
    if (b.endDate < startDate) throw bad('End Date cannot be before the Start Date');
    if (last && startDate <= last.endDate) throw bad(`This account is reconciled through ${last.endDate.split('-').reverse().join('/')}. Start after that date.`);
    if (b.closingBalance === undefined || b.closingBalance === '' || !Number.isFinite(Number(b.closingBalance))) throw bad('Closing Balance is required');
    const r: Reconciliation = { id: newId('rec'), accountId: acc.id, startDate, endDate: b.endDate, openingBalance: last ? last.closingBalance : round2(num(b.openingBalance)), closingBalance: round2(num(b.closingBalance)), cleared: [], status: 'draft', createdAt: now() };
    // matched statement lines are cleared to start with
    const matched = new Set(db.statementLines.filter((l) => l.accountId === acc.id && l.match?.journalId && l.date <= r.endDate).map((l) => l.match?.journalId as string));
    r.cleared = reconciliationView(db, r).entries.filter((e) => matched.has(e.journalId)).map((e) => e.journalId);
    db.reconciliations.push(r);
    return r;
  }));
  const rec = (db: Database, id: string) => {
    const r = db.reconciliations.find((x) => x.id === id);
    if (!r) throw notFound('Reconciliation');
    return r;
  };
  api.get('/banking/reconciliations/:id', h((req) => {
    const db = getDb();
    return reconciliationView(db, rec(db, p(req, 'id')));
  }));
  api.put('/banking/reconciliations/:id', m((req) => {
    const db = getDb();
    const r = rec(db, p(req, 'id'));
    if (r.status !== 'draft') throw bad('Undo the reconciliation to change it');
    const valid = new Set(reconciliationView(db, r).entries.map((e) => e.journalId));
    if (Array.isArray(req.body?.cleared)) r.cleared = (req.body.cleared as string[]).filter((x) => valid.has(x));
    if (req.body?.closingBalance !== undefined) r.closingBalance = round2(num(req.body.closingBalance));
    if (isDate(req.body?.endDate) && req.body.endDate >= r.startDate) r.endDate = req.body.endDate;
    return reconciliationView(db, r);
  }));
  api.post('/banking/reconciliations/:id/complete', m((req) => {
    const db = getDb();
    const r = rec(db, p(req, 'id'));
    if (Array.isArray(req.body?.cleared)) {
      const valid = new Set(reconciliationView(db, r).entries.map((e) => e.journalId));
      r.cleared = (req.body.cleared as string[]).filter((x) => valid.has(x));
    }
    const v = reconciliationView(db, r);
    if (Math.abs(v.difference) > 0.004) throw bad(`The difference must be zero to reconcile. It is ${v.difference.toFixed(2)} now.`);
    r.status = 'reconciled';
    r.reconciledAt = now();
    return r;
  }));
  api.post('/banking/reconciliations/:id/undo', m((req) => {
    const db = getDb();
    const r = rec(db, p(req, 'id'));
    if (r.status !== 'reconciled') throw bad('This reconciliation is not complete');
    const latest = lastReconciled(db, r.accountId);
    if (latest && latest.id !== r.id) throw bad('Undo the later reconciliations of this account first');
    if (db.reconciliations.some((x) => x.accountId === r.accountId && x.status === 'draft')) throw bad('Delete the reconciliation in progress first');
    r.status = 'draft';
    r.reconciledAt = undefined;
    return r;
  }));
  api.delete('/banking/reconciliations/:id', m((req) => {
    const db = getDb();
    const r = rec(db, p(req, 'id'));
    if (r.status === 'reconciled') throw bad('Undo the reconciliation before deleting it');
    db.reconciliations = db.reconciliations.filter((x) => x.id !== r.id);
  }));
}

function nextDay(d: string) {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
}
