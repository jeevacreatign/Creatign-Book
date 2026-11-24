// Zoho-style "Email To" composer: template picker, To/Cc/Bcc recipient chips,
// placeholders, PDF + file attachments, an optional "View" link button and a live
// preview of the branded email the customer receives.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AlertTriangle, Braces, Eye, FileText, Link2, Mail, Paperclip, PenLine, Upload, X } from 'lucide-react';
import { placeholdersFor, type EmailTemplateKind } from '@shared/email';
import type { Attachment } from '@shared/types';
import { ApiError, api, qs, useApi } from '../../api';
import { toast } from '../../lib/toast';
import { useQueryClient } from '@tanstack/react-query';
import { Checkbox, Modal, clsx } from '../ui';

export interface EmailOptions {
  open: boolean;
  onClose: () => void;
  title: string;
  /** fallbacks when the email has no template (e.g. a plain email to a contact) */
  to: string[];
  subject: string;
  body: string;
  contactId?: string;
  entityType?: string;
  entityId?: string;
  /** legacy options; attachments now come from the server */
  attachmentOptions?: { key: string; label: string; defaultChecked?: boolean }[];
  showPayNow?: boolean;
  onSent?: () => void;
  /** e.g. the statement period to render as PDF */
  extra?: { statement?: { from: string; to: string; filter?: string } } & Record<string, unknown>;
}

interface Compose {
  kind?: EmailTemplateKind;
  templateId?: string;
  templates: { id: string; name: string; isDefault: boolean }[];
  from: { name: string; email: string };
  configured: boolean;
  provider?: string;
  recipients: { email: string; name: string; primary?: boolean }[];
  to: string[];
  subject: string;
  body: string;
  attachments: { key: string; label: string; kind: 'pdf' | 'file'; checked: boolean; size?: number }[];
  linkAvailable: boolean;
  linkLabel?: string;
  portalEnabled: boolean;
}

