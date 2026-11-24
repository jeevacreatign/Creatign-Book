// Documents: inbox uploads, folders, attach / detach, trash, and bank statement import from the inbox.
import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

process.env.DB_FILE = ':memory:';
process.env.UPLOAD_DIR = '/tmp/creatign-books-test-uploads';
fs.mkdirSync(process.env.UPLOAD_DIR, { recursive: true });

let app: Express;
const api = () => request(app);
type Row = { id: string; name: string; status: string; links: { type: string; id: string }[]; folderId?: string; trashedAt?: string; importedToAccountId?: string; kind: string };

beforeAll(async () => {
  const mod = await import('../server/app');
  const { resetDb } = await import('../server/db');
  resetDb(true);
  mod.boot();
  app = mod.createApp();
  for (const [d, amt] of [['2026-11-03', 900], ['2026-11-04', 450]] as const) await api().post('/api/expenses').send({ date: d, accountId: 'acc_printing', amount: amt, paidThroughAccountId: 'acc_petty_cash' });
});

const upload = (name: string, body: string, inbox = 'files', extra: Record<string, string> = {}) => {
  let r = api().post('/api/documents').field('inbox', inbox);
  for (const [k, v] of Object.entries(extra)) r = r.field(k, v);
  return r.attach('files', Buffer.from(body), name);
};

describe('documents', () => {
  it('uploads into the Files inbox and lists it as unassociated', async () => {
    const r = await upload('receipt.pdf', '%PDF-1.4 test');
    expect(r.status).toBe(200);
    const [d] = r.body as Row[];
    expect(d).toMatchObject({ name: 'receipt.pdf', status: 'unassociated', kind: 'inbox' });
    const files = (await api().get('/api/documents').query({ view: 'files' })).body as Row[];
    expect(files.map((x) => x.id)).toContain(d.id);
    const sum = (await api().get('/api/documents/summary')).body;
    expect(sum.files).toBeGreaterThanOrEqual(1);
  });

  it('attaches to an expense, shows the link, and blocks trash until detached', async () => {
    const [d] = (await upload('fuel.png', 'png')).body as Row[];
    const exp = (await api().get('/api/documents/attach-targets').query({ type: 'expense' })).body as { id: string }[];
    expect(exp.length).toBeGreaterThan(0);
    const a = await api().post(`/api/documents/${d.id}/attach`).send({ type: 'expense', id: exp[0].id });
    expect(a.status).toBe(200);
    expect(a.body.status).toBe('associated');
    const e = (await api().get(`/api/expenses/${exp[0].id}`)).body;
    const receipts = (e.expense ?? e).receipts as { id: string }[];
    expect(receipts.some((x) => x.id === d.id)).toBe(true);
    expect((await api().post(`/api/documents/${d.id}/trash`)).status).toBe(400);
    const det = await api().post(`/api/documents/${d.id}/detach`).send({ type: 'expense', id: exp[0].id });
    expect(det.body.status).toBe('unassociated');
    expect((await api().post(`/api/documents/${d.id}/trash`)).status).toBe(200);
    expect(((await api().get('/api/documents').query({ view: 'trash' })).body as Row[]).some((x) => x.id === d.id)).toBe(true);
    expect((await api().post(`/api/documents/${d.id}/restore`)).body.trashedAt).toBeUndefined();
  });

  it('derives links from files picked on a transaction form', async () => {
    const [d] = (await upload('bill-scan.pdf', 'pdf')).body as Row[];
    const exp = (await api().get('/api/documents/attach-targets').query({ type: 'expense' })).body as { id: string }[];
    const { attachTargets } = await import('../server/documents');
    const { getDb } = await import('../server/db');
    expect(attachTargets(getDb(), 'expense').length).toBe(exp.length);
    const e = getDb().expenses.find((x) => x.id === exp[1].id)!;
    e.receipts.push({ id: d.id, name: d.name, size: 3, mimeType: 'application/pdf', url: '/uploads/x.pdf', uploadedAt: new Date().toISOString() });
    const got = (await api().get(`/api/documents/${d.id}`)).body as Row;
    expect(got.links).toEqual([expect.objectContaining({ type: 'expense', id: e.id })]);
    const all = (await api().get('/api/documents').query({ view: 'all' })).body as Row[];
    expect(all.filter((x) => x.id === d.id)).toHaveLength(1); // not listed twice
  });

  it('manages folders, moves, renames and deletes permanently', async () => {
    const f = await api().post('/api/doc-folders').send({ name: 'GST Returns' });
    expect(f.status).toBe(200);
    expect((await api().post('/api/doc-folders').send({ name: 'gst returns' })).status).toBe(400);
    const [d] = (await upload('gstr1.pdf', 'pdf', 'files', { folderId: f.body.id })).body as Row[];
    expect(d.folderId).toBe(f.body.id);
    expect((await api().get('/api/documents').query({ view: 'folder', folderId: f.body.id })).body).toHaveLength(1);
    expect((await api().delete(`/api/doc-folders/${f.body.id}`)).status).toBe(400);
    const ren = await api().put(`/api/documents/${d.id}`).send({ name: 'GSTR-1 Oct' });
    expect(ren.body.name).toBe('GSTR-1 Oct.pdf');
    await api().post('/api/documents-bulk').send({ ids: [d.id], action: 'move' });
    expect((await api().get(`/api/documents/${d.id}`)).body.folderId).toBeUndefined();
    expect((await api().delete(`/api/documents/${d.id}`)).status).toBe(400); // must be in trash first
    await api().post('/api/documents-bulk').send({ ids: [d.id], action: 'trash' });
    expect((await api().delete(`/api/documents/${d.id}`)).status).toBe(200);
    expect((await api().get(`/api/documents/${d.id}`)).status).toBe(404);
    expect((await api().delete(`/api/doc-folders/${f.body.id}`)).status).toBe(200);
  });

  it('imports a statement from the Bank Statements inbox', async () => {
    expect((await upload('scan.pdf', 'x', 'bank_statements')).status).toBe(400);
    const csv = 'Date,Narration,Ref,Withdrawal,Deposit\n20/11/2026,Inbox test one,D1,450.00,\n21/11/2026,Inbox test two,D2,,1200.00\n';
    const [d] = (await upload('hdfc-nov.csv', csv, 'bank_statements')).body as Row[];
    const r = await api().post('/api/banking/accounts/acc_bank_hdfc/import').send({ documentId: d.id, hasHeader: true, dateFormat: 'dd/MM/yyyy', mapping: { date: 0, description: 1, reference: 2, withdrawal: 3, deposit: 4 } });
    expect(r.status).toBe(200);
    expect(r.body.imported).toBe(2);
    const got = (await api().get(`/api/documents/${d.id}`)).body as Row;
    expect(got).toMatchObject({ status: 'imported', importedToAccountId: 'acc_bank_hdfc' });
  });
});
