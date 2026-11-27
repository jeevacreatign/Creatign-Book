import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { csvText, xlsxBytes } from '../client/src/lib/export';

const columns = [
  { header: 'Name', value: (row: { name: string }) => row.name },
  { header: 'Amount', value: (row: { amount: number }) => row.amount },
];

describe('table exports', () => {
  it('creates Excel-compatible CSV with escaped values', () => {
    expect(csvText([{ name: 'Acme, Inc.', amount: 125 }], columns)).toContain('"Acme, Inc.","125"');
  });

  it('creates a valid workbook sheet with text and numeric cells', () => {
    const files = unzipSync(xlsxBytes([{ name: 'A & B', amount: 125 }], columns));
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);

    expect(sheet).toContain('A &amp; B');
    expect(sheet).toContain('<c r="B2"><v>125</v></c>');
  });
});
