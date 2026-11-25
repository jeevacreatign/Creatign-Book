// Report Library: the report catalogue, each report returning one tabular shape the client
// renders, customizes and exports (CSV / XLS / PDF).
import { ACCOUNT_TYPES, accountTypeLabel } from '../shared/accountant';
import { isUnposted } from '../shared/approval';
import { taxRate, INDIAN_STATES } from '../shared/gst';
import { daysBetween, frequencyLabel, periodRange, round2, today, type PeriodKey } from '../shared/format';
import type { Account, Database, Expense, Journal, TxnDoc } from '../shared/types';
import { ledger, type Basis } from './ledger';
import { budgetView, stats as projectStats } from './projects';
import { sourceLabel } from './accountant';

// ------------------------------------------------------------------ shapes

export type ColType = 'text' | 'money' | 'number' | 'date' | 'percent' | 'hours';
export interface Col {
  key: string;
  label: string;
  type?: ColType;
  /** off until the user turns it on in Customize Columns */
  hidden?: boolean;
}
export interface Row {
  c: Record<string, string | number | undefined | null>;
  kind?: 'section' | 'sub' | 'total' | 'grand';
  level?: number;
  link?: string;
}
export interface ReportResult {
  key: string;
  title: string;
  subtitle: string;
  columns: Col[];
  rows: Row[];
  notes?: string[];
}

export type FilterKey = 'period' | 'asOf' | 'basis' | 'customer' | 'vendor' | 'account' | 'item' | 'project' | 'budget' | 'salesperson' | 'status';

interface Ctx {
  db: Database;
  from: string;
  to: string;
  basis: Basis;
  p: Record<string, string | undefined>;
}

export interface ReportDef {
  key: string;
  name: string;
  category: string;
  description: string;
  filters: FilterKey[];
  /** default period when none is chosen */
  period?: PeriodKey;
  run: (ctx: Ctx) => { columns: Col[]; rows: Row[]; notes?: string[]; subtitle?: string };
}

export const CATEGORIES = ['Financial Statements', 'Revenue', 'Receivables', 'Collections', 'Invoice Schedules', 'Payables', 'Spend Analysis', 'GST & Statutory', 'Cash & Bank', 'Projects & Time', 'General Ledger', 'Budgeting', 'Foreign Exchange', 'Audit Trail'];

// ------------------------------------------------------------------ helpers

const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + (Number(b) || 0), 0));
const inR = (d: string | undefined, c: Ctx) => !!d && d >= c.from && d <= c.to;
const name = (db: Database, id?: string) => (id ? db.contacts.find((x) => x.id === id)?.displayName ?? '' : '');
const accName = (db: Database, id?: string) => (id ? db.accounts.find((x) => x.id === id)?.name ?? '' : '');
const posted = (d: TxnDoc) => d.status !== 'void' && !isUnposted(d.status);
const PURCHASE_KINDS = new Set(['bill', 'vendor_credit', 'purchase_order', 'recurring_bill']);
const contactOk = (c: Ctx, d: TxnDoc) => (PURCHASE_KINDS.has(d.kind) ? !c.p.vendor || d.contactId === c.p.vendor : !c.p.customer || d.contactId === c.p.customer);
const docsOf = (c: Ctx, kind: TxnDoc['kind']) => c.db.docs.filter((d) => d.kind === kind && posted(d) && inR(d.date, c) && contactOk(c, d));
const anyDocs = (c: Ctx, kind: TxnDoc['kind']) => c.db.docs.filter((d) => d.kind === kind && inR(d.date, c) && (!c.p.status || c.p.status === 'all' || d.status === c.p.status) && contactOk(c, d));
const netLine = (d: TxnDoc, l: TxnDoc['lineItems'][number]) => (d.taxInclusive && !d.reverseCharge ? round2(l.amount - (l.taxAmount || 0)) : l.amount);
/** Value of the goods / services excluding GST, after the document discount. */
export const taxableValue = (d: TxnDoc) => round2(sum(d.lineItems.map((l) => netLine(d, l))) - d.discountAmount);
const comp = (d: { taxBreakdown?: { component: string; amount: number }[] }, k: string) => sum((d.taxBreakdown ?? []).filter((t) => t.component === k).map((t) => t.amount));
const docLink = (d: TxnDoc) => `${DOC_PATH[d.kind]}/${d.id}`;
const DOC_PATH: Record<string, string> = { invoice: '/sales/invoices', credit_note: '/sales/credit-notes', quote: '/sales/quotes', sales_order: '/sales/sales-orders', delivery_challan: '/sales/delivery-challans', recurring_invoice: '/sales/recurring-invoices', purchase_order: '/purchases/purchase-orders', bill: '/purchases/bills', vendor_credit: '/purchases/vendor-credits', recurring_bill: '/purchases/recurring-bills' };
const label = (s?: string) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
const total = (cols: Record<string, number | string>, kind: Row['kind'] = 'total'): Row => ({ c: cols, kind });

function signedBal(a: Account | undefined, debit: number, credit: number) {
  if (!a) return debit - credit;
  return a.type === 'asset' || a.type === 'expense' ? debit - credit : credit - debit;
}

function balances(c: Ctx, range: { from?: string; to: string }) {
  const out = new Map<string, { debit: number; credit: number }>();
  for (const j of ledger(c.db, c.basis)) {
    if (j.date > range.to || (range.from && j.date < range.from)) continue;
    for (const l of j.lines) {
      const cur = out.get(l.accountId) || { debit: 0, credit: 0 };
      cur.debit += l.debit;
      cur.credit += l.credit;
      out.set(l.accountId, cur);
    }
  }
  return out;
}
const bal = (c: Ctx, b: Map<string, { debit: number; credit: number }>, a: Account) => {
  const v = b.get(a.id) || { debit: 0, credit: 0 };
  return round2(signedBal(a, v.debit, v.credit));
};
const acctLink = (c: Ctx, id: string) => `/reports/account-transactions?accountId=${id}&from=${c.from}&to=${c.to}`;

const subTypes = (...s: string[]) => (a: Account) => s.includes(a.subType);

/** account rows of a section with amounts, skipping zero balances */
function section(c: Ctx, b: Map<string, { debit: number; credit: number }>, pred: (a: Account) => boolean, normal: 'debit' | 'credit' | 'natural' = 'natural') {
  return c.db.accounts
    .filter(pred)
    .map((a) => {
      const v = b.get(a.id) || { debit: 0, credit: 0 };
      const amount = round2(normal === 'natural' ? signedBal(a, v.debit, v.credit) : normal === 'credit' ? v.credit - v.debit : v.debit - v.credit);
      return { a, amount };
    })
    .filter((x) => Math.abs(x.amount) > 0.004);
}

// ------------------------------------------------------------------ financial statements

function pnlParts(c: Ctx, from = c.from, to = c.to) {
  const b = balances(c, { from, to });
  const income = section(c, b, subTypes('income'), 'credit');
  const cogs = section(c, b, subTypes('cost_of_goods_sold'), 'debit');
  const opex = section(c, b, subTypes('expense'), 'debit');
  const otherIncome = section(c, b, subTypes('other_income'), 'credit');
  const otherExpense = section(c, b, subTypes('other_expense'), 'debit');
  const t = (xs: { amount: number }[]) => sum(xs.map((x) => x.amount));
  const gross = round2(t(income) - t(cogs));
  const operating = round2(gross - t(opex));
  const net = round2(operating + t(otherIncome) - t(otherExpense));
  return { income, cogs, opex, otherIncome, otherExpense, gross, operating, net, t };
}

const AMOUNT: Col[] = [
  { key: 'account', label: 'Account' },
  { key: 'code', label: 'Account Code', hidden: true },
  { key: 'amount', label: 'Total', type: 'money' },
];

function accRows(c: Ctx, xs: { a: Account; amount: number }[], level = 1): Row[] {
  return xs.map((x) => ({ c: { account: x.a.name, code: x.a.code, amount: x.amount }, level, link: acctLink(c, x.a.id) }));
}

function profitAndLoss(c: Ctx) {
  const p = pnlParts(c);
  const rows: Row[] = [
    { c: { account: 'Operating Income' }, kind: 'section' },
    ...accRows(c, p.income),
    total({ account: 'Total for Operating Income', amount: p.t(p.income) }, 'sub'),
    { c: { account: 'Cost of Goods Sold' }, kind: 'section' },
    ...accRows(c, p.cogs),
    total({ account: 'Total for Cost of Goods Sold', amount: p.t(p.cogs) }, 'sub'),
    total({ account: 'Gross Profit', amount: p.gross }),
    { c: { account: 'Operating Expense' }, kind: 'section' },
    ...accRows(c, p.opex),
    total({ account: 'Total for Operating Expense', amount: p.t(p.opex) }, 'sub'),
    total({ account: 'Operating Profit', amount: p.operating }),
    { c: { account: 'Non Operating Income' }, kind: 'section' },
    ...accRows(c, p.otherIncome),
    total({ account: 'Total for Non Operating Income', amount: p.t(p.otherIncome) }, 'sub'),
    { c: { account: 'Non Operating Expense' }, kind: 'section' },
    ...accRows(c, p.otherExpense),
    total({ account: 'Total for Non Operating Expense', amount: p.t(p.otherExpense) }, 'sub'),
    total({ account: 'Net Profit/Loss', amount: p.net }, 'grand'),
  ];
  return { columns: AMOUNT, rows };
}

const SCHEDULE_III_EXPENSE: [string, RegExp][] = [
  ['Employee benefits expense', /salar|wage|staff|employee|bonus|provident|gratuity|\besi\b|payroll/i],
  ['Finance costs', /interest|bank charge|finance|loan/i],
  ['Depreciation and amortization expense', /depreciat|amorti/i],
];

function profitAndLossScheduleIII(c: Ctx) {
  const p = pnlParts(c);
  const expenses = [...p.opex, ...p.otherExpense];
  const buckets = new Map<string, { a: Account; amount: number }[]>();
  for (const x of expenses) {
    const k = SCHEDULE_III_EXPENSE.find(([, re]) => re.test(x.a.name))?.[0] ?? 'Other expenses';
    buckets.set(k, [...(buckets.get(k) || []), x]);
  }
  const t = p.t;
  const revenue = t(p.income);
  const other = t(p.otherIncome);
  const totalIncome = round2(revenue + other);
  const totalExpenses = round2(t(p.cogs) + t(expenses));
  const rows: Row[] = [
    { c: { account: 'I. Revenue from operations', amount: revenue }, kind: 'sub' },
    ...accRows(c, p.income, 2),
    { c: { account: 'II. Other income', amount: other }, kind: 'sub' },
    ...accRows(c, p.otherIncome, 2),
    total({ account: 'III. Total Income (I + II)', amount: totalIncome }),
    { c: { account: 'IV. Expenses' }, kind: 'section' },
    { c: { account: 'Cost of materials consumed / Purchases of stock-in-trade', amount: t(p.cogs) }, level: 1 },
    ...accRows(c, p.cogs, 2),
    ...['Employee benefits expense', 'Finance costs', 'Depreciation and amortization expense', 'Other expenses'].flatMap((k) => [{ c: { account: k, amount: t(buckets.get(k) || []) }, level: 1 } as Row, ...accRows(c, buckets.get(k) || [], 2)]),
    total({ account: 'Total expenses (IV)', amount: totalExpenses }, 'sub'),
    total({ account: 'V. Profit before exceptional items and tax (III - IV)', amount: round2(totalIncome - totalExpenses) }),
    { c: { account: 'VI. Exceptional items', amount: 0 }, level: 0 },
    total({ account: 'VII. Profit before tax', amount: round2(totalIncome - totalExpenses) }),
    { c: { account: 'VIII. Tax expense', amount: 0 }, level: 0 },
    total({ account: 'IX. Profit (Loss) for the period', amount: round2(totalIncome - totalExpenses) }, 'grand'),
  ];
  return { columns: AMOUNT, rows, notes: ['Expenses are grouped into Schedule III heads by account name (salaries, interest, depreciation); everything else is shown under Other expenses. Tax expense is not computed.'] };
}

function horizontal(left: { label: string; amount?: number; kind?: Row['kind']; level?: number }[], right: typeof left, leftHead: string, rightHead: string) {
  const n = Math.max(left.length, right.length);
  const rows: Row[] = [];
  for (let i = 0; i < n; i++) {
    const l = left[i];
    const r = right[i];
    const kind = l?.kind === 'grand' || r?.kind === 'grand' ? 'grand' : l?.kind === 'section' || r?.kind === 'section' ? 'section' : l?.kind === 'total' || r?.kind === 'total' ? 'total' : undefined;
    rows.push({ c: { left: l ? `${'  '.repeat(l.level || 0)}${l.label}` : '', leftAmount: l?.amount, right: r ? `${'  '.repeat(r.level || 0)}${r.label}` : '', rightAmount: r?.amount }, kind });
  }
  return { columns: [{ key: 'left', label: leftHead }, { key: 'leftAmount', label: 'Amount', type: 'money' as ColType }, { key: 'right', label: rightHead }, { key: 'rightAmount', label: 'Amount', type: 'money' as ColType }], rows };
}

function horizontalPnl(c: Ctx) {
  const p = pnlParts(c);
  const t = p.t;
  const items = (xs: { a: Account; amount: number }[]) => xs.map((x) => ({ label: x.a.name, amount: x.amount, level: 1 }));
  const left = [{ label: 'Cost of Goods Sold', kind: 'section' as const }, ...items(p.cogs), { label: 'Operating Expense', kind: 'section' as const }, ...items(p.opex), { label: 'Non Operating Expense', kind: 'section' as const }, ...items(p.otherExpense)];
  const right = [{ label: 'Operating Income', kind: 'section' as const }, ...items(p.income), { label: 'Non Operating Income', kind: 'section' as const }, ...items(p.otherIncome)];
  if (p.net >= 0) left.push({ label: 'Net Profit', amount: p.net, kind: 'total' as never });
  else right.push({ label: 'Net Loss', amount: -p.net, kind: 'total' as never });
  const L = round2(t(p.cogs) + t(p.opex) + t(p.otherExpense) + Math.max(p.net, 0));
  const R = round2(t(p.income) + t(p.otherIncome) + Math.max(-p.net, 0));
  const n = Math.max(left.length, right.length);
  while (left.length < n) left.push({ label: '' } as never);
  while (right.length < n) right.push({ label: '' } as never);
  left.push({ label: 'Total', amount: L, kind: 'grand' as never });
  right.push({ label: 'Total', amount: R, kind: 'grand' as never });
  return horizontal(left, right, 'Expenses', 'Income');
}

function bsParts(c: Ctx) {
  const b = balances(c, { to: c.to });
  const earnings = pnlParts(c, '1900-01-01', c.to).net;
  const groups = {
    cash: section(c, b, subTypes('cash')),
    bank: section(c, b, subTypes('bank', 'payment_clearing')),
    ar: section(c, b, subTypes('accounts_receivable')),
    stock: section(c, b, subTypes('stock')),
    otherCurrent: section(c, b, subTypes('other_current_asset', 'input_tax')),
    fixed: section(c, b, subTypes('fixed_asset')),
    otherAsset: section(c, b, subTypes('other_asset')),
    ap: section(c, b, subTypes('accounts_payable')),
    card: section(c, b, subTypes('credit_card')),
    currentLiab: section(c, b, subTypes('other_current_liability', 'output_tax', 'overseas_tax_payable')),
    longTerm: section(c, b, subTypes('long_term_liability')),
    otherLiab: section(c, b, subTypes('other_liability')),
    equity: section(c, b, subTypes('equity')),
  };
  return { ...groups, earnings };
}

function balanceSheet(c: Ctx) {
  const g = bsParts(c);
  const t = (xs: { amount: number }[]) => sum(xs.map((x) => x.amount));
  const block = (title: string, xs: { a: Account; amount: number }[], level = 1): Row[] => (xs.length ? [{ c: { account: title }, kind: 'section', level }, ...accRows(c, xs, level + 1), total({ account: `Total for ${title}`, amount: t(xs) }, 'sub')] : []);
  const currentAssets = [...g.cash, ...g.bank, ...g.ar, ...g.stock, ...g.otherCurrent];
  const assets = [...currentAssets, ...g.fixed, ...g.otherAsset];
  const currentLiab = [...g.ap, ...g.card, ...g.currentLiab];
  const liab = [...currentLiab, ...g.longTerm, ...g.otherLiab];
  const equityTotal = round2(t(g.equity) + g.earnings);
  const rows: Row[] = [
    { c: { account: 'Assets' }, kind: 'section' },
    { c: { account: 'Current Assets' }, kind: 'section', level: 1 },
    ...block('Cash', g.cash, 2),
    ...block('Bank', g.bank, 2),
    ...block('Accounts Receivable', g.ar, 2),
    ...block('Stock', g.stock, 2),
    ...block('Other current assets', g.otherCurrent, 2),
    total({ account: 'Total for Current Assets', amount: t(currentAssets) }, 'sub'),
    ...block('Fixed Assets', g.fixed),
    ...block('Other Assets', g.otherAsset),
    total({ account: 'Total for Assets', amount: t(assets) }),
    { c: { account: 'Liabilities & Equities' }, kind: 'section' },
    { c: { account: 'Liabilities' }, kind: 'section', level: 1 },
    { c: { account: 'Current Liabilities' }, kind: 'section', level: 2 },
    ...accRows(c, currentLiab, 3),
    total({ account: 'Total for Current Liabilities', amount: t(currentLiab) }, 'sub'),
    ...block('Long Term Liabilities', g.longTerm, 2),
    ...block('Other Liabilities', g.otherLiab, 2),
    total({ account: 'Total for Liabilities', amount: t(liab) }, 'sub'),
    { c: { account: 'Equities' }, kind: 'section', level: 1 },
    ...accRows(c, g.equity, 2),
    { c: { account: 'Current Year Earnings', amount: g.earnings }, level: 2 },
    total({ account: 'Total for Equities', amount: equityTotal }, 'sub'),
    total({ account: 'Total for Liabilities & Equities', amount: round2(t(liab) + equityTotal) }, 'grand'),
  ];
  return { columns: AMOUNT, rows, subtitle: `As of ${fmt(c.to)}` };
}