const EMAIL_RE = /^[^@\s<>(),;:"]+@[^@\s<>(),;:"]+\.[^@\s<>(),;:"]+$/;

function RecipientInput({ value, onChange, suggestions, label, autoFocus }: { value: string[]; onChange: (v: string[]) => void; suggestions: { email: string; name: string }[]; label: string; autoFocus?: boolean }) {
  const [text, setText] = useState('');
  const [focus, setFocus] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const add = (raw: string) => {
    const parts = raw.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
    if (!parts.length) return;
    const invalid = parts.find((p) => !EMAIL_RE.test(p));
    if (invalid) {
      toast.error(`"${invalid}" is not a valid email address`);
      setText(invalid);
      return;
    }
    onChange(Array.from(new Set([...value, ...parts.map((p) => p.toLowerCase())])));
    setText('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (['Enter', ',', ';', 'Tab', ' '].includes(e.key) && text.trim()) {
      e.preventDefault();
      add(text);
    } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
  };
  const open = focus && suggestions.some((s) => !value.includes(s.email) && (!text || `${s.name} ${s.email}`.toLowerCase().includes(text.toLowerCase())));
  const name = (e: string) => suggestions.find((s) => s.email === e)?.name;
  return (
    <div className="relative">
      <div className={clsx('flex min-h-8 flex-wrap items-center gap-1 rounded-md border bg-white px-1.5 py-1', focus ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-300')} onClick={() => input.current?.focus()}>
        {value.map((e) => (
          <span key={e} className="inline-flex max-w-full items-center gap-1 rounded-full border border-brand-200 bg-brand-50 py-0.5 pl-2 pr-1 text-xs text-brand-800" title={e}>
            <span className="truncate">{name(e) ? `${name(e)} <${e}>` : e}</span>
            <button type="button" aria-label={`Remove ${e}`} className="rounded-full p-0.5 text-brand-500 hover:bg-brand-100 hover:text-brand-800" onClick={() => onChange(value.filter((x) => x !== e))}>
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          ref={input}
          aria-label={label}
          autoFocus={autoFocus}
          className="h-6 min-w-[140px] flex-1 border-0 bg-transparent px-1 text-[13px] outline-none"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          onFocus={() => setFocus(true)}
          onBlur={() => {
            setTimeout(() => setFocus(false), 150);
            if (text.trim()) add(text);
          }}
          placeholder={value.length ? '' : 'name@example.com'}
        />
      </div>
      {open && (
        <div className="menu left-0 right-0 max-h-48 overflow-y-auto">
          {suggestions
            .filter((s) => !value.includes(s.email) && (!text || `${s.name} ${s.email}`.toLowerCase().includes(text.toLowerCase())))
            .map((s) => (
              <button key={s.email} type="button" className="menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => onChange([...value, s.email])}>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xxs font-semibold text-slate-600">{(s.name || s.email)[0].toUpperCase()}</span>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-800">{s.name}</span>
                  <span className="block truncate text-xxs text-slate-500">{s.email}</span>
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

function Row({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-3 border-b border-slate-100 py-2">
      <div className={clsx('pt-1.5 text-[13px]', required ? 'text-red-600' : 'text-slate-500')}>
        {label}
        {required && '*'}
      </div>
      <div>{children}</div>
    </div>
  );
}

export function EmailModal(o: EmailOptions) {
  const statement = o.extra?.statement;
  const composeUrl = `/mail/compose${qs({ entityType: o.entityType, entityId: o.entityId, contactId: o.contactId, statementFrom: statement?.from, statementTo: statement?.to, statementFilter: statement?.filter })}`;
  const { data: c, error } = useApi<Compose>(o.open ? composeUrl : null, { staleTime: 0, gcTime: 0 });
  const qc = useQueryClient();
  const [ready, setReady] = useState(false);
  const [templateId, setTemplateId] = useState<string | undefined>();
  const [to, setTo] = useState<string[]>(o.to);
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState(o.subject);
  const [body, setBody] = useState(o.body);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [files, setFiles] = useState<Attachment[]>([]);
  const [includeLink, setIncludeLink] = useState(true);
  const [view, setView] = useState<'write' | 'preview'>('write');
  const [previewHtml, setPreviewHtml] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [phOpen, setPhOpen] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // first load: take the template's subject/body and the contact's recipients
  useEffect(() => {
    if (!c || ready) return;
    setTemplateId(c.templateId);
    if (c.to.length) setTo(c.to);
    if (c.subject) setSubject(c.subject);
    if (c.body) setBody(c.body);
    setChecked(Object.fromEntries(c.attachments.map((a) => [a.key, a.checked])));
    setIncludeLink(c.linkAvailable);
    setReady(true);
  }, [c, ready]);

  async function pickTemplate(id: string) {
    setTemplateId(id);
    try {
      const next = await api<Compose>(`${composeUrl}${composeUrl.includes('?') ? '&' : '?'}templateId=${encodeURIComponent(id)}`);
      setSubject(next.subject);
      setBody(next.body);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const payload = () => ({
    to,
    cc,
    bcc,
    subject,
    body,
    templateId,
    contactId: o.contactId,
    entityType: o.entityType,
    entityId: o.entityId,
    statement,
    attachPdf: !!c?.attachments.some((a) => a.kind === 'pdf' && checked[a.key]),
    attachmentIds: c?.attachments.filter((a) => a.kind === 'file' && checked[a.key]).map((a) => a.key) || [],
    files,
    includeLink: !!c?.linkAvailable && includeLink,
  });

  useEffect(() => {
    if (view !== 'preview') return;
    let live = true;
    fetch('/api/mail/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) })
      .then((r) => r.text())
      .then((html) => live && setPreviewHtml(html))
      .catch(() => live && setPreviewHtml('<p style="font-family:sans-serif;color:#b42318">Could not load the preview.</p>'));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const placeholders = useMemo(() => (c?.kind ? placeholdersFor(c.kind) : []), [c?.kind]);
  function insert(token: string) {
    const el = bodyRef.current;
    const t = `%${token}%`;
    if (!el) return setBody(body + t);
    const s = el.selectionStart ?? body.length;
    const e = el.selectionEnd ?? body.length;
    setBody(body.slice(0, s) + t + body.slice(e));
    setPhOpen(false);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + t.length, s + t.length);
    });
  }

  async function upload(list: FileList) {
    const arr = Array.from(list);
    if (files.length + arr.length > 10) return toast.error('You can attach up to 10 files');
    const big = arr.find((f) => f.size > 10 * 1024 * 1024);
    if (big) return toast.error(`${big.name} is larger than 10MB`);
    const fd = new FormData();
    arr.forEach((f) => fd.append('files', f));
    setUploading(true);
    try {
      setFiles([...files, ...(await api<Attachment[]>('/uploads', { body: fd }))]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function send() {
    if (!to.length) return toast.error('Add at least one recipient');
    if (!subject.trim()) return toast.error('Subject is required');
    setBusy(true);
    try {
      const r = await api<{ status?: string }>('/mails', { body: payload() });
      qc.invalidateQueries();
      toast.success(r.status === 'outbox' ? 'Saved to the outbox. Email sending is not set up yet, so nothing was delivered (Settings > Emails).' : 'Your email has been sent.');
      o.onSent?.();
      o.onClose();
    } catch (e) {
      qc.invalidateQueries();
      toast.error(e instanceof ApiError ? e.message : 'The email could not be sent');
    } finally {
      setBusy(false);
    }
  }

  const totalKb = files.reduce((s, f) => s + f.size, 0) / 1024;

  return (
    <Modal
      open={o.open}
      onClose={o.onClose}
      title={o.title}
      width="max-w-3xl"
      footer={
        <>
          <button className="btn-primary" disabled={busy || !ready} onClick={send}>
            <Mail size={14} /> {busy ? 'Sending…' : 'Send'}
          </button>
          <button className="btn-secondary" onClick={o.onClose}>
            Cancel
          </button>
          {c && !c.configured && (
            <span className="ml-auto flex max-w-[340px] items-start gap-1.5 text-right text-xxs leading-4 text-amber-700">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              Email sending is not set up, so this goes to the outbox and is not delivered. Set up SMTP or Gmail in Settings &gt; Emails.
            </span>
          )}
        </>
      }
    >
      {error ? (
        <div className="text-red-600">{(error as Error).message}</div>
      ) : (
        <div className="-mt-2">
          <Row label="From">
            <div className="flex items-center justify-between gap-2 pt-1.5">
              <span className="truncate text-slate-700">
                {c?.from.name} &lt;{c?.from.email}&gt;
              </span>
              {c && c.templates.length > 0 && (
                <label className="flex items-center gap-2 text-xs text-slate-500">
                  Template
                  <select className="input h-7 w-52 py-0 text-xs" value={templateId} onChange={(e) => pickTemplate(e.target.value)} aria-label="Email template">
                    {c.templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.isDefault ? ' (default)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </Row>
          <Row label="Send To" required>
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <RecipientInput label="Send to" value={to} onChange={setTo} suggestions={c?.recipients || []} />
              </div>
              <div className="flex gap-1 pt-1 text-xs">
                {!showCc && (
                  <button type="button" className="link" onClick={() => setShowCc(true)}>
                    Cc
                  </button>
                )}
                {!showBcc && (
                  <button type="button" className="link" onClick={() => setShowBcc(true)}>
                    Bcc
                  </button>
                )}
              </div>
            </div>
          </Row>
          {showCc && (
            <Row label="Cc">
              <RecipientInput label="Cc" value={cc} onChange={setCc} suggestions={c?.recipients || []} autoFocus />
            </Row>
          )}
          {showBcc && (
            <Row label="Bcc">
              <RecipientInput label="Bcc" value={bcc} onChange={setBcc} suggestions={c?.recipients || []} autoFocus />
            </Row>
          )}
          <Row label="Subject" required>
            <input className="input" aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Row>

          <div className="mt-3 flex items-center justify-between">
            <div className="flex rounded-md border border-slate-200 bg-slate-50 p-0.5 text-xs">
              <button type="button" className={clsx('flex items-center gap-1 rounded px-2.5 py-1', view === 'write' ? 'bg-white font-medium text-slate-900 shadow-sm' : 'text-slate-600')} onClick={() => setView('write')}>
                <PenLine size={12} /> Write
              </button>
              <button type="button" className={clsx('flex items-center gap-1 rounded px-2.5 py-1', view === 'preview' ? 'bg-white font-medium text-slate-900 shadow-sm' : 'text-slate-600')} onClick={() => setView('preview')}>
                <Eye size={12} /> Preview
              </button>
            </div>
            {view === 'write' && placeholders.length > 0 && (
              <div className="relative">
                <button type="button" className="btn-ghost btn-sm" onClick={() => setPhOpen((x) => !x)}>
                  <Braces size={13} /> Insert Placeholder
                </button>
                {phOpen && (
                  <div className="menu right-0 max-h-72 w-72 overflow-y-auto">
                    {placeholders.map((p) => (
                      <button key={p.key} type="button" className="menu-item justify-between" onClick={() => insert(p.key)}>
                        <span>{p.label}</span>
                        <code className="text-xxs text-slate-400">%{p.key}%</code>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {view === 'write' ? (
            <textarea ref={bodyRef} aria-label="Email body" className="input mt-2 min-h-[240px] font-sans leading-6" value={body} onChange={(e) => setBody(e.target.value)} />
          ) : (
            <iframe title="Email preview" sandbox="" srcDoc={previewHtml} className="mt-2 h-[420px] w-full rounded-md border border-slate-200 bg-slate-50" />
          )}

          {c?.linkAvailable && (
            <div className="mt-3 flex items-start gap-3 rounded-md border border-brand-100 bg-brand-50/60 p-3">
              <Link2 size={16} className="mt-0.5 shrink-0 text-brand-600" />
              <div className="flex-1">
                <Checkbox checked={includeLink} onChange={setIncludeLink} label={<span className="font-medium text-slate-800">Add a “{c.linkLabel}” button</span>} />
                <div className="ml-6 text-xxs text-slate-600">The customer can open it online, download the PDF{o.entityType === 'quote' ? ', and accept or decline' : o.entityType === 'invoice' ? ' and see how to pay' : ''} without signing in. The secure link expires automatically.</div>
              </div>
            </div>
          )}

          <div className="mt-3 rounded-md border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
              <div className="flex items-center gap-1.5 text-xxs font-semibold uppercase tracking-wide text-slate-500">
                <Paperclip size={12} /> Attachments
              </div>
              <button type="button" className="btn-ghost btn-sm" disabled={uploading} onClick={() => fileInput.current?.click()}>
                <Upload size={13} /> {uploading ? 'Uploading…' : 'Attach Files'}
              </button>
              <input ref={fileInput} type="file" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
            </div>
            <div className="space-y-1.5 px-3 py-2">
              {c?.attachments.map((a) => (
                <Checkbox
                  key={a.key}
                  checked={!!checked[a.key]}
                  onChange={(v) => setChecked({ ...checked, [a.key]: v })}
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      {a.kind === 'pdf' ? <FileText size={13} className="text-red-500" /> : <Paperclip size={13} className="text-slate-400" />}
                      {a.label}
                      {a.size ? <span className="text-xxs text-slate-400">{(a.size / 1024).toFixed(0)} KB</span> : null}
                    </span>
                  }
                />
              ))}
              {files.map((f) => (
                <div key={f.id} className="flex items-center gap-1.5 text-[13px]">
                  <Paperclip size={13} className="text-slate-400" />
                  {f.name}
                  <span className="text-xxs text-slate-400">{(f.size / 1024).toFixed(0)} KB</span>
                  <button type="button" aria-label={`Remove ${f.name}`} className="text-slate-400 hover:text-red-500" onClick={() => setFiles(files.filter((x) => x.id !== f.id))}>
                    <X size={13} />
                  </button>
                </div>
              ))}
              {!c?.attachments.length && !files.length && <div className="text-xs text-slate-400">No attachments.</div>}
              {totalKb > 15 * 1024 && <div className="text-xxs text-amber-700">Large attachments may be rejected by the customer’s mail server. Consider sending the link instead.</div>}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
