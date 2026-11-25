// Client portal and shared document links.
//   staffPortalRoutes:  Settings > Client Portal, inviting contacts, payment notices
//   portalRouter:       /api/portal/* used by the customer portal (session cookie auth)
//   publicShareRoutes:  /api/public/share/:token used by shared links (token auth)
import { scrypt as scryptCb, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import { DOC_META } from '../shared/docmeta';
import { fmtDate, money, round2, today } from '../shared/format';
import { resolveTemplate } from '../shared/pdfTemplate';
import { DEFAULT_PORTAL_SETTINGS, PORTAL_KINDS, portalSettings, upiLink, visibleToCustomer, type PaymentNotice, type PortalSettings, type PortalUser } from '../shared/portal';
import { PAYMENT_MODES, type Contact, type Database, type ShareLink, type TxnDoc } from '../shared/types';
import { getDb, newId, now, flushDb } from './db';
import { createShareLink, isEmail, notifyOrganization, personName, publicOrigin, sendSystemEmail, shareUrl } from './email';
import { logActivity } from './engine';
import { renderDocPdf, renderPaymentPdf, renderStatementPdf } from './pdf';
import * as R from './reports';
import * as S from './services';
import { hashToken, randomToken } from './secrets';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const SESSION_COOKIE = 'cb_portal';
const SESSION_DAYS = 14;
const INVITE_DAYS = 7;
const RESET_HOURS = 2;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

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
const bad = (msg: string) => new S.HttpError(400, msg);
const p = (req: Request, k: string) => String(req.params[k]);
const q = (req: Request, k: string) => (typeof req.query[k] === 'string' ? (req.query[k] as string) : undefined);
const str = (v: unknown) => (v == null ? undefined : String(v).trim() || undefined);
const addHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

const settings = () => portalSettings(getDb().preferences);

// ================================================================== passwords & tokens

export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored?: string) {
  if (!stored) return false;
  const [algo, salt, key] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await scrypt(pw, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}

function checkPassword(pw: unknown) {
  const s = String(pw || '');
  if (s.length < 8) throw bad('Use at least 8 characters for the password');
  if (s.length > 200) throw bad('The password is too long');
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) throw bad('Use letters and at least one number in the password');
  return s;
}

/** Small in-memory limiter for sign-in and reset requests (per IP and per email). */
const hits = new Map<string, number[]>();
function limit(key: string, max: number, windowMs: number) {
  const t = Date.now();
  const list = (hits.get(key) || []).filter((x) => t - x < windowMs);
  if (list.length >= max) throw new S.HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
  list.push(t);
  hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(k);
}
export const resetRateLimits = () => hits.clear();

const publicUser = (u: PortalUser) => ({ id: u.id, contactId: u.contactId, contactPersonId: u.contactPersonId, email: u.email, name: u.name, status: u.status, invitedAt: u.invitedAt, inviteExpiresAt: u.inviteExpiresAt, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt });

// ================================================================== invitations

function candidatesFor(c: Contact) {
  const out: { email: string; name: string; contactPersonId?: string }[] = [];
  // portal accounts are named without the salutation ("Arun Kumar", not "Mr. Arun Kumar")
  if (c.email) out.push({ email: c.email.toLowerCase(), name: [c.firstName, c.lastName].filter(Boolean).join(' ') || personName(c) });
  for (const cp of c.contactPersons) if (cp.email && !out.some((x) => x.email === cp.email!.toLowerCase())) out.push({ email: cp.email.toLowerCase(), name: [cp.firstName, cp.lastName].filter(Boolean).join(' ') || cp.email, contactPersonId: cp.id });
  return out;
}

async function sendInvite(u: PortalUser, c: Contact, origin: string) {
  const token = randomToken();
  u.inviteTokenHash = hashToken(token);
  u.inviteExpiresAt = addHours(INVITE_DAYS * 24);
  u.invitedAt = now();
  u.updatedAt = now();
  const url = `${origin}/portal/invite/${token}`;
  const mail = await sendSystemEmail({ kind: 'portal_invite', to: u.email, contact: c, recipientName: u.name, values: { InviteLink: url, PortalLink: `${origin}/portal`, LinkExpiry: fmtDate(u.inviteExpiresAt.slice(0, 10)) }, button: { label: 'Accept Invitation', url } });
  logActivity(getDb(), 'contact', c.id, c.id, 'Portal invitation sent', `Invited ${u.email}${mail.status === 'outbox' ? ' (kept in the outbox: email sending is not set up)' : mail.status === 'failed' ? ` (email failed: ${mail.error})` : ''}`);
  return { mail, url };
}

