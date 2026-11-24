// Printable transaction PDFs driven by PDF templates (shared/pdfTemplate.ts).
// The same render model feeds the server's PDFKit renderer, so the on-screen preview,
// browser print and the emailed attachment all match.
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { fmtDate, money } from '@shared/format';
import { PDF_FONTS, addressLines, buildPdfModel, orgLines, pageSize, type PdfModel, type PdfTemplate } from '@shared/pdfTemplate';
import type { Address, Contact, Organization, PaymentMade, PaymentReceived, TxnDoc } from '@shared/types';
import { clsx } from './ui';

export function AddressBlock({ a }: { a?: Address }) {
  if (!a) return null;
  const lines = [a.attention, a.street1, a.street2, [a.city, a.pin].filter(Boolean).join(' '), a.state, a.country, a.phone].filter(Boolean);
  if (!lines.length) return <div className="text-slate-400">-</div>;
  return (
    <div className="leading-5">
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  );
}

const RIBBON_COLORS: Record<string, string> = {
  draft: 'bg-slate-500',
  pending_approval: 'bg-amber-500',
  approved: 'bg-emerald-600',
  rejected: 'bg-red-500',
  void: 'bg-slate-400',
  cancelled: 'bg-slate-400',
  declined: 'bg-red-500',
  expired: 'bg-red-500',
  overdue: 'bg-orange-500',
  partially_paid: 'bg-amber-500',
  partially_billed: 'bg-amber-500',
  due_today: 'bg-amber-500',
  paid: 'bg-emerald-600',
  closed: 'bg-emerald-600',
  accepted: 'bg-emerald-600',
  invoiced: 'bg-emerald-600',
  billed: 'bg-emerald-600',
  delivered: 'bg-emerald-600',
};

/** Diagonal status ribbon in the top-left corner of the preview (screen only, never printed). */
export function StatusRibbon({ status }: { status: string }) {
  const label = status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <div className="no-print pointer-events-none absolute left-0 top-0 z-10 h-28 w-28 overflow-hidden" aria-label={`Status: ${label}`}>
      <div className={clsx('absolute left-[-50px] top-[22px] w-[170px] -rotate-45 py-[3px] text-center font-sans text-[11px] font-medium tracking-wide text-white shadow', RIBBON_COLORS[status] || 'bg-sky-600')}>{label}</div>
    </div>
  );
}

// ------------------------------------------------------------ page chrome

const pt = (n: number) => `${n}pt`;
const PX_PER_PT = 96 / 72;

export function fontCss(t: PdfTemplate) {
  return PDF_FONTS.find((f) => f.value === t.font)?.css || PDF_FONTS[0].css;
}

/** Sets the printed paper size and margins from the template (browser print / Save as PDF). */
export function PrintPageStyle({ t }: { t: PdfTemplate }) {
  const s = pageSize(t);
  const m = t.margins;
  return <style>{`@media print { @page { size: ${s.w}pt ${s.h}pt; margin: ${m.top}in ${m.right}in ${m.bottom}in ${m.left}in; } body { background: ${t.backgroundColor || '#fff'} !important; } }`}</style>;
}

/** Scales a fixed-size paper down to the available width on screen (never in print). */
export function FitPaper({ t, children, maxHeight, className }: { t: PdfTemplate; children: ReactNode; maxHeight?: number; className?: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ scale: 1, h: 0 });
  const pageW = pageSize(t).w * PX_PER_PT;
  useLayoutEffect(() => {
    const el = outer.current;
    const content = inner.current;
    if (!el || !content) return;
    const measure = () => {
      const scale = Math.min(1, el.clientWidth / pageW);
      setBox({ scale, h: content.offsetHeight * scale });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(content);
    return () => ro.disconnect();
  }, [pageW]);
  return (
    <div ref={outer} className={clsx('pdf-fit-outer w-full overflow-hidden', className)} style={{ height: maxHeight ? Math.min(maxHeight, box.h || maxHeight) : box.h || undefined }}>
      <div ref={inner} className="pdf-fit" style={{ width: pageW, transform: `scale(${box.scale})`, transformOrigin: 'top left', marginLeft: box.scale < 1 ? 0 : Math.max(0, ((outer.current?.clientWidth || pageW) - pageW) / 2) }}>
        {children}
      </div>
    </div>
  );
}

