// Import a bank statement (CSV / TSV): choose the account and file, map the columns, review, import.
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CheckCircle2, FileUp, X } from 'lucide-react';
import { mapRows, type DateFormat, type ImportMapping, type ParsedLine } from '@shared/bankImport';
import { fmtDate, money } from '@shared/format';
import { api, useAction, useApi } from '../../api';
import { toast } from '../../lib/toast';
import { Checkbox, Field, FormFooter, clsx } from '../../components/ui';
import type { BankAccountRow } from './common';

interface Preview {
  headers: string[];
  sample: string[][];
  total: number;
  mapping: ImportMapping;
  dateFormat: DateFormat;
  dateFormats: DateFormat[];
  parsed: ParsedLine[];
}
interface Result {
  imported: number;
  duplicates: number;
  categorized: number;
  recognized: number;
  errors: string[];
}

const FIELDS: { key: keyof ImportMapping; label: string; required?: boolean }[] = [
  { key: 'date', label: 'Date', required: true },
  { key: 'description', label: 'Description' },
  { key: 'reference', label: 'Reference Number' },
  { key: 'payee', label: 'Payee' },
  { key: 'withdrawal', label: 'Withdrawals' },
  { key: 'deposit', label: 'Deposits' },
  { key: 'amount', label: 'Amount (signed)' },
  { key: 'drCr', label: 'Dr / Cr Indicator' },
  { key: 'balance', label: 'Closing Balance' },
];

const STEPS = ['Configure', 'Map Fields', 'Preview'];

