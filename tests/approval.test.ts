// Approval workflow: Draft -> Submit for Approval -> Pending Approval -> Approve/Reject -> Approved -> Confirmed/Open.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

process.env.DB_FILE = ':memory:';
process.env.UPLOAD_DIR = '/tmp/creatign-ledger-test-uploads';

let app: Express;
const api = () => request(app);
const line = { name: 'Website Design', quantity: 1, rate: 45000 };
const action = (id: string, a: string, body: object = {}) => api().post(`/api/docs/${id}/actions/${a}`).send(body);
const activity = async (id: string) => ((await api().get('/api/activities').query({ entityId: id })).body as { message: string; detail?: string }[]).map((a) => a.message);

beforeAll(async () => {
  const mod = await import('../server/app');
  const { resetDb } = await import('../server/db');
  resetDb(true);
  mod.boot();
  app = mod.createApp();
});

describe('sales order approval', () => {
  let soId = '';

  it('reports approvals as on for sales orders by default', async () => {
    const r = await api().get('/api/bootstrap');
    expect(r.body.approvals.sales_order).toBe(true);
    expect(r.body.approvals.invoice).toBe(false);
  });

  it('saves a new sales order as a draft', async () => {
    const r = await api().post('/api/docs').send({ kind: 'sales_order', mode: 'draft', contactId: 'cus_ananya', lineItems: [line] });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('draft');
    soId = r.body.id;
  });

  it('cannot be confirmed, emailed or converted before approval', async () => {
    expect((await action(soId, 'confirm')).status).toBe(400);
    expect((await action(soId, 'mark_sent')).status).toBe(400);
    expect((await api().get(`/api/docs/${soId}/convert`).query({ to: 'invoice' })).status).toBe(400);
    const mail = await api().post('/api/mails').send({ to: 'a@b.in', subject: 'SO', entityType: 'sales_order', entityId: soId });
    expect(mail.status).toBe(400);
    expect(mail.body.error).toMatch(/approve/i);
  });

  it('submits for approval, then rejects with a reason', async () => {
    const s = await action(soId, 'submit_for_approval');
    expect(s.body.status).toBe('pending_approval');
    expect((await action(soId, 'submit_for_approval')).status).toBe(400);
    const r = await action(soId, 'reject', { reason: 'Rate too low' });
    expect(r.body.status).toBe('rejected');
    expect(r.body.rejection.reason).toBe('Rate too low');
  });

  it('resubmits by editing a rejected order, then approves and confirms', async () => {
    const e = await api().put(`/api/docs/${soId}`).send({ mode: 'open', lineItems: [{ ...line, rate: 50000 }] });
    expect(e.status).toBe(200);
    expect(e.body.status).toBe('pending_approval');
    const a = await action(soId, 'approve');
    expect(a.body.status).toBe('approved');
    expect(a.body.approvedAt).toBeTruthy();
    expect(a.body.rejection).toBeUndefined();
    const c = await action(soId, 'confirm');
    expect(c.body.status).toBe('confirmed');
  });

  it('logs every approval event in the activity timeline', async () => {
    const msgs = await activity(soId);
    expect(msgs).toEqual(expect.arrayContaining(['Sales Order submitted for approval', 'Sales Order rejected', 'Sales Order approved', 'Sales Order confirm']));
    expect(msgs.filter((m) => m === 'Sales Order submitted for approval')).toHaveLength(2);
  });

  it('lets the approver approve a draft directly', async () => {
    const r = await api().post('/api/docs').send({ kind: 'sales_order', mode: 'draft', contactId: 'cus_ananya', lineItems: [line] });
    const a = await action(r.body.id, 'approve');
    expect(a.body.status).toBe('approved');
  });
});

describe('invoice approval (turned on in preferences)', () => {
  let invId = '';

  it('turns on invoice approvals', async () => {
    await api().put('/api/preferences').send({ approvals: { sales_order: true, invoice: true } });
    const r = await api().get('/api/bootstrap');
    expect(r.body.approvals.invoice).toBe(true);
  });

  it('keeps a pending invoice out of the ledger and receivables', async () => {
    const r = await api().post('/api/docs').send({ kind: 'invoice', mode: 'send', contactId: 'cus_ananya', lineItems: [line] });
    expect(r.body.status).toBe('pending_approval');
    expect(r.body.sentAt).toBeUndefined();
    invId = r.body.id;
    const d = await api().get(`/api/docs/${invId}`);
    expect(d.body.journals).toHaveLength(0);
    const pay = await api().post('/api/payments-received').send({ contactId: 'cus_ananya', amount: 100, depositToAccountId: 'acc_petty_cash', allocations: [{ docId: invId, amount: 100 }] });
    expect(pay.status).toBe(400);
  });

  it('posts the invoice once approved and marked as sent', async () => {
    await action(invId, 'approve');
    let d = await api().get(`/api/docs/${invId}`);
    expect(d.body.status).toBe('approved');
    expect(d.body.journals).toHaveLength(0);
    await action(invId, 'mark_sent');
    d = await api().get(`/api/docs/${invId}`);
    expect(d.body.status).toBe('sent');
    expect(d.body.journals).toHaveLength(1);
  });

  it('skips approval when the module is turned off', async () => {
    await api().put('/api/preferences').send({ approvals: { sales_order: false, invoice: false } });
    const r = await api().post('/api/docs').send({ kind: 'sales_order', mode: 'open', contactId: 'cus_ananya', lineItems: [line] });
    expect(r.body.status).toBe('confirmed');
    const s = await action(r.body.id, 'submit_for_approval');
    expect(s.status).toBe(400);
  });
});
