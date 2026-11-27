// Client email: compose defaults from templates, fill placeholders, render the branded
// HTML email, attach PDFs and files, deliver through mailer.ts and keep the email log.
import fs from 'node:fs';
import path from 'node:path';
import { DOC_META } from '../shared/docmeta';
import { builtInEmailTemplates, fillPlaceholders, templateKindForDoc, templateKindMeta, type EmailTemplate, type EmailTemplateKind } from '../shared/email';
import { daysBetween, fmtDate, money, today } from '../shared/format';
import { resolveTemplate } from '../shared/pdfTemplate';
import { portalSettings } from '../shared/portal';
import type { Attachment, Contact, Database, Mail, PaymentMade, PaymentReceived, ShareLink, TxnDoc } from '../shared/types';
import { UPLOAD_DIR, getDb, newId, now } from './db';
import { addDays, logActivity } from './engine';
import { deliver, mailSettings } from './mailer';
import { renderDocPdf, renderPaymentPdf, renderStatementPdf } from './pdf';
import * as R from './reports';
import { HttpError } from './services';
import { randomToken } from './secrets';

const EMAIL_RE = /^[^@\s<>(),;:"]+@[^@\s<>(),;:"]+\.[^@\s<>(),;:"]+$/;
export const isEmail = (s: string) => EMAIL_RE.test(s);
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

// ------------------------------------------------------------ public URL

/** Base URL for links in emails: Settings > Client Portal > Portal URL, APP_ORIGIN, or the staff browser's origin. */
export function publicOrigin(requestOrigin?: string) {
  const configured = portalSettings(getDb().preferences).publicUrl?.trim();
  const candidates = [configured, process.env.APP_ORIGIN?.trim(), requestOrigin, 'http://localhost:5173'];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const u = new URL(c);
      if (u.protocol === 'http:' || u.protocol === 'https:') return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
    } catch {
      /* try the next one */
    }
  }
  return 'http://localhost:5173';
}

// ------------------------------------------------------------ templates

export function emailTemplates(db: Database = getDb()): EmailTemplate[] {
  if (!db.emailTemplates?.length) db.emailTemplates = builtInEmailTemplates();
  // add built-ins introduced after this database was created
  for (const t of builtInEmailTemplates()) if (!db.emailTemplates.some((x) => x.kind === t.kind)) db.emailTemplates.push(t);
  return db.emailTemplates;
}

export function templateFor(kind: EmailTemplateKind, id?: string) {
  const all = emailTemplates();
  return (id && all.find((t) => t.id === id && t.kind === kind)) || all.find((t) => t.kind === kind && t.isDefault) || all.find((t) => t.kind === kind)!;
}

// ------------------------------------------------------------ what an email is about

export interface EmailSubjectRef {
  entityType?: string;
  entityId?: string;
  contactId?: string;
  statement?: { from: string; to: string; filter?: 'all' | 'outstanding' };
}

interface Resolved {
  doc?: TxnDoc;
  payment?: PaymentReceived;
  paymentMade?: PaymentMade;
  contact?: Contact;
  statement?: ReturnType<typeof R.statement>;
}

function resolve(ref: EmailSubjectRef): Resolved {
  const db = getDb();
  const out: Resolved = {};
  if (ref.entityId) {
    out.doc = db.docs.find((d) => d.id === ref.entityId);
    if (!out.doc && ref.entityType === 'payment_received') out.payment = db.paymentsReceived.find((p) => p.id === ref.entityId);
    if (!out.doc && ref.entityType === 'payment_made') out.paymentMade = db.paymentsMade.find((p) => p.id === ref.entityId);
  }
  const contactId = out.doc?.contactId || out.payment?.contactId || out.paymentMade?.contactId || ref.contactId;
  out.contact = db.contacts.find((c) => c.id === contactId);
  if (ref.statement && out.contact) out.statement = R.statement(out.contact, ref.statement.from, ref.statement.to, ref.statement.filter || 'all');
  return out;
}

