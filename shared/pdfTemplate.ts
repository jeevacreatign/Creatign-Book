// PDF templates: the settings behind every printed / emailed transaction PDF.
// One template drives both renderers: the React preview (client/src/components/DocumentPreview.tsx,
// also used for browser print) and the PDFKit attachment renderer (server/pdf.ts). Both read the
// same `buildPdfModel()` output so the two always show the same fields, labels and totals.
import { DOC_META } from './docmeta';
import { fmtDate, frequencyLabel, money, num } from './format';
import type { Address, Contact, DocKind, Organization, TxnDoc } from './types';
import { PAYMENT_TERMS } from './types';
import { isIntraState, taxLabel, taxRate } from './gst';

// ------------------------------------------------------------ options

export type PdfLayout = 'standard' | 'modern' | 'classic' | 'bold' | 'minimal' | 'spreadsheet';
export type PaperSize = 'A4' | 'A5' | 'Letter';
export type FontKey = 'inter' | 'roboto' | 'poppins' | 'montserrat' | 'dm-sans' | 'source-serif' | 'playfair';

export const PDF_LAYOUTS: { value: PdfLayout; label: string; blurb: string }[] = [
  { value: 'standard', label: 'Standard', blurb: 'Logo and company on the left, title on the right, filled table header.' },
  { value: 'modern', label: 'Modern', blurb: 'Coloured header band with a summary strip and striped rows.' },
  { value: 'classic', label: 'Classic', blurb: 'Centred serif letterhead with ruled table, a timeless look.' },
  { value: 'bold', label: 'Bold', blurb: 'Accent sidebar, large title and a highlighted amount panel.' },
  { value: 'minimal', label: 'Minimal', blurb: 'Lots of white space, hairline rules and small-caps labels.' },
  { value: 'spreadsheet', label: 'Spreadsheet', blurb: 'Fully bordered grid, ideal for long GST item lists.' },
];

/** Paper sizes in PDF points (1pt = 1/72 inch). */
export const PAPER: Record<PaperSize, { w: number; h: number; label: string }> = {
  A4: { w: 595.28, h: 841.89, label: 'A4' },
  A5: { w: 419.53, h: 595.28, label: 'A5' },
  Letter: { w: 612, h: 792, label: 'Letter' },
};

export const PDF_FONTS: { value: FontKey; label: string; css: string; kind: 'sans' | 'serif' }[] = [
  { value: 'inter', label: 'Inter', css: "'PDF Inter', 'Inter', sans-serif", kind: 'sans' },
  { value: 'roboto', label: 'Roboto', css: "'PDF Roboto', 'Roboto', sans-serif", kind: 'sans' },
  { value: 'poppins', label: 'Poppins', css: "'PDF Poppins', 'Poppins', sans-serif", kind: 'sans' },
  { value: 'montserrat', label: 'Montserrat', css: "'PDF Montserrat', 'Montserrat', sans-serif", kind: 'sans' },
  { value: 'dm-sans', label: 'DM Sans', css: "'PDF DM Sans', 'DM Sans', sans-serif", kind: 'sans' },
  { value: 'source-serif', label: 'Source Serif', css: "'PDF Source Serif', Georgia, serif", kind: 'serif' },
  { value: 'playfair', label: 'Playfair Display', css: "'PDF Playfair', Georgia, serif", kind: 'serif' },
];

export interface ColorTheme {
  key: string;
  label: string;
  /** main accent: table header, title, rules */
  primary: string;
  /** very light tint of the accent: stripes, total panels */
  tint: string;
}

export const COLOR_THEMES: ColorTheme[] = [
  { key: 'creatign', label: 'Creatign Blue', primary: '#2554e0', tint: '#eef3ff' },
  { key: 'blue', label: 'Blue', primary: '#2f6fb5', tint: '#eef5fc' },
  { key: 'green', label: 'Green', primary: '#1f8a4c', tint: '#ecf8f1' },
  { key: 'orange', label: 'Orange', primary: '#e0612b', tint: '#fdf1eb' },
  { key: 'red', label: 'Red', primary: '#b4322e', tint: '#fbeeee' },
  { key: 'teal', label: 'Teal', primary: '#0f6b66', tint: '#e9f5f4' },
  { key: 'purple', label: 'Purple', primary: '#6b4c9a', tint: '#f3eff9' },
  { key: 'light_blue', label: 'Light Blue', primary: '#2b8fd6', tint: '#ecf6fd' },
  { key: 'indigo', label: 'Indigo', primary: '#273c8f', tint: '#eef0fa' },
  { key: 'maroon', label: 'Maroon', primary: '#7d1f3d', tint: '#f8edf1' },
  { key: 'gold', label: 'Gold', primary: '#a8781c', tint: '#faf4e6' },
  { key: 'charcoal', label: 'Charcoal', primary: '#2e3440', tint: '#f2f3f5' },
];

