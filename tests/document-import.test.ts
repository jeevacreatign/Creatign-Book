import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { parseDelimited } from '../shared/bankImport';
import { parseDocumentImport } from '../shared/documentImport';

process.env.DB_FILE = ':memory:';
process.env.UPLOAD_DIR = '/tmp/creatign-ledger-document-import-test-uploads';

let app: Express;
const api = () => request(app);

beforeAll(async () => {
  const mod = await import('../server/app');
  const { resetDb } = await import('../server/db');
  resetDb(true);
  mod.boot();
  app = mod.createApp();
});

describe('document CSV imports', () => {
  it('parses Zoho sales order headers and groups line items by order number', () => {
    const [headers, ...rows] = parseDelimited([
      'Sales Order Number,Sales Order Date,Sales Order Status,Customer Name,Reference ID,Item Name,Item Desc,Quantity,Item Price,Usage unit',
      'SO-EXT-10,2026-11-23,draft,Test oo1,PO-100,Hosting,"Monthly, managed",2,500,month',
      'SO-EXT-10,2026-11-23,draft,Test oo1,PO-100,Support,Remote support,1,100,hour',
    ].join('\n'));

    const result = parseDocumentImport('sales_order', headers, rows);

    expect(result.errors).toEqual([]);
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]).toMatchObject({
      number: 'SO-EXT-10',
      date: '2026-11-23',
      customerName: 'Test oo1',
      referenceNumber: 'PO-100',
      sourceStatus: 'draft',
      lineItems: [
        { itemName: 'Hosting', description: 'Monthly, managed', quantity: 2, rate: 500, unit: 'month' },
        { itemName: 'Support', description: 'Remote support', quantity: 1, rate: 100, unit: 'hour' },
      ],
    });
  });

  it('accepts the Sales_Order.csv export field names', () => {
    const [headers, ...rows] = parseDelimited([
      'SalesOrder Number,Order Date,Expected Shipment Date,Status,Customer Name,Reference#,Discount Type,Entity Discount Percent,Is Inclusive Tax,Item Name,Account,Item Desc,QuantityOrdered,Usage unit,Item Price,Project Name,Sales person,Payment Terms Label,Total',
      'Test02,2026-11-23,2026-11-24,invoiced,Test oo1,Test02,entity_level,1.00,false,Test,Sales,,10.00,in,10.00,Test Project,Test Sales,Due on Receipt,97.02',
    ].join('\n'));

    const result = parseDocumentImport('sales_order', headers, rows);

    expect(result.errors).toEqual([]);
    expect(result.documents[0]).toMatchObject({
      number: 'Test02',
      date: '2026-11-23',
      expectedShipmentDate: '2026-11-24',
      referenceNumber: 'Test02',
      sourceStatus: 'invoiced',
      discountPercent: 1,
      taxInclusive: false,
      projectName: 'Test Project',
      salesperson: 'Test Sales',
      paymentTerms: 'due_on_receipt',
      lineItems: [{ itemName: 'Test', quantity: 10, rate: 10, unit: 'in', accountName: 'Sales' }],
    });
  });

  it('accepts the recurring invoice export recurrence columns', () => {
    const [headers, ...rows] = parseDelimited([
      'Recurring Invoice Name,Start Date,End Date,Recurrence Profile Status,Recurrence Frequency,Repeat Every,Customer Name,Item Name,Item Desc,Quantity,Usage unit,Item Price,Account,Total',
      'test02,2026-11-23,2026-11-24,Expired,Weeks,1,Test oo1,Test,,1.00,in,100000.00,Sales,100000.00',
    ].join('\n'));

    const result = parseDocumentImport('recurring_invoice', headers, rows);

    expect(result.errors).toEqual([]);
    expect(result.documents[0]).toMatchObject({
      number: 'test02',
      profileName: 'test02',
      date: '2026-11-23',
      endsOn: '2026-11-24',
      neverExpires: false,
      sourceStatus: 'Expired',
      repeatEvery: { n: 1, unit: 'week' },
      lineItems: [{ itemName: 'Test', quantity: 1, rate: 100000, accountName: 'Sales' }],
    });
  });

  it('accepts the Delivery_Challan.csv date and item quantity headers', () => {
    const [headers, ...rows] = parseDelimited([
      'Challan Date,Delivery Challan Number,Challan Type,Status,Customer Name,Is Inclusive Tax,Item Name,QuantityOrdered,Usage unit,Item Price,Account,Total',
      '2026-11-23,DC-00001,Supply of Liquid Gas,Delivered,Test oo1,false,Test,1.00,in,100000.00,Sales,100000.00',
    ].join('\n'));

    const result = parseDocumentImport('delivery_challan', headers, rows);

    expect(result.errors).toEqual([]);
    expect(result.documents[0]).toMatchObject({
      number: 'DC-00001',
      date: '2026-11-23',
      challanType: 'Supply of Liquid Gas',
      sourceStatus: 'Delivered',
      taxInclusive: false,
      lineItems: [{ itemName: 'Test', quantity: 1, rate: 100000, accountName: 'Sales' }],
    });
  });

  it('imports sales orders as drafts and recurring schedules as stopped', async () => {
    const order = await api().post('/api/docs').send({
      kind: 'sales_order',
      mode: 'draft',
      number: 'SO-IMPORT-10',
      contactId: 'cus_test',
      date: '2026-11-23',
      lineItems: [{ name: 'Imported service', quantity: 1, rate: 100 }],
    });
    expect(order.status).toBe(200);
    expect(order.body.status).toBe('draft');

    const schedule = await api().post('/api/docs').send({
      kind: 'recurring_invoice',
      mode: 'draft',
      number: 'Imported monthly schedule',
      profileName: 'Imported monthly schedule',
      contactId: 'cus_test',
      startOn: '2026-01-01',
      repeatEvery: { n: 1, unit: 'month' },
      neverExpires: true,
      status: 'stopped',
      lineItems: [{ name: 'Imported service', quantity: 1, rate: 100 }],
    });
    expect(schedule.status).toBe(200);
    expect(schedule.body.status).toBe('stopped');

    await api().post('/api/recurring/run').send({});
    const reread = await api().get(`/api/docs/${schedule.body.id}`);
    expect(reread.body.status).toBe('stopped');
    expect(reread.body.lastGeneratedDate).toBeUndefined();
  });
});