function kindFor(r: Resolved, ref: EmailSubjectRef): EmailTemplateKind | undefined {
  if (r.doc) return templateKindForDoc(r.doc.kind, r.doc.kind === 'invoice' && r.doc.balance > 0 && !!r.doc.dueDate && r.doc.dueDate < today() && r.doc.status !== 'draft');
  if (r.payment) return 'payment_received';
  if (r.paymentMade) return 'payment_made';
  if (ref.statement) return 'statement';
  return undefined;
}

export const personName = (c?: Pick<Contact, 'salutation' | 'firstName' | 'lastName' | 'displayName'>) => (c ? [c.salutation, c.firstName, c.lastName].filter(Boolean).join(' ') || c.displayName : '');

export function placeholderValues(r: Resolved, extra: Record<string, string | undefined> = {}) {
  const db = getDb();
  const org = db.organization;
  const settings = mailSettings();
  const portal = portalSettings(db.preferences);
  const v: Record<string, string | undefined> = {
    CustomerName: r.contact?.displayName,
    ContactPersonName: personName(r.contact),
    ContactEmail: r.contact?.email,
    CompanyName: org.name,
    CompanyEmail: org.email,
    CompanyPhone: org.phone,
    CompanyWebsite: org.website,
    SenderName: settings.fromName || org.name,
    PortalName: `${org.name} ${portal.name}`,
  };
  const d = r.doc;
  if (d) {
    const meta = DOC_META[d.kind];
    Object.assign(v, {
      DocumentType: meta.label,
      DocumentNumber: d.number,
      DocumentDate: fmtDate(d.date),
      DueDate: d.dueDate ? fmtDate(d.dueDate) : fmtDate(d.date),
      ExpiryDate: d.expiryDate ? fmtDate(d.expiryDate) : '-',
      ReferenceNumber: d.referenceNumber || '-',
      Total: money(d.total),
      BalanceDue: money(d.balance),
      DaysOverdue: d.dueDate && d.dueDate < today() ? String(daysBetween(d.dueDate, today())) : '0',
    });
  }
  const p = r.payment || r.paymentMade;
  if (p) {
    const docs = p.allocations.map((a) => db.docs.find((x) => x.id === a.docId)?.number).filter(Boolean);
    Object.assign(v, {
      PaymentNumber: p.number,
      PaymentAmount: money(p.amount),
      PaymentDate: fmtDate(p.date),
      PaymentMode: p.mode,
      PaymentReference: p.referenceNumber || '-',
      InvoiceNumbers: docs.length ? docs.join(', ') : 'Advance payment',
    });
  }
  if (r.statement) Object.assign(v, { StatementFrom: fmtDate(r.statement.from), StatementTo: fmtDate(r.statement.to), ClosingBalance: money(r.statement.closing) });
  return { ...v, ...extra };
}

// ------------------------------------------------------------ attachments

function pdfName(r: Resolved) {
  if (r.doc) return `${DOC_META[r.doc.kind].label.replace(/ /g, '-')}-${r.doc.number}.pdf`;
  if (r.payment) return `Payment-Receipt-${r.payment.number}.pdf`;
  if (r.paymentMade) return `Payment-${r.paymentMade.number}.pdf`;
  if (r.statement && r.contact) return `Statement-${r.contact.displayName.replace(/[^\w]+/g, '-')}.pdf`;
  return undefined;
}

async function renderPdf(r: Resolved) {
  if (r.doc) return renderDocPdf(r.doc);
  if (r.payment) return renderPaymentPdf(r.payment);
  if (r.paymentMade) return renderPaymentPdf(r.paymentMade, true);
  if (r.statement) return renderStatementPdf(r.statement);
  return undefined;
}

/** Read an uploaded file from UPLOAD_DIR; only plain file names under /uploads/ are accepted. */
function readUpload(a: Pick<Attachment, 'url' | 'name'>) {
  const m = /^\/uploads\/([\w.-]+)$/.exec(a.url || '');
  if (!m) throw new HttpError(400, `${a.name} is not an uploaded file`);
  const file = path.join(UPLOAD_DIR, m[1]);
  if (!fs.existsSync(file)) throw new HttpError(400, `${a.name} could not be found. Upload it again.`);
  return { filename: a.name, content: fs.readFileSync(file) };
}

