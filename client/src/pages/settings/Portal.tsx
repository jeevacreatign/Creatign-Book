// Settings > Client Portal: turn the portal on, choose what customers can do,
// payment instructions (UPI / bank), portal users and customer-reported payments.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Globe, IndianRupee, ShieldCheck, Users } from 'lucide-react';
import { fmtDate, fmtDateTime, money } from '@shared/format';
import type { PaymentNotice, PortalSettings } from '@shared/portal';
import { api, useAction, useApi } from '../../api';
import { Field, Spinner, Tabs, clsx } from '../../components/ui';
import { Switch } from './Emails';
import { RecordNoticeModal } from '../../components/portal/PaymentNotices';

type PortalUserRow = { id: string; contactId: string; contactName: string; email: string; name: string; status: 'invited' | 'active' | 'disabled'; invitedAt?: string; lastLoginAt?: string; createdAt: string };

export default function PortalSettingsPage() {
  const [tab, setTab] = useState<'general' | 'users' | 'payments'>('general');
  const { data: notices = [] } = useApi<(PaymentNotice & { contactName: string; invoiceNumber?: string })[]>('/payment-notices');
  const pending = notices.filter((n) => n.status === 'pending').length;
  return (
    <div className="max-w-5xl">
      <div className="mb-1 flex items-center justify-between">
        <div className="text-[15px] font-semibold">Client Portal</div>
        <a className="btn-secondary btn-sm" href="/portal" target="_blank" rel="noreferrer">
          <ExternalLink size={13} /> Open portal
        </a>
      </div>
      <div className="mb-4 text-slate-600">A secure, branded place where your clients sign in to view and download estimates, invoices and receipts, accept estimates, check their statement and tell you about payments.</div>
      <Tabs
        className="mb-5"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'general', label: 'General' },
          { value: 'users', label: 'Portal Users' },
          { value: 'payments', label: <span>Reported Payments{pending > 0 && <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">{pending}</span>}</span> },
        ]}
      />
      {tab === 'general' && <General />}
      {tab === 'users' && <Users_ />}
      {tab === 'payments' && <Payments notices={notices} />}
    </div>
  );
}

function Toggle({ label, desc, on, onChange }: { label: string; desc: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-6 px-4 py-3">
      <span>
        <span className="block font-medium text-slate-800">{label}</span>
        <span className="block text-xs text-slate-500">{desc}</span>
      </span>
      <Switch on={on} onChange={onChange} label={label} />
    </label>
  );
}

function General() {
  const { data } = useApi<PortalSettings>('/portal-settings');
  const [f, setF] = useState<PortalSettings>();
  useEffect(() => {
    if (data && !f) setF(data);
  }, [data, f]);
  const save = useAction(() => api<PortalSettings>('/portal-settings', { method: 'PUT', body: f }), 'Portal settings saved');
  if (!f) return <Spinner />;
  const set = (p: Partial<PortalSettings>) => setF({ ...f, ...p });
  const portalUrl = `${f.publicUrl || window.location.origin}/portal`;
  return (
    <div className="space-y-6">
      <div className="card divide-y divide-slate-100">
        <Toggle label="Enable the client portal" desc="Clients you invite can sign in. Turning it off signs everyone out; their invitations stay." on={f.enabled} onChange={(v) => set({ enabled: v })} />
        <Toggle label="Clients can accept or decline estimates" desc="The estimate changes to Accepted or Declined and you get notified." on={f.allowQuoteAcceptance} onChange={(v) => set({ allowQuoteAcceptance: v })} />
        <Toggle label="Clients can view their statement" desc="Statement of accounts for any period, with PDF download." on={f.allowStatements} onChange={(v) => set({ allowStatements: v })} />
        <Toggle label="Clients can report payments" desc="They tell you about a UPI or bank payment with its reference; you review and record it." on={f.allowPaymentNotices} onChange={(v) => set({ allowPaymentNotices: v })} />
        <Toggle label="Allow these actions on shared links" desc="Shared and emailed links can accept estimates and report payments without signing in." on={f.allowActionsOnSharedLinks} onChange={(v) => set({ allowActionsOnSharedLinks: v })} />
        <Toggle label="Email me when clients respond" desc="Notifications go to your organization email address." on={f.notifyOrganization} onChange={(v) => set({ notifyOrganization: v })} />
      </div>

      <div className="card p-5">
        <div className="mb-3 flex items-center gap-2 font-semibold">
          <Globe size={16} className="text-brand-600" /> Portal details
        </div>
        <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
          <Field label="Portal Name" inline={false}>
            <input className="input" value={f.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Portal URL" inline={false} hint={<>Links in emails use this address. Leave blank to use {window.location.origin}. Clients sign in at {portalUrl}</>}>
            <input className="input" value={f.publicUrl || ''} onChange={(e) => set({ publicUrl: e.target.value })} placeholder="https://books.creatign.in" />
          </Field>
          <Field label="Welcome message" inline={false} className="md:col-span-2" hint="Shown at the top of the portal dashboard.">
            <textarea className="input min-h-[70px]" value={f.bannerMessage || ''} onChange={(e) => set({ bannerMessage: e.target.value })} placeholder="Welcome! Reach us at accounts@creatign.in for any billing questions." />
          </Field>
          <Field label="Emailed links expire after (days)" inline={false}>
            <input className="input w-32" type="number" min={1} max={365} value={f.emailLinkDays} onChange={(e) => set({ emailLinkDays: Number(e.target.value) })} />
          </Field>
        </div>
      </div>

      <div className="card p-5">
        <div className="mb-1 flex items-center gap-2 font-semibold">
          <IndianRupee size={16} className="text-emerald-600" /> Payment instructions
        </div>
        <div className="mb-3 text-xs text-slate-600">Shown on unpaid invoices in the portal and on shared links. With a UPI ID, clients get a QR code and a “Pay with UPI” button with the amount filled in.</div>
        <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
          <Field label="UPI ID" inline={false}>
            <input className="input" value={f.upiId || ''} onChange={(e) => set({ upiId: e.target.value.trim() })} placeholder="creatign@hdfcbank" />
          </Field>
          <Field label="Payee name" inline={false}>
            <input className="input" value={f.upiPayeeName || ''} onChange={(e) => set({ upiPayeeName: e.target.value })} placeholder="Creatign" />
          </Field>
          <Field label="Bank transfer details" inline={false} className="md:col-span-2">
            <textarea className="input min-h-[90px] font-mono text-xs" value={f.bankInstructions || ''} onChange={(e) => set({ bankInstructions: e.target.value })} placeholder={'Account name: Creatign\nAccount number: 50200012345678\nIFSC: HDFC0001234\nBranch: Anna Nagar, Chennai'} />
          </Field>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <ShieldCheck size={15} className="mt-0.5 shrink-0 text-slate-500" />
        Clients only see transactions that were sent to them. Drafts and transactions waiting for approval never appear. Passwords are hashed, sessions expire after 14 days, and repeated wrong passwords lock the account for 15 minutes.
      </div>

      <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: (r) => setF(r) })}>
        Save
      </button>
    </div>
  );
}

