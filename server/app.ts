// Express REST API for Creatign Ledger.
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { approvalEnabled, approvalSettings, needsApproval } from '../shared/approval';
import { DOC_META } from '../shared/docmeta';
import { periodRange, today, type PeriodKey } from '../shared/format';
import { CUSTOM_FIELD_TYPES, builtInTemplates, normalizeTemplate, resolveTemplate, type CustomFieldDef, type PdfTemplate } from '../shared/pdfTemplate';
import type { Account, Attachment, DocKind, Journal, PaymentMade, Project, TimeEntry, TxnDoc } from '../shared/types';
import { UPLOAD_DIR, flushDb, getDb, newId, now, peekNumber, resetDb } from './db';
import { journalsFor, logActivity, recompute, runRecurring } from './engine';
import { normalizeTimeTracking, registerProjectRoutes } from './projects';
import { lockGuard, registerAccountantRoutes } from './accountant';
import { registerBankingRoutes } from './banking';
import { registerAuthRoutes, requestUser, requireAdmin, requireStaff } from './auth';
import { registerDocumentRoutes } from './documents';
import * as R from './reports';
import { CATEGORIES as CATALOG_CATEGORIES, catalog as reportCatalog, runReport } from './reportCatalog';
import * as S from './services';
import { mailSettings, savedSmtp, verifySmtp, type SmtpSettings } from './mailer';
import { composeDefaults, emailTemplates, isEmail, previewEmail, publicOrigin, resendMail, sendEmail } from './email';
import { encryptSecret } from './secrets';
import { portalRouter, publicShareRoutes, staffPortalRoutes } from './portal';
import { EMAIL_TEMPLATE_KINDS, builtInEmailTemplates, type EmailTemplate, type EmailTemplateKind } from '../shared/email';
import { consumeGoogleAuthorizationState, createGoogleAuthorizationUrl, disconnectGoogleAccount, finishGoogleAuthorization, googleOAuthResultPage } from './google-mail';
import { renderDocPdf, renderPaymentPdf, renderStatementPdf } from './pdf';
import { dueReminders, reminderLog, runReminders, saveReminderSettings } from './reminders';
import { reminderSettings } from '../shared/reminders';

type Handler = (req: Request, res: Response) => unknown;
const h = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req, res);
    await flushDb(); // answer only once the change is saved
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (e) {
    next(e);
  }
};
/** Wrap a mutation: run it, then recompute + persist. */
const m = (fn: Handler) =>
  h((req, res) => {
    const out = fn(req, res);
    S.commit();
    return out;
  });

const q = (req: Request, k: string) => (typeof req.query[k] === 'string' ? (req.query[k] as string) : undefined);
const p = (req: Request, k: string) => String(req.params[k]);

const origin = (req: Request) => publicOrigin(req.get('origin') || undefined);

/** Log rows without the stored HTML (fetched one at a time for previews). */
function listMail<T extends { html?: string }>(m: T) {
  const { html: _html, ...rest } = m;
  return rest;
}

function validTemplate(t: EmailTemplate): EmailTemplate {
  const name = String(t.name || '').trim();
  const subject = String(t.subject || '').trim();
  const body = String(t.body || '');
  if (!name) throw new S.HttpError(400, 'Template name is required');
  if (!subject) throw new S.HttpError(400, 'Subject is required');
  if (/[\r\n]/.test(subject)) throw new S.HttpError(400, 'Subject cannot contain line breaks');
  if (!body.trim()) throw new S.HttpError(400, 'Email body is required');
  if (body.length > 20000) throw new S.HttpError(400, 'The email body is too long');
  return { ...t, name: name.slice(0, 120), subject: subject.slice(0, 300), body };
}

function setDefaultTemplate(t: EmailTemplate) {
  for (const x of emailTemplates()) if (x.kind === t.kind) x.isDefault = x.id === t.id;
}

function matches(text: string | undefined, needle?: string) {
  return !needle || (text || '').toLowerCase().includes(needle.toLowerCase());
}

let lastRecomputeDay = '';
function freshness(_req: Request, _res: Response, next: NextFunction) {
  // statuses like "overdue" depend on today's date, and recurring profiles fire daily
  const t = today();
  if (t !== lastRecomputeDay) {
    lastRecomputeDay = t;
    runRecurring(getDb());
    S.commit();
  }
  next();
}

/** Baseline headers for every response (the app and the API). */
function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // invite, reset and share links carry tokens in the URL: don't leak them to other sites
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  if (process.env.COOKIE_SECURE === '1') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
}

/** Images and PDFs may show inline; everything else downloads. Nothing uploaded may run scripts. */
const INLINE_UPLOAD = /\.(png|jpe?g|gif|bmp|webp|pdf)$/i;
export function uploadHeaders(res: Response, file: string) {
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!INLINE_UPLOAD.test(file)) res.setHeader('Content-Disposition', 'attachment');
}