function docAttachments(r: Resolved): Attachment[] {
  return r.doc?.attachments || r.payment?.attachments || r.paymentMade?.attachments || [];
}

// ------------------------------------------------------------ HTML email

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function textToHtml(text: string, color: string) {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((para) => {
      const html = esc(para)
        .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, `<a href="$1" style="color:${color};text-decoration:underline">$1</a>`)
        .replace(/\n/g, '<br>');
      return `<p style="margin:0 0 14px 0">${html}</p>`;
    })
    .join('');
}

export interface EmailCard {
  title: string;
  number?: string;
  amountLabel?: string;
  amount?: string;
  rows: [string, string][];
  status?: { label: string; tone: 'red' | 'green' | 'amber' | 'slate' };
}

export interface EmailButton {
  label: string;
  url: string;
}

export function cardFor(r: Resolved): EmailCard | undefined {
  const d = r.doc;
  if (d) {
    const meta = DOC_META[d.kind];
    const rows: [string, string][] = [[`${meta.label} Date`, fmtDate(d.date)]];
    if (d.dueDate && d.kind === 'invoice') rows.push(['Due Date', fmtDate(d.dueDate)]);
    if (d.expiryDate && d.kind === 'quote') rows.push(['Valid Until', fmtDate(d.expiryDate)]);
    if (d.referenceNumber) rows.push(['Reference', d.referenceNumber]);
    const invoiceDue = d.kind === 'invoice' && d.balance > 0;
    const overdue = invoiceDue && !!d.dueDate && d.dueDate < today();
    if (invoiceDue && d.balance !== d.total) rows.push(['Invoice Total', money(d.total)]);
    return {
      title: meta.label,
      number: d.number,
      amountLabel: d.kind === 'invoice' ? (d.balance > 0 ? 'Balance Due' : 'Amount Paid') : d.kind === 'credit_note' ? 'Credit Amount' : 'Amount',
      amount: money(d.kind === 'invoice' && d.balance > 0 ? d.balance : d.total),
      rows,
      status: overdue ? { label: `Overdue by ${daysBetween(d.dueDate!, today())} days`, tone: 'red' } : d.kind === 'invoice' && d.balance <= 0 && d.status === 'paid' ? { label: 'Paid', tone: 'green' } : undefined,
    };
  }
  const p = r.payment || r.paymentMade;
  if (p) return { title: r.payment ? 'Payment Receipt' : 'Payment', number: `#${p.number}`, amountLabel: 'Amount', amount: money(p.amount), rows: [['Payment Date', fmtDate(p.date)], ['Payment Mode', p.mode], ...(p.referenceNumber ? [['Reference', p.referenceNumber] as [string, string]] : [])] };
  if (r.statement) return { title: 'Statement of Accounts', number: `${fmtDate(r.statement.from)} - ${fmtDate(r.statement.to)}`, amountLabel: 'Balance Due', amount: money(r.statement.closing), rows: [['Invoiced', money(r.statement.invoiced)], ['Paid', money(r.statement.paid)]] };
  return undefined;
}

function brandColor(db: Database) {
  try {
    return resolveTemplate(db.pdfTemplates, db.preferences, 'invoice').accentColor || '#2554e0';
  } catch {
    return '#2554e0';
  }
}

const TONES = { red: ['#fdecec', '#b42318'], green: ['#e7f6ee', '#067647'], amber: ['#fff4e0', '#b54708'], slate: ['#f1f3f6', '#475467'] } as const;

/**
 * Branded, email-client-safe HTML (tables + inline styles).
 * logoSrc is a cid: reference when sending (so Gmail shows it) and the data: URL for previews.
 */
