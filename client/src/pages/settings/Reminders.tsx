// Settings > Payment Reminders: automatic emails before and after an invoice's due date.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, Plus, Trash2, Play } from 'lucide-react';
import { fmtDateTime } from '@shared/format';
import { describeRule, type ReminderRule, type ReminderSettings } from '@shared/reminders';
import { api, useAction, useApi } from '../../api';
import { useMe } from '../../auth';
import { Spinner, clsx } from '../../components/ui';

interface Data {
  settings: ReminderSettings;
  upcoming: { invoiceId: string; number: string; ruleName: string }[];
  log: { ruleId: string; at: string; status: string; error?: string; invoiceId: string; number: string; contactName?: string; ruleName: string }[];
}

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} className={clsx('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:opacity-50', on ? 'bg-brand-600' : 'bg-slate-300')}>
      <span className={clsx('inline-block h-4 w-4 rounded-full bg-white shadow transition', on ? 'translate-x-[18px]' : 'translate-x-0.5')} />
    </button>
  );
}

const STATUS: Record<string, string> = { sent: 'bg-emerald-50 text-emerald-700', outbox: 'bg-amber-50 text-amber-700', failed: 'bg-red-50 text-red-700', skipped: 'bg-slate-100 text-slate-600' };

export default function PaymentReminders() {
  const admin = useMe().user.role === 'Admin';
  const { data } = useApi<Data>('/payment-reminders');
  const [s, setS] = useState<ReminderSettings | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    if (data && !s) setS(data.settings);
  }, [data, s]);
  const save = useAction(() => api<ReminderSettings>('/payment-reminders', { method: 'PUT', body: s }), 'Payment reminders saved');
  const run = useAction(() => api<{ sent: number; outbox: number; failed: number }>('/payment-reminders/run', { body: {} }), (r) => `${r.sent + r.outbox} reminder(s) sent${r.failed ? `, ${r.failed} failed` : ''}`);
  if (!data || !s) return <Spinner />;
  const setRule = (id: string, p: Partial<ReminderRule>) => setS({ ...s, rules: s.rules.map((r) => (r.id === id ? { ...r, ...p } : r)) });
  const addRule = () => {
    const id = `rem_${Date.now().toString(36)}`;
    setS({ ...s, rules: [...s.rules, { id, name: 'New reminder', when: 'after', days: 30, enabled: true, subject: 'Reminder: invoice %DocumentNumber% is %DaysOverdue% days overdue', body: s.rules.find((r) => r.when === 'after')?.body ?? '' }] });
    setOpen(id);
  };
  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[15px] font-semibold text-ink-900">
            <BellRing size={17} className="text-brand-600" /> Payment Reminders
          </div>
          <p className="mt-1 text-slate-600">
            Email clients automatically before an invoice falls due and after it becomes overdue. Each reminder goes out once per invoice, with the invoice PDF and a link to view it. Turn reminders off for one invoice from its <b>Reminders</b> menu.
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
          <span className="text-[13px] font-medium">{s.enabled ? 'On' : 'Off'}</span>
          <Switch on={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} label="Send payment reminders automatically" disabled={!admin} />
        </label>
      </div>
      {!admin && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900">Only an Admin can change payment reminders.</div>}

      <div className="card divide-y divide-slate-100">
        {s.rules.map((r) => (
          <div key={r.id} className="px-4 py-3">
            <div className="flex items-center gap-3">
              <Switch on={r.enabled} onChange={(v) => setRule(r.id, { enabled: v })} label={`Use ${r.name}`} disabled={!admin} />
              <button className="flex-1 text-left" onClick={() => setOpen(open === r.id ? null : r.id)}>
                <div className="font-medium text-ink-900">{r.name}</div>
                <div className="text-xs text-slate-500">{describeRule(r)}</div>
              </button>
              <button className="btn-ghost btn-sm" onClick={() => setOpen(open === r.id ? null : r.id)}>
                {open === r.id ? 'Close' : 'Edit'}
              </button>
              {admin && (
                <button className="btn-ghost btn-sm text-red-600" aria-label={`Remove ${r.name}`} onClick={() => setS({ ...s, rules: s.rules.filter((x) => x.id !== r.id) })}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            {open === r.id && (
              <fieldset disabled={!admin} className="mt-3 space-y-3 rounded-lg bg-slate-50 p-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_90px_160px]">
                  <label className="block">
                    <span className="label">Name</span>
                    <input className="input mt-1" value={r.name} onChange={(e) => setRule(r.id, { name: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className="label">Days</span>
                    <input className="input mt-1" type="number" min={0} max={365} value={r.days} onChange={(e) => setRule(r.id, { days: Number(e.target.value) })} />
                  </label>
                  <label className="block">
                    <span className="label">When</span>
                    <select className="input mt-1" value={r.when} onChange={(e) => setRule(r.id, { when: e.target.value as ReminderRule['when'] })}>
                      <option value="before">Before the due date</option>
                      <option value="after">After the due date</option>
                    </select>
                  </label>
                </div>
                <label className="block">
                  <span className="label">Subject</span>
                  <input className="input mt-1" value={r.subject} onChange={(e) => setRule(r.id, { subject: e.target.value })} />
                </label>
                <label className="block">
                  <span className="label">Message</span>
                  <textarea className="input mt-1 font-mono text-[12px]" rows={9} value={r.body} onChange={(e) => setRule(r.id, { body: e.target.value })} />
                </label>
                <p className="text-xs text-slate-500">Placeholders: %ContactName%, %DocumentNumber%, %DocumentDate%, %DueDate%, %BalanceDue%, %DaysOverdue%, %CompanyName%.</p>
              </fieldset>
            )}
          </div>
        ))}
      </div>

      {admin && (
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
            Save
          </button>
          <button className="btn-secondary" onClick={addRule} disabled={s.rules.length >= 10}>
            <Plus size={14} /> Add Reminder
          </button>
          <label className="ml-2 flex items-center gap-2 text-[13px] text-slate-600">
            <input type="checkbox" checked={s.ccOrganization} onChange={(e) => setS({ ...s, ccOrganization: e.target.checked })} /> Copy the organization email on every reminder
          </label>
          <div className="flex-1" />
          <button className="btn-secondary" onClick={() => run.mutate()} disabled={!data.settings.enabled || run.isPending} title={data.settings.enabled ? 'Send the reminders that are due now' : 'Turn reminders on and save first'}>
            <Play size={14} /> Send due reminders now
          </button>
        </div>
      )}

      <div>
        <div className="mb-2 text-[13px] font-semibold text-ink-900">Due now</div>
        {data.upcoming.length ? (
          <div className="flex flex-wrap gap-2">
            {data.upcoming.map((u) => (
              <Link key={u.invoiceId} to={`/sales/invoices/${u.invoiceId}`} className="chip bg-brand-50 text-brand-800 hover:bg-brand-100">
                {u.number} · {u.ruleName}
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-[13px] text-slate-500">{data.settings.enabled ? 'Nothing is due. Reminders are checked every hour.' : 'Reminders are off.'}</div>
        )}
      </div>

      <div>
        <div className="mb-2 text-[13px] font-semibold text-ink-900">Recent reminders</div>
        <div className="card overflow-hidden">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Invoice</th>
                <th>Client</th>
                <th>Reminder</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.log.map((x, i) => (
                <tr key={i}>
                  <td className="whitespace-nowrap">{fmtDateTime(x.at)}</td>
                  <td>
                    <Link className="link" to={`/sales/invoices/${x.invoiceId}`}>
                      {x.number}
                    </Link>
                  </td>
                  <td>{x.contactName}</td>
                  <td>{x.ruleName}</td>
                  <td>
                    <span className={clsx('chip capitalize', STATUS[x.status])} title={x.error}>
                      {x.status === 'outbox' ? 'In outbox' : x.status}
                    </span>
                  </td>
                </tr>
              ))}
              {!data.log.length && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-500">
                    No reminders have been sent yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
