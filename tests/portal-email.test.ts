// Client email (templates, outbox, log), shared links and the customer portal.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

process.env.DB_FILE = ':memory:';
process.env.UPLOAD_DIR = '/tmp/creatign-ledger-test-uploads';
process.env.MAIL_TRANSPORT = 'outbox';
process.env.APP_SECRET = 'test-secret';
process.env.APP_ORIGIN = 'http://books.test';

let app: Express;
const api = () => request(app);
const portal = (agent: ReturnType<typeof request.agent>) => ({
  get: (p: string) => agent.get(`/api/portal${p}`),
  post: (p: string, body: unknown = {}) => agent.post(`/api/portal${p}`).set('X-Portal-Request', '1').send(body as object),
  put: (p: string, body: unknown = {}) => agent.put(`/api/portal${p}`).set('X-Portal-Request', '1').send(body as object),
});

let quoteId = '';
let invoiceId = '';

beforeAll(async () => {
  const mod = await import('../server/app');
  const { resetDb } = await import('../server/db');
  resetDb(true);
  mod.boot();
  app = mod.createApp();
  const q = await api().post('/api/docs').send({ kind: 'quote', mode: 'draft', contactId: 'cus_test', expiryDate: '2999-12-31', lineItems: [{ itemId: 'item_logo', name: 'Logo Design', quantity: 1, rate: 15000 }] });
  quoteId = q.body.id;
  const inv = await api().post('/api/docs').send({ kind: 'invoice', mode: 'draft', contactId: 'cus_test', lineItems: [{ itemId: 'item_logo', name: 'Logo Design', quantity: 2, rate: 10000 }] });
  invoiceId = inv.body.id;
});

const lastInviteToken = async () => {
  const { getDb } = await import('../server/db');
  const m = getDb().mails.filter((x) => x.entityType === 'portal_invite').at(-1)!;
  return /\/portal\/invite\/([\w-]+)/.exec(m.body + (m.html || ''))![1];
};

