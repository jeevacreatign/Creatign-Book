// PDF templates: template CRUD, per-module defaults, document template choice, notes / terms
// ("use this in future"), custom fields, organisation logo, and the emailed PDF renderer.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { amountInWords, buildPdfModel, builtInTemplates, normalizeTemplate, resolveTemplate } from '../shared/pdfTemplate';

process.env.DB_FILE = ':memory:';
process.env.UPLOAD_DIR = '/tmp/creatign-books-test-uploads';

let app: Express;
const api = () => request(app);
const line = { name: 'Website Design', description: 'Responsive site', quantity: 2, rate: 45000 };
// 1x1 transparent PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

beforeAll(async () => {
  const mod = await import('../server/app');
  const { resetDb } = await import('../server/db');
  resetDb(true);
  mod.boot();
  app = mod.createApp();
});

describe('template model', () => {
  it('ships six distinct built-in templates', () => {
    const t = builtInTemplates();
    expect(t.map((x) => x.layout)).toEqual(['standard', 'modern', 'classic', 'bold', 'minimal', 'spreadsheet']);
    expect(new Set(t.map((x) => x.font)).size).toBeGreaterThan(3);
  });

  it('fills missing settings and clamps bad values', () => {
    const t = normalizeTemplate({ id: 'x', name: 'X', layout: 'classic', fontSize: 99, margins: { top: -1 } } as never);
    expect(t.font).toBe('source-serif');
    expect(t.fontSize).toBe(14);
    expect(t.margins.top).toBe(0);
    expect(t.table.labels.amount).toBe('Amount');
  });

  it('spells amounts in the Indian numbering system', () => {
    expect(amountInWords(125000.5)).toBe('Indian Rupee One Lakh Twenty-Five Thousand and Fifty Paise Only');
    expect(amountInWords(23456789)).toBe('Indian Rupee Two Crore Thirty-Four Lakh Fifty-Six Thousand Seven Hundred Eighty-Nine Only');
    expect(amountInWords(0)).toBe('Indian Rupee Zero Only');
  });

  it('resolves document choice, then module default, then Standard', () => {
    const list = builtInTemplates();
    expect(resolveTemplate(list, {}, 'invoice').id).toBe('tpl_standard');
    expect(resolveTemplate(list, { defaultTemplates: { invoice: 'tpl_bold' } }, 'invoice').id).toBe('tpl_bold');
    expect(resolveTemplate(list, { defaultTemplates: { invoice: 'tpl_bold' } }, 'invoice', 'tpl_minimal').id).toBe('tpl_minimal');
    expect(resolveTemplate(list, {}, 'invoice', 'tpl_missing').id).toBe('tpl_standard');
  });
});

describe('PDF template API', () => {
  let docId = '';
  let customId = '';

  it('lists templates in bootstrap and on their own', async () => {
    const boot = await api().get('/api/bootstrap');
    expect(boot.body.pdfTemplates).toHaveLength(6);
    const r = await api().get('/api/pdf-templates');
    expect(r.body.find((t: { id: string }) => t.id === 'tpl_modern').layout).toBe('modern');
  });

  it('creates a template from a layout and clones one', async () => {
    const r = await api().post('/api/pdf-templates').send({ name: 'Invoice - Teal', layout: 'modern' });
    expect(r.status).toBe(200);
    expect(r.body.builtIn).toBe(false);
    expect(r.body.layout).toBe('modern');
    customId = r.body.id;
    const c = await api().post('/api/pdf-templates').send({ from: 'tpl_classic' });
    expect(c.body.name).toBe('Classic Template (Copy)');
    expect(c.body.font).toBe('source-serif');
    expect((await api().post('/api/pdf-templates').send({ name: '  ' })).status).toBe(400);
  });

  it('edits a template, merging nested settings', async () => {
    const r = await api()
      .put(`/api/pdf-templates/${customId}`)
      .send({ paperSize: 'A5', theme: 'purple', accentColor: '#6b4c9a', table: { stripes: false, labels: { item: 'Particulars' } }, header: { footerText: 'Thank you' } });
    expect(r.body.paperSize).toBe('A5');
    expect(r.body.table.stripes).toBe(false);
    expect(r.body.table.labels.item).toBe('Particulars');
    expect(r.body.table.labels.qty).toBe('Qty');
    expect(r.body.header.footerText).toBe('Thank you');
    expect(r.body.header.showLogo).toBe(true);
  });

  it('refuses to delete a built-in template', async () => {
    expect((await api().delete('/api/pdf-templates/tpl_standard')).status).toBe(400);
  });

  it('sets the default template of a module', async () => {
    const r = await api().put('/api/pdf-templates/defaults').send({ kind: 'sales_order', templateId: 'tpl_bold' });
    expect(r.body.sales_order).toBe('tpl_bold');
    expect((await api().put('/api/pdf-templates/defaults').send({ kind: 'nope', templateId: 'tpl_bold' })).status).toBe(400);
  });

  it('changes the template of one document', async () => {
    const so = await api().post('/api/docs').send({ kind: 'sales_order', mode: 'draft', contactId: 'cus_test', lineItems: [line] });
    docId = so.body.id;
    const r = await api().patch(`/api/docs/${docId}/print-settings`).send({ templateId: customId });
    expect(r.body.templateId).toBe(customId);
    const acts = (await api().get('/api/activities').query({ entityId: docId })).body as { message: string }[];
    expect(acts.some((a) => a.message === 'PDF template changed to Invoice - Teal')).toBe(true);
  });

  it('updates notes and terms, and saves them as defaults for new documents', async () => {
    const r = await api().patch(`/api/docs/${docId}/print-settings`).send({ notes: 'Thank you!', terms: '1. Goods once sold will not be taken back.', termsDefault: true });
    expect(r.body.customerNotes).toBe('Thank you!');
    expect(r.body.terms).toContain('Goods once sold');
    const boot = await api().get('/api/bootstrap');
    expect(boot.body.preferences.docDefaults.sales_order.terms).toContain('Goods once sold');
    expect(boot.body.preferences.docDefaults.sales_order.notes).toBeUndefined();
  });

  it('carries module terms into a converted document', async () => {
    await api().put('/api/doc-defaults/invoice').send({ terms: 'Pay within 15 days.' });
    const q = await api().post('/api/docs').send({ kind: 'quote', mode: 'draft', contactId: 'cus_test', lineItems: [line], terms: '' });
    const fromQuote = await api().get(`/api/docs/${q.body.id}/convert`).query({ to: 'invoice' });
    expect(fromQuote.body.terms).toBe('Pay within 15 days.');
    const own = await api().post('/api/docs').send({ kind: 'quote', mode: 'draft', contactId: 'cus_test', lineItems: [line], terms: 'Quote terms' });
    expect((await api().get(`/api/docs/${own.body.id}/convert`).query({ to: 'invoice' })).body.terms).toBe('Quote terms');
  });

  it('deleting a template moves its documents back to the module default', async () => {
    await api().delete(`/api/pdf-templates/${customId}`);
    const d = await api().get(`/api/docs/${docId}`);
    expect(d.body.templateId).toBeUndefined();
  });
});