export async function inviteContact(contactId: string, emails: string[], origin: string) {
  const db = getDb();
  const c = S.getContact(contactId);
  if (c.kind !== 'customer') throw bad('The portal is for clients');
  if (c.status === 'inactive') throw bad('Mark this client as active before inviting them');
  const cands = candidatesFor(c);
  const wanted = emails.map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!wanted.length) throw bad('Choose at least one contact to invite');
  const results = [];
  for (const email of wanted) {
    const cand = cands.find((x) => x.email === email);
    if (!cand) throw bad(`${email} is not an email of this client. Add it as a contact person first.`);
    const other = db.portalUsers.find((u) => u.email === email && u.contactId !== c.id && u.status !== 'disabled');
    if (other) throw bad(`${email} already has portal access for ${S.contactName(db, other.contactId)}`);
    let u = db.portalUsers.find((x) => x.email === email && x.contactId === c.id);
    if (u?.status === 'active') {
      results.push({ user: publicUser(u), alreadyActive: true });
      continue;
    }
    if (!u) {
      u = { id: newId('pu'), contactId: c.id, contactPersonId: cand.contactPersonId, email, name: cand.name, status: 'invited', createdAt: now(), updatedAt: now() };
      db.portalUsers.push(u);
    }
    u.status = 'invited';
    const { mail, url } = await sendInvite(u, c, origin);
    results.push({ user: publicUser(u), mailStatus: mail.status, mailError: mail.error, inviteUrl: mail.status === 'sent' ? undefined : url });
  }
  c.portalEnabled = true;
  return results;
}

// ================================================================== staff routes

