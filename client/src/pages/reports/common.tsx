// Report Library shared types, per-viewer favourites / recent list, and CSV / XLS export.
import { useEffect, useState } from 'react';
import { fmtDate } from '@shared/format';
import type { SavedReport } from '@shared/types';

export type ColType = 'text' | 'money' | 'number' | 'date' | 'percent' | 'hours';
export interface Col {
  key: string;
  label: string;
  type?: ColType;
  hidden?: boolean;
}
export interface Row {
  c: Record<string, string | number | undefined | null>;
  kind?: 'section' | 'sub' | 'total' | 'grand';
  level?: number;
  link?: string;
}
export interface ReportResult {
  key: string;
  title: string;
  subtitle: string;
  columns: Col[];
  rows: Row[];
  notes?: string[];
}
export type FilterKey = 'period' | 'asOf' | 'basis' | 'customer' | 'vendor' | 'account' | 'item' | 'project' | 'budget' | 'salesperson' | 'status';
export interface ReportMeta {
  key: string;
  name: string;
  category: string;
  description: string;
  filters: FilterKey[];
  period?: string;
}
export interface Catalog {
  categories: string[];
  reports: ReportMeta[];
  saved: SavedReport[];
}

// ------------------------------------------------------------------ favourites and recent (this browser only)

type Store = { key: string; max?: number };
export const favourites: Store = { key: 'cb.reports.favourites' };
export const recent: Store = { key: 'cb.reports.recent', max: 8 };
const listeners = new Set<() => void>();

function read(s: Store): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(s.key) || '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
function write(s: Store, v: string[]) {
  try {
    localStorage.setItem(s.key, JSON.stringify(v));
  } catch {
    // storage unavailable (private mode): favourites just won't persist
  }
  listeners.forEach((f) => f());
}
export function useStored(s: Store) {
  const [v, setV] = useState(() => read(s));
  useEffect(() => {
    const f = () => setV(read(s));
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  }, [s]);
  return v;
}
export function toggleFavourite(key: string) {
  const v = read(favourites);
  write(favourites, v.includes(key) ? v.filter((x) => x !== key) : [...v, key]);
}
export function markVisited(key: string) {
  write(recent, [key, ...read(recent).filter((x) => x !== key)].slice(0, recent.max));
}

// ------------------------------------------------------------------ formatting and export

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function formatCell(v: unknown, type?: ColType): string {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v === 'number') {
    if (type === 'money') return `${v < 0 ? '-' : ''}₹${inr.format(Math.abs(v))}`;
    if (type === 'percent') return `${inr.format(v)}%`;
    if (type === 'hours') {
      const h = Math.floor(Math.abs(v));
      const m = Math.round((Math.abs(v) - h) * 60);
      return `${v < 0 ? '-' : ''}${h}:${String(m).padStart(2, '0')}`;
    }
    if (type === 'number') return Number.isInteger(v) ? new Intl.NumberFormat('en-IN').format(v) : inr.format(v);
    return String(v);
  }
  if (type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(String(v))) return fmtDate(String(v));
  return String(v);
}

const indent = (r: Row, i: number) => (i === 0 && r.level ? '    '.repeat(r.level) : '');

/** Raw values for spreadsheets: numbers stay numbers. */
function rawCell(r: Row, col: Col, i: number) {
  const v = r.c[col.key];
  if (v === undefined || v === null) return '';
  if (typeof v === 'number') return col.type === 'hours' ? formatCell(v, 'hours') : v;
  if (col.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(String(v))) return fmtDate(String(v));
  return indent(r, i) + String(v);
}

export function toCsv(rep: ReportResult, cols: Col[]) {
  const esc = (x: string | number) => (typeof x === 'number' ? String(x) : /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x);
  const lines = [[rep.title], [rep.subtitle], [], cols.map((c) => c.label), ...rep.rows.map((r) => cols.map((c, i) => rawCell(r, c, i)))];
  return '﻿' + lines.map((l) => l.map((x) => esc(x as string | number)).join(',')).join('\r\n');
}

/** SpreadsheetML 2003 workbook: opens in Excel / LibreOffice as .xls with bold totals and number formats. */
export function toXls(rep: ReportResult, cols: Col[], org: string) {
  const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cell = (v: string | number, style?: string) => `<Cell${style ? ` ss:StyleID="${style}"` : ''}><Data ss:Type="${typeof v === 'number' ? 'Number' : 'String'}">${typeof v === 'number' ? v : x(v)}</Data></Cell>`;
  const rows = rep.rows.map((r) => {
    const bold = r.kind === 'section' || r.kind === 'total' || r.kind === 'grand' || r.kind === 'sub';
    return `<Row>${cols.map((c, i) => {
      const v = rawCell(r, c, i);
      const style = typeof v === 'number' && c.type === 'money' ? (bold ? 'mb' : 'm') : bold ? 'b' : undefined;
      return cell(v, style);
    }).join('')}</Row>`;
  });
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
<Style ss:ID="t"><Font ss:Bold="1" ss:Size="13"/></Style>
<Style ss:ID="h"><Font ss:Bold="1"/><Interior ss:Color="#F1F5F9" ss:Pattern="Solid"/></Style>
<Style ss:ID="b"><Font ss:Bold="1"/></Style>
<Style ss:ID="m"><NumberFormat ss:Format="#,##0.00"/></Style>
<Style ss:ID="mb"><Font ss:Bold="1"/><NumberFormat ss:Format="#,##0.00"/></Style>
</Styles>
<Worksheet ss:Name="${x(rep.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '))}">
<Table>
${cols.map((c, i) => `<Column ss:Width="${i === 0 ? 240 : 110}"/>`).join('')}
<Row>${cell(org, 't')}</Row>
<Row>${cell(rep.title, 'b')}</Row>
<Row>${cell(rep.subtitle)}</Row>
<Row></Row>
<Row>${cols.map((c) => cell(c.label, 'h')).join('')}</Row>
${rows.join('\n')}
</Table>
</Worksheet>
</Workbook>`;
}
