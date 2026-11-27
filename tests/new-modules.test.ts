// Modules added to close the remaining feature gaps: advance invoices, automatic payment
// reminders, price lists, stock tracking with adjustments, and timesheet approvals.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

process.env.DB_FILE = ':memory:';
process.env.UPLOAD_DIR = '/tmp/creatign-ledger-test-uploads';

let app: Express;
const api = () => request(app);

beforeAll(async () => {
  const mod = await import('../server/app');
  const { resetDb } = await import('../server/db');
  resetDb(true);
  mod.boot();
  app = mod.createApp();
});

async function trialBalance() {
  const r = await api().get('/api/reports/trial-balance').query({ to: '2999-12-31' });
  return r.body as { totalDebit: number; totalCredit: number };
}

describe('advance invoices', () => {
  let adv = '';
  it('creates an advance invoice that never posts to the ledger', async () => {
    const before = await trialBalance();
    const r = await api().post('/api/docs').send({ kind: 'retainer_invoice', mode: 'draft', contactId: 'cus_test', date: '2026-11-20', lineItems: [{ name: 'Mobilisation advance', quantity: 1, rate: 30000 }] });
    expect(r.status).toBe(200);
    expect(r.body.number).toMatch(/^ADV-/);
    expect(r.body.status).toBe('draft');
    adv = r.body.id;
    const after = await trialBalance();
    expect(after.totalDebit).toBe(before.totalDebit);
  });

  it('refuses an advance before the advance invoice is sent', async () => {
    const r = await api().post('/api/payments-received').send({ contactId: 'cus_test', amount: 10000, depositToAccountId: 'acc_petty_cash', retainerInvoiceId: adv });
    expect(r.status).toBe(400);
  });

  it('records advances as client credit and marks the advance invoice paid', async () => {
    await api().post(`/api/docs/${adv}/actions/mark_sent`).send({});
    const p1 = await api().post('/api/payments-received').send({ contactId: 'cus_test', amount: 10000, date: '2026-11-21', depositToAccountId: 'acc_petty_cash', retainerInvoiceId: adv });
    expect(p1.status).toBe(200);
    expect(p1.body.unusedAmount ?? 10000).toBe(10000);
    let d = await api().get(`/api/docs/${adv}`);
    expect(d.body.status).toBe('partially_paid');
    expect(d.body.balance).toBe(20000);
    expect(d.body.related.payments).toHaveLength(1);
    const over = await api().post('/api/payments-received').send({ contactId: 'cus_test', amount: 25000, depositToAccountId: 'acc_petty_cash', retainerInvoiceId: adv });
    expect(over.status).toBe(400);
    const p2 = await api().post('/api/payments-received').send({ contactId: 'cus_test', amount: 20000, depositToAccountId: 'acc_petty_cash', retainerInvoiceId: adv });
    expect(p2.status).toBe(200);
    d = await api().get(`/api/docs/${adv}`);
    expect(d.body.status).toBe('paid');
    const tb = await trialBalance();
    expect(tb.totalDebit).toBeCloseTo(tb.totalCredit, 2);

    // the advance is applied to the final invoice
    const inv = await api().post('/api/docs').send({ kind: 'invoice', mode: 'open', contactId: 'cus_test', date: '2026-11-25', lineItems: [{ itemId: 'item_web', name: 'Website Design', quantity: 1, rate: 45000 }] });
    const applied = await api().post(`/api/payments-received/${p1.body.id}/actions/apply`).send({ allocations: [{ docId: inv.body.id, amount: 10000 }] });
    expect(applied.status).toBe(200);
    const i = await api().get(`/api/docs/${inv.body.id}`);
    expect(i.body.balance).toBe(i.body.total - 10000);
  });

  it('cannot be voided or deleted while advances are recorded', async () => {
    expect((await api().post(`/api/docs/${adv}/actions/void`).send({})).status).toBe(400);
    expect((await api().delete(`/api/docs/${adv}`)).status).toBe(400);
  });
});

describe('automatic payment reminders', () => {
  let inv = '';
  it('is off until an Admin turns it on', async () => {
    const r = await api().get('/api/payment-reminders');
    expect(r.body.settings.enabled).toBe(false);
    expect(r.body.settings.rules.length).toBeGreaterThan(0);
    const created = await api().post('/api/docs').send({ kind: 'invoice', mode: 'open', contactId: 'cus_ananya', date: '2026-10-01', dueDate: '2026-10-31', lineItems: [{ itemId: 'item_logo', name: 'Logo Design', quantity: 1, rate: 8000 }] });
    inv = created.body.id;
    const { runReminders } = await import('../server/reminders');
    expect((await runReminders('2026-11-01')).outbox).toBe(0);
  });

  it('validates and saves the rules', async () => {
    const bad = await api().put('/api/payment-reminders').send({ enabled: true, rules: [{ name: 'x', when: 'after', days: -2, subject: 'S', enabled: true }] });
    expect(bad.status).toBe(400);
    const ok = await api().put('/api/payment-reminders').send({ enabled: true });
    expect(ok.status).toBe(200);
    expect(ok.body.enabled).toBe(true);
    // the general preferences endpoint cannot change them
    await api().put('/api/preferences').send({ paymentReminders: { enabled: false } });
    expect((await api().get('/api/payment-reminders')).body.settings.enabled).toBe(true);
  });

  it('sends each due rule once and only the latest one when several were missed', async () => {
    const { runReminders, dueReminders } = await import('../server/reminders');
    // 8 days after the due date: "1 day after" and "7 days after" are both due; only the 7-day one goes
    const plan = dueReminders('2026-11-08').find((x) => x.invoiceId === inv)!;
    expect(plan.rule.id).toBe('rem_after_7');
    const r = await runReminders('2026-11-08');
    expect(r.outbox + r.sent).toBeGreaterThanOrEqual(1);
    const again = await runReminders('2026-11-08');
    expect(dueReminders('2026-11-08').some((x) => x.invoiceId === inv)).toBe(false);
    expect(again.outbox + again.sent).toBe(0);
    const d = await api().get(`/api/docs/${inv}`);
    const handled = Object.fromEntries(d.body.remindersSent.map((x: { ruleId: string; status: string }) => [x.ruleId, x.status]));
    expect(handled).toMatchObject({ rem_after_1: 'skipped', rem_after_7: 'outbox' });
    const log = await api().get('/api/payment-reminders');
    expect(log.body.log.some((x: { number: string }) => x.number === d.body.number)).toBe(true);
    const mails = await api().get('/api/mails').query({ entityId: inv });
    expect(JSON.stringify(mails.body)).toContain('Second reminder');
  });

  it('skips invoices whose reminders are stopped or that are paid', async () => {
    const { dueReminders } = await import('../server/reminders');
    await api().post(`/api/docs/${inv}/actions/stop_reminders`).send({});
    expect(dueReminders('2026-11-20').some((x) => x.invoiceId === inv)).toBe(false);
  });
});
