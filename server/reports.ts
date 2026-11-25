// Dashboard, statements and financial reports, all derived from documents and the ledger.
import { isUnposted } from '../shared/approval';
import { ACCOUNT_IDS as A, DOC_META } from '../shared/docmeta';
import { daysBetween, monthsIn, periodRange, round2, today, type PeriodKey } from '../shared/format';
import type { Account, Contact, Database, Journal } from '../shared/types';
import { getDb } from './db';
import { ledger, type Basis } from './ledger';
import { stats as projectStats } from './projects';
import { contactSummary } from './services';

const sum = (ns: number[]) => round2(ns.reduce((a, b) => a + (Number(b) || 0), 0));

function accountMap(db: Database) {
  return new Map(db.accounts.map((a) => [a.id, a] as const));
}

/** natural balance sign: debit-normal for assets/expenses */
function signed(acc: Account | undefined, debit: number, credit: number) {
  if (!acc) return debit - credit;
  return acc.type === 'asset' || acc.type === 'expense' ? debit - credit : credit - debit;
}

function inRange(date: string, r: { from: string; to: string }) {
  return date >= r.from && date <= r.to;
}

const CASH_TYPES = new Set(['cash', 'bank']);

// --------------------------------------------------------------- aging

function aging(docs: { dueDate?: string; date: string; balance: number }[]) {
  const t = today();
  const buckets = { current: 0, d1_15: 0, d16_30: 0, d31_45: 0, d45_plus: 0 };
  for (const d of docs) {
    const due = d.dueDate || d.date;
    const late = daysBetween(due, t);
    if (late <= 0) buckets.current += d.balance;
    else if (late <= 15) buckets.d1_15 += d.balance;
    else if (late <= 30) buckets.d16_30 += d.balance;
    else if (late <= 45) buckets.d31_45 += d.balance;
    else buckets.d45_plus += d.balance;
  }
  const overdue = buckets.d1_15 + buckets.d16_30 + buckets.d31_45 + buckets.d45_plus;
  return {
    total: round2(buckets.current + overdue),
    current: round2(buckets.current),
    overdue: round2(overdue),
    buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, round2(v)])),
  };
}

function openInvoices(db: Database) {
  return db.docs.filter((d) => d.kind === 'invoice' && !['void', 'paid'].includes(d.status) && !isUnposted(d.status) && d.balance > 0);
}
function openBills(db: Database) {
  return db.docs.filter((d) => d.kind === 'bill' && !['void', 'paid'].includes(d.status) && !isUnposted(d.status) && d.balance > 0);
}

// --------------------------------------------------------------- dashboard

