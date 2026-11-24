// Cross-module widgets: attachments, email composer, share links, journal table,
// comments editor, activity timeline and the purchase-module lifecycle diagrams.
import { useRef, useState, type ReactNode } from 'react';
import { Bold, Italic, Underline, Paperclip, Upload, Trash2, Link2, ArrowRight, FileText, FolderOpen } from 'lucide-react';
import { money, fmtDateTime, fmtDate, today, addDays } from '@shared/format';
import type { Activity, Attachment, Comment, Journal, ShareLink } from '@shared/types';
import { api, useAction, useApi, qs } from '../api';
import { useAccounts, useOrg } from '../lib/app';
import { toast } from '../lib/toast';
import { Checkbox, DateInput, Field, Modal, clsx } from './ui';

// ------------------------------------------------------------ attachments

export function Attachments({ value, onChange, max = 10, maxMB = 10, label = 'Attach File(s)', compact }: { value: Attachment[]; onChange: (v: Attachment[]) => void; max?: number; maxMB?: number; label?: string; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [pick, setPick] = useState(false);
  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (value.length + list.length > max) return toast.error(`You can upload a maximum of ${max} files`);
    const tooBig = list.find((f) => f.size > maxMB * 1024 * 1024);
    if (tooBig) return toast.error(`${tooBig.name} is larger than ${maxMB}MB`);
    const fd = new FormData();
    list.forEach((f) => fd.append('files', f));
    setBusy(true);
    try {
      const up = await api<Attachment[]>('/uploads', { body: fd });
      onChange([...value, ...up]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      {!compact && <div className="mb-1 text-[13px] text-slate-700">{label}</div>}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          upload(e.dataTransfer.files);
        }}
        className={clsx('inline-flex items-center gap-2 rounded-md border border-dashed px-3 py-2', drag ? 'border-brand-500 bg-brand-50' : 'border-slate-300')}
      >
        <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => input.current?.click()}>
          <Upload size={13} /> {busy ? 'Uploading…' : 'Upload File'}
        </button>
        <button type="button" className="btn-ghost btn-sm" disabled={value.length >= max} onClick={() => setPick(true)}>
          <FolderOpen size={13} /> From Documents
        </button>
        <span className="text-xxs text-slate-500">
          You can upload a maximum of {max} files, {maxMB}MB each
        </span>
        <input ref={input} type="file" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
      </div>
      {value.length > 0 && (
        <ul className="mt-2 space-y-1">
          {value.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-[13px]">
              <Paperclip size={13} className="text-slate-400" />
              <a href={a.url} target="_blank" rel="noreferrer" className="link">
                {a.name}
              </a>
              <span className="text-xxs text-slate-400">{(a.size / 1024).toFixed(1)} KB</span>
              <button type="button" aria-label={`Remove ${a.name}`} className="text-slate-400 hover:text-red-500" onClick={() => onChange(value.filter((x) => x.id !== a.id))}>
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {pick && <DocumentsPicker exclude={value.map((a) => a.id)} room={max - value.length} onClose={() => setPick(false)} onPick={(xs) => onChange([...value, ...xs])} />}
    </div>
  );
}

/** "Attach from Documents": pick files already uploaded to the Documents inboxes or folders. */
function DocumentsPicker({ exclude, room, onClose, onPick }: { exclude: string[]; room: number; onClose: () => void; onPick: (a: Attachment[]) => void }) {
  const [search, setSearch] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const { data = [] } = useApi<(Attachment & { kind: string; trashedAt?: string; folderName?: string; inbox?: string; links: unknown[] })[]>(`/documents${qs({ view: 'all', search })}`);
  const rows = data.filter((d) => d.kind === 'inbox' && !exclude.includes(d.id));
  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-xl"
      title="Attach from Documents"
      footer={
        <>
          <button
            type="button"
            className="btn-primary"
            disabled={!sel.length}
            onClick={() => {
              onPick(rows.filter((r) => sel.includes(r.id)).map(({ id, name, size, mimeType, url, uploadedAt }) => ({ id, name, size, mimeType, url, uploadedAt })));
              onClose();
            }}
          >
            Attach {sel.length ? `(${sel.length})` : ''}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <input className="input mb-3" placeholder="Search files" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="max-h-72 overflow-y-auto rounded-md border border-slate-200">
        {rows.map((r) => (
          <label key={r.id} className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2 text-[13px] last:border-0 hover:bg-slate-50">
            <input
              type="checkbox"
              className="accent-brand-600"
              checked={sel.includes(r.id)}
              disabled={!sel.includes(r.id) && sel.length >= room}
              onChange={(e) => setSel(e.target.checked ? [...sel, r.id] : sel.filter((x) => x !== r.id))}
            />
            <FileText size={14} className="text-slate-400" />
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            <span className="text-xxs text-slate-400">{r.folderName ?? (r.inbox === 'bank_statements' ? 'Bank Statements' : 'Files')}</span>
            {r.links.length > 0 && <span className="text-xxs text-emerald-600">In use</span>}
          </label>
        ))}
        {!rows.length && <div className="px-3 py-8 text-center text-[13px] text-slate-500">No files in Documents. Upload files under Documents first.</div>}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ email composer & share links
// (see components/email for the composer, the email log and the share-link manager)

export { EmailModal, type EmailOptions } from './email/EmailComposer';
export { ShareModal } from './email/ShareModal';
export { MailLog } from './email/MailLog';

// ------------------------------------------------------------ journal

export function JournalTable({ journals, title = 'Journal' }: { journals: Journal[]; title?: string }) {
  const accounts = useAccounts();
  const name = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;
  if (!journals.length) return <div className="rounded-md border border-dashed border-slate-300 p-4 text-center text-slate-500">No journal entries. Draft and void documents do not post to the ledger.</div>;
  return (
    <div className="space-y-4">
      {journals.map((j) => {
        const dr = j.lines.reduce((s, l) => s + l.debit, 0);
        const cr = j.lines.reduce((s, l) => s + l.credit, 0);
        return (
          <div key={j.id}>
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
              <span className="font-semibold text-slate-700">
                {title} · {j.number}
              </span>
              <span>
                {fmtDate(j.date)} · {j.sourceType.replace(/_/g, ' ')}
              </span>
            </div>
            <table className="table rounded-md border border-slate-200">
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="text-right">Debit</th>
                  <th className="text-right">Credit</th>
                </tr>
              </thead>
              <tbody>
                {j.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{name(l.accountId)}</td>
                    <td className="text-right tabular-nums">{l.debit ? money(l.debit, '') : '0.00'}</td>
                    <td className="text-right tabular-nums">{l.credit ? money(l.credit, '') : '0.00'}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td />
                  <td className="text-right tabular-nums">{money(dr, '')}</td>
                  <td className="text-right tabular-nums">{money(cr, '')}</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------ comments

export function Comments({ entityType, entityId }: { entityType: string; entityId: string }) {
  const editor = useRef<HTMLDivElement>(null);
  const { data = [] } = useApi<Comment[]>(`/comments${qs({ entityId })}`);
  const add = useAction((html: string) => api('/comments', { body: { entityType, entityId, html } }), 'Comment added');
  const del = useAction((id: string) => api(`/comments/${id}`, { method: 'DELETE' }));
  const cmd = (c: string) => {
    editor.current?.focus();
    document.execCommand(c);
  };
  return (
    <div className="max-w-3xl">
      <div className="rounded-md border border-slate-300">
        <div className="flex gap-1 border-b border-slate-200 bg-slate-50 px-2 py-1">
          <button type="button" className="btn-ghost btn-sm w-7 px-0" title="Bold" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('bold')}>
            <Bold size={14} />
          </button>
          <button type="button" className="btn-ghost btn-sm w-7 px-0" title="Italic" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('italic')}>
            <Italic size={14} />
          </button>
          <button type="button" className="btn-ghost btn-sm w-7 px-0" title="Underline" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('underline')}>
            <Underline size={14} />
          </button>
        </div>
        <div ref={editor} contentEditable role="textbox" aria-label="Comment" className="min-h-[90px] px-3 py-2 text-[13px] outline-none [&:empty]:before:text-slate-400 [&:empty]:before:content-['Write_a_comment…']" />
      </div>
      <button
        className="btn-primary mt-2"
        disabled={add.isPending}
        onClick={() => {
          const html = editor.current?.innerHTML || '';
          add.mutate(html, { onSuccess: () => editor.current && (editor.current.innerHTML = '') });
        }}
      >
        Add Comment
      </button>
      <div className="mt-6">
        <div className="mb-2 text-xs font-semibold uppercase text-slate-500">All Comments</div>
        {data.length === 0 && <div className="text-slate-400">No comments yet.</div>}
        <ul className="space-y-3">
          {data.map((c) => (
            <li key={c.id} className="group rounded-md border border-slate-200 p-3">
              <div className="mb-1 flex items-center justify-between text-xxs text-slate-500">
                <span className="font-semibold text-slate-700">{c.author}</span>
                <span className="flex items-center gap-2">
                  {fmtDateTime(c.createdAt)}
                  <button className="invisible text-slate-400 hover:text-red-500 group-hover:visible" onClick={() => del.mutate(c.id)} aria-label="Delete comment">
                    <Trash2 size={12} />
                  </button>
                </span>
              </div>
              <div className="prose-sm" dangerouslySetInnerHTML={{ __html: c.html }} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function Timeline({ entityId, contactId }: { entityId?: string; contactId?: string }) {
  const { data = [] } = useApi<Activity[]>(`/activities${qs({ entityId, contactId })}`);
  if (!data.length) return <div className="text-slate-400">No activity yet.</div>;
  return (
    <ol className="relative ml-3 border-l border-slate-200">
      {data.map((a) => (
        <li key={a.id} className="mb-4 ml-4">
          <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand-500" />
          <div className="text-xxs text-slate-400">{fmtDateTime(a.createdAt)}</div>
          <div className="rounded-md bg-slate-50 px-3 py-2">
            <div className="font-medium text-slate-800">{a.message}</div>
            {a.detail && <div className="text-xs text-slate-600">{a.detail}</div>}
            <div className="mt-0.5 text-xxs text-slate-400">by {a.author}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ------------------------------------------------------------ lifecycle empty states

export function Lifecycle({ title, subtitle, steps, actions }: { title: string; subtitle?: string; steps: (string | string[])[]; actions: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="text-lg font-semibold text-slate-800">{title}</div>
      {subtitle && <div className="mt-1 max-w-lg text-slate-500">{subtitle}</div>}
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div>
      <div className="mt-10 text-xs font-semibold uppercase tracking-wider text-slate-400">Life cycle</div>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            {Array.isArray(s) ? (
              <div className="flex flex-col gap-2">
                {s.map((x) => (
                  <span key={x} className="rounded-md border border-brand-200 bg-brand-50 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-brand-700">
                    {x}
                  </span>
                ))}
              </div>
            ) : (
              <span className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold tracking-wide text-slate-700 shadow-sm">{s}</span>
            )}
            {i < steps.length - 1 && <ArrowRight size={16} className="text-slate-400" />}
          </div>
        ))}
      </div>
    </div>
  );
}

export function MoneyText({ v, className }: { v: number; className?: string }) {
  return <span className={clsx('tabular-nums', className)}>{money(v)}</span>;
}
