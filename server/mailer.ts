// Outgoing email transport. In order of preference:
//   1. a Gmail account linked with OAuth (Settings > Emails or the contact Mails tab)
//   2. SMTP saved in Settings > Emails (password encrypted, see secrets.ts)
//   3. SMTP from the project-root .env file (see .env.example)
//   4. the outbox: nothing is sent, the message is kept in the email log so it can be
//      previewed (development fallback, or force it with MAIL_TRANSPORT=outbox).
import nodemailer, { type Transporter } from 'nodemailer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { rootCertificates } from 'node:tls';
import { getDb } from './db';
import { deliverWithGoogle, googleMailConnection, googleOAuthSettings } from './google-mail';
import { decryptSecret } from './secrets';

export interface SmtpSettings {
  enabled: boolean;
  host: string;
  port: number;
  /** ssl: implicit TLS (465); starttls: upgrade (587); none: plain (local test servers only) */
  security: 'ssl' | 'starttls' | 'none';
  user?: string;
  /** encrypted with secrets.ts */
  passEnc?: string;
  fromName?: string;
  fromEmail?: string;
  replyTo?: string;
}

export interface MailSettings {
  configured: boolean;
  from?: string;
  fromName?: string;
  provider?: 'google-oauth' | 'smtp';
  /** where the SMTP details come from */
  source?: 'settings' | 'env';
  forcedOutbox: boolean;
  googleConnected: boolean;
  googleOAuthConfigured: boolean;
  googleCallbackOrigin: string;
  smtp: Omit<SmtpSettings, 'passEnc'> & { hasPassword: boolean };
  envSmtpConfigured: boolean;
}

interface Resolved {
  host: string;
  port: number;
  security: SmtpSettings['security'];
  user?: string;
  pass?: string;
  fromName?: string;
  fromEmail?: string;
  replyTo?: string;
  tlsCaFile?: string;
  source: 'settings' | 'env';
}

export function savedSmtp(): SmtpSettings {
  const s = (getDb().preferences.smtp as Partial<SmtpSettings>) || {};
  return { enabled: false, host: '', port: 587, security: 'starttls', ...s };
}

function envSmtp(): Resolved | undefined {
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.replace(/\s+/g, ''); // Gmail shows app passwords in groups of 4
  if (!user || !pass) return undefined;
  const port = Number(process.env.SMTP_PORT) || 465;
  return {
    host: process.env.SMTP_HOST?.trim() || 'smtp.gmail.com',
    port,
    security: port === 465 ? 'ssl' : 'starttls',
    user,
    pass,
    fromName: process.env.MAIL_FROM_NAME?.trim(),
    fromEmail: process.env.MAIL_FROM_EMAIL?.trim() || user,
    tlsCaFile: process.env.SMTP_TLS_CA_FILE?.trim(),
    source: 'env',
  };
}

function settingsSmtp(): Resolved | undefined {
  const s = savedSmtp();
  if (!s.enabled || !s.host) return undefined;
  return { host: s.host, port: Number(s.port) || 587, security: s.security, user: s.user, pass: decryptSecret(s.passEnc), fromName: s.fromName, fromEmail: s.fromEmail || s.user, replyTo: s.replyTo, tlsCaFile: process.env.SMTP_TLS_CA_FILE?.trim(), source: 'settings' };
}

const forcedOutbox = () => process.env.MAIL_TRANSPORT?.trim().toLowerCase() === 'outbox';

function resolveSmtp() {
  return settingsSmtp() || envSmtp();
}

function safeGoogleConnection() {
  try {
    return googleMailConnection();
  } catch {
    return undefined;
  }
}

