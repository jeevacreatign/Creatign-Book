// Multi-currency support. Documents and payments keep their amounts in their own currency together
// with the exchange rate on their date (base-currency units per 1 unit). The ledger converts every
// line to the base currency (INR); differences between the rate an invoice or bill was booked at and
// the rate it is settled at are realized exchange gains or losses. FX revaluations post unrealized
// gains or losses on open balances and reverse them the next day.
import { BASE_CURRENCY, fxOf, isoInfo, moneyIn, rateLabel, rateOn, roundRate, toBase } from '../shared/currency';
import { round2 } from '../shared/format';
import type { Contact, Currency, Database, JournalLine, PaymentMade, PaymentReceived, Refund, RevaluationLine, TxnDoc } from '../shared/types';
import { HttpError } from './http';

export const FX_ACCOUNTS = { realized: 'acc_fx_gain', unrealized: 'acc_fx_unrealized' } as const;

const bad = (msg: string) => new HttpError(400, msg);

export const docRate = (x: { currencyCode?: string; exchangeRate?: number }) => fxOf(x).rate;
export const codeOf = (x: { currencyCode?: string } | undefined) => x?.currencyCode || BASE_CURRENCY;

/** The client's or supplier's currency (contacts saved before multi-currency are INR). */
export const contactCurrency = (c: Pick<Contact, 'currencyCode'> | undefined) => c?.currencyCode || BASE_CURRENCY;

export function findCurrency(db: Database, code: string): Currency | undefined {
  return db.currencies.find((c) => c.code === code);
}

/** Exchange rate entered by the user, validated (positive, at most 6 decimals). */
export function parseRate(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const r = Number(v);
  if (!Number.isFinite(r) || r <= 0) throw bad('Enter a valid exchange rate greater than zero');
  if (r > 1e7) throw bad('The exchange rate is too large');
  return roundRate(r);
}

interface RateCarrier {
  currencyCode?: string;
  exchangeRate?: number;
}

/**
 * Currency and exchange rate for a new or edited transaction. The currency always follows the client or
 * supplier. A new transaction takes the entered rate or the rate on its date; an existing one keeps the
 * rate it was created with unless the change is explicitly confirmed and nothing has been applied to it.
 */
export function resolveFx(
  db: Database,
  opts: {
    label: string;
    contact: Contact;
    body: RateCarrier & { confirmRateChange?: unknown };
    existing?: RateCarrier;
    date: string;
    /** set when payments, credits or refunds already depend on the existing rate */
    applied?: string;
  },
): { currencyCode: string; exchangeRate: number; rateChanged?: { from: number; to: number } } {
  const { contact, body, existing, date, label } = opts;
  const code = contactCurrency(contact);
  const asked = body.currencyCode ? String(body.currencyCode).toUpperCase() : undefined;
  if (asked && asked !== code) {
    throw bad(`${contact.displayName} is billed in ${code}, so this ${label} must be in ${code}, not ${asked}. Change the ${contact.kind === 'customer' ? 'client' : 'supplier'}'s currency first or pick another one.`);
  }
  if (existing && codeOf(existing) !== code) {
    throw bad(`This ${label} is in ${codeOf(existing)} but ${contact.displayName} uses ${code}. Transactions cannot be moved to a contact with another currency.`);
  }
  if (code === BASE_CURRENCY) {
    if (body.exchangeRate != null && (body.exchangeRate as unknown) !== '' && Number(body.exchangeRate) !== 1) throw bad('Transactions in INR always use an exchange rate of 1');
    return { currencyCode: BASE_CURRENCY, exchangeRate: 1 };
  }
  const cur = findCurrency(db, code);
  if (!cur) throw bad(`${code} is not set up. Add it in Settings > Currencies first.`);
  const entered = parseRate(body.exchangeRate);
  if (!existing) return { currencyCode: code, exchangeRate: entered ?? roundRate(rateOn(cur, date)) };
  const kept = fxOf(existing).rate;
  if (entered === undefined || entered === kept) return { currencyCode: code, exchangeRate: kept };
  if (opts.applied) throw bad(`The exchange rate of this ${label} cannot be changed because ${opts.applied}. Remove them first.`);
  if (body.confirmRateChange !== true && body.confirmRateChange !== 'true') {
    throw bad(`This ${label} was recorded at ${rateLabel(code, kept)}. Confirm the exchange rate change to ${rateLabel(code, entered)} to save it.`);
  }
  return { currencyCode: code, exchangeRate: entered, rateChanged: { from: kept, to: entered } };
}

/** Rate for a refund: entered, else the rate on the refund date. */
export function refundRate(db: Database, code: string, date: string, entered: unknown): number {
  if (code === BASE_CURRENCY) return 1;
  return parseRate(entered) ?? roundRate(rateOn(findCurrency(db, code), date));
}