export function renderEmailHtml(o: { bodyText: string; card?: EmailCard; button?: EmailButton; secondary?: { text: string; label: string; url: string }; logoSrc?: string; preheader?: string }) {
  const db = getDb();
  const org = db.organization;
  const accent = brandColor(db);
  const addr = [org.address?.street1, org.address?.street2, [org.address?.city, org.address?.pin].filter(Boolean).join(' '), org.address?.state || org.state, org.address?.country || org.country].filter(Boolean).join(', ');
  const logo = o.logoSrc
    ? `<img src="${o.logoSrc}" alt="${esc(org.name)}" height="40" style="display:block;height:40px;max-width:200px;border:0">`
    : `<div style="font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:700;color:#0f1b2d;letter-spacing:-0.2px">${esc(org.name)}</div>`;
  const c = o.card;
  const card = c
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4e7ec;border-radius:10px;border-collapse:separate;margin:4px 0 22px 0">
  <tr><td style="padding:18px 20px 14px 20px;border-bottom:1px solid #eef0f3">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-family:Arial,Helvetica,sans-serif;font-size:12px;text-transform:uppercase;letter-spacing:0.6px;color:#667085">${esc(c.title)}${c.number ? `<div style="font-size:15px;color:#0f1b2d;font-weight:600;text-transform:none;letter-spacing:0;margin-top:2px">${esc(c.number)}</div>` : ''}</td>
      ${c.amount ? `<td align="right" style="font-size:12px;color:#667085">${esc(c.amountLabel || 'Amount')}<div style="font-size:22px;font-weight:700;color:${accent};margin-top:2px;white-space:nowrap">${esc(c.amount)}</div></td>` : ''}
    </tr></table>
    ${c.status ? `<div style="margin-top:10px"><span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;background:${TONES[c.status.tone][0]};color:${TONES[c.status.tone][1]}">${esc(c.status.label)}</span></div>` : ''}
  </td></tr>
  <tr><td style="padding:12px 20px 16px 20px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${c.rows.map(([k, v]) => `<tr><td style="padding:4px 0;font-size:13px;color:#667085">${esc(k)}</td><td align="right" style="padding:4px 0;font-size:13px;color:#0f1b2d;font-weight:500">${esc(v)}</td></tr>`).join('')}
    </table>
  </td></tr>
</table>`
    : '';
  const button = o.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 24px 0"><tr><td style="border-radius:8px;background:${accent}"><a href="${esc(o.button.url)}" style="display:inline-block;padding:12px 26px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${esc(o.button.label)}</a></td></tr></table>`
    : '';
  const secondary = o.secondary ? `<p style="margin:0 0 14px 0;font-size:13px;color:#475467">${esc(o.secondary.text)} <a href="${esc(o.secondary.url)}" style="color:${accent}">${esc(o.secondary.label)}</a></p>` : '';
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(org.name)}</title></head>
<body style="margin:0;padding:0;background:#f3f5f8;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%">
${o.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.preheader)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f8"><tr><td align="center" style="padding:28px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;border:1px solid #e4e7ec;border-collapse:separate;overflow:hidden">
    <tr><td style="height:4px;background:${accent};font-size:0;line-height:0">&nbsp;</td></tr>
    <tr><td style="padding:24px 32px 8px 32px">${logo}</td></tr>
    <tr><td style="padding:16px 32px 8px 32px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1d2939">
      ${card}
      ${textToHtml(o.bodyText, accent)}
      ${button}
      ${secondary}
    </td></tr>
    <tr><td style="padding:18px 32px 24px 32px;border-top:1px solid #eef0f3;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#667085">
      <div style="font-weight:600;color:#344054">${esc(org.name)}</div>
      ${addr ? `<div>${esc(addr)}</div>` : ''}
      <div>${[org.email, org.phone, org.website].filter(Boolean).map((x) => esc(x!)).join(' &middot; ')}</div>
      ${org.gstin ? `<div>GSTIN ${esc(org.gstin)}</div>` : ''}
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