describe('custom fields', () => {
  let fieldId = '';

  it('saves module fields and validates them', async () => {
    expect((await api().put('/api/custom-fields/sales_order').send({ fields: [{ label: '' }] })).status).toBe(400);
    expect((await api().put('/api/custom-fields/sales_order').send({ fields: [{ label: 'Size', dataType: 'dropdown', options: [] }] })).status).toBe(400);
    const r = await api()
      .put('/api/custom-fields/sales_order')
      .send({ fields: [{ label: 'Vehicle Number', dataType: 'text', mandatory: true, showInPdf: true }] });
    expect(r.status).toBe(200);
    fieldId = r.body[0].id;
    expect(fieldId).toMatch(/^cf_/);
  });

  it('enforces mandatory fields and keeps values on the document', async () => {
    const bad = await api().post('/api/docs').send({ kind: 'sales_order', mode: 'draft', contactId: 'cus_test', lineItems: [line] });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('Vehicle Number is required');
    const ok = await api()
      .post('/api/docs')
      .send({ kind: 'sales_order', mode: 'draft', contactId: 'cus_test', lineItems: [line], customFields: { [fieldId]: 'TN 37 AB 1234', junk: 'x' } });
    expect(ok.status).toBe(200);
    expect(ok.body.customFields).toEqual({ [fieldId]: 'TN 37 AB 1234' });
  });

  it('prints fields marked "Show in all PDFs"', async () => {
    const { getDb } = await import('../server/db');
    const db = getDb();
    const d = db.docs.find((x) => x.customFields?.[fieldId])!;
    const t = resolveTemplate(db.pdfTemplates, db.preferences, d.kind);
    const m = buildPdfModel(d, db.organization, undefined, t, db.preferences);
    expect(m.facts).toContainEqual(['Vehicle Number', 'TN 37 AB 1234']);
    await api().put('/api/custom-fields/sales_order').send({ fields: [] });
  });
});

describe('organization logo and PDFs', () => {
  it('accepts an image logo and rejects other data', async () => {
    expect((await api().put('/api/organization').send({ logo: 'data:text/html;base64,PGgxPg==' })).status).toBe(400);
    const r = await api().put('/api/organization').send({ logo: PNG, website: 'www.creatign.in', address: { street1: '21, Gandhi Road', city: 'Coimbatore', state: 'Tamil Nadu', country: 'India' } });
    expect(r.body.logo).toBe(PNG);
    expect(r.body.website).toBe('www.creatign.in');
  });

  it('renders every template as a PDF attachment', async () => {
    const { getDb } = await import('../server/db');
    const { renderDocPdf, renderPaymentPdf } = await import('../server/pdf');
    const db = getDb();
    const d = db.docs.find((x) => x.kind === 'sales_order')!;
    for (const t of db.pdfTemplates) {
      const buf = await renderDocPdf(d, t.id);
      expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(buf.length).toBeGreaterThan(5000);
    }
    const inv = await api().post('/api/docs').send({ kind: 'invoice', mode: 'open', contactId: 'cus_test', lineItems: [line] });
    const pay = await api()
      .post('/api/payments-received')
      .send({ contactId: 'cus_test', date: inv.body.date, amount: 1000, mode: 'Cash', depositToAccountId: 'acc_petty_cash', allocations: [{ docId: inv.body.id, amount: 1000 }] });
    expect(pay.status).toBe(200);
    const receipt = await renderPaymentPdf(db.paymentsReceived.find((p) => p.id === pay.body.id)!);
    expect(receipt.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('shares the document template on public links', async () => {
    const { getDb } = await import('../server/db');
    const d = getDb().docs.find((x) => x.kind === 'sales_order')!;
    const link = await api().post('/api/share-links').send({ entityType: 'sales_order', entityId: d.id, visibility: 'public' });
    const r = await api().get(`/api/public/share/${link.body.token}`);
    expect(r.body.template.id).toBe('tpl_bold');
  });
});