export const themeOf = (key: string) => COLOR_THEMES.find((t) => t.key === key) || COLOR_THEMES[0];

// ------------------------------------------------------------ template shape

export interface PdfTemplate {
  id: string;
  name: string;
  layout: PdfLayout;
  /** shipped with the app; can be edited but not deleted */
  builtIn?: boolean;
  updatedAt?: string;
  // General
  paperSize: PaperSize;
  orientation: 'portrait' | 'landscape';
  /** inches */
  margins: { top: number; bottom: number; left: number; right: number };
  font: FontKey;
  /** base size in pt */
  fontSize: number;
  textColor: string;
  labelColor: string;
  theme: string;
  /** accent colour, set from the theme and adjustable */
  accentColor: string;
  /** light tint of the accent */
  tintColor: string;
  backgroundColor: string;
  /** data: URL */
  backgroundImage?: string;
  header: {
    showLogo: boolean;
    /** logo height in pt */
    logoSize: number;
    showOrgName: boolean;
    showOrgAddress: boolean;
    showOrgContact: boolean;
    showGstin: boolean;
    showTitle: boolean;
    /** '' = the transaction's own title */
    title: string;
    footerText: string;
    showPageNumber: boolean;
  };
  details: {
    billToLabel: string;
    vendorLabel: string;
    showShipTo: boolean;
    shipToLabel: string;
    numberLabel: string;
    showReference: boolean;
    showPaymentTerms: boolean;
    showDueDate: boolean;
    showSalesperson: boolean;
    showSubject: boolean;
    showCustomFields: boolean;
  };
  table: {
    /** '' = accent colour */
    headerBg: string;
    headerText: string;
    stripes: boolean;
    borders: 'rows' | 'grid' | 'none';
    showIndex: boolean;
    showDescription: boolean;
    showUnit: boolean;
    labels: { index: string; item: string; qty: string; rate: string; discount: string; amount: string };
  };
  total: {
    showSubTotal: boolean;
    showAmountInWords: boolean;
    showPaymentMade: boolean;
    showBalanceDue: boolean;
    totalLabel: string;
    balanceLabel: string;
  };
  other: {
    showNotes: boolean;
    notesLabel: string;
    showTerms: boolean;
    termsLabel: string;
    showBankDetails: boolean;
    bankDetails: string;
    showSignature: boolean;
    signatureLabel: string;
  };
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

const BASE: Omit<PdfTemplate, 'id' | 'name' | 'layout'> = {
  paperSize: 'A4',
  orientation: 'portrait',
  margins: { top: 0.6, bottom: 0.6, left: 0.55, right: 0.55 },
  font: 'inter',
  fontSize: 9,
  textColor: '#1f2937',
  labelColor: '#6b7280',
  theme: 'creatign',
  accentColor: '#2554e0',
  tintColor: '#eef3ff',
  backgroundColor: '#ffffff',
  backgroundImage: '',
  header: { showLogo: true, logoSize: 44, showOrgName: true, showOrgAddress: true, showOrgContact: true, showGstin: true, showTitle: true, title: '', footerText: '', showPageNumber: true },
  details: { billToLabel: 'Bill To', vendorLabel: 'Supplier Address', showShipTo: true, shipToLabel: 'Ship To', numberLabel: '#', showReference: true, showPaymentTerms: true, showDueDate: true, showSalesperson: true, showSubject: true, showCustomFields: true },
  table: { headerBg: '', headerText: '#ffffff', stripes: false, borders: 'rows', showIndex: true, showDescription: true, showUnit: true, labels: { index: '#', item: 'Item & Description', qty: 'Qty', rate: 'Rate', discount: 'Discount', amount: 'Amount' } },
  total: { showSubTotal: true, showAmountInWords: true, showPaymentMade: true, showBalanceDue: true, totalLabel: 'Total', balanceLabel: 'Balance Due' },
  other: { showNotes: true, notesLabel: 'Notes', showTerms: true, termsLabel: 'Terms & Conditions', showBankDetails: false, bankDetails: '', showSignature: true, signatureLabel: 'Authorized Signature' },
};

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function merge<T>(base: T, over: unknown): T {
  if (!isObj(over)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    out[k] = isObj(v) && isObj(out[k]) ? merge(out[k], v) : v;
  }
  return out as T;
}

/** Per-layout look: fonts, colours and table style that make each design distinct. */
const LAYOUT_DEFAULTS: Record<PdfLayout, DeepPartial<PdfTemplate>> = {
  standard: {},
  modern: { font: 'poppins', theme: 'teal', accentColor: '#0f6b66', tintColor: '#e9f5f4', table: { stripes: true } },
  classic: { font: 'source-serif', fontSize: 9.5, theme: 'charcoal', accentColor: '#2e3440', tintColor: '#f2f3f5', textColor: '#222222', labelColor: '#5f6368', table: { headerBg: '#ffffff', headerText: '#2e3440', borders: 'rows' } },
  bold: { font: 'montserrat', theme: 'indigo', accentColor: '#273c8f', tintColor: '#eef0fa', table: { stripes: true } },
  minimal: { font: 'dm-sans', theme: 'charcoal', accentColor: '#2e3440', tintColor: '#f4f5f7', labelColor: '#8a8f98', table: { headerBg: '#ffffff', headerText: '#6b7280', borders: 'rows' }, header: { logoSize: 36 } },
  spreadsheet: { font: 'roboto', fontSize: 8.5, theme: 'blue', accentColor: '#2f6fb5', tintColor: '#eef5fc', table: { headerBg: '#eef5fc', headerText: '#1f2937', borders: 'grid' } },
};

export function makeTemplate(layout: PdfLayout, over: DeepPartial<PdfTemplate> & { id: string; name: string }): PdfTemplate {
  return merge(merge({ ...BASE, id: over.id, name: over.name, layout } as PdfTemplate, LAYOUT_DEFAULTS[layout]), over);
}

/** Fill any missing settings (older saved templates, partial API bodies) with the layout defaults. */
export function normalizeTemplate(t: Partial<PdfTemplate> & { id: string }): PdfTemplate {
  const layout = (PDF_LAYOUTS.some((l) => l.value === t.layout) ? t.layout : 'standard') as PdfLayout;
  const out = makeTemplate(layout, { ...(t as DeepPartial<PdfTemplate>), id: t.id, name: t.name || 'Untitled Template' });
  out.fontSize = clamp(Number(out.fontSize) || 9, 6, 14);
  for (const k of ['top', 'bottom', 'left', 'right'] as const) out.margins[k] = clamp(Number(out.margins[k]) || 0, 0, 2);
  out.header.logoSize = clamp(Number(out.header.logoSize) || 44, 16, 120);
  if (!PAPER[out.paperSize]) out.paperSize = 'A4';
  if (!PDF_FONTS.some((f) => f.value === out.font)) out.font = 'inter';
  return out;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export const DEFAULT_TEMPLATE_ID = 'tpl_standard';

export function builtInTemplates(): PdfTemplate[] {
  return [
    makeTemplate('standard', { id: 'tpl_standard', name: 'Standard Template', builtIn: true }),
    makeTemplate('modern', { id: 'tpl_modern', name: 'Modern Template', builtIn: true }),
    makeTemplate('classic', { id: 'tpl_classic', name: 'Classic Template', builtIn: true }),
    makeTemplate('bold', { id: 'tpl_bold', name: 'Bold Template', builtIn: true }),
    makeTemplate('minimal', { id: 'tpl_minimal', name: 'Minimal Template', builtIn: true }),
    makeTemplate('spreadsheet', { id: 'tpl_spreadsheet', name: 'Spreadsheet Template', builtIn: true }),
  ];
}

/** Switch colour theme: accent, tint and the table header colours that follow the theme. */
export function applyTheme(t: PdfTemplate, key: string): PdfTemplate {
  const th = themeOf(key);
  const table = { ...t.table };
  if (t.layout === 'spreadsheet') table.headerBg = th.tint;
  else if (t.layout === 'classic') table.headerText = th.primary;
  else if (!table.headerBg || table.headerBg.toLowerCase() !== '#ffffff') table.headerBg = '';
  return { ...t, theme: th.key, accentColor: th.primary, tintColor: th.tint, table };
}

/** Paper size in points after orientation. */
export function pageSize(t: PdfTemplate) {
  const p = PAPER[t.paperSize] || PAPER.A4;
  return t.orientation === 'landscape' ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
}

/** Template used for a document: its own choice, else the module default, else Standard. */
export function resolveTemplate(templates: PdfTemplate[] | undefined, preferences: Record<string, unknown> | undefined, kind: DocKind | 'payment', templateId?: string): PdfTemplate {
  const list = templates?.length ? templates : builtInTemplates();
  const defaults = (preferences?.defaultTemplates || {}) as Record<string, string>;
  const pick = list.find((t) => t.id === templateId) || list.find((t) => t.id === defaults[kind]) || list.find((t) => t.id === DEFAULT_TEMPLATE_ID) || list[0];
  return normalizeTemplate(pick);
}

// ------------------------------------------------------------ module preferences

export type CustomFieldType = 'text' | 'textarea' | 'number' | 'date' | 'email' | 'url' | 'checkbox' | 'dropdown';

export const CUSTOM_FIELD_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: 'text', label: 'Text Box (Single Line)' },
  { value: 'textarea', label: 'Text Box (Multi-line)' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'email', label: 'Email' },
  { value: 'url', label: 'URL' },
  { value: 'checkbox', label: 'Check Box' },
  { value: 'dropdown', label: 'Dropdown' },
];