export function mailSettings(): MailSettings {
  const connection = forcedOutbox() ? undefined : safeGoogleConnection();
  const google = googleOAuthSettings();
  const smtp = forcedOutbox() ? undefined : resolveSmtp();
  const saved = savedSmtp();
  const { passEnc, ...rest } = saved;
  return {
    configured: Boolean(connection) || Boolean(smtp?.fromEmail),
    from: connection?.email || smtp?.fromEmail,
    fromName: smtp?.fromName,
    provider: connection ? 'google-oauth' : smtp ? 'smtp' : undefined,
    source: connection ? undefined : smtp?.source,
    forcedOutbox: forcedOutbox(),
    googleConnected: Boolean(connection),
    googleOAuthConfigured: google.configured,
    googleCallbackOrigin: google.callbackOrigin,
    smtp: { ...rest, hasPassword: Boolean(passEnc) },
    envSmtpConfigured: Boolean(envSmtp()),
  };
}

let transporter: Transporter | undefined;
let key = '';

function transportFor(e: Resolved) {
  const k = JSON.stringify(e);
  if (!transporter || k !== key) {
    transporter = nodemailer.createTransport({
      host: e.host,
      port: e.port,
      secure: e.security === 'ssl',
      requireTLS: e.security === 'starttls',
      ignoreTLS: e.security === 'none',
      auth: e.user ? { user: e.user, pass: e.pass } : undefined,
      tls: e.tlsCaFile ? { ca: [...rootCertificates, readFileSync(resolve(e.tlsCaFile))] } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
    });
    key = k;
  }
  return transporter;
}

export interface OutgoingMail {
  fromName: string;
  replyTo?: string;
  to: string[];
  cc: string[];
  bcc?: string[];
  subject: string;
  text: string;
  html?: string;
  attachments: { filename: string; content: Buffer; cid?: string; contentType?: string }[];
}

export interface DeliveryResult {
  provider: 'google-oauth' | 'smtp' | 'outbox';
  from: string;
  messageId?: string;
}

/** Deliver a message, or keep it in the outbox when no transport is set up.
 *  Throws with a readable message when the mail server rejects it. */
export async function deliver(m: OutgoingMail): Promise<DeliveryResult> {
  const html = m.html || toHtml(m.text);
  if (forcedOutbox()) return { provider: 'outbox', from: '' };
  const googleConnection = safeGoogleConnection();
  if (googleConnection) {
    const e = resolveSmtp();
    await deliverWithGoogle({ ...m, fromName: e?.fromName || m.fromName, html });
    return { provider: 'google-oauth', from: googleConnection.email };
  }

  const e = resolveSmtp();
  if (!e || !e.fromEmail) return { provider: 'outbox', from: '' };
  try {
    const info = await transportFor(e).sendMail({
      from: { name: e.fromName || m.fromName, address: e.fromEmail },
      replyTo: e.replyTo || (m.replyTo && m.replyTo !== e.fromEmail ? m.replyTo : undefined),
      to: m.to,
      cc: m.cc.length ? m.cc : undefined,
      bcc: m.bcc?.length ? m.bcc : undefined,
      subject: m.subject,
      text: m.text,
      html,
      attachments: m.attachments,
    });
    return { provider: 'smtp', from: e.fromEmail, messageId: info.messageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Invalid login|Username and Password not accepted|535|EAUTH/i.test(msg)) throw new Error(`The mail server rejected the login for ${e.user}. Check the username and password${e.source === 'env' ? ' in your .env file' : ' in Settings > Emails'}.`);
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ESOCKET|ECONNECTION|Greeting never received/i.test(msg)) throw new Error(`Could not reach the mail server (${e.host}:${e.port}). Check the host, port and your internet connection.`);
    throw new Error(`The mail server refused the message: ${msg}`);
  }
}

/** Open a connection and log in without sending anything. */
export async function verifySmtp() {
  const e = resolveSmtp();
  if (!e) throw new Error('SMTP is not set up');
  await transportFor(e).verify();
  return { host: e.host, port: e.port, user: e.user };
}

export function toHtml(text: string) {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#0f1b2d">${esc.replace(/\n/g, '<br>')}</div>`;
}
