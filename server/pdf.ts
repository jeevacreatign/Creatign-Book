// Server-side PDFs for email attachments: documents, payment receipts and statements.
// PDFKit's built-in fonts have no ₹ glyph, so amounts are printed as "Rs. 1,00,000.00".
import PDFDocument from 'pdfkit';
import { DOC_META } from '../shared/docmeta';
import { fmtDate } from '../shared/format';
import type { Address, Contact, Organization, PaymentMade, PaymentReceived, TxnDoc } from '../shared/types';
import { getDb } from './db';

const BRAND = '#2554e0';
const INK = '#0f1b2d';
const MUTED = '#64748b';
const LINE = '#e2e8f0';

const rs = (n: number) => 'Rs. ' + new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

function toBuffer(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
}

function addressLines(a?: Address) {
  if (!a) return [];
  return [a.attention, a.street1, a.street2, [a.city, a.pin].filter(Boolean).join(' '), a.state, a.country].filter(Boolean) as string[];
}

function header(doc: PDFKit.PDFDocument, org: Organization, title: string, number?: string) {
  const top = doc.y;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(16).text(org.name, 48, top);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  for (const l of [...addressLines(org.address), org.state && !org.address ? `${org.state}, ${org.country}` : '', org.email, org.gstin ? `GSTIN ${org.gstin}` : ''].filter(Boolean)) doc.text(l, 48);
  const leftBottom = doc.y;
  doc.font('Helvetica-Bold').fontSize(20).fillColor(INK).text(title.toUpperCase(), 300, top, { width: 247, align: 'right' });
  if (number) doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(`# ${number}`, 300, doc.y, { width: 247, align: 'right' });
  doc.y = Math.max(leftBottom, doc.y) + 16;
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor(LINE).stroke();
  doc.y += 14;
}

function kvRight(doc: PDFKit.PDFDocument, rows: [string, string][], y: number) {
  let yy = y;
  for (const [k, v] of rows) {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(k, 330, yy, { width: 110, align: 'right' });
    doc.fillColor(INK).text(v, 445, yy, { width: 102, align: 'right' });
    yy += 15;
  }
  return yy;
}

function party(doc: PDFKit.PDFDocument, label: string, c?: Contact, addr?: Address) {
  const y = doc.y;
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(label, 48, y);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND).text(c?.displayName || '', 48);
  doc.font('Helvetica').fontSize(9).fillColor(INK);
  for (const l of addressLines(addr || c?.billingAddress)) doc.text(l, 48, undefined, { width: 260 });
  return { top: y, bottom: doc.y };
}

type Col = { label: string; x: number; w: number; align?: 'left' | 'right' };

function table(doc: PDFKit.PDFDocument, cols: Col[], rows: string[][]) {
  const drawHead = () => {
    const y = doc.y;
    doc.rect(48, y, 499, 20).fill(INK);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff');
    for (const c of cols) doc.text(c.label, c.x + 4, y + 6, { width: c.w - 8, align: c.align || 'left' });
    doc.y = y + 26;
  };
  drawHead();
  doc.font('Helvetica').fontSize(9).fillColor(INK);
  for (const r of rows) {
    const heights = cols.map((c, i) => doc.heightOfString(r[i] || '', { width: c.w - 8 }));
    const h = Math.max(...heights, 10);
    if (doc.y + h > doc.page.height - 120) {
      doc.addPage();
      drawHead();
      doc.font('Helvetica').fontSize(9).fillColor(INK);
    }
    const y = doc.y;
    cols.forEach((c, i) => doc.text(r[i] || '', c.x + 4, y, { width: c.w - 8, align: c.align || 'left' }));
    doc.y = y + h + 6;
    doc.moveTo(48, doc.y - 3).lineTo(547, doc.y - 3).strokeColor(LINE).stroke();
  }
  doc.y += 6;
}

function notes(doc: PDFKit.PDFDocument, label: string, text?: string) {
  if (!text) return;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(label, 48, doc.y + 6);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(text, 48, undefined, { width: 499 });
}

export function renderDocPdf(d: TxnDoc): Promise<Buffer> {
  const db = getDb();
  const org = db.organization;
  const c = db.contacts.find((x) => x.id === d.contactId);
  const meta = DOC_META[d.kind];
  const title = d.kind === 'invoice' ? 'Tax Invoice' : meta.label;
  return toBuffer((doc) => {
    header(doc, org, title, d.number);
    const p = party(doc, meta.side === 'sales' ? 'Bill To' : 'Vendor', c, d.billingAddress);
    const facts: [string, string][] = [[meta.dateLabel || 'Date', fmtDate(d.date)]];
    if (d.dueDate) facts.push(['Due Date', fmtDate(d.dueDate)]);
    if (d.expiryDate) facts.push(['Expiry Date', fmtDate(d.expiryDate)]);
    if (d.referenceNumber) facts.push(['Reference#', d.referenceNumber]);
    if (d.orderNumber) facts.push(['Order Number', d.orderNumber]);
    const fy = kvRight(doc, facts, p.top);
    doc.y = Math.max(p.bottom, fy) + 16;
    if (d.subject) {
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Subject', 48);
      doc.fillColor(INK).text(d.subject, 48, undefined, { width: 499 });
      doc.y += 8;
    }
    table(
      doc,
      [
        { label: '#', x: 48, w: 28 },
        { label: 'Item & Description', x: 76, w: 241 },
        { label: 'Qty', x: 317, w: 60, align: 'right' },
        { label: 'Rate', x: 377, w: 80, align: 'right' },
        { label: 'Amount', x: 457, w: 90, align: 'right' },
      ],
      d.lineItems.map((l, i) => [String(i + 1), l.description ? `${l.name}\n${l.description}` : l.name, `${l.quantity}${l.unit ? ' ' + l.unit : ''}`, rs(l.rate).replace('Rs. ', ''), rs(l.amount).replace('Rs. ', '')]),
    );
    const totals: [string, string][] = [['Sub Total', rs(d.subTotal)]];
    if (d.discountAmount) totals.push([`Discount (${d.discountPercent}%)`, `(-) ${rs(d.discountAmount)}`]);
    if (d.tdsAmount) totals.push([`TDS (${d.tdsRate}%)`, `(-) ${rs(d.tdsAmount)}`]);
    if (d.tcsAmount) totals.push([`TCS (${d.tcsRate}%)`, rs(d.tcsAmount)]);
    if (d.adjustment) totals.push([d.adjustmentLabel || 'Adjustment', rs(d.adjustment)]);
    let y = kvRight(doc, totals, doc.y);
    doc.moveTo(330, y).lineTo(547, y).strokeColor(LINE).stroke();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('Total', 330, y + 6, { width: 110, align: 'right' }).text(rs(d.total), 445, y + 6, { width: 102, align: 'right' });
    y += 24;
    if (['invoice', 'bill'].includes(d.kind) && d.balance !== d.total) {
      doc.rect(330, y, 217, 20).fill('#f1f5f9');
      doc.fillColor(INK).text('Balance Due', 330, y + 6, { width: 110, align: 'right' }).text(rs(d.balance), 445, y + 6, { width: 102, align: 'right' });
      y += 26;
    }
    doc.y = y + 10;
    notes(doc, meta.side === 'sales' ? 'Notes' : 'Notes', d.customerNotes || d.notes);
    notes(doc, 'Terms & Conditions', d.terms);
  });
}

