// Team sign-up and sign-in for the staff app.
//
// - The first person to sign up becomes the Admin (owner). If their email matches a team member
//   already on file (for example the sample admin), that record is claimed.
// - Later sign-ups wait as "pending" until an Admin approves them in Settings > Users & Access.
// - Admins can also invite people: an emailed link lets them set a password and sign in.
// - Sessions are random tokens in an HttpOnly, SameSite=Lax cookie; only a hash is stored.
// - Every /api route except auth, the client portal and public share links needs a session, and
//   requests that change something must carry the X-CL-Request header our client sends.
// - AUTH_DISABLED=1 turns all of this off (the API tests use it).
import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import type { StaffSession, User } from '../shared/types';
import { getDb, newId, now } from './db';
import { publicOrigin, sendStaffEmail } from './email';
import { hashPassword, verifyPassword } from './portal';
import { hashToken, randomToken } from './secrets';
import * as S from './services';

export const SESSION_COOKIE = 'cl_session';
const SESSION_DAYS = 14;
const RESET_HOURS = 2;
const INVITE_DAYS = 7;
const MAX_FAILED = 8;
const LOCK_MINUTES = 15;

export const authDisabled = () => process.env.AUTH_DISABLED === '1' || process.env.AUTH_DISABLED === 'true';

type Wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => Promise<void>;
const bad = (msg: string) => new S.HttpError(400, msg);
const p = (req: Request, k: string) => String(req.params[k]);
const str = (v: unknown) => (v == null ? '' : String(v).trim());
const isEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const sameEmail = (a?: string, b?: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
const fmtExpiry = (iso: string) => `${new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST`;

// ------------------------------------------------------------------ the signed-in user for this request

const store = new AsyncLocalStorage<User>();
/** The team member making the current request (undefined outside a signed-in request). */
export const requestUser = () => store.getStore();

export const publicUser = (u: User) => ({ id: u.id, name: u.name, email: u.email, role: u.role, status: u.status, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt, hasPassword: !!u.passwordHash, inviteExpiresAt: u.inviteExpiresAt });

export function checkPassword(pw: unknown) {
  const s = String(pw || '');
  if (s.length < 8) throw bad('Use at least 8 characters for the password');
  if (s.length > 200) throw bad('The password is too long');
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) throw bad('Use letters and at least one number in the password');
  return s;
}

/** Small in-memory limiter for sign-in, sign-up and reset requests. */
const hits = new Map<string, number[]>();
function limit(key: string, max: number, windowMs: number) {
  const t = Date.now();
  const list = (hits.get(key) || []).filter((x) => t - x < windowMs);
  if (list.length >= max) throw new S.HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
  list.push(t);
  hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(k);
}
export const resetAuthLimits = () => hits.clear();

/** True until somebody has created a password: the app then asks for the owner's sign-up. */
export const needsSetup = () => !getDb().users.some((u) => u.passwordHash && u.status === 'active');

// ------------------------------------------------------------------ sessions

