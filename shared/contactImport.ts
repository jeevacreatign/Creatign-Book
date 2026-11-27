import type { Address, ContactKind, ContactPerson, PaymentTerms } from './types';
import { GST_TREATMENTS } from './gst';

export function csvField(headers: string[], row: string[], ...names: string[]): string | undefined {
  for (const name of names) {
    const index = headers.findIndex((header) => header.replace(/^\uFEFF/, '').trim().toLowerCase() === name.toLowerCase());
    const value = index >= 0 ? row[index]?.trim() : undefined;
    if (value) return value;
  }
  return undefined;
}

function csvNumber(value: string | undefined, field: string): number | undefined {
  if (!value) return undefined;
  const negative = /^\s*\(.*\)\s*$/.test(value);
  const normalized = value.replace(/[(),\s₹$€£]/g, '');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a number`);
  return negative ? -Math.abs(parsed) : parsed;
}

function paymentTerms(value: string | undefined): PaymentTerms | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ');
  const aliases: Record<string, PaymentTerms> = {
    'due on receipt': 'due_on_receipt',
    '0': 'due_on_receipt',
    'net 15': 'net_15',
    'net 15 days': 'net_15',
    '15': 'net_15',
    '15 days': 'net_15',
    'net 30': 'net_30',
    'net 30 days': 'net_30',
    '30': 'net_30',
    '30 days': 'net_30',
    'net 45': 'net_45',
    'net 45 days': 'net_45',
    '45': 'net_45',
    '45 days': 'net_45',
    'net 60': 'net_60',
    'net 60 days': 'net_60',
    '60': 'net_60',
    '60 days': 'net_60',
    'due end of month': 'due_end_of_month',
    'due end of next month': 'due_end_of_next_month',
  };
  const result = aliases[normalized];
  if (!result) throw new Error(`Unsupported Payment Terms "${value}"`);
  return result;
}

function importAddress(headers: string[], row: string[], prefix: 'Billing' | 'Shipping'): Address | undefined {
  const address: Address = {
    attention: csvField(headers, row, `${prefix} Attention`, `${prefix} Contact`),
    street1: csvField(headers, row, `${prefix} Address`, `${prefix} Street`, `${prefix} Street 1`, `${prefix} Address 1`),
    street2: csvField(headers, row, `${prefix} Address 2`, `${prefix} Street 2`),
    city: csvField(headers, row, `${prefix} City`),
    state: csvField(headers, row, `${prefix} State`, `${prefix} Province`),
    pin: csvField(headers, row, `${prefix} Code`, `${prefix} Zip`, `${prefix} Zip Code`, `${prefix} ZIP Code`, `${prefix} PIN`, `${prefix} Postal Code`),
    country: csvField(headers, row, `${prefix} Country`),
    phone: csvField(headers, row, `${prefix} Phone`, `${prefix} Telephone`),
  };
  return Object.values(address).some(Boolean) ? address : undefined;
}

export function mapContactImportRow(kind: ContactKind, headers: string[], row: string[]) {
  const phone = csvField(headers, row, 'Phone', 'Phone Number', 'Work Phone', 'MobilePhone');
  const mobile = csvField(headers, row, 'Mobile', 'Mobile Phone', 'MobilePhone', 'Mobile No');
  const email = csvField(headers, row, 'Email', 'EmailID', 'Email Address');
  const contactPersonName = csvField(headers, row, 'Contact Person Name', 'Contact Person');
  const personFirstName = csvField(headers, row, 'Contact Person First Name', 'Contact Person 1 First Name', 'Contact Persons First Name', 'Primary Contact First Name', 'First Name')
    ?? contactPersonName?.trim().split(/\s+/)[0];
  const personLastName = csvField(headers, row, 'Contact Person Last Name', 'Contact Person 1 Last Name', 'Contact Persons Last Name', 'Primary Contact Last Name', 'Last Name')
    ?? contactPersonName?.trim().split(/\s+/).slice(1).join(' ');
  const personSalutation = csvField(headers, row, 'Contact Person Salutation', 'Contact Person 1 Salutation', 'Primary Contact Salutation', 'Salutation');
  const personEmail = csvField(headers, row, 'Contact Person Email', 'Contact Person 1 Email', 'Contact Persons Email', 'Primary Contact Email') ?? (contactPersonName ? email : undefined);
  const personPhone = csvField(headers, row, 'Contact Person Phone', 'Contact Person 1 Phone', 'Contact Person Work Phone', 'Primary Contact Phone') ?? (contactPersonName ? phone : undefined);
  const personMobile = csvField(headers, row, 'Contact Person Mobile', 'Contact Person 1 Mobile', 'Contact Persons Mobile', 'Primary Contact Mobile') ?? (contactPersonName ? mobile : undefined);
  const personDesignation = csvField(headers, row, 'Contact Person Designation', 'Contact Person 1 Designation', 'Primary Contact Designation') ?? (contactPersonName ? csvField(headers, row, 'Designation') : undefined);
  const personDepartment = csvField(headers, row, 'Contact Person Department', 'Contact Person 1 Department', 'Primary Contact Department') ?? (contactPersonName ? csvField(headers, row, 'Department') : undefined);
  const contactPersons: Omit<ContactPerson, 'id'>[] = personFirstName || personLastName || personEmail || personPhone || personMobile
    ? [{
        salutation: personSalutation,
        firstName: personFirstName,
        lastName: personLastName,
        email: personEmail,
        workPhone: personPhone?.replace(/^'/, ''),
        mobile: personMobile?.replace(/^'/, ''),
        designation: personDesignation,
        department: personDepartment,
      }]
    : [];
  const customerTypeText = csvField(headers, row, 'Customer Type')?.toLowerCase();
  const customerType = customerTypeText
    ? customerTypeText.includes('individual') ? 'individual' : customerTypeText.includes('business') ? 'business' : undefined
    : undefined;
  if (customerTypeText && !customerType) throw new Error(`Unsupported Customer Type "${customerTypeText}"`);
  const portalText = csvField(headers, row, 'Portal Status', 'Customer Portal Status')?.toLowerCase();
  let portalEnabled: boolean | undefined;
  if (portalText) {
    if (/^(enabled|active|yes|true|1)$/.test(portalText)) portalEnabled = true;
    else if (/^(not enabled|disabled|inactive|no|false|0)$/.test(portalText)) portalEnabled = false;
    else throw new Error(`Unsupported Portal Status "${portalText}"`);
  }
  const statusText = csvField(headers, row, 'Status')?.toLowerCase();
  if (statusText && !['active', 'inactive'].includes(statusText)) throw new Error(`Unsupported Status "${statusText}"`);
  const gstText = csvField(headers, row, 'GST Treatment', 'Tax Treatment');
  const gstTreatment = gstText
    ? GST_TREATMENTS.find((item) => item.value.toLowerCase() === gstText.toLowerCase() || item.label.toLowerCase() === gstText.toLowerCase())?.value
    : undefined;
  if (gstText && !gstTreatment) throw new Error(`Unsupported GST Treatment "${gstText}"`);
  const billingAddress = importAddress(headers, row, 'Billing');
  const shippingAddress = importAddress(headers, row, 'Shipping');
  const openingBalance = csvNumber(csvField(headers, row, 'Opening Balance', 'Opening Balance (BCY)'), 'Opening Balance');
  const contactEmail = csvField(headers, row, 'Email', 'EmailID', 'Email Address') ?? personEmail;
  const companyName = csvField(headers, row, 'Company Name');
  const currencyText = csvField(headers, row, 'Currency Code', 'Default Currency', 'Currency');
  const currencyMatch = currencyText && /^([a-z]{3})(?:$|[\s-])/i.exec(currencyText);
  if (currencyText && !currencyMatch) throw new Error(`Currency must be an ISO currency code, for example INR: "${currencyText}"`);
  return {
    kind,
    displayName: csvField(headers, row, 'Display Name', 'Contact Name', 'Name'),
    companyName,
    customerType,
    salutation: csvField(headers, row, 'Salutation'),
    firstName: csvField(headers, row, 'First Name'),
    lastName: csvField(headers, row, 'Last Name'),
    email: contactEmail,
    workPhone: phone?.replace(/^'/, ''),
    mobile: mobile?.replace(/^'/, ''),
    language: csvField(headers, row, 'Language', 'Customer Language'),
    currencyCode: currencyMatch?.[1].toUpperCase(),
    paymentTerms: paymentTerms(csvField(headers, row, 'Payment Terms', 'Payment Terms Label')),
    openingBalance,
    portalEnabled,
    website: csvField(headers, row, 'Website'),
    pan: csvField(headers, row, 'PAN', 'PAN Number', 'PAN No'),
    gstin: csvField(headers, row, 'GSTIN', 'GSTIN/UIN'),
    gstTreatment,
    placeOfSupply: csvField(headers, row, 'Place of Supply', 'Source of Supply'),
    designation: csvField(headers, row, 'Designation'),
    department: csvField(headers, row, 'Department'),
    remarks: csvField(headers, row, 'Notes', 'Remarks', 'Description'),
    billingAddress,
    shippingAddress,
    contactPersons: contactPersons.length ? contactPersons : undefined,
    status: statusText as 'active' | 'inactive' | undefined,
  };
}