function horizontalBalanceSheet(c: Ctx) {
  const g = bsParts(c);
  const t = (xs: { amount: number }[]) => sum(xs.map((x) => x.amount));
  const items = (xs: { a: Account; amount: number }[]) => xs.map((x) => ({ label: x.a.name, amount: x.amount, level: 1 }));
  const left: { label: string; amount?: number; kind?: Row['kind']; level?: number }[] = [
    { label: 'Equities', kind: 'section' },
    ...items(g.equity),
    { label: 'Current Year Earnings', amount: g.earnings, level: 1 },
    { label: 'Liabilities', kind: 'section' },
    ...items([...g.ap, ...g.card, ...g.currentLiab, ...g.longTerm, ...g.otherLiab]),
  ];
  const right: typeof left = [{ label: 'Assets', kind: 'section' }, ...items([...g.cash, ...g.bank, ...g.ar, ...g.stock, ...g.otherCurrent, ...g.fixed, ...g.otherAsset])];
  const L = round2(t(g.equity) + g.earnings + t([...g.ap, ...g.card, ...g.currentLiab, ...g.longTerm, ...g.otherLiab]));
  const R = t([...g.cash, ...g.bank, ...g.ar, ...g.stock, ...g.otherCurrent, ...g.fixed, ...g.otherAsset]);
  const n = Math.max(left.length, right.length);
  while (left.length < n) left.push({ label: '' });
  while (right.length < n) right.push({ label: '' });
  left.push({ label: 'Total', amount: L, kind: 'grand' });
  right.push({ label: 'Total', amount: R, kind: 'grand' });
  return { ...horizontal(left, right, 'Liabilities & Equities', 'Assets'), subtitle: `As of ${fmt(c.to)}` };
}

function balanceSheetScheduleIII(c: Ctx) {
  const g = bsParts(c);
  const t = (xs: { amount: number }[]) => sum(xs.map((x) => x.amount));
  const line = (label: string, xs: { a: Account; amount: number }[], level = 2, extra = 0): Row[] => [{ c: { account: label, amount: round2(t(xs) + extra) }, level }, ...accRows(c, xs, level + 1)];
  const shareholders = round2(t(g.equity) + g.earnings);
  const nonCurrentLiab = t([...g.longTerm, ...g.otherLiab]);
  const currentLiab = t([...g.ap, ...g.card, ...g.currentLiab]);
  const nonCurrentAssets = t([...g.fixed, ...g.otherAsset]);
  const currentAssets = t([...g.stock, ...g.ar, ...g.cash, ...g.bank, ...g.otherCurrent]);
  const rows: Row[] = [
    { c: { account: 'I. EQUITY AND LIABILITIES' }, kind: 'section' },
    { c: { account: "(1) Shareholders' funds", amount: shareholders }, kind: 'sub', level: 1 },
    ...line('(a) Share capital and Reserves and surplus', g.equity),
    { c: { account: '(b) Surplus (current year earnings)', amount: g.earnings }, level: 2 },
    { c: { account: '(2) Non-current liabilities', amount: nonCurrentLiab }, kind: 'sub', level: 1 },
    ...line('(a) Long-term borrowings', g.longTerm),
    ...line('(b) Other long-term liabilities', g.otherLiab),
    { c: { account: '(3) Current liabilities', amount: currentLiab }, kind: 'sub', level: 1 },
    ...line('(a) Trade payables', g.ap),
    ...line('(b) Other current liabilities', [...g.card, ...g.currentLiab]),
    total({ account: 'TOTAL', amount: round2(shareholders + nonCurrentLiab + currentLiab) }),
    { c: { account: 'II. ASSETS' }, kind: 'section' },
    { c: { account: '(1) Non-current assets', amount: nonCurrentAssets }, kind: 'sub', level: 1 },
    ...line('(a) Property, Plant and Equipment', g.fixed),
    ...line('(b) Other non-current assets', g.otherAsset),
    { c: { account: '(2) Current assets', amount: currentAssets }, kind: 'sub', level: 1 },
    ...line('(a) Inventories', g.stock),
    ...line('(b) Trade receivables', g.ar),
    ...line('(c) Cash and cash equivalents', [...g.cash, ...g.bank]),
    ...line('(d) Other current assets', g.otherCurrent),
    total({ account: 'TOTAL', amount: round2(nonCurrentAssets + currentAssets) }, 'grand'),
  ];
  return { columns: AMOUNT, rows, subtitle: `As of ${fmt(c.to)}` };
}

const OPERATING = ['accounts_receivable', 'other_current_asset', 'stock', 'input_tax', 'payment_clearing', 'accounts_payable', 'other_current_liability', 'credit_card', 'output_tax', 'overseas_tax_payable'];
const INVESTING = ['fixed_asset', 'other_asset'];
const FINANCING = ['equity', 'long_term_liability', 'other_liability'];

function cashFlow(c: Ctx) {
  const p = pnlParts(c);
  const b = balances(c, { from: c.from, to: c.to });
  // cash impact of the change in a balance sheet account: assets up = cash out; liabilities/equity up = cash in
  const change = (subs: string[]) =>
    c.db.accounts
      .filter((a) => subs.includes(a.subType))
      .map((a) => {
        const v = b.get(a.id) || { debit: 0, credit: 0 };
        return { a, amount: round2(v.credit - v.debit) };
      })
      .filter((x) => Math.abs(x.amount) > 0.004);
  const op = change(OPERATING);
  const inv = change(INVESTING);
  const fin = change(FINANCING);
  const t = (xs: { amount: number }[]) => sum(xs.map((x) => x.amount));
  const cashAcc = c.db.accounts.filter((a) => a.subType === 'cash' || a.subType === 'bank');
  const before = balances(c, { to: prevDay(c.from) });
  const opening = sum(cashAcc.map((a) => bal(c, before, a)));
  const netOp = round2(p.net + t(op));
  const net = round2(netOp + t(inv) + t(fin));
  const rows: Row[] = [
    { c: { account: 'Beginning Cash Balance', amount: opening }, kind: 'sub' },
    { c: { account: 'Cash Flow from Operating Activities' }, kind: 'section' },
    { c: { account: 'Net Income', amount: p.net }, level: 1 },
    ...accRows(c, op, 1),
    total({ account: 'Net cash provided by Operating Activities', amount: netOp }, 'sub'),
    { c: { account: 'Cash Flow from Investing Activities' }, kind: 'section' },
    ...accRows(c, inv, 1),
    total({ account: 'Net cash provided by Investing Activities', amount: t(inv) }, 'sub'),
    { c: { account: 'Cash Flow from Financing Activities' }, kind: 'section' },
    ...accRows(c, fin, 1),
    total({ account: 'Net cash provided by Financing Activities', amount: t(fin) }, 'sub'),
    total({ account: 'Net Change in Cash', amount: net }),
    total({ account: 'Ending Cash Balance', amount: round2(opening + net) }, 'grand'),
  ];
  return { columns: AMOUNT, rows, notes: ['Indirect method. Cash means Cash and Bank accounts; credit cards are treated as short-term liabilities in operating activities.'] };
}

function ratios(c: Ctx) {
  const g = bsParts(c);
  const p = pnlParts(c);
  const t = (xs: { amount: number }[]) => sum(xs.map((x) => x.amount));
  const ca = t([...g.cash, ...g.bank, ...g.ar, ...g.stock, ...g.otherCurrent]);
  const cl = t([...g.ap, ...g.card, ...g.currentLiab]);
  const quick = round2(ca - t(g.stock));
  const equity = round2(t(g.equity) + g.earnings);
  const debt = t([...g.longTerm, ...g.otherLiab]);
  const assets = t([...g.cash, ...g.bank, ...g.ar, ...g.stock, ...g.otherCurrent, ...g.fixed, ...g.otherAsset]);
  const sales = p.t(p.income);
  const purchases = round2(p.t(p.cogs) + p.t(p.opex));
  const days = Math.max(1, daysBetween(c.from, c.to) + 1);
  const r = (a: number, b: number) => (b ? round2(a / b) : null);
  const pc = (a: number, b: number) => (b ? round2((a / b) * 100) : null);
  const rows: Row[] = [
    { c: { ratio: 'Liquidity' }, kind: 'section' },
    { c: { ratio: 'Current Ratio', value: r(ca, cl), formula: 'Current Assets / Current Liabilities' }, level: 1 },
    { c: { ratio: 'Quick Ratio', value: r(quick, cl), formula: '(Current Assets - Stock) / Current Liabilities' }, level: 1 },
    { c: { ratio: 'Working Capital (₹)', value: round2(ca - cl), formula: 'Current Assets - Current Liabilities' }, level: 1 },
    { c: { ratio: 'Solvency' }, kind: 'section' },
    { c: { ratio: 'Debt to Equity', value: r(debt, equity), formula: 'Long Term Liabilities / Equity' }, level: 1 },
    { c: { ratio: 'Equity Ratio', value: r(equity, assets), formula: 'Equity / Total Assets' }, level: 1 },
    { c: { ratio: 'Profitability' }, kind: 'section' },
    { c: { ratio: 'Gross Profit Margin (%)', value: pc(p.gross, sales), formula: 'Gross Profit / Sales' }, level: 1 },
    { c: { ratio: 'Operating Profit Margin (%)', value: pc(p.operating, sales), formula: 'Operating Profit / Sales' }, level: 1 },
    { c: { ratio: 'Net Profit Margin (%)', value: pc(p.net, sales), formula: 'Net Profit / Sales' }, level: 1 },
    { c: { ratio: 'Return on Equity (%)', value: pc(p.net, equity), formula: 'Net Profit / Equity' }, level: 1 },
    { c: { ratio: 'Return on Assets (%)', value: pc(p.net, assets), formula: 'Net Profit / Total Assets' }, level: 1 },
    { c: { ratio: 'Efficiency' }, kind: 'section' },
    { c: { ratio: 'Debtor Days', value: sales ? Math.round((t(g.ar) / sales) * days) : null, formula: 'Receivables / Sales x Days in period' }, level: 1 },
    { c: { ratio: 'Creditor Days', value: purchases ? Math.round((t(g.ap) / purchases) * days) : null, formula: 'Payables / (COGS + Expenses) x Days in period' }, level: 1 },
  ];
  return { columns: [{ key: 'ratio', label: 'Ratio' }, { key: 'value', label: 'Value', type: 'number' as ColType }, { key: 'formula', label: 'Formula' }], rows };
}

function movementOfEquity(c: Ctx) {
  const before = balances(c, { to: prevDay(c.from) });
  const during = balances(c, { from: c.from, to: c.to });
  const eq = c.db.accounts.filter((a) => a.type === 'equity');
  const rows: Row[] = eq
    .map((a) => {
      const v = during.get(a.id) || { debit: 0, credit: 0 };
      const opening = bal(c, before, a);
      return { c: { account: a.name, opening, added: round2(v.credit), deducted: round2(v.debit), closing: round2(opening + v.credit - v.debit) }, link: acctLink(c, a.id) };
    })
    .filter((r) => r.c.opening || r.c.added || r.c.deducted);
  const prior = pnlParts(c, '1900-01-01', prevDay(c.from)).net;
  const cur = pnlParts(c).net;
  rows.push({ c: { account: 'Current Year Earnings', opening: prior, added: cur > 0 ? cur : 0, deducted: cur < 0 ? -cur : 0, closing: round2(prior + cur) } });
  const t = (k: string) => sum(rows.map((r) => Number(r.c[k]) || 0));
  rows.push(total({ account: 'Total', opening: t('opening'), added: t('added'), deducted: t('deducted'), closing: t('closing') }, 'grand'));
  return { columns: [{ key: 'account', label: 'Account' }, { key: 'opening', label: 'Opening Balance', type: 'money' as ColType }, { key: 'added', label: 'Additions', type: 'money' as ColType }, { key: 'deducted', label: 'Deductions', type: 'money' as ColType }, { key: 'closing', label: 'Closing Balance', type: 'money' as ColType }], rows };
}

// ------------------------------------------------------------------ sales

function salesByCustomer(c: Ctx) {
  const m = new Map<string, { n: number; sales: number; withTax: number }>();
  for (const d of docsOf(c, 'invoice')) {
    const x = m.get(d.contactId) || { n: 0, sales: 0, withTax: 0 };
    x.n++;
    x.sales += taxableValue(d);
    x.withTax += d.total;
    m.set(d.contactId, x);
  }
  for (const d of docsOf(c, 'credit_note')) {
    const x = m.get(d.contactId) || { n: 0, sales: 0, withTax: 0 };
    x.sales -= taxableValue(d);
    x.withTax -= d.total;
    m.set(d.contactId, x);
  }
  const rows: Row[] = [...m.entries()].map(([id, v]) => ({ c: { name: name(c.db, id), count: v.n, sales: round2(v.sales), withTax: round2(v.withTax) }, link: `/sales/customers/${id}` })).sort((a, b) => Number(b.c.sales) - Number(a.c.sales));
  rows.push(total({ name: 'Total', count: sum(rows.map((r) => Number(r.c.count))), sales: sum(rows.map((r) => Number(r.c.sales))), withTax: sum(rows.map((r) => Number(r.c.withTax))) }));
  return { columns: [{ key: 'name', label: 'Client Name' }, { key: 'count', label: 'Invoice Count', type: 'number' as ColType }, { key: 'sales', label: 'Sales', type: 'money' as ColType }, { key: 'withTax', label: 'Sales With Tax', type: 'money' as ColType }], rows, notes: ['Sales are net of discounts and credit notes, excluding GST.'] };
}

function itemTotals(c: Ctx, kinds: TxnDoc['kind'][], minus: TxnDoc['kind'][] = []) {
  const m = new Map<string, { qty: number; amount: number }>();
  const add = (d: TxnDoc, sign: number) => {
    const disc = d.subTotal ? 1 - d.discountAmount / d.subTotal : 1;
    for (const l of d.lineItems) {
      if (c.p.item && l.itemId !== c.p.item) continue;
      const k = l.itemId || `name:${l.name}`;
      const x = m.get(k) || { qty: 0, amount: 0 };
      x.qty += sign * l.quantity;
      x.amount += sign * netLine(d, l) * disc;
      m.set(k, x);
    }
  };
  for (const k of kinds) for (const d of docsOf(c, k)) add(d, 1);
  for (const k of minus) for (const d of docsOf(c, k)) add(d, -1);
  return [...m.entries()].map(([k, v]) => ({ id: k.startsWith('name:') ? undefined : k, item: k.startsWith('name:') ? k.slice(5) : c.db.items.find((i) => i.id === k)?.name ?? k, sku: c.db.items.find((i) => i.id === k)?.sku, qty: round2(v.qty), amount: round2(v.amount), avg: round2(v.qty ? v.amount / v.qty : 0) }));
}

function salesByItem(c: Ctx) {
  const rows: Row[] = itemTotals(c, ['invoice'], ['credit_note'])
    .sort((a, b) => b.amount - a.amount)
    .map((x) => ({ c: { item: x.item, sku: x.sku, qty: x.qty, amount: x.amount, avg: x.avg }, link: x.id ? `/items/${x.id}` : undefined }));
  rows.push(total({ item: 'Total', qty: sum(rows.map((r) => Number(r.c.qty))), amount: sum(rows.map((r) => Number(r.c.amount))) }));
  return { columns: [{ key: 'item', label: 'Item Name' }, { key: 'sku', label: 'SKU', hidden: true }, { key: 'qty', label: 'Quantity Sold', type: 'number' as ColType }, { key: 'amount', label: 'Amount', type: 'money' as ColType }, { key: 'avg', label: 'Average Price', type: 'money' as ColType }], rows };
}

function salesBySalesperson(c: Ctx) {
  const m = new Map<string, { n: number; sales: number; withTax: number; cn: number }>();
  for (const d of docsOf(c, 'invoice')) {
    const k = d.salesperson || 'Others';
    const x = m.get(k) || { n: 0, sales: 0, withTax: 0, cn: 0 };
    x.n++;
    x.sales += taxableValue(d);
    x.withTax += d.total;
    m.set(k, x);
  }
  for (const d of docsOf(c, 'credit_note')) {
    const k = d.salesperson || 'Others';
    const x = m.get(k) || { n: 0, sales: 0, withTax: 0, cn: 0 };
    x.cn += d.total;
    m.set(k, x);
  }
  const rows: Row[] = [...m.entries()].map(([k, v]) => ({ c: { name: k, count: v.n, sales: round2(v.sales), withTax: round2(v.withTax), cn: round2(v.cn), total: round2(v.withTax - v.cn) } }));
  rows.push(total({ name: 'Total', count: sum(rows.map((r) => Number(r.c.count))), sales: sum(rows.map((r) => Number(r.c.sales))), withTax: sum(rows.map((r) => Number(r.c.withTax))), cn: sum(rows.map((r) => Number(r.c.cn))), total: sum(rows.map((r) => Number(r.c.total))) }));
  return { columns: [{ key: 'name', label: 'Sales Person' }, { key: 'count', label: 'Invoice Count', type: 'number' as ColType }, { key: 'sales', label: 'Invoice Sales', type: 'money' as ColType }, { key: 'withTax', label: 'Invoice Sales With Tax', type: 'money' as ColType }, { key: 'cn', label: 'Credit Note Total', type: 'money' as ColType }, { key: 'total', label: 'Total Sales With Tax', type: 'money' as ColType }], rows };
}

function salesSummary(c: Ctx) {
  const m = new Map<string, { n: number; sales: number; tax: number; withTax: number }>();
  for (const d of docsOf(c, 'invoice')) {
    const k = d.date.slice(0, 7);
    const x = m.get(k) || { n: 0, sales: 0, tax: 0, withTax: 0 };
    x.n++;
    x.sales += taxableValue(d);
    x.tax += d.taxAmount || 0;
    x.withTax += d.total;
    m.set(k, x);
  }
  const rows: Row[] = [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => ({ c: { month: monthLabel(k), count: v.n, sales: round2(v.sales), tax: round2(v.tax), withTax: round2(v.withTax) } }));
  rows.push(total({ month: 'Total', count: sum(rows.map((r) => Number(r.c.count))), sales: sum(rows.map((r) => Number(r.c.sales))), tax: sum(rows.map((r) => Number(r.c.tax))), withTax: sum(rows.map((r) => Number(r.c.withTax))) }));
  return { columns: [{ key: 'month', label: 'Month' }, { key: 'count', label: 'Invoice Count', type: 'number' as ColType }, { key: 'sales', label: 'Sales', type: 'money' as ColType }, { key: 'tax', label: 'Tax', type: 'money' as ColType }, { key: 'withTax', label: 'Total Sales', type: 'money' as ColType }], rows };
}

