// Documents: Files and Bank Statements inboxes, folders, trash, preview, and attaching files to transactions.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Eye, FileImage, FileSpreadsheet, FileText, Folder, FolderInput, FolderPlus, Inbox, Landmark, Link2, MoreHorizontal, Paperclip, Pencil, RotateCcw, Trash2, Unlink, Upload, X } from 'lucide-react';
import { fmtDateTime } from '@shared/format';
import type { DocFolder, User } from '@shared/types';
import { api, qs, useAction, useApi } from '../../api';
import { toast } from '../../lib/toast';
import { Checkbox, Drawer, Dropdown, Field, MenuItem, Modal, Radio, SearchBox, Select, Spinner, clsx, useConfirm } from '../../components/ui';
import { ListHeader, useSelection } from '../../components/split';
import { ExportMenu } from '../../components/ExportMenu';

export interface DocLinkRow {
  type: string;
  id: string;
  label: string;
  path?: string;
}
export interface DocRow {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  url: string;
  uploadedAt: string;
  kind: 'inbox' | 'attachment';
  inbox?: 'files' | 'bank_statements';
  folderId?: string;
  folderName?: string;
  uploadedBy?: string;
  links: DocLinkRow[];
  status: 'associated' | 'unassociated' | 'imported';
  trashedAt?: string;
  importedToAccountId?: string;
  importedToAccountName?: string;
}
interface Summary {
  all: number;
  files: number;
  bankStatements: number;
  trash: number;
  folders: (DocFolder & { count: number })[];
}

const TARGETS: { value: string; label: string }[] = [
  { value: 'invoice', label: 'Invoice' },
  { value: 'bill', label: 'Bill' },
  { value: 'expense', label: 'Expense' },
  { value: 'payment_received', label: 'Client Payment' },
  { value: 'payment_made', label: 'Supplier Payment' },
  { value: 'credit_note', label: 'Credit Note' },
  { value: 'vendor_credit', label: 'Debit Note' },
  { value: 'quote', label: 'Estimate' },
  { value: 'sales_order', label: 'Sales Order' },
  { value: 'purchase_order', label: 'Purchase Order' },
  { value: 'delivery_challan', label: 'Delivery Challan' },
  { value: 'manual_journal', label: 'Journal Voucher' },
  { value: 'bank_transaction', label: 'Bank Transaction' },
  { value: 'customer', label: 'Client' },
  { value: 'vendor', label: 'Supplier' },
];

