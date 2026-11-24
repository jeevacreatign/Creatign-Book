// Business operations for every module. Each mutating function validates input,
// writes to the in-memory database, then the router calls commit() which
// recomputes derived state, rebuilds the ledger and persists to disk.
import { computeTotals } from '../shared/calc';
import { APPROVAL_KINDS, POSTED_STATUS, approvalEnabled, isUnposted, needsApproval } from '../shared/approval';
import { ACCOUNT_IDS as A, DOC_META } from '../shared/docmeta';
import { dueDateFor, money, nextRecurrence, round2, today } from '../shared/format';
import type {
  Contact,
  Database,
  DocKind,
  Expense,
  Item,
  LineItem,
  PaymentMade,
  PaymentReceived,
  RecurringExpense,
  Refund,
  TxnDoc,
} from '../shared/types';
import { getDb, newId, now, peekNumber, persist, takeNumber } from './db';
import { applyTotals, logActivity, makeDocFromProfile, recompute, runRecurring } from './engine';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const bad = (msg: string) => new HttpError(400, msg);
const notFound = (what: string) => new HttpError(404, `${what} not found`);

export function commit() {
  const db = getDb();
  recompute(db);
  persist();
}

const str = (v: unknown) => (v == null ? undefined : String(v).trim() || undefined);
const n = (v: unknown, d = 0) => (v === '' || v == null || Number.isNaN(Number(v)) ? d : Number(v));

// ================================================================== contacts

export function contactName(db: Database, id?: string) {
  return db.contacts.find((c) => c.id === id)?.displayName ?? '';
}

export function getContact(id: string) {
  const c = getDb().contacts.find((x) => x.id === id);
  if (!c) throw notFound('Contact');
  return c;
}

export function contactSummary(c: Contact) {
  const db = getDb();
  if (c.kind === 'customer') {
    const outstanding = round2(
      db.docs.filter((d) => d.kind === 'invoice' && d.contactId === c.id && d.status !== 'void' && !isUnposted(d.status)).reduce((a, d) => a + d.balance, 0) + (c.openingBalance || 0),
    );
    const unusedCredits = round2(
      db.paymentsReceived.filter((p) => p.contactId === c.id && p.status === 'paid').reduce((a, p) => a + p.unusedAmount, 0) +
        db.docs.filter((d) => d.kind === 'credit_note' && d.contactId === c.id && d.status === 'open').reduce((a, d) => a + d.balance, 0),
    );
    return { outstanding, unusedCredits };
  }
  const outstanding = round2(
    db.docs.filter((d) => d.kind === 'bill' && d.contactId === c.id && d.status !== 'void' && !isUnposted(d.status)).reduce((a, d) => a + d.balance, 0) + (c.openingBalance || 0),
  );
  const unusedCredits = round2(
    db.paymentsMade.filter((p) => p.contactId === c.id && p.status === 'paid').reduce((a, p) => a + p.unusedAmount, 0) +
      db.docs.filter((d) => d.kind === 'vendor_credit' && d.contactId === c.id && d.status === 'open').reduce((a, d) => a + d.balance, 0),
  );
  return { outstanding, unusedCredits };
}


export function upsertContact(body: Partial<Contact>, id?: string): Contact {
  const db = getDb();
  const existing = id ? getContact(id) : undefined;
  const displayName = str(body.displayName) ?? existing?.displayName;
  if (!displayName) throw bad('Display Name is required');
  const kind = (body.kind ?? existing?.kind) as Contact['kind'];
  if (kind !== 'customer' && kind !== 'vendor') throw bad('Contact kind must be customer or vendor');
  if (db.contacts.some((c) => c.kind === kind && c.displayName.toLowerCase() === displayName.toLowerCase() && c.id !== id)) {
    throw bad(`A ${kind} with the display name "${displayName}" already exists`);
  }
  const ts = now();
  const merged: Contact = {
    customerType: 'business',
    language: 'English',
    currencyCode: 'INR',
    paymentTerms: 'due_on_receipt',
    portalEnabled: false,
    billingAddress: {},
    shippingAddress: {},
    contactPersons: [],
    bankDetails: [],
    customFields: {},
    reportingTags: {},
    documents: [],
    status: 'active',
    createdAt: ts,
    ...existing,
    ...body,
    id: existing?.id ?? newId(kind === 'customer' ? 'cus' : 'ven'),
    kind,
    displayName,
    accountId: body.accountId || existing?.accountId || (kind === 'customer' ? A.ar : A.ap),
    openingBalance: round2(n(body.openingBalance ?? existing?.openingBalance)),
    updatedAt: ts,
  } as Contact;
  if ((merged.documents?.length ?? 0) > 10) throw bad('You can upload a maximum of 10 documents');
  merged.contactPersons = (merged.contactPersons || []).map((p) => ({ ...p, id: p.id || newId('cp') }));
  merged.bankDetails = (merged.bankDetails || []).map((p) => ({ ...p, id: p.id || newId('bank') }));
  if (existing) Object.assign(existing, merged);
  else db.contacts.push(merged);
  logActivity(db, 'contact', merged.id, merged.id, existing ? `${cap(kind)} details updated` : `${cap(kind)} created`);
  return merged;
}

