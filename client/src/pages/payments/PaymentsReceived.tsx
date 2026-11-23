import { useEffect, useMemo, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronDown, FileText, Mail, MoreHorizontal, Pencil, Plus, Printer, X, Lock, Unlock, Ban, Trash2, BookOpen, MessageSquare } from 'lucide-react';
import { fmtDate, money, num, today, round2 } from '@shared/format';
import { PAYMENT_MODES, type Contact, type Journal, type PaymentReceived, type TxnDoc } from '@shared/types';
import { api, qs, useAction, useApi } from '../../api';
import { useBoot, isCashLike } from '../../lib/app';
import { toast } from '../../lib/toast';
import { AccountSelect, Checkbox, ContactPicker, DateInput, Dropdown, Field, FormFooter, MenuItem, Modal, MoneyInput, PageHeader, Radio, SearchBox, Select, Spinner, Status, Tabs, clsx, useConfirm } from '../../components/ui';
import { Attachments, EmailModal, JournalTable, Timeline } from '../../components/shared';
import { ReceiptPreview, TEMPLATES, type Template } from '../../components/DocumentPreview';

type Row = PaymentReceived & { contactName: string; invoiceNumbers: string[] };
type Detail = PaymentReceived & { contactName: string; contact?: Contact; invoices: { docId: string; amount: number; doc?: TxnDoc }[]; journals: Journal[] };

