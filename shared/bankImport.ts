// Bank statement import: CSV/TSV parsing, column mapping guesses and date/amount parsing for the
// formats Indian banks export (dd/MM/yyyy, dd-MM-yyyy, dd MMM yyyy, yyyy-MM-dd, amounts with commas,
// Dr/Cr suffixes and brackets for negatives).

export type DateFormat = 'dd/MM/yyyy' | 'MM/dd/yyyy' | 'yyyy-MM-dd' | 'dd-MM-yyyy' | 'dd MMM yyyy' | 'dd.MM.yyyy';
export const DATE_FORMATS: DateFormat[] = ['dd/MM/yyyy', 'dd-MM-yyyy', 'dd.MM.yyyy', 'dd MMM yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd'];

export interface ImportMapping {
  date: number;
  description?: number;
  reference?: number;
  payee?: number;
  /** separate withdrawal / deposit columns ... */
  withdrawal?: number;
  deposit?: number;
  /** ... or one signed amount column (negative = withdrawal) */
  amount?: number;
  /** optional Dr/Cr indicator column used with a single amount column */
  drCr?: number;
  /** optional running balance column: the last row gives the statement's closing balance */
  balance?: number;
}

/** RFC 4180-ish parser; detects comma, semicolon or tab. */
export function parseDelimited(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const first = clean.split(/\r?\n/, 1)[0] || '';
  const delim = [',', '\t', ';'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) {
      row.push(cell.trim());
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');

function valid(y: number, m: number, d: number) {
  if (!(y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return undefined;
  const dt = new Date(y, m - 1, d);
  return dt.getMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : undefined;
}

export function parseStatementDate(raw: string, fmt: DateFormat): string | undefined {
  const s = raw.trim();
  const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
  if (fmt === 'dd MMM yyyy') {
    const m = s.match(/^(\d{1,2})[\s-/]([A-Za-z]{3})[A-Za-z]*[\s-/,]+(\d{2,4})/);
    return m ? valid(year(m[3]), MONTHS.indexOf(m[2].toLowerCase()) + 1, Number(m[1])) : undefined;
  }
  const parts = s.split(/[/.\-\s]/).filter(Boolean);
  if (parts.length < 3) return undefined;
  if (fmt === 'yyyy-MM-dd') return valid(Number(parts[0]), Number(parts[1]), Number(parts[2]));
  if (fmt === 'MM/dd/yyyy') return valid(year(parts[2]), Number(parts[0]), Number(parts[1]));
  return valid(year(parts[2]), Number(parts[1]), Number(parts[0]));
}

/** Pick the date format that parses the most sample values. */
export function guessDateFormat(samples: string[]): DateFormat {
  let best: DateFormat = 'dd/MM/yyyy';
  let score = -1;
  for (const f of DATE_FORMATS) {
    const n = samples.filter((s) => parseStatementDate(s, f)).length;
    if (n > score) {
      score = n;
      best = f;
    }
  }
  return best;
}

/** "1,23,456.78", "(500.00)", "500.00 Dr", "-12" -> signed number (Dr/brackets/minus = negative). */
export function parseAmount(raw: string | undefined): number {
  if (!raw) return 0;
  let s = raw.trim();
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (/\bdr\.?$/i.test(s)) {
    neg = true;
    s = s.replace(/\bdr\.?$/i, '');
  }
  s = s.replace(/\bcr\.?$/i, '');
  s = s.replace(/[₹,\s]|INR|Rs\.?/gi, '');
  if (s.startsWith('-')) {
    neg = !neg;
    s = s.slice(1);
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return Math.round((neg ? -n : n) * 100) / 100;
}

/** Guess which column is which from the header row. */
export function guessMapping(headers: string[]): ImportMapping {
  const find = (...res: RegExp[]) => {
    for (const re of res) {
      const i = headers.findIndex((h) => re.test(h));
      if (i >= 0) return i;
    }
    return undefined;
  };
  const date = find(/^(txn|transaction|value)?\s*date$/i, /date/i) ?? 0;
  const withdrawal = find(/withdraw/i, /debit/i, /^dr$/i, /paid out/i, /money out/i);
  const deposit = find(/deposit/i, /credit/i, /^cr$/i, /paid in/i, /money in/i);
  const amount = withdrawal == null && deposit == null ? find(/amount/i) : undefined;
  return {
    date,
    description: find(/narration/i, /description/i, /particulars/i, /details/i, /remarks/i),
    reference: find(/ref/i, /chq/i, /cheque/i, /utr/i),
    payee: find(/payee/i, /beneficiary/i, /name/i),
    withdrawal,
    deposit,
    amount,
    drCr: amount != null ? find(/^(dr|cr|dr\/cr|type)$/i) : undefined,
    balance: find(/balance/i),
  };
}

export interface ParsedLine {
  row: number;
  date?: string;
  description?: string;
  reference?: string;
  payee?: string;
  deposit: number;
  withdrawal: number;
  balance?: number;
  error?: string;
}

export function mapRows(rows: string[][], mapping: ImportMapping, fmt: DateFormat): ParsedLine[] {
  return rows.map((r, i) => {
    const date = parseStatementDate(r[mapping.date] ?? '', fmt);
    let deposit = 0;
    let withdrawal = 0;
    if (mapping.amount != null) {
      let a = parseAmount(r[mapping.amount]);
      const ind = mapping.drCr != null ? (r[mapping.drCr] || '').trim().toLowerCase() : '';
      if (ind.startsWith('dr') || ind.startsWith('d')) a = -Math.abs(a);
      else if (ind.startsWith('cr') || ind.startsWith('c')) a = Math.abs(a);
      if (a >= 0) deposit = a;
      else withdrawal = -a;
    } else {
      withdrawal = Math.abs(parseAmount(mapping.withdrawal != null ? r[mapping.withdrawal] : ''));
      deposit = Math.abs(parseAmount(mapping.deposit != null ? r[mapping.deposit] : ''));
    }
    const out: ParsedLine = {
      row: i + 1,
      date,
      description: mapping.description != null ? r[mapping.description] || undefined : undefined,
      reference: mapping.reference != null ? r[mapping.reference] || undefined : undefined,
      payee: mapping.payee != null ? r[mapping.payee] || undefined : undefined,
      deposit,
      withdrawal,
      balance: mapping.balance != null && (r[mapping.balance] || '').trim() ? parseAmount(r[mapping.balance]) : undefined,
    };
    if (!date) out.error = `Row ${i + 1}: the date "${r[mapping.date] ?? ''}" does not match ${fmt}`;
    else if (!deposit && !withdrawal) out.error = `Row ${i + 1}: no amount`;
    else if (deposit && withdrawal) out.error = `Row ${i + 1}: has both a withdrawal and a deposit`;
    return out;
  });
}