export interface CustomFieldDef {
  id: string;
  label: string;
  dataType: CustomFieldType;
  options?: string[];
  defaultValue?: string;
  mandatory: boolean;
  showInPdf: boolean;
  active: boolean;
}

export function customFieldsFor(preferences: Record<string, unknown> | undefined, kind: DocKind): CustomFieldDef[] {
  const all = (preferences?.customFields || {}) as Record<string, CustomFieldDef[]>;
  return all[kind] || [];
}

/** Default customer notes and terms for new transactions of a module ("use this in future"). */
export function docDefaults(preferences: Record<string, unknown> | undefined, kind: DocKind): { notes?: string; terms?: string } {
  const p = (preferences || {}) as Record<string, unknown>;
  const own = ((p.docDefaults || {}) as Record<string, { notes?: string; terms?: string }>)[kind] || {};
  const sales = DOC_META[kind].side === 'sales';
  const legacyNotes = kind === 'quote' ? (p.quoteNotes as string) : sales ? (p.customerNotes as string) : undefined;
  const legacyTerms = kind === 'invoice' ? (p.invoiceTerms as string) : kind === 'quote' ? (p.quoteTerms as string) : undefined;
  return { notes: own.notes ?? legacyNotes, terms: own.terms ?? legacyTerms };
}

