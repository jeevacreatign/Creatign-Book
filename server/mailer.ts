// Outgoing email over SMTP (Gmail by default). Configured from environment variables,
// usually a .env file in the project root (see .env.example). Without SMTP_USER and
// SMTP_PASS, emails are only recorded in the app, not delivered.
import nodemailer, { type Transporter } from 'nodemailer';

export interface MailSettings {
  configured: boolean;
  from?: string;
}

let transporter: Transporter | undefined;
let key = '';

function env() {
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.replace(/\s+/g, ''); // Gmail shows app passwords in groups of 4
  return {
    host: process.env.SMTP_HOST?.trim() || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 465,
    user,
    pass,
    fromName: process.env.MAIL_FROM_NAME?.trim(),
  };
}

export function mailSettings(): MailSettings {
  const e = env();
  return e.user && e.pass ? { configured: true, from: e.user } : { configured: false };
}

function getTransporter() {
  const e = env();
  const k = `${e.host}|${e.port}|${e.user}|${e.pass}`;
  if (!transporter || k !== key) {
    transporter = nodemailer.createTransport({ host: e.host, port: e.port, secure: e.port === 465, auth: { user: e.user, pass: e.pass } });
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