// ------------------------------------------------------------------ receivables / payables

const BUCKETS = [
  { key: 'current', label: 'Current', test: (d: number) => d <= 0 },
  { key: 'b1', label: '1 - 15 Days', test: (d: number) => d >= 1 && d <= 15 },
  { key: 'b2', label: '16 - 30 Days', test: (d: number) => d >= 16 && d <= 30 },
  { key: 'b3', label: '31 - 45 Days', test: (d: number) => d >= 31 && d <= 45 },
  { key: 'b4', label: '> 45 Days', test: (d: number) => d > 45 },
];

function openAsOf(c: Ctx, kind: 'invoice' | 'bill') {
  const contact = kind === 'invoice' ? c.p.customer : c.p.vendor;
  return c.db.docs.filter((d) => d.kind === kind && posted(d) && d.date <= c.to && d.balance > 0.004 && (!contact || d.contactId === contact));
}

function agingSummary(c: Ctx, kind: 'invoice' | 'bill') {
  const m = new Map<string, Record<string, number>>();
  for (const d of openAsOf(c, kind)) {
    const late = daysBetween(d.dueDate || d.date, c.to);
    const b = BUCKETS.find((x) => x.test(late))!.key;
    const x = m.get(d.contactId) || {};
    x[b] = (x[b] || 0) + d.balance;
    x.total = (x.total || 0) + d.balance;
    m.set(d.contactId, x);
  }
  const rows: Row[] = [...m.entries()].map(([id, v]): Row => ({ c: { name: name(c.db, id), ...Object.fromEntries(Object.entries(v).map(([k, n]) => [k, round2(n)])) }, link: `${kind === 'invoice' ? '/sales/customers' : '/purchases/vendors'}/${id}` })).sort((a, b) => Number(b.c.total) - Number(a.c.total));
  const tot: Record<string, number | string> = { name: 'Total' };
  for (const k of [...BUCKETS.map((b) => b.key), 'total']) tot[k] = sum(rows.map((r) => Number(r.c[k]) || 0));
  rows.push(total(tot));
  return { columns: [{ key: 'name', label: kind === 'invoice' ? 'Client Name' : 'Supplier Name' }, ...BUCKETS.map((b) => ({ key: b.key, label: b.label, type: 'money' as ColType })), { key: 'total', label: 'Total', type: 'money' as ColType }], rows, subtitle: `As of ${fmt(c.to)}` };
}

function agingDetails(c: Ctx, kind: 'invoice' | 'bill') {
  const rows: Row[] = [];
  const docs = openAsOf(c, kind).map((d) => ({ d, late: daysBetween(d.dueDate || d.date, c.to) }));
  for (const b of BUCKETS) {
    const xs = docs.filter((x) => b.test(x.late)).sort((a, z) => a.d.date.localeCompare(z.d.date));
    if (!xs.length) continue;
    rows.push({ c: { date: b.label }, kind: 'section' });
    for (const { d, late } of xs) rows.push({ c: { date: d.date, number: d.number, contact: name(c.db, d.contactId), status: label(d.status), dueDate: d.dueDate, age: Math.max(0, late), amount: d.total, balance: d.balance }, level: 1, link: docLink(d) });
    rows.push(total({ date: `Total for ${b.label}`, amount: sum(xs.map((x) => x.d.total)), balance: sum(xs.map((x) => x.d.balance)) }, 'sub'));
  }
  rows.push(total({ date: 'Total', amount: sum(docs.map((x) => x.d.total)), balance: sum(docs.map((x) => x.d.balance)) }, 'grand'));
  return { columns: [{ key: 'date', label: 'Date', type: 'date' as ColType }, { key: 'number', label: kind === 'invoice' ? 'Invoice#' : 'Bill#' }, { key: 'contact', label: kind === 'invoice' ? 'Client Name' : 'Supplier Name' }, { key: 'status', label: 'Status' }, { key: 'dueDate', label: 'Due Date', type: 'date' as ColType, hidden: true }, { key: 'age', label: 'Age (Days)', type: 'number' as ColType }, { key: 'amount', label: 'Amount', type: 'money' as ColType }, { key: 'balance', label: 'Balance Due', type: 'money' as ColType }], rows, subtitle: `As of ${fmt(c.to)}` };
}

function docDetails(c: Ctx, kind: TxnDoc['kind'], opts: { contact: string; number: string; balance?: string; extra?: Col[]; extraOf?: (d: TxnDoc) => Record<string, string | number | undefined> } = { contact: 'Client Name', number: 'Number' }) {
  const docs = anyDocs(c, kind).sort((a, b) => a.date.localeCompare(b.date));
  const rows: Row[] = docs.map((d) => ({ c: { date: d.date, number: d.number, reference: d.referenceNumber || d.orderNumber, contact: name(c.db, d.contactId), status: label(d.status), dueDate: d.dueDate, salesperson: d.salesperson, subTotal: taxableValue(d), tax: d.taxAmount || 0, amount: d.total, balance: d.balance, ...(opts.extraOf?.(d) ?? {}) }, link: docLink(d) }));
  rows.push(total({ date: 'Total', subTotal: sum(docs.map(taxableValue)), tax: sum(docs.map((d) => d.taxAmount || 0)), amount: sum(docs.map((d) => d.total)), balance: opts.balance ? sum(docs.map((d) => d.balance)) : undefined } as never));
  const cols: Col[] = [
    { key: 'status', label: 'Status' },
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'number', label: opts.number },
    { key: 'reference', label: 'Reference#', hidden: true },
    { key: 'contact', label: opts.contact },
    ...(opts.extra ?? []),
    { key: 'dueDate', label: 'Due Date', type: 'date', hidden: kind !== 'invoice' && kind !== 'bill' },
    { key: 'salesperson', label: 'Sales Person', hidden: true },
    { key: 'subTotal', label: 'Sub Total', type: 'money', hidden: true },
    { key: 'tax', label: 'Tax', type: 'money', hidden: true },
    { key: 'amount', label: 'Amount', type: 'money' },
    ...(opts.balance ? [{ key: 'balance', label: opts.balance, type: 'money' as ColType }] : []),
  ];
  return { columns: cols, rows };
}

/** Client / vendor balance from AR / AP postings up to the end date. */
function contactBalanceSummary(c: Ctx, kind: 'customer' | 'vendor') {
  const isAR = (id: string) => c.db.accounts.find((a) => a.id === id)?.subType === (kind === 'customer' ? 'accounts_receivable' : 'accounts_payable');
  const filter = kind === 'customer' ? c.p.customer : c.p.vendor;
  const m = new Map<string, { billed: number; paid: number; balance: number }>();
  for (const j of c.db.journals) {
    if (j.date > c.to) continue;
    for (const l of j.lines) {
      if (!isAR(l.accountId)) continue;
      const cid = l.contactId || j.contactId;
      if (!cid || (filter && cid !== filter)) continue;
      const x = m.get(cid) || { billed: 0, paid: 0, balance: 0 };
      const inc = kind === 'customer' ? l.debit : l.credit;
      const dec = kind === 'customer' ? l.credit : l.debit;
      x.balance += inc - dec;
      if (j.date >= c.from) {
        if (j.sourceType === 'invoice' || j.sourceType === 'bill' || j.sourceType === 'opening_balance') x.billed += inc;
        else x.paid += dec;
      }
      m.set(cid, x);
    }
  }
  const rows: Row[] = [...m.entries()]
    .filter(([, v]) => Math.abs(v.balance) > 0.004 || v.billed || v.paid)
    .map(([id, v]) => ({ c: { name: name(c.db, id), billed: round2(v.billed), paid: round2(v.paid), balance: round2(v.balance) }, link: `${kind === 'customer' ? '/sales/customers' : '/purchases/vendors'}/${id}` }))
    .sort((a, b) => String(a.c.name).localeCompare(String(b.c.name)));
  rows.push(total({ name: 'Total', billed: sum(rows.map((r) => Number(r.c.billed))), paid: sum(rows.map((r) => Number(r.c.paid))), balance: sum(rows.map((r) => Number(r.c.balance))) }));
  return { columns: [{ key: 'name', label: kind === 'customer' ? 'Client Name' : 'Supplier Name' }, { key: 'billed', label: kind === 'customer' ? 'Invoiced Amount' : 'Billed Amount', type: 'money' as ColType }, { key: 'paid', label: kind === 'customer' ? 'Amount Received' : 'Amount Paid', type: 'money' as ColType }, { key: 'balance', label: 'Closing Balance', type: 'money' as ColType }], rows, notes: ['Amounts received / paid include credit notes, debit notes and write-offs. The closing balance is as of the end date.'] };
}

function receivableSummary(c: Ctx, kind: 'sales' | 'purchases') {
  const kinds: TxnDoc['kind'][] = kind === 'sales' ? ['invoice', 'credit_note'] : ['bill', 'vendor_credit'];
  const docs = kinds.flatMap((k) => anyDocs(c, k)).filter(posted).sort((a, b) => a.date.localeCompare(b.date));
  const rows: Row[] = docs.map((d) => {
    const sign = d.kind === 'credit_note' || d.kind === 'vendor_credit' ? -1 : 1;
    return { c: { contact: name(c.db, d.contactId), date: d.date, number: d.number, reference: d.referenceNumber, status: label(d.status), type: label(d.kind), total: sign * d.total, balance: sign * d.balance }, link: docLink(d) };
  });
  rows.push(total({ contact: 'Total', total: sum(rows.map((r) => Number(r.c.total))), balance: sum(rows.map((r) => Number(r.c.balance))) }));
  return { columns: [{ key: 'contact', label: kind === 'sales' ? 'Client Name' : 'Supplier Name' }, { key: 'date', label: 'Date', type: 'date' as ColType }, { key: 'number', label: 'Transaction#' }, { key: 'reference', label: 'Reference#', hidden: true }, { key: 'status', label: 'Status' }, { key: 'type', label: 'Transaction Type' }, { key: 'total', label: 'Total', type: 'money' as ColType }, { key: 'balance', label: 'Balance', type: 'money' as ColType }], rows };
}

function receivableDetails(c: Ctx, kind: 'sales' | 'purchases') {
  const kinds: TxnDoc['kind'][] = kind === 'sales' ? ['invoice', 'credit_note'] : ['bill', 'vendor_credit'];
  const docs = kinds.flatMap((k) => anyDocs(c, k)).filter(posted).sort((a, b) => a.date.localeCompare(b.date));
  const rows: Row[] = docs.flatMap((d) => {
    const sign = d.kind === 'credit_note' || d.kind === 'vendor_credit' ? -1 : 1;
    return d.lineItems.map((l) => ({ c: { contact: name(c.db, d.contactId), date: d.date, number: d.number, type: label(d.kind), status: label(d.status), item: l.name, qty: sign * l.quantity, rate: l.rate, amount: sign * netLine(d, l) }, link: docLink(d) }));
  });
  rows.push(total({ contact: 'Total', amount: sum(rows.map((r) => Number(r.c.amount))) }));
  return { columns: [{ key: 'contact', label: kind === 'sales' ? 'Client Name' : 'Supplier Name' }, { key: 'date', label: 'Date', type: 'date' as ColType }, { key: 'number', label: 'Transaction#' }, { key: 'type', label: 'Transaction Type' }, { key: 'status', label: 'Status', hidden: true }, { key: 'item', label: 'Item Name' }, { key: 'qty', label: 'Quantity', type: 'number' as ColType }, { key: 'rate', label: 'Item Price', type: 'money' as ColType }, { key: 'amount', label: 'Total', type: 'money' as ColType }], rows };
}

function badDebts(c: Ctx) {
  const docs = c.db.docs.filter((d) => d.kind === 'invoice' && d.writeOff && inR(d.writeOff.date, c) && (!c.p.customer || d.contactId === c.p.customer));
  const rows: Row[] = docs.map((d) => ({ c: { date: d.writeOff!.date, number: d.number, contact: name(c.db, d.contactId), reason: d.writeOff!.reason, amount: d.writeOff!.amount }, link: docLink(d) }));
  rows.push(total({ date: 'Total', amount: sum(docs.map((d) => d.writeOff!.amount)) }));
  return { columns: [{ key: 'date', label: 'Written Off On', type: 'date' as ColType }, { key: 'number', label: 'Invoice#' }, { key: 'contact', label: 'Client Name' }, { key: 'reason', label: 'Reason' }, { key: 'amount', label: 'Amount Written Off', type: 'money' as ColType }], rows };
}

function bankCharges(c: Ctx) {
  const ps = c.db.paymentsReceived.filter((p) => p.status !== 'void' && p.bankCharges > 0 && inR(p.date, c) && (!c.p.customer || p.contactId === c.p.customer));
  const rows: Row[] = ps.map((p) => ({ c: { date: p.date, number: p.number, contact: name(c.db, p.contactId), account: accName(c.db, p.depositToAccountId), amount: p.bankCharges }, link: `/sales/payments-received/${p.id}` }));
  rows.push(total({ date: 'Total', amount: sum(ps.map((p) => p.bankCharges)) }));
  return { columns: [{ key: 'date', label: 'Date', type: 'date' as ColType }, { key: 'number', label: 'Payment#' }, { key: 'contact', label: 'Client Name' }, { key: 'account', label: 'Deposit To' }, { key: 'amount', label: 'Bank Charges', type: 'money' as ColType }], rows };
}

// ------------------------------------------------------------------ payments

function paymentsReceived(c: Ctx) {
  const ps = c.db.paymentsReceived.filter((p) => p.status !== 'draft' && inR(p.date, c) && (!c.p.customer || p.contactId === c.p.customer)).sort((a, b) => a.date.localeCompare(b.date));
  const rows: Row[] = ps.map((p) => ({ c: { number: p.number, date: p.date, reference: p.referenceNumber, contact: name(c.db, p.contactId), mode: p.mode, account: accName(c.db, p.depositToAccountId), invoices: p.allocations.map((a) => c.db.docs.find((d) => d.id === a.docId)?.number).filter(Boolean).join(', '), status: label(p.status), amount: p.status === 'void' ? 0 : p.amount, unused: p.unusedAmount }, link: `/sales/payments-received/${p.id}` }));
  rows.push(total({ number: 'Total', amount: sum(rows.map((r) => Number(r.c.amount))), unused: sum(rows.map((r) => Number(r.c.unused))) }));
  return { columns: [{ key: 'number', label: 'Payment#' }, { key: 'date', label: 'Date', type: 'date' as ColType }, { key: 'reference', label: 'Reference#' }, { key: 'contact', label: 'Client Name' }, { key: 'mode', label: 'Payment Mode' }, { key: 'account', label: 'Deposit To', hidden: true }, { key: 'invoices', label: 'Invoice#', hidden: true }, { key: 'status', label: 'Status', hidden: true }, { key: 'amount', label: 'Amount', type: 'money' as ColType }, { key: 'unused', label: 'Unused Amount', type: 'money' as ColType }], rows };
}

function paymentsMade(c: Ctx) {
  const ps = c.db.paymentsMade.filter((p) => p.status !== 'draft' && inR(p.date, c) && (!c.p.vendor || p.contactId === c.p.vendor)).sort((a, b) => a.date.localeCompare(b.date));
  const rows: Row[] = ps.map((p) => ({ c: { number: p.number, date: p.date, reference: p.referenceNumber, contact: name(c.db, p.contactId), mode: p.mode, account: accName(c.db, p.paidThroughAccountId), bills: p.allocations.map((a) => c.db.docs.find((d) => d.id === a.docId)?.number).filter(Boolean).join(', '), status: label(p.status), amount: p.status === 'void' ? 0 : p.amount, unused: p.unusedAmount }, link: `/purchases/payments-made/${p.id}` }));
  rows.push(total({ number: 'Total', amount: sum(rows.map((r) => Number(r.c.amount))), unused: sum(rows.map((r) => Number(r.c.unused))) }));
  return { columns: [{ key: 'number', label: 'Payment#' }, { key: 'date', label: 'Date', type: 'date' as ColType }, { key: 'reference', label: 'Reference#' }, { key: 'contact', label: 'Supplier Name' }, { key: 'mode', label: 'Payment Mode' }, { key: 'account', label: 'Paid Through', hidden: true }, { key: 'bills', label: 'Bill#', hidden: true }, { key: 'status', label: 'Status', hidden: true }, { key: 'amount', label: 'Amount', type: 'money' as ColType }, { key: 'unused', label: 'Unused Amount', type: 'money' as ColType }], rows };
}

/** When each invoice became fully paid: the date of the last payment / credit applied to it. */
function paidOn(db: Database, inv: TxnDoc) {
  if (inv.status !== 'paid') return undefined;
  const dates: string[] = [];
  for (const p of db.paymentsReceived) if (p.status === 'paid' && p.allocations.some((a) => a.docId === inv.id)) dates.push(p.date);
  for (const d of db.docs) if (d.kind === 'credit_note') for (const a of d.creditApplications) if (a.invoiceId === inv.id) dates.push(a.date);
  if (inv.writeOff) dates.push(inv.writeOff.date);
  return dates.sort().pop();
}

function timeToGetPaid(c: Ctx) {
  const m = new Map<string, { b: number[]; days: number[] }>();
  for (const d of docsOf(c, 'invoice')) {
    const on = paidOn(c.db, d);
    if (!on) continue;
    const days = Math.max(0, daysBetween(d.date, on));
    const x = m.get(d.contactId) || { b: [0, 0, 0, 0], days: [] };
    x.b[days <= 15 ? 0 : days <= 30 ? 1 : days <= 45 ? 2 : 3]++;
    x.days.push(days);
    m.set(d.contactId, x);
  }
  const rows: Row[] = [...m.entries()].map(([id, v]) => {
    const n = v.days.length;
    const pct = (k: number) => round2((v.b[k] / n) * 100);
    return { c: { name: name(c.db, id), b1: pct(0), b2: pct(1), b3: pct(2), b4: pct(3), avg: Math.round(v.days.reduce((a, b) => a + b, 0) / n), count: n } };
  });
  return { columns: [{ key: 'name', label: 'Client Name' }, { key: 'b1', label: '0 - 15 Days', type: 'percent' as ColType }, { key: 'b2', label: '16 - 30 Days', type: 'percent' as ColType }, { key: 'b3', label: '31 - 45 Days', type: 'percent' as ColType }, { key: 'b4', label: '> 45 Days', type: 'percent' as ColType }, { key: 'avg', label: 'Average Days', type: 'number' as ColType }, { key: 'count', label: 'Paid Invoices', type: 'number' as ColType, hidden: true }], rows, notes: ['Share of fully paid invoices, by days from the invoice date to the last payment.'] };
}