export function staffPortalRoutes(api: Router, commit: () => void) {
  const origin = (req: Request) => publicOrigin(req.get('origin') || undefined);

  api.get('/portal-settings', h(() => ({ ...settings(), defaults: DEFAULT_PORTAL_SETTINGS })));
  api.put('/portal-settings', h((req) => {
    const db = getDb();
    const b = req.body as Partial<PortalSettings>;
    const cur = settings();
    const next: PortalSettings = { ...cur };
    for (const k of ['enabled', 'allowQuoteAcceptance', 'allowStatements', 'allowPaymentNotices', 'allowActionsOnSharedLinks', 'notifyOrganization'] as const) if (k in b) next[k] = Boolean(b[k]);
    for (const k of ['name', 'bannerMessage', 'upiId', 'upiPayeeName', 'bankInstructions', 'publicUrl'] as const) if (k in b) next[k] = String(b[k] ?? '').slice(0, 2000);
    if ('emailLinkDays' in b) next.emailLinkDays = Math.max(1, Math.min(365, Math.round(Number(b.emailLinkDays) || 90)));
    if (!next.name.trim()) next.name = DEFAULT_PORTAL_SETTINGS.name;
    if (next.publicUrl) {
      try {
        const u = new URL(next.publicUrl);
        if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
        next.publicUrl = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
      } catch {
        throw bad('Portal URL must be a full web address such as https://books.example.com');
      }
    }
    if (next.upiId && !/^[\w.-]{2,256}@[a-zA-Z]{2,64}$/.test(next.upiId)) throw bad('Enter a UPI ID such as creatign@hdfcbank');
    db.preferences.portal = next;
    commit();
    return next;
  }));

  api.get('/portal-users', h(() => {
    const db = getDb();
    return db.portalUsers.map((u) => ({ ...publicUser(u), contactName: S.contactName(db, u.contactId) })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }));

  api.get('/contacts/:id/portal', h((req) => {
    const db = getDb();
    const c = S.getContact(p(req, 'id'));
    const users = db.portalUsers.filter((u) => u.contactId === c.id);
    return {
      enabled: c.portalEnabled,
      portalEnabled: settings().enabled,
      portalUrl: `${origin(req)}/portal`,
      users: users.map(publicUser),
      candidates: candidatesFor(c).map((x) => ({ ...x, user: users.find((u) => u.email === x.email) ? publicUser(users.find((u) => u.email === x.email)!) : undefined })),
    };
  }));

  api.post('/contacts/:id/portal/invite', h(async (req) => {
    const out = await inviteContact(p(req, 'id'), Array.isArray(req.body.emails) ? req.body.emails : [req.body.email].filter(Boolean), origin(req));
    commit();
    return out;
  }));

  api.post('/contacts/:id/portal/disable', h((req) => {
    const db = getDb();
    const c = S.getContact(p(req, 'id'));
    c.portalEnabled = false;
    const ids = new Set(db.portalUsers.filter((u) => u.contactId === c.id).map((u) => u.id));
    db.portalSessions = db.portalSessions.filter((s) => !ids.has(s.userId));
    logActivity(db, 'contact', c.id, c.id, 'Portal access disabled');
    commit();
  }));
  api.post('/contacts/:id/portal/enable', h((req) => {
    const c = S.getContact(p(req, 'id'));
    c.portalEnabled = true;
    logActivity(getDb(), 'contact', c.id, c.id, 'Portal access enabled');
    commit();
  }));

  const user = (id: string) => {
    const u = getDb().portalUsers.find((x) => x.id === id);
    if (!u) throw new S.HttpError(404, 'Portal user not found');
    return u;
  };
  api.post('/portal-users/:id/resend', h(async (req) => {
    const u = user(p(req, 'id'));
    if (u.status === 'active') throw bad(`${u.email} has already accepted the invitation`);
    u.status = 'invited';
    const { mail, url } = await sendInvite(u, S.getContact(u.contactId), origin(req));
    commit();
    return { user: publicUser(u), mailStatus: mail.status, mailError: mail.error, inviteUrl: mail.status === 'sent' ? undefined : url };
  }));
  api.post('/portal-users/:id/status', h((req) => {
    const db = getDb();
    const u = user(p(req, 'id'));
    const status = req.body.status === 'disabled' ? 'disabled' : u.passwordHash ? 'active' : 'invited';
    u.status = status;
    u.updatedAt = now();
    if (status === 'disabled') db.portalSessions = db.portalSessions.filter((s) => s.userId !== u.id);
    logActivity(db, 'contact', u.contactId, u.contactId, status === 'disabled' ? 'Portal user disabled' : 'Portal user enabled', u.email);
    commit();
    return publicUser(u);
  }));
  api.delete('/portal-users/:id', h((req) => {
    const db = getDb();
    const u = user(p(req, 'id'));
    db.portalUsers = db.portalUsers.filter((x) => x.id !== u.id);
    db.portalSessions = db.portalSessions.filter((s) => s.userId !== u.id);
    logActivity(db, 'contact', u.contactId, u.contactId, 'Portal user removed', u.email);
    commit();
  }));

  // ---- payment notices reported by customers
  api.get('/payment-notices', h((req) => {
    const db = getDb();
    const invoiceId = q(req, 'invoiceId');
    const status = q(req, 'status');
    return db.paymentNotices
      .filter((n) => (!invoiceId || n.invoiceId === invoiceId) && (!status || n.status === status))
      .map((n) => ({ ...n, contactName: S.contactName(db, n.contactId), invoiceNumber: db.docs.find((d) => d.id === n.invoiceId)?.number }))
      .reverse();
  }));
  const notice = (id: string) => {
    const n = getDb().paymentNotices.find((x) => x.id === id);
    if (!n) throw new S.HttpError(404, 'Payment notice not found');
    if (n.status !== 'pending') throw bad('This payment notice has already been handled');
    return n;
  };
  api.post('/payment-notices/:id/record', h((req) => {
    const db = getDb();
    const n = notice(p(req, 'id'));
    const inv = S.getDoc(n.invoiceId, 'invoice');
    const amount = round2(Number(req.body.amount ?? n.amount));
    const applied = round2(Math.min(amount, inv.balance));
    const pmt = S.savePaymentReceived({
      contactId: n.contactId,
      amount,
      date: str(req.body.date) || n.date,
      mode: str(req.body.mode) || n.mode,
      referenceNumber: n.reference,
      depositToAccountId: str(req.body.depositToAccountId),
      allocations: applied > 0 ? [{ docId: inv.id, amount: applied }] : [],
      notes: [`Reported by ${n.submittedBy} via the ${n.via === 'portal' ? 'customer portal' : 'shared link'}`, n.note].filter(Boolean).join('. '),
    });
    n.status = 'recorded';
    n.paymentId = pmt.id;
    n.resolvedAt = now();
    logActivity(db, 'invoice', inv.id, inv.contactId, 'Client-reported payment recorded', `Payment #${pmt.number} for ${money(amount)}`);
    commit();
    return { notice: n, payment: pmt };
  }));
  api.post('/payment-notices/:id/dismiss', h((req) => {
    const db = getDb();
    const n = notice(p(req, 'id'));
    n.status = 'dismissed';
    n.resolvedAt = now();
    logActivity(db, 'invoice', n.invoiceId, n.contactId, 'Client-reported payment dismissed', str(req.body.reason));
    commit();
    return n;
  }));
}

// ================================================================== what customers can see

const INTERNAL_DOC_FIELDS: (keyof TxnDoc)[] = ['notes', 'rejection', 'approvedBy', 'approvedAt', 'emailRecipients', 'accountId', 'locked', 'manuallyAdded', 'attachments', 'recurringProfileId', 'writeOff', 'remindersStopped', 'expectedPaymentDate', 'createAsDraft'];

export function customerDoc(d: TxnDoc) {
  const out: Partial<TxnDoc> = { ...d };
  for (const k of INTERNAL_DOC_FIELDS) delete out[k];
  out.attachments = [];
  out.emailRecipients = [];
  return out as TxnDoc;
}

export function customerContact(c?: Contact) {
  if (!c) return undefined;
  const { id, kind, customerType, salutation, firstName, lastName, companyName, displayName, email, workPhone, mobile, gstin, pan, billingAddress, shippingAddress, currencyCode, customFields } = c;
  return { id, kind, customerType, salutation, firstName, lastName, companyName, displayName, email, workPhone, mobile, gstin, pan, billingAddress, shippingAddress, currencyCode, customFields, contactPersons: [], bankDetails: [], documents: [], reportingTags: {} } as unknown as Contact;
}

function publicOrg(db: Database) {
  return db.organization;
}

function paymentInfo(d: TxnDoc, s: PortalSettings) {
  if (d.kind !== 'invoice' || d.balance <= 0 || d.status === 'void') return undefined;
  return {
    balance: d.balance,
    upiId: s.upiId || undefined,
    upiPayeeName: s.upiPayeeName || getDb().organization.name,
    upiLink: upiLink({ upiId: s.upiId, upiPayeeName: s.upiPayeeName || getDb().organization.name }, d.balance, `${d.number}`),
    bankInstructions: s.bankInstructions || undefined,
  };
}

function docPayload(d: TxnDoc, mode: 'portal' | 'link') {
  const db = getDb();
  const s = settings();
  const actions = mode === 'portal' || s.allowActionsOnSharedLinks;
  const notices = db.paymentNotices.filter((n) => n.invoiceId === d.id && n.status === 'pending').map((n) => ({ id: n.id, amount: n.amount, date: n.date, mode: n.mode, reference: n.reference, createdAt: n.createdAt }));
  const payments = d.kind === 'invoice' ? db.paymentsReceived.filter((x) => x.status === 'paid' && x.allocations.some((a) => a.docId === d.id)).map((x) => ({ id: x.id, number: x.number, date: x.date, mode: x.mode, amount: x.allocations.find((a) => a.docId === d.id)!.amount })) : [];
  return {
    doc: { ...customerDoc(d), contactName: S.contactName(db, d.contactId), contact: customerContact(db.contacts.find((c) => c.id === d.contactId)) },
    organization: publicOrg(db),
    template: resolveTemplate(db.pdfTemplates, db.preferences, d.kind, d.templateId),
    preferences: { customFields: db.preferences.customFields },
    canRespond: actions && s.allowQuoteAcceptance && d.kind === 'quote' && d.status === 'sent' && (!d.expiryDate || d.expiryDate >= today()),
    canNotifyPayment: actions && s.allowPaymentNotices && d.kind === 'invoice' && d.balance > 0 && d.status !== 'void',
    payment: paymentInfo(d, s),
    paymentModes: PAYMENT_MODES.filter((m) => m !== 'Cash'),
    pendingNotices: notices,
    payments,
    portalName: s.name,
  };
}

function markViewed(d: TxnDoc, who: string, via: 'portal' | 'link') {
  const db = getDb();
  if (!d.viewedAt) {
    d.viewedAt = now();
    logActivity(db, d.kind, d.id, d.contactId, `${DOC_META[d.kind].label} viewed by the client`, `Opened by ${who} via the ${via === 'portal' ? 'customer portal' : 'shared link'}`, who);
  }
}

async function respondToQuote(d: TxnDoc, body: Record<string, unknown>, who: { name: string; email?: string }, via: 'portal' | 'link', origin: string) {
  const db = getDb();
  if (d.kind !== 'quote') throw bad('Only estimates can be accepted or declined');
  if (d.status !== 'sent') throw bad(d.customerResponse ? `This estimate was already ${d.customerResponse.action}` : 'This estimate can no longer be accepted or declined');
  if (d.expiryDate && d.expiryDate < today()) throw bad('This estimate has expired. Contact us for an updated estimate.');
  const action = body.action === 'accept' ? 'accepted' : body.action === 'decline' ? 'declined' : undefined;
  if (!action) throw bad('Choose accept or decline');
  const name = str(body.name) || who.name;
  if (!name) throw bad('Enter your name');
  const comment = str(body.comment)?.slice(0, 2000);
  if (action === 'declined' && !comment) throw bad('Let us know why you are declining the estimate');
  d.status = action;
  d.customerResponse = { action, by: name.slice(0, 120), email: who.email, comment, at: now(), via };
  d.updatedAt = now();
  logActivity(db, 'quote', d.id, d.contactId, `Estimate ${action} by the client`, [`${name} ${action} estimate ${d.number} via the ${via === 'portal' ? 'customer portal' : 'shared link'}`, comment ? `Comment: ${comment}` : ''].filter(Boolean).join('. '), name);
  S.commit();
  void notifyOrganization(`Estimate ${d.number} ${action} by ${S.contactName(db, d.contactId)}`, `${name}${who.email ? ` (${who.email})` : ''} ${action} estimate ${d.number} for ${money(d.total)}.${comment ? `\n\nComment: ${comment}` : ''}`, { label: 'Open Estimate', url: `${origin}${DOC_META.quote.path}/${d.id}` }).then(() => S.commit());
  return d.customerResponse;
}

async function reportPayment(d: TxnDoc, body: Record<string, unknown>, who: { name: string; email?: string }, via: 'portal' | 'link', origin: string) {
  const db = getDb();
  if (d.kind !== 'invoice' || d.balance <= 0 || d.status === 'void') throw bad('This invoice has no balance due');
  const amount = round2(Number(body.amount));
  if (!(amount > 0)) throw bad('Enter the amount you paid');
  if (amount > d.balance + 0.004) throw bad(`The amount is more than the balance due (${money(d.balance)})`);
  const date = str(body.date) || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today()) throw bad('Enter the date you paid (not a future date)');
  const mode = PAYMENT_MODES.includes(String(body.mode)) ? String(body.mode) : 'Bank Transfer';
  const reference = str(body.reference)?.slice(0, 120);
  if (!reference) throw bad('Enter the transaction or UTR reference so we can match your payment');
  if (db.paymentNotices.filter((n) => n.invoiceId === d.id && n.status === 'pending').length >= 5) throw bad('We already have several payment notices for this invoice. We will review them shortly.');
  const n: PaymentNotice = { id: newId('pn'), contactId: d.contactId, invoiceId: d.id, amount, date, mode, reference, note: str(body.note)?.slice(0, 1000), submittedBy: (str(body.name) || who.name).slice(0, 120), submittedEmail: who.email, via, status: 'pending', createdAt: now() };
  db.paymentNotices.push(n);
  logActivity(db, 'invoice', d.id, d.contactId, 'Client reported a payment', `${n.submittedBy} reported ${money(amount)} paid on ${fmtDate(date)} via ${mode} (ref ${reference})`, n.submittedBy);
  S.commit();
  void notifyOrganization(`Payment reported for invoice ${d.number}`, `${n.submittedBy} from ${S.contactName(db, d.contactId)} reported a payment of ${money(amount)} on ${fmtDate(date)} via ${mode}.\nReference: ${reference}${n.note ? `\nNote: ${n.note}` : ''}\n\nReview it and record the payment from the invoice.`, { label: 'Review Payment', url: `${origin}${DOC_META.invoice.path}/${d.id}` }).then(() => S.commit());
  return n;
}