export function PdfPage({ t, children, className, shadow = true }: { t: PdfTemplate; children: ReactNode; className?: string; shadow?: boolean }) {
  const s = pageSize(t);
  const m = t.margins;
  const style: CSSProperties = {
    width: pt(s.w),
    minHeight: pt(s.h),
    padding: `${m.top}in ${m.right}in ${m.bottom}in ${m.left}in`,
    fontFamily: fontCss(t),
    fontSize: pt(t.fontSize),
    lineHeight: 1.45,
    color: t.textColor,
    backgroundColor: t.backgroundColor || '#ffffff',
    backgroundImage: t.backgroundImage ? `url(${t.backgroundImage})` : undefined,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  };
  return (
    <div className={clsx('pdf-page print-area relative flex flex-col overflow-hidden text-left', shadow && 'shadow-[0_1px_3px_rgba(15,23,42,0.08),0_8px_24px_rgba(15,23,42,0.06)] ring-1 ring-slate-200', className)} style={style}>
      {t.layout === 'bold' && <div className="absolute inset-y-0 left-0" style={{ width: pt(10), background: t.accentColor }} />}
      {children}
    </div>
  );
}

// ------------------------------------------------------------ building blocks

type OrgBlock = PdfModel['org'];
const capsLayouts = new Set(['modern', 'classic', 'bold', 'minimal']);

function Label({ t, children, align }: { t: PdfTemplate; children: ReactNode; align?: 'right' | 'center' }) {
  const caps = capsLayouts.has(t.layout);
  return <div style={{ color: t.labelColor, fontSize: pt(caps ? t.fontSize - 1.5 : t.fontSize), fontWeight: caps ? 700 : 400, letterSpacing: caps ? pt(0.8) : undefined, textTransform: caps ? 'uppercase' : undefined, textAlign: align }}>{children}</div>;
}

function Logo({ t, org, size, invert, align }: { t: PdfTemplate; org: OrgBlock; size: number; invert?: boolean; align?: 'left' | 'right' | 'center' }) {
  if (!t.header.showLogo) return null;
  if (org.logo) return <img src={org.logo} alt="" style={{ height: pt(size), maxWidth: pt(size * 3), objectFit: 'contain', objectPosition: align === 'right' ? 'right' : align === 'center' ? 'center' : 'left', display: 'block', margin: align === 'center' ? '0 auto' : align === 'right' ? '0 0 0 auto' : undefined }} />;
  const s = Math.min(size, 40);
  return (
    <div className="flex shrink-0 items-center justify-center font-bold" style={{ width: pt(s), height: pt(s), borderRadius: pt(s * 0.22), background: invert ? '#fff' : t.accentColor, color: invert ? t.accentColor : '#fff', fontSize: pt(s * 0.5), margin: align === 'center' ? '0 auto' : align === 'right' ? '0 0 0 auto' : undefined }}>
      {org.initial}
    </div>
  );
}