function refundHistory(c: Ctx, side: 'customer' | 'vendor') {
  const rows: Row[] = [];
  if (side === 'customer') {
    for (const d of c.db.docs.filter((x) => x.kind === 'credit_note' && (!c.p.customer || x.contactId === c.p.customer)))
      for (const r of d.refunds) if (inR(r.date, c)) rows.push({ c: { date: r.date, number: d.number, type: 'Credit Note', contact: name(c.db, d.contactId), mode: r.mode, reference: r.referenceNumber, account: accName(c.db, r.accountId), amount: r.amount }, link: docLink(d) });
    for (const p of c.db.paymentsReceived.filter((x) => !c.p.customer || x.contactId === c.p.customer))
      for (const r of p.refunds) if (inR(r.date, c)) rows.push({ c: { date: r.date, number: p.number, type: 'Client Payment', contact: name(c.db, p.contactId), mode: r.mode, reference: r.referenceNumber, account: accName(c.db, r.accountId), amount: r.amount }, link: `/sales/payments-received/${p.id}` });
  } else {
    for (const d of c.db.docs.filter((x) => x.kind === 'vendor_credit' && (!c.p.vendor || x.contactId === c.p.vendor)))
      for (const r of d.refunds) if (inR(r.date, c)) rows.push({ c: { date: r.date, number: d.number, type: 'Debit Note', contact: name(c.db, d.contactId), mode: r.mode, reference: r.referenceNumber, account: accName(c.db, r.accountId), amount: r.amount }, link: docLink(d) });
    for (const p of c.db.paymentsMade.filter((x) => !c.p.vendor || x.contactId === c.p.vendor))
      for (const r of p.refunds ?? []) if (inR(r.date, c)) rows.push({ c: { date: r.date, number: p.number, type: 'Supplier Payment', contact: name(c.db, p.contactId), mode: r.mode, reference: r.referenceNumber, account: accName(c.db, r.accountId), amount: r.amount }, link: `/purchases/payments-made/${p.id}` });
  }
  rows.sort((a, b) => String(a.c.date).localeCompare(String(b.c.date)));
  rows.push(total({ date: 'Total', amount: sum(rows.map((r) => Number(r.c.amount))) }));
  return { columns: [{ key: 'date', label: 'Refund Date', type: 'date' as ColType }, { key: 'number', label: 'Transaction#' }, { key: 'type', label: 'Type' }, { key: 'contact', label: side === 'customer' ? 'Client Name' : 'Supplier Name' }, { key: 'mode', label: 'Payment Mode' }, { key: 'reference', label: 'Reference#', hidden: true }, { key: 'account', label: side === 'customer' ? 'From Account' : 'Deposit To' }, { key: 'amount', label: 'Amount', type: 'money' as ColType }], rows };
}

function tdsReceivable(c: Ctx, detail: boolean) {
  const items: { contactId: string; date: string; number: string; type: string; amount: number; link: string }[] = [];
  for (const d of docsOf(c, 'invoice')) if (d.tdsAmount) items.push({ contactId: d.contactId, date: d.date, number: d.number, type: 'Invoice', amount: d.tdsAmount, link: docLink(d) });
  for (const p of c.db.paymentsReceived) if (p.status === 'paid' && p.tdsDeducted && p.tdsAmount && inR(p.date, c) && (!c.p.customer || p.contactId === c.p.customer)) items.push({ contactId: p.contactId, date: p.date, number: p.number, type: 'Client Payment', amount: p.tdsAmount, link: `/sales/payments-received/${p.id}` });
  return contactTaxRows(c, items, detail, 'Client Name', 'TDS Deducted');
}

function tdsPayable(c: Ctx, detail: boolean) {
  const items: { contactId: string; date: string; number: string; type: string; amount: number; link: string }[] = [];
  for (const d of docsOf(c, 'bill')) if (d.tdsAmount) items.push({ contactId: d.contactId, date: d.date, number: d.number, type: 'Bill', amount: d.tdsAmount, link: docLink(d) });
  for (const d of docsOf(c, 'vendor_credit')) if (d.tdsAmount) items.push({ contactId: d.contactId, date: d.date, number: d.number, type: 'Debit Note', amount: -d.tdsAmount, link: docLink(d) });
  return contactTaxRows(c, items, detail, 'Supplier Name', 'TDS Deducted');
}

function contactTaxRows(c: Ctx, items: { contactId: string; date: string; number: string; type: string; amount: number; link: string }[], detail: boolean, who: string, what: string) {
  if (detail) {
    const rows: Row[] = items.sort((a, b) => a.date.localeCompare(b.date)).map((x) => ({ c: { date: x.date, number: x.number, type: x.type, contact: name(c.db, x.contactId), pan: c.db.contacts.find((k) => k.id === x.contactId)?.pan, amount: x.amount }, link: x.link }));
    rows.push(total({ date: 'Total', amount: sum(items.map((x) => x.amount)) }));
    return { columns: [{ key: 'date', label: 'Date', type: 'date' as ColType }, { key: 'number', label: 'Transaction#' }, { key: 'type', label: 'Type' }, { key: 'contact', label: who }, { key: 'pan', label: 'PAN', hidden: true }, { key: 'amount', label: what, type: 'money' as ColType }], rows };
  }
  const m = new Map<string, { n: number; amount: number }>();
  for (const x of items) {
    const v = m.get(x.contactId) || { n: 0, amount: 0 };
    v.n++;
    v.amount += x.amount;
    m.set(x.contactId, v);
  }
  const rows: Row[] = [...m.entries()].map(([id, v]) => ({ c: { contact: name(c.db, id), pan: c.db.contacts.find((k) => k.id === id)?.pan, count: v.n, amount: round2(v.amount) } }));
  rows.push(total({ contact: 'Total', count: sum(rows.map((r) => Number(r.c.count))), amount: sum(rows.map((r) => Number(r.c.amount))) }));
  return { columns: [{ key: 'contact', label: who }, { key: 'pan', label: 'PAN' }, { key: 'count', label: 'Transactions', type: 'number' as ColType }, { key: 'amount', label: what, type: 'money' as ColType }], rows };
}

function recurringInvoiceDetails(c: Ctx) {
  const ps = c.db.docs.filter((d) => d.kind === 'recurring_invoice' && (!c.p.customer || d.contactId === c.p.customer) && (!c.p.status || c.p.status === 'all' || d.status === c.p.status));
  const rows: Row[] = ps.map((d) => ({ c: { profile: d.profileName, contact: name(c.db, d.contactId), frequency: d.repeatEvery ? frequencyLabel(d.repeatEvery) : '', start: d.startOn, last: d.lastGeneratedDate, next: d.status === 'active' ? d.nextDate : undefined, end: d.neverExpires ? 'Never Expires' : d.endsOn, status: label(d.status), count: c.db.docs.filter((x) => x.recurringProfileId === d.id).length, amount: d.total }, link: docLink(d) }));
  return { columns: [{ key: 'profile', label: 'Profile Name' }, { key: 'contact', label: 'Client Name' }, { key: 'frequency', label: 'Frequency' }, { key: 'start', label: 'Start Date', type: 'date' as ColType, hidden: true }, { key: 'last', label: 'Last Invoice Date', type: 'date' as ColType }, { key: 'next', label: 'Next Invoice Date', type: 'date' as ColType }, { key: 'end', label: 'Ends On', hidden: true }, { key: 'status', label: 'Status' }, { key: 'count', label: 'Invoices Created', type: 'number' as ColType }, { key: 'amount', label: 'Amount', type: 'money' as ColType }], rows };
}

// ------------------------------------------------------------------ purchases and expenses

function purchasesByVendor(c: Ctx) {
  const m = new Map<string, { bills: number; billAmt: number; exp: number; expAmt: number }>();
  for (const d of docsOf(c, 'bill')) {
    const x = m.get(d.contactId) || { bills: 0, billAmt: 0, exp: 0, expAmt: 0 };
    x.bills++;
    x.billAmt += taxableValue(d);
    m.set(d.contactId, x);
  }
  for (const e of expensesIn(c)) {
    if (!e.vendorId) continue;
    const x = m.get(e.vendorId) || { bills: 0, billAmt: 0, exp: 0, expAmt: 0 };
    x.exp++;
    x.expAmt += e.subTotal ?? e.amount;
    m.set(e.vendorId, x);
  }
  const rows: Row[] = [...m.entries()].map(([id, v]) => ({ c: { name: name(c.db, id), bills: v.bills, billAmt: round2(v.billAmt), exp: v.exp, expAmt: round2(v.expAmt), total: round2(v.billAmt + v.expAmt) }, link: `/purchases/vendors/${id}` })).sort((a, b) => Number(b.c.total) - Number(a.c.total));
  rows.push(total({ name: 'Total', bills: sum(rows.map((r) => Number(r.c.bills))), billAmt: sum(rows.map((r) => Number(r.c.billAmt))), exp: sum(rows.map((r) => Number(r.c.exp))), expAmt: sum(rows.map((r) => Number(r.c.expAmt))), total: sum(rows.map((r) => Number(r.c.total))) }));
  return { columns: [{ key: 'name', label: 'Supplier Name' }, { key: 'bills', label: 'Bill Count', type: 'number' as ColType }, { key: 'billAmt', label: 'Bill Amount', type: 'money' as ColType }, { key: 'exp', label: 'Expense Count', type: 'number' as ColType, hidden: true }, { key: 'expAmt', label: 'Expense Amount', type: 'money' as ColType }, { key: 'total', label: 'Total Purchases', type: 'money' as ColType }], rows, notes: ['Amounts exclude GST.'] };
}

function purchasesByItem(c: Ctx) {
  const rows: Row[] = itemTotals(c, ['bill'], ['vendor_credit'])
    .sort((a, b) => b.amount - a.amount)
    .map((x) => ({ c: { item: x.item, sku: x.sku, qty: x.qty, amount: x.amount, avg: x.avg }, link: x.id ? `/items/${x.id}` : undefined }));
  rows.push(total({ item: 'Total', qty: sum(rows.map((r) => Number(r.c.qty))), amount: sum(rows.map((r) => Number(r.c.amount))) }));
  return { columns: [{ key: 'item', label: 'Item Name' }, { key: 'sku', label: 'SKU', hidden: true }, { key: 'qty', label: 'Quantity Purchased', type: 'number' as ColType }, { key: 'amount', label: 'Amount', type: 'money' as ColType }, { key: 'avg', label: 'Average Price', type: 'money' as ColType }], rows };
}

function purchaseOrdersByVendor(c: Ctx) {
  const m = new Map<string, { n: number; amount: number; billed: number }>();
  for (const d of anyDocs(c, 'purchase_order').filter((d) => d.status !== 'draft' && d.status !== 'cancelled')) {
    const x = m.get(d.contactId) || { n: 0, amount: 0, billed: 0 };
    x.n++;
    x.amount += d.total;
    if (d.billedStatus === 'billed') x.billed += d.total;
    m.set(d.contactId, x);
  }
  const rows: Row[] = [...m.entries()].map(([id, v]) => ({ c: { name: name(c.db, id), count: v.n, amount: round2(v.amount), billed: round2(v.billed) } }));
  rows.push(total({ name: 'Total', count: sum(rows.map((r) => Number(r.c.count))), amount: sum(rows.map((r) => Number(r.c.amount))), billed: sum(rows.map((r) => Number(r.c.billed))) }));
  return { columns: [{ key: 'name', label: 'Supplier Name' }, { key: 'count', label: 'Purchase Order Count', type: 'number' as ColType }, { key: 'amount', label: 'Amount', type: 'money' as ColType }, { key: 'billed', label: 'Billed Amount', type: 'money' as ColType }], rows };
}

function purchaseOrdersByItem(c: Ctx) {
  const m = new Map<string, { qty: number; amount: number }>();
  for (const d of anyDocs(c, 'purchase_order').filter((d) => d.status !== 'draft' && d.status !== 'cancelled'))
    for (const l of d.lineItems) {
      if (c.p.item && l.itemId !== c.p.item) continue;
      const k = l.itemId || `name:${l.name}`;
      const x = m.get(k) || { qty: 0, amount: 0 };
      x.qty += l.quantity;
      x.amount += netLine(d, l);
      m.set(k, x);
    }
  const rows: Row[] = [...m.entries()].map(([k, v]) => ({ c: { item: k.startsWith('name:') ? k.slice(5) : c.db.items.find((i) => i.id === k)?.name ?? k, qty: round2(v.qty), amount: round2(v.amount), avg: round2(v.qty ? v.amount / v.qty : 0) } }));
  rows.push(total({ item: 'Total', qty: sum(rows.map((r) => Number(r.c.qty))), amount: sum(rows.map((r) => Number(r.c.amount))) }));
  return { columns: [{ key: 'item', label: 'Item Name' }, { key: 'qty', label: 'Quantity Ordered', type: 'number' as ColType }, { key: 'amount', label: 'Amount', type: 'money' as ColType }, { key: 'avg', label: 'Average Price', type: 'money' as ColType }], rows };
}

const expensesIn = (c: Ctx) => c.db.expenses.filter((e) => inR(e.date, c) && (!c.p.vendor || e.vendorId === c.p.vendor) && (!c.p.customer || e.customerId === c.p.customer) && (!c.p.project || e.projectId === c.p.project) && (!c.p.account || e.accountId === c.p.account));

function expenseRows(c: Ctx, es: Expense[]) {
  return es
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({ c: { date: e.date, account: e.itemized && e.lines.length > 1 ? 'Itemized' : accName(c.db, e.accountId), reference: e.invoiceNumber, vendor: name(c.db, e.vendorId), paidThrough: accName(c.db, e.paidThroughAccountId), customer: name(c.db, e.customerId), project: c.db.projects.find((p) => p.id === e.projectId)?.name, status: label(e.status), amount: e.subTotal ?? e.amount, tax: e.taxAmount || 0, total: e.amount }, link: `/purchases/expenses/${e.id}` }) as Row);
}
const EXPENSE_COLS: Col[] = [
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'account', label: 'Expense Account' },
  { key: 'reference', label: 'Reference#' },
  { key: 'vendor', label: 'Supplier Name' },
  { key: 'paidThrough', label: 'Paid Through' },
  { key: 'customer', label: 'Client Name' },
  { key: 'project', label: 'Project', hidden: true },
  { key: 'status', label: 'Status' },
  { key: 'amount', label: 'Amount', type: 'money' },
  { key: 'tax', label: 'Tax', type: 'money', hidden: true },
  { key: 'total', label: 'Total (incl. tax)', type: 'money', hidden: true },
];

function expenseDetails(c: Ctx, filter: (e: Expense) => boolean = () => true) {
  const es = expensesIn(c).filter(filter);
  const rows = expenseRows(c, es);
  rows.push(total({ date: 'Total', amount: sum(es.map((e) => e.subTotal ?? e.amount)), tax: sum(es.map((e) => e.taxAmount || 0)), total: sum(es.map((e) => e.amount)) }));
  return { columns: EXPENSE_COLS, rows };
}

function expensesByCategory(c: Ctx) {
  const m = new Map<string, number>();
  for (const j of ledger(c.db, c.basis)) {
    if (!inR(j.date, c)) continue;
    for (const l of j.lines) {
      const a = c.db.accounts.find((x) => x.id === l.accountId);
      if (a?.type === 'expense') m.set(a.id, (m.get(a.id) || 0) + l.debit - l.credit);
    }
  }
  const rows: Row[] = [...m.entries()].map(([id, v]) => ({ c: { account: accName(c.db, id), amount: round2(v) }, link: acctLink(c, id) })).filter((r) => r.c.amount).sort((a, b) => Number(b.c.amount) - Number(a.c.amount));
  rows.push(total({ account: 'Total', amount: sum(rows.map((r) => Number(r.c.amount))) }));
  return { columns: [{ key: 'account', label: 'Expense Category' }, { key: 'amount', label: 'Amount', type: 'money' as ColType }], rows, notes: ['All expense postings: expenses, bills, journals and cost of goods sold.'] };
}

function expensesGrouped(c: Ctx, by: 'customer' | 'project') {
  const m = new Map<string, { n: number; amount: number; billable: number }>();
  for (const e of expensesIn(c)) {
    const k = by === 'customer' ? e.customerId : e.projectId;
    if (!k) continue;
    const x = m.get(k) || { n: 0, amount: 0, billable: 0 };
    x.n++;
    x.amount += e.amount;
    if (e.billable) x.billable += e.amount;
    m.set(k, x);
  }
  const rows: Row[] = [...m.entries()].map(([k, v]) => ({ c: { name: by === 'customer' ? name(c.db, k) : c.db.projects.find((p) => p.id === k)?.name, count: v.n, billable: round2(v.billable), amount: round2(v.amount) } }));
  rows.push(total({ name: 'Total', count: sum(rows.map((r) => Number(r.c.count))), billable: sum(rows.map((r) => Number(r.c.billable))), amount: sum(rows.map((r) => Number(r.c.amount))) }));
  return { columns: [{ key: 'name', label: by === 'customer' ? 'Client Name' : 'Project Name' }, { key: 'count', label: 'Expense Count', type: 'number' as ColType }, { key: 'billable', label: 'Billable Amount', type: 'money' as ColType }, { key: 'amount', label: 'Amount', type: 'money' as ColType }], rows };
}

function mileage(c: Ctx) {
  const es = expensesIn(c).filter((e) => e.isMileage);
  const rows: Row[] = es.map((e) => ({ c: { date: e.date, account: accName(c.db, e.accountId), customer: name(c.db, e.customerId), distance: e.distance, rate: e.ratePerKm, amount: e.amount, notes: e.notes }, link: `/purchases/expenses/${e.id}` }));
  rows.push(total({ date: 'Total', distance: sum(es.map((e) => e.distance || 0)), amount: sum(es.map((e) => e.amount)) }));
  return { columns: [{ key: 'date', label: 'Date', type: 'date' as ColType }, { key: 'account', label: 'Expense Account' }, { key: 'customer', label: 'Client Name' }, { key: 'distance', label: 'Distance (km)', type: 'number' as ColType }, { key: 'rate', label: 'Rate per km', type: 'money' as ColType }, { key: 'amount', label: 'Amount', type: 'money' as ColType }, { key: 'notes', label: 'Notes', hidden: true }], rows };
}

