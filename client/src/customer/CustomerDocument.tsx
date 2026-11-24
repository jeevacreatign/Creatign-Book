// What a customer sees for one transaction, in the portal and on shared links:
// the document itself, its status and amount, PDF download, quote accept/decline,
// how to pay (UPI QR + bank details) and "I've paid" payment notices.
import { useEffect, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { AlertCircle, CheckCircle2, Clock, Copy, Download, FileText, IndianRupee, Landmark, Printer, Smartphone, ThumbsDown, ThumbsUp, XCircle } from 'lucide-react';
import { DOC_META } from '@shared/docmeta';
import { fmtDate, fmtDateTime, money, statusLabel, today } from '@shared/format';
import type { PdfTemplate } from '@shared/pdfTemplate';
import type { CustomerResponse } from '@shared/portal';
import type { Contact, Organization, TxnDoc } from '@shared/types';
import { DocumentPreview } from '../components/DocumentPreview';
import { clsx } from '../components/ui';
import { toast } from '../lib/toast';

export interface CustomerDocPayload {
  doc: TxnDoc & { contact?: Contact; contactName: string; customerResponse?: CustomerResponse };
  organization: Organization;
  template: PdfTemplate;
  preferences: Record<string, unknown>;
  canRespond: boolean;
  canNotifyPayment: boolean;
  payment?: { balance: number; upiId?: string; upiPayeeName?: string; upiLink?: string; bankInstructions?: string };
  paymentModes: string[];
  pendingNotices: { id: string; amount: number; date: string; mode: string; reference?: string; createdAt: string }[];
  payments: { id: string; number: string; date: string; mode: string; amount: number }[];
  portalName: string;
  expiresOn?: string;
}

/** Customer-facing status: what it means for them, not our workflow names. */
export function customerStatus(d: Pick<TxnDoc, 'kind' | 'status' | 'balance' | 'dueDate' | 'expiryDate'>) {
  if (d.status === 'void') return { label: 'Void', tone: 'slate' as const };
  if (d.kind === 'invoice') {
    if (d.balance <= 0) return { label: 'Paid', tone: 'green' as const };
    if (d.dueDate && d.dueDate < today()) return { label: 'Overdue', tone: 'red' as const };
    if (d.status === 'partially_paid') return { label: 'Partially Paid', tone: 'amber' as const };
    return { label: 'Due', tone: 'blue' as const };
  }
  if (d.kind === 'quote') {
    if (d.status === 'sent' && d.expiryDate && d.expiryDate < today()) return { label: 'Expired', tone: 'slate' as const };
    if (d.status === 'sent') return { label: 'Awaiting your response', tone: 'blue' as const };
    if (d.status === 'accepted' || d.status === 'invoiced') return { label: 'Accepted', tone: 'green' as const };
    if (d.status === 'declined') return { label: 'Declined', tone: 'red' as const };
  }
  if (d.kind === 'credit_note') return d.balance > 0 ? { label: 'Credit available', tone: 'green' as const } : { label: 'Credit used', tone: 'slate' as const };
  return { label: statusLabel(d.status), tone: 'blue' as const };
}

const TONE = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200',
  slate: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export function StatusChip({ d, className }: { d: Parameters<typeof customerStatus>[0]; className?: string }) {
  const s = customerStatus(d);
  return <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', TONE[s.tone], className)}>{s.label}</span>;
}

function Panel({ title, icon, children, className }: { title?: ReactNode; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('rounded-xl border border-slate-200 bg-white p-5 shadow-sm', className)}>
      {title && (
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
          {icon}
          {title}
        </h3>
      )}
      {children}
    </section>
  );
}

function QR({ value }: { value: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(value, { margin: 1, width: 360, errorCorrectionLevel: 'M' }).then(setSrc).catch(() => setSrc(''));
  }, [value]);
  return src ? <img src={src} alt="UPI QR code" className="h-40 w-40 rounded-lg border border-slate-200 bg-white p-1.5" /> : <div className="h-40 w-40 rounded-lg bg-slate-100" />;
}