export function dashboard(params: { cashPeriod?: PeriodKey; incomePeriod?: PeriodKey; expensePeriod?: PeriodKey; basis?: 'accrual' | 'cash' }) {
  const db = getDb();
  const fy = db.organization.fiscalYearStartMonth;
  const accs = accountMap(db);

  const receivables = aging(openInvoices(db));
  const payables = aging(openBills(db));

  // cash flow: movements in cash/bank accounts
  const cashRange = periodRange(params.cashPeriod || 'this_fiscal_year', today(), fy);
  const cashLines = db.journals.flatMap((j) => j.lines.filter((l) => CASH_TYPES.has(accs.get(l.accountId)?.subType || '')).map((l) => ({ date: j.date, net: l.debit - l.credit })));
  const opening = sum(cashLines.filter((l) => l.date < cashRange.from).map((l) => l.net));
  const months = monthsIn(cashRange);
  const cashMonths = months.map((m) => {
    const ls = cashLines.filter((l) => l.date.startsWith(m.key));
    return { month: m.label, incoming: sum(ls.filter((l) => l.net > 0).map((l) => l.net)), outgoing: sum(ls.filter((l) => l.net < 0).map((l) => -l.net)) };
  });
  let running = opening;
  const cashSeries = cashMonths.map((m) => {
    running = round2(running + m.incoming - m.outgoing);
    return { ...m, balance: running };
  });
  const incoming = sum(cashMonths.map((m) => m.incoming));
  const outgoing = sum(cashMonths.map((m) => m.outgoing));

  // income and expense
  const ieRange = periodRange(params.incomePeriod || 'this_fiscal_year', today(), fy);
  const basis = params.basis || 'accrual';
  const ieMonths = monthsIn(ieRange).map((m) => ({ month: m.label, key: m.key, income: 0, expense: 0 }));
  if (basis === 'accrual') {
    for (const j of db.journals) {
      if (!inRange(j.date, ieRange)) continue;
      const bucket = ieMonths.find((m) => j.date.startsWith(m.key));
      if (!bucket) continue;
      for (const l of j.lines) {
        const a = accs.get(l.accountId);
        if (a?.type === 'income') bucket.income += l.credit - l.debit;
        if (a?.type === 'expense') bucket.expense += l.debit - l.credit;
      }
    }
  } else {
    // cash basis: money actually received from customers / paid out
    for (const p of db.paymentsReceived) {
      if (p.status !== 'paid' || !inRange(p.date, ieRange)) continue;
      const b = ieMonths.find((m) => p.date.startsWith(m.key));
      if (b) b.income += p.amount - p.refunds.reduce((s, r) => s + r.amount, 0);
    }
    for (const p of db.paymentsMade) {
      if (p.status !== 'paid' || !inRange(p.date, ieRange)) continue;
      const b = ieMonths.find((m) => p.date.startsWith(m.key));
      if (b) b.expense += p.amount;
    }
    for (const e of db.expenses) {
      if (!inRange(e.date, ieRange)) continue;
      const b = ieMonths.find((m) => e.date.startsWith(m.key));
      if (b) b.expense += e.amount;
    }
  }
  const ieSeries = ieMonths.map((m) => ({ month: m.month, income: round2(m.income), expense: round2(m.expense) }));

  // top expenses by account
  const exRange = periodRange(params.expensePeriod || 'this_fiscal_year', today(), fy);
  const byAcc = new Map<string, number>();
  for (const j of db.journals) {
    if (!inRange(j.date, exRange)) continue;
    for (const l of j.lines) {
      const a = accs.get(l.accountId);
      if (a?.type === 'expense') byAcc.set(a.id, (byAcc.get(a.id) || 0) + l.debit - l.credit);
    }
  }
  const topExpenses = [...byAcc.entries()]
    .map(([id, amount]) => ({ accountId: id, name: accs.get(id)?.name ?? id, amount: round2(amount) }))
    .filter((x) => x.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6);

  const banks = db.accounts
    .filter((a) => CASH_TYPES.has(a.subType) || a.subType === 'credit_card')
    .map((a) => ({ id: a.id, name: a.name, subType: a.subType, balance: accountBalance(db, a.id) }));

  // dashboard watchlist
  const projects = db.projects
    .filter((p) => p.watchlist && p.status === 'active')
    .map((p) => {
      const st = projectStats(db, p);
      return { id: p.id, name: p.name, customer: db.contacts.find((c) => c.id === p.customerId)?.displayName, hours: st.loggedHours, budgetHours: st.budgetHours || undefined, unbilledHours: st.unbilledHours, unbilled: st.unbilledAmount, billed: st.billedAmount };
    });

  return {
    receivables,
    payables,
    cashFlow: { range: cashRange, opening: round2(opening), incoming, outgoing, closing: round2(opening + incoming - outgoing), series: cashSeries },
    incomeExpense: { range: ieRange, basis, totalIncome: sum(ieSeries.map((s) => s.income)), totalExpense: sum(ieSeries.map((s) => s.expense)), series: ieSeries },
    topExpenses: { range: exRange, items: topExpenses },
    banks,
    projects,
  };
}

export function accountBalance(db: Database, accountId: string, upTo?: string) {
  const acc = db.accounts.find((a) => a.id === accountId);
  let bal = 0;
  for (const j of db.journals) {
    if (upTo && j.date > upTo) continue;
    for (const l of j.lines) if (l.accountId === accountId) bal += signed(acc, l.debit, l.credit);
  }
  return round2(bal);
}

// --------------------------------------------------------------- contacts

export function contactTransactions(c: Contact) {
  const db = getDb();
  const docs = db.docs.filter((d) => d.contactId === c.id || (c.kind === 'customer' && d.lineItems.some((l) => l.customerId === c.id)));
  const pick = (kind: string) => docs.filter((d) => d.kind === kind);
  const base = {
    invoices: pick('invoice'),
    quotes: pick('quote'),
    salesOrders: pick('sales_order'),
    deliveryChallans: pick('delivery_challan'),
    recurringInvoices: pick('recurring_invoice'),
    creditNotes: pick('credit_note'),
    bills: pick('bill'),
    purchaseOrders: pick('purchase_order'),
    recurringBills: pick('recurring_bill'),
    vendorCredits: pick('vendor_credit'),
    customerPayments: db.paymentsReceived.filter((p) => p.contactId === c.id),
    billPayments: db.paymentsMade.filter((p) => p.contactId === c.id),
    expenses: db.expenses.filter((e) => e.vendorId === c.id || e.customerId === c.id),
    recurringExpenses: db.recurringExpenses.filter((e) => e.vendorId === c.id || e.customerId === c.id),
    projects: db.projects.filter((p) => p.customerId === c.id),
    journals: db.journals.filter((j) => j.contactId === c.id || j.lines.some((l) => l.contactId === c.id)),
  };
  return base;
}

