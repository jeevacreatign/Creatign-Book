// Settings > Emails: how email is delivered (Gmail / SMTP / outbox), the email
// templates with placeholders, and the log of every email sent from the app.
import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { AlertTriangle, Braces, CheckCircle2, Inbox, Mail, Plus, RotateCcw, Send, Server, Star, Trash2 } from 'lucide-react';
import { EMAIL_TEMPLATE_KINDS, placeholdersFor, templateKindMeta, type EmailTemplate, type EmailTemplateKind } from '@shared/email';
import { fmtDateTime } from '@shared/format';
import { api, qs, useAction, useApi } from '../../api';
import { MailPreview, MailStatus, type MailRow } from '../../components/email/MailLog';
import { linkGmail } from '../../components/email/useGmailLink';
import { useOrg } from '../../lib/app';
import { Drawer, Field, SearchBox, Select, Spinner, clsx, useConfirm } from '../../components/ui';

interface MailSettings {
  configured: boolean;
  from?: string;
  fromName?: string;
  provider?: 'google-oauth' | 'smtp';
  source?: 'settings' | 'env';
  forcedOutbox: boolean;
  googleConnected: boolean;
  googleOAuthConfigured: boolean;
  googleCallbackOrigin: string;
  envSmtpConfigured: boolean;
  smtp: { enabled: boolean; host: string; port: number; security: 'ssl' | 'starttls' | 'none'; user?: string; fromName?: string; fromEmail?: string; replyTo?: string; hasPassword: boolean };
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={clsx('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition', on ? 'bg-brand-600' : 'bg-slate-300')}>
      <span className={clsx('inline-block h-4 w-4 rounded-full bg-white shadow transition', on ? 'translate-x-[18px]' : 'translate-x-0.5')} />
    </button>
  );
}

export { Switch };

export default function EmailSettings() {
  const tabs = [
    { to: '/settings/emails', label: 'Delivery', end: true },
    { to: '/settings/emails/templates', label: 'Templates' },
    { to: '/settings/emails/log', label: 'Email Log' },
  ];
  return (
    <div className="max-w-5xl">
      <div className="mb-1 text-[15px] font-semibold">Emails</div>
      <div className="mb-4 text-slate-600">Send quotes, invoices, receipts, statements and portal invitations from your own address, with templates your team can reuse.</div>
      <div className="mb-5 flex gap-6 border-b border-slate-200">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => clsx('tab', isActive && 'tab-active')}>
            {t.label}
          </NavLink>
        ))}
      </div>
      <Routes>
        <Route index element={<Delivery />} />
        <Route path="templates" element={<Templates />} />
        <Route path="log" element={<Log />} />
      </Routes>
    </div>
  );
}

// ------------------------------------------------------------ delivery