function logoAttachment(db: Database) {
  const m = /^data:(image\/(png|jpe?g|gif));base64,(.+)$/.exec(db.organization.logo || '');
  if (!m) return undefined;
  return { filename: `logo.${m[2] === 'jpeg' ? 'jpg' : m[2]}`, content: Buffer.from(m[3], 'base64'), cid: 'org-logo@creatign', contentType: m[1] };
}

// ------------------------------------------------------------ share links

const LINK_KINDS = new Set(['quote', 'sales_order', 'invoice', 'retainer_invoice', 'credit_note']);

export function createShareLink(entityType: ShareLink['entityType'], entityId: string, expiresOn?: string, source: ShareLink['source'] = 'manual') {
  const db = getDb();
  const link: ShareLink = { id: newId('shr'), token: randomToken(), entityType, entityId, expiresOn, active: true, source, views: 0, createdAt: now() };
  db.shareLinks.push(link);
  return link;
}

/** Reuse a live link made for an earlier email, or make one. */
function emailLink(d: TxnDoc) {
  const db = getDb();
  const days = portalSettings(db.preferences).emailLinkDays || 90;
  const live = db.shareLinks.find((s) => s.entityId === d.id && s.active && s.source === 'email' && (!s.expiresOn || s.expiresOn >= addDays(today(), 7)));
  return live || createShareLink(d.kind, d.id, addDays(today(), days), 'email');
}

export const shareUrl = (origin: string, token: string) => `${origin}/share/${token}`;

// ------------------------------------------------------------ composer defaults

export function composeDefaults(ref: EmailSubjectRef & { templateId?: string }) {
  const db = getDb();
  const r = resolve(ref);
  const kind = kindFor(r, ref);
  // invoices can use the notification or the reminder templates
  const kinds: EmailTemplateKind[] = kind === 'invoice' || kind === 'payment_reminder' ? [kind, kind === 'invoice' ? 'payment_reminder' : 'invoice'] : kind ? [kind] : [];
  const templates = kinds.flatMap((k) => emailTemplates().filter((t) => t.kind === k));
  const picked = ref.templateId ? templates.find((x) => x.id === ref.templateId) : undefined;
  const t = picked || (kind ? templateFor(kind) : undefined);
  const values = placeholderValues(r);
  const recipients: { email: string; name: string; primary?: boolean }[] = [];
  if (r.contact?.email) recipients.push({ email: r.contact.email, name: personName(r.contact), primary: true });
  for (const p of r.contact?.contactPersons || []) if (p.email && !recipients.some((x) => x.email === p.email)) recipients.push({ email: p.email, name: [p.salutation, p.firstName, p.lastName].filter(Boolean).join(' ') || p.email });
  const previous = r.doc?.emailRecipients || [];
  const to = recipients.filter((x) => x.primary).map((x) => x.email);
  if (!to.length && previous.length) to.push(...previous);
  const pdf = pdfName(r);
  const attachments = [
    ...(pdf ? [{ key: 'pdf', label: pdf, kind: 'pdf' as const, checked: true }] : []),
    ...docAttachments(r).map((a) => ({ key: a.id, label: a.name, kind: 'file' as const, checked: false, size: a.size })),
  ];
  const settings = mailSettings();
  const portal = portalSettings(db.preferences);
  return {
    kind: t?.kind ?? kind,
    templateId: t?.id,
    templates: templates.map((x) => ({ id: x.id, name: x.name, isDefault: x.isDefault && x.kind === kind })),
    from: { name: settings.fromName || db.organization.name, email: settings.from || db.organization.email },
    configured: settings.configured,
    provider: settings.provider,
    recipients,
    to,
    subject: t ? fillPlaceholders(t.subject, values) : '',
    body: t ? fillPlaceholders(t.body, values) : '',
    attachments,
    linkAvailable: !!r.doc && LINK_KINDS.has(r.doc.kind),
    linkLabel: r.doc ? `View ${DOC_META[r.doc.kind].label}` : undefined,
    portalEnabled: portal.enabled && !!r.contact?.portalEnabled,
  };
}

// ------------------------------------------------------------ send

