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

describe('price lists', () => {
  it('marks every item up or down and rounds', async () => {
    const bad = await api().post('/api/price-lists').send({ name: 'Bad', type: 'percentage', percentage: 0 });
    expect(bad.status).toBe(400);
    const r = await api().post('/api/price-lists').send({ name: 'Partner discount', type: 'percentage', direction: 'markdown', percentage: 10, rounding: 'whole' });
    expect(r.status).toBe(200);
    const d = await api().get(`/api/price-lists/${r.body.id}`);
    expect(d.body.rates.find((x: { itemId: string }) => x.itemId === 'item_web').rate).toBe(40500);
    expect(d.body.rates.find((x: { itemId: string }) => x.itemId === 'item_brochure').rate).toBe(23); // 22.5 rounded
  });

  it('sets custom rates per item and applies them to a client', async () => {
    const r = await api().post('/api/price-lists').send({ name: 'Ananya rates', type: 'per_item', items: [{ itemId: 'item_logo', rate: 6500 }] });
    expect(r.status).toBe(200);
    const c = await api().put('/api/contacts/cus_ananya').send({ priceListId: r.body.id });
    expect(c.status).toBe(200);
    const rates = await api().get('/api/price-lists/for-contact/cus_ananya');
    expect(rates.body.priceList.name).toBe('Ananya rates');
    expect(rates.body.rates.item_logo).toBe(6500);
    expect(rates.body.rates.item_web).toBe(45000); // not on the list: the item's own rate
    expect((await api().put('/api/contacts/cus_ananya').send({ priceListId: 'pl_missing' })).status).toBe(400);
    // deleting the list releases the client
    await api().delete(`/api/price-lists/${r.body.id}`);
    expect((await api().get('/api/contacts/cus_ananya')).body.priceListId).toBeUndefined();
  });
});

describe('stock tracking', () => {
  let itemId = '';
  it('counts opening stock, bills, invoices and adjustments', async () => {
    const it1 = await api().post('/api/items').send({ name: 'Visiting Cards (box)', type: 'goods', unit: 'box', sellingPrice: 400, costPrice: 150, trackInventory: true, openingStock: 20, reorderLevel: 5 });
    expect(it1.status).toBe(200);
    itemId = it1.body.id;
    await api().post('/api/docs').send({ kind: 'bill', mode: 'open', contactId: 'ven_murugan', number: 'SMP-STOCK-1', date: '2026-11-02', lineItems: [{ itemId, name: 'Visiting Cards (box)', quantity: 30, rate: 150 }] });
    await api().post('/api/docs').send({ kind: 'invoice', mode: 'open', contactId: 'cus_test', date: '2026-11-03', lineItems: [{ itemId, name: 'Visiting Cards (box)', quantity: 12, rate: 400 }] });
    // drafts do not move stock
    await api().post('/api/docs').send({ kind: 'invoice', mode: 'draft', contactId: 'cus_test', date: '2026-11-04', lineItems: [{ itemId, name: 'Visiting Cards (box)', quantity: 100, rate: 400 }] });
    let i = await api().get(`/api/items/${itemId}`);
    expect(i.body.stockOnHand).toBe(38);
    const adj = await api().post('/api/inventory-adjustments').send({ date: '2026-11-05', reason: 'Damaged in transit', lines: [{ itemId, quantity: -3 }] });
    expect(adj.status).toBe(200);
    expect(adj.body.number).toMatch(/^ADJ-/);
    i = await api().get(`/api/items/${itemId}`);
    expect(i.body.stockOnHand).toBe(35);
    const list = await api().get('/api/items').query({ status: 'active' });
    expect(list.body.find((x: { id: string }) => x.id === itemId).stockOnHand).toBe(35);
    const history = await api().get(`/api/items/${itemId}/stock`);
    expect(history.body.movements).toHaveLength(3);
    expect(history.body.movements[0].balance).toBe(35);
  });

  it('refuses adjustments for untracked items and empty adjustments', async () => {
    expect((await api().post('/api/inventory-adjustments').send({ reason: 'Count', lines: [{ itemId: 'item_web', quantity: 1 }] })).status).toBe(400);
    expect((await api().post('/api/inventory-adjustments').send({ reason: 'Count', lines: [{ itemId, quantity: 0 }] })).status).toBe(400);
    expect((await api().post('/api/inventory-adjustments').send({ lines: [{ itemId, quantity: 2 }] })).status).toBe(400);
  });

  it('never tracks stock for services', async () => {
    const s = await api().post('/api/items').send({ name: 'Consulting hour', type: 'service', sellingPrice: 2000, costPrice: 0, trackInventory: true });
    expect(s.body.trackInventory).toBe(false);
  });
});

describe('timesheet approvals', () => {
  let prj = '';
  let entry = '';
  it('only invoices approved time once approvals are on', async () => {
    const p = await api().post('/api/projects').send({ name: 'Approval test', customerId: 'cus_test', billingMethod: 'project_hours', rate: 1000 });
    prj = p.body.id;
    await api().put('/api/preferences').send({ timesheetApprovals: true });
    // an Admin's own time is approved straight away
    const mine = await api().post('/api/time-entries').send({ projectId: prj, date: '2026-11-10', hours: '2:00' });
    expect(mine.body.approvalStatus).toBe('approved');
    // someone else's time waits for approval
    const other = await api().post('/api/time-entries').send({ projectId: prj, date: '2026-11-11', hours: '3:00' });
    entry = other.body.id;
    const { getDb } = await import('../server/db');
    getDb().timeEntries.find((t) => t.id === entry)!.approvalStatus = 'pending';
    const u = await api().get(`/api/projects/${prj}/unbilled`);
    expect(u.body.entries.map((t: { id: string }) => t.id)).not.toContain(entry);
    const pending = await api().get('/api/time-entries').query({ approval: 'pending' });
    expect(pending.body.map((t: { id: string }) => t.id)).toEqual([entry]);
  });

  it('rejects with a reason and approves', async () => {
    expect((await api().post('/api/time-entries/review').send({ action: 'reject', ids: [entry] })).status).toBe(400);
    const rj = await api().post('/api/time-entries/review').send({ action: 'reject', ids: [entry], reason: 'Wrong task' });
    expect(rj.status).toBe(200);
    expect((await api().get(`/api/time-entries/${entry}`)).body.rejectionReason).toBe('Wrong task');
    await api().post('/api/time-entries/review').send({ action: 'approve', ids: [entry] });
    const u = await api().get(`/api/projects/${prj}/unbilled`);
    expect(u.body.entries.map((t: { id: string }) => t.id)).toContain(entry);
    await api().put('/api/preferences').send({ timesheetApprovals: false });
  });
});
