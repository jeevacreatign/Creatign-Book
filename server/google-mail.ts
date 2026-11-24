import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const tokenFile = process.env.GOOGLE_OAUTH_TOKEN_FILE?.trim()
  ? path.resolve(process.env.GOOGLE_OAUTH_TOKEN_FILE)
  : path.join(dataDir, 'google-mail-auth.json');
const oauthStateTtlMs = 10 * 60 * 1000;
const oauthStates = new Map<string, { nonce: string; codeVerifier: string; createdAt: number }>();
const gmailSendScope = 'https://www.googleapis.com/auth/gmail.send';

interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  appOrigin: string;
}

interface StoredGoogleAccount {
  version: 1;
  email: string;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GoogleUserInfo {
  email?: string;
  email_verified?: boolean;
}

export interface GoogleMailConnection {
  email: string;
  refreshToken: string;
}

export interface GoogleMailMessage {
  fromName: string;
  replyTo?: string;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  html: string;
  attachments: { filename: string; content: Buffer }[];
}

function config(): GoogleOAuthConfig | undefined {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return undefined;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() || 'http://localhost:4000/api/mail/google/callback';
  const appOrigin = process.env.APP_ORIGIN?.trim() || 'http://localhost:5173';
  const redirect = new URL(redirectUri);
  const app = new URL(appOrigin);
  if (!['http:', 'https:'].includes(redirect.protocol) || !['http:', 'https:'].includes(app.protocol)) {
    throw new Error('Google OAuth redirect and app URLs must use HTTP or HTTPS');
  }
  return { clientId, clientSecret, redirectUri: redirect.toString(), appOrigin: app.origin };
}

export function googleOAuthSettings() {
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() || 'http://localhost:4000/api/mail/google/callback';
  return { configured: Boolean(config()), callbackOrigin: new URL(redirectUri).origin };
}

function keyFor(clientSecret: string, salt: Buffer) {
  return scryptSync(clientSecret, salt, 32);
}

function readStoredAccount(): GoogleMailConnection | undefined {
  if (!fs.existsSync(tokenFile)) return undefined;
  const oauth = config();
  if (!oauth) throw new Error('Google OAuth settings are missing; reconnect the Gmail account after configuring them.');
  const stored = JSON.parse(fs.readFileSync(tokenFile, 'utf8')) as StoredGoogleAccount;
  if (stored.version !== 1 || !stored.email || !stored.salt || !stored.iv || !stored.tag || !stored.ciphertext) {
    throw new Error('The saved Gmail connection is invalid. Disconnect it and link the account again.');
  }
  try {
    const salt = Buffer.from(stored.salt, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', keyFor(oauth.clientSecret, salt), Buffer.from(stored.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(stored.tag, 'base64'));
    const refreshToken = Buffer.concat([decipher.update(Buffer.from(stored.ciphertext, 'base64')), decipher.final()]).toString('utf8');
    return { email: stored.email, refreshToken };
  } catch {
    throw new Error('The saved Gmail connection cannot be decrypted. Reconnect the Gmail account.');
  }
}

function writeStoredAccount(email: string, refreshToken: string, clientSecret: string) {
  const tokenDir = path.dirname(tokenFile);
  fs.mkdirSync(tokenDir, { recursive: true });
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(clientSecret, salt), iv);
  const ciphertext = Buffer.concat([cipher.update(refreshToken, 'utf8'), cipher.final()]);
  const stored: StoredGoogleAccount = {
    version: 1,
    email,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
  const tempFile = path.join(tokenDir, `google-mail-auth-${randomBytes(8).toString('hex')}.tmp.json`);
  try {
    fs.writeFileSync(tempFile, JSON.stringify(stored), { mode: 0o600 });
    fs.renameSync(tempFile, tokenFile);
  } catch (error) {
    fs.rmSync(tempFile, { force: true });
    throw error;
  }
}

export function googleMailConnection() {
  return readStoredAccount();
}

export function createGoogleAuthorizationUrl(nonce: string) {
  const oauth = config();
  if (!oauth) throw new Error('Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET to .env, then restart the app.');
  if (!/^[\w-]{16,128}$/.test(nonce)) throw new Error('Invalid Gmail authorization request');

  const state = randomBytes(32).toString('base64url');
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  oauthStates.set(state, { nonce, codeVerifier, createdAt: Date.now() });
  for (const [key, value] of oauthStates) {
    if (Date.now() - value.createdAt > oauthStateTtlMs) oauthStates.delete(key);
  }

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: oauth.clientId,
    redirect_uri: oauth.redirectUri,
    response_type: 'code',
    scope: `openid email ${gmailSendScope}`,
    access_type: 'offline',
    prompt: 'consent select_account',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

export function consumeGoogleAuthorizationState(state: string | undefined) {
  if (!state) return undefined;
  const pending = oauthStates.get(state);
  oauthStates.delete(state);
  if (!pending || Date.now() - pending.createdAt > oauthStateTtlMs) return undefined;
  return pending;
}

async function readJsonResponse<T>(response: Response, description: string): Promise<T> {
  const body = await response.text();
  let parsed: T;
  try {
    parsed = JSON.parse(body) as T;
  } catch {
    throw new Error(`${description} returned an invalid response`);
  }
  if (!response.ok) {
    const error = parsed as { error?: string | { message?: string }; error_description?: string };
    const detail = typeof error.error === 'string' ? error.error_description || error.error : error.error?.message;
    throw new Error(`${description} failed${detail ? `: ${detail}` : ` (${response.status})`}`);
  }
  return parsed;
}

export async function finishGoogleAuthorization(code: string, codeVerifier: string) {
  const oauth = config();
  if (!oauth) throw new Error('Google OAuth settings are missing; configure them and restart the app.');
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
      redirect_uri: oauth.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  });
  const tokens = await readJsonResponse<GoogleTokenResponse>(tokenResponse, 'Google token exchange');
  if (!tokens.access_token) throw new Error('Google did not return an access token');

  const userResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const user = await readJsonResponse<GoogleUserInfo>(userResponse, 'Google account lookup');
  if (!user.email || user.email_verified !== true) throw new Error('Google did not verify the connected email address');

  const prior = readStoredAccount();
  const refreshToken = tokens.refresh_token || (prior?.email === user.email ? prior.refreshToken : undefined);
  if (!refreshToken) throw new Error('Google did not return a refresh token. Remove this app from your Google Account permissions and try linking again.');
  writeStoredAccount(user.email, refreshToken, oauth.clientSecret);
  return user.email;
}

export async function disconnectGoogleAccount() {
  const account = readStoredAccount();
  if (!account) return { ok: true };
  const oauth = config();
  if (!oauth) throw new Error('Google OAuth settings are missing; cannot revoke the connected account.');
  const response = await fetch('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: account.refreshToken }),
  });
  if (!response.ok && response.status !== 400) {
    throw new Error(`Google could not revoke the Gmail connection (${response.status})`);
  }
  fs.rmSync(tokenFile, { force: true });
  return { ok: true };
}