export default function ImportStatement() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { data: accounts = [] } = useApi<BankAccountRow[]>('/banking/accounts');
  const [accountId, setAccountId] = useState(id || '');
  const documentId = search.get('documentId') || undefined;
  const { data: doc } = useApi<{ name: string }>(documentId ? `/documents/${documentId}` : null);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [hasHeader, setHasHeader] = useState(true);
  const [step, setStep] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<ImportMapping>({ date: 0 });
  const [fmt, setFmt] = useState<DateFormat>('dd/MM/yyyy');
  const [result, setResult] = useState<Result | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const acc = accounts.find((a) => a.id === accountId);

  const source = documentId ? { documentId } : { text, fileName };
  const loadPreview = useAction(() => api<Preview>('/banking/import/preview', { body: { ...source, hasHeader } }));
  const run = useAction(() => api<Result>(`/banking/accounts/${accountId}/import`, { body: { ...source, hasHeader, mapping, dateFormat: fmt } }), (r) => `${r.imported} transaction${r.imported === 1 ? '' : 's'} imported`);

  const parsed = useMemo(() => (preview ? mapRows(preview.sample, mapping, fmt) : []), [preview, mapping, fmt]);

  const pickFile = (file?: File) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast.error('The file must be 5 MB or smaller');
    if (!/\.(csv|tsv|txt)$/i.test(file.name)) return toast.error('Upload a CSV or TSV file. Export your statement from net banking as CSV.');
    const r = new FileReader();
    r.onload = () => {
      setText(String(r.result || ''));
      setFileName(file.name);
    };
    r.readAsText(file);
  };

  const next = () => {
    if (step === 0) {
      if (!accountId) return toast.error('Choose the account to import into');
      if (!documentId && !text) return toast.error('Choose a statement file');
      loadPreview.mutate(undefined, {
        onSuccess: (p) => {
          setPreview(p);
          setMapping(p.mapping);
          setFmt(p.dateFormat);
          setStep(1);
        },
      });
    } else if (step === 1) {
      if (mapping.amount == null && mapping.deposit == null && mapping.withdrawal == null) return toast.error('Map the Deposits and Withdrawals columns, or a single Amount column');
      setStep(2);
    } else run.mutate(undefined, { onSuccess: setResult });
  };

  if (result)
    return (
      <div className="mx-auto max-w-xl px-5 py-16 text-center">
        <CheckCircle2 className="mx-auto mb-3 text-emerald-500" size={40} />
        <h1 className="text-xl">Statement imported</h1>
        <p className="mt-2 text-slate-600">
          {result.imported} new transaction{result.imported === 1 ? '' : 's'} added to {acc?.name}.
          {result.duplicates > 0 && ` ${result.duplicates} duplicate${result.duplicates === 1 ? ' was' : 's were'} skipped.`}
          {result.categorized > 0 && ` ${result.categorized} categorized by your rules.`}
          {result.recognized > 0 && ` ${result.recognized} recognized by a rule and waiting for review.`}
        </p>
        {result.errors.length > 0 && (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-left text-xs text-amber-800">
            <div className="mb-1 font-semibold">{result.errors.length} row{result.errors.length === 1 ? '' : 's'} skipped</div>
            {result.errors.slice(0, 8).map((e) => (
              <div key={e}>{e}</div>
            ))}
          </div>
        )}
        <div className="mt-6 flex justify-center gap-2">
          <button className="btn-primary" onClick={() => navigate(`/banking/${accountId}`)}>
            Review Transactions
          </button>
          <button className="btn-secondary" onClick={() => navigate('/banking')}>
            Banking Overview
          </button>
        </div>
      </div>
    );

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-3 sm:px-5">
        <h1 className="text-[19px]">Import Statement{acc ? ` - ${acc.name}` : ''}</h1>
        <button className="btn-ghost w-8 px-0" onClick={() => navigate(-1)} aria-label="Close">
          <X size={18} />
        </button>
      </div>
      <div className="flex justify-center gap-0 border-b border-slate-200 py-3">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center">
            <div className={clsx('flex items-center gap-2 text-[13px]', i === step ? 'font-semibold text-brand-700' : i < step ? 'text-emerald-700' : 'text-slate-400')}>
              <span className={clsx('flex h-6 w-6 items-center justify-center rounded-full border text-xs', i === step ? 'border-brand-600 bg-brand-600 text-white' : i < step ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300')}>{i + 1}</span>
              {s}
            </div>
            {i < STEPS.length - 1 && <div className="mx-4 h-px w-16 bg-slate-300" />}
          </div>
        ))}
      </div>
      <div className="flex-1 px-5 py-6">
        {step === 0 && (
          <div className="mx-auto max-w-2xl space-y-4">
            <Field label="Import Into" required>
              <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Select an account</option>
                {accounts
                  .filter((a) => a.active !== false)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </Field>
            {documentId ? (
              <Field label="File">
                <div className="pt-1.5 text-[13px]">{doc?.name ?? 'Loading...'} <span className="text-slate-500">(from Documents)</span></div>
              </Field>
            ) : (
              <div
                className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 px-6 py-10 text-center hover:border-brand-400 hover:bg-brand-50/30"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  pickFile(e.dataTransfer.files[0]);
                }}
              >
                <FileUp className="mb-2 text-brand-500" size={30} />
                {fileName ? <div className="font-medium">{fileName}</div> : <div className="font-medium">Drag and drop your statement here, or click to choose a file</div>}
                <div className="mt-1 text-xs text-slate-500">CSV or TSV, up to 5 MB. Most Indian banks export dd/MM/yyyy dates with separate withdrawal and deposit columns.</div>
                <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
              </div>
            )}
            <Checkbox checked={hasHeader} onChange={setHasHeader} label="The first row has column names" />
            <div className="rounded-md bg-slate-50 px-4 py-3 text-xs text-slate-600">
              Duplicate lines (same date, amount, description and reference as a line already imported into this account) are skipped, so you can import overlapping statements safely. Lines that match one of your <Link className="link" to="/banking/rules">bank rules</Link> are recognized or categorized automatically.
            </div>
          </div>
        )}
        {step === 1 && preview && (
          <div className="mx-auto max-w-3xl">
            <p className="mb-4 text-[13px] text-slate-600">
              Match the columns of <b>{fileName || doc?.name}</b> ({preview.total} rows) to Creatign Ledger fields. Use either Withdrawals and Deposits, or one signed Amount column.
            </p>
            <table className="table rounded-md border border-slate-200">
              <thead>
                <tr>
                  <th className="pl-4">Creatign Ledger Field</th>
                  <th>Column in Your File</th>
                  <th>First Value</th>
                </tr>
              </thead>
              <tbody>
                {FIELDS.map((fd) => (
                  <tr key={fd.key}>
                    <td className="pl-4">
                      {fd.label}
                      {fd.required && <span className="text-red-500">*</span>}
                    </td>
                    <td>
                      <select
                        className="input"
                        value={mapping[fd.key] ?? ''}
                        onChange={(e) => {
                          const v = e.target.value === '' ? undefined : Number(e.target.value);
                          const m = { ...mapping, [fd.key]: v } as ImportMapping;
                          if (fd.key === 'amount' && v != null) Object.assign(m, { withdrawal: undefined, deposit: undefined });
                          if ((fd.key === 'withdrawal' || fd.key === 'deposit') && v != null) Object.assign(m, { amount: undefined, drCr: undefined });
                          setMapping(m);
                        }}
                      >
                        {!fd.required && <option value="">Select</option>}
                        {preview.headers.map((h, i) => (
                          <option key={i} value={i}>
                            {h || `Column ${i + 1}`}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="max-w-[220px] truncate text-slate-500">{mapping[fd.key] != null ? preview.sample[0]?.[mapping[fd.key] as number] : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 max-w-sm">
              <Field label="Date Format" required>
                <select className="input" value={fmt} onChange={(e) => setFmt(e.target.value as DateFormat)}>
                  {preview.dateFormats.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        )}
        {step === 2 && preview && (
          <div className="mx-auto max-w-4xl">
            <p className="mb-3 text-[13px] text-slate-600">
              The first {parsed.length} of {preview.total} rows as they will be imported. Rows with errors are skipped.
            </p>
            <table className="table rounded-md border border-slate-200">
              <thead>
                <tr>
                  <th className="pl-4">Date</th>
                  <th>Description</th>
                  <th>Reference#</th>
                  <th className="text-right">Deposits</th>
                  <th className="pr-4 text-right">Withdrawals</th>
                </tr>
              </thead>
              <tbody>
                {parsed.map((r) => (
                  <tr key={r.row} className={r.error ? 'bg-red-50/60' : undefined}>
                    <td className="pl-4">{r.date ? fmtDate(r.date) : <span className="text-red-600">Invalid</span>}</td>
                    <td>
                      {r.description}
                      {r.error && <div className="text-xs text-red-600">{r.error}</div>}
                    </td>
                    <td>{r.reference}</td>
                    <td className="text-right tabular-nums">{r.deposit ? money(r.deposit) : ''}</td>
                    <td className="pr-4 text-right tabular-nums">{r.withdrawal ? money(r.withdrawal) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <FormFooter>
        {step > 0 && (
          <button className="btn-secondary" onClick={() => setStep(step - 1)}>
            Previous
          </button>
        )}
        <button className="btn-primary" disabled={loadPreview.isPending || run.isPending} onClick={next}>
          {step === 2 ? 'Import' : 'Next'}
        </button>
        <button className="btn-secondary" onClick={() => navigate(-1)}>
          Cancel
        </button>
      </FormFooter>
    </div>
  );
}