export function contactIncome(c: Contact, period: PeriodKey = 'last_6_months', basis: 'accrual' | 'cash' = 'accrual') {
  const db = getDb();
  const r = periodRange(period, today(), db.organization.fiscalYearStartMonth);
  const months = monthsIn(r).map((m) => ({ month: m.label, key: m.key, amount: 0 }));
  if (c.kind === 'customer') {
    if (basis === 'accrual') {
      for (const d of db.docs) if (d.contactId === c.id && d.kind === 'invoice' && d.status !== 'void' && !isUnposted(d.status)) {
        const b = months.find((m) => d.date.startsWith(m.key));
        if (b) b.amount += d.subTotal - d.discountAmount;
      }
    } else {
      for (const p of db.paymentsReceived) if (p.contactId === c.id && p.status === 'paid') {
        const b = months.find((m) => p.date.startsWith(m.key));
        if (b) b.amount += p.amount;
      }
    }
  } else {
    for (const d of db.docs) if (d.contactId === c.id && d.kind === 'bill' && d.status !== 'void' && !isUnposted(d.status) && basis === 'accrual') {
      const b = months.find((m) => d.date.startsWith(m.key));
      if (b) b.amount += d.total;
    }
    for (const p of db.paymentsMade) if (p.contactId === c.id && p.status === 'paid' && basis === 'cash') {
      const b = months.find((m) => p.date.startsWith(m.key));
      if (b) b.amount += p.amount;
    }
    for (const e of db.expenses) if (e.vendorId === c.id) {
      const b = months.find((m) => e.date.startsWith(m.key));
      if (b) b.amount += e.amount;
    }
  }
  const series = months.map((m) => ({ month: m.month, amount: round2(m.amount) }));
  return { range: r, basis, total: sum(series.map((s) => s.amount)), series };
}

