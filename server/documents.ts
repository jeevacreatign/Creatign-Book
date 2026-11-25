// Documents: inboxes (Files, Bank Statements), folders, trash, and attaching files to transactions.
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { DOC_META } from '../shared/docmeta';
import type { Attachment, Database, DocFile, DocFolder, DocLink } from '../shared/types';
import { UPLOAD_DIR, getDb, newId, now } from './db';
import { currentUser } from './projects';
import * as S from './services';

type Wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => Promise<void>;

const bad = (msg: string) => new S.HttpError(400, msg);
const notFound = (what: string) => new S.HttpError(404, `${what} not found`);
const q = (req: Request, k: string) => (typeof req.query[k] === 'string' ? (req.query[k] as string) : undefined);
const p = (req: Request, k: string) => String(req.params[k]);

// ------------------------------------------------------------------ attach targets

export const TARGET_TYPES = ['invoice', 'credit_note', 'quote', 'sales_order', 'delivery_challan', 'bill', 'vendor_credit', 'purchase_order', 'expense', 'payment_received', 'payment_made', 'manual_journal', 'customer', 'vendor', 'bank_transaction'] as const;
type TargetType = (typeof TARGET_TYPES)[number];

const TARGET_LABEL: Record<TargetType, string> = {
  invoice: 'Invoice',
  credit_note: 'Credit Note',
  quote: 'Estimate',
  sales_order: 'Sales Order',
  delivery_challan: 'Delivery Challan',
  bill: 'Bill',
  vendor_credit: 'Debit Note',
  purchase_order: 'Purchase Order',
  expense: 'Expense',
  payment_received: 'Client Payment',
  payment_made: 'Supplier Payment',
  manual_journal: 'Journal',
  customer: 'Client',
  vendor: 'Supplier',
  bank_transaction: 'Bank Transaction',
};

/** The attachment list of a target entity, plus its display label and app path. */
function target(db: Database, type: string, id: string): { list: Attachment[]; label: string; path: string } | undefined {
  const name = (cid?: string) => db.contacts.find((c) => c.id === cid)?.displayName ?? '';
  if (type in DOC_META) {
    const d = db.docs.find((x) => x.id === id && x.kind === type);
    if (!d) return undefined;
    d.attachments ??= [];
    return { list: d.attachments, label: `${DOC_META[d.kind].label} ${d.number}${d.contactId ? ` · ${name(d.contactId)}` : ''}`, path: `${DOC_META[d.kind].path}/${d.id}` };
  }
  switch (type) {
    case 'expense': {
      const e = db.expenses.find((x) => x.id === id);
      if (!e) return undefined;
      e.receipts ??= [];
      return { list: e.receipts, label: `Expense ${e.invoiceNumber || ''} ${e.date.split('-').reverse().join('/')}${e.vendorId ? ` · ${name(e.vendorId)}` : ''}`.replace(/\s+/g, ' '), path: `/purchases/expenses/${e.id}` };
    }
    case 'payment_received': {
      const x = db.paymentsReceived.find((y) => y.id === id);
      if (!x) return undefined;
      x.attachments ??= [];
      return { list: x.attachments, label: `Payment #${x.number} · ${name(x.contactId)}`, path: `/sales/payments-received/${x.id}` };
    }
    case 'payment_made': {
      const x = db.paymentsMade.find((y) => y.id === id);
      if (!x) return undefined;
      x.attachments ??= [];
      return { list: x.attachments, label: `Payment #${x.number} · ${name(x.contactId)}`, path: `/purchases/payments-made/${x.id}` };
    }
    case 'manual_journal': {
      const j = db.manualJournals.find((y) => y.id === id);
      if (!j) return undefined;
      j.attachments ??= [];
      return { list: j.attachments, label: `Journal ${j.number}`, path: `/accountant/manual-journals/${j.id}` };
    }
    case 'customer':
    case 'vendor': {
      const c = db.contacts.find((y) => y.id === id && y.kind === type);
      if (!c) return undefined;
      c.documents ??= [];
      return { list: c.documents, label: c.displayName, path: `/${type === 'customer' ? 'sales/customers' : 'purchases/vendors'}/${c.id}` };
    }
    case 'bank_transaction': {
      const t = db.bankTransactions.find((y) => y.id === id);
      if (!t) return undefined;
      t.attachments ??= [];
      return { list: t.attachments, label: `${t.referenceNumber || 'Bank transaction'} ${t.date.split('-').reverse().join('/')}`, path: `/banking/${t.accountId}` };
    }
  }
  return undefined;
}

