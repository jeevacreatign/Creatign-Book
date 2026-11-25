// Share a transaction with a secure public link.
import { useState } from 'react';
import { Check, Copy, ExternalLink, Eye, Link2 } from 'lucide-react';
import { addDays, fmtDate, fmtDateTime, today } from '@shared/format';
import type { ShareLink } from '@shared/types';
import { api, qs, useAction, useApi } from '../../api';
import { toast } from '../../lib/toast';
import { Checkbox, DateInput, Field, Modal, clsx } from '../ui';

export function ShareModal({ open, onClose, entityType, entityId, title }: { open: boolean; onClose: () => void; entityType: string; entityId: string; title: string }) {
  const [expires, setExpires] = useState(addDays(today(), 90));
  const [never, setNever] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const { data: links = [] } = useApi<ShareLink[]>(open ? `/share-links${qs({ entityId })}` : null);
  const gen = useAction(() => api<ShareLink & { url: string }>('/share-links', { body: { entityType, entityId, expiresOn: never ? undefined : expires } }), 'Link generated');
  const disableOne = useAction((id: string) => api(`/share-links/${id}/disable`, { body: {} }), 'Link disabled');
  const disableAll = useAction(() => api('/share-links/disable-all', { body: { entityId } }), 'All active links disabled');
  const live = (l: ShareLink) => l.active && (!l.expiresOn || l.expiresOn >= today());
  const active = links.filter(live);
  const inactive = links.filter((l) => !live(l)).slice(0, 5);
  const url = (t: string) => `${window.location.origin}/share/${t}`;
  const copy = (l: ShareLink) => {
    navigator.clipboard?.writeText(url(l.token));
    setCopied(l.id);
    toast.success('Link copied');
    setTimeout(() => setCopied(null), 1500);
  };
  return (
    <Modal open={open} onClose={onClose} title={`Share ${title}`} width="max-w-2xl">
      <div className="space-y-5">
        <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
          <div className="mb-1 flex items-center gap-2 font-medium text-slate-800">
            <Link2 size={15} className="text-brand-600" /> Secure public link
          </div>
          <div className="mb-3 text-xs text-slate-600">Anyone with the link can view this {title.toLowerCase()}, download the PDF{entityType === 'quote' ? ', and accept or decline it' : entityType === 'invoice' ? ' and report a payment' : ''} without signing in. Disable the link at any time.</div>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Link expires on" inline={false} className="w-48">
              <DateInput value={never ? '' : expires} onChange={setExpires} disabled={never} />
            </Field>
            <div className="pb-1.5">
              <Checkbox checked={never} onChange={setNever} label="Never expires" />
            </div>
            <button className="btn-primary ml-auto" onClick={() => gen.mutate()} disabled={gen.isPending}>
              <Link2 size={14} /> Generate Link
            </button>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xxs font-semibold uppercase tracking-wide text-slate-500">Active links ({active.length})</div>
            {active.length > 1 && (
              <button className="btn-ghost btn-sm text-red-600" onClick={() => disableAll.mutate()}>
                Disable all
              </button>
            )}
          </div>
          {active.length === 0 && <div className="rounded-md border border-dashed border-slate-300 p-4 text-center text-slate-500">No active links. Generate one above, or email the {title.toLowerCase()} with a “View” button.</div>}
          <div className="space-y-2">
            {active.map((l) => (
              <div key={l.id} className="rounded-md border border-slate-200 p-3">
                <div className="flex items-center gap-2">
                  <input readOnly aria-label="Share link" className="input flex-1 bg-slate-50 font-mono text-xs" value={url(l.token)} onFocus={(e) => e.target.select()} />
                  <button className={clsx('btn-secondary btn-sm', copied === l.id && 'text-emerald-700')} onClick={() => copy(l)}>
                    {copied === l.id ? <Check size={13} /> : <Copy size={13} />} Copy
                  </button>
                  <a className="btn-ghost btn-sm" href={url(l.token)} target="_blank" rel="noreferrer" aria-label="Open link">
                    <ExternalLink size={13} />
                  </a>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xxs text-slate-500">
                  <span>{l.source === 'email' ? 'Created for an email' : 'Created manually'} · {fmtDateTime(l.createdAt)}</span>
                  <span>{l.expiresOn ? `Expires ${fmtDate(l.expiresOn)}` : 'Never expires'}</span>
                  <span className="inline-flex items-center gap-1">
                    <Eye size={11} /> {l.views ? `${l.views} view${l.views === 1 ? '' : 's'}, last ${fmtDateTime(l.lastViewedAt)}` : 'Not viewed yet'}
                  </span>
                  <button className="ml-auto text-red-600 hover:underline" onClick={() => disableOne.mutate(l.id)}>
                    Disable
                  </button>
                </div>
              </div>
            ))}
          </div>
          {inactive.length > 0 && (
            <div className="mt-3 text-xxs text-slate-400">
              {inactive.length} expired or disabled link{inactive.length === 1 ? '' : 's'} no longer work.
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
