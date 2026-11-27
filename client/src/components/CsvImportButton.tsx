import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, Upload } from 'lucide-react';
import { parseDelimited } from '@shared/bankImport';
import { csvField } from '@shared/contactImport';
import { Modal } from './ui';
import { downloadRows } from '../lib/export';
import { toast } from '../lib/toast';

export interface CsvImportRecord {
  rowNumber: number;
  headers: string[];
  values: string[];
  get: (...headers: string[]) => string | undefined;
}

export interface CsvImportResult {
  rowNumber: number;
  label: string;
  success: boolean;
  message?: string;
}

export function CsvImportButton({
  title,
  filename,
  headers,
  instructions,
  onImport,
}: {
  title: string;
  filename: string;
  headers: string[];
  instructions: string;
  onImport: (records: CsvImportRecord[]) => Promise<CsvImportResult[]>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<CsvImportResult[]>([]);

  async function importFile(file: File) {
    setBusy(true);
    setResults([]);
    try {
      const parsed = parseDelimited(await file.text());
      const [csvHeaders, ...rows] = parsed;
      if (!csvHeaders?.length || !rows.length) throw new Error('The CSV must include a header row and at least one data row.');
      const records = rows.map((values, index) => ({
        rowNumber: index + 2,
        headers: csvHeaders,
        values,
        get: (...names: string[]) => csvField(csvHeaders, values, ...names),
      }));
      const report = await onImport(records);
      setResults(report);
      const imported = report.filter((item) => item.success).length;
      const failed = report.length - imported;
      if (imported) {
        await queryClient.invalidateQueries();
        toast.success(`${imported} ${imported === 1 ? 'record' : 'records'} imported${failed ? `; ${failed} failed` : ''}`);
      } else {
        toast.error('No records were imported. See the row errors below.');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not import this CSV file.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn-secondary btn-sm" onClick={() => { setOpen(true); setResults([]); }}>
        <Upload size={13} /> Import CSV
      </button>
      <Modal open={open} onClose={() => !busy && setOpen(false)} title={`Import ${title} from CSV`}>
        <div className="space-y-3 text-[13px]">
          <p className="text-slate-600">{instructions}</p>
          <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
            <div className="font-semibold">CSV columns</div>
            <div className="mt-1 break-words">{headers.join(', ')}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-secondary btn-sm"
              onClick={() => downloadRows(`${filename}-template`, [], headers.map((header) => ({ header, value: () => '' })), 'csv')}
            >
              <Download size={13} /> Download CSV template
            </button>
            <button className="btn-primary btn-sm" disabled={busy} onClick={() => input.current?.click()}>
              <Upload size={13} /> {busy ? 'Importing…' : 'Choose CSV file'}
            </button>
            <input
              ref={input}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) void importFile(file);
              }}
            />
          </div>
          {results.length > 0 && (
            <div className="max-h-64 space-y-1 overflow-auto rounded-md border border-slate-200 p-3">
              <div className="mb-2 font-semibold">{results.filter((result) => result.success).length} imported, {results.filter((result) => !result.success).length} failed</div>
              {results.map((result, index) => (
                <div key={`${result.rowNumber}-${index}`} className={result.success ? 'text-emerald-700' : 'text-red-600'}>
                  Row {result.rowNumber} — {result.label}{result.message ? `: ${result.message}` : ''}
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
