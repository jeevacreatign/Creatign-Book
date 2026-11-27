import { describe, expect, it } from 'vitest';
import { parseDelimited } from '../shared/bankImport';
import { parseEstimateImport } from '../shared/estimateImport';

describe('estimate CSV imports', () => {
  it('groups Zoho-style line rows and parses amounts, dates and GST', () => {
    const [headers, ...rows] = parseDelimited([
      'Estimate Number,Estimate Date,Customer Name,Item Name,Item Description,Quantity,Rate,Discount %,Tax Name',
      'EST-001,12/04/2025,Test oo1,Website Audit,"Audit, review",2,"1,200.00",10,GST18 [18%]',
      'EST-001,12/04/2025,Test oo1,Support,Monthly support,1,500,0,GST5 [5%]',
    ].join('\n'));

    const result = parseEstimateImport(headers, rows);

    expect(result.errors).toEqual([]);
    expect(result.estimates).toHaveLength(1);
    expect(result.estimates[0]).toMatchObject({
      number: 'EST-001',
      date: '2025-04-12',
      customerName: 'Test oo1',
      lineItems: [
        { itemName: 'Website Audit', description: 'Audit, review', quantity: 2, rate: 1200, discountPercent: 10, taxId: 'gst18' },
        { itemName: 'Support', quantity: 1, rate: 500, taxId: 'gst5' },
      ],
    });
  });

  it('accepts the Quote.csv export headings and keeps Zoho total/status discrepancies visible', () => {
    const [headers, ...rows] = parseDelimited([
      'Quote Date,Quote Number,Quote Status,Expiry Date,Discount Type,Entity Discount Percent,Is Inclusive Tax,Total,Notes,Subject,Customer Name,Project Name,Sales person,Item Name,Item Desc,Quantity,Discount,Discount Amount,Usage unit,Item Price',
      '2026-11-23,Test02,invoiced,2026-11-26,entity_level,1.00,false,97.02,Looking forward for your business.,Test02-quotes,Test oo1,Test Project,Test Sales,Test,"",10.00,0.00,0.0,in,10.00',
    ].join('\n'));

    const result = parseEstimateImport(headers, rows);

    expect(result.errors).toEqual([]);
    expect(result.estimates[0]).toMatchObject({
      number: 'Test02',
      date: '2026-11-23',
      expiryDate: '2026-11-26',
      sourceStatus: 'invoiced',
      sourceTotal: 97.02,
      discountPercent: 1,
      taxInclusive: false,
      customerNotes: 'Looking forward for your business.',
      subject: 'Test02-quotes',
      projectName: 'Test Project',
      salesperson: 'Test Sales',
      lineItems: [{ itemName: 'Test', quantity: 10, rate: 10, unit: 'in' }],
    });
  });

  it('rejects rows without an estimate number and invalid line values', () => {
    const [headers, ...rows] = parseDelimited([
      'Estimate Number,Estimate Date,Customer Name,Item Name,Quantity,Rate,Tax Name',
      ',12/04/2025,Test oo1,Website Audit,1,100,',
      'EST-002,12/04/2025,Test oo1,Website Audit,1,100,Unknown Tax',
    ].join('\n'));

    const result = parseEstimateImport(headers, rows);

    expect(result.errors).toEqual([{ rowNumber: 2, message: 'Estimate Number (or Quote Number) is required' }]);
    expect(result.estimates[0].error).toContain('Unsupported tax "Unknown Tax"');
  });
});
