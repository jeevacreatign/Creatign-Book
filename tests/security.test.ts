// Security regressions found in the full-app audit: roles, Timesheet Staff scope, uploaded files,
// comment HTML, password-reset links and response headers. Sign-in is on for this file.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

process.env.DB_FILE = ':memory:';
process.env.AUTH_DISABLED = '0';
process.env.MAIL_TRANSPORT = 'outbox';
process.env.UPLOAD_DIR = '/tmp/creatign-ledger-security-uploads';
delete process.env.APP_ORIGIN;

let app: Express;
const H = { 'X-CL-Request': '1' };
const cookieOf = (r: request.Response) => String((r.headers['set-cookie'] as unknown as string[] | undefined)?.[0] || '').split(';')[0];
let owner = '';
let staff = '';
let timesheet = '';
let timesheetId = '';

async function member(role: string, email: string) {
  const inv = await request(app).post('/api/team/invite').set('Cookie', owner).set(H).send({ name: role, email, role });
  expect(inv.status).toBe(200);
  const token = String(inv.body.inviteUrl).split('/invite/')[1];
  const r = await request(app).post(`/api/auth/invite/${token}`).send({ password: 'ledger2026' });
  expect(r.status).toBe(200);
  return { cookie: cookieOf(r), id: inv.body.user.id as string };
}

beforeAll(async () => {
  const mod = await import('../server/app');
  const { resetDb } = await import('../server/db');
  resetDb(true);
  mod.boot();
  app = mod.createApp();
  owner = cookieOf(await request(app).post('/api/auth/signup').send({ name: 'Owner', email: 'owner@creatign.example', password: 'ledger2026' }));
  staff = (await member('Staff', 'staff@creatign.example')).cookie;
  const ts = await member('Timesheet Staff', 'time@creatign.example');
  timesheet = ts.cookie;
  timesheetId = ts.id;
});

describe('roles', () => {
  it('stops Staff from creating an Admin through the user and project screens', async () => {
    const r = await request(app).post('/api/users').set('Cookie', staff).set(H).send({ name: 'Sneaky', email: 'sneaky@creatign.example', role: 'Admin' });
    expect(r.status).toBe(403);
    const ok = await request(app).post('/api/users').set('Cookie', staff).set(H).send({ name: 'Helper', email: 'helper@creatign.example', role: 'Staff' });
    expect(ok.body.role).toBe('Staff');
    const prj = (await request(app).get('/api/projects').set('Cookie', staff)).body[0];
    const viaProject = await request(app).post(`/api/projects/${prj.id}/users`).set('Cookie', staff).set(H).send({ name: 'Sneaky 2', email: 'sneaky2@creatign.example', role: 'Admin' });
    expect(viaProject.status).toBe(403);
    expect((await request(app).post('/api/users').set('Cookie', owner).set(H).send({ name: 'Second Admin', email: 'admin2@creatign.example', role: 'Admin' })).body.role).toBe('Admin');
  });

  it('keeps mail and portal-link settings for Admins (they decide where reset links go)', async () => {
    expect((await request(app).put('/api/mail-settings').set('Cookie', staff).set(H).send({ host: 'smtp.evil.example' })).status).toBe(403);
    expect((await request(app).post('/api/mail-settings/test').set('Cookie', staff).set(H).send({})).status).toBe(403);
    expect((await request(app).put('/api/portal-settings').set('Cookie', staff).set(H).send({ publicUrl: 'https://evil.example' })).status).toBe(403);
    expect((await request(app).put('/api/portal-settings').set('Cookie', owner).set(H).send({ enabled: true })).status).toBe(200);
  });
});