export function assertSameCurrency(a: RateCarrier, aLabel: string, b: RateCarrier, bLabel: string) {
  if (codeOf(a) !== codeOf(b)) throw bad(`Currency mismatch: ${bLabel} is in ${codeOf(b)} but ${aLabel} is in ${codeOf(a)}. Amounts can only be applied within the same currency.`);
}

// ------------------------------------------------------------------ journal conversion

const sumD = (ls: JournalLine[]) => round2(ls.reduce((a, l) => a + l.debit, 0));
const sumC = (ls: JournalLine[]) => round2(ls.reduce((a, l) => a + l.credit, 0));

/**
 * Convert journal lines of a document to the base currency. Every line is rounded to paise on its own;
 * the control line (AR/AP) is exactly total x rate, and the rounding difference is absorbed by the
 * largest other line so the entry still balances.
 */
export function linesInBase(lines: JournalLine[], rate: number, controlAccountId: string): JournalLine[] {
  if (rate === 1) return lines;
  const out = lines.map((l) => ({ ...l, debit: toBase(l.debit, rate), credit: toBase(l.credit, rate) }));
  const diff = round2(sumD(out) - sumC(out));
  if (Math.abs(diff) > 0.004) {
    const others = out.filter((l) => l.accountId !== controlAccountId && (l.debit || l.credit));
    const big = (others.length ? others : out).reduce((a, b) => (Math.max(b.debit, b.credit) > Math.max(a.debit, a.credit) ? b : a));
    if (big.debit) big.debit = round2(big.debit - diff);
    else big.credit = round2(big.credit + diff);
  }
  return out;
}

/** Balance an entry through the realized exchange gain/loss account; returns the gain (+) or loss (-). */
export function balanceWithFx(lines: JournalLine[], description = 'Exchange gain or loss'): number {
  const diff = round2(sumD(lines) - sumC(lines));
  if (Math.abs(diff) <= 0.004) return 0;
  if (diff > 0) lines.push({ accountId: FX_ACCOUNTS.realized, debit: 0, credit: diff, description });
  else lines.push({ accountId: FX_ACCOUNTS.realized, debit: -diff, credit: 0, description });
  return diff;
}

// ------------------------------------------------------------------ revaluation

/** Open foreign-currency balances in a currency on a date and their unrealized gain/loss at a new rate. */
export function revaluationLines(db: Database, code: string, date: string, rate: number): RevaluationLine[] {
  const out: RevaluationLine[] = [];
  const push = (sourceType: RevaluationLine['sourceType'], x: { id: string; number: string; contactId: string; currencyCode?: string; exchangeRate?: number }, balance: number, sign: 1 | -1) => {
    if (balance <= 0.004) return;
    const booked = fxOf(x).rate;
    const gainOrLoss = round2(sign * (toBase(balance, rate) - toBase(balance, booked)));
    out.push({ sourceType, sourceId: x.id, number: x.number, contactId: x.contactId, balance: round2(balance), bookedRate: booked, gainOrLoss });
  };
  for (const d of db.docs) {
    if (codeOf(d) !== code || d.date > date) continue;
    const posted = ['open', 'sent', 'due_today', 'overdue', 'partially_paid'].includes(d.status);
    if (d.kind === 'invoice' && posted) push('invoice', d, d.balance, 1); // receivable worth more = gain
    if (d.kind === 'bill' && posted) push('bill', d, d.balance, -1); // payable worth more = loss
    if (d.kind === 'credit_note' && d.status === 'open') push('credit_note', d, d.balance, -1);
    if (d.kind === 'vendor_credit' && d.status === 'open') push('vendor_credit', d, d.balance, 1);
  }
  for (const p of db.paymentsReceived) if (p.status === 'paid' && codeOf(p) === code && p.date <= date) push('payment_received', p, p.unusedAmount, -1);
  for (const p of db.paymentsMade) if (p.status === 'paid' && codeOf(p) === code && p.date <= date) push('payment_made', p, p.unusedAmount, 1);
  return out;
}

/** Journal lines of a revaluation: AR/AP move by the gain or loss against the unrealized account. */
export function revaluationJournal(db: Database, lines: RevaluationLine[]): JournalLine[] {
  const out: JournalLine[] = [];
  const control = (l: RevaluationLine) => {
    const src = l.sourceType === 'payment_received' || l.sourceType === 'payment_made' ? undefined : db.docs.find((d) => d.id === l.sourceId);
    const sales = l.sourceType === 'invoice' || l.sourceType === 'credit_note' || l.sourceType === 'payment_received';
    return src?.accountId || (sales ? 'acc_ar' : 'acc_ap');
  };
  for (const l of lines) {
    if (!l.gainOrLoss) continue;
    const g = l.gainOrLoss;
    // sales side: a gain raises the receivable (debit AR); purchase side: a gain lowers the payable (debit AP)
    const desc = `Revaluation of ${l.number}`;
    if (g > 0) out.push({ accountId: control(l), debit: g, credit: 0, description: desc, contactId: l.contactId }, { accountId: FX_ACCOUNTS.unrealized, debit: 0, credit: g, description: desc });
    else out.push({ accountId: control(l), debit: 0, credit: -g, description: desc, contactId: l.contactId }, { accountId: FX_ACCOUNTS.unrealized, debit: -g, credit: 0, description: desc });
  }
  return out;
}