// ------------------------------------------------------------------ GST

type Gstr1Section = 'b2b' | 'sez' | 'b2cl' | 'b2cs' | 'exp' | 'cdnr' | 'cdnur' | 'nil';
const B2CL_LIMIT = 100000;

function treatmentOf(db: Database, d: TxnDoc) {
  return d.gstTreatment || db.contacts.find((x) => x.id === d.contactId)?.gstTreatment || 'consumer';
}
const orgState = (db: Database) => db.organization.state;
const isInter = (db: Database, d: TxnDoc) => (d.taxBreakdown ?? []).some((t) => t.component === 'igst') || (!!d.destinationOfSupply && d.destinationOfSupply !== (d.sourceOfSupply || orgState(db)));
const registered = (t: string) => ['registered_business', 'registered_composition', 'deemed_export', 'tax_deductor', 'sez_developer'].includes(t);

function lineKind(l: TxnDoc['lineItems'][number]) {
  return taxRate(l.taxId)?.kind ?? 'gst';
}

function gstr1Section(db: Database, d: TxnDoc): Gstr1Section {
  const t = treatmentOf(db, d);
  if (d.kind === 'credit_note') return registered(t) || t === 'special_economic_zone' ? 'cdnr' : 'cdnur';
  if (t === 'overseas') return 'exp';
  if (t === 'special_economic_zone') return 'sez';
  if (registered(t)) return 'b2b';
  if (isInter(db, d) && d.total > B2CL_LIMIT) return 'b2cl';
  return 'b2cs';
}

const GSTR1_LABEL: Record<Gstr1Section, string> = {
  b2b: 'B2B Invoices (4A, 4B, 4C, 6B, 6C)',
  sez: 'Supplies to SEZ (6B)',
  b2cl: 'B2C Large Invoices (5A, 5B)',
  b2cs: 'B2C Small (7)',
  exp: 'Exports (6A)',
  cdnr: 'Credit / Debit Notes - Registered (9B)',
  cdnur: 'Credit / Debit Notes - Unregistered (9B)',
  nil: 'Nil Rated, Exempted and Non-GST Supplies (8)',
};

const GST_COLS: Col[] = [
  { key: 'section', label: 'Section' },
  { key: 'count', label: 'Count', type: 'number' },
  { key: 'taxable', label: 'Taxable Value', type: 'money' },
  { key: 'igst', label: 'IGST', type: 'money' },
  { key: 'cgst', label: 'CGST', type: 'money' },
  { key: 'sgst', label: 'SGST', type: 'money' },
  { key: 'cess', label: 'Cess', type: 'money', hidden: true },
  { key: 'tax', label: 'Total Tax', type: 'money' },
];

function gstAmounts(d: TxnDoc, sign = 1) {
  const taxable = sign * round2(sum(d.lineItems.filter((l) => lineKind(l) === 'gst').map((l) => netLine(d, l))) * (d.subTotal ? 1 - d.discountAmount / d.subTotal : 1));
  return { taxable: round2(taxable), igst: sign * comp(d, 'igst'), cgst: sign * comp(d, 'cgst'), sgst: sign * comp(d, 'sgst') };
}

function gstr1(c: Ctx) {
  const docs = [...docsOf(c, 'invoice'), ...docsOf(c, 'credit_note')];
  const rows: Row[] = [];
  const grand = { taxable: 0, igst: 0, cgst: 0, sgst: 0 };
  for (const s of ['b2b', 'sez', 'b2cl', 'b2cs', 'exp', 'cdnr', 'cdnur'] as Gstr1Section[]) {
    const xs = docs.filter((d) => gstr1Section(c.db, d) === s);
    const a = xs.map((d) => gstAmounts(d, d.kind === 'credit_note' ? -1 : 1));
    const t = { taxable: sum(a.map((x) => x.taxable)), igst: sum(a.map((x) => x.igst)), cgst: sum(a.map((x) => x.cgst)), sgst: sum(a.map((x) => x.sgst)) };
    rows.push({ c: { section: GSTR1_LABEL[s], count: xs.length, ...t, cess: 0, tax: round2(t.igst + t.cgst + t.sgst) }, kind: 'sub' });
    xs.forEach((d, i) => rows.push({ c: { section: `${d.number} · ${fmt(d.date)} · ${name(c.db, d.contactId)}${d.gstin ? ` (${d.gstin})` : ''}`, ...a[i], tax: round2(a[i].igst + a[i].cgst + a[i].sgst) }, level: 1, link: docLink(d) }));
    grand.taxable += t.taxable;
    grand.igst += t.igst;
    grand.cgst += t.cgst;
    grand.sgst += t.sgst;
  }
  // 8: nil rated / exempt / non-GST lines
  const nil = { nil: 0, exempt: 0, non: 0 };
  for (const d of docsOf(c, 'invoice'))
    for (const l of d.lineItems) {
      const k = lineKind(l);
      const r = taxRate(l.taxId);
      if (k === 'exempt') nil.exempt += netLine(d, l);
      else if (k === 'non_gst' || k === 'out_of_scope') nil.non += netLine(d, l);
      else if (r && r.rate === 0) nil.nil += netLine(d, l);
    }
  rows.push({ c: { section: GSTR1_LABEL.nil, taxable: round2(nil.nil + nil.exempt + nil.non) }, kind: 'sub' });
  rows.push({ c: { section: 'Nil rated supplies', taxable: round2(nil.nil) }, level: 1 });
  rows.push({ c: { section: 'Exempted supplies', taxable: round2(nil.exempt) }, level: 1 });
  rows.push({ c: { section: 'Non-GST supplies', taxable: round2(nil.non) }, level: 1 });
  // 12: HSN summary and 13: documents issued
  const hsn = hsnRows(c, docsOf(c, 'invoice'), docsOf(c, 'credit_note'));
  rows.push({ c: { section: 'HSN-wise Summary of Outward Supplies (12)', count: hsn.length, taxable: sum(hsn.map((h) => h.taxable)), igst: sum(hsn.map((h) => h.igst)), cgst: sum(hsn.map((h) => h.cgst)), sgst: sum(hsn.map((h) => h.sgst)), tax: sum(hsn.map((h) => h.igst + h.cgst + h.sgst)) }, kind: 'sub', link: `/reports/hsn-summary?from=${c.from}&to=${c.to}` });
  rows.push({ c: { section: 'Documents Issued (13)' }, kind: 'sub' });
  for (const k of ['invoice', 'credit_note', 'delivery_challan'] as const) {
    const ds = c.db.docs.filter((d) => d.kind === k && inR(d.date, c) && d.status !== 'draft').sort((a, b) => a.number.localeCompare(b.number));
    if (!ds.length) continue;
    const cancelled = ds.filter((d) => d.status === 'void').length;
    rows.push({ c: { section: `${label(k)}s: ${ds[0].number} to ${ds[ds.length - 1].number}`, count: ds.length, taxable: undefined, tax: undefined, igst: undefined, cgst: undefined, sgst: undefined, cess: cancelled ? -cancelled : undefined }, level: 1 });
  }
  rows.push(total({ section: 'Total Liability (outward supplies net of credit notes)', taxable: round2(grand.taxable), igst: round2(grand.igst), cgst: round2(grand.cgst), sgst: round2(grand.sgst), tax: round2(grand.igst + grand.cgst + grand.sgst) }, 'grand'));
  return { columns: GST_COLS, rows, notes: [`B2C Large: inter-state invoices to unregistered persons above ${'₹1,00,000'}. Credit notes are shown as negative values. Cancelled (void) documents in table 13 are counted in the Cess column as a negative number.`] };
}

interface HsnRow {
  hsn: string;
  description: string;
  uqc: string;
  qty: number;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  rate: number;
}

function hsnRows(c: Ctx, plus: TxnDoc[], minus: TxnDoc[]): HsnRow[] {
  const m = new Map<string, HsnRow>();
  const add = (d: TxnDoc, sign: number) => {
    const disc = d.subTotal ? 1 - d.discountAmount / d.subTotal : 1;
    const inter = isInter(c.db, d);
    for (const l of d.lineItems) {
      const item = c.db.items.find((i) => i.id === l.itemId);
      const hsn = l.hsnSac || (item as { hsnSac?: string } | undefined)?.hsnSac || 'Not specified';
      const rate = taxRate(l.taxId)?.rate ?? 0;
      const key = `${hsn}|${rate}`;
      const x = m.get(key) || { hsn, description: item?.name ?? l.name, uqc: (l.unit || 'OTH').toUpperCase(), qty: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, rate };
      const taxable = sign * netLine(d, l) * disc;
      const tax = sign * (l.taxAmount || 0) * disc;
      x.qty += sign * l.quantity;
      x.taxable += taxable;
      if (inter) x.igst += tax;
      else {
        x.cgst += tax / 2;
        x.sgst += tax / 2;
      }
      m.set(key, x);
    }
  };
  plus.forEach((d) => add(d, 1));
  minus.forEach((d) => add(d, -1));
  return [...m.values()].map((x) => ({ ...x, qty: round2(x.qty), taxable: round2(x.taxable), igst: round2(x.igst), cgst: round2(x.cgst), sgst: round2(x.sgst) })).sort((a, b) => a.hsn.localeCompare(b.hsn));
}

function hsnSummary(c: Ctx) {
  const purchases = c.p.status === 'inward';
  const hs = purchases ? hsnRows(c, docsOf(c, 'bill'), docsOf(c, 'vendor_credit')) : hsnRows(c, docsOf(c, 'invoice'), docsOf(c, 'credit_note'));
  const rows: Row[] = hs.map((h) => ({ c: { hsn: h.hsn, description: h.description, uqc: h.uqc, qty: h.qty, rate: h.rate, total: round2(h.taxable + h.igst + h.cgst + h.sgst), taxable: h.taxable, igst: h.igst, cgst: h.cgst, sgst: h.sgst } }));
  rows.push(total({ hsn: 'Total', qty: sum(hs.map((h) => h.qty)), total: sum(rows.map((r) => Number(r.c.total))), taxable: sum(hs.map((h) => h.taxable)), igst: sum(hs.map((h) => h.igst)), cgst: sum(hs.map((h) => h.cgst)), sgst: sum(hs.map((h) => h.sgst)) }));
  return { columns: [{ key: 'hsn', label: 'HSN/SAC' }, { key: 'description', label: 'Description' }, { key: 'uqc', label: 'UQC' }, { key: 'qty', label: 'Total Quantity', type: 'number' as ColType }, { key: 'rate', label: 'Rate (%)', type: 'number' as ColType }, { key: 'total', label: 'Total Value', type: 'money' as ColType }, { key: 'taxable', label: 'Taxable Value', type: 'money' as ColType }, { key: 'igst', label: 'IGST', type: 'money' as ColType }, { key: 'cgst', label: 'CGST', type: 'money' as ColType }, { key: 'sgst', label: 'SGST', type: 'money' as ColType }], rows, notes: ['Choose Outward or Inward supplies with the Supplies filter. Credit notes and debit notes are netted off.'] };
}

