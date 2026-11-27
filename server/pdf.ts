// Server-side PDFs for email attachments: documents, payment receipts and statements.
// Documents are drawn from the same PDF template + render model as the on-screen preview
// (shared/pdfTemplate.ts), so the emailed PDF matches what the user customised.
// Fonts are the TTFs in client/public/fonts (all include the ₹ glyph).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { fmtDate } from '../shared/format';
import { BASE_CURRENCY, fxOf, moneyIn, rateLabel, toBase } from '../shared/currency';
import { addressLines, buildPdfModel, orgLines, pageSize, resolveTemplate, type PdfColumn, type PdfModel, type PdfTemplate } from '../shared/pdfTemplate';
import type { Address, PaymentMade, PaymentReceived, TxnDoc } from '../shared/types';
import { getDb } from './db';

const here = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = process.env.PDF_FONT_DIR || path.resolve(here, '../client/public/fonts');

const PT = 72; // points per inch

type Doc = PDFKit.PDFDocument;

interface Ctx {
  doc: Doc;
  t: PdfTemplate;
  /** content box */
  x: number;
  w: number;
  top: number;
  /** lowest y content may reach on a page (above the footer) */
  limit: number;
  pageW: number;
  pageH: number;
  accent: string;
  tint: string;
  ink: string;
  muted: string;
  line: string;
  base: number;
}

function fontFiles(key: string) {
  const r = path.join(FONT_DIR, `${key}-400.ttf`);
  const b = path.join(FONT_DIR, `${key}-700.ttf`);
  if (fs.existsSync(r) && fs.existsSync(b)) return { r, b };
  return null;
}

function imageBuffer(dataUrl?: string): Buffer | null {
  if (!dataUrl) return null;
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/.exec(dataUrl);
  if (!m) return null; // PDFKit draws PNG and JPEG only
  try {
    return Buffer.from(m[2], 'base64');
  } catch {
    return null;
  }
}