export function attachTargets(db: Database, type: string, search = '') {
  const s = search.toLowerCase();
  const has = (...xs: (string | undefined)[]) => !s || xs.some((x) => (x || '').toLowerCase().includes(s));
  const name = (cid?: string) => db.contacts.find((c) => c.id === cid)?.displayName ?? '';
  let out: { type: string; id: string; label: string; date?: string }[] = [];
  if (type in DOC_META) out = db.docs.filter((d) => d.kind === type && has(d.number, d.referenceNumber, name(d.contactId))).map((d) => ({ type, id: d.id, label: `${d.number} · ${name(d.contactId)}`, date: d.date }));
  else if (type === 'expense') out = db.expenses.filter((e) => has(e.invoiceNumber, name(e.vendorId), e.notes, db.accounts.find((a) => a.id === e.accountId)?.name)).map((e) => ({ type, id: e.id, label: `${db.accounts.find((a) => a.id === e.accountId)?.name ?? 'Expense'}${e.vendorId ? ` · ${name(e.vendorId)}` : ''} · ₹${e.amount}`, date: e.date }));
  else if (type === 'payment_received') out = db.paymentsReceived.filter((x) => has(x.number, x.referenceNumber, name(x.contactId))).map((x) => ({ type, id: x.id, label: `#${x.number} · ${name(x.contactId)}`, date: x.date }));
  else if (type === 'payment_made') out = db.paymentsMade.filter((x) => has(x.number, x.referenceNumber, name(x.contactId))).map((x) => ({ type, id: x.id, label: `#${x.number} · ${name(x.contactId)}`, date: x.date }));
  else if (type === 'manual_journal') out = db.manualJournals.filter((j) => has(j.number, j.reference, j.notes)).map((j) => ({ type, id: j.id, label: `${j.number}${j.notes ? ` · ${j.notes.slice(0, 40)}` : ''}`, date: j.date }));
  else if (type === 'customer' || type === 'vendor') out = db.contacts.filter((c) => c.kind === type && has(c.displayName, c.email, c.companyName)).map((c) => ({ type, id: c.id, label: c.displayName }));
  else if (type === 'bank_transaction') out = db.bankTransactions.filter((t) => has(t.referenceNumber, t.description, db.accounts.find((a) => a.id === t.accountId)?.name)).map((t) => ({ type, id: t.id, label: `${db.accounts.find((a) => a.id === t.accountId)?.name ?? ''} · ${t.description || t.referenceNumber || t.type} · ₹${t.amount}`, date: t.date }));
  return out.sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 50);
}

// ------------------------------------------------------------------ listing

export interface DocRow extends Attachment {
  kind: 'inbox' | 'attachment';
  inbox?: DocFile['inbox'];
  folderId?: string;
  folderName?: string;
  uploadedBy?: string;
  links: (DocLink & { path?: string })[];
  status: 'associated' | 'unassociated' | 'imported';
  trashedAt?: string;
  importedToAccountId?: string;
  importedToAccountName?: string;
}

/** Every attachment on every transaction or contact, with where it sits. */
function allAttachments(db: Database) {
  const out: { a: Attachment; type: string; id: string }[] = [];
  for (const d of db.docs) for (const a of d.attachments ?? []) out.push({ a, type: d.kind, id: d.id });
  for (const e of db.expenses) for (const a of e.receipts ?? []) out.push({ a, type: 'expense', id: e.id });
  for (const x of db.paymentsReceived) for (const a of x.attachments ?? []) out.push({ a, type: 'payment_received', id: x.id });
  for (const x of db.paymentsMade) for (const a of x.attachments ?? []) out.push({ a, type: 'payment_made', id: x.id });
  for (const j of db.manualJournals) for (const a of j.attachments ?? []) out.push({ a, type: 'manual_journal', id: j.id });
  for (const c of db.contacts) for (const a of c.documents ?? []) out.push({ a, type: c.kind, id: c.id });
  for (const t of db.bankTransactions) for (const a of t.attachments ?? []) out.push({ a, type: 'bank_transaction', id: t.id });
  return out;
}