export interface SendEmailInput extends EmailSubjectRef {
  to: string[] | string;
  cc?: string[] | string;
  bcc?: string[] | string;
  subject: string;
  body?: string;
  templateId?: string;
  attachPdf?: boolean;
  /** ids of the transaction's own attachments to include */
  attachmentIds?: string[];
  /** files uploaded in the composer */
  files?: Attachment[];
  /** add the "View" button with a secure link */
  includeLink?: boolean;
  /** legacy: labels of attachments (shown in the log only) */
  attachments?: string[];
}

const split = (v: unknown) => (Array.isArray(v) ? v : String(v || '').split(/[,;\s]+/)).map((x) => String(x).trim()).filter(Boolean);

function prepare(b: SendEmailInput) {
  const to = Array.from(new Set(split(b.to)));
  const cc = Array.from(new Set(split(b.cc))).filter((x) => !to.includes(x));
  const bcc = Array.from(new Set(split(b.bcc))).filter((x) => !to.includes(x) && !cc.includes(x));
  if (!to.length) throw new HttpError(400, 'Add at least one recipient');
  if (to.length + cc.length + bcc.length > 50) throw new HttpError(400, 'An email can have at most 50 recipients');
  const bad = [...to, ...cc, ...bcc].find((x) => !isEmail(x));
  if (bad) throw new HttpError(400, `"${bad}" is not a valid email address`);
  if (!String(b.subject || '').trim()) throw new HttpError(400, 'Subject is required');
  if (/[\r\n]/.test(b.subject)) throw new HttpError(400, 'Subject cannot contain line breaks');
  return { to, cc, bcc };
}

/** Compose and send an email about a transaction, payment, statement or contact. */
export async function sendEmail(b: SendEmailInput, origin: string): Promise<Mail> {
  const db = getDb();
  const { to, cc, bcc } = prepare(b);
  const r = resolve(b);
  if (b.entityId && !r.doc && !r.payment && !r.paymentMade) throw new HttpError(404, 'The transaction for this email was not found');

  const files: { filename: string; content: Buffer; cid?: string; contentType?: string }[] = [];
  if (b.attachPdf) {
    const pdf = await renderPdf(r);
    if (pdf) files.push({ filename: pdfName(r)!, content: pdf });
  }
  const own = docAttachments(r);
  for (const id of b.attachmentIds || []) {
    const a = own.find((x) => x.id === id);
    if (!a) throw new HttpError(400, 'An attachment is no longer on this transaction');
    files.push(readUpload(a));
  }
  for (const a of (b.files || []).slice(0, 10)) files.push(readUpload(a));
  const size = files.reduce((s, f) => s + f.content.length, 0);
  if (size > MAX_ATTACHMENT_BYTES) throw new HttpError(400, 'Attachments add up to more than 20 MB. Remove some files or share a link instead.');

  let link: ShareLink | undefined;
  if (r.doc && LINK_KINDS.has(r.doc.kind) && (b.includeLink ?? false)) link = emailLink(r.doc);
  const linkUrl = link ? shareUrl(origin, link.token) : undefined;
  const portal = portalSettings(db.preferences);
  const values = placeholderValues(r, { DocumentLink: linkUrl || '', PortalLink: `${origin}/portal` });
  const subject = fillPlaceholders(String(b.subject).trim(), values);
  const text = fillPlaceholders(String(b.body || ''), values);
  const card = cardFor(r);
  const button = link && r.doc ? { label: `View ${DOC_META[r.doc.kind].label}`, url: linkUrl! } : undefined;
  const secondary = portal.enabled && r.contact?.portalEnabled && db.portalUsers.some((u) => u.contactId === r.contact!.id && u.status === 'active') ? { text: 'All your documents are also in the', label: values.PortalName || 'Client Portal', url: `${origin}/portal` } : undefined;
  const logo = logoAttachment(db);
  const html = renderEmailHtml({ bodyText: text, card, button, secondary, logoSrc: logo ? `cid:${logo.cid}` : undefined, preheader: card?.amount ? `${card.title} ${card.number || ''} · ${card.amountLabel}: ${card.amount}` : undefined });
  const previewHtml = logo ? html.replace(`cid:${logo.cid}`, db.organization.logo!) : html;
  const plain = [text, button ? `\n${button.label}: ${button.url}` : '', secondary ? `\n${secondary.text} ${secondary.label}: ${secondary.url}` : ''].join('');

  const settings = mailSettings();
  const mail: Mail = {
    id: newId('mail'),
    contactId: r.contact?.id || b.contactId,
    entityType: b.entityType,
    entityId: b.entityId,
    from: settings.from || db.organization.email,
    to,
    cc,
    bcc,
    subject,
    body: text,
    html: previewHtml,
    attachments: files.length ? files.map((f) => f.filename) : b.attachments || [],
    templateId: b.templateId,
    shareLinkId: link?.id,
    createdAt: now(),
  };
  try {
    const res = await deliver({ fromName: db.organization.name, replyTo: db.organization.email, to, cc, bcc, subject, text: plain, html, attachments: logo ? [...files, logo] : files });
    mail.provider = res.provider;
    mail.status = res.provider === 'outbox' ? 'outbox' : 'sent';
    mail.delivered = res.provider !== 'outbox';
    if (res.from) mail.from = res.from;
  } catch (e) {
    mail.status = 'failed';
    mail.delivered = false;
    mail.error = e instanceof Error ? e.message : String(e);
    db.mails.push(mail);
    if (r.doc) logActivity(db, r.doc.kind, r.doc.id, r.doc.contactId, 'Email failed', `${mail.error}`);
    throw Object.assign(new HttpError(502, mail.error), { mail });
  }
  db.mails.push(mail);
  afterSent(r, mail);
  return mail;
}