describe('Timesheet Staff', () => {
  let mine = '';
  let other = '';
  it('only reach the timesheet, their projects and their own time', async () => {
    for (const path of ['/api/docs?kind=invoice', '/api/payments-received', '/api/reports/balance-sheet', '/api/mails', '/api/dashboard', '/api/team', '/api/search?q=a', '/api/budgets'])
      expect([path, (await request(app).get(path).set('Cookie', timesheet)).status]).toEqual([path, 403]);
    expect((await request(app).post('/api/items').set('Cookie', timesheet).set(H).send({ name: 'x' })).status).toBe(403);
    expect((await request(app).post('/api/projects').set('Cookie', timesheet).set(H).send({ name: 'x' })).status).toBe(403);
    const clients = (await request(app).get('/api/contacts?kind=customer').set('Cookie', timesheet)).body as Record<string, unknown>[];
    expect(clients.length).toBeGreaterThan(0);
    expect(clients.every((c) => !('outstanding' in c) && !('email' in c))).toBe(true);
  });

  it('see and log time only on projects they are on, always as themselves', async () => {
    const cus = (await request(app).get('/api/contacts?kind=customer').set('Cookie', owner)).body[0].id;
    const mk = async (name: string) => (await request(app).post('/api/projects').set('Cookie', owner).set(H).send({ name, customerId: cus, billingMethod: 'project_hours', rate: 1000, tasks: [{ id: 'n1', name: 'Build' }] })).body;
    const a = await mk('Timesheet Project');
    const b = await mk('Not Theirs');
    mine = a.id;
    other = b.id;
    expect((await request(app).post(`/api/projects/${mine}/users`).set('Cookie', owner).set(H).send({ userId: timesheetId })).status).toBe(200);
    const list = (await request(app).get('/api/projects').set('Cookie', timesheet)).body as { id: string }[];
    expect(list.map((x) => x.id)).toEqual([mine]);
    expect((await request(app).get(`/api/projects/${other}`).set('Cookie', timesheet)).status).toBe(404);
    expect((await request(app).post('/api/time-entries').set('Cookie', timesheet).set(H).send({ projectId: other, taskId: b.tasks[0].id, hours: '1:00' })).status).toBe(403);
    const e = await request(app).post('/api/time-entries').set('Cookie', timesheet).set(H).send({ projectId: mine, taskId: a.tasks[0].id, hours: '2:00', userId: 'usr_admin' });
    expect(e.status).toBe(200);
    expect(e.body.userId).toBe(timesheetId);
    const theirs = (await request(app).post('/api/time-entries').set('Cookie', owner).set(H).send({ projectId: mine, taskId: a.tasks[0].id, hours: '1:00' })).body;
    expect((await request(app).delete(`/api/time-entries/${theirs.id}`).set('Cookie', timesheet).set(H)).status).toBe(404);
    expect((await request(app).post('/api/time-entries/bulk').set('Cookie', timesheet).set(H).send({ action: 'delete', ids: [theirs.id] })).status).toBe(404);
    const entries = (await request(app).get('/api/time-entries').set('Cookie', timesheet)).body as { userId: string }[];
    expect(entries.length).toBe(1);
    expect(entries.every((x) => x.userId === timesheetId)).toBe(true);
    expect((await request(app).get('/api/users').set('Cookie', timesheet)).body).toHaveLength(1);
  });
});

describe('uploaded files', () => {
  it('download HTML and SVG instead of running them on our site', async () => {
    const up = await request(app).post('/api/uploads').set('Cookie', staff).set(H)
      .attach('files', Buffer.from('<script>alert(1)</script>'), { filename: 'evil.html', contentType: 'text/html' })
      .attach('files', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), { filename: 'evil.svg', contentType: 'image/svg+xml' })
      .attach('files', Buffer.from('%PDF-1.4'), { filename: 'bill.pdf', contentType: 'application/pdf' });
    expect(up.status).toBe(200);
    const [html, svg, pdf] = up.body as { url: string }[];
    for (const f of [html, svg]) {
      const r = await request(app).get(f.url).set('Cookie', owner);
      expect(r.headers['content-disposition']).toBe('attachment');
      expect(r.headers['content-security-policy']).toMatch(/sandbox/);
    }
    const r = await request(app).get(pdf.url).set('Cookie', owner);
    expect(r.headers['content-disposition']).toBeUndefined();
    expect(r.headers['content-security-policy']).toMatch(/sandbox/);
    expect((await request(app).get(pdf.url)).status).toBe(401);
  });
});

describe('comments', () => {
  it('strip every attribute and unknown tag, and credit the signed-in user', async () => {
    const r = await request(app).post('/api/comments').set('Cookie', owner).set(H).send({
      entityType: 'invoice',
      entityId: 'x1',
      html: '<p/onmouseover=alert(1)>hi</p><img src=x onerror=alert(2)><a href="javascript:alert(3)">link</a><b\tonclick=alert(4)>bold</b><svg><script>alert(5)</script></svg><<script>x',
    });
    expect(r.status).toBe(200);
    expect(r.body.html).not.toMatch(/on\w+\s*=|javascript:|<img|<a\b|<svg|<script/i);
    expect(r.body.html).toContain('<p>hi</p>');
    expect(r.body.html).toContain('<b>bold</b>');
    expect(r.body.author).toBe('Owner');
  });

  it('clean comments saved before the fix when they are read', async () => {
    const { getDb } = await import('../server/db');
    getDb().comments.push({ id: 'cmt_old', entityType: 'invoice', entityId: 'x2', html: '<p onclick="alert(1)">old</p>', author: 'x', createdAt: new Date().toISOString() });
    const r = await request(app).get('/api/comments?entityId=x2').set('Cookie', owner);
    expect(r.body[0].html).toBe('<p>old</p>');
  });
});

describe('password reset links and headers', () => {
  it('ignore a forged Origin header', async () => {
    await request(app).post('/api/auth/forgot').set('Origin', 'https://evil.example').send({ email: 'staff@creatign.example' });
    const { getDb } = await import('../server/db');
    const mail = getDb().mails.filter((m) => /reset/i.test(m.subject)).pop()!;
    expect(mail).toBeDefined();
    expect(JSON.stringify(mail)).not.toContain('evil.example');
  });

  it('send safe headers on every response', async () => {
    const r = await request(app).get('/api/auth/status');
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(r.headers['x-frame-options']).toBe('SAMEORIGIN');
  });
});
