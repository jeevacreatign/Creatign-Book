// Outgoing email uses a linked Gmail OAuth account when available, otherwise SMTP.
// Configuration is in the project-root .env file (see .env.example).
import nodemailer, { type Transporter } from 'nodemailer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { rootCertificates } from 'node:tls';
import { deliverWithGoogle, googleMailConnection, googleOAuthSettings } from './google-mail';

export interface MailSettings {
  configured: boolean;
  from?: string;
  provider?: 'google-oauth' | 'smtp';
  googleConnected: boolean;
  googleOAuthConfigured: boolean;
  googleCallbackOrigin: string;
}

let transporter: Transporter | undefined;
let key = '';

function env() {
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.replace(/\s+/g, ''); // Gmail shows app passwords in groups of 4
  return {
    host: process.env.SMTP_HOST?.trim() || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 465,
    tlsCaFile: process.env.SMTP_TLS_CA_FILE?.trim(),
    user,
    pass,
    fromName: process.env.MAIL_FROM_NAME?.trim(),
  };
}

export function mailSettings(): MailSettings {
  const e = env();
  const connection = googleMailConnection();
  const google = googleOAuthSettings();
  const smtpConfigured = Boolean(e.user && e.pass);
  return {
    configured: Boolean(connection) || smtpConfigured,
    from: connection?.email || (smtpConfigured ? e.user : undefined),
    provider: connection ? 'google-oauth' : smtpConfigured ? 'smtp' : undefined,
    googleConnected: Boolean(connection),
    googleOAuthConfigured: google.configured,
    googleCallbackOrigin: google.callbackOrigin,
  };
}

function getTransporter() {
  const e = env();
  const k = `${e.host}|${e.port}|${e.user}|${e.pass}|${e.tlsCaFile}`;
  if (!transporter || k !== key) {
    transporter = nodemailer.createTransport({
      host: e.host,
      port: e.port,
      secure: e.port === 465,
      auth: { user: e.user, pass: e.pass },
      tls: e.tlsCaFile ? { ca: [...rootCertificates, readFileSync(resolve(e.tlsCaFile))] } : undefined,
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
  subject: string;
  text: string;
  attachments: { filename: string; content: Buffer }[];
}

/** Deliver a message. Throws with a readable message when the server rejects it. */
export async function deliver(m: OutgoingMail) {
  const googleConnection = googleMailConnection();
  if (googleConnection) {
    const e = env();
    await deliverWithGoogle({ ...m, fromName: e.fromName || m.fromName, html: toHtml(m.text) });
    return;
  }

  const e = env();
  if (!e.user || !e.pass) throw new Error('Email is not set up');
  try {
    await getTransporter().sendMail({
      from: { name: e.fromName || m.fromName, address: e.user },
      replyTo: m.replyTo && m.replyTo !== e.user ? m.replyTo : undefined,
      to: m.to,
      cc: m.cc.length ? m.cc : undefined,
      subject: m.subject,
      text: m.text,
      html: toHtml(m.text),
      attachments: m.attachments,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Invalid login|Username and Password not accepted|535/i.test(msg)) throw new Error('Gmail rejected the login. Check SMTP_USER and the app password in your .env file.');
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ESOCKET/i.test(msg)) throw new Error(`Could not reach the mail server (${e.host}:${e.port}). Check your internet connection.`);
    throw new Error(`The mail server refused the message: ${msg}`);
  }
}

function toHtml(text: string) {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#0f1b2d">${esc.replace(/\n/g, '<br>')}</div>`;
}