function afterSent(r: Resolved, mail: Mail) {
  const db = getDb();
  const d = r.doc;
  if (d) {
    const meta = DOC_META[d.kind];
    d.sentAt = d.sentAt || now();
    const ready = d.status === 'draft' || d.status === 'approved';
    if (d.kind === 'quote' && ready) d.status = 'sent';
    if (d.kind === 'sales_order' && ready) d.status = 'confirmed';
    if (d.kind === 'invoice' && ready) d.status = 'open';
    if (d.kind === 'retainer_invoice' && ready) d.status = 'sent';
    if (d.kind === 'purchase_order' && ready) d.status = 'issued';
    if ((d.kind === 'credit_note' || d.kind === 'vendor_credit') && ready) d.status = 'open';
    d.emailRecipients = Array.from(new Set([...(d.emailRecipients || []), ...mail.to]));
    const how = mail.status === 'outbox' ? ' (kept in the outbox: email sending is not set up)' : '';
    logActivity(db, d.kind, d.id, d.contactId, `${meta.label} emailed`, `${meta.label} ${d.number} emailed to ${mail.to.join(', ')}${how}`);
  } else if (r.payment) logActivity(db, 'payment_received', r.payment.id, r.payment.contactId, 'Payment receipt emailed', `Sent to ${mail.to.join(', ')}`);
  else if (r.paymentMade) logActivity(db, 'payment_made', r.paymentMade.id, r.paymentMade.contactId, 'Payment emailed', `Sent to ${mail.to.join(', ')}`);
  else if (mail.contactId) logActivity(db, 'contact', mail.contactId, mail.contactId, 'Email sent', mail.subject);
}

/** HTML preview of the email the composer would send (logo inline, link shown as a sample). */
export function previewEmail(b: SendEmailInput, origin: string) {
  const db = getDb();
  const r = resolve(b);
  const link = r.doc && LINK_KINDS.has(r.doc.kind) && b.includeLink ? `${origin}/share/sample-link` : undefined;
  const values = placeholderValues(r, { DocumentLink: link || '', PortalLink: `${origin}/portal` });
  return renderEmailHtml({
    bodyText: fillPlaceholders(String(b.body || ''), values),
    card: cardFor(r),
    button: link && r.doc ? { label: `View ${DOC_META[r.doc.kind].label}`, url: link } : undefined,
    logoSrc: db.organization.logo && /^data:image\//.test(db.organization.logo) ? db.organization.logo : undefined,
  });
}