// ================================================================== shared links (public)

function liveLink(token: string) {
  const db = getDb();
  const link = db.shareLinks.find((s) => s.token === token);
  if (!link || !link.active || (link.expiresOn && link.expiresOn < today())) throw new S.HttpError(404, 'This link has expired or was disabled. Contact the sender for a new link.');
  const d = db.docs.find((x) => x.id === link.entityId);
  if (!d || !visibleToCustomer(d)) throw new S.HttpError(404, 'This document is no longer available');
  return { link, d };
}

export function publicShareRoutes(api: Router) {
  const origin = () => publicOrigin();
  api.get('/public/share/:token', h((req) => {
    const { link, d } = liveLink(p(req, 'token'));
    link.views = (link.views || 0) + 1;
    link.lastViewedAt = now();
    markViewed(d, S.contactName(getDb(), d.contactId), 'link');
    S.commit();
    return { ...docPayload(d, 'link'), expiresOn: link.expiresOn };
  }));
  api.get('/public/share/:token/pdf', h(async (req, res) => {
    const { d } = liveLink(p(req, 'token'));
    sendPdf(res, await renderDocPdf(d), `${DOC_META[d.kind].label.replace(/ /g, '-')}-${d.number}.pdf`, q(req, 'download') === '1');
  }));
  api.post('/public/share/:token/respond', h(async (req) => {
    limit(`share:${req.ip}`, 20, 15 * 60_000);
    if (!settings().allowActionsOnSharedLinks) throw new S.HttpError(403, 'Sign in to the client portal to respond');
    const { d } = liveLink(p(req, 'token'));
    return respondToQuote(d, req.body, { name: str(req.body.name) || '' }, 'link', origin());
  }));
  api.post('/public/share/:token/payment-notice', h(async (req) => {
    limit(`share:${req.ip}`, 20, 15 * 60_000);
    if (!settings().allowActionsOnSharedLinks || !settings().allowPaymentNotices) throw new S.HttpError(403, 'Sign in to the client portal to report a payment');
    const { d } = liveLink(p(req, 'token'));
    if (!str(req.body.name)) throw bad('Enter your name');
    const n = await reportPayment(d, req.body, { name: str(req.body.name)! }, 'link', origin());
    return { id: n.id, status: n.status };
  }));

  // staff: manage links for a document
  api.get('/share-links', h((req) => getDb().shareLinks.filter((s) => s.entityId === q(req, 'entityId')).slice().reverse()));
  api.post('/share-links', h((req) => {
    const db = getDb();
    const d = db.docs.find((x) => x.id === req.body.entityId);
    if (!d) throw new S.HttpError(404, 'Document not found');
    if (!visibleToCustomer(d)) throw bad(`Send or approve this ${DOC_META[d.kind].label.toLowerCase()} before sharing it`);
    const expiresOn = str(req.body.expiresOn);
    if (expiresOn && expiresOn < today()) throw bad('The expiry date has already passed');
    const link: ShareLink = createShareLink(d.kind, d.id, expiresOn, 'manual');
    logActivity(db, d.kind, d.id, d.contactId, 'Share link created', expiresOn ? `Expires on ${fmtDate(expiresOn)}` : 'Never expires');
    S.commit();
    return { ...link, url: shareUrl(publicOrigin(req.get('origin') || undefined), link.token) };
  }));
  api.post('/share-links/:id/disable', h((req) => {
    const link = getDb().shareLinks.find((s) => s.id === p(req, 'id'));
    if (!link) throw new S.HttpError(404, 'Link not found');
    link.active = false;
    S.commit();
    return link;
  }));
  api.post('/share-links/disable-all', h((req) => {
    for (const s of getDb().shareLinks) if (s.entityId === req.body.entityId) s.active = false;
    S.commit();
  }));
}

