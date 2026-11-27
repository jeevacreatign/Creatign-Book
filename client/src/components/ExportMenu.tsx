import { ChevronDown, Download } from 'lucide-react';
import { Dropdown, MenuItem } from './ui';
import { downloadRows, type ExportColumn } from '../lib/export';

export function ExportMenu<T>({ rows, columns, filename, label = 'Export' }: { rows: T[]; columns: ExportColumn<T>[]; filename: string; label?: string }) {
  return (
    <Dropdown
      align="right"
      button={() => (
        <button className="btn-secondary btn-sm" disabled={!rows.length}>
          <Download size={13} /> {label} <ChevronDown size={13} />
        </button>
      )}
    >
      <MenuItem onClick={() => downloadRows(filename, rows, columns, 'csv')}>Download CSV</MenuItem>
      <MenuItem onClick={() => downloadRows(filename, rows, columns, 'xlsx')}>Download Excel (.xlsx)</MenuItem>
    </Dropdown>
  );
}