async function accessToken(connection: GoogleMailConnection, oauth: GoogleOAuthConfig) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
      refresh_token: connection.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const tokens = await readJsonResponse<GoogleTokenResponse>(response, 'Google access token refresh');
  if (!tokens.access_token) throw new Error('Google did not return an access token. Reconnect the Gmail account.');
  return tokens.access_token;
}

async function rawMessage(message: GoogleMailMessage, from: string) {
  const transporter = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  const info = await transporter.sendMail({
    from: { name: message.fromName, address: from },
    replyTo: message.replyTo && message.replyTo !== from ? message.replyTo : undefined,
    to: message.to,
    cc: message.cc.length ? message.cc : undefined,
    subject: message.subject,
    text: message.text,
    html: message.html,
    attachments: message.attachments,
  });
  if (Buffer.isBuffer(info.message)) return info.message.toString('base64url');
  if (typeof info.message === 'string') return Buffer.from(info.message).toString('base64url');
  throw new Error('Could not create the Gmail message');
}

export async function deliverWithGoogle(message: GoogleMailMessage) {
  const oauth = config();
  const connection = readStoredAccount();
  if (!oauth || !connection) throw new Error('Link a Gmail account before sending email');
  const token = await accessToken(connection, oauth);
  const raw = await rawMessage(message, connection.email);
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  await readJsonResponse<{ id?: string }>(response, 'Gmail send');
}

export function googleOAuthResultPage(result: { nonce?: string; ok: boolean; email?: string; error?: string }) {
  const appOrigin = process.env.APP_ORIGIN?.trim() || 'http://localhost:5173';
  const targetOrigin = new URL(appOrigin).origin;
  const payload = JSON.stringify({ type: 'gmail-oauth-result', ...result }).replace(/[<>&\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const visible = result.ok ? `Gmail connected${result.email ? ` as ${result.email}` : ''}. You can close this window.` : escapeHtml(result.error || 'Gmail connection failed. Return to the app and try again.');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Gmail connection</title></head><body><p>${visible}</p><script>history.replaceState(null,'',location.pathname);const result=${payload};if(window.opener&&result.nonce){window.opener.postMessage(result,${JSON.stringify(targetOrigin)});window.close();}</script></body></html>`;
}

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