/** Input tax on bills and expenses (net of vendor credits), split by reverse charge. */
function inwardDocs(c: Ctx) {
  const out: { date: string; number: string; type: string; contactId?: string; gstin?: string; taxable: number; igst: number; cgst: number; sgst: number; rcm: boolean; link: string; treatment?: string; nonGst: number; exempt: number; inter: boolean }[] = [];
  const exemptOf = (lines: { taxId?: string; amount: number }[]) => ({ exempt: sum(lines.filter((l) => taxRate(l.taxId)?.kind === 'exempt' || (taxRate(l.taxId)?.kind === 'gst' && taxRate(l.taxId)?.rate === 0)).map((l) => l.amount)), nonGst: sum(lines.filter((l) => ['non_gst', 'out_of_scope'].includes(taxRate(l.taxId)?.kind ?? '')).map((l) => l.amount)) });
  for (const k of ['bill', 'vendor_credit'] as const)
    for (const d of docsOf(c, k)) {
      const sign = k === 'vendor_credit' ? -1 : 1;
      const a = gstAmounts(d, sign);
      const ex = exemptOf(d.lineItems.map((l) => ({ taxId: l.taxId, amount: netLine(d, l) })));
      out.push({ date: d.date, number: d.number, type: label(k), contactId: d.contactId, gstin: d.gstin || c.db.contacts.find((x) => x.id === d.contactId)?.gstin, ...a, rcm: !!d.reverseCharge, link: docLink(d), treatment: treatmentOf(c.db, d), exempt: sign * ex.exempt, nonGst: sign * ex.nonGst, inter: isInter(c.db, d) });
    }
  for (const e of expensesIn(c)) {
    const b = e.taxBreakdown ?? [];
    const g = (k: string) => sum(b.filter((t) => t.component === k).map((t) => t.amount));
    const lines = e.itemized && e.lines.length ? e.lines.map((l) => ({ taxId: (l as { taxId?: string }).taxId ?? e.taxId, amount: l.amount })) : [{ taxId: e.taxId, amount: e.subTotal ?? e.amount }];
    const ex = exemptOf(lines);
    out.push({ date: e.date, number: e.invoiceNumber || 'Expense', type: 'Expense', contactId: e.vendorId, gstin: e.vendorGstin, taxable: (e.taxAmount ? e.subTotal ?? e.amount : 0) || 0, igst: g('igst'), cgst: g('cgst'), sgst: g('sgst'), rcm: !!e.reverseCharge, link: `/purchases/expenses/${e.id}`, treatment: e.gstTreatment, exempt: ex.exempt, nonGst: ex.nonGst, inter: g('igst') > 0 || (!!e.sourceOfSupply && e.sourceOfSupply !== (e.destinationOfSupply || orgState(c.db))) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function inwardSupplies(c: Ctx) {
  const xs = inwardDocs(c).filter((x) => x.taxable || x.igst || x.cgst || x.sgst);
  const rows: Row[] = xs.map((x) => ({ c: { date: x.date, number: x.number, type: x.type, contact: name(c.db, x.contactId), gstin: x.gstin, taxable: x.taxable, igst: x.igst, cgst: x.cgst, sgst: x.sgst, tax: round2(x.igst + x.cgst + x.sgst), rcm: x.rcm ? 'Yes' : 'No' }, link: x.link }));
  rows.push(total({ date: 'Total', taxable: sum(xs.map((x) => x.taxable)), igst: sum(xs.map((x) => x.igst)), cgst: sum(xs.map((x) => x.cgst)), sgst: sum(xs.map((x) => x.sgst)), tax: sum(xs.map((x) => x.igst + x.cgst + x.sgst)) }));
  return { columns: [{ key: 'date', label: 'Date', type: 'date' as ColType }, { key: 'number', label: 'Bill#' }, { key: 'type', label: 'Type' }, { key: 'contact', label: 'Supplier Name' }, { key: 'gstin', label: 'GSTIN' }, { key: 'taxable', label: 'Taxable Value', type: 'money' as ColType }, { key: 'igst', label: 'IGST', type: 'money' as ColType }, { key: 'cgst', label: 'CGST', type: 'money' as ColType }, { key: 'sgst', label: 'SGST', type: 'money' as ColType }, { key: 'tax', label: 'Total Tax', type: 'money' as ColType }, { key: 'rcm', label: 'Reverse Charge' }], rows };
}

function gstr3b(c: Ctx) {
  const inv = docsOf(c, 'invoice');
  const cn = docsOf(c, 'credit_note');
  const outward = [...inv.map((d) => ({ d, sign: 1 })), ...cn.map((d) => ({ d, sign: -1 }))];
  const z = () => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0 });
  const a = z(); // 3.1(a) other than zero rated, nil, exempt
  const b = z(); // 3.1(b) zero rated
  let nilExempt = 0;
  let nonGst = 0;
  const unregInter = new Map<string, { taxable: number; igst: number }>();
  for (const { d, sign } of outward) {
    const t = treatmentOf(c.db, d);
    const amt = gstAmounts(d, sign);
    const bucket = t === 'overseas' || t === 'special_economic_zone' ? b : a;
    bucket.taxable += amt.taxable;
    bucket.igst += amt.igst;
    bucket.cgst += amt.cgst;
    bucket.sgst += amt.sgst;
    for (const l of d.lineItems) {
      const k = lineKind(l);
      if (k === 'exempt' || (k === 'gst' && (taxRate(l.taxId)?.rate ?? 0) === 0 && l.taxId)) nilExempt += sign * netLine(d, l);
      if (k === 'non_gst' || k === 'out_of_scope') nonGst += sign * netLine(d, l);
    }
    if (!registered(t) && t !== 'overseas' && t !== 'special_economic_zone' && isInter(c.db, d)) {
      const pos = d.destinationOfSupply || 'Unknown';
      const x = unregInter.get(pos) || { taxable: 0, igst: 0 };
      x.taxable += amt.taxable;
      x.igst += amt.igst;
      unregInter.set(pos, x);
    }
  }
  const inward = inwardDocs(c);
  const rc = z();
  const itc = z();
  let exemptInter = 0;
  let exemptIntra = 0;
  let nonGstInter = 0;
  let nonGstIntra = 0;
  for (const x of inward) {
    const tgt = x.rcm ? rc : itc;
    tgt.taxable += x.taxable;
    tgt.igst += x.igst;
    tgt.cgst += x.cgst;
    tgt.sgst += x.sgst;
    if (x.inter) {
      exemptInter += x.exempt;
      nonGstInter += x.nonGst;
    } else {
      exemptIntra += x.exempt;
      nonGstIntra += x.nonGst;
    }
  }
  const r = (o: { taxable: number; igst: number; cgst: number; sgst: number }) => ({ taxable: round2(o.taxable), igst: round2(o.igst), cgst: round2(o.cgst), sgst: round2(o.sgst), tax: round2(o.igst + o.cgst + o.sgst) });
  const rows: Row[] = [
    { c: { section: '3.1 Details of Outward Supplies and inward supplies liable to reverse charge' }, kind: 'section' },
    { c: { section: '(a) Outward taxable supplies (other than zero rated, nil rated and exempted)', ...r(a) }, level: 1 },
    { c: { section: '(b) Outward taxable supplies (zero rated)', ...r(b) }, level: 1 },
    { c: { section: '(c) Other outward supplies (nil rated, exempted)', taxable: round2(nilExempt) }, level: 1 },
    { c: { section: '(d) Inward supplies (liable to reverse charge)', ...r(rc) }, level: 1 },
    { c: { section: '(e) Non-GST outward supplies', taxable: round2(nonGst) }, level: 1 },
    { c: { section: '3.2 Inter-state supplies made to unregistered persons' }, kind: 'section' },
    ...[...unregInter.entries()].map(([pos, v]) => ({ c: { section: `Place of supply: ${INDIAN_STATES.find((s) => s.name === pos) ? `${INDIAN_STATES.find((s) => s.name === pos)!.code}-${pos}` : pos}`, taxable: round2(v.taxable), igst: round2(v.igst), tax: round2(v.igst) }, level: 1 }) as Row),
    { c: { section: '4. Eligible ITC' }, kind: 'section' },
    { c: { section: '(A)(3) Inward supplies liable to reverse charge', ...r(rc), taxable: undefined }, level: 1 },
    { c: { section: '(A)(5) All other ITC', ...r(itc), taxable: undefined }, level: 1 },
    { c: { section: '(B) ITC Reversed', igst: 0, cgst: 0, sgst: 0, tax: 0 }, level: 1 },
    total({ section: '(C) Net ITC Available (A) - (B)', ...r({ taxable: 0, igst: rc.igst + itc.igst, cgst: rc.cgst + itc.cgst, sgst: rc.sgst + itc.sgst }), taxable: '' as never }, 'sub'),
    { c: { section: '5. Values of exempt, nil-rated and non-GST inward supplies' }, kind: 'section' },
    { c: { section: 'From a supplier under composition scheme, Exempt and Nil rated supply (Inter-State)', taxable: round2(exemptInter) }, level: 1 },
    { c: { section: 'From a supplier under composition scheme, Exempt and Nil rated supply (Intra-State)', taxable: round2(exemptIntra) }, level: 1 },
    { c: { section: 'Non GST supply (Inter-State)', taxable: round2(nonGstInter) }, level: 1 },
    { c: { section: 'Non GST supply (Intra-State)', taxable: round2(nonGstIntra) }, level: 1 },
  ];
  const payable = { igst: a.igst + b.igst + rc.igst - (rc.igst + itc.igst), cgst: a.cgst + b.cgst + rc.cgst - (rc.cgst + itc.cgst), sgst: a.sgst + b.sgst + rc.sgst - (rc.sgst + itc.sgst) };
  rows.push(total({ section: '6.1 Tax payable after ITC (before set-off rules and cash ledger)', igst: round2(payable.igst), cgst: round2(payable.cgst), sgst: round2(payable.sgst), tax: round2(payable.igst + payable.cgst + payable.sgst) }, 'grand'));
  return { columns: GST_COLS.filter((x) => x.key !== 'count').map((x) => (x.key === 'section' ? { ...x, label: 'Nature of Supplies' } : x)), rows, notes: ['Credit notes reduce outward supplies and debit notes reduce ITC in the same period. Negative tax payable means excess ITC carried forward.'] };
}

function gstByRate(c: Ctx) {
  const m = new Map<number, { sales: number; outTax: number; purchases: number; inTax: number }>();
  const add = (d: TxnDoc, sign: number, side: 'out' | 'in') => {
    const disc = d.subTotal ? 1 - d.discountAmount / d.subTotal : 1;
    for (const l of d.lineItems) {
      const tr = taxRate(l.taxId);
      if (!tr || tr.kind !== 'gst') continue;
      const x = m.get(tr.rate) || { sales: 0, outTax: 0, purchases: 0, inTax: 0 };
      if (side === 'out') {
        x.sales += sign * netLine(d, l) * disc;
        x.outTax += sign * (l.taxAmount || 0) * disc;
      } else {
        x.purchases += sign * netLine(d, l) * disc;
        x.inTax += sign * (l.taxAmount || 0) * disc;
      }
      m.set(tr.rate, x);
    }
  };
  docsOf(c, 'invoice').forEach((d) => add(d, 1, 'out'));
  docsOf(c, 'credit_note').forEach((d) => add(d, -1, 'out'));
  docsOf(c, 'bill').forEach((d) => add(d, 1, 'in'));
  docsOf(c, 'vendor_credit').forEach((d) => add(d, -1, 'in'));
  for (const e of expensesIn(c)) {
    const tr = taxRate(e.taxId);
    if (!tr || tr.kind !== 'gst' || !e.taxAmount) continue;
    const x = m.get(tr.rate) || { sales: 0, outTax: 0, purchases: 0, inTax: 0 };
    x.purchases += e.subTotal ?? e.amount;
    x.inTax += e.taxAmount;
    m.set(tr.rate, x);
  }
  const rows: Row[] = [...m.entries()].sort(([a], [b]) => a - b).map(([rate, v]) => ({ c: { rate: `GST ${rate}%`, sales: round2(v.sales), outTax: round2(v.outTax), purchases: round2(v.purchases), inTax: round2(v.inTax), net: round2(v.outTax - v.inTax) } }));
  rows.push(total({ rate: 'Total', sales: sum(rows.map((r) => Number(r.c.sales))), outTax: sum(rows.map((r) => Number(r.c.outTax))), purchases: sum(rows.map((r) => Number(r.c.purchases))), inTax: sum(rows.map((r) => Number(r.c.inTax))), net: sum(rows.map((r) => Number(r.c.net))) }));
  return { columns: [{ key: 'rate', label: 'Tax Rate' }, { key: 'sales', label: 'Taxable Sales', type: 'money' as ColType }, { key: 'outTax', label: 'Output Tax', type: 'money' as ColType }, { key: 'purchases', label: 'Taxable Purchases', type: 'money' as ColType }, { key: 'inTax', label: 'Input Tax', type: 'money' as ColType }, { key: 'net', label: 'Net Tax', type: 'money' as ColType }], rows };
}

function reverseCharge(c: Ctx) {
  const xs = inwardDocs(c).filter((x) => x.rcm);
  const rows: Row[] = xs.map((x) => ({ c: { date: x.date, number: x.number, type: x.type, contact: name(c.db, x.contactId), gstin: x.gstin, taxable: x.taxable, igst: x.igst, cgst: x.cgst, sgst: x.sgst, tax: round2(x.igst + x.cgst + x.sgst) }, link: x.link }));
  rows.push(total({ date: 'Total', taxable: sum(xs.map((x) => x.taxable)), igst: sum(xs.map((x) => x.igst)), cgst: sum(xs.map((x) => x.cgst)), sgst: sum(xs.map((x) => x.sgst)), tax: sum(xs.map((x) => x.igst + x.cgst + x.sgst)) }));
  return { columns: [{ key: 'date', label: 'Date', type: 'date' as ColType }, { key: 'number', label: 'Transaction#' }, { key: 'type', label: 'Type' }, { key: 'contact', label: 'Supplier Name' }, { key: 'gstin', label: 'GSTIN', hidden: true }, { key: 'taxable', label: 'Taxable Value', type: 'money' as ColType }, { key: 'igst', label: 'IGST', type: 'money' as ColType }, { key: 'cgst', label: 'CGST', type: 'money' as ColType }, { key: 'sgst', label: 'SGST', type: 'money' as ColType }, { key: 'tax', label: 'Tax Payable (RCM)', type: 'money' as ColType }], rows };
}

function tcsSummary(c: Ctx) {
  const rows: Row[] = [];
  for (const d of docsOf(c, 'invoice')) if (d.tcsAmount) rows.push({ c: { date: d.date, number: d.number, type: 'Invoice (collected)', contact: name(c.db, d.contactId), base: taxableValue(d), rate: d.tcsRate, amount: d.tcsAmount }, link: docLink(d) });
  for (const d of docsOf(c, 'bill')) if (d.tcsAmount) rows.push({ c: { date: d.date, number: d.number, type: 'Bill (paid)', contact: name(c.db, d.contactId), base: taxableValue(d), rate: d.tcsRate, amount: -d.tcsAmount }, link: docLink(d) });
  rows.sort((a, b) => String(a.c.date).localeCompare(String(b.c.date)));
  rows.push(total({ date: 'Net TCS Payable', amount: sum(rows.map((r) => Number(r.c.amount))) }));
  return { columns: [{ key: 'date', label: 'Date', type: 'date' as ColType }, { key: 'number', label: 'Transaction#' }, { key: 'type', label: 'Type' }, { key: 'contact', label: 'Contact' }, { key: 'base', label: 'Taxable Amount', type: 'money' as ColType }, { key: 'rate', label: 'TCS Rate (%)', type: 'number' as ColType }, { key: 'amount', label: 'TCS Amount', type: 'money' as ColType }], rows, notes: ['TCS collected on invoices is payable; TCS charged on bills is receivable and shown as negative.'] };
}

// ------------------------------------------------------------------ banking

function reconciliationStatus(c: Ctx) {
  const accs = c.db.accounts.filter((a) => ['bank', 'cash', 'credit_card'].includes(a.subType) && a.active);
  const rows: Row[] = accs.map((a) => {
    const recs = c.db.reconciliations.filter((r) => r.accountId === a.id && r.status === 'reconciled').sort((x, y) => y.endDate.localeCompare(x.endDate));
    const cleared = new Set(recs.flatMap((r) => r.cleared));
    const unc = c.db.journals.filter((j) => j.date <= c.to && !cleared.has(j.id) && j.lines.some((l) => l.accountId === a.id));
    const amt = sum(unc.flatMap((j) => j.lines.filter((l) => l.accountId === a.id).map((l) => l.debit - l.credit)));
    const b = c.db.journals.filter((j) => j.date <= c.to).flatMap((j) => j.lines.filter((l) => l.accountId === a.id)).reduce((s, l) => s + signedBal(a, l.debit, l.credit), 0);
    return { c: { account: a.name, books: round2(b), last: recs[0]?.endDate, reconciledBalance: recs[0]?.closingBalance, uncleared: unc.length, unclearedAmount: amt, uncategorized: c.db.statementLines.filter((l) => l.accountId === a.id && l.status === 'uncategorized').length }, link: `/banking/${a.id}` };
  });
  return { columns: [{ key: 'account', label: 'Account' }, { key: 'books', label: 'Balance in Books', type: 'money' as ColType }, { key: 'last', label: 'Last Reconciled', type: 'date' as ColType }, { key: 'reconciledBalance', label: 'Reconciled Balance', type: 'money' as ColType }, { key: 'uncleared', label: 'Uncleared Transactions', type: 'number' as ColType }, { key: 'unclearedAmount', label: 'Uncleared Amount', type: 'money' as ColType }, { key: 'uncategorized', label: 'Uncategorized Lines', type: 'number' as ColType }], rows, subtitle: `As of ${fmt(c.to)}` };
}

function statementLines(c: Ctx) {
  const ls = c.db.statementLines.filter((l) => inR(l.date, c) && (!c.p.account || l.accountId === c.p.account) && (!c.p.status || c.p.status === 'all' || l.status === c.p.status)).sort((a, b) => a.date.localeCompare(b.date));
  const rows: Row[] = ls.map((l) => ({ c: { date: l.date, account: accName(c.db, l.accountId), description: l.description, reference: l.reference, status: label(l.status), deposit: l.deposit || undefined, withdrawal: l.withdrawal || undefined }, link: `/banking/${l.accountId}` }));
  rows.push(total({ date: 'Total', deposit: sum(ls.map((l) => l.deposit)), withdrawal: sum(ls.map((l) => l.withdrawal)) }));
  return { columns: [{ key: 'date', label: 'Date', type: 'date' as ColType }, { key: 'account', label: 'Account' }, { key: 'description', label: 'Description' }, { key: 'reference', label: 'Reference#' }, { key: 'status', label: 'Status' }, { key: 'deposit', label: 'Deposits', type: 'money' as ColType }, { key: 'withdrawal', label: 'Withdrawals', type: 'money' as ColType }], rows };
}

// ------------------------------------------------------------------ projects

function timesheetDetails(c: Ctx) {
  const es = c.db.timeEntries.filter((t) => inR(t.date, c) && (!c.p.project || t.projectId === c.p.project)).sort((a, b) => a.date.localeCompare(b.date));
  const rows: Row[] = es.map((t) => {
    const p = c.db.projects.find((x) => x.id === t.projectId);
    return { c: { date: t.date, project: p?.name, customer: name(c.db, p?.customerId), task: p?.tasks.find((k) => k.id === t.taskId)?.name ?? t.task, user: c.db.users.find((u) => u.id === t.userId)?.name, notes: t.notes, billable: t.billable ? 'Yes' : 'No', status: t.invoiced ? 'Invoiced' : t.billable ? 'Unbilled' : 'Non-billable', hours: t.hours }, link: `/time-tracking/projects/${t.projectId}` };
  });
  rows.push(total({ date: 'Total', hours: sum(es.map((t) => t.hours)) }));
  return { columns: [{ key: 'date', label: 'Date', type: 'date' as ColType }, { key: 'project', label: 'Project Name' }, { key: 'customer', label: 'Client Name' }, { key: 'task', label: 'Task Name' }, { key: 'user', label: 'Staff' }, { key: 'notes', label: 'Notes', hidden: true }, { key: 'billable', label: 'Billable', hidden: true }, { key: 'status', label: 'Status' }, { key: 'hours', label: 'Logged Hours', type: 'hours' as ColType }], rows };
}

function projectSummary(c: Ctx) {
  const ps = c.db.projects.filter((p) => !c.p.project || p.id === c.p.project);
  const rows: Row[] = ps.map((p) => {
    const s = projectStats(c.db, p);
    const expenses = sum(c.db.expenses.filter((e) => e.projectId === p.id).map((e) => e.amount));
    return { c: { project: p.name, customer: name(c.db, p.customerId), method: label(p.billingMethod), status: label(p.status), logged: s.loggedHours, billable: s.billableHours, billed: s.billedHours, unbilled: s.unbilledHours, billedAmount: s.billedAmount, unbilledAmount: s.unbilledAmount, expenses, profit: round2(s.billedAmount - expenses) }, link: `/time-tracking/projects/${p.id}` };
  });
  return { columns: [{ key: 'project', label: 'Project Name' }, { key: 'customer', label: 'Client Name' }, { key: 'method', label: 'Billing Method', hidden: true }, { key: 'status', label: 'Status', hidden: true }, { key: 'logged', label: 'Logged Hours', type: 'hours' as ColType }, { key: 'billable', label: 'Billable Hours', type: 'hours' as ColType }, { key: 'billed', label: 'Billed Hours', type: 'hours' as ColType }, { key: 'unbilled', label: 'Unbilled Hours', type: 'hours' as ColType }, { key: 'billedAmount', label: 'Billed Amount', type: 'money' as ColType }, { key: 'unbilledAmount', label: 'Unbilled Amount', type: 'money' as ColType }, { key: 'expenses', label: 'Expenses', type: 'money' as ColType, hidden: true }, { key: 'profit', label: 'Profit', type: 'money' as ColType, hidden: true }], rows, notes: ['Totals are for the whole life of each project.'] };
}

function projectDetails(c: Ctx) {
  const rows: Row[] = [];
  for (const p of c.db.projects.filter((x) => !c.p.project || x.id === c.p.project)) {
    const es = c.db.timeEntries.filter((t) => t.projectId === p.id && inR(t.date, c));
    if (!es.length) continue;
    rows.push({ c: { name: `${p.name}${p.customerId ? ` · ${name(c.db, p.customerId)}` : ''}` }, kind: 'section', link: `/time-tracking/projects/${p.id}` });
    const keyOf = (t: (typeof es)[number]) => `${p.tasks.find((k) => k.id === t.taskId)?.name ?? t.task ?? 'No task'}|${c.db.users.find((u) => u.id === t.userId)?.name ?? ''}`;
    const m = new Map<string, { hours: number; billable: number; billed: number }>();
    for (const t of es) {
      const x = m.get(keyOf(t)) || { hours: 0, billable: 0, billed: 0 };
      x.hours += t.hours;
      if (t.billable) x.billable += t.hours;
      if (t.invoiced) x.billed += t.hours;
      m.set(keyOf(t), x);
    }
    for (const [k, v] of m) {
      const [task, user] = k.split('|');
      rows.push({ c: { name: task, user, hours: round2(v.hours), billable: round2(v.billable), billed: round2(v.billed) }, level: 1 });
    }
    rows.push(total({ name: `Total for ${p.name}`, hours: sum(es.map((t) => t.hours)), billable: sum(es.filter((t) => t.billable).map((t) => t.hours)), billed: sum(es.filter((t) => t.invoiced).map((t) => t.hours)) }, 'sub'));
  }
  return { columns: [{ key: 'name', label: 'Project / Task' }, { key: 'user', label: 'Staff' }, { key: 'hours', label: 'Logged Hours', type: 'hours' as ColType }, { key: 'billable', label: 'Billable Hours', type: 'hours' as ColType }, { key: 'billed', label: 'Billed Hours', type: 'hours' as ColType }], rows };
}

// ------------------------------------------------------------------ accountant

function journalDetail(db: Database, j: Journal) {
  switch (j.sourceType) {
    case 'invoice':
    case 'credit_note':
    case 'bill':
    case 'vendor_credit': {
      const d = db.docs.find((x) => x.id === j.sourceId);
      return { number: d?.number ?? j.number, link: d ? docLink(d) : undefined };
    }
    case 'payment_received':
      return { number: db.paymentsReceived.find((x) => x.id === j.sourceId)?.number ?? j.number, link: `/sales/payments-received/${j.sourceId}` };
    case 'payment_made':
      return { number: db.paymentsMade.find((x) => x.id === j.sourceId)?.number ?? j.number, link: `/purchases/payments-made/${j.sourceId}` };
    case 'expense':
      return { number: j.reference || 'Expense', link: `/purchases/expenses/${j.sourceId}` };
    case 'manual':
      return { number: j.number, link: `/accountant/manual-journals/${j.id}` };
    case 'bank_transaction': {
      const t = db.bankTransactions.find((x) => x.id === j.sourceId);
      return { number: j.reference || j.number, link: t ? `/banking/${t.accountId}` : undefined };
    }
    default:
      return { number: j.number, link: `/accountant/journals/${j.id}` };
  }
}

function accountTransactions(c: Ctx) {
  const acc = c.p.account ? c.db.accounts.find((a) => a.id === c.p.account) : undefined;
  const js = ledger(c.db, c.basis);
  const rows: Row[] = [];
  let opening = 0;
  if (acc) {
    opening = round2(js.filter((j) => j.date < c.from).flatMap((j) => j.lines.filter((l) => l.accountId === acc.id)).reduce((s, l) => s + signedBal(acc, l.debit, l.credit), 0));
    rows.push({ c: { date: c.from, account: acc.name, details: 'Opening Balance', balance: opening }, kind: 'sub' });
  }
  let bal = opening;
  let dr = 0;
  let cr = 0;
  for (const j of js.filter((x) => inR(x.date, c)).sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)))) {
    for (const l of j.lines) {
      if (acc ? l.accountId !== acc.id : false) continue;
      const a = c.db.accounts.find((x) => x.id === l.accountId);
      const d = journalDetail(c.db, j);
      dr += l.debit;
      cr += l.credit;
      if (acc) bal = round2(bal + signedBal(acc, l.debit, l.credit));
      rows.push({ c: { date: j.date, account: a?.name, details: l.description || j.notes || '', type: sourceLabel(j.sourceType), number: d.number, reference: j.reference, contact: name(c.db, l.contactId || j.contactId), debit: l.debit || undefined, credit: l.credit || undefined, balance: acc ? bal : undefined }, link: d.link });
    }
  }
  rows.push(total({ date: 'Total', debit: round2(dr), credit: round2(cr) }, 'sub'));
  if (acc) rows.push(total({ date: 'Closing Balance', balance: bal }, 'grand'));
  return {
    columns: [
      { key: 'date', label: 'Date', type: 'date' as ColType },
      { key: 'account', label: 'Account', hidden: !!acc },
      { key: 'details', label: 'Transaction Details' },
      { key: 'type', label: 'Transaction Type' },
      { key: 'number', label: 'Transaction#' },
      { key: 'reference', label: 'Reference#', hidden: true },
      { key: 'contact', label: 'Contact', hidden: true },
      { key: 'debit', label: 'Debit', type: 'money' as ColType },
      { key: 'credit', label: 'Credit', type: 'money' as ColType },
      ...(acc ? [{ key: 'balance', label: 'Running Balance', type: 'money' as ColType }] : []),
    ],
    rows,
    subtitle: acc ? `${acc.name} · From ${fmt(c.from)} To ${fmt(c.to)}` : undefined,
  };
}