/** Files attached straight to transactions (not uploaded through Documents). */
function transactionFiles(db: Database): DocRow[] {
  const known = new Set(db.documents.map((d) => d.id));
  return allAttachments(db)
    .filter((x) => !known.has(x.a.id))
    .map(({ a, type, id }) => {
      const t = target(db, type, id);
      return { ...a, kind: 'attachment' as const, links: [{ type, id, label: t?.label ?? TARGET_LABEL[type as TargetType] ?? type, path: t?.path }], status: 'associated' as const };
    });
}

function row(db: Database, d: DocFile): DocRow {
  return {
    ...d,
    kind: 'inbox',
    folderName: db.docFolders.find((f) => f.id === d.folderId)?.name,
    links: d.links.map((l) => ({ ...l, path: target(db, l.type, l.id)?.path })),
    status: d.importedToAccountId ? 'imported' : d.links.length ? 'associated' : 'unassociated',
    importedToAccountName: db.accounts.find((a) => a.id === d.importedToAccountId)?.name,
  };
}

/**
 * Links are derived from where the file actually sits, so a file picked with "Attach from Documents"
 * on a transaction form shows up as associated once the transaction is saved, and a deleted
 * transaction drops its link.
 */
function syncLinks(db: Database) {
  const where = new Map<string, DocLink[]>();
  for (const { a, type, id } of allAttachments(db)) {
    const t = target(db, type, id);
    if (!t) continue;
    const list = where.get(a.id) ?? [];
    if (!list.some((l) => l.type === type && l.id === id)) list.push({ type, id, label: t.label });
    where.set(a.id, list);
  }
  for (const d of db.documents) d.links = where.get(d.id) ?? [];
}