/** Mix a hex colour with white: amount 0 = colour, 1 = white. */
function lighten(hex: string, amount: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (s: number) => Math.round(((n >> s) & 255) + (255 - ((n >> s) & 255)) * amount);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

function create(t: PdfTemplate, build: (c: Ctx) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const size = pageSize(t);
    const margins = { top: t.margins.top * PT, bottom: t.margins.bottom * PT, left: t.margins.left * PT, right: t.margins.right * PT };
    const doc = new PDFDocument({ size: [size.w, size.h], margins, bufferPages: true, info: { Title: t.name, Producer: 'Creatign Ledger' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const files = fontFiles(t.font) || fontFiles('inter');
    if (files) {
      doc.registerFont('R', files.r);
      doc.registerFont('B', files.b);
    } else {
      doc.registerFont('R', 'Helvetica');
      doc.registerFont('B', 'Helvetica-Bold');
    }
    const footerReserve = t.header.footerText || t.header.showPageNumber ? 22 : 0;
    const c: Ctx = {
      doc,
      t,
      x: margins.left,
      w: size.w - margins.left - margins.right,
      top: margins.top,
      limit: size.h - margins.bottom - footerReserve,
      pageW: size.w,
      pageH: size.h,
      accent: t.accentColor,
      tint: t.tintColor,
      ink: t.textColor,
      muted: t.labelColor,
      line: '#e3e6eb',
      base: t.fontSize,
    };
    const bg = imageBuffer(t.backgroundImage);
    const paintPage = () => {
      if (t.backgroundColor && t.backgroundColor.toLowerCase() !== '#ffffff') doc.save().rect(0, 0, size.w, size.h).fill(t.backgroundColor).restore();
      if (bg) {
        try {
          doc.image(bg, 0, 0, { width: size.w, height: size.h });
        } catch {
          /* unsupported image */
        }
      }
      if (t.layout === 'bold') doc.save().rect(0, 0, 10, size.h).fill(c.accent).restore();
      doc.x = c.x;
      doc.y = c.top;
    };
    doc.on('pageAdded', paintPage);
    paintPage();
    build(c);
    footer(c);
    doc.end();
  });
}

function footer(c: Ctx) {
  const { doc, t } = c;
  const range = doc.bufferedPageRange();
  if (!t.header.footerText && !t.header.showPageNumber) return;
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const y = c.pageH - t.margins.bottom * PT - 12;
    const saved = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.save().moveTo(c.x, y - 6).lineTo(c.x + c.w, y - 6).lineWidth(0.5).strokeColor(c.line).stroke().restore();
    doc.font('R').fontSize(c.base - 1.5).fillColor(c.muted);
    if (t.header.footerText) doc.text(t.header.footerText, c.x, y, { width: c.w * 0.75, lineBreak: false, ellipsis: true });
    if (t.header.showPageNumber) doc.text(`Page ${i - range.start + 1} of ${range.count}`, c.x + c.w * 0.6, y, { width: c.w * 0.4, align: 'right', lineBreak: false });
    doc.page.margins.bottom = saved;
  }
}

function ensure(c: Ctx, h: number) {
  if (c.doc.y + h > c.limit) {
    c.doc.addPage();
    return true;
  }
  return false;
}

// ------------------------------------------------------------ header

type OrgBlock = PdfModel['org'];

function logo(c: Ctx, org: OrgBlock, x: number, y: number, size: number, opts: { invert?: boolean; align?: 'left' | 'right' | 'center' } = {}) {
  const { doc } = c;
  const img = imageBuffer(org.logo);
  if (img) {
    try {
      const maxW = size * 3;
      const ix = opts.align === 'right' ? x - maxW : opts.align === 'center' ? x - maxW / 2 : x;
      doc.image(img, ix, y, { fit: [maxW, size], ...(opts.align === 'right' || opts.align === 'center' ? { align: opts.align } : {}) });
      return size;
    } catch {
      /* fall through to the initial badge */
    }
  }
  if (!c.t.header.showLogo) return 0;
  const s = Math.min(size, 40);
  const bx = opts.align === 'right' ? x - s : opts.align === 'center' ? x - s / 2 : x;
  doc.save().roundedRect(bx, y, s, s, s * 0.22).fill(opts.invert ? '#ffffff' : c.accent).restore();
  doc.font('B').fontSize(s * 0.5).fillColor(opts.invert ? c.accent : '#ffffff').text(org.initial, bx, y + s * 0.22, { width: s, align: 'center', lineBreak: false });
  return s;
}

function orgText(c: Ctx, org: OrgBlock, x: number, y: number, w: number, align: 'left' | 'right' | 'center', colors: { name: string; text: string }, size = 13) {
  const { doc, t } = c;
  doc.y = y;
  if (t.header.showOrgName) doc.font('B').fontSize(size).fillColor(colors.name).text(org.name, x, doc.y, { width: w, align });
  doc.font('R').fontSize(c.base - 0.5).fillColor(colors.text);
  const lines = [...org.address, ...org.contact, org.gstin].filter(Boolean) as string[];
  for (const l of lines) doc.text(l, x, doc.y + 1, { width: w, align, lineGap: 1 });
  return doc.y;
}

function header(c: Ctx, m: Pick<PdfModel, 'title' | 'number' | 'numberLabel' | 'org'>) {
  const { doc, t, x, w } = c;
  const top = c.top;
  const L = t.header.logoSize;
  const showTitle = t.header.showTitle;
  const num = m.number ? `${m.numberLabel ? `${m.numberLabel} ` : ''}${m.number}` : '';
  switch (t.layout) {
    case 'modern': {
      const pad = 18;
      // measure the band height first
      const left = w * 0.58;
      doc.font('R').fontSize(c.base - 0.5);
      const lines = [...m.org.address, ...m.org.contact, m.org.gstin].filter(Boolean) as string[];
      const textH = (t.header.showOrgName ? 18 : 0) + lines.reduce((s, l) => s + doc.heightOfString(l, { width: left - 70 }) + 1, 0);
      const bandH = Math.max(L, textH, 54) + pad * 2;
      doc.save().roundedRect(x, top, w, bandH, 8).fill(c.accent).restore();
      const lw = logo(c, m.org, x + pad, top + pad, Math.min(L, bandH - pad * 2), { invert: true });
      const img = imageBuffer(m.org.logo);
      const textX = img ? x + pad + Math.min(L * 3, 120) + 12 : lw ? x + pad + lw + 12 : x + pad;
      orgText(c, m.org, textX, top + pad - 2, left - (textX - x), 'left', { name: '#ffffff', text: lighten(c.accent, 0.75) });
      if (showTitle) {
        doc.font('B').fontSize(22).fillColor('#ffffff').text(m.title.toUpperCase(), x + left, top + pad - 2, { width: w - left - pad, align: 'right', characterSpacing: 1.5 });
        if (num) doc.font('R').fontSize(c.base + 1).fillColor(lighten(c.accent, 0.75)).text(num, x + left, doc.y + 2, { width: w - left - pad, align: 'right' });
      }
      doc.y = top + bandH + 16;
      return;
    }
    case 'classic': {
      const cx = x + w / 2;
      let y = top;
      const img = imageBuffer(m.org.logo);
      if (img && t.header.showLogo) y += logo(c, m.org, cx, y, L, { align: 'center' }) + 8;
      y = orgText(c, m.org, x, y, w, 'center', { name: c.ink, text: c.muted }, 17);
      y += 10;
      doc.save().lineWidth(1.2).moveTo(x, y).lineTo(x + w, y).strokeColor(c.accent).stroke().lineWidth(0.4).moveTo(x, y + 3).lineTo(x + w, y + 3).stroke().restore();
      doc.y = y + 16;
      if (showTitle) {
        doc.font('B').fontSize(18).fillColor(c.accent).text(m.title.toUpperCase(), x, doc.y, { width: w, align: 'center', characterSpacing: 3 });
        if (num) doc.font('R').fontSize(c.base + 0.5).fillColor(c.muted).text(num, x, doc.y + 2, { width: w, align: 'center' });
      }
      doc.y += 16;
      return;
    }
    case 'bold': {
      let ly = top;
      if (showTitle) {
        doc.font('B').fontSize(30).fillColor(c.accent).text(m.title.toUpperCase(), x, top - 4, { width: w * 0.55 });
        if (num) doc.font('B').fontSize(c.base + 1.5).fillColor(c.ink).text(num, x, doc.y + 2, { width: w * 0.55 });
        ly = doc.y;
      }
      const rx = x + w * 0.5;
      const rw = w * 0.5;
      let ry = top;
      const lh = logo(c, m.org, x + w, ry, L, { align: 'right' });
      if (lh) ry += lh + 8;
      ry = orgText(c, m.org, rx, ry, rw, 'right', { name: c.ink, text: c.muted }, 12);
      doc.y = Math.max(ly, ry) + 14;
      doc.save().rect(x, doc.y, 46, 3).fill(c.accent).restore();
      doc.y += 16;
      return;
    }
    case 'minimal': {
      const lh = logo(c, m.org, x, top, L);
      const img = imageBuffer(m.org.logo);
      const tx = lh ? (img ? x : x + lh + 12) : x;
      const ty = lh && img ? top + lh + 8 : top;
      const oy = orgText(c, m.org, tx, ty, w * 0.55 - (tx - x), 'left', { name: c.ink, text: c.muted }, 12);
      let ry = top;
      if (showTitle) {
        doc.font('R').fontSize(20).fillColor(c.ink).text(m.title.toUpperCase(), x + w * 0.45, top - 2, { width: w * 0.55, align: 'right', characterSpacing: 4 });
        if (num) doc.font('R').fontSize(c.base).fillColor(c.muted).text(num, x + w * 0.45, doc.y + 4, { width: w * 0.55, align: 'right', characterSpacing: 0.5 });
        ry = doc.y;
      }
      doc.y = Math.max(oy, ry, top + lh) + 22;
      doc.save().lineWidth(0.4).moveTo(x, doc.y).lineTo(x + w, doc.y).strokeColor('#d5d8de').stroke().restore();
      doc.y += 18;
      return;
    }
    case 'spreadsheet': {
      const split = w * 0.6;
      const lh = logo(c, m.org, x + 10, top + 10, Math.min(L, 40));
      const img = imageBuffer(m.org.logo);
      const tx = lh ? x + 10 + (img ? Math.min(L * 3, 120) : lh) + 10 : x + 10;
      const oy = orgText(c, m.org, tx, top + 9, split - (tx - x) - 10, 'left', { name: c.ink, text: c.muted }, 12);
      let ry = top + 10;
      if (showTitle) {
        doc.font('B').fontSize(17).fillColor(c.accent).text(m.title.toUpperCase(), x + split + 10, top + 12, { width: w - split - 20, align: 'right', characterSpacing: 0.5 });
        if (num) doc.font('R').fontSize(c.base + 0.5).fillColor(c.ink).text(num, x + split + 10, doc.y + 3, { width: w - split - 20, align: 'right' });
        ry = doc.y;
      }
      const h = Math.max(oy, ry, top + 10 + lh) - top + 10;
      doc.save().lineWidth(0.7).strokeColor('#9aa3ae').rect(x, top, w, h).stroke().moveTo(x + split, top).lineTo(x + split, top + h).stroke().restore();
      doc.y = top + h;
      return;
    }
    default: {
      // standard
      const lh = logo(c, m.org, x, top, L);
      const img = imageBuffer(m.org.logo);
      const tx = lh ? (img ? x : x + lh + 12) : x;
      const ty = lh && img ? top + lh + 8 : top;
      const oy = orgText(c, m.org, tx, ty, w * 0.55 - (tx - x), 'left', { name: c.ink, text: c.muted });
      let ry = top;
      if (showTitle) {
        doc.font('B').fontSize(24).fillColor(c.ink).text(m.title, x + w * 0.4, top - 4, { width: w * 0.6, align: 'right' });
        if (num) doc.font('B').fontSize(c.base + 1).fillColor(c.muted).text(num, x + w * 0.4, doc.y + 2, { width: w * 0.6, align: 'right' });
        ry = doc.y;
      }
      doc.y = Math.max(oy, ry, top + lh) + 18;
      doc.save().rect(x, doc.y, w, 1.6).fill(c.accent).restore();
      doc.y += 16;
    }
  }
}

// ------------------------------------------------------------ parties and facts

function label(c: Ctx, text: string, x: number, y: number, w: number, align: 'left' | 'right' = 'left') {
  const caps = c.t.layout === 'minimal' || c.t.layout === 'classic' || c.t.layout === 'modern' || c.t.layout === 'bold';
  c.doc.font(caps ? 'B' : 'R').fontSize(caps ? c.base - 1.5 : c.base).fillColor(caps ? c.muted : c.muted).text(caps ? text.toUpperCase() : text, x, y, { width: w, align, characterSpacing: caps ? 0.8 : 0 });
}

function partyBlock(c: Ctx, title: string, name: string | undefined, lines: string[], x: number, y: number, w: number) {
  const { doc } = c;
  label(c, title, x, y, w);
  doc.y += 3;
  if (name) doc.font('B').fontSize(c.base + 1).fillColor(c.t.layout === 'standard' ? c.accent : c.ink).text(name, x, doc.y, { width: w });
  doc.font('R').fontSize(c.base).fillColor(c.ink);
  for (const l of lines) doc.text(l, x, doc.y + 1, { width: w, lineGap: 1 });
  return doc.y;
}

function factsBlock(c: Ctx, facts: [string, string][], x: number, y: number, w: number) {
  const { doc } = c;
  let yy = y;
  const kw = w * 0.55;
  for (const [k, v] of facts) {
    doc.font('R').fontSize(c.base).fillColor(c.muted);
    const h1 = doc.heightOfString(`${k} :`, { width: kw - 8 });
    doc.text(`${k} :`, x, yy, { width: kw - 8, align: 'right' });
    doc.font('B').fillColor(c.ink);
    const h2 = doc.heightOfString(v, { width: w - kw });
    doc.text(v, x + kw, yy, { width: w - kw, align: 'right' });
    yy += Math.max(h1, h2) + 5;
  }
  return yy;
}

function summaryStrip(c: Ctx, m: PdfModel) {
  const { doc, x, w } = c;
  const cells: [string, string][] = [...m.facts.slice(0, 3), [m.highlight.label, m.highlight.value]];
  const y = doc.y;
  const h = 40;
  doc.save().roundedRect(x, y, w, h, 6).fill(c.tint).restore();
  const cw = w / cells.length;
  cells.forEach(([k, v], i) => {
    const cx = x + cw * i + 12;
    doc.font('B').fontSize(c.base - 2).fillColor(c.muted).text(k.toUpperCase(), cx, y + 9, { width: cw - 20, characterSpacing: 0.6, lineBreak: false, ellipsis: true });
    doc.font('B').fontSize(c.base + (i === cells.length - 1 ? 2.5 : 1)).fillColor(i === cells.length - 1 ? c.accent : c.ink).text(v, cx, y + 20, { width: cw - 20, lineBreak: false, ellipsis: true });
  });
  doc.y = y + h + 16;
}

function parties(c: Ctx, m: PdfModel) {
  const { doc, x, w, t } = c;
  if (t.layout === 'modern') summaryStrip(c, m);
  const y = doc.y;
  const factsW = Math.min(230, w * 0.42);
  const leftW = w - factsW - 20;
  const colW = m.ship ? leftW / 2 - 8 : leftW;
  if (t.layout === 'spreadsheet') {
    const pad = 8;
    const b1 = partyBlock(c, m.party.label, m.party.name, m.party.lines, x + pad, y + pad, colW - pad);
    const b2 = m.ship ? partyBlock(c, m.ship.label, undefined, m.ship.lines, x + colW + 16 + pad, y + pad, colW - pad) : y;
    const fy = factsBlock(c, m.facts, x + leftW + 20, y + pad, factsW - pad);
    const h = Math.max(b1, b2, fy) - y + pad;
    doc.save().lineWidth(0.7).strokeColor('#9aa3ae').rect(x, y, w, h).stroke().moveTo(x + leftW + 12, y).lineTo(x + leftW + 12, y + h).stroke();
    if (m.ship) doc.moveTo(x + colW + 12, y).lineTo(x + colW + 12, y + h).stroke();
    doc.restore();
    doc.y = y + h + 12;
  } else {
    const facts = t.layout === 'modern' ? m.facts.slice(3) : m.facts;
    const b1 = partyBlock(c, m.party.label, m.party.name, m.party.lines, x, y, colW);
    const b2 = m.ship ? partyBlock(c, m.ship.label, undefined, m.ship.lines, x + colW + 16, y, colW) : y;
    const fy = facts.length ? factsBlock(c, facts, x + leftW + 20, y, factsW) : y;
    doc.y = Math.max(b1, b2, fy) + 18;
  }
  if (m.subject) {
    label(c, 'Subject', x, doc.y, w);
    doc.font('R').fontSize(c.base).fillColor(c.ink).text(m.subject, x, doc.y + 2, { width: w });
    doc.y += 12;
  }
}

// ------------------------------------------------------------ item table

function colLayout(c: Ctx, cols: PdfColumn[]) {
  const total = cols.reduce((s, k) => s + k.weight, 0);
  let cx = c.x;
  return cols.map((k) => {
    const cw = (c.w * k.weight) / total;
    const out = { ...k, cx, cw };
    cx += cw;
    return out;
  });
}

type Laid = ReturnType<typeof colLayout>[number];

function itemTable(c: Ctx, m: PdfModel) {
  const { doc, t, x, w } = c;
  const cols = colLayout(c, m.columns);
  const pad = 6;
  const grid = t.table.borders === 'grid';
  const filled = t.table.headerBg ? t.table.headerBg.toLowerCase() !== '#ffffff' : true;
  const headBg = t.table.headerBg || c.accent;
  const headFg = t.table.headerText || '#ffffff';
  const gridColor = '#9aa3ae';
  const drawHead = () => {
    const y = doc.y;
    doc.font('B').fontSize(c.base - 0.5);
    const hh = Math.max(...cols.map((k) => doc.heightOfString(k.label, { width: k.cw - pad * 2 }))) + 14;
    if (filled) doc.save().rect(x, y, w, hh).fill(headBg).restore();
    else {
      doc.save().lineWidth(t.layout === 'classic' ? 1.2 : 0.6).strokeColor(t.layout === 'classic' ? c.accent : '#cfd4db').moveTo(x, y).lineTo(x + w, y).stroke();
      doc.lineWidth(0.6).moveTo(x, y + hh).lineTo(x + w, y + hh).stroke().restore();
    }
    const caps = t.layout === 'minimal' || t.layout === 'classic';
    for (const k of cols) doc.font('B').fontSize(caps ? c.base - 1.5 : c.base - 0.5).fillColor(headFg).text(caps ? k.label.toUpperCase() : k.label, k.cx + pad, y + 7, { width: k.cw - pad * 2, align: k.align, characterSpacing: caps ? 0.8 : 0 });
    if (grid) {
      doc.save().lineWidth(0.7).strokeColor(gridColor).rect(x, y, w, hh).stroke();
      for (const k of cols.slice(1)) doc.moveTo(k.cx, y).lineTo(k.cx, y + hh).stroke();
      doc.restore();
    }
    doc.y = y + hh;
  };
  drawHead();
  m.lines.forEach((l, i) => {
    const cell = (k: Laid): { main: string; sub?: string } => {
      switch (k.key) {
        case 'index':
          return { main: String(l.index) };
        case 'item':
          return { main: l.name, sub: l.description };
        case 'qty':
          return { main: l.qty, sub: l.unit };
        case 'rate':
          return { main: l.rate };
        case 'discount':
          return { main: l.discount || '' };
        case 'tax':
          return { main: l.tax || '' };
        default:
          return { main: l.amount };
      }
    };
    const heights = cols.map((k) => {
      const v = cell(k);
      doc.font(k.key === 'item' ? 'B' : 'R').fontSize(c.base);
      let hgt = doc.heightOfString(v.main, { width: k.cw - pad * 2 });
      if (v.sub) {
        doc.font('R').fontSize(c.base - 1);
        hgt += doc.heightOfString(v.sub, { width: k.cw - pad * 2 }) + 2;
      }
      return hgt;
    });
    const rh = Math.max(...heights) + 14;
    if (doc.y + rh > c.limit) {
      doc.addPage();
      drawHead();
    }
    const y = doc.y;
    if (t.table.stripes && i % 2 === 1) doc.save().rect(x, y, w, rh).fill(c.tint).restore();
    for (const k of cols) {
      const v = cell(k);
      doc.font(k.key === 'item' ? 'B' : 'R').fontSize(c.base).fillColor(c.ink).text(v.main, k.cx + pad, y + 7, { width: k.cw - pad * 2, align: k.align });
      if (v.sub) doc.font('R').fontSize(c.base - 1).fillColor(c.muted).text(v.sub, k.cx + pad, doc.y + 2, { width: k.cw - pad * 2, align: k.align });
    }
    if (grid) {
      doc.save().lineWidth(0.7).strokeColor(gridColor).rect(x, y, w, rh).stroke();
      for (const k of cols.slice(1)) doc.moveTo(k.cx, y).lineTo(k.cx, y + rh).stroke();
      doc.restore();
    } else if (t.table.borders === 'rows') doc.save().lineWidth(0.5).strokeColor(c.line).moveTo(x, y + rh).lineTo(x + w, y + rh).stroke().restore();
    doc.y = y + rh;
  });
  doc.y += 10;
}

// ------------------------------------------------------------ totals and footer sections

function totals(c: Ctx, m: PdfModel) {
  const { doc, t, x, w } = c;
  const tw = Math.min(250, w * 0.46);
  const tx = x + w - tw;
  doc.font('R').fontSize(c.base);
  const rowsH = m.totals.length * 22 + 10;
  ensure(c, rowsH);
  const top = doc.y;
  // left column: amount in words
  let leftBottom = top;
  if (m.amountInWords) {
    label(c, 'Total In Words', x, top + 4, w - tw - 24);
    doc.font('B').fontSize(c.base).fillColor(c.ink).text(m.amountInWords, x, doc.y + 3, { width: w - tw - 24 });
    leftBottom = doc.y;
  }
  let y = top;
  const grid = t.layout === 'spreadsheet';
  for (const r of m.totals) {
    const strong = r.emphasis === 'total' || r.emphasis === 'balance';
    const h = strong ? 24 : 20;
    if (r.emphasis === 'balance') {
      if (t.layout === 'bold' || t.layout === 'modern') doc.save().roundedRect(tx, y, tw, h, 4).fill(c.accent).restore();
      else doc.save().rect(tx, y, tw, h).fill(c.tint).restore();
    } else if (r.emphasis === 'total' && !m.totals.some((z) => z.emphasis === 'balance')) {
      if (t.layout === 'bold' || t.layout === 'modern') doc.save().roundedRect(tx, y, tw, h, 4).fill(c.accent).restore();
      else doc.save().rect(tx, y, tw, h).fill(c.tint).restore();
    } else if (r.emphasis === 'total') doc.save().lineWidth(0.6).strokeColor('#cfd4db').moveTo(tx, y).lineTo(tx + tw, y).stroke().restore();
    const onAccent = (t.layout === 'bold' || t.layout === 'modern') && (r.emphasis === 'balance' || (r.emphasis === 'total' && !m.totals.some((z) => z.emphasis === 'balance')));
    const fg = onAccent ? '#ffffff' : r.emphasis === 'negative' ? '#b42318' : c.ink;
    doc.font(strong ? 'B' : 'R').fontSize(strong ? c.base + 1 : c.base).fillColor(onAccent ? '#ffffff' : strong ? c.ink : c.muted).text(r.label, tx + 10, y + (h - c.base - 2) / 2, { width: tw * 0.5 - 10, align: 'right' });
    doc.font(strong ? 'B' : 'R').fillColor(fg).text(r.value, tx + tw * 0.5, y + (h - c.base - 2) / 2, { width: tw * 0.5 - 10, align: 'right' });
    if (grid) doc.save().lineWidth(0.7).strokeColor('#9aa3ae').rect(tx, y, tw, h).stroke().moveTo(tx + tw * 0.5, y).lineTo(tx + tw * 0.5, y + h).stroke().restore();
    y += h;
  }
  doc.y = Math.max(y, leftBottom) + 18;
}

function section(c: Ctx, title: string, text: string) {
  const { doc, x, w } = c;
  doc.font('R').fontSize(c.base);
  ensure(c, doc.heightOfString(text, { width: w }) + 26);
  label(c, title, x, doc.y, w);
  doc.font('R').fontSize(c.base).fillColor(c.ink).text(text, x, doc.y + 3, { width: w, lineGap: 1.5 });
  doc.y += 12;
}

function closing(c: Ctx, m: PdfModel) {
  const { doc, x, w } = c;
  if (m.notes) section(c, m.notes.label, m.notes.text);
  if (m.terms) section(c, m.terms.label, m.terms.text);
  if (m.bank) section(c, 'Bank Details', m.bank);
  if (m.signature) {
    ensure(c, 60);
    const y = doc.y + 30;
    const sw = 170;
    doc.save().lineWidth(0.6).strokeColor('#9aa3ae').moveTo(x + w - sw, y).lineTo(x + w, y).stroke().restore();
    doc.font('R').fontSize(c.base - 0.5).fillColor(c.muted).text(m.signature, x + w - sw, y + 5, { width: sw, align: 'center' });
    doc.y = y + 20;
  }
  if (m.isVoid) {
    const range = doc.bufferedPageRange();
    doc.switchToPage(range.start);
    doc.save().rotate(-30, { origin: [c.pageW / 2, c.pageH / 2] }).font('B').fontSize(90).fillColor('#b42318').opacity(0.08).text('VOID', 0, c.pageH / 2 - 50, { width: c.pageW, align: 'center', lineBreak: false }).restore();
  }
}

// ------------------------------------------------------------ public renderers

export function renderDocPdf(d: TxnDoc, templateId?: string): Promise<Buffer> {
  const db = getDb();
  const t = resolveTemplate(db.pdfTemplates, db.preferences, d.kind, templateId || d.templateId);
  const contact = db.contacts.find((x) => x.id === d.contactId);
  const m = buildPdfModel(d, db.organization, contact, t, db.preferences);
  return create(t, (c) => {
    header(c, m);
    parties(c, m);
    itemTable(c, m);
    totals(c, m);
    closing(c, m);
  });
}

// receipts and statements reuse the document chrome with a generic table renderer
function rowsTable(c: Ctx, cols: { label: string; weight: number; align?: 'left' | 'right' }[], rows: string[][]) {
  const { doc, x, w, t } = c;
  const total = cols.reduce((s, k) => s + k.weight, 0);
  let cx = x;
  const laid = cols.map((k) => {
    const o = { ...k, cx, cw: (w * k.weight) / total };
    cx += o.cw;
    return o;
  });
  const pad = 6;
  const headBg = t.table.headerBg || c.accent;
  const filled = headBg.toLowerCase() !== '#ffffff';
  const head = () => {
    const y = doc.y;
    if (filled) doc.save().rect(x, y, w, 22).fill(headBg).restore();
    else doc.save().lineWidth(0.6).strokeColor('#cfd4db').moveTo(x, y).lineTo(x + w, y).moveTo(x, y + 22).lineTo(x + w, y + 22).stroke().restore();
    for (const k of laid) doc.font('B').fontSize(c.base - 0.5).fillColor(t.table.headerText || '#ffffff').text(k.label, k.cx + pad, y + 7, { width: k.cw - pad * 2, align: k.align || 'left', lineBreak: false });
    doc.y = y + 22;
  };
  head();
  rows.forEach((r, i) => {
    doc.font('R').fontSize(c.base);
    const rh = Math.max(...laid.map((k, j) => doc.heightOfString(r[j] || '', { width: k.cw - pad * 2 }))) + 12;
    if (doc.y + rh > c.limit) {
      doc.addPage();
      head();
    }
    const y = doc.y;
    if (t.table.stripes && i % 2 === 1) doc.save().rect(x, y, w, rh).fill(c.tint).restore();
    laid.forEach((k, j) => doc.font('R').fontSize(c.base).fillColor(c.ink).text(r[j] || '', k.cx + pad, y + 6, { width: k.cw - pad * 2, align: k.align || 'left' }));
    doc.save().lineWidth(0.5).strokeColor(c.line).moveTo(x, y + rh).lineTo(x + w, y + rh).stroke().restore();
    doc.y = y + rh;
  });
  doc.y += 12;
}

export function renderPaymentPdf(p: PaymentReceived | PaymentMade, made = false): Promise<Buffer> {
  const db = getDb();
  const t = resolveTemplate(db.pdfTemplates, db.preferences, 'payment');
  const org = orgLines(db.organization, t);
  const contact = db.contacts.find((x) => x.id === p.contactId);
  const fx = fxOf(p);
  const money = (n: number) => moneyIn(n, fx.code);
  return create(t, (c) => {
    const { doc, x, w } = c;
    header(c, { title: made ? 'Supplier Payment' : 'Payment Receipt', number: p.number, numberLabel: t.details.numberLabel, org });
    const y = doc.y;
    const facts: [string, string][] = [
      ['Payment Date', fmtDate(p.date)],
      ['Payment Mode', p.mode],
    ];
    if (p.referenceNumber) facts.push(['Reference Number', p.referenceNumber]);
    if (fx.code !== BASE_CURRENCY) {
      facts.push(['Currency', fx.code]);
      facts.push(['Exchange Rate', rateLabel(fx.code, fx.rate)]);
      facts.push(['Amount in INR', moneyIn(toBase(p.amount, fx.rate), BASE_CURRENCY)]);
    }
    if ('tdsDeducted' in p && p.tdsDeducted) facts.push(['TDS Deducted', money(p.tdsAmount)]);
    const fy = factsBlock(c, facts, x, y, Math.min(260, w * 0.5));
    const bw = Math.min(200, w * 0.4);
    doc.save().roundedRect(x + w - bw, y, bw, 58, 6).fill(c.accent).restore();
    doc.font('R').fontSize(c.base).fillColor('#ffffff').text(made ? 'Amount Paid' : 'Amount Received', x + w - bw, y + 12, { width: bw, align: 'center' });
    doc.font('B').fontSize(17).text(money(p.amount), x + w - bw, y + 27, { width: bw, align: 'center' });
    doc.y = Math.max(fy, y + 58) + 18;
    partyBlock(c, made ? 'Paid To' : 'Received From', contact?.displayName, addressLines(contact?.billingAddress), x, doc.y, w * 0.6);
    doc.y += 18;
    if (p.allocations.length) {
      doc.font('B').fontSize(c.base + 1.5).fillColor(c.ink).text('Payment for', x, doc.y);
      doc.y += 6;
      rowsTable(
        c,
        [
          { label: made ? 'Bill Number' : 'Invoice Number', weight: 2 },
          { label: made ? 'Bill Date' : 'Invoice Date', weight: 1.6 },
          { label: made ? 'Bill Amount' : 'Invoice Amount', weight: 2, align: 'right' },
          { label: 'Payment Amount', weight: 2, align: 'right' },
        ],
        p.allocations.map((a) => {
          const d = db.docs.find((z) => z.id === a.docId);
          return [d?.number || '', fmtDate(d?.date), money(d?.total || 0), money(a.amount)];
        }),
      );
    }
    if (p.notes) section(c, 'Notes', p.notes);
    if (t.other.showSignature) closing(c, { signature: t.other.signatureLabel } as PdfModel);
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
  currencyCode?: string;
  rows: { date: string; type: string; number: string; details: string; amount: number; payment: number; balance: number }[];
}): Promise<Buffer> {
  const db = getDb();
  const t = resolveTemplate(db.pdfTemplates, db.preferences, 'payment');
  const org = orgLines(db.organization, t);
  const money = (n: number) => moneyIn(n, s.currencyCode || BASE_CURRENCY);
  return create(t, (c) => {
    const { doc, x, w } = c;
    header(c, { title: 'Statement of Accounts', number: `${fmtDate(s.from)} To ${fmtDate(s.to)}`, numberLabel: '', org });
    const y = doc.y;
    const b = partyBlock(c, 'To', s.contact.displayName, addressLines(s.contact.billingAddress), x, y, w * 0.5);
    const fy = factsBlock(
      c,
      [
        ['Opening Balance', money(s.opening)],
        ['Invoiced Amount', money(s.invoiced)],
        ['Amount Paid', money(s.paid)],
        ['Balance Due', money(s.closing)],
      ],
      x + w * 0.55,
      y,
      w * 0.45,
    );
    doc.y = Math.max(b, fy) + 18;
    rowsTable(
      c,
      [
        { label: 'Date', weight: 1.2 },
        { label: 'Transactions', weight: 1.6 },
        { label: 'Details', weight: 2.2 },
        { label: 'Amount', weight: 1.4, align: 'right' },
        { label: 'Payments', weight: 1.4, align: 'right' },
        { label: 'Balance', weight: 1.5, align: 'right' },
      ],
      [
        [fmtDate(s.from), 'Opening Balance', '', '', '', money(s.opening)],
        ...s.rows.map((r) => [fmtDate(r.date), r.type, [r.number, r.details.replace(/\d{4}-\d{2}-\d{2}/g, (z) => fmtDate(z))].filter(Boolean).join('\n'), r.amount ? money(r.amount) : '', r.payment ? money(r.payment) : '', money(r.balance)]),
      ],
    );
    ensure(c, 30);
    const bw = Math.min(250, w * 0.46);
    const by = doc.y;
    doc.save().rect(x + w - bw, by, bw, 24).fill(c.tint).restore();
    doc.font('B').fontSize(c.base + 1).fillColor(c.ink).text('Balance Due', x + w - bw + 10, by + 7, { width: bw / 2 - 10 });
    doc.text(money(s.closing), x + w - bw / 2, by + 7, { width: bw / 2 - 10, align: 'right' });
  });
}

