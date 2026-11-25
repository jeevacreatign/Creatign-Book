// Team sign-up and sign-in: owner setup, protected API, pending approvals, invites, resets and sign-out.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

process.env.DB_FILE = ':memory:';
process.env.AUTH_DISABLED = '0';
process.env.MAIL_TRANSPORT = 'outbox';

let app: Express;
const H = { 'X-CL-Request': '1' };
const cookieOf = (r: request.Response) => String((r.headers['set-cookie'] as unknown as string[] | undefined)?.[0] || '').split(';')[0];
const tokenIn = (text: string, path: string) => text.match(new RegExp(`${path}/([A-Za-z0-9_-]+)`))?.[1];

beforeAll(async () => {
  const mod = await import('../server/app');
  const { resetDb } = await import('../server/db');
  resetDb(true);
  mod.boot();
  app = mod.createApp();
});

describe('sign-up and sign-in', () => {
  let owner = '';

  it('blocks the API until someone signs in, and asks for the owner first', async () => {
    expect((await request(app).get('/api/invoices')).status).toBe(401);
    expect((await request(app).get('/api/bootstrap')).status).toBe(401);
    expect((await request(app).get('/api/auth/status')).body.needsSetup).toBe(true);
  });

  it('makes the first sign-up the Admin, claiming the matching team member', async () => {
    expect((await request(app).post('/api/auth/signup').send({ name: 'Jeeva', email: 'accounts@creatign.example', password: 'short' })).status).toBe(400);
    const r = await request(app).post('/api/auth/signup').send({ name: 'Jeeva V', email: 'Accounts@Creatign.example', password: 'ledger2026' });
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ id: 'usr_admin', role: 'Admin', status: 'active' });
    owner = cookieOf(r);
    expect(owner).toMatch(/^cl_session=/);
    expect((await request(app).get('/api/auth/status')).body.needsSetup).toBe(false);
    const me = await request(app).get('/api/auth/me').set('Cookie', owner);
    expect(me.body.user.email).toBe('accounts@creatign.example');
    expect((await request(app).get('/api/bootstrap').set('Cookie', owner)).status).toBe(200);
    const users = (await request(app).get('/api/users').set('Cookie', owner)).body as Record<string, unknown>[];
    expect(users.every((u) => !('passwordHash' in u))).toBe(true);
  });

  it('needs the request header on changes', async () => {
    expect((await request(app).post('/api/items').set('Cookie', owner).send({ name: 'X', rate: 1 })).status).toBe(403);
    expect((await request(app).post('/api/items').set('Cookie', owner).set(H).send({ name: 'Auth Test Service', type: 'service', unit: 'nos', sellingPrice: 100, costPrice: 50 })).status).toBe(200);
  });

  it('rejects wrong passwords and keeps later sign-ups pending until approved', async () => {
    expect((await request(app).post('/api/auth/signin').send({ email: 'accounts@creatign.example', password: 'wrong1234' })).status).toBe(401);
    const s = await request(app).post('/api/auth/signup').send({ name: 'Kavin R', email: 'kavin@creatign.example', password: 'ledger2026' });
    expect(s.body.status).toBe('pending');
    expect(s.headers['set-cookie']).toBeUndefined();
    expect((await request(app).post('/api/auth/signin').send({ email: 'kavin@creatign.example', password: 'ledger2026' })).status).toBe(403);
    const team = (await request(app).get('/api/team').set('Cookie', owner)).body as { id: string; email: string; status: string }[];
    const kavin = team.find((u) => u.email === 'kavin@creatign.example')!;
    expect(kavin.status).toBe('pending');
    expect((await request(app).post(`/api/team/${kavin.id}/approve`).set('Cookie', owner).set(H)).status).toBe(200);
    const k = await request(app).post('/api/auth/signin').send({ email: 'kavin@creatign.example', password: 'ledger2026' });
    expect(k.status).toBe(200);
    const kc = cookieOf(k);
    // staff can't manage the team
    expect((await request(app).get('/api/team').set('Cookie', kc)).status).toBe(403);
    // turning the account off ends its sessions
    await request(app).post(`/api/team/${kavin.id}/deactivate`).set('Cookie', owner).set(H);
    expect((await request(app).get('/api/auth/me').set('Cookie', kc)).status).toBe(401);
  });

  it('invites a team member who sets a password from the emailed link', async () => {
    const r = await request(app).post('/api/team/invite').set('Cookie', owner).set(H).send({ name: 'Meena K', email: 'meena@creatign.example', role: 'Staff' });
    expect(r.status).toBe(200);
    const token = tokenIn(r.body.inviteUrl, '/invite')!;
    expect((await request(app).get(`/api/auth/invite/${token}`)).body.email).toBe('meena@creatign.example');
    const a = await request(app).post(`/api/auth/invite/${token}`).send({ password: 'meena2026x' });
    expect(a.body.user.status).toBe('active');
    expect((await request(app).post(`/api/auth/invite/${token}`).send({ password: 'meena2026x' })).status).toBe(404);
  });

  it('resets a forgotten password and signs out', async () => {
    expect((await request(app).post('/api/auth/forgot').send({ email: 'nobody@example.com' })).status).toBe(200);
    await request(app).post('/api/auth/forgot').send({ email: 'accounts@creatign.example' });
    const { getDb } = await import('../server/db');
    const mail = getDb().mails.filter((m) => m.entityType === 'staff_account').pop()!;
    const token = tokenIn(mail.body + mail.html, '/reset-password')!;
    expect(token).toBeTruthy();
    const r = await request(app).post(`/api/auth/reset/${token}`).send({ password: 'newpass2026' });
    expect(r.status).toBe(200);
    // the old session was ended by the reset
    expect((await request(app).get('/api/auth/me').set('Cookie', owner)).status).toBe(401);
    const c = cookieOf(r);
    expect((await request(app).get('/api/auth/me').set('Cookie', c)).status).toBe(200);
    await request(app).post('/api/auth/signout').set('Cookie', c);
    expect((await request(app).get('/api/auth/me').set('Cookie', c)).status).toBe(401);
    expect((await request(app).post('/api/auth/signin').send({ email: 'accounts@creatign.example', password: 'newpass2026' })).status).toBe(200);
  });
});