function List() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const { data = [], isLoading } = useApi<Row[]>(`/payments-received${qs({ q })}`);
  if (isLoading) return <Spinner />;
  return (
    <div>
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <div className="text-[15px] font-semibold">All Received Payments</div>
        <button className="btn-primary" onClick={() => navigate('/sales/payments-received/new')}>
          <Plus size={15} /> New
        </button>
      </div>
      {!data.length && !q ? (
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <div className="text-lg font-semibold">No payments received yet</div>
          <div className="text-slate-500">Record payments against invoices as your customers pay you.</div>
          <button className="btn-primary" onClick={() => navigate('/sales/payments-received/new')}>
            Record Payment
          </button>
        </div>
      ) : (
        <>
          <div className="px-5 py-3">
            <div className="w-72">
              <SearchBox value={q} onChange={setQ} placeholder="Search payments" />
            </div>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Payment #</th>
                <th>Reference Number</th>
                <th>Customer Name</th>
                <th>Invoice#</th>
                <th>Mode</th>
                <th>Status</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Unused Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id} className="row-link" onClick={() => navigate(`/sales/payments-received/${p.id}`)}>
                  <td>{fmtDate(p.date)}</td>
                  <td className="text-brand-600">{p.number}</td>
                  <td>{p.referenceNumber}</td>
                  <td>{p.contactName}</td>
                  <td>{p.invoiceNumbers.join(', ')}</td>
                  <td>{p.mode}</td>
                  <td>
                    <Status status={p.status} />
                  </td>
                  <td className="text-right tabular-nums">{money(p.amount)}</td>
                  <td className="text-right tabular-nums">{money(p.unusedAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export function PaymentForm() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { accounts } = useBoot();
  const { data: existing } = useApi<PaymentReceived>(id ? `/payments-received/${id}` : null);
  const { data: next } = useApi<{ number: string }>(id ? null : '/payments-received/next-number');
  const [f, setF] = useState<Partial<PaymentReceived> | null>(null);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [fullAmount, setFullAmount] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (f) return;
    if (existing) {
      setF(existing);
      setAlloc(Object.fromEntries(existing.allocations.map((a) => [a.docId, String(a.amount)])));
    } else if (!id && next) {
      setF({ number: next.number, date: today(), mode: 'Cash', depositToAccountId: 'acc_petty_cash', contactId: search.get('contactId') || undefined, bankCharges: 0, tdsDeducted: false, tdsAmount: 0, attachments: [], sendThankYou: false });
    }
  }, [existing, next, f, id, search]);

  const contactId = f?.contactId;
  const { data: invoices = [] } = useApi<TxnDoc[]>(contactId ? `/docs${qs({ kind: 'invoice', contactId })}` : null);
  const unpaid = useMemo(
    () =>
      invoices
        .filter((i) => ['open', 'sent', 'overdue', 'due_today', 'partially_paid'].includes(i.status) || existing?.allocations.some((a) => a.docId === i.id))
        .map((i) => ({ ...i, due: round2(i.balance + (existing?.status === 'paid' ? existing.allocations.find((a) => a.docId === i.id)?.amount ?? 0 : 0)) }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    [invoices, existing],
  );

  // preselect the invoice we came from
  const invoiceParam = search.get('invoiceId');
  useEffect(() => {
    if (!invoiceParam || !unpaid.length || Object.keys(alloc).length) return;
    const inv = unpaid.find((i) => i.id === invoiceParam);
    if (inv && f) {
      setAlloc({ [inv.id]: String(inv.due) });
      setF((cur) => ({ ...cur!, amount: inv.due }));
    }
  }, [invoiceParam, unpaid, alloc, f]);

  if (!f) return <Spinner />;
  const set = (p: Partial<PaymentReceived>) => setF({ ...f, ...p });
  const amount = Number(f.amount) || 0;
  const tds = f.tdsDeducted ? Number(f.tdsAmount) || 0 : 0;
  const used = round2(Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0));
  const refunded = round2((existing?.refunds || []).reduce((s, r) => s + r.amount, 0));
  const excess = round2(amount + tds - used - refunded);
  const totalDue = round2(unpaid.reduce((s, i) => s + i.due, 0));

  async function save(status: 'draft' | 'paid') {
    setSaving(true);
    try {
      const body = { ...f, status, allocations: Object.entries(alloc).map(([docId, a]) => ({ docId, amount: Number(a) || 0 })) };
      const saved = await api<PaymentReceived>(id ? `/payments-received/${id}` : '/payments-received', { method: id ? 'PUT' : 'POST', body });
      toast.success('The payment has been recorded.');
      navigate(`/sales/payments-received/${saved.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function payFull(inv: (typeof unpaid)[number], on: boolean) {
    const nextAlloc = { ...alloc, [inv.id]: on ? String(inv.due) : '' };
    setAlloc(nextAlloc);
    const sum = Object.values(nextAlloc).reduce((s, v) => s + (Number(v) || 0), 0);
    if (sum > amount + tds) set({ amount: round2(sum - tds) });
  }

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader title={id ? 'Edit Payment' : 'Record Payment'}>
        <button className="btn-ghost w-8 px-0" onClick={() => navigate(-1)} aria-label="Close">
          <X size={18} />
        </button>
      </PageHeader>
      <div className="flex-1 space-y-4 px-5 py-5">
        <div className="max-w-3xl space-y-3.5">
          <Field label="Customer Name" required>
            <ContactPicker
              kind="customer"
              value={f.contactId}
              disabled={!!id}
              onChange={(cid) => {
                set({ contactId: cid || undefined });
                setAlloc({});
              }}
            />
          </Field>
          <Field label="Amount Received" required>
            <MoneyInput
              className="max-w-xs"
              value={f.amount}
              onChange={(v) => {
                set({ amount: v as unknown as number });
                setFullAmount(false);
              }}
            />
            {contactId && totalDue > 0 && (
              <div className="mt-1.5">
                <Checkbox
                  checked={fullAmount}
                  onChange={(v) => {
                    setFullAmount(v);
                    if (v) {
                      set({ amount: totalDue });
                      setAlloc(Object.fromEntries(unpaid.map((i) => [i.id, String(i.due)])));
                    }
                  }}
                  label={`Received full amount (${money(totalDue)})`}
                />
              </div>
            )}
          </Field>
          <Field label="Bank Charges (if any)">
            <MoneyInput className="max-w-xs" value={f.bankCharges} onChange={(v) => set({ bankCharges: v as unknown as number })} />
          </Field>
          <Field label="Payment Date" required>
            <DateInput className="max-w-[200px]" value={f.date} onChange={(v) => set({ date: v })} />
          </Field>
          <Field label="Payment #" required>
            <input className="input max-w-xs" value={f.number || ''} onChange={(e) => set({ number: e.target.value })} />
          </Field>
          <Field label="Payment Mode">
            <Select className="max-w-xs" value={f.mode} onChange={(e) => set({ mode: e.target.value })} options={PAYMENT_MODES.map((m) => ({ value: m, label: m }))} />
          </Field>
          <Field label="Deposit To" required>
            <AccountSelect className="max-w-xs" accounts={accounts} value={f.depositToAccountId} onChange={(v) => set({ depositToAccountId: v })} filter={isCashLike} />
          </Field>
          <Field label="Reference#">
            <input className="input max-w-xs" value={f.referenceNumber || ''} onChange={(e) => set({ referenceNumber: e.target.value })} />
          </Field>
          <Field label="Tax deducted?">
            <Radio name="tds" value={f.tdsDeducted ? 'yes' : 'no'} onChange={(v) => set({ tdsDeducted: v === 'yes' })} options={[{ value: 'no', label: 'No Tax deducted' }, { value: 'yes', label: 'Yes, TDS (Income Tax)' }]} />
            {f.tdsDeducted && (
              <div className="mt-2 max-w-xs">
                <MoneyInput value={f.tdsAmount} onChange={(v) => set({ tdsAmount: v as unknown as number })} placeholder="TDS amount withheld" />
              </div>
            )}
          </Field>
        </div>

        <div className="max-w-5xl">
          <div className="mb-2 font-semibold">Unpaid Invoices</div>
          <table className="table border border-slate-200">
            <thead>
              <tr>
                <th>Date</th>
                <th>Invoice Number</th>
                <th className="text-right">Invoice Amount</th>
                <th className="text-right">Amount Due</th>
                <th className="w-48 text-right">Payment</th>
              </tr>
            </thead>
            <tbody>
              {!contactId && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-400">
                    Select a customer to see their unpaid invoices.
                  </td>
                </tr>
              )}
              {contactId && !unpaid.length && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-400">
                    There are no unpaid invoices for this customer. The whole amount will be kept as credit.
                  </td>
                </tr>
              )}
              {unpaid.map((i) => (
                <tr key={i.id}>
                  <td>
                    {fmtDate(i.date)}
                    <div className="text-xxs text-slate-500">Due {fmtDate(i.dueDate)}</div>
                  </td>
                  <td>{i.number}</td>
                  <td className="text-right">{money(i.total)}</td>
                  <td className="text-right">{money(i.due)}</td>
                  <td className="text-right">
                    <input type="number" className="input text-right" value={alloc[i.id] ?? ''} onChange={(e) => setAlloc({ ...alloc, [i.id]: e.target.value })} />
                    <button type="button" className="link mt-1 text-xxs" onClick={() => payFull(i, Number(alloc[i.id]) !== i.due)}>
                      {Number(alloc[i.id]) === i.due ? 'Clear' : 'Pay in Full'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex justify-end">
            <div className="w-96 space-y-1.5 rounded-md bg-slate-50 p-4 text-[13px]">
              <Line k="Amount Received" v={amount + tds} />
              <Line k="Amount used for Payments" v={used} />
              <Line k="Amount Refunded" v={refunded} />
              <Line k="Amount in Excess" v={excess} warn={excess < 0} />
              {excess > 0 && <div className="pt-1 text-xxs text-slate-500">The excess amount stays as an unused credit for this customer.</div>}
            </div>
          </div>
        </div>

        <div className="grid max-w-5xl gap-6 md:grid-cols-2">
          <div>
            <div className="mb-1 text-[13px]">Notes (Internal use. Not visible to customer)</div>
            <textarea className="input" rows={3} value={f.notes || ''} onChange={(e) => set({ notes: e.target.value })} />
          </div>
          <Attachments value={f.attachments || []} onChange={(v) => set({ attachments: v })} max={5} maxMB={10} label="Attachments" />
        </div>
        {!id && <Checkbox checked={!!f.sendThankYou} onChange={(v) => set({ sendThankYou: v })} label="Email a “thank you” note for this payment" />}
      </div>
      <FormFooter>
        {(!id || existing?.status === 'draft') && (
          <button className="btn-secondary" disabled={saving} onClick={() => save('draft')}>
            Save as Draft
          </button>
        )}
        <button className="btn-primary" disabled={saving} onClick={() => save('paid')}>
          Save as Paid
        </button>
        <button className="btn-ghost" onClick={() => navigate(-1)}>
          Cancel
        </button>
      </FormFooter>
    </div>
  );
}

function Line({ k, v, warn }: { k: string; v: number; warn?: boolean }) {
  return (
    <div className={clsx('flex justify-between', warn && 'text-red-600')}>
      <span>{k}:</span>
      <span className="tabular-nums">₹{num(v)}</span>
    </div>
  );
}

function DetailView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { organization: org, accounts } = useBoot();
  const { data: list = [] } = useApi<Row[]>('/payments-received');
  const { data: p } = useApi<Detail>(`/payments-received/${id}`);
  const [tab, setTab] = useState('receipt');
  const [template, setTemplate] = useState<Template>('elite');
  const [email, setEmail] = useState(false);
  const [refund, setRefund] = useState(false);
  const confirm = useConfirm();
  const act = useAction((a: string) => api(`/payments-received/${id}/actions/${a}`, { body: {} }), 'Done');
  const del = useAction(() => api(`/payments-received/${id}`, { method: 'DELETE' }), 'Payment deleted');
  return (
    <div className="flex h-full">
      <div className="no-print w-[300px] shrink-0 overflow-y-auto border-r border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5">
          <span className="font-semibold">All Received Payments</span>
          <button className="btn-primary w-8 px-0" onClick={() => navigate('/sales/payments-received/new')} aria-label="New">
            <Plus size={15} />
          </button>
        </div>
        {list.map((x) => (
          <Link key={x.id} to={`/sales/payments-received/${x.id}`} className={clsx('block border-b border-slate-100 px-3 py-2.5 hover:bg-slate-50', x.id === id && 'bg-brand-50/70')}>
            <div className="flex justify-between">
              <span className="font-medium">{x.contactName}</span>
              <span className="tabular-nums">{money(x.amount)}</span>
            </div>
            <div className="text-xs text-slate-500">
              {x.number} • {fmtDate(x.date)} • {x.mode}
            </div>
            <Status status={x.status} />
          </Link>
        ))}
      </div>
      {!p ? (
        <Spinner />
      ) : (
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="no-print flex items-center justify-between border-b border-slate-200 px-5 py-2.5">
            <h1 className="text-lg">{p.number}</h1>
            <button className="btn-ghost w-8 px-0" onClick={() => navigate('/sales/payments-received')} aria-label="Close">
              <X size={18} />
            </button>
          </div>
          <div className="no-print flex flex-wrap items-center border-b border-slate-200 bg-slate-50/60 px-3">
            {!p.locked && p.status !== 'void' && (
              <Tb icon={<Pencil size={14} />} onClick={() => navigate(`/sales/payments-received/${p.id}/edit`)}>
                Edit
              </Tb>
            )}
            <Dropdown button={() => <Tb icon={<Mail size={14} />}>Send <ChevronDown size={12} /></Tb>}>
              <MenuItem onClick={() => setEmail(true)}>Send Email</MenuItem>
              <MenuItem icon={<MessageSquare size={13} />} onClick={() => toast.success(`SMS queued for ${p.contact?.mobile || 'the customer'} (SMS gateway not configured)`)}>
                Send SMS
              </MenuItem>
            </Dropdown>
            <Dropdown button={() => <Tb icon={<FileText size={14} />}>PDF/Print <ChevronDown size={12} /></Tb>}>
              <MenuItem icon={<FileText size={13} />} onClick={() => window.open(`/print/payment/${p.id}?template=${template}`, '_blank')}>
                PDF
              </MenuItem>
              <MenuItem icon={<Printer size={13} />} onClick={() => window.open(`/print/payment/${p.id}?template=${template}&auto=1`, '_blank')}>
                Print
              </MenuItem>
            </Dropdown>
            {p.status === 'draft' && <Tb onClick={() => act.mutate('mark_paid')}>Mark as Paid</Tb>}
            {p.status === 'paid' && p.unusedAmount > 0 && <Tb onClick={() => setRefund(true)}>Refund</Tb>}
            <Dropdown align="right" button={() => <button className="btn-ghost h-9 rounded-none border-x border-slate-200 px-2.5" aria-label="More"><MoreHorizontal size={16} /></button>}>
              <MenuItem icon={<BookOpen size={13} />} onClick={() => setTab('journal')}>View Journal</MenuItem>
              {p.status !== 'void' && <MenuItem icon={<Ban size={13} />} onClick={() => confirm.ask('Void payment', 'The payment will be unapplied from its invoices.', () => act.mutate('void'), { danger: true, label: 'Void' })}>Void</MenuItem>}
              <MenuItem danger icon={<Trash2 size={13} />} onClick={() => confirm.ask('Delete payment', 'This cannot be undone.', () => del.mutate(undefined, { onSuccess: () => navigate('/sales/payments-received') }), { danger: true, label: 'Delete' })}>
                Delete
              </MenuItem>
              <MenuItem icon={p.locked ? <Unlock size={13} /> : <Lock size={13} />} onClick={() => act.mutate(p.locked ? 'unlock' : 'lock')}>
                {p.locked ? 'Unlock Receipt' : 'Lock Receipts'}
              </MenuItem>
            </Dropdown>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <Tabs tabs={[{ value: 'receipt', label: 'Payment Receipt' }, { value: 'journal', label: 'Journal' }, { value: 'activity', label: 'Activity' }]} value={tab} onChange={setTab} className="no-print mb-4" />
            {tab === 'receipt' && (
              <>
                <div className="no-print mb-3 flex items-center justify-between">
                  <div className="text-[13px]">
                    Amount in excess: <b>{money(p.unusedAmount)}</b>
                    {p.refunds.length > 0 && <span className="ml-3 text-slate-500">Refunded {money(p.refundedAmount)}</span>}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    Template
                    <Select className="h-7 w-44 text-xs" value={template} onChange={(e) => setTemplate(e.target.value as Template)} options={TEMPLATES} />
                  </div>
                </div>
                <ReceiptPreview payment={p} org={org} contact={p.contact} kind="received" template={template} rows={p.invoices.filter((x) => x.doc).map((x) => ({ number: x.doc!.number, date: x.doc!.date, total: x.doc!.total, amount: x.amount }))} />
              </>
            )}
            {tab === 'journal' && <JournalTable journals={p.journals} />}
            {tab === 'activity' && <Timeline entityId={p.id} />}
          </div>
          {email && (
            <EmailModal
              open
              onClose={() => setEmail(false)}
              title={`Email To ${p.contactName}`}
              to={p.contact?.email ? [p.contact.email] : []}
              subject={`Payment Receipt - ${p.number} from ${org.name}`}
              body={`Dear ${p.contactName},\n\nThank you for your payment. It was a pleasure doing business with you. We look forward to work together again!\n\nPayment Amount: ${money(p.amount)}\nPayment Date: ${fmtDate(p.date)}\n\nRegards,\n${org.name}`}
              contactId={p.contactId}
              entityType="payment_received"
              entityId={p.id}
              attachmentOptions={[{ key: 'pdf', label: 'Attach Payment Receipt PDF' }]}
            />
          )}
          {refund && <RefundPayment p={p} onClose={() => setRefund(false)} accounts={accounts} />}
          {confirm.node}
        </div>
      )}
    </div>
  );
}

function RefundPayment({ p, onClose, accounts }: { p: Detail; onClose: () => void; accounts: ReturnType<typeof useBoot>['accounts'] }) {
  const [f, setF] = useState({ amount: String(p.unusedAmount), date: today(), mode: 'Cash', referenceNumber: '', accountId: p.depositToAccountId, description: '' });
  const save = useAction(() => api(`/payments-received/${p.id}/actions/refund`, { body: f }), 'Refund recorded');
  return (
    <Modal open onClose={onClose} title={`Refund (${p.number})`} width="max-w-2xl" footer={<><button className="btn-primary" onClick={() => save.mutate(undefined, { onSuccess: onClose })}>Save</button><button className="btn-secondary" onClick={onClose}>Cancel</button></>}>
      <div className="space-y-3">
        <Field label="Total Refund Amount" required hint={`Balance : ${money(p.unusedAmount)}`}>
          <MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
        </Field>
        <Field label="Refunded On" required>
          <DateInput value={f.date} onChange={(v) => setF({ ...f, date: v })} />
        </Field>
        <Field label="Payment Mode">
          <Select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })} options={PAYMENT_MODES.map((m) => ({ value: m, label: m }))} />
        </Field>
        <Field label="Reference#">
          <input className="input" value={f.referenceNumber} onChange={(e) => setF({ ...f, referenceNumber: e.target.value })} />
        </Field>
        <Field label="From Account" required>
          <AccountSelect accounts={accounts} value={f.accountId} onChange={(v) => setF({ ...f, accountId: v })} filter={isCashLike} />
        </Field>
        <Field label="Description">
          <textarea className="input" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function Tb({ children, icon, onClick }: { children: React.ReactNode; icon?: React.ReactNode; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-9 items-center gap-1.5 border-r border-slate-200 px-3 text-[13px] text-slate-700 hover:bg-white hover:text-brand-700">
      {icon}
      {children}
    </button>
  );
}
export { Tb };

export default function PaymentsReceived() {
  return (
    <Routes>
      <Route index element={<List />} />
      <Route path="new" element={<PaymentForm />} />
      <Route path=":id/edit" element={<PaymentForm />} />
      <Route path=":id" element={<DetailView />} />
    </Routes>
  );
}