function OrgText({ t, org, align = 'left', nameColor, textColor, nameSize = 13 }: { t: PdfTemplate; org: OrgBlock; align?: 'left' | 'right' | 'center'; nameColor?: string; textColor?: string; nameSize?: number }) {
  const lines = [...org.address, ...org.contact, org.gstin].filter(Boolean) as string[];
  return (
    <div style={{ textAlign: align }}>
      {t.header.showOrgName && <div style={{ fontWeight: 700, fontSize: pt(nameSize), color: nameColor || t.textColor, lineHeight: 1.25 }}>{org.name}</div>}
      <div style={{ color: textColor || t.labelColor, fontSize: pt(t.fontSize - 0.5), marginTop: pt(2) }}>
        {lines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  );
}

function numberText(m: Pick<PdfModel, 'number' | 'numberLabel'>) {
  return m.number ? `${m.numberLabel ? `${m.numberLabel} ` : ''}${m.number}` : '';
}

function mix(hex: string, amount: number) {
  const r = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!r) return hex;
  const n = parseInt(r[1], 16);
  const ch = (s: number) => Math.round(((n >> s) & 255) + (255 - ((n >> s) & 255)) * amount);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

export function PdfHeader({ t, m }: { t: PdfTemplate; m: Pick<PdfModel, 'title' | 'number' | 'numberLabel' | 'org'> }) {
  const num = numberText(m);
  const L = t.header.logoSize;
  const showTitle = t.header.showTitle;
  switch (t.layout) {
    case 'modern':
      return (
        <div className="flex items-start justify-between gap-6" style={{ background: t.accentColor, color: '#fff', borderRadius: pt(8), padding: pt(18), marginBottom: pt(16) }}>
          <div className="flex items-start" style={{ gap: pt(12) }}>
            <Logo t={t} org={m.org} size={L} invert />
            <OrgText t={t} org={m.org} nameColor="#fff" textColor={mix(t.accentColor, 0.75)} />
          </div>
          {showTitle && (
            <div className="text-right">
              <div style={{ fontWeight: 700, fontSize: pt(22), letterSpacing: pt(1.5), textTransform: 'uppercase', lineHeight: 1.15 }}>{m.title}</div>
              {num && <div style={{ color: mix(t.accentColor, 0.75), fontSize: pt(t.fontSize + 1), marginTop: pt(3) }}>{num}</div>}
            </div>
          )}
        </div>
      );
    case 'classic':
      return (
        <div style={{ marginBottom: pt(16) }}>
          {m.org.logo && t.header.showLogo && (
            <div style={{ marginBottom: pt(8) }}>
              <Logo t={t} org={m.org} size={L} align="center" />
            </div>
          )}
          <OrgText t={t} org={m.org} align="center" nameSize={17} />
          <div style={{ borderTop: `${pt(1.2)} solid ${t.accentColor}`, borderBottom: `${pt(0.4)} solid ${t.accentColor}`, height: pt(3), margin: `${pt(10)} 0 ${pt(16)}` }} />
          {showTitle && (
            <div className="text-center">
              <div style={{ fontWeight: 700, fontSize: pt(18), letterSpacing: pt(3), textTransform: 'uppercase', color: t.accentColor }}>{m.title}</div>
              {num && <div style={{ color: t.labelColor, fontSize: pt(t.fontSize + 0.5), marginTop: pt(2) }}>{num}</div>}
            </div>
          )}
        </div>
      );
    case 'bold':
      return (
        <div style={{ marginBottom: pt(16) }}>
          <div className="flex items-start justify-between gap-6">
            <div>
              {showTitle && (
                <>
                  <div style={{ fontWeight: 700, fontSize: pt(30), lineHeight: 1.05, textTransform: 'uppercase', color: t.accentColor }}>{m.title}</div>
                  {num && <div style={{ fontWeight: 700, fontSize: pt(t.fontSize + 1.5), marginTop: pt(4) }}>{num}</div>}
                </>
              )}
            </div>
            <div className="flex flex-col items-end" style={{ gap: pt(8) }}>
              <Logo t={t} org={m.org} size={L} align="right" />
              <OrgText t={t} org={m.org} align="right" nameSize={12} />
            </div>
          </div>
          <div style={{ width: pt(46), height: pt(3), background: t.accentColor, marginTop: pt(14) }} />
        </div>
      );
    case 'minimal':
      return (
        <div style={{ marginBottom: pt(18) }}>
          <div className="flex items-start justify-between gap-6" style={{ paddingBottom: pt(22), borderBottom: `${pt(0.4)} solid #d5d8de` }}>
            <div className={clsx('flex items-start', m.org.logo && 'flex-col')} style={{ gap: pt(m.org.logo ? 8 : 12) }}>
              <Logo t={t} org={m.org} size={L} />
              <OrgText t={t} org={m.org} nameSize={12} />
            </div>
            {showTitle && (
              <div className="text-right">
                <div style={{ fontSize: pt(20), letterSpacing: pt(4), textTransform: 'uppercase', lineHeight: 1.15 }}>{m.title}</div>
                {num && <div style={{ color: t.labelColor, marginTop: pt(4), letterSpacing: pt(0.5) }}>{num}</div>}
              </div>
            )}
          </div>
        </div>
      );
    case 'spreadsheet':
      return (
        <div className="flex" style={{ border: `${pt(0.7)} solid #9aa3ae` }}>
          <div className="flex items-start" style={{ width: '60%', padding: pt(10), gap: pt(10), borderRight: `${pt(0.7)} solid #9aa3ae` }}>
            <Logo t={t} org={m.org} size={Math.min(L, 40)} />
            <OrgText t={t} org={m.org} nameSize={12} />
          </div>
          {showTitle && (
            <div className="flex-1 text-right" style={{ padding: pt(10) }}>
              <div style={{ fontWeight: 700, fontSize: pt(17), letterSpacing: pt(0.5), textTransform: 'uppercase', color: t.accentColor }}>{m.title}</div>
              {num && <div style={{ fontSize: pt(t.fontSize + 0.5), marginTop: pt(3) }}>{num}</div>}
            </div>
          )}
        </div>
      );
    default:
      return (
        <div style={{ marginBottom: pt(16) }}>
          <div className="flex items-start justify-between gap-6" style={{ paddingBottom: pt(18) }}>
            <div className={clsx('flex items-start', m.org.logo && 'flex-col')} style={{ gap: pt(m.org.logo ? 8 : 12) }}>
              <Logo t={t} org={m.org} size={L} />
              <OrgText t={t} org={m.org} />
            </div>
            {showTitle && (
              <div className="text-right">
                <div style={{ fontWeight: 700, fontSize: pt(24), lineHeight: 1.1 }}>{m.title}</div>
                {num && <div style={{ fontWeight: 700, color: t.labelColor, fontSize: pt(t.fontSize + 1), marginTop: pt(4) }}>{num}</div>}
              </div>
            )}
          </div>
          <div style={{ height: pt(1.6), background: t.accentColor }} />
        </div>
      );
  }
}

function Party({ t, label, name, lines }: { t: PdfTemplate; label: string; name?: string; lines: string[] }) {
  return (
    <div className="min-w-0 flex-1">
      <Label t={t}>{label}</Label>
      {name && <div style={{ fontWeight: 700, fontSize: pt(t.fontSize + 1), color: t.layout === 'standard' ? t.accentColor : t.textColor, marginTop: pt(3) }}>{name}</div>}
      <div style={{ marginTop: name ? 0 : pt(3) }}>
        {lines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  );
}

export function Facts({ t, facts, width = 230 }: { t: PdfTemplate; facts: [string, string][]; width?: number }) {
  if (!facts.length) return null;
  return (
    <table style={{ width: pt(width), borderCollapse: 'collapse' }} className="shrink-0 self-start">
      <tbody>
        {facts.map(([k, v]) => (
          <tr key={k}>
            <td style={{ color: t.labelColor, textAlign: 'right', padding: `0 ${pt(8)} ${pt(5)} 0`, width: '55%', verticalAlign: 'top' }}>{k} :</td>
            <td style={{ fontWeight: 700, textAlign: 'right', padding: `0 0 ${pt(5)}`, verticalAlign: 'top' }}>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SummaryStrip({ t, m }: { t: PdfTemplate; m: PdfModel }) {
  const cells: [string, string][] = [...m.facts.slice(0, 3), [m.highlight.label, m.highlight.value]];
  return (
    <div className="flex" style={{ background: t.tintColor, borderRadius: pt(6), padding: `${pt(9)} 0`, marginBottom: pt(16) }}>
      {cells.map(([k, v], i) => (
        <div key={k} className="min-w-0 flex-1" style={{ padding: `0 ${pt(12)}` }}>
          <div className="truncate" style={{ fontWeight: 700, fontSize: pt(t.fontSize - 2), letterSpacing: pt(0.6), textTransform: 'uppercase', color: t.labelColor }}>
            {k}
          </div>
          <div className="truncate" style={{ fontWeight: 700, fontSize: pt(t.fontSize + (i === cells.length - 1 ? 2.5 : 1)), color: i === cells.length - 1 ? t.accentColor : t.textColor }}>
            {v}
          </div>
        </div>
      ))}
    </div>
  );
}

function Parties({ t, m }: { t: PdfTemplate; m: PdfModel }) {
  const grid = t.layout === 'spreadsheet';
  const facts = t.layout === 'modern' ? m.facts.slice(3) : m.facts;
  const border = `${pt(0.7)} solid #9aa3ae`;
  return (
    <>
      {t.layout === 'modern' && <SummaryStrip t={t} m={m} />}
      <div className="flex" style={grid ? { border, borderTop: 'none', marginBottom: pt(12) } : { gap: pt(20), marginBottom: pt(18) }}>
        <div className="flex min-w-0 flex-1" style={grid ? {} : { gap: pt(16) }}>
          <div className="flex min-w-0 flex-1" style={grid ? { padding: pt(8), borderRight: m.ship ? border : undefined } : {}}>
            <Party t={t} label={m.party.label} name={m.party.name} lines={m.party.lines} />
          </div>
          {m.ship && (
            <div className="flex min-w-0 flex-1" style={grid ? { padding: pt(8) } : {}}>
              <Party t={t} label={m.ship.label} lines={m.ship.lines} />
            </div>
          )}
        </div>
        {facts.length > 0 && (
          <div style={grid ? { padding: pt(8), borderLeft: border } : {}}>
            <Facts t={t} facts={facts} />
          </div>
        )}
      </div>
      {m.subject && (
        <div style={{ marginBottom: pt(12) }}>
          <Label t={t}>Subject</Label>
          <div style={{ marginTop: pt(2) }}>{m.subject}</div>
        </div>
      )}
    </>
  );
}

function ItemTable({ t, m }: { t: PdfTemplate; m: PdfModel }) {
  const total = m.columns.reduce((s, c) => s + c.weight, 0);
  const grid = t.table.borders === 'grid';
  const filled = t.table.headerBg ? t.table.headerBg.toLowerCase() !== '#ffffff' : true;
  const caps = t.layout === 'minimal' || t.layout === 'classic';
  const gridB = `${pt(0.7)} solid #9aa3ae`;
  const rowB = t.table.borders === 'rows' ? `${pt(0.5)} solid #e3e6eb` : undefined;
  const headStyle: CSSProperties = {
    background: filled ? t.table.headerBg || t.accentColor : 'transparent',
    color: t.table.headerText || '#fff',
    borderTop: !filled ? `${pt(caps && t.layout === 'classic' ? 1.2 : 0.6)} solid ${t.layout === 'classic' ? t.accentColor : '#cfd4db'}` : undefined,
    borderBottom: !filled ? `${pt(0.6)} solid ${t.layout === 'classic' ? t.accentColor : '#cfd4db'}` : undefined,
  };
  return (
    <table className="w-full" style={{ borderCollapse: 'collapse', tableLayout: 'fixed', marginBottom: pt(10) }}>
      <colgroup>
        {m.columns.map((c) => (
          <col key={c.key} style={{ width: `${(c.weight / total) * 100}%` }} />
        ))}
      </colgroup>
      <thead style={{ display: 'table-header-group' }}>
        <tr style={headStyle}>
          {m.columns.map((c) => (
            <th key={c.key} style={{ textAlign: c.align, padding: `${pt(7)} ${pt(6)}`, fontWeight: 700, fontSize: pt(caps ? t.fontSize - 1.5 : t.fontSize - 0.5), letterSpacing: caps ? pt(0.8) : undefined, textTransform: caps ? 'uppercase' : undefined, border: grid ? gridB : undefined, verticalAlign: 'bottom' }}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {m.lines.map((l, i) => (
          <tr key={l.index} style={{ background: t.table.stripes && i % 2 === 1 ? t.tintColor : undefined, borderBottom: grid ? undefined : rowB, breakInside: 'avoid' }}>
            {m.columns.map((c) => {
              const td: CSSProperties = { textAlign: c.align, padding: `${pt(7)} ${pt(6)}`, verticalAlign: 'top', border: grid ? gridB : undefined, wordBreak: 'break-word' };
              if (c.key === 'index') return <td key={c.key} style={td}>{l.index}</td>;
              if (c.key === 'item')
                return (
                  <td key={c.key} style={td}>
                    <div style={{ fontWeight: 700 }}>{l.name}</div>
                    {l.description && <div style={{ color: t.labelColor, fontSize: pt(t.fontSize - 1), marginTop: pt(2), whiteSpace: 'pre-wrap' }}>{l.description}</div>}
                  </td>
                );
              if (c.key === 'qty')
                return (
                  <td key={c.key} style={td}>
                    {l.qty}
                    {l.unit && <div style={{ color: t.labelColor, fontSize: pt(t.fontSize - 1), marginTop: pt(2) }}>{l.unit}</div>}
                  </td>
                );
              return (
                <td key={c.key} style={td}>
                  {c.key === 'rate' ? l.rate : c.key === 'discount' ? l.discount : c.key === 'tax' ? l.tax : l.amount}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Totals({ t, m }: { t: PdfTemplate; m: PdfModel }) {
  const hasBalance = m.totals.some((r) => r.emphasis === 'balance');
  const accentPanel = t.layout === 'bold' || t.layout === 'modern';
  const grid = t.layout === 'spreadsheet';
  const gridB = `${pt(0.7)} solid #9aa3ae`;
  return (
    <div className="flex items-start justify-between" style={{ gap: pt(24), marginBottom: pt(18), breakInside: 'avoid' }}>
      <div className="min-w-0 flex-1" style={{ paddingTop: pt(4) }}>
        {m.amountInWords && (
          <>
            <Label t={t}>Total In Words</Label>
            <div style={{ fontWeight: 700, marginTop: pt(3) }}>{m.amountInWords}</div>
          </>
        )}
      </div>
      <table style={{ width: pt(250), maxWidth: '46%', borderCollapse: 'collapse' }}>
        <tbody>
          {m.totals.map((r) => {
            const strong = r.emphasis === 'total' || r.emphasis === 'balance';
            const highlight = r.emphasis === 'balance' || (r.emphasis === 'total' && !hasBalance);
            const onAccent = accentPanel && highlight;
            const bg = highlight ? (onAccent ? t.accentColor : t.tintColor) : undefined;
            const cell: CSSProperties = { padding: `${pt(strong ? 6 : 4)} ${pt(10)}`, textAlign: 'right', border: grid ? gridB : undefined, background: bg };
            return (
              <tr key={r.label} style={{ borderTop: r.emphasis === 'total' && !highlight && !grid ? `${pt(0.6)} solid #cfd4db` : undefined, fontWeight: strong ? 700 : 400, fontSize: strong ? pt(t.fontSize + 1) : undefined, color: onAccent ? '#fff' : undefined }}>
                <td style={{ ...cell, color: onAccent ? '#fff' : strong ? t.textColor : t.labelColor, borderRadius: onAccent ? `${pt(4)} 0 0 ${pt(4)}` : undefined, width: '50%' }}>{r.label}</td>
                <td style={{ ...cell, color: onAccent ? '#fff' : r.emphasis === 'negative' ? '#b42318' : t.textColor, borderRadius: onAccent ? `0 ${pt(4)} ${pt(4)} 0` : undefined, whiteSpace: 'nowrap' }}>{r.value}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Closing({ t, m }: { t: PdfTemplate; m: Pick<PdfModel, 'notes' | 'terms' | 'bank' | 'signature' | 'footer'> }) {
  const sec = (label: string, text: string) => (
    <div style={{ marginBottom: pt(12), breakInside: 'avoid' }}>
      <Label t={t}>{label}</Label>
      <div style={{ whiteSpace: 'pre-wrap', marginTop: pt(3) }}>{text}</div>
    </div>
  );
  return (
    <>
      {m.notes && sec(m.notes.label, m.notes.text)}
      {m.terms && sec(m.terms.label, m.terms.text)}
      {m.bank && sec('Bank Details', m.bank)}
      {m.signature && (
        <div className="flex justify-end" style={{ marginTop: pt(30), breakInside: 'avoid' }}>
          <div style={{ width: pt(170), borderTop: `${pt(0.6)} solid #9aa3ae`, paddingTop: pt(5), textAlign: 'center', color: t.labelColor, fontSize: pt(t.fontSize - 0.5) }}>{m.signature}</div>
        </div>
      )}
      <div className="flex-1" />
      {m.footer && <div style={{ marginTop: pt(20), paddingTop: pt(6), borderTop: `${pt(0.5)} solid #e3e6eb`, color: t.labelColor, fontSize: pt(t.fontSize - 1.5) }}>{m.footer}</div>}
    </>
  );
}

// ------------------------------------------------------------ public components

export function DocumentPreview({ doc, org, contact, template, preferences, fit = true, ribbon = true }: { doc: TxnDoc; org: Organization; contact?: Contact; template: PdfTemplate; preferences?: Record<string, unknown>; fit?: boolean; ribbon?: boolean }) {
  const t = template;
  const m = buildPdfModel(doc, org, contact, t, preferences);
  const page = (
    <PdfPage t={t}>
      {ribbon && doc.status && !doc.repeatEvery && <StatusRibbon status={doc.status} />}
      {m.isVoid && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" style={{ color: '#b42318', opacity: 0.08, fontSize: pt(90), fontWeight: 700, transform: 'rotate(-30deg)' }}>
          VOID
        </div>
      )}
      <PdfHeader t={t} m={m} />
      <Parties t={t} m={m} />
      <ItemTable t={t} m={m} />
      <Totals t={t} m={m} />
      <Closing t={t} m={m} />
    </PdfPage>
  );
  return (
    <>
      <PrintPageStyle t={t} />
      {fit ? <FitPaper t={t}>{page}</FitPaper> : page}
    </>
  );
}

export function ReceiptPreview({ payment, org, contact, kind, rows, template }: { payment: PaymentReceived | PaymentMade; org: Organization; contact?: Contact; kind: 'received' | 'made'; rows: { number: string; date: string; total: number; amount: number }[]; template: PdfTemplate }) {
  const t = template;
  const o = orgLines(org, t);
  const facts: [string, string][] = [
    ['Payment Date', fmtDate(payment.date)],
    ['Reference Number', payment.referenceNumber || '-'],
    ['Payment Mode', payment.mode],
  ];
  if ('tdsDeducted' in payment && payment.tdsDeducted) facts.push(['TDS Deducted', money(payment.tdsAmount)]);
  const headBg = t.table.headerBg || t.accentColor;
  const filled = headBg.toLowerCase() !== '#ffffff';
  return (
    <>
      <PrintPageStyle t={t} />
      <FitPaper t={t}>
        <PdfPage t={t}>
          <PdfHeader t={t} m={{ title: kind === 'received' ? 'Payment Receipt' : 'Payment Made', number: payment.number, numberLabel: t.details.numberLabel, org: o }} />
          <div className="flex items-start justify-between" style={{ gap: pt(24), marginTop: t.layout === 'spreadsheet' ? pt(12) : 0 }}>
            <table style={{ borderCollapse: 'collapse' }}>
              <tbody>
                {facts.map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ color: t.labelColor, padding: `0 ${pt(20)} ${pt(6)} 0` }}>{k}</td>
                    <td style={{ fontWeight: 700, padding: `0 0 ${pt(6)}` }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-center" style={{ width: pt(200), background: t.accentColor, color: '#fff', borderRadius: pt(6), padding: pt(14) }}>
              <div>{kind === 'received' ? 'Amount Received' : 'Amount Paid'}</div>
              <div style={{ fontWeight: 700, fontSize: pt(17), marginTop: pt(2) }}>{money(payment.amount)}</div>
            </div>
          </div>
          <div style={{ marginTop: pt(18) }}>
            <Party t={t} label={kind === 'received' ? 'Received From' : 'Paid To'} name={contact?.displayName} lines={addressLines(contact?.billingAddress)} />
          </div>
          {rows.length > 0 && (
            <div style={{ marginTop: pt(22) }}>
              <div style={{ fontWeight: 700, fontSize: pt(t.fontSize + 1.5), marginBottom: pt(6) }}>Payment for</div>
              <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: filled ? headBg : 'transparent', color: t.table.headerText || '#fff', borderTop: filled ? undefined : `${pt(0.6)} solid #cfd4db`, borderBottom: filled ? undefined : `${pt(0.6)} solid #cfd4db` }}>
                    {[kind === 'received' ? 'Invoice Number' : 'Bill Number', kind === 'received' ? 'Invoice Date' : 'Bill Date', kind === 'received' ? 'Invoice Amount' : 'Bill Amount', 'Payment Amount'].map((h, i) => (
                      <th key={h} style={{ padding: `${pt(7)} ${pt(6)}`, textAlign: i > 1 ? 'right' : 'left', fontWeight: 700, fontSize: pt(t.fontSize - 0.5) }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.number} style={{ borderBottom: `${pt(0.5)} solid #e3e6eb`, background: t.table.stripes && i % 2 ? t.tintColor : undefined }}>
                      <td style={{ padding: `${pt(6)}` }}>{r.number}</td>
                      <td style={{ padding: `${pt(6)}` }}>{fmtDate(r.date)}</td>
                      <td style={{ padding: `${pt(6)}`, textAlign: 'right' }}>{money(r.total)}</td>
                      <td style={{ padding: `${pt(6)}`, textAlign: 'right' }}>{money(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {'unusedAmount' in payment && payment.unusedAmount > 0 && <div style={{ marginTop: pt(10), textAlign: 'right' }}>Amount in Excess: {money(payment.unusedAmount)}</div>}
          <div style={{ marginTop: pt(14) }} />
          <Closing t={t} m={{ notes: payment.notes ? { label: 'Notes', text: payment.notes } : undefined, signature: t.other.showSignature ? t.other.signatureLabel : undefined, footer: t.header.footerText || undefined }} />
        </PdfPage>
      </FitPaper>
    </>
  );
}