// ------------------------------------------------------------ amount in words (Indian system)

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  return [TENS[Math.floor(n / 10)], ONES[n % 10]].filter(Boolean).join('-');
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', r ? twoDigits(r) : ''].filter(Boolean).join(' ');
}

function intWords(n: number): string {
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${intWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (n) parts.push(threeDigits(n));
  return parts.join(' ');
}

/** 125000.5 -> "Indian Rupee One Lakh Twenty-Five Thousand and Fifty Paise Only" */
export function amountInWords(amount: number): string {
  const neg = amount < 0;
  const a = Math.abs(Math.round((amount || 0) * 100));
  const rupees = Math.floor(a / 100);
  const paise = a % 100;
  return `${neg ? 'Minus ' : ''}Indian Rupee ${intWords(rupees)}${paise ? ` and ${twoDigits(paise)} Paise` : ''} Only`;
}

// ------------------------------------------------------------ render model

export interface PdfLine {
  index: number;
  name: string;
  description?: string;
  qty: string;
  unit?: string;
  rate: string;
  discount?: string;
  tax?: string;
  amount: string;
}

export interface PdfTotalRow {
  label: string;
  value: string;
  emphasis?: 'total' | 'balance' | 'negative';
}

export interface PdfColumn {
  key: 'index' | 'item' | 'qty' | 'rate' | 'discount' | 'tax' | 'amount';
  label: string;
  align: 'left' | 'right' | 'center';
  /** share of the table width */
  weight: number;
}

export interface PdfModel {
  title: string;
  number: string;
  numberLabel: string;
  status?: string;
  isVoid: boolean;
  org: { name: string; logo?: string; initial: string; address: string[]; contact: string[]; gstin?: string };
  party: { label: string; name: string; lines: string[] };
  ship?: { label: string; lines: string[] };
  facts: [string, string][];
  subject?: string;
  columns: PdfColumn[];
  lines: PdfLine[];
  totals: PdfTotalRow[];
  totalValue: string;
  /** e.g. "Balance Due" panel */
  highlight: { label: string; value: string };
  amountInWords?: string;
  notes?: { label: string; text: string };
  terms?: { label: string; text: string };
  bank?: string;
  signature?: string;
  footer?: string;
}

export function addressLines(a?: Address, withPhone = false): string[] {
  if (!a) return [];
  return [a.attention, a.street1, a.street2, [a.city, a.pin].filter(Boolean).join(' '), [a.state, a.country].filter(Boolean).join(', '), withPhone ? a.phone : ''].filter(Boolean) as string[];
}

export function orgLines(org: Organization, t: PdfTemplate) {
  const address = t.header.showOrgAddress ? (org.address && Object.values(org.address).some(Boolean) ? addressLines({ ...org.address, state: org.address.state || org.state, country: org.address.country || org.country }) : [[org.state, org.country].filter(Boolean).join(', ')].filter(Boolean)) : [];
  const contact = t.header.showOrgContact ? ([org.phone || org.address?.phone, org.email, org.website].filter(Boolean) as string[]) : [];
  return { name: org.name, logo: t.header.showLogo ? org.logo : undefined, initial: (org.logoText || org.name || 'C')[0].toUpperCase(), address, contact, gstin: t.header.showGstin && org.gstin ? `GSTIN ${org.gstin}` : undefined };
}

export function buildPdfModel(doc: TxnDoc, org: Organization, contact: Contact | undefined, t: PdfTemplate, preferences?: Record<string, unknown>): PdfModel {
  const meta = DOC_META[doc.kind];
  const sales = meta.side === 'sales';
  const kindTitle = doc.kind === 'invoice' ? 'Tax Invoice' : meta.label;
  const title = t.header.title.trim() || kindTitle;
  const facts: [string, string | undefined][] = [
    [meta.dateLabel, fmtDate(doc.date)],
    t.details.showPaymentTerms ? ['Terms', PAYMENT_TERMS.find((x) => x.value === doc.paymentTerms)?.label] : ['', ''],
    t.details.showDueDate ? ['Due Date', fmtDate(doc.dueDate)] : ['', ''],
    ['Expiry Date', fmtDate(doc.expiryDate)],
    ['Expected Shipment Date', fmtDate(doc.expectedShipmentDate)],
    ['Delivery Date', fmtDate(doc.deliveryDate)],
    t.details.showReference ? ['Reference#', doc.referenceNumber] : ['', ''],
    t.details.showReference ? ['Order Number', doc.orderNumber] : ['', ''],
    ['Challan Type', doc.challanType],
    ['Delivery Method', doc.deliveryMethod],
    t.details.showSalesperson ? ['Salesperson', doc.salesperson] : ['', ''],
    ['Project', doc.projectName],
    ['Frequency', doc.repeatEvery ? frequencyLabel(doc.repeatEvery) : undefined],
  ];
  if (t.details.showCustomFields) {
    for (const f of customFieldsFor(preferences, doc.kind)) {
      const v = doc.customFields?.[f.id];
      if (!f.active || !f.showInPdf || v === undefined || v === '') continue;
      facts.push([f.label, f.dataType === 'date' ? fmtDate(v) : f.dataType === 'checkbox' ? (v === 'true' ? 'Yes' : 'No') : v]);
    }
  }
  if (doc.gstin && !sales) facts.push(['Supplier GSTIN', doc.gstin]);
  if (doc.sourceOfSupply && !sales) facts.push(['Source of Supply', doc.sourceOfSupply]);
  if (doc.destinationOfSupply && !sales) facts.push(['Destination of Supply', doc.destinationOfSupply]);
  if (doc.reverseCharge) facts.push(['Reverse Charge', 'Yes']);
  const anyDiscount = doc.lineItems.some((l) => l.discountPercent);
  const anyTax = doc.lineItems.some((l) => l.taxId);
  const L = t.table.labels;
  const columns: PdfColumn[] = [
    ...(t.table.showIndex ? [{ key: 'index', label: L.index, align: 'center', weight: 0.6 } as PdfColumn] : []),
    { key: 'item', label: L.item, align: 'left', weight: 5 },
    { key: 'qty', label: L.qty, align: 'right', weight: 1.3 },
    { key: 'rate', label: L.rate, align: 'right', weight: 1.7 },
    ...(anyDiscount ? [{ key: 'discount', label: L.discount, align: 'right', weight: 1.5 } as PdfColumn] : []),
    ...(anyTax ? [{ key: 'tax', label: 'Tax', align: 'right', weight: 1.6 } as PdfColumn] : []),
    { key: 'amount', label: L.amount, align: 'right', weight: 1.9 },
  ];
  const intra = isIntraState(doc.sourceOfSupply, doc.destinationOfSupply, doc.gstTreatment);
  const lines: PdfLine[] = doc.lineItems.map((l, i) => ({
    index: i + 1,
    name: l.name,
    description: t.table.showDescription ? l.description || undefined : undefined,
    qty: num(l.quantity).replace(/\.00$/, ''),
    unit: t.table.showUnit ? l.unit || undefined : undefined,
    rate: num(l.rate),
    discount: anyDiscount ? (l.discountPercent ? `${l.discountPercent}%` : '0%') : undefined,
    tax: anyTax ? (taxRate(l.taxId)?.kind === 'gst' ? `${taxRate(l.taxId)!.rate}%` : taxLabel(l.taxId, intra) || '-') : undefined,
    amount: num(l.amount),
  }));
  const onTop = doc.taxInclusive || doc.reverseCharge ? 0 : doc.taxAmount || 0;
  const adj = Math.round((doc.total - (doc.subTotal - doc.discountAmount + onTop - doc.tdsAmount + doc.tcsAmount)) * 100) / 100;
  const totals: PdfTotalRow[] = [];
  if (t.total.showSubTotal) totals.push({ label: 'Sub Total', value: num(doc.subTotal) });
  if (doc.discountAmount > 0) totals.push({ label: `Discount (${doc.discountPercent}%)`, value: `(-) ${num(doc.discountAmount)}`, emphasis: 'negative' });
  for (const t of doc.taxBreakdown ?? []) totals.push({ label: `${t.key.replace(/[\d.]+$/, '')}${t.rate} (${t.rate}%)${doc.reverseCharge ? ' (RCM)' : ''}`, value: num(t.amount) });
  if (doc.taxInclusive && doc.taxAmount) totals.push({ label: 'Includes tax of', value: num(doc.taxAmount) });
  if (doc.tdsAmount > 0) totals.push({ label: `TDS (${doc.tdsRate}%)`, value: `(-) ${num(doc.tdsAmount)}`, emphasis: 'negative' });
  if (doc.tcsAmount > 0) totals.push({ label: `TCS (${doc.tcsRate}%)`, value: num(doc.tcsAmount) });
  if (adj !== 0) totals.push({ label: doc.adjustmentLabel || 'Adjustment', value: num(adj) });
  totals.push({ label: t.total.totalLabel || 'Total', value: money(doc.total), emphasis: 'total' });
  const hasBalance = doc.kind === 'invoice' || doc.kind === 'bill';
  const credits = doc.kind === 'credit_note' || doc.kind === 'vendor_credit';
  const paid = doc.amountPaid ?? 0;
  if (hasBalance && t.total.showPaymentMade && paid > 0) totals.push({ label: 'Supplier Payment', value: `(-) ${money(paid)}`, emphasis: 'negative' });
  if (hasBalance && t.total.showBalanceDue) totals.push({ label: t.total.balanceLabel || 'Balance Due', value: money(doc.balance), emphasis: 'balance' });
  if (credits) totals.push({ label: 'Credits Remaining', value: money(doc.balance), emphasis: 'balance' });
  const highlight = hasBalance && t.total.showBalanceDue ? { label: t.total.balanceLabel || 'Balance Due', value: money(doc.balance) } : credits ? { label: 'Credits Remaining', value: money(doc.balance) } : { label: t.total.totalLabel || 'Total', value: money(doc.total) };
  const shipLines = addressLines(doc.shippingAddress);
  // bill notes are internal ("It will not be shown in PDF")
  const notesText = sales ? doc.customerNotes : doc.kind === 'bill' || doc.kind === 'recurring_bill' ? undefined : doc.notes;
  return {
    title,
    number: doc.number || doc.profileName || '',
    numberLabel: t.details.numberLabel,
    status: doc.status,
    isVoid: doc.status === 'void',
    org: orgLines(org, t),
    party: { label: sales ? t.details.billToLabel : t.details.vendorLabel, name: contact?.companyName || contact?.displayName || '', lines: addressLines(doc.billingAddress || contact?.billingAddress) },
    ship:
      sales && t.details.showShipTo && shipLines.length
        ? { label: t.details.shipToLabel, lines: shipLines }
        : doc.kind === 'purchase_order' && t.details.showShipTo
          ? { label: 'Deliver To', lines: doc.deliveryAddressType === 'customer' ? shipLines.length ? shipLines : ['Client address'] : [org.name, ...addressLines(org.address)] }
          : undefined,
    facts: facts.filter(([k, v]) => k && v) as [string, string][],
    subject: t.details.showSubject ? doc.subject || undefined : undefined,
    columns,
    lines,
    totals,
    totalValue: money(doc.total),
    highlight,
    amountInWords: t.total.showAmountInWords ? amountInWords(doc.total) : undefined,
    notes: t.other.showNotes && notesText ? { label: t.other.notesLabel, text: notesText } : undefined,
    terms: t.other.showTerms && doc.terms ? { label: t.other.termsLabel, text: doc.terms } : undefined,
    bank: t.other.showBankDetails && t.other.bankDetails.trim() ? t.other.bankDetails.trim() : undefined,
    signature: t.other.showSignature ? t.other.signatureLabel : undefined,
    footer: t.header.footerText.trim() || undefined,
  };
}

/** Sample document used to preview templates in the template gallery / settings. */
export function sampleDoc(kind: DocKind = 'invoice'): TxnDoc {
  return {
    id: 'sample',
    kind,
    number: `${DOC_META[kind].prefix}00017`,
    contactId: 'sample',
    date: '2026-11-24',
    dueDate: '2026-12-09',
    paymentTerms: 'net_15',
    referenceNumber: 'PO-4471',
    salesperson: 'Jeeva',
    status: 'draft',
    billingAddress: { street1: '34, Riche Street', city: 'Chennai', pin: '600001', state: 'Tamil Nadu', country: 'India' },
    shippingAddress: { street1: '34, Riche Street', city: 'Chennai', pin: '600001', state: 'Tamil Nadu', country: 'India' },
    lineItems: [
      { id: 's1', name: 'Brochure Design', description: 'Single sided, full colour, two revisions', quantity: 1, unit: 'nos', rate: 3000, amount: 3000 },
      { id: 's2', name: 'Website Design - Basic', description: 'Custom theme with 10 hours of marketing support', quantity: 1, unit: 'nos', rate: 25000, amount: 25000 },
      { id: 's3', name: 'Printed Visiting Cards', description: '350gsm matte, box of 100', quantity: 4, unit: 'box', rate: 450, amount: 1800 },
    ],
    subTotal: 29800,
    discountPercent: 0,
    discountAmount: 0,
    tdsRate: 0,
    tdsAmount: 0,
    tcsRate: 0,
    tcsAmount: 0,
    adjustment: 0,
    total: 29800,
    balance: 29800,
    amountPaid: 0,
    customerNotes: 'Thanks for your business.',
    terms: 'Payment is due within 15 days. Please quote the invoice number with your payment.',
    attachments: [],
    createdAt: '2026-11-24T00:00:00.000Z',
    updatedAt: '2026-11-24T00:00:00.000Z',
  } as unknown as TxnDoc;
}

export const INDIAN_STATES = ['Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];

export const INDUSTRIES = ['Agency or Sales House', 'Agriculture', 'Art and Design', 'Automotive', 'Construction', 'Consulting', 'Consumer Packaged Goods', 'Education', 'Engineering', 'Entertainment', 'Financial Services', 'Food Services (Restaurants/Fast Food)', 'Gaming', 'Government', 'Health Care', 'Interior Design', 'Internal', 'Legal', 'Manufacturing', 'Marketing', 'Mining and Logistics', 'Non-Profit', 'Publishing and Web Media', 'Real Estate', 'Retail (E-Commerce and Offline)', 'Services', 'Technology', 'Telecommunications', 'Travel/Hospitality', 'Web Designing', 'Web Development', 'Writers', 'Others'];