describe('client email', () => {
  it('fills the default template and lists the contact persons as recipients', async () => {
    const r = await api().get('/api/mail/compose').query({ entityType: 'quote', entityId: quoteId });
    expect(r.status).toBe(200);
    expect(r.body.kind).toBe('quote');
    expect(r.body.subject).toMatch(/^Estimate QT-\d+ from Creatign/);
    expect(r.body.body).toContain('Arun Kumar');
    expect(r.body.body).not.toContain('%DocumentNumber%');
    expect(r.body.to).toEqual(['accounts@testcompany.in']);
    expect(r.body.attachments[0]).toMatchObject({ kind: 'pdf', checked: true });
    expect(r.body.linkAvailable).toBe(true);
  });

  it('keeps unsent email in the outbox with the branded HTML, marks the estimate sent and adds a view link', async () => {
    const c = (await api().get('/api/mail/compose').query({ entityType: 'quote', entityId: quoteId })).body;
    const r = await api().post('/api/mails').send({ entityType: 'quote', entityId: quoteId, to: c.to, cc: ['boss@testcompany.in'], bcc: ['archive@creatign.in'], subject: c.subject, body: `${c.body}\n\nLink: %DocumentLink%`, attachPdf: true, includeLink: true, templateId: c.templateId });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('outbox');
    expect(r.body.html).toBeUndefined(); // list rows leave the HTML out
    expect(r.body.bcc).toEqual(['archive@creatign.in']);
    const full = (await api().get(`/api/mails/${r.body.id}`)).body;
    expect(full.html).toContain('View Estimate');
    expect(full.html).toContain('http://books.test/share/');
    expect(full.body).toMatch(/Link: http:\/\/books\.test\/share\/[\w-]+/);
    expect((await api().get(`/api/docs/${quoteId}`)).body.status).toBe('sent');
    const log = (await api().get('/api/mails').query({ entityId: quoteId })).body;
    expect(log).toHaveLength(1);
  });

  it('rejects bad recipients and header injection', async () => {
    expect((await api().post('/api/mails').send({ to: ['a@b.in'], cc: ['nope'], subject: 'x' })).status).toBe(400);
    expect((await api().post('/api/mails').send({ to: ['a@b.in'], subject: 'x\r\nBcc: evil@x.in' })).status).toBe(400);
  });

  it('manages templates: custom template becomes the default, built-ins can be restored but not deleted', async () => {
    const created = await api().post('/api/email-templates').send({ kind: 'invoice', name: 'Friendly invoice', subject: 'Your invoice %DocumentNumber%', body: 'Hi %CustomerName%, total %Total%', isDefault: true });
    expect(created.status).toBe(200);
    const c = (await api().get('/api/mail/compose').query({ entityType: 'invoice', entityId: invoiceId })).body;
    expect(c.templateId).toBe(created.body.id);
    expect(c.body).toBe('Hi Test Company, total ₹20,000.00');
    expect(c.templates.map((t: { id: string }) => t.id)).toContain('etpl_payment_reminder');
    expect((await api().delete('/api/email-templates/etpl_invoice')).status).toBe(400);
    await api().put('/api/email-templates/etpl_invoice').send({ subject: 'Changed' });
    const restored = await api().post('/api/email-templates/etpl_invoice/restore').send({});
    expect(restored.body.subject).toBe('Invoice %DocumentNumber% from %CompanyName%');
    expect((await api().delete(`/api/email-templates/${created.body.id}`)).status).toBe(200);
    expect((await api().get('/api/mail/compose').query({ entityType: 'invoice', entityId: invoiceId })).body.templateId).toBe('etpl_invoice');
  });

  it('saves SMTP settings with the password encrypted', async () => {
    const r = await api().put('/api/mail-settings').send({ enabled: true, host: 'smtp.example.com', port: 587, security: 'starttls', user: 'billing@creatign.in', password: 'app pass word' });
    expect(r.status).toBe(200);
    expect(r.body.smtp.hasPassword).toBe(true);
    expect(r.body.smtp.passEnc).toBeUndefined();
    const { getDb } = await import('../server/db');
    const saved = getDb().preferences.smtp as { passEnc: string };
    expect(saved.passEnc).not.toContain('app');
    const { decryptSecret } = await import('../server/secrets');
    expect(decryptSecret(saved.passEnc)).toBe('apppassword');
    expect(r.body.forcedOutbox).toBe(true);
    await api().put('/api/mail-settings').send({ enabled: false });
  });
});

describe('shared links', () => {
  let token = '';
  it('refuses drafts and shares sent documents without internal fields', async () => {
    expect((await api().post('/api/share-links').send({ entityId: invoiceId })).status).toBe(400);
    await api().post(`/api/docs/${invoiceId}/actions/mark_sent`).send({});
    const { getDb } = await import('../server/db');
    getDb().docs.find((d) => d.id === invoiceId)!.notes = 'internal: chase hard';
    const link = await api().post('/api/share-links').send({ entityId: invoiceId, expiresOn: '2999-01-01' });
    expect(link.status).toBe(200);
    token = link.body.token;
    expect(token.length).toBeGreaterThanOrEqual(40);
    const r = await api().get(`/api/public/share/${token}`);
    expect(r.status).toBe(200);
    expect(r.body.doc.notes).toBeUndefined();
    expect(r.body.doc.contact.bankDetails).toEqual([]);
    expect(r.body.canNotifyPayment).toBe(true);
    expect((await api().get(`/api/docs/${invoiceId}`)).body.viewedAt).toBeTruthy();
    const pdf = await api().get(`/api/public/share/${token}/pdf`);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });

  it('records a payment notice from the link and lets staff record it as a payment', async () => {
    const bad = await api().post(`/api/public/share/${token}/payment-notice`).send({ name: 'Arun', amount: 999999, reference: 'UTR1' });
    expect(bad.status).toBe(400);
    const ok = await api().post(`/api/public/share/${token}/payment-notice`).send({ name: 'Arun', amount: 5000, mode: 'UPI', reference: 'UTR123456', date: '2026-01-05' });
    expect(ok.status).toBe(200);
    const list = (await api().get('/api/payment-notices').query({ invoiceId })).body;
    expect(list[0]).toMatchObject({ status: 'pending', amount: 5000, reference: 'UTR123456' });
    const rec = await api().post(`/api/payment-notices/${list[0].id}/record`).send({ depositToAccountId: 'acc_bank_hdfc' });
    expect(rec.status).toBe(200);
    expect(rec.body.payment.allocations).toEqual([{ docId: invoiceId, amount: 5000 }]);
    expect((await api().get(`/api/docs/${invoiceId}`)).body.balance).toBe(15000);
  });

  it('stops working once disabled', async () => {
    await api().post('/api/share-links/disable-all').send({ entityId: invoiceId });
    expect((await api().get(`/api/public/share/${token}`)).status).toBe(404);
  });
});

