// Email templates and placeholders (Settings > Emails > Templates).
// Shared by the server (which fills placeholders and renders the branded HTML email)
// and the client (template editor, placeholder picker in the composer).
import type { DocKind } from './types';

export type EmailTemplateKind =
  | 'quote'
  | 'sales_order'
  | 'invoice'
  | 'credit_note'
  | 'payment_reminder'
  | 'payment_received'
  | 'statement'
  | 'purchase_order'
  | 'payment_made'
  | 'portal_invite'
  | 'portal_reset';

export interface EmailTemplate {
  id: string;
  kind: EmailTemplateKind;
  name: string;
  subject: string;
  body: string;
  /** default template for its kind */
  isDefault: boolean;
  /** built-in templates can be edited but not deleted */
  builtIn?: boolean;
  updatedAt?: string;
}

export interface EmailTemplateKindMeta {
  kind: EmailTemplateKind;
  label: string;
  group: 'Sales' | 'Purchases' | 'Client Portal';
  /** placeholder groups that make sense for this kind */
  groups: PlaceholderGroup[];
  /** the email carries a "View" button linking to the online copy */
  link?: boolean;
}

export type PlaceholderGroup = 'contact' | 'organization' | 'document' | 'payment' | 'statement' | 'portal';

export const EMAIL_TEMPLATE_KINDS: EmailTemplateKindMeta[] = [
  { kind: 'quote', label: 'Estimate Notification', group: 'Sales', groups: ['contact', 'organization', 'document'], link: true },
  { kind: 'sales_order', label: 'Sales Order Notification', group: 'Sales', groups: ['contact', 'organization', 'document'], link: true },
  { kind: 'invoice', label: 'Invoice Notification', group: 'Sales', groups: ['contact', 'organization', 'document'], link: true },
  { kind: 'payment_reminder', label: 'Payment Reminder', group: 'Sales', groups: ['contact', 'organization', 'document'], link: true },
  { kind: 'credit_note', label: 'Credit Note Notification', group: 'Sales', groups: ['contact', 'organization', 'document'], link: true },
  { kind: 'payment_received', label: 'Payment Thank-you', group: 'Sales', groups: ['contact', 'organization', 'payment'] },
  { kind: 'statement', label: 'Client Statement', group: 'Sales', groups: ['contact', 'organization', 'statement'] },
  { kind: 'purchase_order', label: 'Purchase Order Notification', group: 'Purchases', groups: ['contact', 'organization', 'document'] },
  { kind: 'payment_made', label: 'Supplier Payment Notification', group: 'Purchases', groups: ['contact', 'organization', 'payment'] },
  { kind: 'portal_invite', label: 'Portal Invitation', group: 'Client Portal', groups: ['contact', 'organization', 'portal'] },
  { kind: 'portal_reset', label: 'Portal Password Reset', group: 'Client Portal', groups: ['contact', 'organization', 'portal'] },
];

export const templateKindMeta = (k: EmailTemplateKind) => EMAIL_TEMPLATE_KINDS.find((x) => x.kind === k)!;

export interface PlaceholderDef {
  key: string;
  label: string;
  group: PlaceholderGroup;
}

export const PLACEHOLDERS: PlaceholderDef[] = [
  { key: 'CustomerName', label: 'Contact display name', group: 'contact' },
  { key: 'ContactPersonName', label: 'Recipient name', group: 'contact' },
  { key: 'ContactEmail', label: 'Contact email', group: 'contact' },
  { key: 'CompanyName', label: 'Your organization name', group: 'organization' },
  { key: 'CompanyEmail', label: 'Your organization email', group: 'organization' },
  { key: 'CompanyPhone', label: 'Your organization phone', group: 'organization' },
  { key: 'CompanyWebsite', label: 'Your organization website', group: 'organization' },
  { key: 'SenderName', label: 'Sender name', group: 'organization' },
  { key: 'DocumentType', label: 'Document type, e.g. Invoice', group: 'document' },
  { key: 'DocumentNumber', label: 'Document number', group: 'document' },
  { key: 'DocumentDate', label: 'Document date', group: 'document' },
  { key: 'DueDate', label: 'Due date', group: 'document' },
  { key: 'ExpiryDate', label: 'Estimate expiry date', group: 'document' },
  { key: 'ReferenceNumber', label: 'Reference number', group: 'document' },
  { key: 'Total', label: 'Total amount', group: 'document' },
  { key: 'BalanceDue', label: 'Balance due', group: 'document' },
  { key: 'CurrencyCode', label: 'Currency code', group: 'document' },
  { key: 'DaysOverdue', label: 'Days overdue', group: 'document' },
  { key: 'DocumentLink', label: 'Link to view online', group: 'document' },
  { key: 'PaymentNumber', label: 'Payment number', group: 'payment' },
  { key: 'PaymentAmount', label: 'Payment amount', group: 'payment' },
  { key: 'PaymentDate', label: 'Payment date', group: 'payment' },
  { key: 'PaymentMode', label: 'Payment mode', group: 'payment' },
  { key: 'PaymentReference', label: 'Payment reference', group: 'payment' },
  { key: 'InvoiceNumbers', label: 'Invoices paid', group: 'payment' },
  { key: 'StatementFrom', label: 'Statement start date', group: 'statement' },
  { key: 'StatementTo', label: 'Statement end date', group: 'statement' },
  { key: 'ClosingBalance', label: 'Balance due on statement', group: 'statement' },
  { key: 'PortalName', label: 'Portal name', group: 'portal' },
  { key: 'PortalLink', label: 'Portal sign-in link', group: 'portal' },
  { key: 'InviteLink', label: 'Invitation link', group: 'portal' },
  { key: 'ResetLink', label: 'Password reset link', group: 'portal' },
  { key: 'LinkExpiry', label: 'When the link expires', group: 'portal' },
];

