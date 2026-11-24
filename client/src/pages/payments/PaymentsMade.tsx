import { useEffect, useMemo, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronDown, FileText, Mail, MoreHorizontal, Pencil, Plus, Printer, X, Ban, Trash2, BookOpen, RotateCcw } from 'lucide-react';
import { fmtDate, money, num, today, round2 } from '@shared/format';
import { PAYMENT_MODES, TDS_RATES, type Contact, type Journal, type PaymentMade, type TxnDoc } from '@shared/types';
import { api, qs, useAction, useApi } from '../../api';
import { useBoot, isCashLike } from '../../lib/app';
import { toast } from '../../lib/toast';
import { AccountSelect, ContactPicker, DateInput, Dropdown, Field, MenuItem, MoneyInput, SearchBox, Select, Spinner, Status, Tabs, clsx, useConfirm, Drawer, Modal } from '../../components/ui';
import { Attachments, EmailModal, JournalTable, Lifecycle, Timeline } from '../../components/shared';
import { ReceiptPreview } from '../../components/DocumentPreview';
import { useDocTemplate } from '../../components/pdf/Customize';
import { Tb } from './PaymentsReceived';

type Row = PaymentMade & { contactName: string; billNumbers: string[] };
type Detail = PaymentMade & { contactName: string; contact?: Contact; bills: { docId: string; amount: number; doc?: TxnDoc }[]; journals: Journal[] };