export function renderPaymentPdf(p: PaymentReceived | PaymentMade, made = false): Promise<Buffer> {
  const db = getDb();
  const org = db.organization;
  const c = db.contacts.find((x) => x.id === p.contactId);
  return toBuffer((doc) => {
    header(doc, org, made ? 'Payment Made' : 'Payment Receipt', p.number);
    const facts: [string, string][] = [
      ['Payment Date', fmtDate(p.date)],
      ['Payment Mode', p.mode],
    ];
    if (p.referenceNumber) facts.push(['Reference#', p.referenceNumber]);
    const pt = party(doc, made ? 'Paid To' : 'Received From', c);
    const fy = kvRight(doc, facts, pt.top);
    doc.y = Math.max(pt.bottom, fy) + 16;
    const y = doc.y;
    doc.rect(48, y, 220, 54).fill(made ? '#ea580c' : '#059669');
    doc.font('Helvetica').fontSize(9).fillColor('#ffffff').text(made ? 'Amount Paid' : 'Amount Received', 60, y + 10);
    doc.font('Helvetica-Bold').fontSize(16).text(rs(p.amount), 60, y + 26);
    doc.y = y + 72;
    const docs = db.docs;
    if (p.allocations.length) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(made ? 'Payment for' : 'Payment for', 48);
      doc.y += 6;
      table(
        doc,
        [
          { label: made ? 'Bill Number' : 'Invoice Number', x: 48, w: 130 },
          { label: made ? 'Bill Date' : 'Invoice Date', x: 178, w: 100 },
          { label: made ? 'Bill Amount' : 'Invoice Amount', x: 278, w: 135, align: 'right' },
          { label: 'Payment Amount', x: 413, w: 134, align: 'right' },
        ],
        p.allocations.map((a) => {
          const d = docs.find((x) => x.id === a.docId);
          return [d?.number || '', fmtDate(d?.date), rs(d?.total || 0), rs(a.amount)];
        }),
      );
    }
    notes(doc, 'Notes', p.notes);
  });
}

export function renderStatementPdf(s: {
  contact: { displayName: string; billingAddress?: Address };
  from: string;
  to: string;
  opening: number;
  invoiced: number;
  paid: number;
  closing: number;
  rows: { date: string; type: string; number: string; details: string; amount: number; payment: number; balance: number }[];
}): Promise<Buffer> {
  const org = getDb().organization;
  return toBuffer((doc) => {
    header(doc, org, 'Statement of Accounts');
    const pt = party(doc, 'To', { displayName: s.contact.displayName, billingAddress: s.contact.billingAddress } as Contact);
    const fy = kvRight(
      doc,
      [
        ['From', fmtDate(s.from)],
        ['To', fmtDate(s.to)],
        ['Opening Balance', rs(s.opening)],
        ['Invoiced Amount', rs(s.invoiced)],
        ['Amount Paid', rs(s.paid)],
        ['Balance Due', rs(s.closing)],
      ],
      pt.top,
    );
    doc.y = Math.max(pt.bottom, fy) + 16;
    table(
      doc,
      [
        { label: 'Date', x: 48, w: 66 },
        { label: 'Transactions', x: 114, w: 90 },
        { label: 'Details', x: 204, w: 113 },
        { label: 'Amount', x: 317, w: 76, align: 'right' },
        { label: 'Payments', x: 393, w: 76, align: 'right' },
        { label: 'Balance', x: 469, w: 78, align: 'right' },
      ],
      [
        [fmtDate(s.from), 'Opening Balance', '', '', '', rs(s.opening).replace('Rs. ', '')],
        ...s.rows.map((r) => [fmtDate(r.date), r.type, [r.number, r.details.replace(/\d{4}-\d{2}-\d{2}/g, (x) => fmtDate(x))].filter(Boolean).join('\n'), r.amount ? rs(r.amount).replace('Rs. ', '') : '', r.payment ? rs(r.payment).replace('Rs. ', '') : '', rs(r.balance).replace('Rs. ', '')]),
      ],
    );
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(`Balance Due   ${rs(s.closing)}`, 48, doc.y, { width: 499, align: 'right' });
  });
}