/** Re-send a logged email (for example one that failed) to the same recipients. */
export async function resendMail(id: string, origin: string) {
  const db = getDb();
  const m = db.mails.find((x) => x.id === id);
  if (!m) throw new HttpError(404, 'Email not found');
  if (m.system) throw new HttpError(400, 'Invitations and password resets are resent from the portal access screen');
  const own = docAttachments(resolve(m));
  const pdf = pdfName(resolve(m));
  return sendEmail(
    {
      entityType: m.entityType,
      entityId: m.entityId,
      contactId: m.contactId,
      to: m.to,
      cc: m.cc,
      bcc: m.bcc,
      subject: m.subject,
      body: m.body,
      templateId: m.templateId,
      attachPdf: !!pdf && m.attachments.includes(pdf),
      attachmentIds: own.filter((a) => m.attachments.includes(a.name)).map((a) => a.id),
      includeLink: !!m.shareLinkId,
    },
    origin,
  );
}

// ------------------------------------------------------------ system emails (portal, notifications)

/** Send a templated email that is not about a transaction: portal invitations, resets. Never throws. */
export async function sendSystemEmail(o: { kind: EmailTemplateKind; to: string; contact?: Contact; recipientName?: string; values: Record<string, string>; button?: EmailButton }) {
  const db = getDb();
  const t = templateFor(o.kind);
  const values = placeholderValues({ contact: o.contact }, { ContactPersonName: o.recipientName || personName(o.contact), ...o.values });
  return sendRaw({ to: [o.to], subject: fillPlaceholders(t.subject, values), text: fillPlaceholders(t.body, values), button: o.button, contactId: o.contact?.id, entityType: o.kind, templateId: t.id, db });
}

/** Sign-in emails to team members (invitations, password resets). */
export async function sendStaffEmail(to: string, subject: string, text: string, button: EmailButton) {
  return sendRaw({ to: [to], subject, text, button, entityType: 'staff_account', db: getDb() });
}

/** Tell the organization about something a customer did in the portal. Never throws. */
export async function notifyOrganization(subject: string, text: string, button?: EmailButton) {
  const db = getDb();
  if (!portalSettings(db.preferences).notifyOrganization || !isEmail(db.organization.email || '')) return undefined;
  return sendRaw({ to: [db.organization.email], subject, text, button, entityType: 'notification', db });
}

async function sendRaw(o: { to: string[]; subject: string; text: string; button?: EmailButton; contactId?: string; entityType?: string; templateId?: string; db: Database }) {
  const { db } = o;
  const logo = logoAttachment(db);
  const html = renderEmailHtml({ bodyText: o.text, button: o.button, logoSrc: logo ? `cid:${logo.cid}` : undefined });
  const mail: Mail = { id: newId('mail'), contactId: o.contactId, entityType: o.entityType, from: mailSettings().from || db.organization.email, to: o.to, cc: [], subject: o.subject, body: o.text, html: logo ? html.replace(`cid:${logo.cid}`, db.organization.logo!) : html, attachments: [], templateId: o.templateId, system: true, createdAt: now() };
  try {
    const res = await deliver({ fromName: db.organization.name, replyTo: db.organization.email, to: o.to, cc: [], subject: o.subject, text: o.button ? `${o.text}\n\n${o.button.label}: ${o.button.url}` : o.text, html, attachments: logo ? [logo] : [] });
    mail.provider = res.provider;
    mail.status = res.provider === 'outbox' ? 'outbox' : 'sent';
    mail.delivered = res.provider !== 'outbox';
    if (res.from) mail.from = res.from;
  } catch (e) {
    mail.status = 'failed';
    mail.delivered = false;
    mail.error = e instanceof Error ? e.message : String(e);
  }
  db.mails.push(mail);
  return mail;
}

export { templateKindMeta };