describe('client portal', () => {
  const agent = () => request.agent(app);
  let a: ReturnType<typeof agent>;

  it('invites a contact; the invitation email is logged with a working link', async () => {
    const r = await api().post('/api/contacts/cus_test/portal/invite').send({ emails: ['accounts@testcompany.in'] });
    expect(r.status).toBe(200);
    expect(r.body[0].user.status).toBe('invited');
    expect(r.body[0].mailStatus).toBe('outbox');
    expect(r.body[0].inviteUrl).toMatch(/^http:\/\/books\.test\/portal\/invite\//);
    expect((await api().get('/api/contacts/cus_test')).body.portalEnabled).toBe(true);
    // the user record never exposes hashes
    const users = (await api().get('/api/portal-users')).body;
    expect(users[0].passwordHash).toBeUndefined();
    expect(users[0].inviteTokenHash).toBeUndefined();
    // only the customer's own emails can be invited
    expect((await api().post('/api/contacts/cus_test/portal/invite').send({ emails: ['stranger@x.in'] })).status).toBe(400);
  });

  it('accepts the invitation, enforces password rules and signs in', async () => {
    a = agent();
    const token = await lastInviteToken();
    expect((await portal(a).get(`/invite/${token}`)).body.email).toBe('accounts@testcompany.in');
    expect((await portal(a).post(`/invite/${token}`, { password: 'short' })).status).toBe(400);
    const ok = await portal(a).post(`/invite/${token}`, { password: 'Creatign2026', name: 'Arun Kumar' });
    expect(ok.status).toBe(200);
    expect(ok.headers['set-cookie'][0]).toMatch(/cb_portal=.+HttpOnly; SameSite=Lax/);
    expect((await portal(a).get(`/invite/${token}`)).status).toBe(404); // single use
    const me = await portal(a).get('/me');
    expect(me.status).toBe(200);
    expect(me.body.user.name).toBe('Arun Kumar');
    expect(me.body.contact.displayName).toBe('Test Company');
  });

  it('blocks requests without the portal header and without a session', async () => {
    expect((await a.post('/api/portal/logout').send({})).status).toBe(403);
    expect((await portal(agent()).get('/me')).status).toBe(401);
  });

  it('shows only the client’s own sent documents', async () => {
    const draft = await api().post('/api/docs').send({ kind: 'invoice', mode: 'draft', contactId: 'cus_test', lineItems: [{ itemId: 'item_logo', name: 'Logo Design', quantity: 1, rate: 100 }] });
    const docs = (await portal(a).get('/docs')).body as { id: string; kind: string }[];
    expect(docs.some((d) => d.id === quoteId)).toBe(true);
    expect(docs.some((d) => d.id === invoiceId)).toBe(true);
    expect(docs.some((d) => d.id === draft.body.id)).toBe(false);
    expect((await portal(a).get(`/docs/${draft.body.id}`)).status).toBe(404);
    const other = (await api().get('/api/docs').query({ kind: 'invoice' })).body.find((d: { contactId: string }) => d.contactId !== 'cus_test');
    if (other) expect((await portal(a).get(`/docs/${other.id}`)).status).toBe(404);
    const dash = (await portal(a).get('/dashboard')).body;
    expect(dash.summary.outstanding).toBeGreaterThanOrEqual(15000);
    expect((await portal(a).get(`/docs/${invoiceId}/pdf`)).headers['content-type']).toBe('application/pdf');
  });

  it('accepts an estimate from the portal and records who did it', async () => {
    expect((await portal(a).post(`/docs/${quoteId}/respond`, { action: 'decline' })).status).toBe(400); // reason required
    const r = await portal(a).post(`/docs/${quoteId}/respond`, { action: 'accept', comment: 'Go ahead' });
    expect(r.status).toBe(200);
    const q = (await api().get(`/api/docs/${quoteId}`)).body;
    expect(q.status).toBe('accepted');
    expect(q.customerResponse).toMatchObject({ action: 'accepted', by: 'Arun Kumar', via: 'portal', comment: 'Go ahead' });
    expect((await portal(a).post(`/docs/${quoteId}/respond`, { action: 'decline', comment: 'x' })).status).toBe(400);
    const acts = (await api().get('/api/activities').query({ entityId: quoteId })).body;
    expect(acts[0].author).toBe('Arun Kumar');
  });

  it('shows payments with receipts and the statement', async () => {
    const pays = (await portal(a).get('/payments')).body;
    expect(pays).toHaveLength(1);
    expect((await portal(a).get(`/payments/${pays[0].id}/pdf`)).headers['content-type']).toBe('application/pdf');
    const st = await portal(a).get('/statement').query({ from: '2020-01-01', to: '2999-12-31' });
    expect(st.status).toBe(200);
    expect(st.body.rows.some((r: { type: string }) => r.type === 'Client Payment')).toBe(true);
  });

  it('locks out after repeated wrong passwords, and resets the password by email', async () => {
    const { resetRateLimits } = await import('../server/portal');
    for (let i = 0; i < 5; i++) await portal(agent()).post('/login', { email: 'accounts@testcompany.in', password: 'wrong-pass1' });
    expect((await portal(agent()).post('/login', { email: 'accounts@testcompany.in', password: 'Creatign2026' })).status).toBe(429);
    const { getDb } = await import('../server/db');
    getDb().portalUsers[0].lockedUntil = undefined;
    resetRateLimits();
    // unknown emails get the same answer
    expect((await portal(agent()).post('/forgot', { email: 'nobody@x.in' })).status).toBe(200);
    expect((await portal(agent()).post('/forgot', { email: 'accounts@testcompany.in' })).status).toBe(200);
    const reset = getDb().mails.filter((m) => m.entityType === 'portal_reset').at(-1)!;
    const token = /\/portal\/reset\/([\w-]+)/.exec(reset.body + (reset.html || ""))![1];
    const b = agent();
    expect((await portal(b).post(`/reset/${token}`, { password: 'NewPass2027' })).status).toBe(200);
    expect((await portal(a).get('/me')).status).toBe(401); // other sessions signed out
    expect((await portal(agent()).post('/login', { email: 'accounts@testcompany.in', password: 'NewPass2027' })).status).toBe(200);
  });

  it('turning off portal access for the client signs them out', async () => {
    const b = agent();
    await portal(b).post('/login', { email: 'accounts@testcompany.in', password: 'NewPass2027' });
    expect((await portal(b).get('/me')).status).toBe(200);
    await api().post('/api/contacts/cus_test/portal/disable').send({});
    expect((await portal(b).get('/me')).status).toBe(401);
    expect((await portal(agent()).post('/login', { email: 'accounts@testcompany.in', password: 'NewPass2027' })).status).toBe(403);
  });
});
