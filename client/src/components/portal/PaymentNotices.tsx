// Staff-side widgets for what customers do in the portal or on shared links:
// reported payments (review & record), quote responses and portal access per customer.
import { useState } from 'react';
import { CheckCircle2, Copy, Eye, Globe, MailPlus, MessageSquareQuote, RotateCcw, ThumbsDown, ThumbsUp, Trash2, UserX, Wallet } from 'lucide-react';
import { fmtDate, fmtDateTime, money } from '@shared/format';
import type { CustomerResponse, PaymentNotice } from '@shared/portal';
import { api, useAction, useApi } from '../../api';
import { isCashLike, useAccounts } from '../../lib/app';
import { toast } from '../../lib/toast';
import { AccountSelect, Checkbox, DateInput, Field, Modal, MoneyInput, Spinner, clsx, useConfirm } from '../ui';

export function RecordNoticeModal({ notice, onClose }: { notice: PaymentNotice; onClose: () => void }) {
  const accounts = useAccounts();
  const [f, setF] = useState({ amount: String(notice.amount), date: notice.date, depositToAccountId: accounts.find((a) => a.subType === 'bank' && a.active)?.id || 'acc_undeposited' });
  const rec = useAction(() => api('/payment-notices/' + notice.id + '/record', { body: { ...f, amount: Number(f.amount) } }), 'Payment recorded');
  return (
    <Modal
      open
      onClose={onClose}
      title="Record reported payment"
      footer={
        <>
          <button className="btn-primary" disabled={rec.isPending} onClick={() => rec.mutate(undefined, { onSuccess: onClose })}>
            Record Payment
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="mb-4 rounded-md bg-slate-50 p-3 text-[13px] text-slate-700">
        {notice.submittedBy} reported <b>{money(notice.amount)}</b> paid on {fmtDate(notice.date)} via {notice.mode}, reference <b>{notice.reference}</b>.{notice.note && <div className="mt-1 text-slate-600">“{notice.note}”</div>}
        <div className="mt-1 text-xxs text-slate-500">Check your bank statement for this reference before recording.</div>
      </div>
      <div className="space-y-3">
        <Field label="Amount Received" required>
          <MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
        </Field>
        <Field label="Payment Date" required>
          <DateInput value={f.date} onChange={(v) => setF({ ...f, date: v })} />
        </Field>
        <Field label="Deposit To" required>
          <AccountSelect accounts={accounts} value={f.depositToAccountId} onChange={(v) => setF({ ...f, depositToAccountId: v })} filter={isCashLike} />
        </Field>
      </div>
    </Modal>
  );
}

/** Banner on an invoice for payments the customer reported. */
export function InvoiceNotices({ invoiceId }: { invoiceId: string }) {
  const { data = [] } = useApi<PaymentNotice[]>(`/payment-notices?invoiceId=${invoiceId}&status=pending`);
  const [record, setRecord] = useState<PaymentNotice | null>(null);
  const dismiss = useAction((id: string) => api(`/payment-notices/${id}/dismiss`, { body: {} }), 'Dismissed');
  if (!data.length) return null;
  return (
    <div className="mb-4 space-y-2">
      {data.map((n) => (
        <div key={n.id} className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
          <Wallet size={18} className="shrink-0 text-amber-600" />
          <div className="flex-1 text-[13px]">
            <div className="font-medium text-slate-900">
              {n.submittedBy} reported a payment of {money(n.amount)}
            </div>
            <div className="text-xs text-slate-600">
              Paid {fmtDate(n.date)} via {n.mode} · Ref {n.reference} · reported {fmtDateTime(n.createdAt)} via the {n.via === 'portal' ? 'customer portal' : 'shared link'}
              {n.note && <> · “{n.note}”</>}
            </div>
          </div>
          <button className="btn-primary btn-sm" onClick={() => setRecord(n)}>
            Record Payment
          </button>
          <button className="btn-ghost btn-sm" onClick={() => dismiss.mutate(n.id)}>
            Dismiss
          </button>
        </div>
      ))}
      {record && <RecordNoticeModal notice={record} onClose={() => setRecord(null)} />}
    </div>
  );
}

/** "Accepted by … via the portal" banner on a quote, plus "Viewed" status. */
export function CustomerActivity({ response, viewedAt }: { response?: CustomerResponse; viewedAt?: string }) {
  if (!response && !viewedAt) return null;
  if (!response)
    return (
      <div className="mb-4 flex items-center gap-2 rounded-md border border-sky-100 bg-sky-50 px-4 py-2 text-[13px] text-sky-800">
        <Eye size={15} /> Viewed by the customer on {fmtDateTime(viewedAt)}
      </div>
    );
  const ok = response.action === 'accepted';
  return (
    <div className={clsx('mb-4 flex items-start gap-3 rounded-md border px-4 py-3', ok ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50')}>
      {ok ? <ThumbsUp size={18} className="mt-0.5 text-emerald-600" /> : <ThumbsDown size={18} className="mt-0.5 text-red-600" />}
      <div className="text-[13px]">
        <div className="font-medium text-slate-900">
          {ok ? 'Accepted' : 'Declined'} by {response.by}
          {response.email && <span className="font-normal text-slate-500"> ({response.email})</span>}
        </div>
        <div className="text-xs text-slate-600">
          {fmtDateTime(response.at)} via the {response.via === 'portal' ? 'customer portal' : 'shared link'}
        </div>
        {response.comment && (
          <div className="mt-1.5 flex items-start gap-1.5 text-slate-700">
            <MessageSquareQuote size={14} className="mt-0.5 shrink-0 text-slate-400" /> {response.comment}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ portal access per customer

interface PortalUserView {
  id: string;
  email: string;
  name: string;
  status: 'invited' | 'active' | 'disabled';
  invitedAt?: string;
  inviteExpiresAt?: string;
  lastLoginAt?: string;
}
interface ContactPortal {
  enabled: boolean;
  portalEnabled: boolean;
  portalUrl: string;
  users: PortalUserView[];
  candidates: { email: string; name: string; contactPersonId?: string; user?: PortalUserView }[];
}
type InviteResult = { user: PortalUserView; mailStatus?: string; mailError?: string; inviteUrl?: string; alreadyActive?: boolean }[];

export function PortalAccessModal({ contactId, name, onClose }: { contactId: string; name: string; onClose: () => void }) {
  const { data } = useApi<ContactPortal>(`/contacts/${contactId}/portal`);
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [links, setLinks] = useState<{ email: string; url: string; reason: string }[]>([]);
  const confirm = useConfirm();
  const collect = (r: InviteResult) => {
    const manual = r.filter((x) => x.inviteUrl).map((x) => ({ email: x.user.email, url: x.inviteUrl!, reason: x.mailStatus === 'failed' ? `Email failed: ${x.mailError}` : 'Email sending is not set up, so the invitation is in the outbox.' }));
    setLinks(manual);
    const sent = r.filter((x) => x.mailStatus === 'sent').length;
    if (sent) toast.success(`Invitation sent to ${sent} contact${sent === 1 ? '' : 's'}`);
    else if (manual.length) toast.success('Invitation created. Share the link below with your customer.');
  };
  const invite = useAction((emails: string[]) => api<InviteResult>(`/contacts/${contactId}/portal/invite`, { body: { emails } }));
  const resend = useAction((id: string) => api<InviteResult[number]>(`/portal-users/${id}/resend`, { body: {} }));
  const status = useAction(({ id, s }: { id: string; s: string }) => api(`/portal-users/${id}/status`, { body: { status: s } }), 'Portal user updated');
  const remove = useAction((id: string) => api(`/portal-users/${id}`, { method: 'DELETE' }), 'Portal user removed');
  const toggle = useAction((on: boolean) => api(`/contacts/${contactId}/portal/${on ? 'enable' : 'disable'}`, { body: {} }), 'Portal access updated');
  const chosen = Object.keys(pick).filter((k) => pick[k]);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Customer Portal Access: ${name}`}
      width="max-w-2xl"
      footer={
        <>
          <button className="btn-primary" disabled={!chosen.length || invite.isPending} onClick={() => invite.mutate(chosen, { onSuccess: (r) => (setPick({}), collect(r)) })}>
            <MailPlus size={14} /> {invite.isPending ? 'Inviting…' : `Send Invitation${chosen.length > 1 ? 's' : ''}`}
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
          {data?.enabled && data.users.length > 0 && (
            <button className="btn-ghost ml-auto text-red-600" onClick={() => confirm.ask('Turn off portal access', `Everyone from ${name} is signed out and cannot sign in until you turn it back on.`, () => toggle.mutate(false), { danger: true, label: 'Turn off' })}>
              <UserX size={14} /> Turn off portal access
            </button>
          )}
        </>
      }
    >
      {!data ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          {!data.portalEnabled && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">The customer portal is turned off in Settings &gt; Customer Portal. Invitations can be sent, but nobody can sign in until it is on.</div>}
          {data.users.length > 0 && !data.enabled && (
            <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 p-3 text-[13px]">
              Portal access is turned off for {name}.
              <button className="btn-secondary btn-sm" onClick={() => toggle.mutate(true)}>
                Turn on
              </button>
            </div>
          )}
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Globe size={13} /> Customers sign in at <span className="font-mono text-slate-700">{data.portalUrl}</span>
          </div>
          {data.candidates.length === 0 && <div className="rounded-md border border-dashed border-slate-300 p-6 text-center text-slate-500">Add an email address or a contact person with an email to {name} first.</div>}
          <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {data.candidates.map((c) => {
              const u = c.user;
              return (
                <div key={c.email} className="flex items-center gap-3 px-4 py-3">
                  {!u || u.status === 'invited' ? <Checkbox checked={!!pick[c.email]} onChange={(v) => setPick({ ...pick, [c.email]: v })} label="" /> : <span className="w-4" />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-slate-800">{u?.name || c.name}</div>
                    <div className="truncate text-xs text-slate-500">
                      {c.email}
                      {!c.contactPersonId && ' · primary'}
                    </div>
                  </div>
                  <div className="text-right text-xxs text-slate-500">
                    {!u && 'Not invited'}
                    {u?.status === 'invited' && (
                      <>
                        <span className="font-semibold uppercase text-amber-700">Invitation sent</span>
                        <div>{u.inviteExpiresAt && u.inviteExpiresAt < new Date().toISOString() ? 'Expired' : `Expires ${fmtDate(u.inviteExpiresAt?.slice(0, 10))}`}</div>
                      </>
                    )}
                    {u?.status === 'active' && (
                      <>
                        <span className="inline-flex items-center gap-1 font-semibold uppercase text-emerald-700">
                          <CheckCircle2 size={11} /> Active
                        </span>
                        <div>{u.lastLoginAt ? `Last sign-in ${fmtDateTime(u.lastLoginAt)}` : 'Never signed in'}</div>
                      </>
                    )}
                    {u?.status === 'disabled' && <span className="font-semibold uppercase text-slate-500">Disabled</span>}
                  </div>
                  {u && (
                    <div className="flex gap-1">
                      {u.status === 'invited' && (
                        <button className="btn-ghost btn-sm" title="Resend invitation" onClick={() => resend.mutate(u.id, { onSuccess: (r) => collect([r]) })}>
                          <RotateCcw size={13} />
                        </button>
                      )}
                      {u.status !== 'disabled' ? (
                        <button className="btn-ghost btn-sm" title="Disable" onClick={() => status.mutate({ id: u.id, s: 'disabled' })}>
                          <UserX size={13} />
                        </button>
                      ) : (
                        <button className="btn-ghost btn-sm" onClick={() => status.mutate({ id: u.id, s: 'active' })}>
                          Enable
                        </button>
                      )}
                      <button className="btn-ghost btn-sm text-red-600" title="Remove" onClick={() => confirm.ask('Remove portal user', `${u.email} will no longer be able to sign in.`, () => remove.mutate(u.id), { danger: true, label: 'Remove' })}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {links.map((l) => (
            <div key={l.email} className="rounded-md border border-amber-200 bg-amber-50 p-3">
              <div className="mb-1 text-xs text-amber-800">
                {l.reason} Share this invitation link with {l.email}:
              </div>
              <div className="flex gap-2">
                <input readOnly className="input flex-1 bg-white font-mono text-xs" value={l.url} onFocus={(e) => e.target.select()} />
                <button
                  className="btn-secondary btn-sm"
                  onClick={() => {
                    navigator.clipboard?.writeText(l.url);
                    toast.success('Link copied');
                  }}
                >
                  <Copy size={13} /> Copy
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {confirm.node}
    </Modal>
  );
}

/** Compact portal status for the customer overview. */
export function PortalStatusBlock({ contactId, onManage }: { contactId: string; onManage: () => void }) {
  const { data } = useApi<ContactPortal>(`/contacts/${contactId}/portal`);
  if (!data) return null;
  const active = data.users.filter((u) => u.status === 'active').length;
  const invited = data.users.filter((u) => u.status === 'invited').length;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={clsx('text-[13px]', data.enabled && active ? 'text-emerald-600' : data.enabled && invited ? 'text-amber-600' : 'text-slate-500')}>
        {!data.enabled ? 'Not enabled' : active ? `${active} active user${active === 1 ? '' : 's'}` : invited ? 'Invitation sent' : 'Enabled, no users'}
        {data.enabled && active > 0 && invited > 0 && `, ${invited} invited`}
      </span>
      <button className="link text-xs" onClick={onManage}>
        Manage
      </button>
    </div>
  );
}