export function deleteContact(id: string) {
  const db = getDb();
  const c = getContact(id);
  const used =
    db.docs.some((d) => d.contactId === id) ||
    db.paymentsReceived.some((p) => p.contactId === id) ||
    db.paymentsMade.some((p) => p.contactId === id) ||
    db.expenses.some((e) => e.vendorId === id || e.customerId === id);
  if (used) throw bad(`${c.displayName} has transactions and cannot be deleted. Mark it as inactive instead.`);
  db.contacts = db.contacts.filter((x) => x.id !== id);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ================================================================== items

export function upsertItem(body: Partial<Item>, id?: string): Item {
  const db = getDb();
  const existing = id ? db.items.find((i) => i.id === id) : undefined;
  if (id && !existing) throw notFound('Item');
  const name = str(body.name) ?? existing?.name;
  if (!name) throw bad('Name is required');
  if (db.items.some((i) => i.name.toLowerCase() === name.toLowerCase() && i.id !== id)) throw bad(`An item named "${name}" already exists`);
  const sellable = body.sellable ?? existing?.sellable ?? true;
  const purchasable = body.purchasable ?? existing?.purchasable ?? true;
  if (sellable && (body.sellingPrice === undefined || body.sellingPrice === null || (body.sellingPrice as unknown) === '') && !existing) throw bad('Selling Price is required');
  if (purchasable && (body.costPrice === undefined || body.costPrice === null || (body.costPrice as unknown) === '') && !existing) throw bad('Cost Price is required');
  const ts = now();
  const item: Item = {
    type: 'goods',
    status: 'active',
    createdAt: ts,
    ...existing,
    ...body,
    id: existing?.id ?? newId('item'),
    name,
    sellable,
    purchasable,
    sellingPrice: round2(n(body.sellingPrice ?? existing?.sellingPrice)),
    costPrice: round2(n(body.costPrice ?? existing?.costPrice)),
    salesAccountId: body.salesAccountId || existing?.salesAccountId || A.sales,
    purchaseAccountId: body.purchaseAccountId || existing?.purchaseAccountId || A.cogs,
    updatedAt: ts,
  } as Item;
  if (existing) Object.assign(existing, item);
  else db.items.push(item);
  return item;
}

export function deleteItem(id: string) {
  const db = getDb();
  if (db.docs.some((d) => d.lineItems.some((l) => l.itemId === id))) throw bad('This item is used in transactions and cannot be deleted. Mark it as inactive instead.');
  db.items = db.items.filter((i) => i.id !== id);
}

// ================================================================== documents

export function nextNumber(kind: DocKind) {
  return peekNumber(kind, DOC_META[kind].prefix);
}

export function getDoc(id: string, kind?: DocKind) {
  const d = getDb().docs.find((x) => x.id === id && (!kind || x.kind === kind));
  if (!d) throw notFound(kind ? DOC_META[kind].label : 'Document');
  return d;
}

function normalizeLines(raw: Partial<LineItem>[] | undefined, side: 'sales' | 'purchase'): LineItem[] {
  const db = getDb();
  const lines = (raw || [])
    .filter((l) => str(l.name) || l.itemId)
    .map((l) => {
      const item = l.itemId ? db.items.find((i) => i.id === l.itemId) : undefined;
      return {
        id: l.id || newId('li'),
        itemId: item?.id,
        name: str(l.name) ?? item?.name ?? '',
        description: str(l.description),
        accountId: l.accountId || (side === 'sales' ? item?.salesAccountId || A.sales : item?.purchaseAccountId || A.cogs),
        quantity: n(l.quantity, 1),
        unit: str(l.unit) ?? item?.unit,
        rate: round2(n(l.rate)),
        discountPercent: n(l.discountPercent) || undefined,
        customerId: l.customerId || undefined,
        amount: 0,
      } satisfies LineItem;
    });
  return lines;
}

export type SaveMode = 'draft' | 'open' | 'send';

export function saveDoc(kind: DocKind, body: Partial<TxnDoc>, mode: SaveMode = 'draft', id?: string): TxnDoc {
  const db = getDb();
  const meta = DOC_META[kind];
  if (!meta) throw bad(`Unknown document kind ${kind}`);
  const existing = id ? getDoc(id, kind) : undefined;
  if (existing?.locked) throw bad(`This ${meta.label.toLowerCase()} is locked. Unlock it to make changes.`);
  if (existing && ['void'].includes(existing.status)) throw bad(`A void ${meta.label.toLowerCase()} cannot be edited`);

  const contactId = body.contactId ?? existing?.contactId;
  const contact = db.contacts.find((c) => c.id === contactId);
  const expectedKind = meta.side === 'sales' ? 'customer' : 'vendor';
  if (!contact || contact.kind !== expectedKind) throw bad(`${expectedKind === 'customer' ? 'Customer Name' : 'Vendor Name'} is required`);

  const date = str(body.date) ?? existing?.date ?? today();
  let number = str(body.number) ?? existing?.number;
  if (meta.recurring) {
    const profileName = str(body.profileName) ?? existing?.profileName;
    if (!profileName) throw bad('Profile Name is required');
    number = number || profileName;
    const r = body.repeatEvery ?? existing?.repeatEvery;
    if (!r || !r.unit || !(n(r.n) > 0)) throw bad('Repeat Every is required');
  }
  if (!number) number = nextNumber(kind);
  if (!meta.recurring && db.docs.some((d) => d.kind === kind && d.number === number && d.id !== id && (kind !== 'bill' || d.contactId === contactId))) {
    throw bad(`${meta.numberLabel} ${number} already exists`);
  }
  const lineItems = normalizeLines(body.lineItems ?? existing?.lineItems, meta.side);
  if (!lineItems.length) throw bad('Add at least one item to the item table');
  if (lineItems.some((l) => l.quantity <= 0)) throw bad('Quantity must be greater than zero');
  if ((body.attachments ?? existing?.attachments ?? []).length > 10) throw bad('You can attach a maximum of 10 files');

  const ts = now();
  const paymentTerms = body.paymentTerms ?? existing?.paymentTerms ?? contact.paymentTerms;
  const doc: TxnDoc = {
    creditApplications: [],
    refunds: [],
    attachments: [],
    locked: false,
    createdAt: ts,
    status: meta.initialStatus,
    ...existing,
    ...body,
    id: existing?.id ?? newId(kind.split('_').map((s) => s[0]).join('') + 'x'),
    kind,
    number,
    contactId: contact.id,
    date,
    paymentTerms,
    lineItems,
    discountPercent: n(body.discountPercent ?? existing?.discountPercent),
    tdsRate: n(body.tdsRate ?? existing?.tdsRate),
    tcsRate: n(body.tcsRate ?? existing?.tcsRate),
    adjustment: round2(n(body.adjustment ?? existing?.adjustment)),
    accountId: body.accountId || existing?.accountId || contact.accountId || (meta.side === 'sales' ? A.ar : A.ap),
    billingAddress: body.billingAddress ?? existing?.billingAddress ?? contact.billingAddress,
    shippingAddress: body.shippingAddress ?? existing?.shippingAddress ?? contact.shippingAddress,
    emailRecipients: body.emailRecipients ?? existing?.emailRecipients ?? (contact.email ? [contact.email] : []),
    updatedAt: ts,
  } as TxnDoc;
  // computed fields are never trusted from the client
  if (kind === 'invoice' || kind === 'bill') {
    if (!str(body.dueDate) && !existing?.dueDate) doc.dueDate = dueDateFor(date, paymentTerms);
    if (body.paymentTerms && body.paymentTerms !== existing?.paymentTerms && !body.dueDate) doc.dueDate = dueDateFor(date, paymentTerms);
  }
  if (meta.recurring) {
    doc.repeatEvery = { n: n(doc.repeatEvery!.n, 1), unit: doc.repeatEvery!.unit };
    doc.startOn = doc.startOn || date;
    doc.date = doc.startOn;
    if (!existing || existing.startOn !== doc.startOn) doc.nextDate = doc.startOn;
    if (doc.neverExpires) doc.endsOn = undefined;
  }
  applyTotals(doc);
  if (doc.total < 0) throw bad('The total cannot be negative');

  // status from save mode
  const approvals = approvalEnabled(db.preferences, kind);
  let submitted = false;
  if (meta.recurring) {
    doc.status = existing?.status ?? 'active';
  } else if (!existing || isUnposted(existing.status)) {
    if (mode === 'draft') doc.status = existing && existing.status !== 'draft' ? existing.status : 'draft';
    else if (approvals) {
      // "Save and Submit": goes (back) into the approval queue. Editing an approved
      // document sends it back for approval so the approver sees the final version.
      doc.status = 'pending_approval';
      submitted = existing?.status !== 'pending_approval';
    } else doc.status = POSTED_STATUS[kind] ?? doc.status;
  } else doc.status = existing.status; // posted documents change status through actions only
  if (mode === 'send' && !isUnposted(doc.status)) doc.sentAt = doc.sentAt || ts;

  // credits can't drop below what was already applied
  if ((kind === 'credit_note' || kind === 'vendor_credit') && existing) {
    const used = [...existing.creditApplications, ...existing.refunds].reduce((a, c) => a + c.amount, 0);
    if (doc.total + 0.004 < used) throw bad(`The total cannot be less than the credits already used (${money(used)})`);
  }
  if ((kind === 'invoice' || kind === 'bill') && existing && existing.amountPaid && doc.total + 0.004 < existing.amountPaid) {
    throw bad(`The total cannot be less than the amount already paid (${money(existing.amountPaid)})`);
  }

  if (existing) Object.assign(existing, doc);
  else {
    db.docs.push(doc);
    if (!meta.recurring) takeNumber(kind, meta.prefix, number);
  }
  // converted documents: mark the source
  if (!existing && kind === 'invoice' && doc.quoteId) {
    const q = db.docs.find((d) => d.id === doc.quoteId);
    if (q) logActivity(db, 'quote', q.id, q.contactId, `Quote converted to invoice ${doc.number}`);
  }
  if (!existing && kind === 'sales_order' && doc.quoteId) {
    const q = db.docs.find((d) => d.id === doc.quoteId);
    if (q && q.status !== 'invoiced') q.status = 'accepted';
  }
  if (!existing && kind === 'bill' && doc.purchaseOrderId) {
    const po = db.docs.find((d) => d.id === doc.purchaseOrderId);
    if (po) logActivity(db, 'purchase_order', po.id, po.contactId, `Converted to bill ${doc.number}`);
  }
  logActivity(db, kind, doc.id, doc.contactId, `${meta.label} ${existing ? 'updated' : 'added'}`, `${meta.label} ${doc.number || doc.profileName} of amount ${money(doc.total)} ${existing ? 'updated' : 'created'}`);
  if (submitted) logActivity(db, kind, doc.id, doc.contactId, `${meta.label} submitted for approval`, `${meta.label} ${doc.number} submitted for approval`);
  if (mode === 'send' && doc.sentAt === ts) logActivity(db, kind, doc.id, doc.contactId, `${meta.label} marked as sent`);
  return doc;
}

export function deleteDoc(id: string) {
  const db = getDb();
  const d = getDoc(id);
  if (d.locked) throw bad('This document is locked');
  if (d.kind === 'invoice' || d.kind === 'bill') {
    const paid = d.kind === 'invoice' ? db.paymentsReceived.some((p) => p.allocations.some((a) => a.docId === id)) : db.paymentsMade.some((p) => p.allocations.some((a) => a.docId === id));
    const credited = db.docs.some((c) => c.creditApplications.some((a) => a.invoiceId === id));
    if (paid || credited) throw bad(`Delete the payments and credits applied to this ${DOC_META[d.kind].label.toLowerCase()} first`);
  }
  if ((d.kind === 'credit_note' || d.kind === 'vendor_credit') && (d.creditApplications.length || d.refunds.length)) throw bad('Remove the applied credits and refunds first');
  db.docs = db.docs.filter((x) => x.id !== id);
  // detach links
  for (const x of db.docs) {
    if (x.quoteId === id) x.quoteId = undefined;
    if (x.salesOrderId === id) x.salesOrderId = undefined;
    if (x.deliveryChallanId === id) x.deliveryChallanId = undefined;
    if (x.purchaseOrderId === id) x.purchaseOrderId = undefined;
    if (x.recurringProfileId === id) x.recurringProfileId = undefined;
  }
  for (const e of db.expenses) if (e.invoiceId === id) {
    e.invoiceId = undefined;
    e.status = e.billable ? 'unbilled' : 'non_billable';
  }
  logActivity(db, d.kind, d.id, d.contactId, `${DOC_META[d.kind].label} ${d.number} deleted`);
}

/** Build an unsaved document prefilled from another one (Convert to Invoice, Convert to Bill, Clone, ...). */
export function convertTemplate(sourceId: string, to: DocKind): Partial<TxnDoc> {
  const db = getDb();
  const src = getDoc(sourceId);
  const meta = DOC_META[to];
  if (src.kind !== to && approvalEnabled(db.preferences, src.kind) && needsApproval(src.status)) {
    throw bad(`Approve ${DOC_META[src.kind].label.toLowerCase()} ${src.number} before converting it`);
  }
  const toSide = meta.side;
  let contactId = src.contactId;
  if (DOC_META[src.kind].side !== toSide) {
    // sales order -> purchase order: pick the preferred vendor of the first item
    const vendor = src.lineItems.map((l) => db.items.find((i) => i.id === l.itemId)?.preferredVendorId).find(Boolean);
    contactId = vendor || '';
  }
  const prefs = db.preferences as Record<string, string>;
  const t: Partial<TxnDoc> = {
    kind: to,
    contactId,
    number: to === 'bill' ? '' : nextNumber(to),
    referenceNumber: src.number,
    orderNumber: src.kind === 'sales_order' ? src.number : src.orderNumber,
    date: today(),
    paymentTerms: src.paymentTerms,
    salesperson: src.salesperson,
    projectName: src.projectName,
    subject: src.subject,
    lineItems: src.lineItems.map((l) => {
      const item = db.items.find((i) => i.id === l.itemId);
      const crossSide = DOC_META[src.kind].side !== toSide;
      return {
        ...l,
        id: newId('li'),
        rate: crossSide ? item?.costPrice ?? l.rate : l.rate,
        accountId: crossSide ? (toSide === 'sales' ? item?.salesAccountId || A.sales : item?.purchaseAccountId || A.cogs) : l.accountId,
      };
    }),
    discountPercent: src.discountPercent,
    tdsRate: src.tdsRate,
    tcsRate: src.tcsRate,
    adjustment: src.adjustment,
    customerNotes: src.customerNotes,
    terms: src.terms,
    notes: src.notes,
    attachments: [],
  };
  if (src.kind === 'quote') t.quoteId = src.id;
  if (src.kind === 'sales_order') {
    t.salesOrderId = src.id;
    t.quoteId = src.quoteId;
  }
  if (src.kind === 'delivery_challan') t.deliveryChallanId = src.id;
  if (src.kind === 'purchase_order') t.purchaseOrderId = src.id;
  if (src.kind === 'invoice' && to === 'credit_note') t.invoiceId = src.id;
  if (to === 'invoice') {
    t.terms = t.terms || prefs.invoiceTerms;
  }
  if (src.kind === to) {
    // clone
    t.referenceNumber = src.referenceNumber;
    t.quoteId = undefined;
    t.salesOrderId = undefined;
    t.profileName = src.profileName ? `${src.profileName} (copy)` : undefined;
    t.repeatEvery = src.repeatEvery;
    t.neverExpires = src.neverExpires;
    t.startOn = today();
    t.billingAddress = src.billingAddress;
    t.shippingAddress = src.shippingAddress;
    t.challanType = src.challanType;
    t.deliveryMethod = src.deliveryMethod;
    t.expiryDate = src.expiryDate;
  }
  return t;
}

const SIMPLE_STATUS: Record<string, Partial<Record<DocKind, string>>> = {
  mark_sent: { quote: 'sent', invoice: 'open', purchase_order: 'issued', sales_order: 'confirmed' },
  accept: { quote: 'accepted' },
  decline: { quote: 'declined' },
  confirm: { sales_order: 'confirmed' },
  convert_to_open: { delivery_challan: 'open', credit_note: 'open', vendor_credit: 'open', bill: 'open', invoice: 'open' },
  mark_delivered: { delivery_challan: 'delivered' },
  revert_to_open: { delivery_challan: 'open' },
  void: { invoice: 'void', bill: 'void', credit_note: 'void', vendor_credit: 'void', sales_order: 'void', delivery_challan: 'void' },
  cancel: { purchase_order: 'cancelled' },
  reopen: { purchase_order: 'issued' },
  stop: { recurring_invoice: 'stopped', recurring_bill: 'stopped' },
  resume: { recurring_invoice: 'active', recurring_bill: 'active' },
  revert_to_draft: { quote: 'draft', delivery_challan: 'draft', invoice: 'draft', bill: 'draft', sales_order: 'draft', purchase_order: 'draft', credit_note: 'draft', vendor_credit: 'draft' },
};

export function docAction(id: string, action: string, body: Record<string, unknown> = {}) {
  const db = getDb();
  const d = getDoc(id);
  const meta = DOC_META[d.kind];
  const lockFree = ['lock', 'unlock'];
  if (d.locked && !lockFree.includes(action)) throw bad(`This ${meta.label.toLowerCase()} is locked`);

  // ---- approval workflow
  const approvals = approvalEnabled(db.preferences, d.kind);
  const kindLabel = meta.label.toLowerCase();
  switch (action) {
    case 'submit_for_approval':
      if (!APPROVAL_KINDS.includes(d.kind)) break;
      if (!approvals) throw bad(`Approvals are turned off for ${meta.plural.toLowerCase()}. Turn them on in Settings > Approvals.`);
      if (d.status !== 'draft' && d.status !== 'rejected') throw bad(`Only draft or rejected ${meta.plural.toLowerCase()} can be submitted for approval`);
      d.status = 'pending_approval';
      d.rejection = undefined;
      logActivity(db, d.kind, d.id, d.contactId, `${meta.label} submitted for approval`, `${meta.label} ${d.number} submitted for approval`);
      return d;
    case 'approve':
      if (!APPROVAL_KINDS.includes(d.kind)) break;
      if (d.status !== 'draft' && d.status !== 'pending_approval') throw bad(`Only draft or pending ${meta.plural.toLowerCase()} can be approved`);
      d.status = 'approved';
      d.rejection = undefined;
      d.approvedAt = now();
      d.approvedBy = db.organization.name;
      logActivity(db, d.kind, d.id, d.contactId, `${meta.label} approved`, `${meta.label} ${d.number} approved`);
      return d;
    case 'reject': {
      if (!APPROVAL_KINDS.includes(d.kind)) break;
      if (d.status !== 'pending_approval') throw bad(`Only ${meta.plural.toLowerCase()} pending approval can be rejected`);
      const reason = str(body.reason);
      d.status = 'rejected';
      d.rejection = { reason, at: now(), by: db.organization.name };
      logActivity(db, d.kind, d.id, d.contactId, `${meta.label} rejected`, reason ? `Reason: ${reason}` : `${meta.label} ${d.number} rejected`);
      return d;
    }
  }
  // with approvals on, a document must be approved before it is sent, confirmed or opened
  if (approvals && needsApproval(d.status) && ['mark_sent', 'confirm', 'convert_to_open', 'accept', 'decline'].includes(action)) {
    throw bad(`This ${kindLabel} has to be approved first`);
  }

  const target = SIMPLE_STATUS[action]?.[d.kind];
  if (target) {
    if (action === 'void') {
      if (d.kind === 'invoice' && db.paymentsReceived.some((p) => p.status === 'paid' && p.allocations.some((a) => a.docId === d.id))) throw bad('Delete the payments recorded for this invoice before voiding it');
      if (d.kind === 'bill' && db.paymentsMade.some((p) => p.status === 'paid' && p.allocations.some((a) => a.docId === d.id))) throw bad('Delete the payments recorded for this bill before voiding it');
      if (db.docs.some((c) => c.creditApplications.some((a) => a.invoiceId === d.id))) throw bad('Remove the credits applied to this document before voiding it');
      if ((d.kind === 'credit_note' || d.kind === 'vendor_credit') && (d.creditApplications.length || d.refunds.length)) throw bad('Remove applied credits and refunds before voiding');
    }
    if (action === 'revert_to_draft' && (d.amountPaid || 0) > 0) throw bad('Documents with payments cannot be reverted to draft');
    if (action === 'revert_to_draft' && (d.kind === 'credit_note' || d.kind === 'vendor_credit') && (d.creditApplications.length || d.refunds.length)) throw bad('Remove applied credits and refunds first');
    if (action === 'resume' && d.status === 'expired') throw bad('This profile has expired. Edit the end date to resume it.');
    d.status = target;
    if (action === 'mark_sent') d.sentAt = d.sentAt || now();
    if (action === 'resume' && d.nextDate && d.nextDate < today()) d.nextDate = today();
    logActivity(db, d.kind, d.id, d.contactId, `${meta.label} ${action.replace(/_/g, ' ')}`, `${meta.label} ${d.number} status changed to ${target.toUpperCase()}`);
    return d;
  }
  switch (action) {
    case 'lock':
    case 'unlock':
      d.locked = action === 'lock';
      logActivity(db, d.kind, d.id, d.contactId, `${meta.label} ${action}ed`);
      return d;
    case 'fulfill':
    case 'undo_fulfillment':
      if (d.kind !== 'sales_order') break;
      d.shipmentStatus = action === 'fulfill' ? 'fulfilled' : 'pending';
      logActivity(db, d.kind, d.id, d.contactId, action === 'fulfill' ? 'Sales order marked as fulfilled' : 'Fulfillment undone');
      return d;
    case 'cancel_items':
      if (d.kind !== 'sales_order') break;
      {
        const ids = (body.lineIds as string[]) || [];
        if (!ids.length) throw bad('Select the items to cancel');
        d.lineItems = d.lineItems.filter((l) => !ids.includes(l.id));
        if (!d.lineItems.length) d.status = 'void';
        applyTotals(d);
        logActivity(db, d.kind, d.id, d.contactId, `${ids.length} item(s) cancelled`);
      }
      return d;
    case 'mark_received':
      if (d.kind !== 'purchase_order') break;
      d.received = true;
      logActivity(db, d.kind, d.id, d.contactId, 'Goods marked as received');
      return d;
    case 'write_off': {
      if (d.kind !== 'invoice') break;
      if (!['open', 'sent', 'overdue', 'due_today', 'partially_paid'].includes(d.status)) throw bad('Only unpaid invoices can be written off');
      d.writeOff = { amount: d.balance, date: str(body.date) ?? today(), reason: str(body.reason) };
      logActivity(db, d.kind, d.id, d.contactId, `Invoice written off for ${money(d.balance)}`);
      return d;
    }
    case 'cancel_write_off':
      d.writeOff = undefined;
      logActivity(db, d.kind, d.id, d.contactId, 'Write off cancelled');
      return d;
    case 'stop_reminders':
    case 'enable_reminders':
      d.remindersStopped = action === 'stop_reminders';
      return d;
    case 'expected_payment_date':
      d.expectedPaymentDate = str(body.date);
      logActivity(db, d.kind, d.id, d.contactId, `Expected payment date set to ${d.expectedPaymentDate ?? 'none'}`);
      return d;
    case 'create_child': {
      if (!meta.recurring) break;
      const child = makeDocFromProfile(d, today());
      child.manuallyAdded = true;
      db.docs.push(child);
      logActivity(db, d.kind, d.id, d.contactId, `${DOC_META[child.kind].label} ${child.number} manually created from the profile`);
      return child;
    }
  }
  throw bad(`Action "${action}" is not available for ${meta.plural.toLowerCase()}`);
}


/** Apply credit note / vendor credit to open invoices / bills. */
export function applyCredits(id: string, apps: { invoiceId: string; amount: number }[]) {
  const db = getDb();
  const c = getDoc(id);
  if (c.kind !== 'credit_note' && c.kind !== 'vendor_credit') throw bad('Only credit notes can be applied');
  if (c.status !== 'open') throw bad('Only open credits can be applied');
  const targetKind = c.kind === 'credit_note' ? 'invoice' : 'bill';
  const clean = apps.filter((a) => n(a.amount) > 0);
  const totalApply = round2(clean.reduce((s, a) => s + n(a.amount), 0));
  if (totalApply > c.balance + 0.004) throw bad(`Amount to credit (${money(totalApply)}) exceeds the available credits (${money(c.balance)})`);
  for (const a of clean) {
    const inv = getDoc(a.invoiceId, targetKind);
    if (inv.contactId !== c.contactId) throw bad('Credits can only be applied to the same contact');
    if (n(a.amount) > inv.balance + 0.004) throw bad(`${inv.number}: amount exceeds the balance due (${money(inv.balance)})`);
    c.creditApplications.push({ id: newId('ca'), invoiceId: inv.id, amount: round2(n(a.amount)), date: today() });
    logActivity(db, targetKind, inv.id, inv.contactId, `Credits of ${money(a.amount)} applied from ${c.number}`);
  }
  return c;
}

export function removeCreditApplication(id: string, appId: string) {
  const c = getDoc(id);
  c.creditApplications = c.creditApplications.filter((a) => a.id !== appId);
  if (c.status === 'closed') c.status = 'open';
  return c;
}

function validRefund(body: Partial<Refund>, available: number): Refund {
  const amount = round2(n(body.amount));
  if (amount <= 0) throw bad('Enter a valid refund amount');
  if (amount > available + 0.004) throw bad(`Refund amount cannot exceed ${money(available)}`);
  if (!body.accountId) throw bad('From Account is required');
  if (!body.date) throw bad('Refunded On date is required');
  return { id: newId('rf'), amount, date: body.date, mode: body.mode || 'Cash', referenceNumber: str(body.referenceNumber), accountId: body.accountId, description: str(body.description) };
}

export function refundCredit(id: string, body: Partial<Refund>) {
  const db = getDb();
  const c = getDoc(id);
  if (c.kind !== 'credit_note' && c.kind !== 'vendor_credit') throw bad('Refunds are only available for credits');
  if (c.status !== 'open') throw bad('Only open credits can be refunded');
  const r = validRefund(body, c.balance);
  c.refunds.push(r);
  logActivity(db, c.kind, c.id, c.contactId, `Refund of ${money(r.amount)} recorded`);
  return c;
}

// ================================================================== payments received

export function savePaymentReceived(body: Partial<PaymentReceived>, id?: string): PaymentReceived {
  const db = getDb();
  const existing = id ? db.paymentsReceived.find((p) => p.id === id) : undefined;
  if (id && !existing) throw notFound('Payment');
  if (existing?.locked) throw bad('This payment is locked');
  const contactId = body.contactId ?? existing?.contactId;
  const contact = db.contacts.find((c) => c.id === contactId && c.kind === 'customer');
  if (!contact) throw bad('Customer Name is required');
  const amount = round2(n(body.amount ?? existing?.amount));
  if (amount <= 0) throw bad('Amount Received must be greater than zero');
  const depositToAccountId = body.depositToAccountId ?? existing?.depositToAccountId;
  if (!depositToAccountId) throw bad('Deposit To is required');
  const tdsDeducted = Boolean(body.tdsDeducted ?? existing?.tdsDeducted);
  const tdsAmount = tdsDeducted ? round2(n(body.tdsAmount ?? existing?.tdsAmount)) : 0;
  const bankCharges = round2(n(body.bankCharges ?? existing?.bankCharges));
  if (bankCharges > amount) throw bad('Bank charges cannot exceed the amount received');
  const allocations = (body.allocations ?? existing?.allocations ?? []).filter((a) => n(a.amount) > 0).map((a) => ({ docId: a.docId, amount: round2(n(a.amount)) }));
  const used = round2(allocations.reduce((s, a) => s + a.amount, 0));
  if (used > amount + tdsAmount + 0.004) throw bad(`The amount applied to invoices (${money(used)}) exceeds the amount received (${money(amount + tdsAmount)})`);
  for (const a of allocations) {
    const inv = getDoc(a.docId, 'invoice');
    if (inv.contactId !== contact.id) throw bad('Payments can only be applied to invoices of the same customer');
    if (isUnposted(inv.status) || inv.status === 'void') throw bad(`${inv.number} is ${inv.status.replace(/_/g, ' ')} and cannot receive payments`);
    const prev = existing?.allocations.find((x) => x.docId === a.docId)?.amount ?? 0;
    if (a.amount > inv.balance + (existing?.status === 'paid' ? prev : 0) + 0.004) throw bad(`${inv.number}: payment exceeds the balance due`);
  }
  const number = str(body.number) ?? existing?.number ?? peekNumber('payment_received', '', 1);
  if (db.paymentsReceived.some((p) => p.number === number && p.id !== id)) throw bad(`Payment #${number} already exists`);
  const ts = now();
  const p: PaymentReceived = {
    mode: 'Cash',
    attachments: [],
    sendThankYou: false,
    refunds: [],
    locked: false,
    createdAt: ts,
    usedAmount: 0,
    refundedAmount: 0,
    unusedAmount: 0,
    ...existing,
    ...body,
    id: existing?.id ?? newId('pmt'),
    number,
    contactId: contact.id,
    amount,
    bankCharges,
    date: str(body.date) ?? existing?.date ?? today(),
    depositToAccountId,
    tdsDeducted,
    tdsAmount,
    allocations,
    status: (body.status as PaymentReceived['status']) ?? existing?.status ?? 'paid',
    updatedAt: ts,
  } as PaymentReceived;
  if ((p.attachments?.length ?? 0) > 5) throw bad('You can attach a maximum of 5 files');
  const refunded = p.refunds.reduce((s, r) => s + r.amount, 0);
  if (used + refunded > amount + tdsAmount + 0.004) throw bad('The amount is less than what has been applied and refunded');
  if (existing) Object.assign(existing, p);
  else {
    db.paymentsReceived.push(p);
    const m = Number(number);
    if (Number.isFinite(m) && m > (db.counters.payment_received || 0)) db.counters.payment_received = m;
  }
  for (const a of allocations) {
    const inv = getDoc(a.docId);
    logActivity(db, 'invoice', inv.id, inv.contactId, `Payment of ${money(a.amount)} recorded`, `Payment #${number} via ${p.mode}`);
  }
  logActivity(db, 'payment_received', p.id, p.contactId, existing ? 'Payment updated' : 'Payment recorded', `${money(amount)} received via ${p.mode}`);
  if (p.sendThankYou && !existing && contact.email) {
    db.mails.push({ id: newId('mail'), contactId: contact.id, entityType: 'payment_received', entityId: p.id, from: db.organization.email, to: [contact.email], cc: [], subject: `Thank you for your payment - ${db.organization.name}`, body: `Dear ${contact.displayName},\n\nWe have received your payment of ${money(amount)}. Thank you for your business.\n\nRegards,\n${db.organization.name}`, attachments: [], createdAt: ts });
  }
  return p;
}

export function paymentReceivedAction(id: string, action: string, body: Record<string, unknown> = {}) {
  const db = getDb();
  const p = db.paymentsReceived.find((x) => x.id === id);
  if (!p) throw notFound('Payment');
  if (p.locked && !['lock', 'unlock'].includes(action)) throw bad('This payment is locked');
  switch (action) {
    case 'void':
      p.status = 'void';
      p.allocations = [];
      break;
    case 'mark_paid':
      p.status = 'paid';
      break;
    case 'lock':
    case 'unlock':
      p.locked = action === 'lock';
      break;
    case 'refund': {
      if (p.status !== 'paid') throw bad('Only paid payments can be refunded');
      p.refunds.push(validRefund(body as Partial<Refund>, p.unusedAmount));
      break;
    }
    case 'apply': {
      // apply unused amount to invoices: body.allocations [{docId, amount}]
      const add = (body.allocations as { docId: string; amount: number }[]) || [];
      const merged = [...p.allocations];
      for (const a of add) {
        const cur = merged.find((m) => m.docId === a.docId);
        if (cur) cur.amount = round2(cur.amount + n(a.amount));
        else merged.push({ docId: a.docId, amount: round2(n(a.amount)) });
      }
      return savePaymentReceived({ allocations: merged }, p.id);
    }
    default:
      throw bad(`Unknown action ${action}`);
  }
  logActivity(db, 'payment_received', p.id, p.contactId, `Payment ${action.replace(/_/g, ' ')}`);
  return p;
}

// ================================================================== payments made

export function savePaymentMade(body: Partial<PaymentMade>, id?: string): PaymentMade {
  const db = getDb();
  const existing = id ? db.paymentsMade.find((p) => p.id === id) : undefined;
  if (id && !existing) throw notFound('Payment');
  const contactId = body.contactId ?? existing?.contactId;
  const vendor = db.contacts.find((c) => c.id === contactId && c.kind === 'vendor');
  if (!vendor) throw bad('Vendor Name is required');
  const amount = round2(n(body.amount ?? existing?.amount));
  if (amount <= 0) throw bad('Payment Made must be greater than zero');
  const type = (body.type ?? existing?.type ?? 'bill_payment') as PaymentMade['type'];
  const paidThroughAccountId = body.paidThroughAccountId ?? existing?.paidThroughAccountId;
  if (!paidThroughAccountId) throw bad('Paid Through is required');
  const allocations = type === 'vendor_advance' ? [] : (body.allocations ?? existing?.allocations ?? []).filter((a) => n(a.amount) > 0).map((a) => ({ docId: a.docId, amount: round2(n(a.amount)) }));
  const used = round2(allocations.reduce((s, a) => s + a.amount, 0));
  if (used > amount + 0.004) throw bad(`The amount applied to bills (${money(used)}) exceeds the payment (${money(amount)})`);
  for (const a of allocations) {
    const bill = getDoc(a.docId, 'bill');
    if (bill.contactId !== vendor.id) throw bad('Payments can only be applied to bills of the same vendor');
    if (isUnposted(bill.status) || bill.status === 'void') throw bad(`${bill.number} is ${bill.status.replace(/_/g, ' ')}`);
    const prev = existing?.allocations.find((x) => x.docId === a.docId)?.amount ?? 0;
    if (a.amount > bill.balance + prev + 0.004) throw bad(`${bill.number}: payment exceeds the balance due`);
  }
  const number = str(body.number) ?? existing?.number ?? peekNumber('payment_made', '', 1);
  if (db.paymentsMade.some((p) => p.number === number && p.id !== id)) throw bad(`Payment #${number} already exists`);
  const ts = now();
  const p: PaymentMade = {
    mode: 'Cash',
    attachments: [],
    status: 'paid',
    createdAt: ts,
    usedAmount: 0,
    unusedAmount: 0,
    ...existing,
    ...body,
    id: existing?.id ?? newId('pm'),
    type,
    number,
    contactId: vendor.id,
    amount,
    date: str(body.date) ?? existing?.date ?? today(),
    paidThroughAccountId,
    allocations,
    updatedAt: ts,
  } as PaymentMade;
  if (existing) Object.assign(existing, p);
  else {
    db.paymentsMade.push(p);
    const m = Number(number);
    if (Number.isFinite(m) && m > (db.counters.payment_made || 0)) db.counters.payment_made = m;
  }
  for (const a of allocations) {
    const b = getDoc(a.docId);
    logActivity(db, 'bill', b.id, b.contactId, `Payment of ${money(a.amount)} made`, `Payment #${number} via ${p.mode}`);
  }
  logActivity(db, 'payment_made', p.id, p.contactId, existing ? 'Payment updated' : type === 'vendor_advance' ? 'Vendor advance recorded' : 'Bill payment recorded', `${money(amount)} paid via ${p.mode}`);
  return p;
}

// ================================================================== expenses

export function saveExpense(body: Partial<Expense>, id?: string): Expense {
  const db = getDb();
  const existing = id ? db.expenses.find((e) => e.id === id) : undefined;
  if (id && !existing) throw notFound('Expense');
  const isMileage = Boolean(body.isMileage ?? existing?.isMileage);
  const itemized = Boolean(body.itemized ?? existing?.itemized);
  const lines = (body.lines ?? existing?.lines ?? []).filter((l) => l.accountId && n(l.amount) > 0).map((l) => ({ ...l, id: l.id || newId('el'), amount: round2(n(l.amount)) }));
  let amount = round2(n(body.amount ?? existing?.amount));
  if (isMileage) amount = round2(n(body.distance ?? existing?.distance) * n(body.ratePerKm ?? existing?.ratePerKm));
  if (itemized) amount = round2(lines.reduce((s, l) => s + l.amount, 0));
  const accountId = isMileage ? A.fuel : itemized ? lines[0]?.accountId : body.accountId ?? existing?.accountId;
  if (!accountId) throw bad('Expense Account is required');
  if (amount <= 0) throw bad('Amount must be greater than zero');
  const paidThroughAccountId = body.paidThroughAccountId ?? existing?.paidThroughAccountId;
  if (!paidThroughAccountId) throw bad('Paid Through is required');
  const customerId = body.customerId ?? existing?.customerId;
  const billable = Boolean(customerId) && Boolean(body.billable ?? existing?.billable);
  const ts = now();
  const e: Expense = {
    receipts: [],
    reportingTags: {},
    createdAt: ts,
    ...existing,
    ...body,
    id: existing?.id ?? newId('exp'),
    date: str(body.date) ?? existing?.date ?? today(),
    accountId,
    amount,
    itemized,
    lines,
    isMileage,
    paidThroughAccountId,
    customerId: customerId || undefined,
    billable,
    status: existing?.status === 'invoiced' || existing?.status === 'reimbursed' ? existing.status : body.status === 'reimbursed' ? 'reimbursed' : billable ? 'unbilled' : 'non_billable',
    updatedAt: ts,
  } as Expense;
  if (e.receipts.length > 10) throw bad('You can upload a maximum of 10 receipts');
  if (existing) Object.assign(existing, e);
  else db.expenses.push(e);
  if (e.vendorId) logActivity(db, 'expense', e.id, e.vendorId, `Expense of ${money(e.amount)} recorded`);
  return e;
}

export function convertExpenseToInvoice(id: string): TxnDoc {
  const db = getDb();
  const e = db.expenses.find((x) => x.id === id);
  if (!e) throw notFound('Expense');
  if (!e.billable || !e.customerId) throw bad('Only billable expenses with a customer can be converted to an invoice');
  if (e.status === 'invoiced') throw bad('This expense has already been invoiced');
  const acct = db.accounts.find((a) => a.id === e.accountId);
  const inv = saveDoc('invoice', {
    contactId: e.customerId,
    date: today(),
    lineItems: [{ id: newId('li'), name: acct?.name ?? 'Expense', description: e.notes, quantity: 1, rate: e.amount, accountId: A.generalIncome, amount: e.amount }],
    discountPercent: 0,
    tdsRate: 0,
    tcsRate: 0,
    adjustment: 0,
  } as Partial<TxnDoc>, 'draft');
  e.status = 'invoiced';
  e.invoiceId = inv.id;
  return inv;
}

export function saveRecurringExpense(body: Partial<RecurringExpense>, id?: string): RecurringExpense {
  const db = getDb();
  const existing = id ? db.recurringExpenses.find((e) => e.id === id) : undefined;
  if (id && !existing) throw notFound('Recurring expense');
  const profileName = str(body.profileName) ?? existing?.profileName;
  if (!profileName) throw bad('Profile Name is required');
  const repeatEvery = body.repeatEvery ?? existing?.repeatEvery;
  if (!repeatEvery?.unit) throw bad('Repeat Every is required');
  const accountId = body.accountId ?? existing?.accountId;
  if (!accountId) throw bad('Expense Account is required');
  const amount = round2(n(body.amount ?? existing?.amount));
  if (amount <= 0) throw bad('Amount must be greater than zero');
  const paidThroughAccountId = body.paidThroughAccountId ?? existing?.paidThroughAccountId;
  if (!paidThroughAccountId) throw bad('Paid Through is required');
  const ts = now();
  const startOn = str(body.startOn) ?? existing?.startOn ?? today();
  const r: RecurringExpense = {
    reportingTags: {},
    neverExpires: true,
    status: 'active',
    createdAt: ts,
    ...existing,
    ...body,
    id: existing?.id ?? newId('rexp'),
    profileName,
    repeatEvery: { n: n(repeatEvery.n, 1), unit: repeatEvery.unit },
    startOn,
    accountId,
    amount,
    paidThroughAccountId,
    billable: Boolean(body.billable ?? existing?.billable) && Boolean(body.customerId ?? existing?.customerId),
    nextDate: existing && existing.startOn === startOn ? existing.nextDate : startOn,
    updatedAt: ts,
  } as RecurringExpense;
  if (r.neverExpires) r.endsOn = undefined;
  if (existing) Object.assign(existing, r);
  else db.recurringExpenses.push(r);
  return r;
}

export function recurringExpenseAction(id: string, action: string) {
  const db = getDb();
  const r = db.recurringExpenses.find((x) => x.id === id);
  if (!r) throw notFound('Recurring expense');
  if (action === 'stop') r.status = 'stopped';
  else if (action === 'resume') {
    r.status = 'active';
    if (r.nextDate && r.nextDate < today()) r.nextDate = today();
  } else throw bad('Unknown action');
  return r;
}

export function generateRecurringNow() {
  return runRecurring(getDb());
}

export { nextRecurrence, computeTotals };
