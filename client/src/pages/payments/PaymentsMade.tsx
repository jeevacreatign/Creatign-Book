import { useEffect, useMemo, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronDown, FileText, Mail, MoreHorizontal, Pencil, Plus, Printer, X, Ban, Trash2, BookOpen, RotateCcw } from 'lucide-react';
import { fmtDate, money, today, round2 } from '@shared/format';
import { fxOf, moneyIn } from '@shared/currency';
import { CurrencyBadge, CurrencyFacts, PaymentRateField, usePaymentRate } from '../../components/currency';
import { PAYMENT_MODES, TDS_RATES, type Contact, type Journal, type PaymentMade, type TxnDoc } from '@shared/types';
import { api, qs, useAction, useApi } from '../../api';
import { useBoot, isCashLike } from '../../lib/app';
import { toast } from '../../lib/toast';
import { AccountSelect, ContactPicker, DateInput, Dropdown, Field, MenuItem, MoneyInput, SearchBox, Select, Spinner, Status, Tabs, clsx, useConfirm, Drawer, Modal } from '../../components/ui';
import { Attachments, EmailModal, JournalTable, Lifecycle, Timeline } from '../../components/shared';
import { ExportMenu } from '../../components/ExportMenu';
import { ReceiptPreview } from '../../components/DocumentPreview';
import { useDocTemplate } from '../../components/pdf/Customize';
import { Tb } from './PaymentsReceived';

type Row = PaymentMade & { contactName: string; billNumbers: string[] };
type Detail = PaymentMade & { contactName: string; contact?: Contact; bills: { docId: string; amount: number; doc?: TxnDoc }[]; journals: Journal[] };