function accountTypeSummary(c: Ctx) {
  const b = balances(c, { from: c.from, to: c.to });
  const rows: Row[] = [];
  for (const g of ['Asset', 'Liability', 'Equity', 'Income', 'Expense']) {
    const types = ACCOUNT_TYPES.filter((t) => t.group === g);
    const items = types
      .map((t) => {
        const accs = c.db.accounts.filter((a) => a.subType === t.subType);
        const dr = sum(accs.map((a) => b.get(a.id)?.debit ?? 0));
        const cr = sum(accs.map((a) => b.get(a.id)?.credit ?? 0));
        return { c: { type: t.label, debit: dr, credit: cr, balance: round2(t.type === 'asset' || t.type === 'expense' ? dr - cr : cr - dr) }, level: 1 } as Row;
      })
      .filter((r) => r.c.debit || r.c.credit);
    if (!items.length) continue;
    rows.push({ c: { type: g }, kind: 'section' }, ...items);
  }
  return { columns: [{ key: 'type', label: 'Account Type' }, { key: 'debit', label: 'Debit', type: 'money' as ColType }, { key: 'credit', label: 'Credit', type: 'money' as ColType }, { key: 'balance', label: 'Balance', type: 'money' as ColType }], rows };
}

function accountTypeTransactions(c: Ctx) {
  const js = ledger(c.db, c.basis).filter((j) => inR(j.date, c)).sort((a, b) => a.date.localeCompare(b.date));
  const rows: Row[] = [];
  for (const t of ACCOUNT_TYPES) {
    const ids = new Set(c.db.accounts.filter((a) => a.subType === t.subType).map((a) => a.id));
    const lines = js.flatMap((j) => j.lines.filter((l) => ids.has(l.accountId)).map((l) => ({ j, l })));
    if (!lines.length) continue;
    rows.push({ c: { date: t.label }, kind: 'section' });
    for (const { j, l } of lines) {
      const d = journalDetail(c.db, j);
      rows.push({ c: { date: j.date, account: accName(c.db, l.accountId), type: sourceLabel(j.sourceType), number: d.number, debit: l.debit || undefined, credit: l.credit || undefined }, level: 1, link: d.link });
    }
    rows.push(total({ date: `Total for ${t.label}`, debit: sum(lines.map((x) => x.l.debit)), credit: sum(lines.map((x) => x.l.credit)) }, 'sub'));
  }
  return { columns: [{ key: 'date', label: 'Date', type: 'date' as ColType }, { key: 'account', label: 'Account' }, { key: 'type', label: 'Transaction Type' }, { key: 'number', label: 'Transaction#' }, { key: 'debit', label: 'Debit', type: 'money' as ColType }, { key: 'credit', label: 'Credit', type: 'money' as ColType }], rows };
}

function generalLedger(c: Ctx) {
  const before = balances(c, { to: prevDay(c.from) });
  const during = balances(c, { from: c.from, to: c.to });
  const rows: Row[] = c.db.accounts
    .filter((a) => !c.p.account || a.id === c.p.account)
    .map((a) => {
      const v = during.get(a.id) || { debit: 0, credit: 0 };
      const opening = bal(c, before, a);
      return { c: { account: a.name, code: a.code, type: accountTypeLabel(a.subType), opening, debit: round2(v.debit), credit: round2(v.credit), closing: round2(opening + signedBal(a, v.debit, v.credit)) }, link: acctLink(c, a.id) };
    })
    .filter((r) => r.c.opening || r.c.debit || r.c.credit);
  rows.push(total({ account: 'Total', debit: sum(rows.map((r) => Number(r.c.debit))), credit: sum(rows.map((r) => Number(r.c.credit))) }));
  return { columns: [{ key: 'account', label: 'Account' }, { key: 'code', label: 'Account Code', hidden: true }, { key: 'type', label: 'Account Type', hidden: true }, { key: 'opening', label: 'Opening Balance', type: 'money' as ColType }, { key: 'debit', label: 'Debit', type: 'money' as ColType }, { key: 'credit', label: 'Credit', type: 'money' as ColType }, { key: 'closing', label: 'Closing Balance', type: 'money' as ColType }], rows };
}

function detailedGeneralLedger(c: Ctx) {
  const js = ledger(c.db, c.basis);
  const rows: Row[] = [];
  for (const a of c.db.accounts.filter((x) => !c.p.account || x.id === c.p.account)) {
    const opening = round2(js.filter((j) => j.date < c.from).flatMap((j) => j.lines.filter((l) => l.accountId === a.id)).reduce((s, l) => s + signedBal(a, l.debit, l.credit), 0));
    const entries = js.filter((j) => inR(j.date, c)).sort((x, y) => x.date.localeCompare(y.date)).flatMap((j) => j.lines.filter((l) => l.accountId === a.id).map((l) => ({ j, l })));
    if (!entries.length && !opening) continue;
    rows.push({ c: { date: a.name }, kind: 'section', link: acctLink(c, a.id) });
    rows.push({ c: { date: c.from, details: 'Opening Balance', balance: opening }, level: 1 });
    let b = opening;
    for (const { j, l } of entries) {
      b = round2(b + signedBal(a, l.debit, l.credit));
      const d = journalDetail(c.db, j);
      rows.push({ c: { date: j.date, details: l.description || name(c.db, l.contactId || j.contactId) || j.notes, type: sourceLabel(j.sourceType), number: d.number, debit: l.debit || undefined, credit: l.credit || undefined, balance: b }, level: 1, link: d.link });
    }
    rows.push(total({ date: `Closing Balance (${a.name})`, debit: sum(entries.map((x) => x.l.debit)), credit: sum(entries.map((x) => x.l.credit)), balance: b }, 'sub'));
  }
  return { columns: [{ key: 'date', label: 'Date', type: 'date' as ColType }, { key: 'details', label: 'Transaction Details' }, { key: 'type', label: 'Transaction Type' }, { key: 'number', label: 'Transaction#' }, { key: 'debit', label: 'Debit', type: 'money' as ColType }, { key: 'credit', label: 'Credit', type: 'money' as ColType }, { key: 'balance', label: 'Balance', type: 'money' as ColType }], rows };
}

function journalReport(c: Ctx) {
  const js = ledger(c.db, c.basis).filter((j) => inR(j.date, c)).sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
  const rows: Row[] = [];
  for (const j of js) {
    const d = journalDetail(c.db, j);
    rows.push({ c: { account: `${fmt(j.date)} · ${sourceLabel(j.sourceType)} ${d.number}${j.contactId ? ` · ${name(c.db, j.contactId)}` : ''}` }, kind: 'section', link: d.link });
    for (const l of j.lines) rows.push({ c: { account: accName(c.db, l.accountId), debit: l.debit || undefined, credit: l.credit || undefined }, level: 1 });
  }
  rows.push(total({ account: 'Total', debit: sum(js.flatMap((j) => j.lines.map((l) => l.debit))), credit: sum(js.flatMap((j) => j.lines.map((l) => l.credit))) }, 'grand'));
  return { columns: [{ key: 'account', label: 'Account' }, { key: 'debit', label: 'Debit', type: 'money' as ColType }, { key: 'credit', label: 'Credit', type: 'money' as ColType }], rows };
}

function trialBalance(c: Ctx) {
  const b = balances(c, { to: c.to });
  const rows: Row[] = [];
  let tdr = 0;
  let tcr = 0;
  for (const g of ['Asset', 'Liability', 'Equity', 'Income', 'Expense']) {
    const accs = c.db.accounts.filter((a) => ACCOUNT_TYPES.find((t) => t.subType === a.subType)?.group === g);
    const items = accs
      .map((a) => {
        const v = b.get(a.id) || { debit: 0, credit: 0 };
        const net = round2(v.debit - v.credit);
        return { c: { account: a.name, code: a.code, debit: net > 0 ? net : undefined, credit: net < 0 ? -net : undefined }, level: 1, link: acctLink({ ...c, from: '1900-01-01' }, a.id) } as Row;
      })
      .filter((r) => r.c.debit || r.c.credit);
    if (!items.length) continue;
    rows.push({ c: { account: g === 'Liability' ? 'Liabilities' : g === 'Equity' ? 'Equities' : `${g}s` }, kind: 'section' }, ...items);
    tdr += sum(items.map((r) => Number(r.c.debit) || 0));
    tcr += sum(items.map((r) => Number(r.c.credit) || 0));
  }
  rows.push(total({ account: 'Total', debit: round2(tdr), credit: round2(tcr) }, 'grand'));
  return { columns: [{ key: 'account', label: 'Account' }, { key: 'code', label: 'Account Code', hidden: true }, { key: 'debit', label: 'Net Debit', type: 'money' as ColType }, { key: 'credit', label: 'Net Credit', type: 'money' as ColType }], rows, subtitle: `As of ${fmt(c.to)}` };
}

// ------------------------------------------------------------------ budgets

function budgetVsActuals(c: Ctx) {
  const b = c.db.budgets.find((x) => x.id === c.p.budget) ?? c.db.budgets[0];
  if (!b) return { columns: [{ key: 'account', label: 'Account' }], rows: [], notes: ['Create a budget in Accountant > Budgets to compare it with actuals.'] };
  const v = budgetView(c.db, b);
  const cols: Col[] = [{ key: 'account', label: 'Account' }];
  v.buckets.forEach((k, i) => {
    cols.push({ key: `b${i}`, label: `${k.label} Budget`, type: 'money', hidden: v.buckets.length > 1 });
    cols.push({ key: `a${i}`, label: `${k.label} Actual`, type: 'money', hidden: v.buckets.length > 1 });
  });
  cols.push({ key: 'budget', label: 'Budget', type: 'money' }, { key: 'actual', label: 'Actual', type: 'money' }, { key: 'variance', label: 'Over / Under Budget', type: 'money' }, { key: 'pct', label: '% of Budget', type: 'percent' });
  const rows: Row[] = [];
  const groupRows = (type: string, title: string) => {
    const ls = v.lines.filter((l) => l.accountType === type);
    if (!ls.length) return { budget: 0, actual: 0 };
    rows.push({ c: { account: title }, kind: 'section' });
    for (const l of ls) {
      const cells: Record<string, number | string> = { account: l.accountName, budget: l.total, actual: l.actualTotal, variance: round2(l.actualTotal - l.total), pct: l.total ? round2((l.actualTotal / l.total) * 100) : 0 };
      l.amounts.forEach((a, i) => {
        cells[`b${i}`] = a;
        cells[`a${i}`] = l.actuals[i];
      });
      rows.push({ c: cells, level: 1 });
    }
    const bt = sum(ls.map((l) => l.total));
    const at = sum(ls.map((l) => l.actualTotal));
    rows.push(total({ account: `Total ${title}`, budget: bt, actual: at, variance: round2(at - bt), pct: bt ? round2((at / bt) * 100) : 0 }, 'sub'));
    return { budget: bt, actual: at };
  };
  const inc = groupRows('income', 'Income');
  const exp = groupRows('expense', 'Expense');
  for (const t of ['asset', 'liability', 'equity']) groupRows(t, label(t));
  const nb = round2(inc.budget - exp.budget);
  const na = round2(inc.actual - exp.actual);
  rows.push(total({ account: 'Net Profit', budget: nb, actual: na, variance: round2(na - nb), pct: nb ? round2((na / nb) * 100) : 0 }, 'grand'));
  return { columns: cols, rows, subtitle: `${b.name} · ${v.buckets[0]?.from ? `FY starting ${fmt(b.fiscalYearStart)}` : ''}${v.projectName ? ` · ${v.projectName}` : ''}`, notes: ['Turn on the period columns in Customize Columns to compare each month or quarter.'] };
}

// ------------------------------------------------------------------ currency and activity

function currencyGainLoss(realized: boolean) {
  return () => ({
    columns: [{ key: 'date', label: 'Date', type: 'date' as ColType }, { key: 'transaction', label: 'Transaction' }, { key: 'contact', label: 'Contact' }, { key: 'currency', label: 'Currency' }, { key: 'amount', label: realized ? 'Realized Gain / Loss' : 'Unrealized Gain / Loss', type: 'money' as ColType }],
    rows: [total({ date: 'Total', amount: 0 })],
    notes: ['Creatign Ledger records every transaction in INR, so there are no foreign currency balances to revalue. Exchange rates are kept in Accountant > FX Revaluations.'],
  });
}

