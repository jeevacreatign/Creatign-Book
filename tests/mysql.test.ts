// MySQL storage: tables are created, the books round-trip exactly, only changes are written, and the
// ledger lands in journal_lines. Runs when TEST_DATABASE_URL points at an empty MySQL/MariaDB database.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import mysql from 'mysql2/promise';

const URL = process.env.TEST_DATABASE_URL;
delete process.env.DB_FILE;
if (URL) process.env.DATABASE_URL = URL;

let app: Express;
let sql: mysql.Connection;
const api = () => request(app);

describe.skipIf(!URL)('MySQL storage', () => {
  beforeAll(async () => {
    sql = await mysql.createConnection({ uri: URL!, dateStrings: true, decimalNumbers: true });
    // start from an empty database
    const [tables] = await sql.query('SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
    for (const { t } of tables as { t: string }[]) await sql.query(`DROP TABLE \`${t}\``);
    const { initDb } = await import('../server/db');
    const mod = await import('../server/app');
    await initDb();
    mod.boot();
    app = mod.createApp();
  });
  afterAll(async () => {
    await sql?.end();
    const { closeDb } = await import('../server/db');
    await closeDb();
  });

  const reload = async () => {
    const my = await import('../server/mysql');
    return my.loadAll();
  };

  it('creates the tables and seeds the books', async () => {
    const [rows] = await sql.query('SELECT COUNT(*) AS n FROM accounts');
    expect((rows as { n: number }[])[0].n).toBeGreaterThan(20);
    const [settings] = await sql.query("SELECT data FROM settings WHERE `key` = 'organization'");
    expect(JSON.parse((settings as { data: string }[])[0].data).name).toBe('Creatign');
  });

  it('saves a new invoice before answering, with typed columns and balanced journal lines', async () => {
    const c = await api().post('/api/contacts').send({ kind: 'customer', displayName: 'MySQL Test Co', customerType: 'business', placeOfSupply: 'TN' });
    expect(c.status).toBe(200);
    const inv = await api().post('/api/docs').send({ kind: 'invoice', mode: 'open', contactId: c.body.id, date: '2026-11-20', lineItems: [{ name: 'Consulting', quantity: 2, rate: 5000 }] });
    expect(inv.status).toBe(200);
    const [rows] = await sql.query('SELECT kind, number, contact_id, date, total, balance, status FROM transactions WHERE id = ?', [inv.body.id]);
    expect((rows as Record<string, unknown>[])[0]).toMatchObject({ kind: 'invoice', contact_id: c.body.id, date: '2026-11-20', total: inv.body.total, balance: inv.body.total });
    const [lines] = await sql.query("SELECT SUM(debit) AS d, SUM(credit) AS c FROM journal_lines WHERE source_type = 'invoice' AND source_id = ?", [inv.body.id]);
    const l = (lines as { d: number; c: number }[])[0];
    expect(l.d).toBeGreaterThan(0);
    expect(l.d).toBeCloseTo(l.c, 2);
  });

  it('fills typed columns from the right fields', async () => {
    const inv = (await api().get('/api/docs').query({ kind: 'invoice' })).body[0];
    await api().post(`/api/docs/${inv.id}/actions/mark_sent`).send({});
    const link = await api().post('/api/share-links').send({ entityId: inv.id, expiresOn: '2099-01-31' });
    expect(link.status).toBe(200);
    const [rows] = await sql.query('SELECT expires_at FROM share_links WHERE id = ?', [link.body.id]);
    expect(String((rows as { expires_at: string }[])[0].expires_at)).toMatch(/^2099-01-31/);
    const [acts] = await sql.query('SELECT COUNT(*) AS n, COUNT(`at`) AS dated FROM activities');
    const a = (acts as { n: number; dated: number }[])[0];
    expect(a.n).toBeGreaterThan(0);
    expect(a.dated).toBe(a.n);
  });

  it('backfills typed columns once after an upgrade', async () => {
    await sql.query('UPDATE activities SET `at` = NULL');
    await sql.query('UPDATE schema_info SET version = 1');
    const db = await import('../server/db');
    await db.closeDb();
    await db.initDb();
    const [acts] = await sql.query('SELECT COUNT(*) AS n FROM activities WHERE `at` IS NULL');
    expect((acts as { n: number }[])[0].n).toBe(0);
    const [ver] = await sql.query('SELECT version FROM schema_info');
    expect((ver as { version: number }[])[0].version).toBeGreaterThanOrEqual(2);
  });

  it('round-trips the whole book exactly', async () => {
    const { getDb } = await import('../server/db');
    const back = await reload();
    const live = JSON.parse(JSON.stringify(getDb()));
    for (const k of Object.keys(live)) expect([k, back?.[k as keyof typeof back]]).toEqual([k, live[k]]);
  });

  it('writes only what changed and removes deleted rows', async () => {
    const [before] = await sql.query('SELECT id, updated_at FROM accounts ORDER BY id');
    const item = await api().post('/api/items').send({ name: 'MySQL Widget', type: 'goods', unit: 'nos', sellingPrice: 10, costPrice: 5 });
    expect(item.status).toBe(200);
    const [after] = await sql.query('SELECT id, updated_at FROM accounts ORDER BY id');
    expect(after).toEqual(before);
    expect((await api().delete(`/api/items/${item.body.id}`)).status).toBe(200);
    const [gone] = await sql.query('SELECT COUNT(*) AS n FROM items WHERE id = ?', [item.body.id]);
    expect((gone as { n: number }[])[0].n).toBe(0);
  });

  it('loads the books back after a restart', async () => {
    const { getDb } = await import('../server/db');
    const before = getDb().docs.length;
    const back = await reload();
    expect(back?.docs?.length).toBe(before);
    expect(back?.contacts?.some((c) => c.displayName === 'MySQL Test Co')).toBe(true);
  });
});