function Delivery() {
  const org = useOrg();
  const { data: s, refetch } = useApi<MailSettings>('/mail-settings');
  const [f, setF] = useState<MailSettings['smtp'] & { password?: string }>();
  const [testTo, setTestTo] = useState(org.email);
  useEffect(() => {
    if (s && !f) setF({ ...s.smtp, password: '' });
  }, [s, f]);
  const save = useAction(() => api<MailSettings>('/mail-settings', { method: 'PUT', body: f }), 'Email settings saved');
  const test = useAction(() => api<{ status: string }>('/mail-settings/test', { body: { to: testTo } }), (r) => (r.status === 'outbox' ? 'Saved to the outbox: no mail server is set up yet' : `Test email sent to ${testTo}`));
  const disconnect = useAction(() => api('/mail/google/account', { method: 'DELETE' }), 'Gmail account disconnected');
  if (!s || !f) return <Spinner />;
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const active = s.forcedOutbox ? 'Outbox (MAIL_TRANSPORT=outbox)' : s.provider === 'google-oauth' ? `Gmail (${s.from})` : s.provider === 'smtp' ? `SMTP ${s.source === 'env' ? 'from .env' : 'from these settings'} (${s.from})` : 'Outbox (not set up)';
  return (
    <div className="space-y-6">
      <div className={clsx('flex items-start gap-3 rounded-lg border p-4', s.configured ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50')}>
        {s.configured ? <CheckCircle2 className="mt-0.5 text-emerald-600" size={18} /> : <AlertTriangle className="mt-0.5 text-amber-600" size={18} />}
        <div className="flex-1">
          <div className="font-medium text-slate-900">Sending through: {active}</div>
          <div className="text-xs text-slate-600">
            {s.configured
              ? 'Emails are delivered to your customers. Every email is also kept in the Email Log.'
              : 'Nothing is delivered yet. Emails are kept in the outbox (Email Log) so you can preview them, and can be retried once sending is set up.'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input className="input h-8 w-56" aria-label="Send test email to" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          <button className="btn-secondary" disabled={test.isPending} onClick={() => test.mutate()}>
            <Send size={13} /> {test.isPending ? 'Sending…' : 'Send Test'}
          </button>
        </div>
      </div>

      <div className="card p-5">
        <div className="mb-1 flex items-center gap-2 font-semibold">
          <Mail size={16} className="text-red-500" /> Gmail account
        </div>
        <div className="mb-3 text-xs text-slate-600">Link a Google Workspace or Gmail account with OAuth. When linked, it is used ahead of SMTP and only gets permission to send email.</div>
        {s.googleConnected ? (
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">Connected as {s.from}</span>
            <button className="btn-secondary btn-sm" onClick={() => linkGmail(s, refetch)}>
              Switch account
            </button>
            <button className="btn-ghost btn-sm text-red-600" onClick={() => disconnect.mutate()}>
              Disconnect
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <button className="btn-secondary" onClick={() => linkGmail(s, refetch)}>
              Link Gmail Account
            </button>
            {!s.googleOAuthConfigured && <span className="text-xxs text-slate-500">Needs GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env (see README).</span>}
          </div>
        )}
      </div>

      <div className="card p-5">
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <Server size={16} className="text-brand-600" /> SMTP server
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            Use these settings <Switch on={f.enabled} onChange={(v) => set({ enabled: v })} label="Use SMTP settings" />
          </label>
        </div>
        <div className="mb-4 text-xs text-slate-600">
          Works with Gmail app passwords, Zoho Mail, Microsoft 365, Amazon SES, Mailgun and others. The password is stored encrypted. {s.envSmtpConfigured && !f.enabled && 'SMTP from your .env file is in use while this is off.'}
        </div>
        <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
          <Field label="SMTP Host" inline={false}>
            <input className="input" value={f.host} onChange={(e) => set({ host: e.target.value })} placeholder="smtp.gmail.com" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Port" inline={false}>
              <input className="input" type="number" value={f.port} onChange={(e) => set({ port: Number(e.target.value) })} />
            </Field>
            <Field label="Security" inline={false}>
              <Select
                value={f.security}
                onChange={(e) => {
                  const security = e.target.value as typeof f.security;
                  set({ security, port: security === 'ssl' ? 465 : security === 'starttls' ? 587 : f.port });
                }}
                options={[
                  { value: 'starttls', label: 'STARTTLS (587)' },
                  { value: 'ssl', label: 'SSL/TLS (465)' },
                  { value: 'none', label: 'None (local testing only)' },
                ]}
              />
            </Field>
          </div>
          <Field label="Username" inline={false}>
            <input className="input" autoComplete="off" value={f.user || ''} onChange={(e) => set({ user: e.target.value })} placeholder="you@yourcompany.in" />
          </Field>
          <Field label="Password" inline={false} hint={f.hasPassword ? 'A password is saved. Leave blank to keep it.' : 'For Gmail, use an app password.'}>
            <input className="input" type="password" autoComplete="new-password" value={f.password || ''} onChange={(e) => set({ password: e.target.value })} placeholder={f.hasPassword ? '••••••••' : ''} />
          </Field>
          <Field label="From Name" inline={false}>
            <input className="input" value={f.fromName || ''} onChange={(e) => set({ fromName: e.target.value })} placeholder={org.name} />
          </Field>
          <Field label="From Email" inline={false} hint="Must be allowed by your mail server. Defaults to the username.">
            <input className="input" value={f.fromEmail || ''} onChange={(e) => set({ fromEmail: e.target.value })} placeholder={f.user || 'billing@yourcompany.in'} />
          </Field>
          <Field label="Reply-To" inline={false} hint="Where customer replies go, if different.">
            <input className="input" value={f.replyTo || ''} onChange={(e) => set({ replyTo: e.target.value })} placeholder={org.email} />
          </Field>
        </div>
        <div className="mt-4 flex gap-2">
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: (r) => setF({ ...r.smtp, password: '' }) })}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ templates

function Templates() {
  const { data } = useApi<EmailTemplate[]>('/email-templates');
  const [edit, setEdit] = useState<EmailTemplate | { kind: EmailTemplateKind; new: true } | null>(null);
  if (!data) return <Spinner />;
  const groups = ['Sales', 'Purchases', 'Customer Portal'] as const;
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g}>
          <div className="mb-2 text-xxs font-semibold uppercase tracking-wide text-slate-500">{g}</div>
          <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {EMAIL_TEMPLATE_KINDS.filter((k) => k.group === g).map((k) => {
              const list = data.filter((t) => t.kind === k.kind);
              return (
                <div key={k.kind} className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-slate-800">{k.label}</div>
                    <button className="btn-ghost btn-sm" onClick={() => setEdit({ kind: k.kind, new: true })}>
                      <Plus size={13} /> New
                    </button>
                  </div>
                  <div className="mt-1 space-y-1">
                    {list.map((t) => (
                      <button key={t.id} className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-slate-50" onClick={() => setEdit(t)}>
                        <span className="w-48 truncate text-[13px] text-brand-700">{t.name}</span>
                        <span className="flex-1 truncate text-xs text-slate-500">{t.subject}</span>
                        {t.isDefault && (
                          <span className="inline-flex items-center gap-1 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-brand-700">
                            <Star size={10} /> Default
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {edit && <TemplateEditor key={'id' in edit ? edit.id : 'new'} t={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function TemplateEditor({ t, onClose }: { t: EmailTemplate | { kind: EmailTemplateKind; new: true }; onClose: () => void }) {
  const isNew = 'new' in t;
  const meta = templateKindMeta(t.kind);
  const [f, setF] = useState({ name: isNew ? `${meta.label} (custom)` : t.name, subject: isNew ? '' : t.subject, body: isNew ? '' : t.body, isDefault: isNew ? false : t.isDefault });
  const body = useRef<HTMLTextAreaElement>(null);
  const [target, setTarget] = useState<'subject' | 'body'>('body');
  const confirm = useConfirm();
  const save = useAction(() => (isNew ? api('/email-templates', { body: { ...f, kind: t.kind } }) : api(`/email-templates/${t.id}`, { method: 'PUT', body: f })), 'Template saved');
  const del = useAction(() => api(`/email-templates/${(t as EmailTemplate).id}`, { method: 'DELETE' }), 'Template deleted');
  const restore = useAction(() => api<EmailTemplate>(`/email-templates/${(t as EmailTemplate).id}/restore`, { body: {} }), 'Template restored');
  const placeholders = useMemo(() => placeholdersFor(t.kind), [t.kind]);
  const insert = (key: string) => {
    const tok = `%${key}%`;
    if (target === 'subject') return setF({ ...f, subject: `${f.subject}${tok}` });
    const el = body.current;
    const s = el?.selectionStart ?? f.body.length;
    const e = el?.selectionEnd ?? f.body.length;
    setF({ ...f, body: f.body.slice(0, s) + tok + f.body.slice(e) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(s + tok.length, s + tok.length);
    });
  };
  return (
    <Drawer
      open
      onClose={onClose}
      width="max-w-4xl"
      title={isNew ? `New ${meta.label} template` : `Edit template: ${t.name}`}
      footer={
        <>
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            Save
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          {!isNew && t.builtIn && (
            <button className="btn-ghost ml-auto" onClick={() => restore.mutate(undefined, { onSuccess: (r) => setF({ ...f, name: r.name, subject: r.subject, body: r.body }) })}>
              <RotateCcw size={13} /> Restore original
            </button>
          )}
          {!isNew && !t.builtIn && (
            <button className="btn-ghost ml-auto text-red-600" onClick={() => confirm.ask('Delete template', `Delete “${t.name}”?`, () => del.mutate(undefined, { onSuccess: onClose }), { danger: true, label: 'Delete' })}>
              <Trash2 size={13} /> Delete
            </button>
          )}
        </>
      }
    >
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_240px]">
        <div className="space-y-3">
          <Field label="Template Name" inline={false}>
            <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Subject" inline={false}>
            <input className="input" value={f.subject} onFocus={() => setTarget('subject')} onChange={(e) => setF({ ...f, subject: e.target.value })} />
          </Field>
          <Field label="Email Body" inline={false} hint={meta.link ? 'A summary card and a “View” button are added automatically when the email is about a transaction.' : undefined}>
            <textarea ref={body} className="input min-h-[340px] font-sans leading-6" value={f.body} onFocus={() => setTarget('body')} onChange={(e) => setF({ ...f, body: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={f.isDefault} disabled={!isNew && t.isDefault} onChange={(e) => setF({ ...f, isDefault: e.target.checked })} />
            Use as the default {meta.label.toLowerCase()} template
          </label>
        </div>
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-xxs font-semibold uppercase tracking-wide text-slate-500">
            <Braces size={12} /> Placeholders
          </div>
          <div className="mb-2 text-xxs text-slate-500">Click to insert into the {target}. They are filled in when the email is written.</div>
          <div className="max-h-[440px] space-y-0.5 overflow-y-auto">
            {placeholders.map((p) => (
              <button key={p.key} type="button" className="block w-full rounded px-2 py-1 text-left hover:bg-brand-50" onClick={() => insert(p.key)}>
                <code className="text-xs text-brand-700">%{p.key}%</code>
                <div className="text-xxs text-slate-500">{p.label}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
      {confirm.node}
    </Drawer>
  );
}

// ------------------------------------------------------------ log

function Log() {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const { data } = useApi<(MailRow & { system?: boolean })[]>(`/mails${qs({ status, search })}`);
  const [open, setOpen] = useState<string | null>(null);
  const counts = data ? { failed: data.filter((m) => m.status === 'failed').length, outbox: data.filter((m) => (m.status || (m.delivered ? 'sent' : 'outbox')) === 'outbox').length } : undefined;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Select className="w-40" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'All emails' }, { value: 'sent', label: 'Sent' }, { value: 'outbox', label: 'Outbox' }, { value: 'failed', label: 'Failed' }]} />
        <div className="w-72">
          <SearchBox value={search} onChange={setSearch} placeholder="Search subject or recipient" />
        </div>
        {counts && !status && (counts.failed > 0 || counts.outbox > 0) && (
          <div className="ml-auto flex items-center gap-3 text-xs">
            {counts.failed > 0 && <span className="text-red-600">{counts.failed} failed</span>}
            {counts.outbox > 0 && (
              <span className="inline-flex items-center gap-1 text-amber-700">
                <Inbox size={12} /> {counts.outbox} in the outbox
              </span>
            )}
          </div>
        )}
      </div>
      {!data ? (
        <Spinner />
      ) : data.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 p-10 text-center text-slate-500">No emails found.</div>
      ) : (
        <table className="table rounded-md border border-slate-200">
          <thead>
            <tr>
              <th className="w-40">Date</th>
              <th>Subject</th>
              <th>To</th>
              <th className="w-28">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.map((m) => (
              <tr key={m.id} className="row-link" onClick={() => setOpen(m.id)}>
                <td className="whitespace-nowrap text-xs text-slate-500">{fmtDateTime(m.createdAt)}</td>
                <td>
                  <div className="font-medium text-slate-800">{m.subject}</div>
                  {m.system && <div className="text-xxs text-slate-400">System email</div>}
                  {m.status === 'failed' && m.error && <div className="truncate text-xxs text-red-600">{m.error}</div>}
                </td>
                <td className="text-xs text-slate-600">{m.to.join(', ')}</td>
                <td>
                  <MailStatus m={m} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && <MailPreview id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