function systemMails(c: Ctx) {
  const ms = c.db.mails.filter((m) => inR(m.createdAt.slice(0, 10), c)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const rows: Row[] = ms.map((m) => ({ c: { date: m.createdAt.slice(0, 10), to: m.to.join(', '), subject: m.subject, type: label(m.entityType || (m.system ? 'system' : 'email')), contact: name(c.db, m.contactId), status: label(m.status || (m.delivered === false ? 'outbox' : 'sent')) } }));
  return { columns: [{ key: 'date', label: 'Date', type: 'date' as ColType }, { key: 'to', label: 'To' }, { key: 'subject', label: 'Subject' }, { key: 'type', label: 'Type' }, { key: 'contact', label: 'Contact', hidden: true }, { key: 'status', label: 'Status' }], rows };
}

function activityLogs(c: Ctx, portal = false) {
  const acts = c.db.activities.filter((a) => inR(a.createdAt.slice(0, 10), c) && (!portal || /portal|customer viewed|accepted|declined|viewed by|payment notice|shared link/i.test(`${a.message} ${a.author}`))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const rows: Row[] = acts.map((a) => ({ c: { time: a.createdAt.replace('T', ' ').slice(0, 16), author: a.author, entity: label(a.entityType), contact: name(c.db, a.contactId), message: a.message, detail: a.detail } }));
  if (portal)
    for (const s of c.db.shareLinks.filter((x) => x.lastViewedAt && inR(x.lastViewedAt.slice(0, 10), c))) {
      const d = c.db.docs.find((x) => x.id === s.entityId);
      rows.push({ c: { time: (s.lastViewedAt as string).replace('T', ' ').slice(0, 16), author: 'Client', entity: label(s.entityType), contact: name(c.db, d?.contactId), message: `Viewed ${d?.number ?? 'shared link'} (${s.views ?? 1} view${(s.views ?? 1) === 1 ? '' : 's'})` } });
    }
  return { columns: [{ key: 'time', label: 'Date and Time' }, { key: 'author', label: 'User' }, { key: 'entity', label: 'Module' }, { key: 'contact', label: 'Contact', hidden: true }, { key: 'message', label: 'Activity' }, { key: 'detail', label: 'Details' }], rows };
}

// ------------------------------------------------------------------ catalogue

const P: FilterKey[] = ['period'];
const PB: FilterKey[] = ['period', 'basis'];

export const REPORTS: ReportDef[] = [
  // Business Overview
  { key: 'profit-and-loss', name: 'Profit and Loss', category: 'Financial Statements', description: 'Income, expenses and net profit for a period.', filters: PB, run: profitAndLoss },
  { key: 'profit-and-loss-schedule-iii', name: 'Profit and Loss (Schedule III)', category: 'Financial Statements', description: 'Statement of profit and loss in the Companies Act Schedule III format.', filters: PB, run: profitAndLossScheduleIII },
  { key: 'horizontal-profit-and-loss', name: 'Horizontal Profit and Loss', category: 'Financial Statements', description: 'Expenses and income side by side.', filters: PB, run: horizontalPnl },
  { key: 'cash-flow-statement', name: 'Cash Flow Statement', category: 'Financial Statements', description: 'Cash from operating, investing and financing activities.', filters: PB, run: cashFlow },
  { key: 'balance-sheet', name: 'Balance Sheet', category: 'Financial Statements', description: 'Assets, liabilities and equity as of a date.', filters: ['asOf', 'basis'], run: balanceSheet },
  { key: 'horizontal-balance-sheet', name: 'Horizontal Balance Sheet', category: 'Financial Statements', description: 'Liabilities and equity beside assets.', filters: ['asOf', 'basis'], run: horizontalBalanceSheet },
  { key: 'balance-sheet-schedule-iii', name: 'Balance Sheet (Schedule III)', category: 'Financial Statements', description: 'Balance sheet in the Companies Act Schedule III format.', filters: ['asOf', 'basis'], run: balanceSheetScheduleIII },
  { key: 'business-performance-ratios', name: 'Business Performance Ratios', category: 'Financial Statements', description: 'Liquidity, solvency, profitability and efficiency ratios.', filters: PB, run: ratios },
  { key: 'movement-of-equity', name: 'Movement of Equity', category: 'Financial Statements', description: 'Opening, additions, deductions and closing of equity accounts.', filters: PB, run: movementOfEquity },
  // Sales
  { key: 'sales-by-customer', name: 'Sales by Client', category: 'Revenue', description: 'Invoice count and sales for each client.', filters: ['period', 'customer'], run: salesByCustomer },
  { key: 'sales-by-item', name: 'Sales by Item', category: 'Revenue', description: 'Quantity sold and sales for each item.', filters: ['period', 'item'], run: salesByItem },
  { key: 'sales-by-salesperson', name: 'Sales by Sales Person', category: 'Revenue', description: 'Sales brought in by each sales person.', filters: P, run: salesBySalesperson },
  { key: 'sales-summary', name: 'Sales Summary', category: 'Revenue', description: 'Sales month by month.', filters: P, run: salesSummary },
  // Receivables
  { key: 'ar-aging-summary', name: 'AR Aging Summary', category: 'Receivables', description: 'Unpaid invoices by client and age.', filters: ['asOf', 'customer'], run: (c) => agingSummary(c, 'invoice') },
  { key: 'ar-aging-details', name: 'AR Aging Details', category: 'Receivables', description: 'Each unpaid invoice grouped by age.', filters: ['asOf', 'customer'], run: (c) => agingDetails(c, 'invoice') },
  { key: 'invoice-details', name: 'Invoice Details', category: 'Receivables', description: 'Every invoice with its status and balance.', filters: ['period', 'customer', 'status'], run: (c) => docDetails(c, 'invoice', { contact: 'Client Name', number: 'Invoice#', balance: 'Balance Due' }) },
  { key: 'sales-order-details', name: 'Sales Order Details', category: 'Receivables', description: 'Sales orders and their invoicing status.', filters: ['period', 'customer', 'status'], run: (c) => docDetails(c, 'sales_order', { contact: 'Client Name', number: 'Sales Order#', extra: [{ key: 'invoiced', label: 'Invoiced Status' }, { key: 'shipment', label: 'Shipment', hidden: true }], extraOf: (d) => ({ invoiced: label(d.invoiceStatus), shipment: label(d.shipmentStatus) }) }) },
  { key: 'delivery-challan-details', name: 'Delivery Challan Details', category: 'Receivables', description: 'Delivery challans by type and status.', filters: ['period', 'customer', 'status'], run: (c) => docDetails(c, 'delivery_challan', { contact: 'Client Name', number: 'Delivery Challan#', extra: [{ key: 'challanType', label: 'Challan Type' }], extraOf: (d) => ({ challanType: label(d.challanType) }) }) },
  { key: 'quote-details', name: 'Estimate Details', category: 'Receivables', description: 'Estimates with expiry and status.', filters: ['period', 'customer', 'status'], run: (c) => docDetails(c, 'quote', { contact: 'Client Name', number: 'Estimate#', extra: [{ key: 'expiry', label: 'Expiry Date', type: 'date' }], extraOf: (d) => ({ expiry: d.expiryDate }) }) },
  { key: 'customer-balance-summary', name: 'Client Balance Summary', category: 'Receivables', description: 'Invoiced, received and closing balance per client.', filters: ['period', 'customer'], run: (c) => contactBalanceSummary(c, 'customer') },
  { key: 'receivable-summary', name: 'Receivable Summary', category: 'Receivables', description: 'Invoices and credit notes with balances.', filters: ['period', 'customer', 'status'], run: (c) => receivableSummary(c, 'sales') },
  { key: 'receivable-details', name: 'Receivable Details', category: 'Receivables', description: 'Item level detail of invoices and credit notes.', filters: ['period', 'customer', 'status'], run: (c) => receivableDetails(c, 'sales') },
  { key: 'bad-debts', name: 'Bad Debts', category: 'Receivables', description: 'Invoices written off.', filters: ['period', 'customer'], run: badDebts },
  { key: 'bank-charges', name: 'Bank Charges', category: 'Receivables', description: 'Bank charges deducted from client payments.', filters: ['period', 'customer'], run: bankCharges },
  // Client Payments
  { key: 'payments-received', name: 'Client Payments', category: 'Collections', description: 'Client payments with mode and unused amount.', filters: ['period', 'customer'], run: paymentsReceived },
  { key: 'time-to-get-paid', name: 'Time to Get Paid', category: 'Collections', description: 'How quickly each client pays.', filters: ['period', 'customer'], run: timeToGetPaid },
  { key: 'credit-note-details', name: 'Credit Note Details', category: 'Collections', description: 'Credit notes and remaining credits.', filters: ['period', 'customer', 'status'], run: (c) => docDetails(c, 'credit_note', { contact: 'Client Name', number: 'Credit Note#', balance: 'Balance', extra: [{ key: 'invoice', label: 'Invoice#' }], extraOf: (d) => ({ invoice: c.db.docs.find((x) => x.id === d.invoiceId)?.number }) }) },
  { key: 'refund-history', name: 'Refund History', category: 'Collections', description: 'Refunds of credit notes and excess payments.', filters: ['period', 'customer'], run: (c) => refundHistory(c, 'customer') },
  { key: 'withholding-tax', name: 'Withholding Tax', category: 'Collections', description: 'TDS deducted by clients on invoices and payments.', filters: ['period', 'customer'], run: (c) => tdsReceivable(c, true) },
  // Recurring
  { key: 'recurring-invoice-details', name: 'Invoice Schedule Details', category: 'Invoice Schedules', description: 'Recurring profiles with their next run.', filters: ['customer', 'status'], run: recurringInvoiceDetails },
  // Payables
  { key: 'vendor-balance-summary', name: 'Supplier Balance Summary', category: 'Payables', description: 'Billed, paid and closing balance per supplier.', filters: ['period', 'vendor'], run: (c) => contactBalanceSummary(c, 'vendor') },
  { key: 'ap-aging-summary', name: 'AP Aging Summary', category: 'Payables', description: 'Unpaid bills by supplier and age.', filters: ['asOf', 'vendor'], run: (c) => agingSummary(c, 'bill') },
  { key: 'ap-aging-details', name: 'AP Aging Details', category: 'Payables', description: 'Each unpaid bill grouped by age.', filters: ['asOf', 'vendor'], run: (c) => agingDetails(c, 'bill') },
  { key: 'bill-details', name: 'Bill Details', category: 'Payables', description: 'Every bill with its status and balance.', filters: ['period', 'vendor', 'status'], run: (c) => docDetails(c, 'bill', { contact: 'Supplier Name', number: 'Bill#', balance: 'Balance Due' }) },
  { key: 'vendor-credit-details', name: 'Debit Note Details', category: 'Payables', description: 'Supplier credits and remaining credits.', filters: ['period', 'vendor', 'status'], run: (c) => docDetails(c, 'vendor_credit', { contact: 'Supplier Name', number: 'Debit Note#', balance: 'Balance' }) },
  { key: 'payments-made', name: 'Supplier Payments', category: 'Payables', description: 'Supplier payments with mode and unused amount.', filters: ['period', 'vendor'], run: paymentsMade },
  { key: 'vendor-refund-history', name: 'Refund History (Suppliers)', category: 'Payables', description: 'Refunds received from suppliers.', filters: ['period', 'vendor'], run: (c) => refundHistory(c, 'vendor') },
  { key: 'purchase-order-details', name: 'Purchase Order Details', category: 'Payables', description: 'Purchase orders and their billing status.', filters: ['period', 'vendor', 'status'], run: (c) => docDetails(c, 'purchase_order', { contact: 'Supplier Name', number: 'Purchase Order#', extra: [{ key: 'billed', label: 'Billed Status' }], extraOf: (d) => ({ billed: label(d.billedStatus) }) }) },
  { key: 'purchase-orders-by-vendor', name: 'Purchase Orders by Supplier', category: 'Payables', description: 'Purchase order count and value per supplier.', filters: ['period', 'vendor'], run: purchaseOrdersByVendor },
  { key: 'purchase-orders-by-item', name: 'Purchase Order by Item', category: 'Payables', description: 'Quantity ordered per item.', filters: ['period', 'item'], run: purchaseOrdersByItem },
  { key: 'payable-summary', name: 'Payable Summary', category: 'Payables', description: 'Bills and debit notes with balances.', filters: ['period', 'vendor', 'status'], run: (c) => receivableSummary(c, 'purchases') },
  { key: 'payable-details', name: 'Payable Details', category: 'Payables', description: 'Item level detail of bills and debit notes.', filters: ['period', 'vendor', 'status'], run: (c) => receivableDetails(c, 'purchases') },
  // Purchases and Expenses
  { key: 'purchases-by-vendor', name: 'Purchases by Supplier', category: 'Spend Analysis', description: 'Bills and expenses per supplier.', filters: ['period', 'vendor'], run: purchasesByVendor },
  { key: 'purchases-by-item', name: 'Purchases by Item', category: 'Spend Analysis', description: 'Quantity purchased per item.', filters: ['period', 'item'], run: purchasesByItem },
  { key: 'expense-details', name: 'Expense Details', category: 'Spend Analysis', description: 'Every expense recorded.', filters: ['period', 'vendor', 'customer', 'account'], run: (c) => expenseDetails(c) },
  { key: 'expenses-by-category', name: 'Expenses by Category', category: 'Spend Analysis', description: 'Spending per expense account.', filters: PB, run: expensesByCategory },
  { key: 'expenses-by-customer', name: 'Expenses by Client', category: 'Spend Analysis', description: 'Expenses linked to each client.', filters: ['period', 'customer'], run: (c) => expensesGrouped(c, 'customer') },
  { key: 'expenses-by-project', name: 'Expenses by Project', category: 'Spend Analysis', description: 'Expenses linked to each project.', filters: ['period', 'project'], run: (c) => expensesGrouped(c, 'project') },
  { key: 'billable-expense-details', name: 'Billable Expense Details', category: 'Spend Analysis', description: 'Billable expenses and whether they were invoiced.', filters: ['period', 'customer'], run: (c) => expenseDetails(c, (e) => e.billable) },
  { key: 'mileage-expenses', name: 'Mileage Expenses', category: 'Spend Analysis', description: 'Mileage claims by distance and rate.', filters: ['period', 'customer'], run: mileage },
  // Taxes
  { key: 'gstr-1-summary', name: 'GSTR-1 Summary', category: 'GST & Statutory', description: 'Outward supplies by GSTR-1 table, HSN summary and documents issued.', filters: ['period', 'customer'], period: 'previous_month', run: gstr1 },
  { key: 'gstr-3b-summary', name: 'GSTR-3B Summary', category: 'GST & Statutory', description: 'Tables 3.1, 3.2, 4 and 5 of GSTR-3B with tax payable.', filters: P, period: 'previous_month', run: gstr3b },
  { key: 'inward-supplies', name: 'Inward Supplies (GSTR-2B check)', category: 'GST & Statutory', description: 'Bills and expenses with input tax, to compare with GSTR-2B.', filters: ['period', 'vendor'], period: 'previous_month', run: inwardSupplies },
  { key: 'hsn-summary', name: 'HSN/SAC Summary', category: 'GST & Statutory', description: 'Supplies by HSN/SAC code and rate.', filters: ['period', 'status'], period: 'previous_month', run: hsnSummary },
  { key: 'gst-summary', name: 'GST Summary by Rate', category: 'GST & Statutory', description: 'Taxable value and GST by tax rate.', filters: P, period: 'previous_month', run: gstByRate },
  { key: 'reverse-charge-summary', name: 'Reverse Charge Summary', category: 'GST & Statutory', description: 'Purchases where you pay the GST.', filters: ['period', 'vendor'], period: 'previous_month', run: reverseCharge },
  { key: 'tds-receivable-summary', name: 'TDS Receivable Summary', category: 'GST & Statutory', description: 'TDS deducted by clients, per client.', filters: ['period', 'customer'], run: (c) => tdsReceivable(c, false) },
  { key: 'tds-payable-summary', name: 'TDS Payable Summary', category: 'GST & Statutory', description: 'TDS you deducted from suppliers, per supplier.', filters: ['period', 'vendor'], run: (c) => tdsPayable(c, false) },
  { key: 'tcs-summary', name: 'TCS Summary', category: 'GST & Statutory', description: 'TCS collected on sales and paid on purchases.', filters: P, run: tcsSummary },
  // Banking
  { key: 'reconciliation-status', name: 'Reconciliation Status', category: 'Cash & Bank', description: 'Last reconciliation and uncleared items per account.', filters: ['asOf'], run: reconciliationStatus },
  { key: 'bank-statement-lines', name: 'Bank Statement Lines', category: 'Cash & Bank', description: 'Imported statement lines with their status.', filters: ['period', 'account', 'status'], run: statementLines },
  // Projects
  { key: 'timesheet-details', name: 'Timesheet Details', category: 'Projects & Time', description: 'Every time entry logged.', filters: ['period', 'project'], run: timesheetDetails },
  { key: 'project-summary', name: 'Project Summary', category: 'Projects & Time', description: 'Hours and billing per project.', filters: ['project'], run: projectSummary },
  { key: 'project-details', name: 'Project Details', category: 'Projects & Time', description: 'Hours per task and staff for each project.', filters: ['period', 'project'], run: projectDetails },
  // Accountant
  { key: 'account-transactions', name: 'Account Transactions', category: 'General Ledger', description: 'Every posting, or the postings of one account with a running balance.', filters: ['period', 'basis', 'account'], run: accountTransactions },
  { key: 'account-type-summary', name: 'Account Type Summary', category: 'General Ledger', description: 'Debits and credits by account type.', filters: PB, run: accountTypeSummary },
  { key: 'account-type-transactions', name: 'Account Type Transactions', category: 'General Ledger', description: 'Postings grouped by account type.', filters: PB, run: accountTypeTransactions },
  { key: 'general-ledger', name: 'General Ledger', category: 'General Ledger', description: 'Opening, debits, credits and closing per account.', filters: ['period', 'basis', 'account'], run: generalLedger },
  { key: 'detailed-general-ledger', name: 'Detailed General Ledger', category: 'General Ledger', description: 'Every posting per account with running balances.', filters: ['period', 'basis', 'account'], run: detailedGeneralLedger },
  { key: 'journal-report', name: 'Journal Report', category: 'General Ledger', description: 'Every journal with its debit and credit lines.', filters: PB, run: journalReport },
  { key: 'trial-balance', name: 'Trial Balance', category: 'General Ledger', description: 'Net debit or credit of every account.', filters: ['asOf', 'basis'], run: trialBalance },
  // Budgets
  { key: 'budget-vs-actuals', name: 'Budget vs Actuals', category: 'Budgeting', description: 'Budgeted and actual amounts per account.', filters: ['budget'], run: budgetVsActuals },
  // Currency
  { key: 'realized-gain-loss', name: 'Realized Gain or Loss', category: 'Foreign Exchange', description: 'Exchange gains or losses on settled foreign currency transactions.', filters: P, run: currencyGainLoss(true) },
  { key: 'unrealized-gain-loss', name: 'Unrealized Gain or Loss', category: 'Foreign Exchange', description: 'Exchange gains or losses on open foreign currency balances.', filters: ['asOf'], run: currencyGainLoss(false) },
  // Activity
  { key: 'system-mails', name: 'System Mails', category: 'Audit Trail', description: 'Emails sent from Creatign Ledger.', filters: P, run: systemMails },
  { key: 'activity-logs', name: 'Activity Logs', category: 'Audit Trail', description: 'Who changed what, and when.', filters: P, run: (c) => activityLogs(c) },
  { key: 'portal-activities', name: 'Portal Activities', category: 'Audit Trail', description: 'What clients did in the portal and on shared links.', filters: P, run: (c) => activityLogs(c, true) },
];

// ------------------------------------------------------------------ runner

function fmt(d?: string) {
  if (!d) return '';
  const [y, m, dd] = d.split('-');
  return `${dd}/${m}/${y}`;
}
function prevDay(d: string) {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
}
function monthLabel(ym: string) {
  const [y, m] = ym.split('-');
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]} ${y}`;
}

export function catalog() {
  return REPORTS.map(({ run: _run, ...r }) => r);
}

export function runReport(db: Database, key: string, params: Record<string, string | undefined>): ReportResult {
  const def = REPORTS.find((r) => r.key === key);
  if (!def) throw Object.assign(new Error('Unknown report'), { status: 404 });
  const fy = db.organization.fiscalYearStartMonth;
  const period = (params.period as PeriodKey) || def.period || (def.filters.includes('asOf') ? 'today' : 'this_fiscal_year');
  const r = periodRange(period, today(), fy);
  const asOf = def.filters.includes('asOf') && !def.filters.includes('period');
  const from = params.from || (asOf ? '1900-01-01' : r.from || '1900-01-01');
  const to = params.to || r.to || today();
  const basis: Basis = params.basis === 'cash' ? 'cash' : 'accrual';
  // links elsewhere in the app use accountId / customerId / vendorId / budgetId / projectId
  const p = { ...params, account: params.account || params.accountId, customer: params.customer || params.customerId, vendor: params.vendor || params.vendorId, budget: params.budget || params.budgetId, project: params.project || params.projectId, item: params.item || params.itemId };
  const out = def.run({ db, from, to, basis, p });
  return {
    key,
    title: def.name,
    subtitle: out.subtitle ?? (asOf ? `As of ${fmt(to)}` : `From ${fmt(from)} To ${fmt(to)}`) + (def.filters.includes('basis') ? ` · ${basis === 'cash' ? 'Cash' : 'Accrual'} basis` : ''),
    columns: out.columns,
    rows: out.rows,
    notes: out.notes,
  };
}