export function listDocuments(db: Database, opts: { view?: string; folderId?: string; search?: string; status?: string }) {
  syncLinks(db);
  const view = opts.view || 'all';
  let rows: DocRow[];
  if (view === 'trash') rows = db.documents.filter((d) => d.trashedAt).map((d) => row(db, d));
  else {
    const live = db.documents.filter((d) => !d.trashedAt);
    if (view === 'files') rows = live.filter((d) => d.inbox === 'files' && !d.folderId).map((d) => row(db, d));
    else if (view === 'bank_statements') rows = live.filter((d) => d.inbox === 'bank_statements').map((d) => row(db, d));
    else if (view === 'folder') rows = live.filter((d) => d.folderId === opts.folderId).map((d) => row(db, d));
    else rows = [...live.map((d) => row(db, d)), ...transactionFiles(db)];
  }
  const s = (opts.search || '').toLowerCase();
  if (s) rows = rows.filter((r) => r.name.toLowerCase().includes(s) || r.links.some((l) => l.label.toLowerCase().includes(s)));
  if (opts.status && opts.status !== 'all') rows = rows.filter((r) => r.status === opts.status);
  return rows.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

// ------------------------------------------------------------------ mutations

function doc(db: Database, id: string) {
  const d = db.documents.find((x) => x.id === id);
  if (!d) throw notFound('Document');
  return d;
}

export function attach(db: Database, d: DocFile, type: string, id: string) {
  if (d.trashedAt) throw bad('Restore the file from Trash before attaching it');
  const t = target(db, type, id);
  if (!t) throw notFound(TARGET_LABEL[type as TargetType] ?? 'Transaction');
  if (t.list.length >= 10 && !t.list.some((a) => a.id === d.id)) throw bad('A transaction can have up to 10 attachments');
  if (!t.list.some((a) => a.id === d.id)) t.list.push({ id: d.id, name: d.name, size: d.size, mimeType: d.mimeType, url: d.url, uploadedAt: d.uploadedAt });
  if (!d.links.some((l) => l.type === type && l.id === id)) d.links.push({ type, id, label: t.label });
  return row(db, d);
}

function detach(db: Database, d: DocFile, type: string, id: string) {
  const t = target(db, type, id);
  if (t) {
    const i = t.list.findIndex((a) => a.id === d.id);
    if (i >= 0) t.list.splice(i, 1);
  }
  d.links = d.links.filter((l) => !(l.type === type && l.id === id));
  return row(db, d);
}

function removeFile(db: Database, d: DocFile) {
  // keep the file on disk while a transaction still has it attached
  const stillUsed = allAttachments(db).some((x) => x.a.url === d.url);
  if (!stillUsed) fs.rm(path.join(UPLOAD_DIR, path.basename(d.url)), { force: true }, () => undefined);
  db.documents = db.documents.filter((x) => x.id !== d.id);
}

function saveFolder(db: Database, b: Partial<DocFolder>, existing?: DocFolder): DocFolder {
  const name = String(b.name ?? existing?.name ?? '').trim();
  if (!name) throw bad('Folder Name is required');
  if (name.length > 100) throw bad('Folder Name can have up to 100 characters');
  if (db.docFolders.some((f) => f.id !== existing?.id && f.name.toLowerCase() === name.toLowerCase())) throw bad('A folder with this name already exists');
  const permission = (b.permission ?? existing?.permission ?? 'all') === 'custom' ? 'custom' : 'all';
  const userIds = permission === 'custom' ? (b.userIds ?? existing?.userIds ?? []).filter((u) => db.users.some((x) => x.id === u)) : undefined;
  if (permission === 'custom' && !userIds?.length) throw bad('Choose the users who can see this folder');
  return { id: existing?.id ?? newId('fld'), name, permission, userIds, createdAt: existing?.createdAt ?? now() };
}

// ------------------------------------------------------------------ routes

export function registerDocumentRoutes(api: Router, h: Wrap, m: Wrap, upload: RequestHandler) {
  api.get('/documents', h((req) => listDocuments(getDb(), { view: q(req, 'view'), folderId: q(req, 'folderId'), search: q(req, 'search'), status: q(req, 'status') })));
  api.get('/documents/summary', h(() => {
    const db = getDb();
    syncLinks(db);
    const live = db.documents.filter((d) => !d.trashedAt);
    return {
      all: live.length + transactionFiles(db).length,
      files: live.filter((d) => d.inbox === 'files' && !d.folderId).length,
      bankStatements: live.filter((d) => d.inbox === 'bank_statements').length,
      trash: db.documents.length - live.length,
      folders: db.docFolders.map((f) => ({ ...f, count: live.filter((d) => d.folderId === f.id).length })).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }));
  api.get('/documents/attach-targets', h((req) => attachTargets(getDb(), q(req, 'type') || 'invoice', q(req, 'search'))));
  api.get('/documents/:id', h((req) => {
    const db = getDb();
    syncLinks(db);
    return row(db, doc(db, p(req, 'id')));
  }));

  // upload into an inbox or folder
  api.post(
    '/documents',
    upload,
    m((req) => {
      const db = getDb();
      const files = (req.files as Express.Multer.File[]) || [];
      if (!files.length) throw bad('Choose at least one file');
      const inbox = req.body?.inbox === 'bank_statements' ? 'bank_statements' : 'files';
      const folderId = typeof req.body?.folderId === 'string' && req.body.folderId ? req.body.folderId : undefined;
      if (folderId && !db.docFolders.some((f) => f.id === folderId)) throw notFound('Folder');
      if (inbox === 'bank_statements') for (const f of files) if (!/\.(csv|tsv|txt)$/i.test(f.originalname)) throw bad(`${f.originalname}: the Bank Statements inbox takes CSV or TSV statements`);
      const by = currentUser(db)?.name ?? db.organization.name;
      const out = files.map<DocFile>((f) => ({ id: path.parse(f.filename).name, name: f.originalname, size: f.size, mimeType: f.mimetype, url: `/uploads/${f.filename}`, uploadedAt: now(), inbox, folderId, uploadedBy: by, links: [] }));
      db.documents.push(...out);
      // optional: attach straight away (upload from a transaction's "Attach from Documents")
      const at = req.body?.attachType;
      const aid = req.body?.attachId;
      if (typeof at === 'string' && typeof aid === 'string' && at && aid) for (const d of out) attach(db, d, at, aid);
      return out.map((d) => row(db, d));
    }),
  );
  api.put('/documents/:id', m((req) => {
    const db = getDb();
    syncLinks(db);
    const d = doc(db, p(req, 'id'));
    const b = req.body || {};
    if (b.name !== undefined) {
      const n = String(b.name).trim();
      if (!n) throw bad('File Name is required');
      const ext = path.extname(d.name);
      d.name = ext && !n.toLowerCase().endsWith(ext.toLowerCase()) ? `${n}${ext}` : n;
      // keep the copies on transactions in step
      for (const l of d.links) {
        const a = target(db, l.type, l.id)?.list.find((x) => x.id === d.id);
        if (a) a.name = d.name;
      }
    }
    if (b.folderId !== undefined) {
      if (b.folderId && !db.docFolders.some((f) => f.id === b.folderId)) throw notFound('Folder');
      d.folderId = b.folderId || undefined;
    }
    if (b.inbox === 'files' || b.inbox === 'bank_statements') d.inbox = b.inbox;
    return row(db, d);
  }));
  api.post('/documents/:id/attach', m((req) => {
    const db = getDb();
    return attach(db, doc(db, p(req, 'id')), String(req.body?.type || ''), String(req.body?.id || ''));
  }));
  api.post('/documents/:id/detach', m((req) => {
    const db = getDb();
    return detach(db, doc(db, p(req, 'id')), String(req.body?.type || ''), String(req.body?.id || ''));
  }));
  api.post('/documents/:id/trash', m((req) => {
    const db = getDb();
    syncLinks(db);
    const d = doc(db, p(req, 'id'));
    if (d.links.length) throw bad('Remove this file from the transactions it is attached to before moving it to Trash');
    d.trashedAt = now();
    return row(db, d);
  }));
  api.post('/documents/:id/restore', m((req) => {
    const db = getDb();
    const d = doc(db, p(req, 'id'));
    d.trashedAt = undefined;
    if (d.folderId && !db.docFolders.some((f) => f.id === d.folderId)) d.folderId = undefined;
    return row(db, d);
  }));
  api.delete('/documents/:id', m((req) => {
    const db = getDb();
    const d = doc(db, p(req, 'id'));
    if (!d.trashedAt) throw bad('Move the file to Trash before deleting it permanently');
    removeFile(db, d);
  }));
  api.post('/documents-bulk', m((req) => {
    const db = getDb();
    const ids: string[] = (req.body?.ids || []).map(String);
    const action = String(req.body?.action || '');
    syncLinks(db);
    const errors: string[] = [];
    let done = 0;
    for (const id of ids) {
      const d = db.documents.find((x) => x.id === id);
      if (!d) continue;
      if (action === 'trash') {
        if (d.links.length) {
          errors.push(`${d.name} is attached to a transaction`);
          continue;
        }
        d.trashedAt = now();
      } else if (action === 'restore') d.trashedAt = undefined;
      else if (action === 'delete') {
        if (!d.trashedAt) continue;
        removeFile(db, d);
      } else if (action === 'move') {
        const fid = req.body?.folderId ? String(req.body.folderId) : undefined;
        if (fid && !db.docFolders.some((f) => f.id === fid)) throw notFound('Folder');
        d.folderId = fid;
      } else continue;
      done++;
    }
    return { done, errors };
  }));
  api.post('/documents-trash/empty', m(() => {
    const db = getDb();
    for (const d of db.documents.filter((x) => x.trashedAt)) removeFile(db, d);
  }));

  // folders
  api.get('/doc-folders', h(() => getDb().docFolders));
  api.post('/doc-folders', m((req) => {
    const db = getDb();
    const f = saveFolder(db, req.body || {});
    db.docFolders.push(f);
    return f;
  }));
  api.put('/doc-folders/:id', m((req) => {
    const db = getDb();
    const i = db.docFolders.findIndex((x) => x.id === p(req, 'id'));
    if (i < 0) throw notFound('Folder');
    db.docFolders[i] = saveFolder(db, req.body || {}, db.docFolders[i]);
    return db.docFolders[i];
  }));
  api.delete('/doc-folders/:id', m((req) => {
    const db = getDb();
    const f = db.docFolders.find((x) => x.id === p(req, 'id'));
    if (!f) throw notFound('Folder');
    if (db.documents.some((d) => d.folderId === f.id && !d.trashedAt)) throw bad('Move or delete the files in this folder first');
    for (const d of db.documents) if (d.folderId === f.id) d.folderId = undefined;
    db.docFolders = db.docFolders.filter((x) => x.id !== f.id);
  }));
}
