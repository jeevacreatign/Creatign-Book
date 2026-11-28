import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoClient } from 'mongodb';
import request from 'supertest';
import type { Express } from 'express';
import { connectionSettings } from '../server/mongo';

describe('MongoDB configuration', () => {
  it('uses only MONGODB_URI and trims whitespace', () => {
    expect(connectionSettings({ MONGODB_URI: ' mongodb://localhost:27017/ledger ' })).toEqual({
      uri: 'mongodb://localhost:27017/ledger',
    });
    expect(connectionSettings({ DATABASE_URL: 'mysql://localhost/ledger' })).toBeUndefined();
  });
});

const URI = process.env.MONGODB_TEST_URI;
const TEST_DATABASE = `creatign_ledger_test_${randomUUID().replace(/-/g, '')}`;
delete process.env.DB_FILE;
if (URI) {
  const testUri = new URL(URI);
  testUri.pathname = `/${TEST_DATABASE}`;
  process.env.MONGODB_URI = testUri.toString();
  delete process.env.MONGODB_DATABASE;
}

let app: Express;
let client: MongoClient;

describe.skipIf(!URI)('MongoDB storage', () => {
  beforeAll(async () => {
    client = new MongoClient(process.env.MONGODB_URI!);
    await client.connect();
    const { initDb } = await import('../server/db');
    const mod = await import('../server/app');
    await initDb();
    mod.boot();
    app = mod.createApp();
  });

  afterAll(async () => {
    const { closeDb } = await import('../server/db');
    await closeDb();
    if (client) {
      await client.db(TEST_DATABASE).dropDatabase();
      await client.close();
    }
  });

  it('creates collections and seeds the books', async () => {
    const database = client.db(TEST_DATABASE);
    expect(await database.collection('accounts').countDocuments()).toBeGreaterThan(20);
    const organization = await database.collection<{ _id: string; data: string }>('settings').findOne({ _id: 'organization' });
    expect(organization).not.toBeNull();
    if (!organization) throw new Error('Organization settings were not persisted.');
    expect(JSON.parse(organization.data).name).toBe('Creatign');
  });

  it('persists API changes and round-trips the complete books', async () => {
    const contact = await request(app).post('/api/contacts').send({
      kind: 'customer',
      displayName: 'MongoDB Test Co',
      customerType: 'business',
      placeOfSupply: 'TN',
    });
    expect(contact.status).toBe(200);
    const invoice = await request(app).post('/api/docs').send({
      kind: 'invoice',
      mode: 'open',
      contactId: contact.body.id,
      date: '2026-11-20',
      lineItems: [{ name: 'Consulting', quantity: 2, rate: 5000 }],
    });
    expect(invoice.status).toBe(200);

    const stored = await client.db(TEST_DATABASE).collection<{ _id: string; data: string }>('docs').findOne({ _id: invoice.body.id });
    expect(stored).not.toBeNull();
    if (!stored) throw new Error('Invoice was not persisted.');
    expect(JSON.parse(stored.data)).toMatchObject({ kind: 'invoice', contactId: contact.body.id, total: invoice.body.total });
    const lines = await client.db(TEST_DATABASE).collection<{ debit: number; credit: number }>('journal_lines').find({ source_id: invoice.body.id }).toArray();
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.reduce((sum, line) => sum + line.debit, 0)).toBeCloseTo(lines.reduce((sum, line) => sum + line.credit, 0), 2);

    const { getDb, flushDb } = await import('../server/db');
    const mongo = await import('../server/mongo');
    await flushDb();
    const back = await mongo.loadAll();
    const live = JSON.parse(JSON.stringify(getDb()));
    for (const key of Object.keys(live)) expect(back?.[key as keyof typeof back]).toEqual(live[key]);
  });

  it('loads the books after reconnecting', async () => {
    const { closeDb, getDb, initDb } = await import('../server/db');
    const before = getDb().docs.length;
    await closeDb();
    await initDb();
    expect(getDb().docs.length).toBe(before);
    expect(getDb().contacts.some((item) => item.displayName === 'MongoDB Test Co')).toBe(true);
  });
});
