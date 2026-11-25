// Settings > Users & Access (Admins: approve sign-ups, invite, roles, turn access off) and Settings > My Account.
import { useState } from 'react';
import { Copy, KeyRound, LogOut, MailPlus, MoreHorizontal, ShieldCheck, UserCheck, UserX } from 'lucide-react';
import { fmtDateTime } from '@shared/format';
import { api, useAction, useApi } from '../../api';
import { useMe } from '../../auth';
import { toast } from '../../lib/toast';
import { Dropdown, Field, MenuItem, Modal, Select, Spinner, clsx, useConfirm } from '../../components/ui';

type Role = 'Admin' | 'Staff' | 'Timesheet Staff';
interface Member {
  id: string;
  name: string;
  email?: string;
  role: Role;
  status: 'active' | 'inactive' | 'pending' | 'invited';
  createdAt: string;
  lastLoginAt?: string;
  hasPassword: boolean;
  inviteExpiresAt?: string;
  sessions: number;
}

const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: 'Admin', label: 'Admin', hint: 'Everything, including settings and who can sign in' },
  { value: 'Staff', label: 'Staff', hint: 'Day-to-day bookkeeping in every module' },
  { value: 'Timesheet Staff', label: 'Timesheet Staff', hint: 'Logs time on the projects they are on' },
];

const STATUS: Record<Member['status'], { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'bg-emerald-50 text-emerald-700' },
  pending: { label: 'Awaiting approval', cls: 'bg-amber-50 text-amber-700' },
  invited: { label: 'Invited', cls: 'bg-sky-50 text-sky-700' },
  inactive: { label: 'No access', cls: 'bg-slate-100 text-slate-600' },
};

function InviteResult({ url, delivered, onClose }: { url: string; delivered: boolean; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="Invitation ready" footer={<button className="btn-primary" onClick={onClose}>Done</button>}>
      <p className="mb-3 text-[13px] text-slate-600">{delivered ? 'We emailed the invitation. You can also share this link directly:' : 'Email is not set up yet (Settings > Emails), so the invitation is waiting in the outbox. Share this link with them directly:'}</p>
      <div className="flex gap-2">
        <input className="input font-mono text-xs" readOnly value={url} onFocus={(e) => e.target.select()} />
        <button
          className="btn-secondary"
          onClick={() => {
            navigator.clipboard?.writeText(url).then(() => toast.success('Link copied'), () => undefined);
          }}
        >
          <Copy size={13} /> Copy
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">The link works for 7 days and only once.</p>
    </Modal>
  );
}