/** Statement of accounts (customer or vendor) for a date range. */
export function statement(c: Contact, from: string, to: string, filter: 'all' | 'outstanding' = 'all') {
  const db = getDb();
  const rows: { date: string; type: string; number: string; details: string; amount: number; payment: number; docId?: string }[] = [];
  const isCus = c.kind === 'customer';
  const before = (d: string) => d < from;
  let opening = 0;
  const add = (date: string, type: string, number: string, details: string, amount: number, payment: number, docId?: string) => {
    if (before(date)) opening += amount - payment;
    else if (date <= to) rows.push({ date, type, number, details, amount: round2(amount), payment: round2(payment), docId });
  };
  if (c.openingBalance) add(db.organization.migrationDate || '2026-04-01', 'Opening Balance', '', 'Opening balance', c.openingBalance, 0);
  for (const d of db.docs) {
    if (d.contactId !== c.id || (d.status === 'void' || isUnposted(d.status))) continue;
    if (filter === 'outstanding' && d.balance <= 0) continue;
    if (isCus && d.kind === 'invoice') add(d.date, 'Invoice', d.number, `Due on ${d.dueDate ?? d.date}`, d.total, 0, d.id);
    if (isCus && d.kind === 'credit_note') add(d.date, 'Credit Note', d.number, '', 0, d.total, d.id);
    if (!isCus && d.kind === 'bill') add(d.date, 'Bill', d.number, `Due on ${d.dueDate ?? d.date}`, d.total, 0, d.id);
    if (!isCus && d.kind === 'vendor_credit') add(d.date, 'Debit Note', d.number, '', 0, d.total, d.id);
    for (const r of d.refunds) add(r.date, 'Refund', d.number, `Refund of credit ${d.number}`, r.amount, 0, d.id);
    if (d.writeOff) add(d.writeOff.date, 'Write Off', d.number, 'Invoice written off', 0, d.writeOff.amount, d.id);
  }
  if (filter === 'all') {
    if (isCus)
      for (const p of db.paymentsReceived) {
        if (p.contactId !== c.id || p.status !== 'paid') continue;
        add(p.date, 'Client Payment', p.number, `${p.mode}${p.referenceNumber ? ` (${p.referenceNumber})` : ''}`, 0, p.amount + (p.tdsDeducted ? p.tdsAmount : 0), p.id);
        for (const r of p.refunds) add(r.date, 'Payment Refund', p.number, 'Refund', r.amount, 0, p.id);
      }
    else for (const p of db.paymentsMade) if (p.contactId === c.id && p.status === 'paid') add(p.date, 'Supplier Payment', p.number, p.mode, 0, p.amount, p.id);
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  let bal = round2(opening);
  const withBal = rows.map((r) => {
    bal = round2(bal + r.amount - r.payment);
    return { ...r, balance: bal };
  });
  const invoiced = sum(rows.map((r) => r.amount));
  const paid = sum(rows.map((r) => r.payment));
  return { contact: { id: c.id, displayName: c.displayName, billingAddress: c.billingAddress, email: c.email }, from, to, opening: round2(opening), invoiced, paid, closing: bal, rows: withBal, summary: contactSummary(c) };
}

// --------------------------------------------------------------- financial reports

function balancesBy(db: Database, r: { from?: string; to: string }, basis: Basis = 'accrual') {
  const out = new Map<string, { debit: number; credit: number }>();
  for (const j of ledger(db, basis)) {
    if (j.date > r.to || (r.from && j.date < r.from)) continue;
    for (const l of j.lines) {
      const cur = out.get(l.accountId) || { debit: 0, credit: 0 };
      cur.debit += l.debit;
      cur.credit += l.credit;
      out.set(l.accountId, cur);
    }
  }
  return out;
}

export function profitAndLoss(from: string, to: string, basis: Basis = 'accrual') {
  const db = getDb();
  const b = balancesBy(db, { from, to }, basis);
  const section = (pred: (a: Account) => boolean, normal: 'credit' | 'debit') =>
    db.accounts
      .filter(pred)
      .map((a) => {
        const v = b.get(a.id) || { debit: 0, credit: 0 };
        return { accountId: a.id, name: a.name, amount: round2(normal === 'credit' ? v.credit - v.debit : v.debit - v.credit) };
      })
      .filter((x) => Math.abs(x.amount) > 0.004);
  const operatingIncome = section((a) => a.subType === 'income', 'credit');
  const cogs = section((a) => a.subType === 'cost_of_goods_sold', 'debit');
  const operatingExpense = section((a) => a.subType === 'expense', 'debit');
  const otherIncome = section((a) => a.subType === 'other_income', 'credit');
  const otherExpense = section((a) => a.subType === 'other_expense', 'debit');
  const t = (xs: { amount: number }[]) => sum(xs.map((x) => x.amount));
  const grossProfit = round2(t(operatingIncome) - t(cogs));
  const operatingProfit = round2(grossProfit - t(operatingExpense));
  const netProfit = round2(operatingProfit + t(otherIncome) - t(otherExpense));
  return { from, to, operatingIncome, cogs, grossProfit, operatingExpense, operatingProfit, otherIncome, otherExpense, netProfit };
}

export function balanceSheet(asOf: string, basis: Basis = 'accrual') {
  const db = getDb();
  const b = balancesBy(db, { to: asOf }, basis);
  const rows = (type: Account['type']) =>
    db.accounts
      .filter((a) => a.type === type)
      .map((a) => {
        const v = b.get(a.id) || { debit: 0, credit: 0 };
        return { accountId: a.id, name: a.name, subType: a.subType, amount: round2(signed(a, v.debit, v.credit)) };
      })
      .filter((x) => Math.abs(x.amount) > 0.004);
  const pl = profitAndLoss('1900-01-01', asOf, basis);
  const assets = rows('asset');
  const liabilities = rows('liability');
  const equity = rows('equity');
  equity.push({ accountId: 'current_earnings', name: 'Current Year Earnings', subType: 'equity', amount: pl.netProfit });
  const t = (xs: { amount: number }[]) => sum(xs.map((x) => x.amount));
  return { asOf, assets, liabilities, equity, totalAssets: t(assets), totalLiabilities: t(liabilities), totalEquity: t(equity), totalLiabilitiesAndEquity: round2(t(liabilities) + t(equity)) };
}

export function trialBalance(asOf: string, basis: Basis = 'accrual') {
  const db = getDb();
  const b = balancesBy(db, { to: asOf }, basis);
  const rows = db.accounts
    .map((a) => {
      const v = b.get(a.id) || { debit: 0, credit: 0 };
      const net = round2(v.debit - v.credit);
      return { accountId: a.id, code: a.code, name: a.name, type: a.type, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
    })
    .filter((r) => r.debit || r.credit);
  return { asOf, rows, totalDebit: sum(rows.map((r) => r.debit)), totalCredit: sum(rows.map((r) => r.credit)) };
}

export function generalLedger(from: string, to: string, accountId?: string) {
  const db = getDb();
  const accs = accountMap(db);
  const ids = accountId ? [accountId] : db.accounts.map((a) => a.id);
  const out = ids
    .map((id) => {
      const acc = accs.get(id)!;
      const opening = round2(db.journals.filter((j) => j.date < from).flatMap((j) => j.lines).filter((l) => l.accountId === id).reduce((s, l) => s + signed(acc, l.debit, l.credit), 0));
      let bal = opening;
      const entries = db.journals
        .filter((j) => j.date >= from && j.date <= to)
        .flatMap((j) => j.lines.filter((l) => l.accountId === id).map((l) => ({ j, l })))
        .map(({ j, l }) => {
          bal = round2(bal + signed(acc, l.debit, l.credit));
          return { date: j.date, journalId: j.id, number: j.number, sourceType: j.sourceType, sourceId: j.sourceId, reference: j.reference, contact: db.contacts.find((c) => c.id === (l.contactId || j.contactId))?.displayName, debit: l.debit, credit: l.credit, balance: bal };
        });
      return { accountId: id, name: acc?.name, code: acc?.code, opening, closing: bal, entries };
    })
    .filter((x) => x.entries.length || x.opening);
  return { from, to, accounts: out };
}

export function agingReport(kind: 'receivables' | 'payables') {
  const db = getDb();
  const docs = kind === 'receivables' ? openInvoices(db) : openBills(db);
  const byContact = new Map<string, typeof docs>();
  for (const d of docs) byContact.set(d.contactId, [...(byContact.get(d.contactId) || []), d]);
  const rows = [...byContact.entries()].map(([cid, ds]) => ({ contactId: cid, name: db.contacts.find((c) => c.id === cid)?.displayName ?? '', ...aging(ds) }));
  return { rows, totals: aging(docs) };
}

export function salesByCustomer(from: string, to: string) {
  const db = getDb();
  const m = new Map<string, { count: number; sales: number }>();
  for (const d of db.docs) if (d.kind === 'invoice' && d.status !== 'void' && !isUnposted(d.status) && d.date >= from && d.date <= to) {
    const cur = m.get(d.contactId) || { count: 0, sales: 0 };
    cur.count++;
    cur.sales += d.subTotal - d.discountAmount;
    m.set(d.contactId, cur);
  }
  return { from, to, rows: [...m.entries()].map(([id, v]) => ({ contactId: id, name: db.contacts.find((c) => c.id === id)?.displayName ?? '', count: v.count, sales: round2(v.sales) })).sort((a, b) => b.sales - a.sales) };
}

export function salesByItem(from: string, to: string) {
  const db = getDb();
  const m = new Map<string, { qty: number; amount: number }>();
  for (const d of db.docs) if (d.kind === 'invoice' && d.status !== 'void' && !isUnposted(d.status) && d.date >= from && d.date <= to)
    for (const l of d.lineItems) {
      const k = l.itemId || l.name;
      const cur = m.get(k) || { qty: 0, amount: 0 };
      cur.qty += l.quantity;
      cur.amount += l.amount;
      m.set(k, cur);
    }
  return { from, to, rows: [...m.entries()].map(([k, v]) => ({ item: db.items.find((i) => i.id === k)?.name ?? k, quantity: round2(v.qty), amount: round2(v.amount), average: round2(v.qty ? v.amount / v.qty : 0) })).sort((a, b) => b.amount - a.amount) };
}

export function expensesByCategory(from: string, to: string) {
  const db = getDb();
  const accs = accountMap(db);
  const m = new Map<string, number>();
  for (const j of db.journals) if (j.date >= from && j.date <= to)
    for (const l of j.lines) if (accs.get(l.accountId)?.type === 'expense') m.set(l.accountId, (m.get(l.accountId) || 0) + l.debit - l.credit);
  return { from, to, rows: [...m.entries()].map(([id, v]) => ({ account: accs.get(id)?.name ?? id, amount: round2(v) })).filter((r) => r.amount).sort((a, b) => b.amount - a.amount) };
}

export function contactBalances(kind: 'customer' | 'vendor') {
  const db = getDb();
  return { rows: db.contacts.filter((c) => c.kind === kind).map((c) => ({ contactId: c.id, name: c.displayName, ...contactSummary(c) })) };
}

export function journalReport(from: string, to: string) {
  const db = getDb();
  return { from, to, journals: db.journals.filter((j: Journal) => j.date >= from && j.date <= to) };
}

export function docTypeLabel(kind: string) {
  return (DOC_META as Record<string, { label: string }>)[kind]?.label ?? kind;
}

export { A };