export function createApp() {
  const app = express();
  // Behind CloudFront + a load balancer, TRUST_PROXY=2 makes req.ip the visitor's address (used for sign-in rate limits)
  const hops = Number(process.env.TRUST_PROXY);
  if (hops > 0) app.set('trust proxy', hops);
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(express.json({ limit: '5mb' }));
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  // uploads are user files: never let the browser run them as a page on our origin
  app.use('/uploads', requireStaff, express.static(UPLOAD_DIR, { setHeaders: uploadHeaders }));
  app.use('/api', requireStaff);

  const api = express.Router();
  // load balancer health check (no sign-in needed)
  api.get('/health', (_req, res) => { res.json({ ok: true }); });
  api.use(freshness);
  api.use(lockGuard);

  // ------------------------------------------------------------ org & setup
  api.get('/bootstrap', h(() => {
    const db = getDb();
    return { organization: db.organization, accounts: db.accounts, preferences: db.preferences, salespersons: db.preferences.salespersons, approvals: approvalSettings(db.preferences), pdfTemplates: templates() };
  }));
  api.put('/organization', m((req) => {
    const body = { ...(req.body as Record<string, unknown>) };
    if (body.logo !== undefined && body.logo !== '' && body.logo !== null) {
      const logo = String(body.logo);
      if (!/^data:image\/(png|jpe?g|gif|bmp|webp|svg\+xml);base64,/.test(logo)) throw new S.HttpError(400, 'The logo must be a JPG, PNG, GIF or BMP image');
      if (logo.length > 1.4 * 1024 * 1024) throw new S.HttpError(400, 'The logo must be 1 MB or smaller');
    }
    if (body.logo === null) body.logo = '';
    return Object.assign(getDb().organization, body, { id: getDb().organization.id });
  }));

  // ------------------------------------------------------------ PDF templates
  const templates = () => {
    const db = getDb();
    if (!Array.isArray(db.pdfTemplates) || !db.pdfTemplates.length) db.pdfTemplates = builtInTemplates();
    return db.pdfTemplates.map((t) => normalizeTemplate(t));
  };
  const findTemplate = (id: string) => {
    const t = getDb().pdfTemplates?.find((x) => x.id === id);
    if (!t) throw new S.HttpError(404, 'Template not found');
    return t;
  };
  api.get('/pdf-templates', h(() => templates()));
  api.post('/pdf-templates', m((req) => {
    const db = getDb();
    templates();
    const body = req.body as Partial<PdfTemplate> & { from?: string };
    const base = body.from ? findTemplate(body.from) : undefined;
    const name = String(body.name || (base ? `${base.name} (Copy)` : '')).trim();
    if (!name) throw new S.HttpError(400, 'Template Name is required');
    const { from: _from, id: _id, builtIn: _b, ...rest } = body;
    const t = normalizeTemplate({ ...(base || {}), ...rest, layout: rest.layout || base?.layout || 'standard', name, id: newId('tpl'), builtIn: false, updatedAt: now() });
    db.pdfTemplates.push(t);
    return t;
  }));
  api.put('/pdf-templates/defaults', m((req) => {
    const { kind, templateId } = req.body as { kind: string; templateId: string };
    if (!(kind in DOC_META) && kind !== 'payment') throw new S.HttpError(400, 'Unknown module');
    findTemplate(templateId);
    const prefs = getDb().preferences;
    prefs.defaultTemplates = { ...((prefs.defaultTemplates as Record<string, string>) || {}), [kind]: templateId };
    return prefs.defaultTemplates;
  }));
  api.put('/pdf-templates/:id', m((req) => {
    const db = getDb();
    templates();
    const cur = findTemplate(p(req, 'id'));
    const body = req.body as Partial<PdfTemplate>;
    if (body.name !== undefined && !String(body.name).trim()) throw new S.HttpError(400, 'Template Name is required');
    const next = normalizeTemplate({ ...cur, ...body, header: { ...cur.header, ...body.header }, details: { ...cur.details, ...body.details }, table: { ...cur.table, ...body.table, labels: { ...cur.table.labels, ...body.table?.labels } }, total: { ...cur.total, ...body.total }, other: { ...cur.other, ...body.other }, margins: { ...cur.margins, ...body.margins }, id: cur.id, builtIn: cur.builtIn, updatedAt: now() } as PdfTemplate);
    db.pdfTemplates[db.pdfTemplates.indexOf(cur)] = next;
    return next;
  }));
  api.delete('/pdf-templates/:id', m((req) => {
    const db = getDb();
    const t = findTemplate(p(req, 'id'));
    if (t.builtIn) throw new S.HttpError(400, 'Built-in templates cannot be deleted');
    db.pdfTemplates = db.pdfTemplates.filter((x) => x.id !== t.id);
    const defaults = (db.preferences.defaultTemplates || {}) as Record<string, string>;
    for (const k of Object.keys(defaults)) if (defaults[k] === t.id) delete defaults[k];
    for (const d of db.docs) if (d.templateId === t.id) d.templateId = undefined;
    return { ok: true };
  }));

  // ------------------------------------------------------------ custom fields per module
  api.put('/custom-fields/:kind', m((req) => {
    const kind = p(req, 'kind') as DocKind;
    if (!DOC_META[kind]) throw new S.HttpError(400, 'Unknown module');
    const raw = (req.body?.fields || []) as Partial<CustomFieldDef>[];
    const seen = new Set<string>();
    const fields: CustomFieldDef[] = raw.map((f) => {
      const label = String(f.label || '').trim();
      if (!label) throw new S.HttpError(400, 'Label Name is required');
      if (seen.has(label.toLowerCase())) throw new S.HttpError(400, `A field named "${label}" already exists`);
      seen.add(label.toLowerCase());
      const dataType = CUSTOM_FIELD_TYPES.some((t) => t.value === f.dataType) ? f.dataType! : 'text';
      const options = dataType === 'dropdown' ? (f.options || []).map((o) => String(o).trim()).filter(Boolean) : undefined;
      if (dataType === 'dropdown' && !options?.length) throw new S.HttpError(400, `Add at least one option for ${label}`);
      return { id: f.id || newId('cf'), label, dataType, options, defaultValue: f.defaultValue ? String(f.defaultValue) : undefined, mandatory: !!f.mandatory, showInPdf: f.showInPdf !== false, active: f.active !== false };
    });
    const prefs = getDb().preferences;
    prefs.customFields = { ...((prefs.customFields as Record<string, CustomFieldDef[]>) || {}), [kind]: fields };
    return fields;
  }));

  // module defaults for notes and terms ("use this in future for all ...")
  api.put('/doc-defaults/:kind', m((req) => {
    const kind = p(req, 'kind') as DocKind;
    if (!DOC_META[kind]) throw new S.HttpError(400, 'Unknown module');
    const prefs = getDb().preferences;
    const all = { ...((prefs.docDefaults as Record<string, { notes?: string; terms?: string }>) || {}) };
    const cur = { ...all[kind] };
    if (typeof req.body?.notes === 'string') cur.notes = req.body.notes;
    if (typeof req.body?.terms === 'string') cur.terms = req.body.terms;
    all[kind] = cur;
    prefs.docDefaults = all;
    return cur;
  }));
  api.put('/preferences', m((req) => {
    const prefs = getDb().preferences;
    const body = { ...(req.body as Record<string, unknown>) };
    delete body.paymentReminders; // saved through /payment-reminders (Admin only)
    // keep per-module defaults (Customize > Terms & Conditions) in step with the global preference fields
    const dd = { ...((prefs.docDefaults as Record<string, { notes?: string; terms?: string }>) || {}) };
    const sync = (key: string, kind: string, field: 'notes' | 'terms') => {
      if (typeof body[key] === 'string' && body[key] !== prefs[key] && dd[kind]) dd[kind] = { ...dd[kind], [field]: body[key] as string };
    };
    sync('invoiceTerms', 'invoice', 'terms');
    sync('quoteNotes', 'quote', 'notes');
    sync('customerNotes', 'invoice', 'notes');
    prefs.docDefaults = dd;
    return Object.assign(prefs, body);
  }));
  // ------------------------------------------------------------ automatic payment reminders
  api.get('/payment-reminders', h(() => {
    const db = getDb();
    return { settings: reminderSettings(db.preferences), upcoming: dueReminders().map((x) => ({ invoiceId: x.invoiceId, number: x.number, ruleName: x.rule.name })), log: reminderLog() };
  }));
  api.put('/payment-reminders', m((req) => {
    requireAdmin();
    return saveReminderSettings(req.body || {});
  }));
  api.post('/payment-reminders/run', h(async (req) => {
    requireAdmin();
    return runReminders(undefined, origin(req));
  }));
  api.get('/admin/backup', (req, res, next) => {
    try {
      requireAdmin();
    } catch (e) {
      return next(e);
    }
    const db = getDb();
    // sign-in secrets and sessions never leave the server
    const safe = { ...db, users: db.users.map(({ passwordHash: _p, resetTokenHash: _r, inviteTokenHash: _i, ...u }) => u), staffSessions: [], portalSessions: [], portalUsers: db.portalUsers.map((u) => ({ ...u, passwordHash: undefined, resetTokenHash: undefined, inviteTokenHash: undefined })) };
    res.setHeader('Content-Disposition', `attachment; filename="creatign-ledger-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(safe);
  });
  api.post('/admin/reset', h((req) => {
    requireAdmin();
    // the team and their sign-ins stay
    resetDb(req.body?.samples !== false, ['users', 'staffSessions']);
    S.commit();
    return { ok: true };
  }));

  // ------------------------------------------------------------ accountant (server/accountant.ts)
  registerAuthRoutes(api, h, m);
  registerAccountantRoutes(api, h, m);
  registerBankingRoutes(api, h, m);

  // ------------------------------------------------------------ items
  api.get('/items', h((req) => {
    const status = q(req, 'status');
    return getDb().items.filter((i) => (!status || status === 'all' || i.status === status) && (matches(i.name, q(req, 'q')) || matches(i.sku, q(req, 'q'))));
  }));
  api.get('/items/:id', h((req) => {
    const db = getDb();
    const item = db.items.find((i) => i.id === p(req, 'id'));
    if (!item) throw new S.HttpError(404, 'Item not found');
    const usage = db.docs.filter((d) => d.lineItems.some((l) => l.itemId === item.id)).map((d) => ({ id: d.id, kind: d.kind, number: d.number, date: d.date, status: d.status, contact: S.contactName(db, d.contactId), total: d.total }));
    return { ...item, usage };
  }));
  api.post('/items', m((req) => S.upsertItem(req.body)));
  api.put('/items/:id', m((req) => S.upsertItem(req.body, p(req, 'id'))));
  api.delete('/items/:id', m((req) => S.deleteItem(p(req, 'id'))));

  // ------------------------------------------------------------ contacts
  api.get('/contacts', h((req) => {
    const kind = q(req, 'kind');
    const status = q(req, 'status') || 'active';
    const needle = q(req, 'q');
    return getDb()
      .contacts.filter((c) => (!kind || c.kind === kind) && (status === 'all' || c.status === status) && (matches(c.displayName, needle) || matches(c.companyName, needle) || matches(c.email, needle)))
      .map((c) => ({ ...c, ...S.contactSummary(c) }));
  }));
  api.get('/contacts/:id', h((req) => {
    const c = S.getContact(p(req, 'id'));
    return { ...c, ...S.contactSummary(c) };
  }));
  api.post('/contacts', m((req) => S.upsertContact(req.body)));
  api.put('/contacts/:id', m((req) => S.upsertContact(req.body, p(req, 'id'))));
  api.delete('/contacts/:id', m((req) => S.deleteContact(p(req, 'id'))));
  api.post('/contacts/:id/status', m((req) => {
    const c = S.getContact(p(req, 'id'));
    c.status = req.body.status === 'inactive' ? 'inactive' : 'active';
    return c;
  }));
  api.post('/contacts/:id/clone', m((req) => {
    const c = S.getContact(p(req, 'id'));
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = c;
    return S.upsertContact({ ...structuredClone(rest), displayName: `${c.displayName} (Copy)`, openingBalance: 0 });
  }));
  api.post('/contacts/:id/merge', m((req) => {
    const db = getDb();
    const target = S.getContact(p(req, 'id'));
    const src = S.getContact(String(req.body.sourceId));
    if (src.kind !== target.kind || src.id === target.id) throw new S.HttpError(400, 'Pick another contact of the same type to merge');
    for (const d of db.docs) if (d.contactId === src.id) d.contactId = target.id;
    for (const x of db.paymentsReceived) if (x.contactId === src.id) x.contactId = target.id;
    for (const x of db.paymentsMade) if (x.contactId === src.id) x.contactId = target.id;
    for (const e of db.expenses) {
      if (e.vendorId === src.id) e.vendorId = target.id;
      if (e.customerId === src.id) e.customerId = target.id;
    }
    target.openingBalance += src.openingBalance;
    db.contacts = db.contacts.filter((c) => c.id !== src.id);
    logActivity(db, 'contact', target.id, target.id, `${src.displayName} merged into ${target.displayName}`);
    return target;
  }));
  api.get('/contacts/:id/transactions', h((req) => R.contactTransactions(S.getContact(p(req, 'id')))));
  api.get('/contacts/:id/income', h((req) => R.contactIncome(S.getContact(p(req, 'id')), (q(req, 'period') as PeriodKey) || 'last_6_months', (q(req, 'basis') as 'cash') || 'accrual')));
  api.get('/contacts/:id/statement', h((req) => {
    const c = S.getContact(p(req, 'id'));
    const r = periodRange((q(req, 'period') as PeriodKey) || 'this_month', today(), getDb().organization.fiscalYearStartMonth);
    return R.statement(c, q(req, 'from') || r.from, q(req, 'to') || r.to, (q(req, 'filter') as 'outstanding') || 'all');
  }));

  // ------------------------------------------------------------ documents
  api.get('/docs', h((req) => {
    const db = getDb();
    const kind = q(req, 'kind');
    const status = q(req, 'status');
    const contactId = q(req, 'contactId');
    const needle = q(req, 'q');
    return db.docs
      .filter((d) => (!kind || d.kind === kind) && (!contactId || d.contactId === contactId))
      .filter((d) => !status || status === 'all' || d.status === status || (status === 'unpaid' && ['open', 'sent', 'overdue', 'due_today', 'partially_paid'].includes(d.status)))
      .map((d) => ({ ...d, contactName: S.contactName(db, d.contactId) }))
      .filter((d) => !needle || [d.number, d.referenceNumber, d.orderNumber, d.contactName, d.profileName].some((t) => matches(t, needle)))
      .sort((a, b) => (b.date === a.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)));
  }));
  api.get('/docs/next-number', h((req) => ({ number: S.nextNumber(q(req, 'kind') as DocKind) })));
  api.get('/docs/:id', h((req) => {
    const db = getDb();
    const d = S.getDoc(p(req, 'id'));
    const contact = db.contacts.find((c) => c.id === d.contactId);
    const related = {
      quote: d.quoteId ? db.docs.find((x) => x.id === d.quoteId) : undefined,
      salesOrder: d.salesOrderId ? db.docs.find((x) => x.id === d.salesOrderId) : undefined,
      deliveryChallan: d.deliveryChallanId ? db.docs.find((x) => x.id === d.deliveryChallanId) : undefined,
      purchaseOrder: d.purchaseOrderId ? db.docs.find((x) => x.id === d.purchaseOrderId) : undefined,
      invoice: d.invoiceId ? db.docs.find((x) => x.id === d.invoiceId) : undefined,
      profile: d.recurringProfileId ? db.docs.find((x) => x.id === d.recurringProfileId) : undefined,
      children: db.docs.filter((x) => x.quoteId === d.id || x.salesOrderId === d.id || x.deliveryChallanId === d.id || x.purchaseOrderId === d.id || x.recurringProfileId === d.id || (x.invoiceId === d.id && x.kind === 'credit_note')),
      payments:
        d.kind === 'invoice'
          ? db.paymentsReceived.filter((x) => x.allocations.some((a) => a.docId === d.id)).map((x) => ({ id: x.id, number: x.number, date: x.date, mode: x.mode, status: x.status, amount: x.allocations.find((a) => a.docId === d.id)!.amount }))
          : d.kind === 'bill'
            ? db.paymentsMade.filter((x) => x.allocations.some((a) => a.docId === d.id)).map((x) => ({ id: x.id, number: x.number, date: x.date, mode: x.mode, status: x.status, amount: x.allocations.find((a) => a.docId === d.id)!.amount }))
            : d.kind === 'retainer_invoice'
              ? db.paymentsReceived.filter((x) => x.retainerInvoiceId === d.id).map((x) => ({ id: x.id, number: x.number, date: x.date, mode: x.mode, status: x.status, amount: x.amount, unused: x.unusedAmount }))
              : [],
      creditsApplied: db.docs.filter((c) => c.creditApplications.some((a) => a.invoiceId === d.id)).flatMap((c) => c.creditApplications.filter((a) => a.invoiceId === d.id).map((a) => ({ ...a, creditId: c.id, creditNumber: c.number }))),
      appliedTo: d.creditApplications.map((a) => ({ ...a, number: db.docs.find((x) => x.id === a.invoiceId)?.number })),
    };
    return { ...d, contactName: contact?.displayName, contact, related, journals: journalsFor(d.id) };
  }));
  api.get('/docs/:id/convert', h((req) => S.convertTemplate(p(req, 'id'), q(req, 'to') as DocKind)));
  api.post('/docs', m((req) => {
    const { kind, mode, ...body } = req.body as TxnDoc & { mode: S.SaveMode };
    if (!DOC_META[kind]) throw new S.HttpError(400, 'Unknown document kind');
    return S.saveDoc(kind, body, mode);
  }));
  api.put('/docs/:id', m((req) => {
    const d = S.getDoc(p(req, 'id'));
    const { mode, ...body } = req.body as TxnDoc & { mode: S.SaveMode };
    return S.saveDoc(d.kind, body, mode, d.id);
  }));
  api.delete('/docs/:id', m((req) => S.deleteDoc(p(req, 'id'))));
  api.post('/docs/:id/actions/:action', m((req) => S.docAction(p(req, 'id'), p(req, 'action'), req.body)));
  // PDF settings of one document: its template and the notes / terms printed on it.
  // Allowed on locked and posted documents too, since nothing here touches the ledger.
  api.patch('/docs/:id/print-settings', m((req) => {
    const db = getDb();
    const d = S.getDoc(p(req, 'id'));
    const meta = DOC_META[d.kind];
    const b = req.body as { templateId?: string | null; notes?: string; terms?: string; notesDefault?: boolean; termsDefault?: boolean };
    if (b.templateId !== undefined) {
      if (b.templateId) findTemplate(b.templateId);
      d.templateId = b.templateId || undefined;
      logActivity(db, d.kind, d.id, d.contactId, `PDF template changed to ${resolveTemplate(db.pdfTemplates, db.preferences, d.kind, d.templateId).name}`);
    }
    const changed: string[] = [];
    if (typeof b.notes === 'string') {
      if (meta.side === 'sales') d.customerNotes = b.notes;
      else d.notes = b.notes;
      changed.push('notes');
    }
    if (typeof b.terms === 'string') {
      d.terms = b.terms;
      changed.push('terms & conditions');
    }
    if (changed.length) logActivity(db, d.kind, d.id, d.contactId, `${meta.label} ${changed.join(' and ')} updated`);
    if (b.notesDefault || b.termsDefault) {
      const all = { ...((db.preferences.docDefaults as Record<string, { notes?: string; terms?: string }>) || {}) };
      const cur = { ...all[d.kind] };
      if (b.notesDefault && typeof b.notes === 'string') cur.notes = b.notes;
      if (b.termsDefault && typeof b.terms === 'string') cur.terms = b.terms;
      all[d.kind] = cur;
      db.preferences.docDefaults = all;
    }
    d.updatedAt = now();
    return d;
  }));
  api.post('/docs/:id/apply-credits', m((req) => S.applyCredits(p(req, 'id'), req.body.applications || [])));
  api.delete('/docs/:id/credit-applications/:appId', m((req) => S.removeCreditApplication(p(req, 'id'), p(req, 'appId'))));
  api.post('/docs/:id/refunds', m((req) => S.refundCredit(p(req, 'id'), req.body)));
  api.post('/recurring/run', m(() => ({ created: S.generateRecurringNow() })));

  // ------------------------------------------------------------ payments received
  api.get('/payments-received', h((req) => {
    const db = getDb();
    const needle = q(req, 'q');
    const contactId = q(req, 'contactId');
    return db.paymentsReceived
      .filter((x) => !contactId || x.contactId === contactId)
      .map((x) => ({ ...x, contactName: S.contactName(db, x.contactId), invoiceNumbers: x.allocations.map((a) => db.docs.find((d) => d.id === a.docId)?.number).filter(Boolean) }))
      .filter((x) => !needle || [x.number, x.contactName, x.referenceNumber].some((t) => matches(t, needle)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }));
  api.get('/payments-received/next-number', h(() => ({ number: peekNumber('payment_received', '', 1) })));
  api.get('/payments-received/:id', h((req) => {
    const db = getDb();
    const x = db.paymentsReceived.find((y) => y.id === p(req, 'id'));
    if (!x) throw new S.HttpError(404, 'Payment not found');
    return { ...x, contactName: S.contactName(db, x.contactId), contact: db.contacts.find((c) => c.id === x.contactId), invoices: x.allocations.map((a) => ({ ...a, doc: db.docs.find((d) => d.id === a.docId) })), journals: journalsFor(x.id) };
  }));
  api.post('/payments-received', h(async (req) => {
    const pmt = S.savePaymentReceived(req.body);
    S.commit();
    const c = getDb().contacts.find((x) => x.id === pmt.contactId);
    if (req.body.sendThankYou && c?.email) {
      // the payment is saved either way; a failed email shows up in the email log
      const d = composeDefaults({ entityType: 'payment_received', entityId: pmt.id });
      await sendEmail({ entityType: 'payment_received', entityId: pmt.id, to: d.to, subject: d.subject, body: d.body, templateId: d.templateId, attachPdf: true }, origin(req)).catch(() => undefined);
      S.commit();
    }
    return pmt;
  }));
  api.put('/payments-received/:id', m((req) => S.savePaymentReceived(req.body, p(req, 'id'))));
  api.delete('/payments-received/:id', m((req) => {
    const db = getDb();
    const x = db.paymentsReceived.find((y) => y.id === p(req, 'id'));
    if (x?.locked) throw new S.HttpError(400, 'This payment is locked');
    db.paymentsReceived = db.paymentsReceived.filter((y) => y.id !== p(req, 'id'));
  }));
  api.post('/payments-received/:id/actions/:action', m((req) => S.paymentReceivedAction(p(req, 'id'), p(req, 'action'), req.body)));

  // ------------------------------------------------------------ payments made
  api.get('/payments-made', h((req) => {
    const db = getDb();
    const needle = q(req, 'q');
    const contactId = q(req, 'contactId');
    return db.paymentsMade
      .filter((x) => !contactId || x.contactId === contactId)
      .map((x) => ({ ...x, contactName: S.contactName(db, x.contactId), billNumbers: x.allocations.map((a) => db.docs.find((d) => d.id === a.docId)?.number).filter(Boolean) }))
      .filter((x) => !needle || [x.number, x.contactName, x.referenceNumber].some((t) => matches(t, needle)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }));
  api.get('/payments-made/next-number', h(() => ({ number: peekNumber('payment_made', '', 1) })));
  api.get('/payments-made/:id', h((req) => {
    const db = getDb();
    const x = db.paymentsMade.find((y) => y.id === p(req, 'id'));
    if (!x) throw new S.HttpError(404, 'Payment not found');
    return { ...x, contactName: S.contactName(db, x.contactId), contact: db.contacts.find((c) => c.id === x.contactId), bills: x.allocations.map((a) => ({ ...a, doc: db.docs.find((d) => d.id === a.docId) })), journals: journalsFor(x.id) };
  }));
  api.post('/payments-made/:id/apply', m((req) => S.applyPaymentMade(p(req, 'id'), (req.body?.allocations as { docId: string; amount: number }[]) || [])));
  api.post('/payments-made/bulk', m((req) => S.savePaymentsBulk((req.body?.payments as Partial<PaymentMade>[]) || [])));
  api.post('/payments-made/:id/refunds', m((req) => S.refundPaymentMade(p(req, 'id'), req.body)));
  api.delete('/payments-made/:id/refunds/:refundId', m((req) => S.deletePaymentMadeRefund(p(req, 'id'), p(req, 'refundId'))));
  api.post('/payments-made', m((req) => S.savePaymentMade(req.body)));
  api.put('/payments-made/:id', m((req) => S.savePaymentMade(req.body, p(req, 'id'))));
  api.delete('/payments-made/:id', m((req) => {
    getDb().paymentsMade = getDb().paymentsMade.filter((y) => y.id !== p(req, 'id'));
  }));
  api.post('/payments-made/:id/actions/void', m((req) => {
    const x = getDb().paymentsMade.find((y) => y.id === p(req, 'id'));
    if (!x) throw new S.HttpError(404, 'Payment not found');
    x.status = 'void';
    x.allocations = [];
    return x;
  }));

  // ------------------------------------------------------------ expenses
  api.get('/expenses', h((req) => {
    const db = getDb();
    const view = q(req, 'view') || 'all';
    const needle = q(req, 'q');
    const accs = new Map(db.accounts.map((a) => [a.id, a.name]));
    return db.expenses
      .filter((e) => {
        switch (view) {
          case 'unbilled':
            return e.status === 'unbilled';
          case 'invoiced':
            return e.status === 'invoiced';
          case 'reimbursed':
            return e.status === 'reimbursed';
          case 'billable':
            return e.billable;
          case 'non_billable':
            return !e.billable;
          case 'with_receipts':
            return e.receipts.length > 0;
          case 'without_receipts':
            return e.receipts.length === 0;
          default:
            return true;
        }
      })
      .map((e) => ({ ...e, accountName: e.itemized ? 'Itemized' : accs.get(e.accountId), paidThroughName: accs.get(e.paidThroughAccountId), vendorName: S.contactName(db, e.vendorId), customerName: S.contactName(db, e.customerId) }))
      .filter((e) => !needle || [e.accountName, e.vendorName, e.customerName, e.notes, e.invoiceNumber].some((t) => matches(t, needle)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }));
  api.get('/expenses/:id', h((req) => {
    const db = getDb();
    const e = db.expenses.find((x) => x.id === p(req, 'id'));
    if (!e) throw new S.HttpError(404, 'Expense not found');
    const accs = new Map(db.accounts.map((a) => [a.id, a.name]));
    const profile = e.recurringProfileId ? db.recurringExpenses.find((r) => r.id === e.recurringProfileId) : undefined;
    const invoice = e.invoiceId ? db.docs.find((d) => d.id === e.invoiceId) : undefined;
    return {
      ...e,
      accountName: e.isMileage ? 'Mileage' : e.itemized ? 'Itemized' : accs.get(e.accountId),
      paidThroughName: accs.get(e.paidThroughAccountId),
      vendorName: S.contactName(db, e.vendorId),
      customerName: S.contactName(db, e.customerId),
      profile: profile && { id: profile.id, profileName: profile.profileName, status: profile.status },
      projectName: e.projectId ? db.projects.find((x) => x.id === e.projectId)?.name : undefined,
      invoice: invoice && { id: invoice.id, number: invoice.number, status: invoice.status },
      journals: journalsFor(e.id),
    };
  }));
  api.post('/expenses', m((req) => S.saveExpense(req.body)));
  api.post('/expenses/bulk', m((req) => (req.body.expenses as unknown[]).map((e) => S.saveExpense(e as never))));
  api.put('/expenses/:id', m((req) => S.saveExpense(req.body, p(req, 'id'))));
  api.delete('/expenses/:id', m((req) => S.deleteExpenses([p(req, 'id')])));
  api.post('/expenses/bulk-delete', m((req) => S.deleteExpenses(((req.body?.ids as unknown[]) || []).map(String))));
  api.post('/expenses/:id/convert-to-invoice', m((req) => S.convertExpenseToInvoice(p(req, 'id'))));
  api.post('/expenses/:id/reimburse', m((req) => {
    const e = getDb().expenses.find((x) => x.id === p(req, 'id'));
    if (!e) throw new S.HttpError(404, 'Expense not found');
    e.status = 'reimbursed';
    return e;
  }));

  api.get('/recurring-expenses', h(() => {
    const db = getDb();
    const accs = new Map(db.accounts.map((a) => [a.id, a.name]));
    return db.recurringExpenses.map((r) => ({ ...r, accountName: accs.get(r.accountId), vendorName: S.contactName(db, r.vendorId), customerName: S.contactName(db, r.customerId), children: db.expenses.filter((e) => e.recurringProfileId === r.id).length }));
  }));
  api.get('/recurring-expenses/:id', h((req) => {
    const db = getDb();
    const r = db.recurringExpenses.find((x) => x.id === p(req, 'id'));
    if (!r) throw new S.HttpError(404, 'Recurring expense not found');
    const accs = new Map(db.accounts.map((a) => [a.id, a.name]));
    return {
      ...r,
      accountName: accs.get(r.accountId),
      paidThroughName: accs.get(r.paidThroughAccountId),
      vendorName: S.contactName(db, r.vendorId),
      customerName: S.contactName(db, r.customerId),
      children: db.expenses.filter((e) => e.recurringProfileId === r.id).sort((a, b) => b.date.localeCompare(a.date)),
    };
  }));
  api.post('/recurring-expenses', m((req) => S.saveRecurringExpense(req.body)));
  api.put('/recurring-expenses/:id', m((req) => S.saveRecurringExpense(req.body, p(req, 'id'))));
  api.delete('/recurring-expenses/:id', m((req) => {
    getDb().recurringExpenses = getDb().recurringExpenses.filter((x) => x.id !== p(req, 'id'));
  }));
  api.post('/recurring-expenses/:id/actions/:action', m((req) => S.recurringExpenseAction(p(req, 'id'), p(req, 'action'))));

  // ------------------------------------------------------------ comments, activity, mail
  // comments saved before the stricter sanitizer are cleaned again on the way out
  api.get('/comments', h((req) => getDb().comments.filter((c) => c.entityId === q(req, 'entityId')).slice().reverse().map((c) => ({ ...c, html: sanitize(c.html) }))));
  api.post('/comments', m((req) => {
    const { entityType, entityId, html } = req.body;
    if (!entityId || !String(html || '').replace(/<[^>]*>/g, '').trim()) throw new S.HttpError(400, 'Comment cannot be empty');
    const c = { id: newId('cmt'), entityType, entityId, html: sanitize(String(html)), author: requestUser()?.name ?? getDb().organization.name, createdAt: now() };
    getDb().comments.push(c);
    return c;
  }));
  api.delete('/comments/:id', m((req) => {
    getDb().comments = getDb().comments.filter((c) => c.id !== p(req, 'id'));
  }));
  api.get('/activities', h((req) => {
    const entityId = q(req, 'entityId');
    const contactId = q(req, 'contactId');
    return getDb()
      .activities.filter((a) => (entityId && a.entityId === entityId) || (contactId && a.contactId === contactId))
      .slice()
      .reverse()
      .slice(0, 200);
  }));
  api.get('/mails', h((req) => {
    const contactId = q(req, 'contactId');
    const entityId = q(req, 'entityId');
    const status = q(req, 'status');
    const search = q(req, 'search');
    const rows = getDb()
      .mails.filter((x) => (!contactId || x.contactId === contactId) && (!entityId || x.entityId === entityId) && (!status || (x.status || (x.delivered ? 'sent' : 'outbox')) === status))
      .filter((x) => !search || matches(`${x.subject} ${x.to.join(' ')}`, search))
      .slice()
      .reverse();
    return rows.slice(0, Number(q(req, 'limit')) || 500).map(listMail);
  }));
  api.get('/mail-settings', h(() => mailSettings()));
  api.get('/mail/google/start', (req, res) => {
    const nonce = q(req, 'nonce');
    try {
      requireAdmin();
      res.redirect(createGoogleAuthorizationUrl(nonce || ''));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start Google authorization';
      res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }).status(400).type('html').send(googleOAuthResultPage({ nonce, ok: false, error: message }));
    }
  });
  api.get('/mail/google/callback', async (req, res) => {
    const pending = consumeGoogleAuthorizationState(q(req, 'state'));
    if (!pending) {
      res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }).status(400).type('html').send(googleOAuthResultPage({ ok: false, error: 'Gmail authorization expired. Close this window and try again.' }));
      return;
    }
    const providerError = q(req, 'error');
    if (providerError) {
      res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }).status(400).type('html').send(googleOAuthResultPage({ nonce: pending.nonce, ok: false, error: 'Google authorization was cancelled or denied.' }));
      return;
    }
    const code = q(req, 'code');
    if (!code) {
      res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }).status(400).type('html').send(googleOAuthResultPage({ nonce: pending.nonce, ok: false, error: 'Google did not return an authorization code.' }));
      return;
    }
    try {
      const email = await finishGoogleAuthorization(code, pending.codeVerifier);
      res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }).type('html').send(googleOAuthResultPage({ nonce: pending.nonce, ok: true, email }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not connect the Google account';
      res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }).status(400).type('html').send(googleOAuthResultPage({ nonce: pending.nonce, ok: false, error: message }));
    }
  });
  api.delete('/mail/google/account', h(() => {
    requireAdmin();
    return disconnectGoogleAccount();
  }));
  api.get('/mails/:id', h((req) => {
    const mail = getDb().mails.find((x) => x.id === p(req, 'id'));
    if (!mail) throw new S.HttpError(404, 'Email not found');
    return mail;
  }));
  api.get('/mail/compose', h((req) => {
    const from = q(req, 'statementFrom');
    const to = q(req, 'statementTo');
    return composeDefaults({ entityType: q(req, 'entityType'), entityId: q(req, 'entityId'), contactId: q(req, 'contactId'), templateId: q(req, 'templateId'), statement: from && to ? { from, to, filter: (q(req, 'statementFilter') as 'all') || 'all' } : undefined });
  }));
  api.post('/mail/preview', h((req, res) => {
    res.type('html').set('Cache-Control', 'no-store').send(previewEmail(req.body, origin(req)));
  }));
  api.post('/mails', h(async (req) => {
    const db = getDb();
    const b = req.body;
    const about = b.entityId ? db.docs.find((x) => x.id === b.entityId) : undefined;
    if (about && approvalEnabled(db.preferences, about.kind) && needsApproval(about.status)) {
      throw new S.HttpError(400, `Approve this ${DOC_META[about.kind].label.toLowerCase()} before sending it`);
    }
    try {
      const mail = await sendEmail({ ...b, attachPdf: b.attachPdf ?? false }, origin(req));
      S.commit();
      return listMail(mail);
    } catch (e) {
      S.commit(); // keep the failed attempt in the log
      throw e;
    }
  }));
  api.post('/mails/:id/resend', h(async (req) => {
    try {
      const mail = await resendMail(p(req, 'id'), origin(req));
      S.commit();
      return listMail(mail);
    } catch (e) {
      S.commit();
      throw e;
    }
  }));

  // ------------------------------------------------------------ email settings & templates
  // where mail goes (and so where reset links land) is an Admin decision
  api.put('/mail-settings', h((req) => {
    requireAdmin();
    const db = getDb();
    const b = req.body as Partial<SmtpSettings> & { password?: string; clearPassword?: boolean };
    const cur = savedSmtp();
    const security = (['ssl', 'starttls', 'none'] as const).includes(b.security as 'ssl') ? (b.security as SmtpSettings['security']) : cur.security;
    const next: SmtpSettings = {
      ...cur,
      enabled: b.enabled ?? cur.enabled,
      host: String(b.host ?? cur.host).trim(),
      port: Number(b.port ?? cur.port) || (security === 'ssl' ? 465 : 587),
      security,
      user: String(b.user ?? cur.user ?? '').trim() || undefined,
      fromName: String(b.fromName ?? cur.fromName ?? '').trim() || undefined,
      fromEmail: String(b.fromEmail ?? cur.fromEmail ?? '').trim() || undefined,
      replyTo: String(b.replyTo ?? cur.replyTo ?? '').trim() || undefined,
    };
    if (b.password) next.passEnc = encryptSecret(String(b.password).replace(/\s+/g, ''));
    if (b.clearPassword) next.passEnc = undefined;
    if (next.enabled) {
      if (!next.host) throw new S.HttpError(400, 'Enter the SMTP server host');
      if (!(next.port > 0 && next.port < 65536)) throw new S.HttpError(400, 'Enter a valid SMTP port');
      const fromEmail = next.fromEmail || next.user;
      if (!fromEmail || !isEmail(fromEmail)) throw new S.HttpError(400, 'Enter the email address messages are sent from');
    }
    for (const e of [next.fromEmail, next.replyTo]) if (e && !isEmail(e)) throw new S.HttpError(400, `"${e}" is not a valid email address`);
    db.preferences.smtp = next;
    S.commit();
    return mailSettings();
  }));
  api.post('/mail-settings/test', h(async (req) => {
    requireAdmin();
    const db = getDb();
    const to = String(req.body.to || db.organization.email || '').trim();
    if (!isEmail(to)) throw new S.HttpError(400, 'Enter an email address to send the test to');
    const settings = mailSettings();
    if (settings.provider === 'smtp') {
      try {
        await verifySmtp();
      } catch (e) {
        throw new S.HttpError(502, `Could not sign in to the SMTP server: ${e instanceof Error ? e.message : e}`);
      }
    }
    const mail = await sendEmail({ to: [to], subject: `Test email from ${db.organization.name}`, body: `This is a test email from Creatign Ledger.\n\nIf you can read this, email sending is working and your clients will receive invoices, estimates and portal invitations from ${settings.from || db.organization.email}.` }, origin(req)).catch((e) => {
      S.commit();
      throw e;
    });
    S.commit();
    return listMail(mail);
  }));
  api.get('/email-templates', h(() => {
    const t = emailTemplates();
    return t;
  }));
  api.post('/email-templates', h((req) => {
    const db = getDb();
    const kind = req.body.kind as EmailTemplateKind;
    if (!EMAIL_TEMPLATE_KINDS.some((k) => k.kind === kind)) throw new S.HttpError(400, 'Choose what the template is for');
    const tpl = validTemplate({ id: newId('etpl'), kind, name: req.body.name, subject: req.body.subject, body: req.body.body, isDefault: false, updatedAt: now() });
    emailTemplates().push(tpl);
    if (req.body.isDefault) setDefaultTemplate(tpl);
    S.commit();
    return tpl;
  }));
  api.put('/email-templates/:id', h((req) => {
    const t = emailTemplates().find((x) => x.id === p(req, 'id'));
    if (!t) throw new S.HttpError(404, 'Template not found');
    Object.assign(t, validTemplate({ ...t, name: req.body.name ?? t.name, subject: req.body.subject ?? t.subject, body: req.body.body ?? t.body }), { updatedAt: now() });
    if (req.body.isDefault) setDefaultTemplate(t);
    S.commit();
    return t;
  }));
  api.post('/email-templates/:id/restore', h((req) => {
    const t = emailTemplates().find((x) => x.id === p(req, 'id'));
    const original = builtInEmailTemplates().find((x) => x.id === t?.id);
    if (!t || !original) throw new S.HttpError(404, 'Only built-in templates can be restored');
    Object.assign(t, { name: original.name, subject: original.subject, body: original.body, updatedAt: now() });
    S.commit();
    return t;
  }));
  api.delete('/email-templates/:id', h((req) => {
    const db = getDb();
    const t = emailTemplates().find((x) => x.id === p(req, 'id'));
    if (!t) throw new S.HttpError(404, 'Template not found');
    if (t.builtIn) throw new S.HttpError(400, 'Built-in templates cannot be deleted. Edit or restore them instead.');
    db.emailTemplates = db.emailTemplates.filter((x) => x.id !== t.id);
    if (t.isDefault) setDefaultTemplate(emailTemplates().find((x) => x.kind === t.kind)!);
    S.commit();
  }));

  // ------------------------------------------------------------ share links & customer portal
  publicShareRoutes(api);
  staffPortalRoutes(api, () => S.commit());

  // ------------------------------------------------------------ uploads
  const upload = multer({
    storage: multer.diskStorage({
      destination: UPLOAD_DIR,
      filename: (_req, file, cb) => cb(null, `${newId('f')}${path.extname(file.originalname).slice(0, 10)}`),
    }),
    limits: { fileSize: 10 * 1024 * 1024, files: 10 },
  });
  api.post('/uploads', upload.array('files', 10), h((req) => {
    const files = (req.files as Express.Multer.File[]) || [];
    return files.map<Attachment>((f) => ({ id: path.parse(f.filename).name, name: f.originalname, size: f.size, mimeType: f.mimetype, url: `/uploads/${f.filename}`, uploadedAt: now() }));
  }));
  registerDocumentRoutes(api, h, m, upload.array('files', 10));

  // ------------------------------------------------------------ projects & time (server/projects.ts)
  registerProjectRoutes(api, h, m);

  // ------------------------------------------------------------ dashboard, search & reports
  api.get('/dashboard', h((req) => R.dashboard({ cashPeriod: q(req, 'cashPeriod') as PeriodKey, incomePeriod: q(req, 'incomePeriod') as PeriodKey, expensePeriod: q(req, 'expensePeriod') as PeriodKey, basis: q(req, 'basis') as 'cash' })));
  api.get('/recent-activity', h(() => getDb().activities.slice(-30).reverse()));
  api.get('/search', h((req) => {
    const db = getDb();
    const needle = q(req, 'q');
    if (!needle) return [];
    const docs = db.docs
      .filter((d) => [d.number, d.referenceNumber, S.contactName(db, d.contactId), d.profileName].some((t) => matches(t, needle)))
      .slice(0, 15)
      .map((d) => ({ type: DOC_META[d.kind].label, title: `${d.number}`, subtitle: S.contactName(db, d.contactId), path: `${DOC_META[d.kind].path}/${d.id}` }));
    const contacts = db.contacts.filter((c) => matches(c.displayName, needle) || matches(c.email, needle)).slice(0, 8).map((c) => ({ type: c.kind === 'customer' ? 'Client' : 'Supplier', title: c.displayName, subtitle: c.email, path: `/${c.kind === 'customer' ? 'sales/customers' : 'purchases/vendors'}/${c.id}` }));
    const items = db.items.filter((i) => matches(i.name, needle)).slice(0, 8).map((i) => ({ type: 'Item', title: i.name, subtitle: i.type, path: `/items/${i.id}` }));
    const projects = db.projects.filter((x) => matches(x.name, needle) || matches(x.code, needle)).slice(0, 8).map((x) => ({ type: 'Project', title: x.name, subtitle: S.contactName(db, x.customerId), path: `/time-tracking/projects/${x.id}` }));
    return [...contacts, ...items, ...projects, ...docs];
  }));
  // Report Library: catalogue, generic report data and saved custom reports
  api.get('/report-catalog', h(() => ({ categories: CATALOG_CATEGORIES, reports: reportCatalog(), saved: getDb().savedReports })));
  api.get('/report-data/:key', h((req) => {
    try {
      return runReport(getDb(), p(req, 'key'), Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, typeof v === 'string' && v ? v : undefined])));
    } catch (e) {
      if ((e as { status?: number }).status === 404) throw new S.HttpError(404, 'Unknown report');
      throw e;
    }
  }));
  api.post('/saved-reports', m((req) => {
    const b = req.body || {};
    const nm = String(b.name || '').trim();
    if (!nm) throw new S.HttpError(400, 'Report Name is required');
    if (!reportCatalog().some((r) => r.key === b.report)) throw new S.HttpError(400, 'Unknown report');
    const db = getDb();
    if (db.savedReports.some((x) => x.name.toLowerCase() === nm.toLowerCase())) throw new S.HttpError(400, 'A custom report with this name already exists');
    const params = Object.fromEntries(Object.entries((b.params || {}) as Record<string, unknown>).filter(([, v]) => typeof v === 'string' && v).map(([k, v]) => [k, String(v)]));
    const r = { id: newId('srep'), name: nm.slice(0, 120), report: String(b.report), params, hiddenColumns: Array.isArray(b.hiddenColumns) ? b.hiddenColumns.map(String) : [], createdAt: now() };
    db.savedReports.push(r);
    return r;
  }));
  api.delete('/saved-reports/:id', m((req) => {
    getDb().savedReports = getDb().savedReports.filter((x) => x.id !== p(req, 'id'));
  }));
  api.get('/reports/:name', h((req) => {
    const fy = getDb().organization.fiscalYearStartMonth;
    const r = periodRange((q(req, 'period') as PeriodKey) || 'this_fiscal_year', today(), fy);
    const from = q(req, 'from') || r.from;
    const to = q(req, 'to') || r.to;
    switch (p(req, 'name')) {
      case 'profit-and-loss':
        return R.profitAndLoss(from, to, q(req, 'basis') === 'cash' ? 'cash' : 'accrual');
      case 'balance-sheet':
        return R.balanceSheet(to, q(req, 'basis') === 'cash' ? 'cash' : 'accrual');
      case 'trial-balance':
        return R.trialBalance(to, q(req, 'basis') === 'cash' ? 'cash' : 'accrual');
      case 'general-ledger':
        return R.generalLedger(from, to, q(req, 'accountId'));
      case 'journal':
        return R.journalReport(from, to);
      case 'ar-aging':
        return R.agingReport('receivables');
      case 'ap-aging':
        return R.agingReport('payables');
      case 'sales-by-customer':
        return R.salesByCustomer(from, to);
      case 'sales-by-item':
        return R.salesByItem(from, to);
      case 'expenses-by-category':
        return R.expensesByCategory(from, to);
      case 'customer-balances':
        return R.contactBalances('customer');
      case 'vendor-balances':
        return R.contactBalances('vendor');
      default:
        throw new S.HttpError(404, 'Unknown report');
    }
  }));

  app.use('/api/portal', portalRouter());
  app.use('/api', api);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((err: Error & { status?: number; code?: string }, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof S.HttpError ? err.status : err.code === 'LIMIT_FILE_SIZE' ? 400 : err.status || 500;
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Each file must be 10MB or smaller' : err.message;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: message });
  });
  return app;
}

/** Allow only the formatting tags the comment editor produces, with no attributes at all. */
export function sanitize(html: string) {
  const allowed = new Set(['b', 'i', 'u', 'strong', 'em', 'br', 'p', 'div', 'ul', 'ol', 'li']);
  return html
    .replace(/<(script|style|iframe|object|embed|template|noscript|textarea|title|xmp)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\s*(\/?)\s*([a-z][a-z0-9]*)\b[^>]*>/gi, (_m, close: string, tag: string) => (allowed.has(tag.toLowerCase()) ? `<${close}${tag.toLowerCase()}>` : ''))
    // any "<" left that is not one of the bare tags above is text
    .replace(/<(?!\/?(?:b|i|u|strong|em|br|p|div|ul|ol|li)>)/g, '&lt;');
}

export function boot() {
  normalizeTimeTracking(getDb());
  runRecurring(getDb());
  recompute(getDb());
  S.commit();
}