const MAX_MB = 10;
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(0.1, n / 1024).toFixed(1)} KB`);
const isImage = (d: { mimeType: string; name: string }) => d.mimeType.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(d.name);
const isPdf = (d: { mimeType: string; name: string }) => d.mimeType === 'application/pdf' || /\.pdf$/i.test(d.name);
const isSheet = (d: { name: string }) => /\.(csv|tsv|txt|xlsx?)$/i.test(d.name);

function FileIcon({ d, size = 16 }: { d: DocRow; size?: number }) {
  if (isImage(d)) return <FileImage size={size} className="shrink-0 text-violet-500" />;
  if (isPdf(d)) return <FileText size={size} className="shrink-0 text-red-500" />;
  if (isSheet(d)) return <FileSpreadsheet size={size} className="shrink-0 text-emerald-600" />;
  return <FileText size={size} className="shrink-0 text-slate-400" />;
}

type ViewKey = 'all' | 'files' | 'bank_statements' | 'folder' | 'trash';

export default function Documents() {
  const [sp, setSp] = useSearchParams();
  const view = (sp.get('view') as ViewKey) || 'files';
  const folderId = sp.get('folderId') || undefined;
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const { data: summary } = useApi<Summary>('/documents/summary');
  const { data: rows, isLoading } = useApi<DocRow[]>(`/documents${qs({ view, folderId, search, status })}`);
  const list = rows ?? [];
  const sel = useSelection(list.filter((r) => r.kind === 'inbox').map((r) => r.id));
  const exportRows = sel.selected.length ? list.filter((r) => r.kind === 'inbox' && sel.selected.includes(r.id)) : list;
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<DocRow | null>(null);
  const [rename, setRename] = useState<DocRow | null>(null);
  const [move, setMove] = useState<string[] | null>(null);
  const [attachTo, setAttachTo] = useState<DocRow | null>(null);
  const [folderForm, setFolderForm] = useState<DocFolder | 'new' | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const folder = summary?.folders.find((f) => f.id === folderId);
  const go = (v: ViewKey, fid?: string) => {
    sel.clear();
    setStatus('all');
    setSp(fid ? { view: v, folderId: fid } : { view: v });
  };

  const act = useAction(({ path, body, method }: { path: string; body?: unknown; method?: string }) => api(path, { method: method || 'POST', body }));
  const run = (path: string, msg: string, body?: unknown, method?: string) => act.mutate({ path, body, method }, { onSuccess: () => toast.success(msg) });
  const bulk = useAction((b: { action: string; folderId?: string }) => api<{ done: number; errors: string[] }>('/documents-bulk', { body: { ...b, ids: sel.selected } }), (r) => {
    sel.clear();
    if (r.errors.length) toast.error(r.errors.join('. '));
    return r.done ? `${r.done} file${r.done === 1 ? '' : 's'} updated` : undefined;
  });

  async function upload(files: FileList | File[]) {
    const fl = Array.from(files);
    if (!fl.length) return;
    if (fl.length > 10) return toast.error('You can upload up to 10 files at a time');
    const big = fl.find((f) => f.size > MAX_MB * 1024 * 1024);
    if (big) return toast.error(`${big.name} is larger than ${MAX_MB}MB`);
    const fd = new FormData();
    fl.forEach((f) => fd.append('files', f));
    fd.append('inbox', view === 'bank_statements' ? 'bank_statements' : 'files');
    if (view === 'folder' && folderId) fd.append('folderId', folderId);
    setBusy(true);
    try {
      await act.mutateAsync({ path: '/documents', body: fd });
      toast.success(`${fl.length} file${fl.length === 1 ? '' : 's'} uploaded`);
      if (view === 'all' || view === 'trash') go('files');
    } catch {
      // toast already shown
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  const title = view === 'all' ? 'All Files' : view === 'files' ? 'Uploads' : view === 'bank_statements' ? 'Bank Statements' : view === 'trash' ? 'Trash' : (folder?.name ?? 'Folder');
  const canUpload = view !== 'trash' && view !== 'all';

  const RailItem = ({ v, fid, icon, label, count }: { v: ViewKey; fid?: string; icon: React.ReactNode; label: string; count?: number }) => (
    <button onClick={() => go(v, fid)} className={clsx('flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-[13px]', view === v && folderId === fid ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-600 hover:bg-slate-100')}>
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {!!count && <span className="text-xs text-slate-400">{count}</span>}
    </button>
  );

  return (
    <div className="flex h-full min-h-0">
      <aside className="no-print hidden w-60 shrink-0 overflow-y-auto border-r border-slate-200 bg-white px-2 py-3 md:block">
        <div className="mb-1 px-3 text-xxs font-semibold uppercase tracking-wide text-slate-400">Inbox</div>
        <RailItem v="files" icon={<Inbox size={14} />} label="Uploads" count={summary?.files} />
        <RailItem v="bank_statements" icon={<Landmark size={14} />} label="Bank Statements" count={summary?.bankStatements} />
        <RailItem v="all" icon={<Paperclip size={14} />} label="All Files" count={summary?.all} />
        <div className="mb-1 mt-4 flex items-center justify-between px-3">
          <span className="text-xxs font-semibold uppercase tracking-wide text-slate-400">Folders</span>
          <button className="text-slate-400 hover:text-brand-600" onClick={() => setFolderForm('new')} aria-label="New folder" title="New folder">
            <FolderPlus size={14} />
          </button>
        </div>
        {summary?.folders.map((f) => (
          <div key={f.id} className="group relative">
            <RailItem v="folder" fid={f.id} icon={<Folder size={14} className="text-amber-500" />} label={f.name} count={f.count} />
          </div>
        ))}
        {summary && !summary.folders.length && (
          <button className="px-3 py-1 text-left text-xs text-brand-600 hover:underline" onClick={() => setFolderForm('new')}>
            + Create a folder
          </button>
        )}
        <div className="mt-4 border-t border-slate-100 pt-3">
          <RailItem v="trash" icon={<Trash2 size={14} />} label="Trash" count={summary?.trash} />
        </div>
      </aside>

      <div
        className={clsx('relative min-w-0 flex-1 overflow-y-auto', drag && 'bg-brand-50/40')}
        onDragOver={(e) => {
          if (!canUpload) return;
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={(e) => e.currentTarget === e.target && setDrag(false)}
        onDrop={(e) => {
          if (!canUpload) return;
          e.preventDefault();
          setDrag(false);
          upload(e.dataTransfer.files);
        }}
      >
        <ListHeader
          title={
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[19px]">{title}</h1>
              {view === 'folder' && folder && (
                <Dropdown button={() => <button className="btn-ghost btn-sm" aria-label="Folder options"><MoreHorizontal size={15} /></button>}>
                  <MenuItem icon={<Pencil size={13} />} onClick={() => setFolderForm(folder)}>
                    Edit Folder
                  </MenuItem>
                  <MenuItem danger icon={<Trash2 size={13} />} onClick={() => confirm.ask('Delete folder', `Delete the folder "${folder.name}"? It must be empty.`, () => act.mutate({ path: `/doc-folders/${folder.id}`, method: 'DELETE' }, { onSuccess: () => { toast.success('Folder deleted'); go('files'); } }), { danger: true, label: 'Delete' })}>
                    Delete Folder
                  </MenuItem>
                </Dropdown>
              )}
            </div>
          }
        >
          <ExportMenu rows={exportRows} filename={`documents-${view}`} label={sel.selected.length ? 'Export Selected' : 'Export'} columns={[
            { header: 'File Name', value: (d) => d.name },
            { header: 'Kind', value: (d) => d.kind },
            { header: 'Location', value: (d) => d.folderName || d.inbox || 'Attachment' },
            { header: 'Status', value: (d) => d.status },
            { header: 'Uploaded By', value: (d) => d.uploadedBy },
            { header: 'Uploaded On', value: (d) => d.uploadedAt },
            { header: 'Size (bytes)', value: (d) => d.size },
            { header: 'Imported To Account', value: (d) => d.importedToAccountName },
          ]} />
          <div className="w-full sm:w-60">
            <SearchBox value={search} onChange={(v) => { setSearch(v); sel.clear(); }} placeholder="Search file name or transaction" />
          </div>
          {view !== 'trash' && (
            <select className="input w-40" value={status} onChange={(e) => { setStatus(e.target.value); sel.clear(); }} aria-label="Status">
              <option value="all">All</option>
              <option value="associated">Associated</option>
              <option value="unassociated">Unassociated</option>
              {view === 'bank_statements' && <option value="imported">Imported</option>}
            </select>
          )}
          {view === 'trash' && !!list.length && (
            <button className="btn-secondary" onClick={() => confirm.ask('Empty Trash', 'Permanently delete every file in Trash? This cannot be undone.', () => run('/documents-trash/empty', 'Trash emptied'), { danger: true, label: 'Empty Trash' })}>
              Empty Trash
            </button>
          )}
          {canUpload && (
            <button className="btn-primary" disabled={busy} onClick={() => input.current?.click()}>
              <Upload size={14} /> {busy ? 'Uploading…' : 'Upload File'}
            </button>
          )}
          <input ref={input} type="file" multiple hidden accept={view === 'bank_statements' ? '.csv,.tsv,.txt' : undefined} onChange={(e) => e.target.files && upload(e.target.files)} />
        </ListHeader>

        {sel.selected.length > 0 && (
          <div className="no-print flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-5 py-2 text-[13px]">
            <span className="font-medium">{sel.selected.length} selected</span>
            {view === 'trash' ? (
              <>
                <button className="btn-secondary btn-sm" onClick={() => bulk.mutate({ action: 'restore' })}>
                  <RotateCcw size={13} /> Restore
                </button>
                <button className="btn-secondary btn-sm text-red-600" onClick={() => confirm.ask('Delete permanently', `Permanently delete ${sel.selected.length} file(s)?`, () => bulk.mutate({ action: 'delete' }), { danger: true, label: 'Delete' })}>
                  <Trash2 size={13} /> Delete Permanently
                </button>
              </>
            ) : (
              <>
                <button className="btn-secondary btn-sm" onClick={() => setMove(sel.selected)}>
                  <FolderInput size={13} /> Move to Folder
                </button>
                <button className="btn-secondary btn-sm" onClick={() => bulk.mutate({ action: 'trash' })}>
                  <Trash2 size={13} /> Move to Trash
                </button>
              </>
            )}
            <button className="ml-auto text-slate-400 hover:text-slate-600" onClick={sel.clear} aria-label="Clear selection">
              <X size={15} />
            </button>
          </div>
        )}

        {view === 'bank_statements' && (
          <div className="mx-5 mt-4 rounded-md border border-sky-200 bg-sky-50 px-4 py-2.5 text-[13px] text-sky-900">
            Upload CSV or TSV statements from your bank here, then choose <b>Import to Bank Account</b> to bring the lines into Banking for categorizing and matching.
          </div>
        )}
        {view === 'all' && (
          <div className="mx-5 mt-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-2.5 text-[13px] text-slate-600">
            Every file in your inboxes and folders, plus files attached directly to invoices, bills, expenses, payments, journals and contacts.
          </div>
        )}

        {isLoading ? (
          <Spinner />
        ) : (
          <div className="px-5 py-4">
            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
              <table className="table">
                <thead>
                  <tr>
                    <th className="w-8">
                      <Checkbox checked={sel.all} onChange={sel.toggleAll} label="" />
                    </th>
                    <th>File Name</th>
                    <th>Details</th>
                    {view !== 'folder' && <th className="hidden lg:table-cell">Location</th>}
                    <th className="hidden md:table-cell">Uploaded By</th>
                    <th>{view === 'trash' ? 'Deleted On' : 'Uploaded On'}</th>
                    <th className="text-right">Size</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {list.map((d) => (
                    <tr key={`${d.id}-${d.kind}-${d.links[0]?.id ?? ''}`} className="group hover:bg-slate-50">
                      <td>{d.kind === 'inbox' && <Checkbox checked={sel.selected.includes(d.id)} onChange={() => sel.toggle(d.id)} label="" />}</td>
                      <td className="max-w-[280px]">
                        <button className="flex min-w-0 items-center gap-2 text-left" onClick={() => setPreview(d)}>
                          <FileIcon d={d} />
                          <span className="truncate font-medium text-slate-800 group-hover:text-brand-700 group-hover:underline">{d.name}</span>
                        </button>
                      </td>
                      <td className="max-w-[300px]">
                        <Details d={d} />
                      </td>
                      {view !== 'folder' && (
                        <td className="hidden text-slate-500 lg:table-cell">
                          {d.kind === 'attachment' ? 'Attachment' : d.folderName ? (
                            <span className="inline-flex items-center gap-1">
                              <Folder size={12} className="text-amber-500" /> {d.folderName}
                            </span>
                          ) : d.inbox === 'bank_statements' ? 'Bank Statements' : 'Uploads'}
                        </td>
                      )}
                      <td className="hidden text-slate-500 md:table-cell">{d.uploadedBy || '—'}</td>
                      <td className="whitespace-nowrap text-slate-500">{fmtDateTime(d.trashedAt || d.uploadedAt)}</td>
                      <td className="whitespace-nowrap text-right text-slate-500">{kb(d.size)}</td>
                      <td className="text-right">
                        <RowMenu
                          d={d}
                          onPreview={() => setPreview(d)}
                          onRename={() => setRename(d)}
                          onMove={() => setMove([d.id])}
                          onAttach={() => setAttachTo(d)}
                          onImport={() => navigate(`/banking/import?documentId=${d.id}`)}
                          onTrash={() => run(`/documents/${d.id}/trash`, 'Moved to Trash')}
                          onRestore={() => run(`/documents/${d.id}/restore`, 'File restored')}
                          onDelete={() => confirm.ask('Delete permanently', `Permanently delete ${d.name}? This cannot be undone.`, () => run(`/documents/${d.id}`, 'File deleted', undefined, 'DELETE'), { danger: true, label: 'Delete' })}
                        />
                      </td>
                    </tr>
                  ))}
                  {!list.length && (
                    <tr>
                      <td colSpan={8} className="py-16 text-center">
                        <EmptyState view={view} canUpload={canUpload} onUpload={() => input.current?.click()} searching={!!search || status !== 'all'} />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {canUpload && <p className="mt-2 text-xs text-slate-400">Drag and drop files anywhere on this page. Up to 10 files at a time, {MAX_MB}MB each.</p>}
          </div>
        )}
        {drag && (
          <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-lg border-2 border-dashed border-brand-400 bg-white/70 text-[15px] font-medium text-brand-700">
            Drop files to upload to {title}
          </div>
        )}
      </div>

      {preview && <PreviewDrawer d={preview} onClose={() => setPreview(null)} onAttach={() => setAttachTo(preview)} onDetach={(l) => act.mutate({ path: `/documents/${preview.id}/detach`, body: l }, { onSuccess: (r) => { toast.success('File removed from the transaction'); setPreview(r as DocRow); } })} onImport={() => navigate(`/banking/import?documentId=${preview.id}`)} />}
      {rename && <RenameModal d={rename} onClose={() => setRename(null)} />}
      {move && <MoveModal ids={move} folders={summary?.folders ?? []} onClose={() => { setMove(null); sel.clear(); }} />}
      {attachTo && <AttachModal d={attachTo} onClose={() => setAttachTo(null)} onDone={(r) => preview?.id === r.id && setPreview(r)} />}
      {folderForm && <FolderModal folder={folderForm === 'new' ? undefined : folderForm} onClose={() => setFolderForm(null)} onSaved={(f) => go('folder', f.id)} />}
      {confirm.node}
    </div>
  );
}

function Details({ d }: { d: DocRow }) {
  if (d.status === 'imported')
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px]">
        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xxs font-semibold uppercase text-emerald-700">Imported</span>
        {d.importedToAccountId ? <Link className="link truncate" to={`/banking/${d.importedToAccountId}`}>{d.importedToAccountName}</Link> : null}
      </span>
    );
  if (!d.links.length && d.inbox === 'bank_statements') return <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xxs font-semibold uppercase text-slate-600">Not imported</span>;
  if (!d.links.length) return <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xxs font-semibold uppercase text-amber-700">Unassociated</span>;
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {d.links.slice(0, 2).map((l) => (
        <span key={`${l.type}-${l.id}`} className="inline-flex min-w-0 items-center gap-1 text-[13px]">
          <Link2 size={12} className="shrink-0 text-slate-400" />
          {l.path ? <Link className="link truncate" to={l.path}>{l.label}</Link> : <span className="truncate">{l.label}</span>}
        </span>
      ))}
      {d.links.length > 2 && <span className="text-xs text-slate-400">+{d.links.length - 2} more</span>}
    </div>
  );
}

function EmptyState({ view, canUpload, onUpload, searching }: { view: ViewKey; canUpload: boolean; onUpload: () => void; searching: boolean }) {
  if (searching) return <div className="text-slate-500">No files match your search.</div>;
  const text =
    view === 'trash' ? 'Trash is empty. Files you delete stay here until you delete them permanently.'
    : view === 'bank_statements' ? 'Upload bank statements (CSV or TSV) to import them into Banking later.'
    : view === 'all' ? 'No documents yet. Files you upload or attach to transactions show up here.'
    : view === 'folder' ? 'This folder is empty. Upload files or move them here from your inbox.'
    : 'Upload receipts, bills and other files here, then attach them to transactions when you are ready.';
  return (
    <div className="mx-auto max-w-sm text-slate-500">
      <Upload className="mx-auto mb-3 text-slate-300" size={30} />
      <p className="mb-3 text-[13px]">{text}</p>
      {canUpload && (
        <button className="btn-primary" onClick={onUpload}>
          <Upload size={14} /> Upload File
        </button>
      )}
    </div>
  );
}

function RowMenu({ d, onPreview, onRename, onMove, onAttach, onImport, onTrash, onRestore, onDelete }: { d: DocRow; onPreview: () => void; onRename: () => void; onMove: () => void; onAttach: () => void; onImport: () => void; onTrash: () => void; onRestore: () => void; onDelete: () => void }) {
  return (
    <Dropdown align="right" button={() => <button className="btn-ghost btn-sm opacity-60 group-hover:opacity-100" aria-label={`Actions for ${d.name}`}><MoreHorizontal size={15} /></button>}>
      <MenuItem icon={<Eye size={13} />} onClick={onPreview}>
        Preview
      </MenuItem>
      <a className="menu-item" data-close href={d.url} download={d.name}>
        <Download size={13} /> Download
      </a>
      {d.kind === 'inbox' && !d.trashedAt && (
        <>
          <MenuItem icon={<Paperclip size={13} />} onClick={onAttach}>
            Attach to Transaction
          </MenuItem>
          {d.inbox === 'bank_statements' && (
            <MenuItem icon={<Landmark size={13} />} onClick={onImport}>
              Import to Bank Account
            </MenuItem>
          )}
          <MenuItem icon={<Pencil size={13} />} onClick={onRename}>
            Rename
          </MenuItem>
          <MenuItem icon={<FolderInput size={13} />} onClick={onMove}>
            Move to Folder
          </MenuItem>
          <MenuItem danger icon={<Trash2 size={13} />} onClick={onTrash} disabled={d.links.length > 0}>
            Move to Trash
          </MenuItem>
        </>
      )}
      {d.trashedAt && (
        <>
          <MenuItem icon={<RotateCcw size={13} />} onClick={onRestore}>
            Restore
          </MenuItem>
          <MenuItem danger icon={<Trash2 size={13} />} onClick={onDelete}>
            Delete Permanently
          </MenuItem>
        </>
      )}
    </Dropdown>
  );
}

function TextPreview({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(url)
      .then((r) => r.text())
      .then((t) => live && setText(t.slice(0, 20000)))
      .catch(() => live && setText(''));
    return () => {
      live = false;
    };
  }, [url]);
  if (text === null) return <Spinner />;
  const lines = text.split(/\r?\n/).filter(Boolean).slice(0, 200);
  const delim = lines[0]?.includes('\t') ? '\t' : ',';
  const cells = lines.map((l) => l.split(delim).map((c) => c.replace(/^"|"$/g, '')));
  return (
    <div className="max-h-full overflow-auto rounded border border-slate-200 bg-white">
      <table className="table text-xs">
        <tbody>
          {cells.map((r, i) => (
            <tr key={i} className={i === 0 ? 'bg-slate-50 font-semibold' : ''}>
              {r.map((c, j) => (
                <td key={j} className="whitespace-nowrap py-1.5">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PreviewDrawer({ d, onClose, onAttach, onDetach, onImport }: { d: DocRow; onClose: () => void; onAttach: () => void; onDetach: (l: { type: string; id: string }) => void; onImport: () => void }) {
  return (
    <Drawer
      open
      onClose={onClose}
      width="max-w-5xl"
      title={
        <span className="flex min-w-0 items-center gap-2">
          <FileIcon d={d} /> <span className="truncate">{d.name}</span>
        </span>
      }
    >
      <div className="grid h-full min-h-[60vh] gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-h-[50vh] items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-100 p-3">
          {isImage(d) ? (
            <img src={d.url} alt={d.name} className="max-h-[70vh] max-w-full rounded object-contain shadow-sm" />
          ) : isPdf(d) ? (
            <iframe src={d.url} title={d.name} className="h-[70vh] w-full rounded bg-white" />
          ) : /\.(csv|tsv|txt)$/i.test(d.name) ? (
            <TextPreview url={d.url} />
          ) : (
            <div className="text-center text-slate-500">
              <FileText className="mx-auto mb-2 text-slate-300" size={36} />
              No preview for this file type.
              <div className="mt-3">
                <a className="btn-secondary" href={d.url} download={d.name}>
                  <Download size={14} /> Download
                </a>
              </div>
            </div>
          )}
        </div>
        <div className="space-y-4 text-[13px]">
          <dl className="space-y-2">
            <div>
              <dt className="text-xs text-slate-500">Uploaded</dt>
              <dd>{fmtDateTime(d.uploadedAt)}{d.uploadedBy ? ` by ${d.uploadedBy}` : ''}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Size</dt>
              <dd>{kb(d.size)}</dd>
            </div>
            {d.kind === 'inbox' && (
              <div>
                <dt className="text-xs text-slate-500">Location</dt>
                <dd>{d.folderName ?? (d.inbox === 'bank_statements' ? 'Bank Statements' : 'Uploads')}</dd>
              </div>
            )}
          </dl>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Associated With</span>
              {d.kind === 'inbox' && !d.trashedAt && (
                <button className="link text-xs" onClick={onAttach}>
                  + Attach
                </button>
              )}
            </div>
            {d.links.length ? (
              <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                {d.links.map((l) => (
                  <li key={`${l.type}-${l.id}`} className="flex items-center gap-2 px-3 py-2">
                    <Link2 size={13} className="shrink-0 text-slate-400" />
                    {l.path ? <Link className="link min-w-0 flex-1 truncate" to={l.path}>{l.label}</Link> : <span className="min-w-0 flex-1 truncate">{l.label}</span>}
                    {d.kind === 'inbox' && (
                      <button className="text-slate-400 hover:text-red-600" onClick={() => onDetach({ type: l.type, id: l.id })} aria-label={`Remove from ${l.label}`} title="Remove from transaction">
                        <Unlink size={13} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-md border border-dashed border-slate-300 px-3 py-3 text-slate-500">Not attached to any transaction yet.</p>
            )}
          </div>
          {d.inbox === 'bank_statements' && !d.trashedAt && (
            <div className="rounded-md border border-slate-200 p-3">
              {d.importedToAccountId ? (
                <p>
                  Imported into <Link className="link" to={`/banking/${d.importedToAccountId}`}>{d.importedToAccountName}</Link>.
                </p>
              ) : (
                <p className="mb-2 text-slate-600">This statement has not been imported yet.</p>
              )}
              <button className="btn-secondary btn-sm mt-2" onClick={onImport}>
                <Landmark size={13} /> {d.importedToAccountId ? 'Import Again' : 'Import to Bank Account'}
              </button>
            </div>
          )}
          <a className="btn-secondary w-full justify-center" href={d.url} download={d.name}>
            <Download size={14} /> Download
          </a>
        </div>
      </div>
    </Drawer>
  );
}

function RenameModal({ d, onClose }: { d: DocRow; onClose: () => void }) {
  const ext = d.name.match(/\.[^.]+$/)?.[0] ?? '';
  const [name, setName] = useState(ext ? d.name.slice(0, -ext.length) : d.name);
  const save = useAction(() => api(`/documents/${d.id}`, { method: 'PUT', body: { name } }), 'File renamed');
  return (
    <Modal
      open
      onClose={onClose}
      title="Rename File"
      footer={
        <>
          <button className="btn-primary" disabled={save.isPending || !name.trim()} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            Save
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <Field label="File Name" required inline={false}>
        <div className="flex flex-wrap items-center gap-2">
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && save.mutate(undefined, { onSuccess: onClose })} />
          {ext && <span className="text-slate-500">{ext}</span>}
        </div>
      </Field>
    </Modal>
  );
}

function MoveModal({ ids, folders, onClose }: { ids: string[]; folders: DocFolder[]; onClose: () => void }) {
  const [folderId, setFolderId] = useState('');
  const save = useAction(() => api('/documents-bulk', { body: { ids, action: 'move', folderId: folderId || undefined } }), folderId ? 'Moved to folder' : 'Moved back to inbox');
  return (
    <Modal
      open
      onClose={onClose}
      title={`Move ${ids.length === 1 ? 'File' : `${ids.length} Files`}`}
      footer={
        <>
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            Move
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <Field label="Move to" inline={false}>
        <Select value={folderId} onChange={(e) => setFolderId(e.target.value)} options={[{ value: '', label: 'Inbox (no folder)' }, ...folders.map((f) => ({ value: f.id, label: f.name }))]} />
      </Field>
      {!folders.length && <p className="mt-2 text-xs text-slate-500">You have no folders yet. Create one from the Folders section on the left.</p>}
    </Modal>
  );
}

function AttachModal({ d, onClose, onDone }: { d: DocRow; onClose: () => void; onDone: (r: DocRow) => void }) {
  const [type, setType] = useState('expense');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string>('');
  const { data: targets, isLoading } = useApi<{ type: string; id: string; label: string; date?: string }[]>(`/documents/attach-targets${qs({ type, search })}`);
  const linked = useMemo(() => new Set(d.links.filter((l) => l.type === type).map((l) => l.id)), [d, type]);
  const save = useAction(() => api<DocRow>(`/documents/${d.id}/attach`, { body: { type, id: picked } }), 'File attached');
  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-xl"
      title="Attach to Transaction"
      footer={
        <>
          <button className="btn-primary" disabled={!picked || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: (r) => { onDone(r); onClose(); } })}>
            Attach
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="mb-3 flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-[13px]">
        <FileIcon d={d} size={14} /> <span className="truncate">{d.name}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
        <Select
          aria-label="Transaction type"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPicked('');
          }}
          options={TARGETS}
        />
        <SearchBox value={search} onChange={setSearch} placeholder="Search by number, contact or reference" />
      </div>
      <div className="mt-3 max-h-72 overflow-y-auto rounded-md border border-slate-200">
        {isLoading ? (
          <Spinner />
        ) : targets?.length ? (
          targets.map((t) => (
            <label key={t.id} className={clsx('flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2 text-[13px] last:border-0', picked === t.id ? 'bg-brand-50' : 'hover:bg-slate-50', linked.has(t.id) && 'opacity-60')}>
              <input type="radio" name="target" className="accent-brand-600" checked={picked === t.id} disabled={linked.has(t.id)} onChange={() => setPicked(t.id)} />
              <span className="min-w-0 flex-1 truncate">{t.label}</span>
              {linked.has(t.id) ? <span className="text-xs text-slate-400">Attached</span> : t.date ? <span className="text-xs text-slate-400">{t.date.split('-').reverse().join('/')}</span> : null}
            </label>
          ))
        ) : (
          <div className="px-3 py-8 text-center text-[13px] text-slate-500">No matching records.</div>
        )}
      </div>
    </Modal>
  );
}

function FolderModal({ folder, onClose, onSaved }: { folder?: DocFolder; onClose: () => void; onSaved: (f: DocFolder) => void }) {
  const [name, setName] = useState(folder?.name ?? '');
  const [permission, setPermission] = useState<'all' | 'custom'>(folder?.permission ?? 'all');
  const [userIds, setUserIds] = useState<string[]>(folder?.userIds ?? []);
  const { data: users = [] } = useApi<User[]>('/users');
  const save = useAction(() => api<DocFolder>(folder ? `/doc-folders/${folder.id}` : '/doc-folders', { method: folder ? 'PUT' : 'POST', body: { name, permission, userIds } }), folder ? 'Folder updated' : 'Folder created');
  return (
    <Modal
      open
      onClose={onClose}
      title={folder ? 'Edit Folder' : 'New Folder'}
      footer={
        <>
          <button className="btn-primary" disabled={save.isPending || !name.trim()} onClick={() => save.mutate(undefined, { onSuccess: (f) => { onSaved(f); onClose(); } })}>
            Save
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Folder Name" required inline={false}>
          <input className="input" autoFocus maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Permissions" inline={false}>
          <Radio
            name="perm"
            value={permission}
            onChange={setPermission}
            options={[
              { value: 'all', label: 'All users' },
              { value: 'custom', label: 'Only selected users' },
            ]}
          />
        </Field>
        {permission === 'custom' && (
          <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-md border border-slate-200 p-3">
            {users.filter((u) => u.status === 'active').map((u) => (
              <div key={u.id}>
                <Checkbox checked={userIds.includes(u.id)} onChange={(v) => setUserIds(v ? [...userIds, u.id] : userIds.filter((x) => x !== u.id))} label={`${u.name} · ${u.role}`} />
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