// ------------------------------------------------------------------ base-currency view for reports

const DOC_MONEY: (keyof TxnDoc)[] = ['subTotal', 'discountAmount', 'tdsAmount', 'tcsAmount', 'taxAmount', 'total', 'balance', 'adjustment', 'amountPaid', 'creditsUsed', 'projectFee'];

function docInBase(d: TxnDoc): TxnDoc {
  const { code, rate } = fxOf(d);
  if (code === BASE_CURRENCY) return d;
  const c: TxnDoc = { ...d, lineItems: d.lineItems.map((l) => ({ ...l, rate: round2(l.rate * rate), amount: toBase(l.amount, rate), taxAmount: l.taxAmount == null ? l.taxAmount : toBase(l.taxAmount, rate) })) };
  for (const k of DOC_MONEY) if (typeof d[k] === 'number') (c as unknown as Record<string, number>)[k] = toBase(d[k] as number, rate);
  c.taxBreakdown = d.taxBreakdown?.map((t) => ({ ...t, amount: toBase(t.amount, rate) }));
  c.creditApplications = d.creditApplications.map((a) => ({ ...a, amount: toBase(a.amount, rate) }));
  c.refunds = d.refunds.map((r) => ({ ...r, amount: toBase(r.amount, rate) }));
  if (d.writeOff) c.writeOff = { ...d.writeOff, amount: toBase(d.writeOff.amount, rate) };
  return c;
}

function paymentInBase<P extends PaymentReceived | PaymentMade>(p: P, docRateOf: (id: string) => number): P {
  const { code, rate } = fxOf(p);
  if (code === BASE_CURRENCY) return p;
  const c = { ...p } as P;
  c.amount = toBase(p.amount, rate);
  c.allocations = p.allocations.map((a) => ({ ...a, amount: toBase(a.amount, docRateOf(a.docId)) }));
  c.usedAmount = round2(c.allocations.reduce((s, a) => s + a.amount, 0));
  c.unusedAmount = toBase(p.unusedAmount, rate);
  c.refundedAmount = toBase(p.refundedAmount ?? 0, rate);
  c.refunds = (p.refunds ?? []).map((r: Refund) => ({ ...r, amount: toBase(r.amount, rate) }));
  if ('bankCharges' in p) {
    const pr = p as PaymentReceived;
    Object.assign(c, { bankCharges: toBase(pr.bankCharges, rate), tdsAmount: toBase(pr.tdsAmount, rate) });
  }
  return c;
}

const viewCache = new WeakMap<object, Database>();

/**
 * The books with every document and payment converted to the base currency at its own rate (payment
 * allocations at the rate of the document they settle), for reports and dashboards. Journals are already
 * in the base currency. The view is rebuilt whenever the ledger is rebuilt.
 */
export function baseView(db: Database): Database {
  const hit = viewCache.get(db.journals);
  if (hit) return hit;
  const anyForeign = db.docs.some((d) => codeOf(d) !== BASE_CURRENCY) || db.paymentsReceived.some((p) => codeOf(p) !== BASE_CURRENCY) || db.paymentsMade.some((p) => codeOf(p) !== BASE_CURRENCY);
  if (!anyForeign) return db;
  const rates = new Map(db.docs.map((d) => [d.id, fxOf(d).rate]));
  const rOf = (id: string) => rates.get(id) ?? 1;
  const view: Database = {
    ...db,
    docs: db.docs.map(docInBase),
    paymentsReceived: db.paymentsReceived.map((p) => paymentInBase(p, rOf)),
    paymentsMade: db.paymentsMade.map((p) => paymentInBase(p, rOf)),
  };
  viewCache.set(db.journals, view);
  return view;
}

/** "USD 1,250.00 (₹1,04,068.75 at 1 USD = ₹83.255)" for activity logs and errors. */
export function describeAmount(amount: number, x: RateCarrier) {
  const { code, rate } = fxOf(x);
  if (code === BASE_CURRENCY) return moneyIn(amount, code);
  return `${moneyIn(amount, code)} (${moneyIn(toBase(amount, rate), BASE_CURRENCY)} at ${rateLabel(code, rate)})`;
}

export function currencyRecord(code: string, rate: number, name?: string, symbol?: string): Currency {
  const info = isoInfo(code);
  return { code, name: name || info.name, symbol: symbol || info.symbol, rate: code === BASE_CURRENCY ? 1 : roundRate(rate), history: [] };
}