function cookies(req: Request) {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function startSession(req: Request, res: Response, u: User, remember: boolean) {
  const db = getDb();
  const token = randomToken();
  const days = remember ? SESSION_DAYS : 1;
  const expires = new Date(Date.now() + days * 86400_000);
  db.staffSessions = db.staffSessions.filter((s) => s.expiresAt > now());
  const s: StaffSession = { id: newId('ss'), tokenHash: hashToken(token), userId: u.id, createdAt: now(), expiresAt: expires.toISOString(), lastSeenAt: now(), userAgent: req.get('user-agent')?.slice(0, 200) };
  db.staffSessions.push(s);
  u.lastLoginAt = now();
  u.failedLogins = 0;
  u.lockedUntil = undefined;
  const secure = req.secure || req.get('x-forwarded-proto') === 'https' || req.get('cloudfront-forwarded-proto') === 'https' || process.env.COOKIE_SECURE === '1';
  // without "remember me" the cookie lasts until the browser closes (and the session for a day)
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${remember ? `; Expires=${expires.toUTCString()}` : ''}${secure ? '; Secure' : ''}`);
}

function clearCookie(res: Response) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
}

function sessionUser(req: Request) {
  const token = cookies(req)[SESSION_COOKIE];
  if (!token) return undefined;
  const db = getDb();
  const s = db.staffSessions.find((x) => x.tokenHash === hashToken(token));
  if (!s || s.expiresAt < now()) return undefined;
  const u = db.users.find((x) => x.id === s.userId);
  if (!u || u.status !== 'active' || !u.passwordHash) return undefined;
  s.lastSeenAt = now();
  return { u, s };
}

const endSessions = (userId: string, keep?: string) => {
  const db = getDb();
  db.staffSessions = db.staffSessions.filter((s) => s.userId !== userId || s.id === keep);
};

// ------------------------------------------------------------------ middleware

const OPEN = [/^\/auth\//, /^\/portal(\/|$)/, /^\/public\//, /^\/health$/];

/** Mounted on /api and /uploads: needs a session, and a custom header on changes (blocks cross-site forms). */
export const requireStaff: RequestHandler = (req, _res, next) => {
  if (authDisabled()) return next();
  if (req.baseUrl === '/api' && OPEN.some((r) => r.test(req.path))) return next();
  const found = sessionUser(req);
  if (!found) return next(new S.HttpError(401, 'Please sign in'));
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('x-cl-request') !== '1') return next(new S.HttpError(403, 'Request blocked'));
  if (found.u.role === 'Timesheet Staff' && !timesheetCanUse(req)) return next(new S.HttpError(403, 'Your role can only log time on your projects'));
  store.run(found.u, () => next());
};

// Timesheet Staff log time on the projects they are on, and nothing else.
const TIMESHEET_READ = /^\/(bootstrap|users|projects|projects\/[^/]+|projects\/[^/]+\/hours|time-entries(\/.*)?|timer)$/;
const TIMESHEET_WRITE = /^\/(time-entries(\/.*)?|timer(\/.*)?)$/;
function timesheetCanUse(req: Request) {
  if (req.baseUrl !== '/api') return false; // no attachments
  if (/^\/auth\//.test(req.path)) return true;
  return req.method === 'GET' || req.method === 'HEAD' ? TIMESHEET_READ.test(req.path) : TIMESHEET_WRITE.test(req.path);
}

/** The signed-in Timesheet Staff member, when the request comes from one (their data is limited to their own time). */
export const timesheetOnlyUser = () => {
  const u = requestUser();
  return u?.role === 'Timesheet Staff' ? u : undefined;
};

/** A role someone may hand out: only an Admin can create another Admin. */
export function grantableRole(role: unknown): User['role'] {
  const r = (['Admin', 'Staff', 'Timesheet Staff'] as const).find((x) => x === role) ?? 'Staff';
  if (r === 'Admin' && !authDisabled() && requestUser()?.role !== 'Admin') throw new S.HttpError(403, 'Only an Admin can add another Admin');
  return r;
}

export const requireAdmin = () => {
  if (authDisabled()) return;
  const u = requestUser();
  if (!u || u.role !== 'Admin') throw new S.HttpError(403, 'Only an Admin can do this');
};

// ------------------------------------------------------------------ emails

async function sendInvite(u: User, origin: string, by?: string) {
  const token = randomToken();
  u.inviteTokenHash = hashToken(token);
  u.inviteExpiresAt = new Date(Date.now() + INVITE_DAYS * 86400_000).toISOString();
  u.status = u.passwordHash ? u.status : 'invited';
  const org = getDb().organization.name;
  const url = `${origin}/invite/${token}`;
  const mail = await sendStaffEmail(u.email!, `You're invited to ${org} on Creatign Ledger`, `Hi ${u.name},\n\n${by ? `${by} has` : 'You have been'} invited you to join ${org} on Creatign Ledger as ${u.role}.\n\nSet your password with the link below. It works until ${fmtExpiry(u.inviteExpiresAt)}.`, { label: 'Accept Invitation', url });
  return { url, delivered: mail.status === 'sent' };
}

// ------------------------------------------------------------------ routes

/**
 * Origin for links in emails sent from a request nobody signed in to make (password reset).
 * The browser's Origin header is used only when it names the host the request came to, so a
 * forged Origin can't send someone's reset link to another site. Set APP_ORIGIN in production
 * so the Host header doesn't matter either.
 */
export function unauthenticatedOrigin(req: Request) {
  const o = req.get('origin');
  let host: string | undefined;
  try {
    host = o ? new URL(o).host : undefined;
  } catch {
    host = undefined;
  }
  const served = req.get('host')?.trim().toLowerCase();
  return publicOrigin(host && served && host.toLowerCase() === served ? o : undefined);
}

export function registerAuthRoutes(api: Router, h: Wrap, m: Wrap) {
  const origin = (req: Request) => publicOrigin(req.get('origin') || undefined);

  api.get('/auth/me', h((req) => {
    if (authDisabled()) {
      const db = getDb();
      const u = db.users.find((x) => x.role === 'Admin' && x.status === 'active') ?? db.users[0];
      return { user: publicUser(u), organization: db.organization.name, authDisabled: true };
    }
    const found = sessionUser(req);
    if (!found) throw new S.HttpError(401, needsSetup() ? 'setup' : 'Please sign in');
    return { user: publicUser(found.u), organization: getDb().organization.name };
  }));

  api.get('/auth/status', h(() => ({ needsSetup: needsSetup(), organization: getDb().organization.name, authDisabled: authDisabled() })));

  api.post('/auth/signup', h(async (req, res) => {
    limit(`signup-ip:${req.ip}`, 10, 60 * 60_000);
    const db = getDb();
    const name = str(req.body?.name);
    const email = str(req.body?.email).toLowerCase();
    if (!name) throw bad('Enter your name');
    if (name.length > 100) throw bad('The name is too long');
    if (!isEmail(email)) throw bad('Enter a valid email address');
    const password = checkPassword(req.body?.password);
    const existing = db.users.find((u) => sameEmail(u.email, email));
    if (needsSetup()) {
      // On a public server ADMIN_EMAIL stops a stranger from claiming the Admin account first
      const owner = process.env.ADMIN_EMAIL?.trim().toLowerCase();
      if (owner && !sameEmail(owner, email)) throw new S.HttpError(403, 'This Creatign Ledger is waiting for its owner to set it up. Sign up with the Admin email address set on the server.');
      // the owner: claim the matching record or create one, as Admin
      // no matching email: take over the unclaimed Admin placeholder from the starter data instead of leaving it behind
      const claim = existing ?? db.users.find((x) => x.id === 'usr_admin' && x.role === 'Admin' && !x.passwordHash);
      const u: User = claim ?? { id: newId('usr'), name, email, role: 'Admin', status: 'active', createdAt: now() };
      if (!claim) db.users.push(u);
      Object.assign(u, { name, email, role: 'Admin', status: 'active', passwordHash: await hashPassword(password), approvedAt: now(), inviteTokenHash: undefined, inviteExpiresAt: undefined });
      startSession(req, res, u, true);
      S.commit();
      return { status: 'active', user: publicUser(u) };
    }
    if (existing?.passwordHash) throw bad('An account with this email already exists. Sign in instead, or reset your password.');
    if (existing && (existing.status === 'invited' || existing.status === 'active')) throw bad('You are already on the team. Use the invitation in your email to set your password, or ask an Admin to send it again.');
    if (existing) Object.assign(existing, { name, passwordHash: await hashPassword(password), status: 'pending' });
    else db.users.push({ id: newId('usr'), name, email, role: 'Staff', status: 'pending', createdAt: now(), passwordHash: await hashPassword(password) });
    S.commit();
    return { status: 'pending' };
  }));

  api.post('/auth/signin', h(async (req, res) => {
    const email = str(req.body?.email).toLowerCase();
    const password = String(req.body?.password || '');
    limit(`signin-ip:${req.ip}`, 30, 15 * 60_000);
    limit(`signin:${email}`, 10, 15 * 60_000);
    const db = getDb();
    const u = db.users.find((x) => sameEmail(x.email, email));
    const fail = new S.HttpError(401, 'The email or password is incorrect');
    if (!u || !u.passwordHash) {
      await hashPassword(password); // same timing whether or not the account exists
      if (u?.status === 'invited') throw new S.HttpError(401, 'Accept the invitation in your email to set your password first');
      throw fail;
    }
    if (u.lockedUntil && u.lockedUntil > now()) throw new S.HttpError(429, 'Too many failed attempts. Try again in a few minutes or reset your password.');
    if (!(await verifyPassword(password, u.passwordHash))) {
      u.failedLogins = (u.failedLogins || 0) + 1;
      if (u.failedLogins >= MAX_FAILED) u.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString();
      S.commit();
      throw fail;
    }
    if (u.status === 'pending') throw new S.HttpError(403, 'Your sign-up is waiting for an Admin to approve it.');
    if (u.status !== 'active') throw new S.HttpError(403, 'This account is turned off. Contact your Admin.');
    startSession(req, res, u, req.body?.remember !== false);
    S.commit();
    return { user: publicUser(u) };
  }));

  api.post('/auth/signout', h((req, res) => {
    const token = cookies(req)[SESSION_COOKIE];
    if (token) {
      const db = getDb();
      db.staffSessions = db.staffSessions.filter((s) => s.tokenHash !== hashToken(token));
      S.commit();
    }
    clearCookie(res);
  }));

  api.post('/auth/forgot', h(async (req) => {
    const email = str(req.body?.email).toLowerCase();
    limit(`forgot-ip:${req.ip}`, 10, 15 * 60_000);
    limit(`forgot:${email}`, 3, 15 * 60_000);
    const u = getDb().users.find((x) => sameEmail(x.email, email));
    if (u && u.status === 'active' && u.passwordHash) {
      const token = randomToken();
      u.resetTokenHash = hashToken(token);
      u.resetExpiresAt = new Date(Date.now() + RESET_HOURS * 3600_000).toISOString();
      const url = `${unauthenticatedOrigin(req)}/reset-password/${token}`;
      await sendStaffEmail(u.email!, 'Reset your Creatign Ledger password', `Hi ${u.name},\n\nWe received a request to reset your password. The link below works until ${fmtExpiry(u.resetExpiresAt)}. If you did not ask for this, you can ignore this email.`, { label: 'Reset Password', url });
      S.commit();
    }
    // same answer whether or not the account exists
    return { ok: true };
  }));

  const byReset = (token: string) => {
    const u = getDb().users.find((x) => x.resetTokenHash === hashToken(token));
    if (!u || u.status !== 'active' || !u.resetExpiresAt || u.resetExpiresAt < now()) throw new S.HttpError(404, 'This reset link has expired or was already used. Request a new one.');
    return u;
  };
  api.get('/auth/reset/:token', h((req) => ({ email: byReset(p(req, 'token')).email })));
  api.post('/auth/reset/:token', h(async (req, res) => {
    limit(`reset:${req.ip}`, 20, 15 * 60_000);
    const u = byReset(p(req, 'token'));
    u.passwordHash = await hashPassword(checkPassword(req.body?.password));
    u.resetTokenHash = undefined;
    u.resetExpiresAt = undefined;
    endSessions(u.id);
    startSession(req, res, u, true);
    S.commit();
    return { user: publicUser(u) };
  }));

  const byInvite = (token: string) => {
    const u = getDb().users.find((x) => x.inviteTokenHash === hashToken(token));
    if (!u || u.status === 'inactive' || !u.inviteExpiresAt || u.inviteExpiresAt < now()) throw new S.HttpError(404, 'This invitation has expired or was already used. Ask your Admin to send a new one.');
    return u;
  };
  api.get('/auth/invite/:token', h((req) => {
    const u = byInvite(p(req, 'token'));
    return { name: u.name, email: u.email, role: u.role, organization: getDb().organization.name };
  }));
  api.post('/auth/invite/:token', h(async (req, res) => {
    limit(`invite:${req.ip}`, 20, 15 * 60_000);
    const u = byInvite(p(req, 'token'));
    const name = str(req.body?.name);
    if (name) u.name = name.slice(0, 100);
    u.passwordHash = await hashPassword(checkPassword(req.body?.password));
    u.status = 'active';
    u.approvedAt ??= now();
    u.inviteTokenHash = undefined;
    u.inviteExpiresAt = undefined;
    startSession(req, res, u, true);
    S.commit();
    return { user: publicUser(u) };
  }));

  // ---- signed in: own account
  api.put('/auth/profile', m((req) => {
    const u = requestUser();
    if (!u) throw new S.HttpError(401, 'Please sign in');
    const name = str(req.body?.name);
    if (!name) throw bad('Enter your name');
    u.name = name.slice(0, 100);
    return publicUser(u);
  }));
  api.post('/auth/change-password', h(async (req) => {
    const u = requestUser();
    if (!u) throw new S.HttpError(401, 'Please sign in');
    if (!(await verifyPassword(String(req.body?.currentPassword || ''), u.passwordHash))) throw bad('The current password is incorrect');
    u.passwordHash = await hashPassword(checkPassword(req.body?.newPassword));
    // sign out other browsers
    const token = cookies(req)[SESSION_COOKIE];
    const mine = getDb().staffSessions.find((s) => s.tokenHash === hashToken(token || ''));
    endSessions(u.id, mine?.id);
    S.commit();
    return { ok: true };
  }));

  // ---- Admin: team access
  api.get('/team', h(() => {
    requireAdmin();
    const db = getDb();
    return db.users.map((u) => ({ ...publicUser(u), sessions: db.staffSessions.filter((s) => s.userId === u.id && s.expiresAt > now()).length })).sort((a, b) => a.name.localeCompare(b.name));
  }));
  api.post('/team/invite', h(async (req) => {
    requireAdmin();
    const db = getDb();
    const name = str(req.body?.name);
    const email = str(req.body?.email).toLowerCase();
    const role = (['Admin', 'Staff', 'Timesheet Staff'] as const).find((r) => r === req.body?.role) ?? 'Staff';
    if (!name) throw bad('Enter a name');
    if (!isEmail(email)) throw bad('Enter a valid email address');
    let u = db.users.find((x) => sameEmail(x.email, email));
    if (u?.passwordHash && u.status === 'active') throw bad('This person already has an account');
    if (!u) {
      u = { id: newId('usr'), name, email, role, status: 'invited', createdAt: now() };
      db.users.push(u);
    } else Object.assign(u, { name, role, passwordHash: undefined });
    const r = await sendInvite(u, origin(req), requestUser()?.name);
    S.commit();
    return { user: publicUser(u), inviteUrl: r.url, delivered: r.delivered };
  }));
  api.post('/team/:id/:action', h(async (req) => {
    requireAdmin();
    const db = getDb();
    const u = db.users.find((x) => x.id === p(req, 'id'));
    if (!u) throw new S.HttpError(404, 'User not found');
    const me = requestUser();
    const action = p(req, 'action');
    const otherAdmins = db.users.some((x) => x.id !== u.id && x.role === 'Admin' && x.status === 'active' && x.passwordHash);
    let out: Record<string, unknown> = {};
    if (action === 'approve') {
      if (u.status !== 'pending') throw bad('Only pending sign-ups can be approved');
      u.status = 'active';
      u.approvedAt = now();
    } else if (action === 'deactivate') {
      if (me && me.id === u.id) throw bad('You cannot turn off your own account');
      if (u.role === 'Admin' && !otherAdmins) throw bad('Keep at least one active Admin');
      u.status = 'inactive';
      endSessions(u.id);
    } else if (action === 'activate') {
      u.status = u.passwordHash ? 'active' : 'invited';
    } else if (action === 'role') {
      const role = (['Admin', 'Staff', 'Timesheet Staff'] as const).find((r) => r === req.body?.role);
      if (!role) throw bad('Choose a role');
      if (u.role === 'Admin' && role !== 'Admin' && !otherAdmins) throw bad('Keep at least one active Admin');
      u.role = role;
    } else if (action === 'resend-invite') {
      if (!u.email) throw bad('Add an email address for this user first');
      if (u.passwordHash && u.status === 'active') throw bad('This person already has an account');
      const r = await sendInvite(u, origin(req), me?.name);
      out = { inviteUrl: r.url, delivered: r.delivered };
    } else if (action === 'sign-out') {
      endSessions(u.id);
    } else throw new S.HttpError(404, 'Unknown action');
    S.commit();
    return { user: publicUser(u), ...out };
  }));
  api.delete('/team/:id', m((req) => {
    requireAdmin();
    const db = getDb();
    const u = db.users.find((x) => x.id === p(req, 'id'));
    if (!u) throw new S.HttpError(404, 'User not found');
    if (u.status !== 'pending') throw bad('Only pending sign-ups can be rejected. Turn the account off instead.');
    // keep the record (it may already be on timesheets); it just can't sign in
    u.status = 'inactive';
    u.passwordHash = undefined;
  }));
}