function List() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const { data = [], isLoading } = useApi<Row[]>(`/payments-made${qs({ q })}`);
  if (isLoading) return <Spinner />;
  const allSelected = data.length > 0 && data.every((p) => selected.includes(p.id));
  const exportRows = selected.length ? data.filter((p) => selected.includes(p.id)) : data;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-3 sm:px-5">
        <div className="text-[15px] font-semibold">All Payments</div>
        <div className="flex gap-2">
          <ExportMenu rows={exportRows} filename="payments-made" label={selected.length ? 'Export Selected' : 'Export'} columns={[
            { header: 'Date', value: (p) => p.date },
            { header: 'Payment #', value: (p) => p.number },
            { header: 'Reference#', value: (p) => p.referenceNumber },
            { header: 'Supplier Name', value: (p) => p.contactName },
            { header: 'Bill#', value: (p) => p.type === 'vendor_advance' ? 'Supplier Advance' : p.billNumbers.join(', ') },
            { header: 'Mode', value: (p) => p.mode },
            { header: 'Status', value: (p) => p.status },
            { header: 'Amount', value: (p) => p.amount },
            { header: 'Unused Amount', value: (p) => p.unusedAmount },
          ]} />
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
          title="Record supplier payments"
          subtitle="Record payments against bills or make advance payments to suppliers."
          steps={['OPEN BILLS', ['NEFT / RTGS / UPI', 'CHEQUE', 'CASH']]}
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
          <div className="px-3 py-3 sm:px-5">
            <div className="w-full sm:w-72">
              <SearchBox value={q} onChange={(v) => { setQ(v); setSelected([]); }} placeholder="Search payments" />
            </div>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th className="w-8 pl-4">
                  <input type="checkbox" className="accent-brand-600" checked={allSelected} onChange={() => setSelected(allSelected ? [] : data.map((p) => p.id))} aria-label="Select all" />
                </th>
                <th>Date</th>
                <th>Payment #</th>
                <th>Reference#</th>
                <th>Supplier Name</th>
                <th>Bill#</th>
                <th>Mode</th>
                <th>Status</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Unused Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id} className={clsx('row-link', selected.includes(p.id) && 'bg-brand-50/50')} onClick={() => navigate(`/purchases/payments-made/${p.id}`)}>
                  <td className="pl-4" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="accent-brand-600" checked={selected.includes(p.id)} onChange={() => setSelected((s) => s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id])} aria-label={`Select payment ${p.number}`} />
                  </td>
                  <td>{fmtDate(p.date)}</td>
                  <td className="text-brand-600">{p.number}</td>
                  <td>{p.referenceNumber}</td>
                  <td>{p.contactName}</td>
                  <td>{p.type === 'vendor_advance' ? <span className="text-xs text-slate-500">Supplier Advance</span> : p.billNumbers.join(', ')}</td>
                  <td>{p.mode}</td>
                  <td>
                    <Status status={p.status} />
                  </td>
                  <td className="text-right tabular-nums">
                    {moneyIn(p.amount, p.currencyCode)}
                    {(p.currencyCode || 'INR') !== 'INR' && <span className="block text-xxs text-slate-400">{moneyIn(p.baseAmount, 'INR')}</span>}
                  </td>
                  <td className="text-right tabular-nums">{moneyIn(p.unusedAmount, p.currencyCode)}</td>
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
  const { data: payee } = useApi<Contact>(contactId ? `/contacts/${contactId}` : null);
  const fx = usePaymentRate(payee?.currencyCode, f?.date, existing);
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
      const rate = fx.body();
      if (rate.error) throw new Error(rate.error);
      const body = { ...f, ...rate.fields, status: 'paid', allocations: advance ? [] : Object.entries(alloc).map(([docId, a]) => ({ docId, amount: Number(a) || 0 })) };
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
          { value: 'vendor_advance', label: 'Supplier Advance' },
        ]}
        value={f.type || 'bill_payment'}
        onChange={(t) => !id && set({ type: t })}
        className="mb-4"
      />
      <div className="max-w-2xl space-y-3.5">
        <Field label="Supplier Name" required>
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
        {contactId && (
          <Field label="Currency">
            <div className="flex items-center gap-2 text-[13px] text-slate-600">
              <CurrencyBadge code={fx.code} /> {fx.foreign ? `Paid in ${fx.code}. Only ${fx.code} bills of this supplier can be paid with it.` : 'Indian Rupee (base currency)'}
            </div>
          </Field>
        )}
        <Field label="Supplier Payment" required>
          <MoneyInput prefix={fx.code} className="max-w-xs" value={f.amount} onChange={(v) => set({ amount: v as unknown as number })} />
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
              Pay full amount ({moneyIn(unpaid.reduce((s, b) => s + b.due, 0), fx.code)})
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
        {fx.foreign && (
          <Field label="Exchange Rate" required>
            <PaymentRateField made fx={fx} amount={amount} allocations={advance ? [] : unpaid.filter((b) => Number(alloc[b.id]) > 0).map((b) => ({ amount: Number(alloc[b.id]), rate: fxOf(b).rate }))} />
          </Field>
        )}
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
                  <td className="text-right">{moneyIn(b.total, b.currencyCode)}</td>
                  <td className="text-right">{moneyIn(b.due, b.currencyCode)}</td>
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
                <span>{moneyIn(amount, fx.code)}</span>
              </div>
              <div className="flex justify-between">
                <span>Amount used for Payments:</span>
                <span>{moneyIn(used, fx.code)}</span>
              </div>
              <div className={clsx('flex justify-between', amount - used < 0 && 'text-red-600')}>
                <span>Amount in Excess:</span>
                <span>{moneyIn(amount - used, fx.code)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="mt-5 grid gap-6 md:grid-cols-2">
        <div>
          <div className="mb-1 text-[13px]">Notes (Internal use. Not visible to supplier)</div>
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
      <div className="no-print hidden w-[300px] shrink-0 overflow-y-auto border-r lg:block border-slate-200">
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
              <span className="tabular-nums">{moneyIn(x.amount, x.currencyCode)}</span>
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
            <CurrencyFacts x={p} amounts={[['Amount', p.amount], ['Unused', p.unusedAmount]]} />
            {(p.currencyCode || 'INR') !== 'INR' && !!p.fxGainLoss && (
              <div className={clsx('no-print mb-3 text-[13px]', p.fxGainLoss > 0 ? 'text-emerald-700' : 'text-red-600')} data-testid="fx-realized">
                Realized exchange {p.fxGainLoss > 0 ? 'gain' : 'loss'}: <b>{moneyIn(Math.abs(p.fxGainLoss), 'INR')}</b>
              </div>
            )}
            {p.status === 'paid' && p.unusedAmount > 0 && (
              <div className="no-print mb-3 flex items-center justify-between rounded-md border border-sky-200 bg-sky-50 px-4 py-2.5 text-[13px]">
                <span>
                  <b>{moneyIn(p.unusedAmount, p.currencyCode)}</b> of this payment is unused. Apply it to bills or record a refund from the vendor.
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
                        <td className="text-right tabular-nums">{moneyIn(r.amount, p.currencyCode)}</td>
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
            <EmailModal open onClose={() => setEmail(false)} title={`Email To ${p.contactName}`} to={p.contact?.email ? [p.contact.email] : []} subject={`Payment of ${moneyIn(p.amount, p.currencyCode)} from ${org.name}`} body={`Dear ${p.contactName},\n\nWe have made a payment of ${moneyIn(p.amount, p.currencyCode)} on ${fmtDate(p.date)} via ${p.mode}.\n\nRegards,\n${org.name}`} contactId={p.contactId} entityType="payment_made" entityId={p.id} attachmentOptions={[{ key: 'pdf', label: 'Attach Payment PDF' }]} />
          )}
          {refund && <VendorRefund p={p} onClose={() => setRefund(false)} />}
          {confirm.node}
        </div>
      )}
    </div>
  );
}