function List() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const { data = [], isLoading } = useApi<Row[]>(`/payments-made${qs({ q })}`);
  if (isLoading) return <Spinner />;
  return (
    <div>
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <div className="text-[15px] font-semibold">All Payments</div>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={() => navigate('/purchases/payments-made/new')}>
            <Plus size={15} /> New
          </button>
          <Dropdown align="right" button={() => <button className="btn-icon" aria-label="More"><MoreHorizontal size={15} /></button>}>
            <MenuItem onClick={() => navigate('/settings/import')}>Import Payments</MenuItem>
          </Dropdown>
        </div>
      </div>
      {!data.length && !q ? (
        <Lifecycle
          title="Pay your vendors, record the payment."
          subtitle="Record payments against bills or make advance payments to vendors."
          steps={['BILLS', ['ACH PAYMENT', 'CHECK', 'MANUAL / OFFLINE']]}
          actions={
            <>
              <button className="btn-primary" onClick={() => navigate('/purchases/bills?status=unpaid')}>
                GO TO UNPAID BILLS
              </button>
              <button className="btn-secondary" onClick={() => navigate('/settings/import')}>
                Import Payments
              </button>
            </>
          }
        />
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
                <th>Reference#</th>
                <th>Vendor Name</th>
                <th>Bill#</th>
                <th>Mode</th>
                <th>Status</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Unused Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id} className="row-link" onClick={() => navigate(`/purchases/payments-made/${p.id}`)}>
                  <td>{fmtDate(p.date)}</td>
                  <td className="text-brand-600">{p.number}</td>
                  <td>{p.referenceNumber}</td>
                  <td>{p.contactName}</td>
                  <td>{p.type === 'vendor_advance' ? <span className="text-xs text-slate-500">Vendor Advance</span> : p.billNumbers.join(', ')}</td>
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

function PaymentDrawer() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { accounts } = useBoot();
  const { data: existing } = useApi<PaymentMade>(id ? `/payments-made/${id}` : null);
  const { data: next } = useApi<{ number: string }>(id ? null : '/payments-made/next-number');
  const [f, setF] = useState<Partial<PaymentMade> | null>(null);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (f) return;
    if (existing) {
      setF(existing);
      setAlloc(Object.fromEntries(existing.allocations.map((a) => [a.docId, String(a.amount)])));
    } else if (!id && next) setF({ type: 'bill_payment', number: next.number, date: today(), mode: 'Cash', paidThroughAccountId: 'acc_petty_cash', contactId: search.get('contactId') || undefined, attachments: [], tdsRate: 0 });
  }, [existing, next, f, id, search]);
  const contactId = f?.contactId;
  const { data: bills = [] } = useApi<TxnDoc[]>(contactId ? `/docs${qs({ kind: 'bill', contactId })}` : null);
  const unpaid = useMemo(
    () =>
      bills
        .filter((b) => ['open', 'overdue', 'due_today', 'partially_paid'].includes(b.status) || existing?.allocations.some((a) => a.docId === b.id))
        .map((b) => ({ ...b, due: round2(b.balance + (existing?.allocations.find((a) => a.docId === b.id)?.amount ?? 0)) })),
    [bills, existing],
  );
  const billParam = search.get('billId');
  useEffect(() => {
    if (!billParam || !unpaid.length || Object.keys(alloc).length || !f) return;
    const b = unpaid.find((x) => x.id === billParam);
    if (b) {
      setAlloc({ [b.id]: String(b.due) });
      setF((cur) => ({ ...cur!, amount: b.due }));
    }
  }, [billParam, unpaid, alloc, f]);

  const close = () => navigate(id ? `/purchases/payments-made/${id}` : '/purchases/payments-made');
  if (!f) return null;
  const set = (p: Partial<PaymentMade>) => setF({ ...f, ...p });
  const amount = Number(f.amount) || 0;
  const used = round2(Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0));
  const advance = f.type === 'vendor_advance';

  async function save() {
    setSaving(true);
    try {
      const body = { ...f, status: 'paid', allocations: advance ? [] : Object.entries(alloc).map(([docId, a]) => ({ docId, amount: Number(a) || 0 })) };
      const saved = await api<PaymentMade>(id ? `/payments-made/${id}` : '/payments-made', { method: id ? 'PUT' : 'POST', body });
      toast.success('Payment recorded');
      navigate(`/purchases/payments-made/${saved.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open
      onClose={close}
      title={id ? 'Edit Payment' : 'Record Payment'}
      width="max-w-4xl"
      footer={
        <>
          <button className="btn-primary" disabled={saving} onClick={save}>
            Save as Paid
          </button>
          <button className="btn-secondary" onClick={close}>
            Cancel
          </button>
        </>
      }
    >
      <Tabs
        tabs={[
          { value: 'bill_payment', label: 'Bill Payment' },
          { value: 'vendor_advance', label: 'Vendor Advance' },
        ]}
        value={f.type || 'bill_payment'}
        onChange={(t) => !id && set({ type: t })}
        className="mb-4"
      />
      <div className="max-w-2xl space-y-3.5">
        <Field label="Vendor Name" required>
          <ContactPicker
            kind="vendor"
            value={f.contactId}
            disabled={!!id}
            onChange={(cid) => {
              set({ contactId: cid || undefined });
              setAlloc({});
            }}
          />
        </Field>
        <Field label="Payment #" required>
          <input className="input max-w-xs" value={f.number || ''} onChange={(e) => set({ number: e.target.value })} />
        </Field>
        <Field label="Payment Made" required>
          <MoneyInput className="max-w-xs" value={f.amount} onChange={(v) => set({ amount: v as unknown as number })} />
          {!advance && unpaid.length > 0 && (
            <button
              type="button"
              className="link mt-1 text-xxs"
              onClick={() => {
                const total = round2(unpaid.reduce((s, b) => s + b.due, 0));
                set({ amount: total });
                setAlloc(Object.fromEntries(unpaid.map((b) => [b.id, String(b.due)])));
              }}
            >
              Pay full amount ({money(unpaid.reduce((s, b) => s + b.due, 0))})
            </button>
          )}
        </Field>
        {advance && (
          <Field label="TDS">
            <Select className="max-w-xs" value={f.tdsRate ?? 0} onChange={(e) => set({ tdsRate: Number(e.target.value) })} options={TDS_RATES} />
          </Field>
        )}
        <Field label="Payment Date" required>
          <DateInput className="max-w-[200px]" value={f.date} onChange={(v) => set({ date: v })} />
        </Field>
        <Field label="Payment Mode">
          <Select className="max-w-xs" value={f.mode} onChange={(e) => set({ mode: e.target.value })} options={PAYMENT_MODES.map((m) => ({ value: m, label: m }))} />
        </Field>
        <Field label="Paid Through" required>
          <AccountSelect className="max-w-xs" accounts={accounts} value={f.paidThroughAccountId} onChange={(v) => set({ paidThroughAccountId: v })} filter={isCashLike} />
        </Field>
        {advance && (
          <Field label="Deposit To">
            <AccountSelect className="max-w-xs" accounts={accounts} value={f.depositToAccountId || 'acc_prepaid'} onChange={(v) => set({ depositToAccountId: v })} filter={(a) => a.subType === 'other_current_asset' || a.subType === 'accounts_payable'} />
          </Field>
        )}
        <Field label="Reference#">
          <input className="input max-w-xs" value={f.referenceNumber || ''} onChange={(e) => set({ referenceNumber: e.target.value })} />
        </Field>
      </div>
      {!advance && (
        <div className="mt-5">
          <div className="mb-2 font-semibold">Bills</div>
          <table className="table border border-slate-200">
            <thead>
              <tr>
                <th>Date</th>
                <th>Bill#</th>
                <th>PO#</th>
                <th className="text-right">Bill Amount</th>
                <th className="text-right">Amount Due</th>
                <th className="w-40 text-right">Payment</th>
              </tr>
            </thead>
            <tbody>
              {!contactId && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-400">
                    Select a vendor to see their unpaid bills.
                  </td>
                </tr>
              )}
              {contactId && !unpaid.length && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-400">
                    There are no unpaid bills for this vendor.
                  </td>
                </tr>
              )}
              {unpaid.map((b) => (
                <tr key={b.id}>
                  <td>
                    {fmtDate(b.date)}
                    <div className="text-xxs text-slate-500">Due {fmtDate(b.dueDate)}</div>
                  </td>
                  <td>{b.number}</td>
                  <td>{b.orderNumber}</td>
                  <td className="text-right">{money(b.total)}</td>
                  <td className="text-right">{money(b.due)}</td>
                  <td>
                    <input type="number" className="input text-right" value={alloc[b.id] ?? ''} onChange={(e) => setAlloc({ ...alloc, [b.id]: e.target.value })} />
                    <button type="button" className="link mt-1 block w-full text-right text-xxs" onClick={() => setAlloc({ ...alloc, [b.id]: String(b.due) })}>
                      Pay in Full
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex justify-end">
            <div className="w-80 space-y-1 rounded-md bg-slate-50 p-4 text-[13px]">
              <div className="flex justify-between">
                <span>Amount Paid:</span>
                <span>₹{num(amount)}</span>
              </div>
              <div className="flex justify-between">
                <span>Amount used for Payments:</span>
                <span>₹{num(used)}</span>
              </div>
              <div className={clsx('flex justify-between', amount - used < 0 && 'text-red-600')}>
                <span>Amount in Excess:</span>
                <span>₹{num(amount - used)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="mt-5 grid gap-6 md:grid-cols-2">
        <div>
          <div className="mb-1 text-[13px]">Notes (Internal use. Not visible to vendor)</div>
          <textarea className="input" rows={3} value={f.notes || ''} onChange={(e) => set({ notes: e.target.value })} />
        </div>
        <Attachments value={f.attachments || []} onChange={(v) => set({ attachments: v })} max={5} maxMB={10} label="Attachments" />
      </div>
    </Drawer>
  );
}

function DetailView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { organization: org, accounts } = useBoot();
  const tpl = useDocTemplate('payment');
  const { data: list = [] } = useApi<Row[]>('/payments-made');
  const { data: p } = useApi<Detail>(`/payments-made/${id}`);
  const [tab, setTab] = useState('receipt');
  const [email, setEmail] = useState(false);
  const confirm = useConfirm();
  const voidP = useAction(() => api(`/payments-made/${id}/actions/void`, { body: {} }), 'Payment voided');
  const del = useAction(() => api(`/payments-made/${id}`, { method: 'DELETE' }), 'Payment deleted');
  const [refund, setRefund] = useState(false);
  const delRefund = useAction((rid: string) => api(`/payments-made/${id}/refunds/${rid}`, { method: 'DELETE' }), 'Refund deleted');
  return (
    <div className="flex h-full">
      <div className="no-print w-[300px] shrink-0 overflow-y-auto border-r border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5">
          <span className="font-semibold">All Payments</span>
          <button className="btn-primary w-8 px-0" onClick={() => navigate('/purchases/payments-made/new')} aria-label="New">
            <Plus size={15} />
          </button>
        </div>
        {list.map((x) => (
          <Link key={x.id} to={`/purchases/payments-made/${x.id}`} className={clsx('block border-b border-slate-100 px-3 py-2.5 hover:bg-slate-50', x.id === id && 'bg-brand-50/70')}>
            <div className="flex justify-between">
              <span className="font-medium">{x.contactName}</span>
              <span className="tabular-nums">{money(x.amount)}</span>
            </div>
            <div className="text-xs text-slate-500">
              {x.number} • {fmtDate(x.date)} • {x.mode}
            </div>
          </Link>
        ))}
      </div>
      {!p ? (
        <Spinner />
      ) : (
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="no-print flex items-center justify-between border-b border-slate-200 px-5 py-2.5">
            <h1 className="text-lg">Payment #{p.number}</h1>
            <button className="btn-ghost w-8 px-0" onClick={() => navigate('/purchases/payments-made')} aria-label="Close">
              <X size={18} />
            </button>
          </div>
          <div className="no-print flex flex-wrap items-center border-b border-slate-200 bg-slate-50/60 px-3">
            {p.status !== 'void' && (
              <Tb icon={<Pencil size={14} />} onClick={() => navigate(`/purchases/payments-made/${p.id}/edit`)}>
                Edit
              </Tb>
            )}
            <Tb icon={<Mail size={14} />} onClick={() => setEmail(true)}>
              Send Email
            </Tb>
            <Dropdown button={() => <Tb icon={<FileText size={14} />}>PDF/Print <ChevronDown size={12} /></Tb>}>
              <MenuItem icon={<FileText size={13} />} onClick={() => window.open(`/print/payment-made/${p.id}`, '_blank')}>PDF</MenuItem>
              <MenuItem icon={<Printer size={13} />} onClick={() => window.open(`/print/payment-made/${p.id}?auto=1`, '_blank')}>Print</MenuItem>
            </Dropdown>
            {p.status === 'paid' && p.unusedAmount > 0 && (
              <Tb icon={<RotateCcw size={14} />} onClick={() => setRefund(true)}>
                Refund
              </Tb>
            )}
            <Dropdown align="right" button={() => <button className="btn-ghost h-9 rounded-none border-x border-slate-200 px-2.5" aria-label="More"><MoreHorizontal size={16} /></button>}>
              <MenuItem icon={<BookOpen size={13} />} onClick={() => setTab('journal')}>View Journal</MenuItem>
              {p.status !== 'void' && <MenuItem icon={<Ban size={13} />} onClick={() => confirm.ask('Void payment', 'The payment will be unapplied from its bills.', () => voidP.mutate(), { danger: true, label: 'Void' })}>Void</MenuItem>}
              <MenuItem danger icon={<Trash2 size={13} />} onClick={() => confirm.ask('Delete payment', 'This cannot be undone.', () => del.mutate(undefined, { onSuccess: () => navigate('/purchases/payments-made') }), { danger: true, label: 'Delete' })}>
                Delete
              </MenuItem>
            </Dropdown>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {p.status === 'paid' && p.unusedAmount > 0 && (
              <div className="no-print mb-3 flex items-center justify-between rounded-md border border-sky-200 bg-sky-50 px-4 py-2.5 text-[13px]">
                <span>
                  <b>{money(p.unusedAmount)}</b> of this payment is unused. Apply it to bills or record a refund from the vendor.
                </span>
                <span className="flex gap-2">
                  <button className="btn-secondary btn-sm" onClick={() => navigate(`/purchases/payments-made/${p.id}/edit`)}>Apply to Bills</button>
                  <button className="btn-primary btn-sm" onClick={() => setRefund(true)}>Refund</button>
                </span>
              </div>
            )}
            {(p.refunds?.length ?? 0) > 0 && (
              <div className="no-print mb-4 rounded-md border border-slate-200">
                <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-[13px] font-semibold">Refund History</div>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Mode</th>
                      <th>Reference#</th>
                      <th>Deposited To</th>
                      <th className="text-right">Amount</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {p.refunds!.map((r) => (
                      <tr key={r.id}>
                        <td>{fmtDate(r.date)}</td>
                        <td>{r.mode}</td>
                        <td>{r.referenceNumber}</td>
                        <td>{accounts.find((a) => a.id === r.accountId)?.name}</td>
                        <td className="text-right tabular-nums">{money(r.amount)}</td>
                        <td className="text-right">
                          <button className="text-slate-400 hover:text-red-500" aria-label="Delete refund" onClick={() => confirm.ask('Delete refund', 'The refund and its journal entry will be removed.', () => delRefund.mutate(r.id), { danger: true, label: 'Delete' })}>
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Tabs tabs={[{ value: 'receipt', label: 'Payment' }, { value: 'journal', label: 'Journal' }, { value: 'activity', label: 'Activity' }]} value={tab} onChange={setTab} className="no-print mb-4" />
            {tab === 'receipt' && <ReceiptPreview payment={p} org={org} contact={p.contact} kind="made" template={tpl} rows={p.bills.filter((x) => x.doc).map((x) => ({ number: x.doc!.number, date: x.doc!.date, total: x.doc!.total, amount: x.amount }))} />}
            {tab === 'journal' && <JournalTable journals={p.journals} />}
            {tab === 'activity' && <Timeline entityId={p.id} />}
          </div>
          {email && (
            <EmailModal open onClose={() => setEmail(false)} title={`Email To ${p.contactName}`} to={p.contact?.email ? [p.contact.email] : []} subject={`Payment of ${money(p.amount)} from ${org.name}`} body={`Dear ${p.contactName},\n\nWe have made a payment of ${money(p.amount)} on ${fmtDate(p.date)} via ${p.mode}.\n\nRegards,\n${org.name}`} contactId={p.contactId} entityType="payment_made" entityId={p.id} attachmentOptions={[{ key: 'pdf', label: 'Attach Payment PDF' }]} />
          )}
          {refund && <VendorRefund p={p} onClose={() => setRefund(false)} />}
          {confirm.node}
        </div>
      )}
    </div>
  );
}

/** Money the vendor returned from an excess payment or advance (Zoho: Payments Made > Refund). */
function VendorRefund({ p, onClose }: { p: Detail; onClose: () => void }) {
  const { accounts } = useBoot();
  const [f, setF] = useState({ amount: String(p.unusedAmount), date: today(), mode: 'Bank Transfer', referenceNumber: '', accountId: p.paidThroughAccountId, description: '' });
  const save = useAction(() => api(`/payments-made/${p.id}/refunds`, { body: f }), 'Refund recorded');
  return (
    <Modal
      open
      onClose={onClose}
      title={`Refund (Payment #${p.number})`}
      width="max-w-2xl"
      footer={
        <>
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            Save
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Vendor">
          <div className="pt-2 text-[13px] font-medium">{p.contactName}</div>
        </Field>
        <Field label="Amount" required hint={`Balance : ${money(p.unusedAmount)}`}>
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
        <Field label="Deposit To" required>
          <AccountSelect accounts={accounts} value={f.accountId} onChange={(v) => setF({ ...f, accountId: v })} filter={isCashLike} />
        </Field>
        <Field label="Description">
          <textarea className="input" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

export default function PaymentsMade() {
  return (
    <Routes>
      <Route index element={<List />} />
      <Route path="new" element={<><List /><PaymentDrawer /></>} />
      <Route path=":id/edit" element={<><DetailView /><PaymentDrawer /></>} />
      <Route path=":id" element={<DetailView />} />
    </Routes>
  );
}