function copy(text: string, what: string) {
  navigator.clipboard?.writeText(text);
  toast.success(`${what} copied`);
}

export function CustomerDocument({ data, pdfUrl, onRespond, onNotify, signedInName }: { data: CustomerDocPayload; pdfUrl: string; onRespond: (b: { action: 'accept' | 'decline'; name?: string; comment?: string }) => Promise<unknown>; onNotify: (b: Record<string, unknown>) => Promise<unknown>; signedInName?: string }) {
  const d = data.doc;
  const meta = DOC_META[d.kind];
  const [respond, setRespond] = useState<'accept' | 'decline' | null>(null);
  const [name, setName] = useState(signedInName || '');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [notify, setNotify] = useState(false);
  const [pay, setPay] = useState({ amount: String(data.payment?.balance ?? ''), date: today(), mode: 'UPI', reference: '', note: '', name: signedInName || '' });
  const [done, setDone] = useState<string | null>(null);

  async function submitResponse() {
    if (!respond) return;
    setBusy(true);
    try {
      await onRespond({ action: respond, name: name.trim() || undefined, comment: comment.trim() || undefined });
      setDone(respond === 'accept' ? 'Thank you! The quote has been accepted and we have been notified.' : 'Thank you for letting us know. The quote has been declined.');
      setRespond(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submitNotice() {
    setBusy(true);
    try {
      await onNotify({ ...pay, amount: Number(pay.amount) });
      setDone('Thanks! We have received your payment details and will confirm once it reflects in our account.');
      setNotify(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const amountLabel = d.kind === 'invoice' ? (d.balance > 0 ? 'Balance due' : 'Total paid') : d.kind === 'credit_note' ? 'Credit amount' : 'Total';
  const amount = d.kind === 'invoice' && d.balance > 0 ? d.balance : d.total;
  const p = data.payment;
  const r = d.customerResponse;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="order-2 min-w-0 lg:order-1">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-5">
          <DocumentPreview doc={d} org={data.organization} contact={d.contact} template={data.template} preferences={data.preferences} ribbon={false} />
        </div>
      </div>

      <aside className="order-1 space-y-4 lg:sticky lg:top-6 lg:order-2 lg:self-start">
        <Panel>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{meta.label}</div>
              <div className="text-lg font-semibold text-slate-900">{d.number}</div>
            </div>
            <StatusChip d={d} />
          </div>
          <div className="mt-4 rounded-lg bg-slate-50 px-4 py-3">
            <div className="text-xs text-slate-500">{amountLabel}</div>
            <div className="text-2xl font-semibold tabular-nums text-slate-900">{money(amount)}</div>
            {d.kind === 'invoice' && d.balance > 0 && d.balance !== d.total && <div className="text-xs text-slate-500">of {money(d.total)} total</div>}
          </div>
          <dl className="mt-3 space-y-1.5 text-[13px]">
            <div className="flex justify-between">
              <dt className="text-slate-500">{meta.dateLabel}</dt>
              <dd className="text-slate-800">{fmtDate(d.date)}</dd>
            </div>
            {d.kind === 'invoice' && d.dueDate && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Due date</dt>
                <dd className={clsx(d.balance > 0 && d.dueDate < today() ? 'font-medium text-red-600' : 'text-slate-800')}>{fmtDate(d.dueDate)}</dd>
              </div>
            )}
            {d.kind === 'quote' && d.expiryDate && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Valid until</dt>
                <dd className="text-slate-800">{fmtDate(d.expiryDate)}</dd>
              </div>
            )}
            {d.referenceNumber && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Reference</dt>
                <dd className="text-slate-800">{d.referenceNumber}</dd>
              </div>
            )}
          </dl>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <a className="btn-secondary h-9" href={`${pdfUrl}${pdfUrl.includes('?') ? '&' : '?'}download=1`}>
              <Download size={14} /> Download
            </a>
            <a className="btn-secondary h-9" href={pdfUrl} target="_blank" rel="noreferrer">
              <Printer size={14} /> Print
            </a>
          </div>
          {data.expiresOn && <div className="mt-3 text-center text-xxs text-slate-400">This secure link is valid until {fmtDate(data.expiresOn)}.</div>}
        </Panel>

        {done && (
          <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-[13px] text-emerald-800">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
            {done}
          </div>
        )}

        {r && (
          <Panel>
            <div className={clsx('flex items-start gap-2 text-[13px]', r.action === 'accepted' ? 'text-emerald-800' : 'text-red-700')}>
              {r.action === 'accepted' ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : <XCircle size={18} className="mt-0.5 shrink-0" />}
              <div>
                <div className="font-medium">
                  {r.action === 'accepted' ? 'Accepted' : 'Declined'} by {r.by}
                </div>
                <div className="text-xs text-slate-500">{fmtDateTime(r.at)}</div>
                {r.comment && <div className="mt-1 text-slate-700">“{r.comment}”</div>}
              </div>
            </div>
          </Panel>
        )}

        {data.canRespond && !done && (
          <Panel title="Your response">
            {!respond ? (
              <>
                <p className="mb-3 text-[13px] text-slate-600">Review the quote and let {data.organization.name} know if you would like to go ahead.</p>
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn h-10 border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setRespond('accept')}>
                    <ThumbsUp size={15} /> Accept
                  </button>
                  <button className="btn-secondary h-10" onClick={() => setRespond('decline')}>
                    <ThumbsDown size={15} /> Decline
                  </button>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <label className="block text-[13px]">
                  <span className="mb-1 block text-slate-600">Your name</span>
                  <input className="input h-9" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
                </label>
                <label className="block text-[13px]">
                  <span className="mb-1 block text-slate-600">{respond === 'decline' ? 'Reason for declining' : 'Comments (optional)'}</span>
                  <textarea className="input min-h-[80px]" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={respond === 'decline' ? 'Let us know what we could change' : 'Anything we should know?'} />
                </label>
                {respond === 'accept' && <p className="text-xxs text-slate-500">By accepting, you agree to the items, prices and terms in this quote. Your name, the date and time are recorded.</p>}
                <div className="flex gap-2">
                  <button className={clsx('btn h-9 flex-1 text-white', respond === 'accept' ? 'border-emerald-600 bg-emerald-600 hover:bg-emerald-700' : 'border-red-600 bg-red-600 hover:bg-red-700')} disabled={busy || !name.trim()} onClick={submitResponse}>
                    {busy ? 'Saving…' : respond === 'accept' ? 'Accept Quote' : 'Decline Quote'}
                  </button>
                  <button className="btn-secondary h-9" onClick={() => setRespond(null)}>
                    Back
                  </button>
                </div>
              </div>
            )}
          </Panel>
        )}

        {p && (
          <Panel title="How to pay" icon={<IndianRupee size={15} className="text-emerald-600" />}>
            {!p.upiId && !p.bankInstructions && <p className="text-[13px] text-slate-600">Contact {data.organization.name} for payment details{data.organization.email ? ` at ${data.organization.email}` : ''}.</p>}
            {p.upiId && (
              <div className="mb-4">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-700">
                  <Smartphone size={13} /> UPI
                </div>
                <div className="flex items-center gap-4">
                  {p.upiLink && <QR value={p.upiLink} />}
                  <div className="min-w-0 text-[13px]">
                    <div className="text-slate-500">Scan with any UPI app, or pay to</div>
                    <button className="mt-0.5 inline-flex max-w-full items-center gap-1 font-mono font-medium text-slate-900 hover:text-brand-700" onClick={() => copy(p.upiId!, 'UPI ID')}>
                      <span className="truncate">{p.upiId}</span> <Copy size={12} className="shrink-0" />
                    </button>
                    <div className="text-xs text-slate-500">{p.upiPayeeName}</div>
                    <div className="mt-1 text-xs text-slate-500">Amount {money(p.balance)}</div>
                  </div>
                </div>
                {p.upiLink && (
                  <a className="btn mt-3 h-9 w-full border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 sm:hidden" href={p.upiLink}>
                    Pay {money(p.balance)} with UPI
                  </a>
                )}
              </div>
            )}
            {p.bankInstructions && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-700">
                  <Landmark size={13} /> Bank transfer
                </div>
                <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-mono text-xs leading-5 text-slate-700">{p.bankInstructions}</pre>
                <div className="mt-1 text-xxs text-slate-500">Please mention {d.number} in the payment remarks.</div>
              </div>
            )}
          </Panel>
        )}

        {data.pendingNotices.length > 0 && (
          <Panel>
            {data.pendingNotices.map((n) => (
              <div key={n.id} className="flex items-start gap-2 text-[13px] text-slate-700">
                <Clock size={15} className="mt-0.5 shrink-0 text-amber-500" />
                <div>
                  Payment of <b>{money(n.amount)}</b> on {fmtDate(n.date)} reported. Waiting for confirmation.
                  <div className="text-xxs text-slate-500">Ref {n.reference}</div>
                </div>
              </div>
            ))}
          </Panel>
        )}

        {data.canNotifyPayment && !done && (
          <Panel title={notify ? 'Tell us about your payment' : undefined}>
            {!notify ? (
              <button className="btn-primary h-10 w-full" onClick={() => setNotify(true)}>
                <CheckCircle2 size={15} /> I’ve made a payment
              </button>
            ) : (
              <div className="space-y-3 text-[13px]">
                {!signedInName && (
                  <label className="block">
                    <span className="mb-1 block text-slate-600">Your name</span>
                    <input className="input h-9" value={pay.name} onChange={(e) => setPay({ ...pay, name: e.target.value })} />
                  </label>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-slate-600">Amount (₹)</span>
                    <input className="input h-9 tabular-nums" inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-slate-600">Paid on</span>
                    <input className="input h-9" type="date" max={today()} value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} />
                  </label>
                </div>
                <label className="block">
                  <span className="mb-1 block text-slate-600">Paid via</span>
                  <select className="input h-9" value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })}>
                    {data.paymentModes.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-slate-600">Transaction / UTR reference</span>
                  <input className="input h-9 font-mono" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} placeholder="e.g. 431256789012" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-slate-600">Note (optional)</span>
                  <input className="input h-9" value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} />
                </label>
                <div className="flex gap-2">
                  <button className="btn-primary h-9 flex-1" disabled={busy} onClick={submitNotice}>
                    {busy ? 'Sending…' : 'Send payment details'}
                  </button>
                  <button className="btn-secondary h-9" onClick={() => setNotify(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </Panel>
        )}

        {data.payments.length > 0 && (
          <Panel title="Payments received" icon={<FileText size={15} className="text-slate-400" />}>
            <ul className="space-y-2 text-[13px]">
              {data.payments.map((x) => (
                <li key={x.id} className="flex justify-between">
                  <span className="text-slate-600">
                    {fmtDate(x.date)} · {x.mode}
                  </span>
                  <span className="font-medium tabular-nums">{money(x.amount)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {d.kind === 'quote' && d.status === 'sent' && !data.canRespond && !done && d.expiryDate && d.expiryDate < today() && (
          <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-4 text-[13px] text-slate-600">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-slate-400" /> This quote expired on {fmtDate(d.expiryDate)}. Contact {data.organization.name} for an updated quote.
          </div>
        )}
      </aside>
    </div>
  );
}

/** Organization branding used in customer page headers. */
export function OrgBrand({ org, sub }: { org: Pick<Organization, 'name' | 'logo'>; sub?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {org.logo ? <img src={org.logo} alt="" className="h-9 w-auto max-w-[140px] object-contain" /> : <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">{org.name.slice(0, 1)}</div>}
      <div className="min-w-0">
        <div className="truncate font-semibold text-slate-900">{org.name}</div>
        {sub && <div className="truncate text-xs text-slate-500">{sub}</div>}
      </div>
    </div>
  );
}