function Users_() {
  const navigate = useNavigate();
  const { data } = useApi<PortalUserRow[]>('/portal-users');
  if (!data) return <Spinner />;
  if (!data.length)
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-slate-300 px-6 py-12 text-center text-slate-500">
        <Users size={24} className="text-slate-300" />
        No one has been invited yet.
        <div className="text-xs">Open a client and choose More &gt; Client Portal Access to invite their contacts.</div>
      </div>
    );
  return (
    <table className="table rounded-md border border-slate-200">
      <thead>
        <tr>
          <th>Name</th>
          <th>Client</th>
          <th>Status</th>
          <th>Last sign-in</th>
        </tr>
      </thead>
      <tbody>
        {data.map((u) => (
          <tr key={u.id} className="row-link" onClick={() => navigate(`/sales/customers/${u.contactId}`)}>
            <td>
              <div className="font-medium">{u.name}</div>
              <div className="text-xs text-slate-500">{u.email}</div>
            </td>
            <td>{u.contactName}</td>
            <td>
              <UserStatus status={u.status} />
            </td>
            <td className="text-xs text-slate-500">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : u.status === 'invited' ? `Invited ${fmtDateTime(u.invitedAt)}` : '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function UserStatus({ status }: { status: 'invited' | 'active' | 'disabled' }) {
  const cls = { invited: 'bg-amber-50 text-amber-700 border-amber-200', active: 'bg-emerald-50 text-emerald-700 border-emerald-200', disabled: 'bg-slate-100 text-slate-500 border-slate-200' }[status];
  return <span className={clsx('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', cls)}>{status === 'invited' ? 'Invitation sent' : status}</span>;
}

function Payments({ notices }: { notices: (PaymentNotice & { contactName: string; invoiceNumber?: string })[] }) {
  const navigate = useNavigate();
  const [record, setRecord] = useState<PaymentNotice | null>(null);
  const dismiss = useAction((id: string) => api(`/payment-notices/${id}/dismiss`, { body: {} }), 'Dismissed');
  if (!notices.length) return <div className="rounded-md border border-dashed border-slate-300 p-10 text-center text-slate-500">Payments your clients report from the portal or shared links appear here for review.</div>;
  return (
    <>
      <table className="table rounded-md border border-slate-200">
        <thead>
          <tr>
            <th>Reported</th>
            <th>Client</th>
            <th>Invoice</th>
            <th>Payment</th>
            <th className="text-right">Amount</th>
            <th className="w-48" />
          </tr>
        </thead>
        <tbody>
          {notices.map((n) => (
            <tr key={n.id}>
              <td className="text-xs text-slate-500">
                {fmtDateTime(n.createdAt)}
                <div>by {n.submittedBy}</div>
              </td>
              <td>{n.contactName}</td>
              <td>
                <button className="link" onClick={() => navigate(`/sales/invoices/${n.invoiceId}`)}>
                  {n.invoiceNumber}
                </button>
              </td>
              <td className="text-xs">
                {fmtDate(n.date)} · {n.mode}
                <div className="text-slate-500">Ref {n.reference}</div>
              </td>
              <td className="text-right font-medium tabular-nums">{money(n.amount)}</td>
              <td className="text-right">
                {n.status === 'pending' ? (
                  <div className="flex justify-end gap-1">
                    <button className="btn-primary btn-sm" onClick={() => setRecord(n)}>
                      Record
                    </button>
                    <button className="btn-ghost btn-sm" onClick={() => dismiss.mutate(n.id)}>
                      Dismiss
                    </button>
                  </div>
                ) : (
                  <span className={clsx('text-[11px] font-semibold uppercase', n.status === 'recorded' ? 'text-emerald-600' : 'text-slate-400')}>{n.status}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {record && <RecordNoticeModal notice={record} onClose={() => setRecord(null)} />}
    </>
  );
}
