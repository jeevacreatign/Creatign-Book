// Settings used when the app runs on AWS: RDS connection details, TLS, the owner lock and
// secure cookies behind CloudFront.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { connectionSettings, sslOption } from '../server/mysql';

process.env.DB_FILE = ':memory:';
process.env.AUTH_DISABLED = '0';
process.env.MAIL_TRANSPORT = 'outbox';

describe('database connection settings', () => {
  it('uses DATABASE_URL, or the separate DB_* values that ECS fills from Secrets Manager', () => {
    expect(connectionSettings({ DATABASE_URL: 'mysql://a:b@h/db' })).toEqual({ uri: 'mysql://a:b@h/db' });
    expect(connectionSettings({ DB_HOST: 'ledger.abc.ap-south-1.rds.amazonaws.com', DB_USER: 'ledger', DB_PASSWORD: 'p@ss:/word', DB_NAME: 'creatign_ledger' })).toEqual({
      host: 'ledger.abc.ap-south-1.rds.amazonaws.com',
      port: 3306,
      user: 'ledger',
      password: 'p@ss:/word',
      database: 'creatign_ledger',
    });
    expect(connectionSettings({})).toBeUndefined();
  });

  it('turns on TLS with the Amazon RDS certificates for DATABASE_SSL=rds', () => {
    expect(sslOption(undefined)).toBeUndefined();
    expect(sslOption('false')).toBeUndefined();
    const rds = sslOption('rds') as { ca: string[]; rejectUnauthorized: boolean };
    expect(rds.rejectUnauthorized).toBe(true);
    expect(rds.ca.length).toBeGreaterThan(10);
    expect(sslOption('true')).toEqual({ rejectUnauthorized: true });
  });
});

describe('first sign-up on a public server', () => {
  let app: Express;
  beforeAll(async () => {
    process.env.ADMIN_EMAIL = 'owner@creatign.example';
    const mod = await import('../server/app');
    const { resetDb } = await import('../server/db');
    resetDb(true);
    mod.boot();
    app = mod.createApp();
  });

  it('only lets the ADMIN_EMAIL address claim the Admin account, and marks the cookie Secure behind CloudFront', async () => {
    const stranger = await request(app).post('/api/auth/signup').send({ name: 'Someone', email: 'someone@example.com', password: 'ledger2026' });
    expect(stranger.status).toBe(403);
    expect((await request(app).get('/api/auth/status')).body.needsSetup).toBe(true);

    const owner = await request(app).post('/api/auth/signup').set('CloudFront-Forwarded-Proto', 'https').send({ name: 'Owner', email: 'Owner@Creatign.example', password: 'ledger2026' });
    expect(owner.status).toBe(200);
    expect(owner.body.user).toMatchObject({ id: 'usr_admin', role: 'Admin', email: 'owner@creatign.example' });
    expect(String(owner.headers['set-cookie'])).toMatch(/; Secure/);
    delete process.env.ADMIN_EMAIL;
  });
});

describe('health check', () => {
  it('answers without sign-in for the load balancer', async () => {
    const mod = await import('../server/app');
    const r = await request(mod.createApp()).get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
  });
});