export function UsersAccess() {
  const me = useMe();
  const { data, isLoading, error } = useApi<Member[]>('/team');
  const [invite, setInvite] = useState(false);
  const [link, setLink] = useState<{ url: string; delivered: boolean } | null>(null);
  const confirm = useConfirm();
  const act = useAction(({ id, action, body }: { id: string; action: string; body?: unknown }) => api<{ inviteUrl?: string; delivered?: boolean }>(`/team/${id}/${action}`, { body: body ?? {} }));
  const reject = useAction((id: string) => api(`/team/${id}`, { method: 'DELETE' }), 'Sign-up rejected');
  const run = (id: string, action: string, msg: string, body?: unknown) =>
    act.mutate(
      { id, action, body },
      {
        onSuccess: (r) => {
          if (r.inviteUrl) setLink({ url: r.inviteUrl, delivered: !!r.delivered });
          else toast.success(msg);
        },
      },
    );

  if (me.user.role !== 'Admin') return <div className="text-[13px] text-slate-500">Only an Admin can manage users.</div>;
  if (isLoading) return <Spinner />;
  if (error) return <div className="text-red-600">{(error as Error).message}</div>;
  const list = data ?? [];
  const pending = list.filter((u) => u.status === 'pending');

  return (
    <div className="max-w-5xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold">Users & Access</h2>
          <p className="text-[13px] text-slate-500">Who can sign in to {me.organization}, and what they can do.</p>
        </div>
        <button className="btn-primary" onClick={() => setInvite(true)}>
          <MailPlus size={14} /> Invite User
        </button>
      </div>

      {pending.length > 0 && (
        <div className="mb-5 rounded-md border border-amber-200 bg-amber-50">
          <div className="border-b border-amber-200 px-4 py-2 text-[13px] font-semibold text-amber-900">
            {pending.length} sign-up{pending.length === 1 ? '' : 's'} waiting for approval
          </div>
          {pending.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[13px]">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-slate-800">{u.name}</div>
                <div className="text-xs text-slate-500">
                  {u.email} · signed up {fmtDateTime(u.createdAt)}
                </div>
              </div>
              <Select className="w-44" aria-label="Role" value={u.role} onChange={(e) => run(u.id, 'role', 'Role updated', { role: e.target.value })} options={ROLES} />
              <button className="btn-primary btn-sm" onClick={() => run(u.id, 'approve', `${u.name} can now sign in`)}>
                <UserCheck size={13} /> Approve
              </button>
              <button className="btn-secondary btn-sm" onClick={() => confirm.ask('Reject sign-up', `${u.name} will not be able to sign in.`, () => reject.mutate(u.id), { danger: true, label: 'Reject' })}>
                Reject
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Status</th>
              <th className="hidden md:table-cell">Last sign-in</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {list
              .filter((u) => u.status !== 'pending')
              .map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="font-medium text-slate-800">
                      {u.name} {u.id === me.user.id && <span className="ml-1 text-xs font-normal text-slate-400">(you)</span>}
                    </div>
                    <div className="text-xs text-slate-500">{u.email || 'No email'}</div>
                  </td>
                  <td>
                    {u.id === me.user.id ? (
                      u.role
                    ) : (
                      <select className="input h-7 w-40 text-xs" aria-label={`Role of ${u.name}`} value={u.role} onChange={(e) => run(u.id, 'role', 'Role updated', { role: e.target.value })}>
                        {ROLES.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>
                    <span className={clsx('rounded px-1.5 py-0.5 text-xxs font-semibold uppercase', (u.status === 'active' && !u.hasPassword ? STATUS.inactive : STATUS[u.status]).cls)}>
                      {u.status === 'active' && !u.hasPassword ? 'No sign-in yet' : STATUS[u.status].label}
                    </span>
                  </td>
                  <td className="hidden text-slate-500 md:table-cell">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : '—'}</td>
                  <td className="text-right">
                    {u.id !== me.user.id && (
                      <Dropdown align="right" button={() => <button className="btn-ghost btn-sm" aria-label={`Actions for ${u.name}`}><MoreHorizontal size={15} /></button>}>
                        {(!u.hasPassword || u.status === 'invited') && u.status !== 'inactive' && (
                          <MenuItem icon={<MailPlus size={13} />} onClick={() => (u.email ? run(u.id, 'resend-invite', 'Invitation sent') : toast.error('Add an email address for this user first'))}>
                            {u.status === 'invited' ? 'Resend Invitation' : 'Send Invitation'}
                          </MenuItem>
                        )}
                        {u.sessions > 0 && (
                          <MenuItem icon={<LogOut size={13} />} onClick={() => run(u.id, 'sign-out', `${u.name} was signed out everywhere`)}>
                            Sign Out Everywhere
                          </MenuItem>
                        )}
                        {u.status === 'inactive' ? (
                          <MenuItem icon={<UserCheck size={13} />} onClick={() => run(u.id, 'activate', 'Access restored')}>
                            Restore Access
                          </MenuItem>
                        ) : (
                          <MenuItem danger icon={<UserX size={13} />} onClick={() => confirm.ask('Turn off access', `${u.name} is signed out and can't sign in again until you restore access. Their past work stays.`, () => run(u.id, 'deactivate', 'Access turned off'), { danger: true, label: 'Turn Off' })}>
                            Turn Off Access
                          </MenuItem>
                        )}
                      </Dropdown>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {ROLES.map((r) => (
          <div key={r.value} className="rounded-md border border-slate-200 bg-white px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[13px] font-medium">
              <ShieldCheck size={13} className="text-brand-600" /> {r.label}
            </div>
            <div className="text-xs text-slate-500">{r.hint}</div>
          </div>
        ))}
      </div>
      {invite && <InviteModal onClose={() => setInvite(false)} onSent={(url, delivered) => setLink({ url, delivered })} />}
      {link && <InviteResult url={link.url} delivered={link.delivered} onClose={() => setLink(null)} />}
      {confirm.node}
    </div>
  );
}

function InviteModal({ onClose, onSent }: { onClose: () => void; onSent: (url: string, delivered: boolean) => void }) {
  const [f, setF] = useState<{ name: string; email: string; role: Role }>({ name: '', email: '', role: 'Staff' });
  const send = useAction(() => api<{ inviteUrl: string; delivered: boolean }>('/team/invite', { body: f }));
  return (
    <Modal
      open
      onClose={onClose}
      title="Invite User"
      footer={
        <>
          <button className="btn-primary" disabled={send.isPending} onClick={() => send.mutate(undefined, { onSuccess: (r) => { onClose(); onSent(r.inviteUrl, r.delivered); } })}>
            Send Invitation
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label="Name" required>
          <input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Email" required>
          <input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label="Role" hint={ROLES.find((r) => r.value === f.role)?.hint}>
          <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })} options={ROLES} />
        </Field>
      </div>
    </Modal>
  );
}

export function MyAccount() {
  const me = useMe();
  const [name, setName] = useState(me.user.name);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const saveName = useAction(() => api('/auth/profile', { method: 'PUT', body: { name } }), 'Profile saved');
  const change = useAction(async () => {
    if (pw.newPassword !== pw.confirm) throw new Error('The new passwords do not match');
    return api('/auth/change-password', { body: pw });
  }, 'Password changed. Other browsers were signed out.');
  return (
    <div className="max-w-2xl space-y-8">
      <section>
        <h2 className="mb-1 text-[17px] font-semibold">My Account</h2>
        <p className="mb-4 text-[13px] text-slate-500">
          {me.user.email} · {me.user.role}
        </p>
        <div className="space-y-3.5">
          <Field label="Name" required>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="sm:pl-[196px]">
            <button className="btn-primary" disabled={saveName.isPending || !name.trim() || name === me.user.name} onClick={() => saveName.mutate()}>
              Save
            </button>
          </div>
        </div>
      </section>
      {!me.authDisabled && (
        <section className="border-t border-slate-200 pt-6">
          <h3 className="mb-4 flex items-center gap-2 text-[15px] font-semibold">
            <KeyRound size={15} /> Change Password
          </h3>
          <form
            className="space-y-3.5"
            onSubmit={(e) => {
              e.preventDefault();
              change.mutate(undefined, { onSuccess: () => setPw({ currentPassword: '', newPassword: '', confirm: '' }) });
            }}
          >
            <Field label="Current Password" required>
              <input className="input" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
            </Field>
            <Field label="New Password" required hint="At least 8 characters, with letters and a number">
              <input className="input" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
            </Field>
            <Field label="Confirm New Password" required>
              <input className="input" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            </Field>
            <div className="sm:pl-[196px]">
              <button type="submit" className="btn-primary" disabled={change.isPending || !pw.currentPassword || !pw.newPassword}>
                Change Password
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