/** Money the vendor returned from an excess payment or advance. */
function VendorRefund({ p, onClose }: { p: Detail; onClose: () => void }) {
  const { accounts } = useBoot();
  const [f, setF] = useState({ amount: String(p.unusedAmount), date: today(), mode: 'Bank Transfer', referenceNumber: '', accountId: p.paidThroughAccountId, description: '' });
  const fx = usePaymentRate(p.currencyCode, f.date);
  const save = useAction(() => api(`/payments-made/${p.id}/refunds`, { body: { ...f, ...(fx.foreign ? { exchangeRate: fx.rate } : {}) } }), 'Refund recorded');
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
        <Field label="Supplier">
          <div className="pt-2 text-[13px] font-medium">{p.contactName}</div>
        </Field>
        <Field label="Amount" required hint={`Balance : ${moneyIn(p.unusedAmount, p.currencyCode)}`}>
          <MoneyInput prefix={fx.code} value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
        </Field>
        <Field label="Refunded On" required>
          <DateInput value={f.date} onChange={(v) => setF({ ...f, date: v })} />
        </Field>
        {fx.foreign && (
          <Field label="Exchange Rate" required hint="Rate on the refund date. The difference from the payment's rate is posted as an exchange gain or loss.">
            <PaymentRateField fx={fx} amount={Number(f.amount) || 0} />
          </Field>
        )}
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

/** the Bulk Payments: pay several bills (from one or more vendors) in one go. */
function BulkPayment() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { accounts } = useBoot();
  const ids = (search.get('bills') || '').split(',').filter(Boolean);
  const { data: bills = [], isLoading } = useApi<(TxnDoc & { contactName: string })[]>('/docs?kind=bill&status=unpaid');
  const picked = bills.filter((b) => ids.includes(b.id));
  const [date, setDate] = useState(today());
  const [mode, setMode] = useState('Bank Transfer');
  const [paidThrough, setPaidThrough] = useState('acc_bank_hdfc');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const amt = (b: TxnDoc) => (amounts[b.id] !== undefined ? Number(amounts[b.id]) || 0 : b.balance);
  const vendors = Array.from(new Set(picked.map((b) => b.contactId)));
  // bills can be in different currencies: the total is shown in INR at each bill's rate
  const total = round2(picked.reduce((s2, b) => s2 + round2(amt(b) * fxOf(b).rate), 0));
  const mixed = picked.some((b) => (b.currencyCode || 'INR') !== 'INR');
  async function save() {
    setSaving(true);
    try {
      const payments = vendors
        .map((v) => {
          const list = picked.filter((b) => b.contactId === v && amt(b) > 0);
          return { contactId: v, date, mode, paidThroughAccountId: paidThrough, referenceNumber: refs[v] || undefined, amount: round2(list.reduce((s2, b) => s2 + amt(b), 0)), allocations: list.map((b) => ({ docId: b.id, amount: amt(b) })) };
        })
        .filter((p) => p.amount > 0);
      const saved = await api<PaymentMade[]>('/payments-made/bulk', { body: { payments } });
      toast.success(`${saved.length} payment(s) recorded`);
      navigate('/purchases/payments-made');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  if (isLoading) return <Spinner />;
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-3 sm:px-5">
        <h1 className="text-lg">Bulk Payments</h1>
        <button className="btn-ghost w-8 px-0" onClick={() => navigate(-1)} aria-label="Close">
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 px-5 py-4">
        <div className="mb-4 grid max-w-4xl gap-4 sm:grid-cols-3">
          <Field label="Payment Date" required inline={false}>
            <DateInput value={date} onChange={setDate} />
          </Field>
          <Field label="Payment Mode" inline={false}>
            <Select value={mode} onChange={(e) => setMode(e.target.value)} options={PAYMENT_MODES.map((m) => ({ value: m, label: m }))} />
          </Field>
          <Field label="Paid Through" required inline={false}>
            <AccountSelect accounts={accounts} value={paidThrough} onChange={setPaidThrough} filter={isCashLike} />
          </Field>
        </div>
        {!picked.length ? (
          <div className="rounded-md border border-dashed border-slate-300 p-8 text-center text-slate-500">None of the selected bills have a balance due. Select open bills from the Bills list.</div>
        ) : (
          <table className="table rounded-md border border-slate-200">
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Bill#</th>
                <th>Bill Date</th>
                <th>Due Date</th>
                <th className="text-right">Balance Due</th>
                <th className="w-40 text-right">Payment</th>
                <th className="w-40">Reference#</th>
              </tr>
            </thead>
            <tbody>
              {picked.map((b, i) => {
                const firstOfVendor = picked.findIndex((x) => x.contactId === b.contactId) === i;
                return (
                  <tr key={b.id}>
                    <td className="font-medium">{firstOfVendor ? b.contactName : ''}</td>
                    <td>{b.number}</td>
                    <td>{fmtDate(b.date)}</td>
                    <td>{fmtDate(b.dueDate)}</td>
                    <td className="text-right tabular-nums">{moneyIn(b.balance, b.currencyCode)}</td>
                    <td>
                      <input type="number" className="input text-right" value={amounts[b.id] ?? String(b.balance)} onChange={(e) => setAmounts({ ...amounts, [b.id]: e.target.value })} />
                    </td>
                    <td>{firstOfVendor && <input className="input" placeholder="Reference#" value={refs[b.contactId] || ''} onChange={(e) => setRefs({ ...refs, [b.contactId]: e.target.value })} />}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td colSpan={5} className="text-right">
                  Total ({vendors.length} vendor{vendors.length === 1 ? '' : 's'}){mixed ? ', in INR at bill rates' : ''}
                </td>
                <td className="text-right tabular-nums">{moneyIn(total, 'INR')}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
        <div className="mt-2 text-xs text-slate-500">One payment is recorded for each supplier, in that supplier's currency, and applied to their bills.{mixed ? ' Foreign-currency payments use the rate on the payment date from Settings > Currencies.' : ''}</div>
      </div>
      <div className="sticky bottom-0 flex gap-2 border-t border-slate-200 bg-white px-5 py-3">
        <button className="btn-primary" disabled={saving || !picked.length || total <= 0} onClick={save}>
          Record Payments
        </button>
        <button className="btn-secondary" onClick={() => navigate(-1)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function PaymentsMade() {
  return (
    <Routes>
      <Route index element={<List />} />
      <Route path="bulk" element={<BulkPayment />} />
      <Route path="new" element={<><List /><PaymentDrawer /></>} />
      <Route path=":id/edit" element={<><DetailView /><PaymentDrawer /></>} />
      <Route path=":id" element={<DetailView />} />
    </Routes>
  );
}
