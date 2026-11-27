import { describe, expect, it } from 'vitest';
import { parseDelimited } from '../shared/bankImport';
import { mapContactImportRow } from '../shared/contactImport';

describe('contact CSV imports', () => {
  it('maps Zoho EmailID and MobilePhone columns, including quoted commas', () => {
    const [headers, row] = parseDelimited('Display Name,Company Name,EmailID,MobilePhone\n"Acme, Inc.",Acme,accounts@example.test,\'+91-1234567890');

    expect(mapContactImportRow('customer', headers, row)).toMatchObject({
      kind: 'customer',
      displayName: 'Acme, Inc.',
      companyName: 'Acme',
      email: 'accounts@example.test',
      workPhone: '+91-1234567890',
    });
  });

  it('prefers the standard Email column when both email headers exist', () => {
    expect(mapContactImportRow('vendor', ['Display Name', 'Email', 'EmailID'], ['Supplier', 'sales@example.test', 'old@example.test']).email).toBe('sales@example.test');
  });

  it('maps Zoho customer balances, tax details, addresses, contact person and portal status', () => {
    const [headers, row] = parseDelimited([
      'Contact Name,Company Name,Customer Type,Email,Mobile,Payment Terms,Opening Balance,PAN,GSTIN,GST Treatment,Currency Code,Billing Address,Billing City,Billing State,Billing Country,Billing Code,Contact Person First Name,Contact Person Last Name,Contact Person Email,Portal Status',
      'Test oo1,Test oo1,Business,jee@example.test,+91-9344266751,Due on Receipt,"1,00,000.00",ABCDE1234F,33ABCDE1234F1Z5,Registered Business - Regular,INR- Indian Rupee,"12 Main Road",Chennai,Tamil Nadu,India,600001,Test,oo1,jee@example.test,Enabled',
    ].join('\n'));

    expect(mapContactImportRow('customer', headers, row)).toMatchObject({
      displayName: 'Test oo1',
      companyName: 'Test oo1',
      customerType: 'business',
      email: 'jee@example.test',
      mobile: '+91-9344266751',
      paymentTerms: 'due_on_receipt',
      openingBalance: 100000,
      pan: 'ABCDE1234F',
      gstin: '33ABCDE1234F1Z5',
      gstTreatment: 'registered_business',
      currencyCode: 'INR',
      billingAddress: { street1: '12 Main Road', city: 'Chennai', state: 'Tamil Nadu', country: 'India', pin: '600001' },
      contactPersons: [{ firstName: 'Test', lastName: 'oo1', email: 'jee@example.test' }],
      portalEnabled: true,
    });
  });
});
