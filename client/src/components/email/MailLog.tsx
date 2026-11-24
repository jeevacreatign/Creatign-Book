// Email history: what was sent, to whom, whether it was delivered, kept in the
// outbox or refused by the mail server, with a preview of the exact email.
import { useState } from 'react';
import { AlertCircle, CheckCircle2, Inbox, Mail as MailIcon, Paperclip, RotateCcw } from 'lucide-react';
import { fmtDateTime } from '@shared/format';
import type { Mail } from '@shared/types';
import { api, qs, useAction, useApi } from '../../api';
import { Drawer, Spinner, clsx } from '../ui';

export type MailRow = Omit<Mail, 'html'>;

const statusOf = (m: MailRow) => m.status || (m.delivered ? 'sent' : 'outbox');

export function MailStatus({ m }: { m: MailRow }) {
  const s = statusOf(m);
  const map = {
    sent: { icon: <CheckCircle2 size={12} />, label: 'Sent', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    outbox: { icon: <Inbox size={12} />, label: 'Outbox', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    failed: { icon: <AlertCircle size={12} />, label: 'Failed', cls: 'bg-red-50 text-red-700 border-red-200' },
  }[s];
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', map.cls)} title={s === 'outbox' ? 'Email sending was not set up, so this was kept here and not delivered' : m.error}>
      {map.icon}
      {map.label}
    </span>
  );
}

export function MailPreview({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: m } = useApi<Mail>(`/mails/${id}`);
  const resend = useAction(() => api(`/mails/${id}/resend`, { body: {} }), 'Email sent again');
  return (
    <Drawer
      open
      onClose={onClose}
      width="max-w-3xl"
      title={m ? m.subject : 'Email'}
      footer={
        m && !m.system ? (
          <>
            <button className="btn-primary" disabled={resend.isPending} onClick={() => resend.mutate(undefined, { onSuccess: onClose })}>
              <RotateCcw size={14} /> {statusOf(m) === 'sent' ? 'Send Again' : 'Retry Sending'}
            </button>
            <button className="btn-secondary" onClick={onClose}>
              Close
            </button>
          </>
        ) : undefined
      }
    >
      {!m ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <div className="space-y-1 rounded-md border border-slate-200 bg-slate-50 p-3 text-[13px]">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-slate-500">From</span> {m.from}
              </div>
              <MailStatus m={m} />
            </div>
            <div>
              <span className="text-slate-500">To</span> {m.to.join(', ')}
            </div>
            {m.cc.length > 0 && (
              <div>
                <span className="text-slate-500">Cc</span> {m.cc.join(', ')}
              </div>
            )}
            {(m.bcc?.length || 0) > 0 && (
              <div>
                <span className="text-slate-500">Bcc</span> {m.bcc!.join(', ')}
              </div>
            )}
            <div className="text-xxs text-slate-500">
              {fmtDateTime(m.createdAt)}
              {m.provider && m.provider !== 'outbox' && ` · via ${m.provider === 'google-oauth' ? 'Gmail' : 'SMTP'}`}
            </div>
            {m.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {m.attachments.map((a) => (
                  <span key={a} className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-xxs text-slate-600">
                    <Paperclip size={11} /> {a}
                  </span>
                ))}
              </div>
            )}
          </div>
          {statusOf(m) === 'failed' && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">{m.error}</div>}
          {statusOf(m) === 'outbox' && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">This email is in the outbox: email sending was not set up when it was written, so it was not delivered. Set up SMTP or Gmail in Settings &gt; Emails, then use Retry Sending.</div>}
          {m.html ? <iframe title="Email content" sandbox="" srcDoc={m.html} className="h-[560px] w-full rounded-md border border-slate-200" /> : <pre className="whitespace-pre-wrap rounded-md border border-slate-200 p-4 font-sans text-[13px]">{m.body}</pre>}
        </div>
      )}
    </Drawer>
  );
}

export function MailLog({ entityId, contactId, compact, emptyText = 'No emails yet.' }: { entityId?: string; contactId?: string; compact?: boolean; emptyText?: string }) {
  const { data, isLoading } = useApi<MailRow[]>(`/mails${qs({ entityId, contactId })}`);
  const [open, setOpen] = useState<string | null>(null);
  if (isLoading) return <Spinner />;
  const rows = data || [];
  return (
    <div className={compact ? '' : 'max-w-4xl'}>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-slate-300 px-6 py-10 text-center text-slate-500">
          <MailIcon size={22} className="text-slate-300" />
          {emptyText}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {rows.map((m) => (
            <li key={m.id}>
              <button type="button" className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50" onClick={() => setOpen(m.id)}>
                <div className={clsx('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', statusOf(m) === 'failed' ? 'bg-red-50 text-red-600' : statusOf(m) === 'outbox' ? 'bg-amber-50 text-amber-600' : 'bg-brand-50 text-brand-600')}>
                  <MailIcon size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <div className="truncate font-medium text-slate-800">{m.subject}</div>
                    <div className="shrink-0 text-xxs text-slate-400">{fmtDateTime(m.createdAt)}</div>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                    <span className="truncate">To {m.to.join(', ')}</span>
                    {m.attachments.length > 0 && (
                      <span className="inline-flex shrink-0 items-center gap-0.5">
                        <Paperclip size={11} /> {m.attachments.length}
                      </span>
                    )}
                    <span className="ml-auto shrink-0">
                      <MailStatus m={m} />
                    </span>
                  </div>
                  {statusOf(m) === 'failed' && m.error && <div className="mt-1 truncate text-xxs text-red-600">{m.error}</div>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <MailPreview id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