function sendPdf(res: Response, pdf: Buffer, filename: string, download: boolean) {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename.replace(/[^\w.-]+/g, '-')}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(pdf);
}

// ================================================================== portal API (customers)

interface PortalReq extends Request {
  portalUser?: PortalUser;
  portalContact?: Contact;
}

function cookies(req: Request) {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSession(req: Request, res: Response, u: PortalUser) {
  const db = getDb();
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  db.portalSessions = db.portalSessions.filter((s) => s.expiresAt > now());
  db.portalSessions.push({ id: newId('ps'), tokenHash: hashToken(token), userId: u.id, createdAt: now(), expiresAt: expires.toISOString(), lastSeenAt: now() });
  u.lastLoginAt = now();
  u.failedLogins = 0;
  u.lockedUntil = undefined;
  const secure = req.secure || req.get('x-forwarded-proto') === 'https';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${secure ? '; Secure' : ''}`);
}

function clearSession(res: Response) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
}

function canUsePortal(u: PortalUser | undefined) {
  const db = getDb();
  if (!u || u.status !== 'active') return undefined;
  const c = db.contacts.find((x) => x.id === u.contactId);
  if (!c || !c.portalEnabled || c.status === 'inactive' || !settings().enabled) return undefined;
  return c;
}

function sessionUser(req: Request) {
  const token = cookies(req)[SESSION_COOKIE];
  if (!token) return undefined;
  const db = getDb();
  const s = db.portalSessions.find((x) => x.tokenHash === hashToken(token));
  if (!s || s.expiresAt < now()) return undefined;
  const u = db.portalUsers.find((x) => x.id === s.userId);
  const c = canUsePortal(u);
  if (!c) return undefined;
  s.lastSeenAt = now();
  return { u: u!, c, s };
}

/** Requests that change something must come from our own pages (custom header => no cross-site form posts). */
function sameOrigin(req: Request, _res: Response, next: NextFunction) {
  if (req.method !== 'GET' && req.get('x-portal-request') !== '1') return next(new S.HttpError(403, 'Request blocked'));
  next();
}

function auth(req: PortalReq, _res: Response, next: NextFunction) {
  const found = sessionUser(req);
  if (!found) return next(new S.HttpError(401, 'Please sign in to the client portal'));
  req.portalUser = found.u;
  req.portalContact = found.c;
  next();
}

function ownDoc(req: PortalReq, id: string) {
  const d = getDb().docs.find((x) => x.id === id);
  if (!d || d.contactId !== req.portalContact!.id || !visibleToCustomer(d)) throw new S.HttpError(404, 'Document not found');
  return d;
}

function summary(c: Contact) {
  const db = getDb();
  const mine = db.docs.filter((d) => d.contactId === c.id && visibleToCustomer(d));
  const invoices = mine.filter((d) => d.kind === 'invoice' && d.status !== 'void');
  const unpaid = invoices.filter((d) => d.balance > 0);
  const overdue = unpaid.filter((d) => d.dueDate && d.dueDate < today());
  const s = S.contactSummary(c);
  return {
    outstanding: s.outstanding,
    unusedCredits: s.unusedCredits,
    overdue: round2(overdue.reduce((a, d) => a + d.balance, 0)),
    overdueCount: overdue.length,
    unpaidCount: unpaid.length,
    openQuotes: mine.filter((d) => d.kind === 'quote' && d.status === 'sent').length,
  };
}

const listRow = (d: TxnDoc) => ({ id: d.id, kind: d.kind, number: d.number, date: d.date, dueDate: d.dueDate, expiryDate: d.expiryDate, referenceNumber: d.referenceNumber, status: d.status, total: d.total, balance: d.balance, customerResponse: d.customerResponse });

export function portalRouter(): Router {
  const r = express.Router();
  r.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  r.use(sameOrigin);
  const origin = () => publicOrigin();

  r.get('/info', h(() => {
    const db = getDb();
    const s = settings();
    return { enabled: s.enabled, name: s.name, organization: { name: db.organization.name, logo: db.organization.logo, email: db.organization.email, phone: db.organization.phone, website: db.organization.website } };
  }));

  r.post('/login', h(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    limit(`login-ip:${req.ip}`, 30, 15 * 60_000);
    limit(`login:${email}`, 10, 15 * 60_000);
    if (!settings().enabled) throw new S.HttpError(403, 'The client portal is turned off');
    const db = getDb();
    const users = db.portalUsers.filter((u) => u.email === email);
    const u = users.find((x) => x.status === 'active') || users[0];
    const fail = new S.HttpError(401, 'The email or password is incorrect');
    if (!u || !u.passwordHash) {
      await hashPassword(password); // same timing whether or not the account exists
      throw u?.status === 'invited' ? new S.HttpError(401, 'Accept the invitation in your email to set a password first') : fail;
    }
    if (u.lockedUntil && u.lockedUntil > now()) throw new S.HttpError(429, 'Too many failed attempts. Try again in a few minutes or reset your password.');
    if (!(await verifyPassword(password, u.passwordHash))) {
      u.failedLogins = (u.failedLogins || 0) + 1;
      if (u.failedLogins >= MAX_FAILED) u.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString();
      S.commit();
      throw fail;
    }
    if (!canUsePortal(u)) throw new S.HttpError(403, 'Portal access for this account is turned off. Contact us for help.');
    setSession(req, res, u);
    S.commit();
    return { ok: true };
  }));

  r.post('/logout', h((req, res) => {
    const token = cookies(req)[SESSION_COOKIE];
    if (token) {
      const db = getDb();
      db.portalSessions = db.portalSessions.filter((s) => s.tokenHash !== hashToken(token));
      S.commit();
    }
    clearSession(res);
  }));

  // ---- invitations and password reset
  const byInvite = (token: string) => {
    const u = getDb().portalUsers.find((x) => x.inviteTokenHash === hashToken(token));
    if (!u || u.status === 'disabled' || !u.inviteExpiresAt || u.inviteExpiresAt < now()) throw new S.HttpError(404, 'This invitation has expired or was already used. Ask us to send a new one.');
    return u;
  };
  r.get('/invite/:token', h((req) => {
    const u = byInvite(p(req, 'token'));
    return { email: u.email, name: u.name, organization: getDb().organization.name, portalName: settings().name };
  }));
  r.post('/invite/:token', h(async (req, res) => {
    limit(`invite:${req.ip}`, 20, 15 * 60_000);
    const u = byInvite(p(req, 'token'));
    const password = checkPassword(req.body.password);
    u.name = (str(req.body.name) || u.name).slice(0, 120);
    u.passwordHash = await hashPassword(password);
    u.status = 'active';
    u.inviteTokenHash = undefined;
    u.inviteExpiresAt = undefined;
    u.updatedAt = now();
    logActivity(getDb(), 'contact', u.contactId, u.contactId, 'Portal invitation accepted', `${u.name} (${u.email}) joined the portal`, u.name);
    if (canUsePortal(u)) setSession(req, res, u);
    S.commit();
    return { ok: true };
  }));
  r.post('/forgot', h(async (req) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    limit(`forgot-ip:${req.ip}`, 10, 15 * 60_000);
    limit(`forgot:${email}`, 3, 15 * 60_000);
    const db = getDb();
    const u = db.portalUsers.find((x) => x.email === email && x.status === 'active');
    if (u && isEmail(email) && canUsePortal(u)) {
      const token = randomToken();
      u.resetTokenHash = hashToken(token);
      u.resetExpiresAt = addHours(RESET_HOURS);
      const url = `${origin()}/portal/reset/${token}`;
      await sendSystemEmail({ kind: 'portal_reset', to: u.email, contact: db.contacts.find((c) => c.id === u.contactId), recipientName: u.name, values: { ResetLink: url, PortalLink: `${origin()}/portal`, LinkExpiry: `${new Date(u.resetExpiresAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST` }, button: { label: 'Reset Password', url } });
      S.commit();
    }
    // same answer whether or not the account exists
    return { ok: true };
  }));
  const byReset = (token: string) => {
    const u = getDb().portalUsers.find((x) => x.resetTokenHash === hashToken(token));
    if (!u || u.status !== 'active' || !u.resetExpiresAt || u.resetExpiresAt < now()) throw new S.HttpError(404, 'This reset link has expired or was already used. Request a new one.');
    return u;
  };
  r.get('/reset/:token', h((req) => ({ email: byReset(p(req, 'token')).email })));
  r.post('/reset/:token', h(async (req, res) => {
    limit(`reset:${req.ip}`, 20, 15 * 60_000);
    const db = getDb();
    const u = byReset(p(req, 'token'));
    u.passwordHash = await hashPassword(checkPassword(req.body.password));
    u.resetTokenHash = undefined;
    u.resetExpiresAt = undefined;
    u.updatedAt = now();
    db.portalSessions = db.portalSessions.filter((s) => s.userId !== u.id); // sign out everywhere
    if (canUsePortal(u)) setSession(req, res, u);
    S.commit();
    return { ok: true };
  }));

  // ---- signed-in customer
  r.get('/me', auth, h((req: PortalReq) => {
    const db = getDb();
    const s = settings();
    const c = req.portalContact!;
    return {
      user: publicUser(req.portalUser!),
      contact: customerContact(c),
      organization: publicOrg(db),
      settings: { name: s.name, bannerMessage: s.bannerMessage, allowQuoteAcceptance: s.allowQuoteAcceptance, allowStatements: s.allowStatements, allowPaymentNotices: s.allowPaymentNotices },
      summary: summary(c),
    };
  }));
  r.put('/me', auth, h((req: PortalReq) => {
    const u = req.portalUser!;
    const name = str(req.body.name);
    if (!name) throw bad('Enter your name');
    u.name = name.slice(0, 120);
    u.updatedAt = now();
    S.commit();
    return publicUser(u);
  }));
  r.post('/me/password', auth, h(async (req: PortalReq) => {
    const u = req.portalUser!;
    if (!(await verifyPassword(String(req.body.current || ''), u.passwordHash))) throw bad('Your current password is incorrect');
    u.passwordHash = await hashPassword(checkPassword(req.body.next));
    u.updatedAt = now();
    const token = cookies(req)[SESSION_COOKIE];
    const db = getDb();
    db.portalSessions = db.portalSessions.filter((s) => s.userId !== u.id || s.tokenHash === hashToken(token || '')); // sign out other devices
    S.commit();
  }));

  r.get('/dashboard', auth, h((req: PortalReq) => {
    const db = getDb();
    const c = req.portalContact!;
    const mine = db.docs.filter((d) => d.contactId === c.id && visibleToCustomer(d));
    const unpaid = mine.filter((d) => d.kind === 'invoice' && d.balance > 0 && d.status !== 'void').sort((a, b) => (a.dueDate || a.date).localeCompare(b.dueDate || b.date));
    const quotes = mine.filter((d) => d.kind === 'quote' && d.status === 'sent').sort((a, b) => b.date.localeCompare(a.date));
    const payments = db.paymentsReceived.filter((x) => x.contactId === c.id && x.status === 'paid').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
    const recent = mine.slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 8);
    return { summary: summary(c), unpaid: unpaid.slice(0, 6).map(listRow), quotes: quotes.slice(0, 5).map(listRow), payments: payments.map((x) => ({ id: x.id, number: x.number, date: x.date, mode: x.mode, amount: x.amount })), recent: recent.map(listRow) };
  }));

  r.get('/docs', auth, h((req: PortalReq) => {
    const db = getDb();
    const kind = q(req, 'kind');
    if (kind && !PORTAL_KINDS.includes(kind as never)) throw bad('Unknown document type');
    const status = q(req, 'status');
    return db.docs
      .filter((d) => d.contactId === req.portalContact!.id && visibleToCustomer(d) && (!kind || d.kind === kind))
      .filter((d) => !status || (status === 'unpaid' ? d.balance > 0 && d.status !== 'void' : status === 'overdue' ? d.balance > 0 && !!d.dueDate && d.dueDate < today() : d.status === status))
      .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number))
      .map(listRow);
  }));
  r.get('/docs/:id', auth, h((req: PortalReq) => {
    const d = ownDoc(req, p(req, 'id'));
    markViewed(d, req.portalUser!.name, 'portal');
    S.commit();
    return docPayload(d, 'portal');
  }));
  r.get('/docs/:id/pdf', auth, h(async (req: PortalReq, res) => {
    const d = ownDoc(req, p(req, 'id'));
    sendPdf(res, await renderDocPdf(d), `${DOC_META[d.kind].label.replace(/ /g, '-')}-${d.number}.pdf`, q(req, 'download') === '1');
  }));
  r.post('/docs/:id/respond', auth, h(async (req: PortalReq) => {
    if (!settings().allowQuoteAcceptance) throw new S.HttpError(403, 'Contact us to accept or decline this estimate');
    const d = ownDoc(req, p(req, 'id'));
    return respondToQuote(d, req.body, { name: req.portalUser!.name, email: req.portalUser!.email }, 'portal', origin());
  }));
  r.post('/docs/:id/payment-notice', auth, h(async (req: PortalReq) => {
    if (!settings().allowPaymentNotices) throw new S.HttpError(403, 'Contact us about payments');
    const d = ownDoc(req, p(req, 'id'));
    const n = await reportPayment(d, req.body, { name: req.portalUser!.name, email: req.portalUser!.email }, 'portal', origin());
    return { id: n.id, status: n.status };
  }));

  r.get('/payments', auth, h((req: PortalReq) => {
    const db = getDb();
    return db.paymentsReceived
      .filter((x) => x.contactId === req.portalContact!.id && x.status === 'paid')
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((x) => ({ id: x.id, number: x.number, date: x.date, mode: x.mode, referenceNumber: x.referenceNumber, amount: x.amount, unusedAmount: x.unusedAmount, invoices: x.allocations.map((a) => ({ number: db.docs.find((d) => d.id === a.docId)?.number, amount: a.amount })) }));
  }));
  r.get('/payments/:id/pdf', auth, h(async (req: PortalReq, res) => {
    const pm = getDb().paymentsReceived.find((x) => x.id === p(req, 'id') && x.contactId === req.portalContact!.id && x.status === 'paid');
    if (!pm) throw new S.HttpError(404, 'Payment not found');
    sendPdf(res, await renderPaymentPdf(pm), `Payment-Receipt-${pm.number}.pdf`, q(req, 'download') === '1');
  }));
  r.get('/notices', auth, h((req: PortalReq) => {
    const db = getDb();
    return db.paymentNotices.filter((n) => n.contactId === req.portalContact!.id).reverse().map((n) => ({ id: n.id, invoiceNumber: db.docs.find((d) => d.id === n.invoiceId)?.number, invoiceId: n.invoiceId, amount: n.amount, date: n.date, mode: n.mode, reference: n.reference, status: n.status, createdAt: n.createdAt }));
  }));

  const statementRange = (req: Request) => {
    const from = q(req, 'from') || `${today().slice(0, 4)}-01-01`;
    const to = q(req, 'to') || today();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw bad('Choose a valid date range');
    return { from, to };
  };
  r.get('/statement', auth, h((req: PortalReq) => {
    if (!settings().allowStatements) throw new S.HttpError(403, 'Statements are not available in the portal');
    const { from, to } = statementRange(req);
    const s = R.statement(req.portalContact!, from, to, q(req, 'filter') === 'outstanding' ? 'outstanding' : 'all');
    return { ...s, rows: s.rows.map(({ docId: _docId, ...row }) => row) };
  }));
  r.get('/statement/pdf', auth, h(async (req: PortalReq, res) => {
    if (!settings().allowStatements) throw new S.HttpError(403, 'Statements are not available in the portal');
    const { from, to } = statementRange(req);
    const s = R.statement(req.portalContact!, from, to, 'all');
    sendPdf(res, await renderStatementPdf(s), `Statement-${from}-to-${to}.pdf`, q(req, 'download') === '1');
  }));
  return r;
}