export const placeholdersFor = (kind: EmailTemplateKind) => {
  const g = templateKindMeta(kind).groups;
  return PLACEHOLDERS.filter((p) => g.includes(p.group));
};

/** Replace %Placeholder% tokens. Unknown tokens are left as they are so typos stay visible. */
export function fillPlaceholders(text: string, values: Record<string, string | undefined>) {
  return text.replace(/%([A-Za-z]+)%/g, (all, key: string) => (values[key] !== undefined ? String(values[key]) : all));
}

/** Template kind used when emailing a transaction of this kind. */
export function templateKindForDoc(kind: DocKind | string, overdue = false): EmailTemplateKind | undefined {
  if (kind === 'invoice') return overdue ? 'payment_reminder' : 'invoice';
  if (kind === 'retainer_invoice') return 'invoice';
  if (kind === 'quote' || kind === 'sales_order' || kind === 'credit_note' || kind === 'purchase_order') return kind;
  if (kind === 'payment_received' || kind === 'payment_made') return kind;
  return undefined;
}

const t = (kind: EmailTemplateKind, subject: string, body: string): EmailTemplate => ({ id: `etpl_${kind}`, kind, name: templateKindMeta(kind).label, subject, body, isDefault: true, builtIn: true });

export function builtInEmailTemplates(): EmailTemplate[] {
  return [
    t(
      'quote',
      'Estimate %DocumentNumber% from %CompanyName%',
      `Dear %ContactPersonName%,

Thank you for your interest. Please find our quote %DocumentNumber% for %Total%, valid until %ExpiryDate%.

You can view the quote online and accept or decline it using the button below. Let us know if you have any questions.

Regards,
%SenderName%
%CompanyName%`,
    ),
    t(
      'sales_order',
      'Sales Order %DocumentNumber% from %CompanyName%',
      `Dear %ContactPersonName%,

Thank you for your order. Sales order %DocumentNumber% for %Total% is attached for your records.

Regards,
%SenderName%
%CompanyName%`,
    ),
    t(
      'invoice',
      'Invoice %DocumentNumber% from %CompanyName%',
      `Dear %ContactPersonName%,

Thank you for your business. Your invoice %DocumentNumber% for %Total% is ready and is due on %DueDate%.

You can view the invoice online, download the PDF and see the payment options using the button below.

Regards,
%SenderName%
%CompanyName%`,
    ),
    t(
      'payment_reminder',
      'Payment reminder: Invoice %DocumentNumber% is overdue',
      `Dear %ContactPersonName%,

This is a friendly reminder that invoice %DocumentNumber% dated %DocumentDate% has a balance of %BalanceDue%, which was due on %DueDate% (%DaysOverdue% days ago).

If you have already paid, please ignore this email or let us know the payment details. Otherwise, we would appreciate payment at your earliest convenience.

Regards,
%SenderName%
%CompanyName%`,
    ),
    t(
      'credit_note',
      'Credit Note %DocumentNumber% from %CompanyName%',
      `Dear %ContactPersonName%,

We have issued credit note %DocumentNumber% for %Total% to your account. The PDF is attached for your records.

Regards,
%SenderName%
%CompanyName%`,
    ),
    t(
      'payment_received',
      'Thank you for your payment - %CompanyName%',
      `Dear %ContactPersonName%,

We have received your payment of %PaymentAmount% on %PaymentDate% via %PaymentMode%. Thank you for your business.

Payment #: %PaymentNumber%
Applied to: %InvoiceNumbers%

Regards,
%SenderName%
%CompanyName%`,
    ),
    t(
      'statement',
      'Account statement from %StatementFrom% to %StatementTo%',
      `Dear %ContactPersonName%,

Please find attached your statement of accounts for %StatementFrom% to %StatementTo%. The balance due as of %StatementTo% is %ClosingBalance%.

Regards,
%SenderName%
%CompanyName%`,
    ),
    t(
      'purchase_order',
      'Purchase Order %DocumentNumber% from %CompanyName%',
      `Dear %ContactPersonName%,

Please find attached purchase order %DocumentNumber% for %Total%. Kindly confirm the order and the expected delivery date.

Regards,
%SenderName%
%CompanyName%`,
    ),
    t(
      'payment_made',
      'Payment of %PaymentAmount% from %CompanyName%',
      `Dear %ContactPersonName%,

We have made a payment of %PaymentAmount% on %PaymentDate% via %PaymentMode% (reference %PaymentReference%) towards %InvoiceNumbers%.

Regards,
%SenderName%
%CompanyName%`,
    ),
    t(
      'portal_invite',
      'You are invited to the %PortalName%',
      `Dear %ContactPersonName%,

%CompanyName% has invited you to the %PortalName%. In the portal you can view and download your quotes, invoices and payment receipts, accept quotes, check your statement and let us know about payments.

Use the button below to set your password and sign in. The invitation link expires on %LinkExpiry%.

Regards,
%CompanyName%`,
    ),
    t(
      'portal_reset',
      'Reset your %PortalName% password',
      `Dear %ContactPersonName%,

We received a request to reset the password for your %PortalName% account. Use the button below to choose a new password. The link expires on %LinkExpiry%.

If you did not request this, you can ignore this email and your password will stay the same.

Regards,
%CompanyName%`,
    ),
  ];
}
