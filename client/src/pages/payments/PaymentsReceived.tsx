import { useEffect, useMemo, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronDown, FileText, Mail, MoreHorizontal, Pencil, Plus, Printer, X, Lock, Unlock, Ban, Trash2, BookOpen, MessageSquare } from 'lucide-react';
import { fmtDate, money, today, round2 } from '@shared/format';
import { fxOf, moneyIn } from '@shared/currency';
import { CurrencyBadge, CurrencyFacts, PaymentRateField, usePaymentRate } from '../../components/currency';
import { PAYMENT_MODES, type Contact, type Journal, type PaymentReceived, type TxnDoc } from '@shared/types';
import { parsePaymentImportRows } from '@shared/paymentImport';
import { api, qs, useAction, useApi } from '../../api';
import { useBoot, isCashLike } from '../../lib/app';
import { toast } from '../../lib/toast';
import { AccountSelect, Checkbox, ContactPicker, DateInput, Dropdown, Field, FormFooter, MenuItem, Modal, MoneyInput, PageHeader, Radio, SearchBox, Select, Spinner, Status, Tabs, clsx, useConfirm } from '../../components/ui';
import { Attachments, EmailModal, JournalTable, Timeline } from '../../components/shared';
import { ExportMenu } from '../../components/ExportMenu';
import { CsvImportButton, type CsvImportRecord, type CsvImportResult } from '../../components/CsvImportButton';
import { ReceiptPreview } from '../../components/DocumentPreview';
import { useDocTemplate, useTemplates } from '../../components/pdf/Customize';

type Row = PaymentReceived & { contactName: string; invoiceNumbers: string[] };
type Detail = PaymentReceived & { contactName: string; contact?: Contact; invoices: { docId: string; amount: number; doc?: TxnDoc }[]; journals: Journal[] };

function List() {
  const navigate = useNavigate();
  const { accounts } = useBoot();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const { data = [], isLoading } = useApi<Row[]>(`/payments-received${qs({ q })}`);
  async function importPayments(records: CsvImportRecord[]): Promise<CsvImportResult[]> {
    const parsed = parsePaymentImportRows(records);
    const results: CsvImportResult[] = parsed.errors.map((error) => ({
      rowNumber: error.rowNumber,
      label: error.label,
      success: false,
      message: error.message,
    }));
    if (!parsed.groups.length) return results;
    const [contacts, invoices] = await Promise.all([
      api<Contact[]>('/contacts?kind=customer&status=all'),
      api<TxnDoc[]>('/docs?kind=invoice'),
    ]);
    const normalize = (value: string) => value.trim().toLowerCase();
    const matchOne = <T,>(items: T[], value: string, getName: (item: T) => string) => {
      const matches = items.filter((item) => normalize(getName(item)) === normalize(value));
      if (matches.length > 1) throw new Error(`"${value}" matches more than one record`);
      if (!matches.length) throw new Error(`"${value}" was not found`);
      return matches[0];
    };
    for (const group of parsed.groups) {
      try {
        const contact = matchOne(contacts, group.customerName, (item) => item.displayName);
        const depositAccount = matchOne(
          accounts.filter((account) => account.active && isCashLike(account)),
          group.depositTo,
          (item) => item.name,
        );
        const allocations = group.allocations.map((allocation) => {
          const invoicesForClient = invoices.filter((invoice) => invoice.contactId === contact.id);
          const invoice = matchOne(invoicesForClient, allocation.invoiceNumber, (item) => item.number);
          return { docId: invoice.id, amount: allocation.amount };
        });
        await api<PaymentReceived>('/payments-received', {
          body: {
            number: group.number,
            contactId: contact.id,
            date: group.date,
            mode: group.mode,
            depositToAccountId: depositAccount.id,
            amount: group.amount,
            bankCharges: group.bankCharges,
            referenceNumber: group.referenceNumber,
            tdsDeducted: group.tdsDeducted,
            tdsAmount: group.tdsAmount,
            allocations,
            notes: group.notes,
            status: 'draft',
            sendThankYou: false,
          },
        });
        results.push({
          rowNumber: group.rowNumber,
          label: group.number ?? group.customerName,
          success: true,
          message: 'Saved as Draft; review and mark it Paid to update invoice balances and accounting.',
        });
      } catch (error) {
        results.push({
          rowNumber: group.rowNumber,
          label: group.number ?? group.customerName,
          success: false,
          message: error instanceof Error ? error.message : 'Import failed',
        });
      }
    }
    return results.sort((a, b) => a.rowNumber - b.rowNumber);
  }
  if (isLoading) return <Spinner />;
  const allSelected = data.length > 0 && data.every((p) => selected.includes(p.id));
  const exportRows = selected.length ? data.filter((p) => selected.includes(p.id)) : data;
  return (
    <div>
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <div className="text-[15px] font-semibold">All Received Payments</div>
        <div className="flex items-center gap-2">
          <CsvImportButton
            title="Client Payments"
            filename="client-payments"
            headers={['Payment Number', 'Date', 'Customer Name', 'Payment Mode', 'Deposit To', 'Amount', 'Reference Number', 'Invoice Number', 'Amount Applied', 'Bank Charges', 'Tax Deducted', 'TDS Amount', 'Notes']}
            instructions="Import one row per payment, or repeat the Payment Number for payments allocated across invoices. Client, Deposit To account and Invoice Number must match existing records. For multiple invoices, provide Amount Applied on each invoice row. Imported payments are saved as Draft and do not update invoice balances until marked Paid."
            onImport={importPayments}
          />
          <ExportMenu rows={exportRows} filename="received-payments" label={selected.length ? 'Export Selected' : 'Export'} columns={[
            { header: 'Date', value: (p) => p.date },
            { header: 'Payment #', value: (p) => p.number },
            { header: 'Reference Number', value: (p) => p.referenceNumber },
            { header: 'Client Name', value: (p) => p.contactName },
            { header: 'Invoice#', value: (p) => p.invoiceNumbers.join(', ') },
            { header: 'Mode', value: (p) => p.mode },
            { header: 'Status', value: (p) => p.status },
            { header: 'Amount', value: (p) => p.amount },
            { header: 'Unused Amount', value: (p) => p.unusedAmount },
          ]} />
          <button className="btn-primary" onClick={() => navigate('/sales/payments-received/new')}>
            <Plus size={15} /> New
          </button>
        </div>
      </div>
      {!data.length && !q ? (
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <div className="text-lg font-semibold">No payments received yet</div>
          <div className="text-slate-500">Record payments against invoices as your clients pay you.</div>
          <button className="btn-primary" onClick={() => navigate('/sales/payments-received/new')}>
            Record Payment
          </button>
        </div>
      ) : (
        <>
          <div className="px-5 py-3">
            <div className="w-72">
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
                <th>Reference Number</th>
                <th>Client Name</th>
                <th>Invoice#</th>
                <th>Mode</th>
                <th>Status</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Unused Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id} className={clsx('row-link', selected.includes(p.id) && 'bg-brand-50/50')} onClick={() => navigate(`/sales/payments-received/${p.id}`)}>
                  <td className="pl-4" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="accent-brand-600" checked={selected.includes(p.id)} onChange={() => setSelected((s) => s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id])} aria-label={`Select payment ${p.number}`} />
                  </td>
                  <td>{fmtDate(p.date)}</td>
                  <td className="text-brand-600">{p.number}</td>
                  <td>{p.referenceNumber}</td>
                  <td>{p.contactName}</td>
                  <td>{p.invoiceNumbers.join(', ')}</td>
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
  const { data: payer } = useApi<Contact>(contactId ? `/contacts/${contactId}` : null);
  const fx = usePaymentRate(payer?.currencyCode, f?.date, existing);
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
  // advance against an advance invoice: the whole amount stays as client credit
  const retainerId = search.get('retainerInvoiceId') || existing?.retainerInvoiceId;
  const { data: retainer } = useApi<TxnDoc>(retainerId ? `/docs/${retainerId}` : null);
  useEffect(() => {
    if (!retainer || id || !f || f.retainerInvoiceId) return;
    setF((cur) => ({ ...cur!, retainerInvoiceId: retainer.id, contactId: retainer.contactId, amount: retainer.balance }));
  }, [retainer, id, f]);
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
      const rate = fx.body();
      if (rate.error) throw new Error(rate.error);
      const body = { ...f, ...rate.fields, status, allocations: Object.entries(alloc).map(([docId, a]) => ({ docId, amount: Number(a) || 0 })) };
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
        {retainer && (
          <div className="max-w-3xl rounded-lg border border-brand-200 bg-brand-50 px-4 py-2.5 text-[13px] text-ink-900">
            Advance for <span className="font-medium">{retainer.number}</span> ({moneyIn(retainer.balance, retainer.currencyCode)} still due). The amount is kept as client credit and can be applied to invoices later.
          </div>
        )}
        <div className="max-w-3xl space-y-3.5">
          <Field label="Client Name" required>
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
          {contactId && (
            <Field label="Currency">
              <div className="flex items-center gap-2 text-[13px] text-slate-600">
                <CurrencyBadge code={fx.code} /> {fx.foreign ? `Received in ${fx.code}. Only ${fx.code} invoices of this client can be paid with it.` : 'Indian Rupee (base currency)'}
              </div>
            </Field>
          )}
          <Field label="Amount Received" required>
            <MoneyInput
              prefix={fx.code}
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
                  label={`Received full amount (${moneyIn(totalDue, fx.code)})`}
                />
              </div>
            )}
          </Field>
          <Field label="Bank Charges (if any)">
            <MoneyInput prefix={fx.code} className="max-w-xs" value={f.bankCharges} onChange={(v) => set({ bankCharges: v as unknown as number })} />
          </Field>
          <Field label="Payment Date" required>
            <DateInput className="max-w-[200px]" value={f.date} onChange={(v) => set({ date: v })} />
          </Field>
          {fx.foreign && (
            <Field label="Exchange Rate" required>
              <PaymentRateField fx={fx} amount={amount} allocations={unpaid.filter((i) => Number(alloc[i.id]) > 0).map((i) => ({ amount: Number(alloc[i.id]), rate: fxOf(i).rate }))} />
            </Field>
          )}
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
                  <td className="text-right">{moneyIn(i.total, i.currencyCode)}</td>
                  <td className="text-right">{moneyIn(i.due, i.currencyCode)}</td>
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
              <Line k="Amount Received" v={amount + tds} code={fx.code} />
              <Line k="Amount used for Payments" v={used} code={fx.code} />
              <Line k="Amount Refunded" v={refunded} code={fx.code} />
              <Line k="Amount in Excess" v={excess} warn={excess < 0} code={fx.code} />
              {fx.foreign && fx.rate > 0 && <Line k="Amount Received in INR" v={round2((amount + tds) * fx.rate)} code="INR" />}
              {excess > 0 && <div className="pt-1 text-xxs text-slate-500">The excess amount stays as an unused credit for this client.</div>}
            </div>
          </div>
        </div>

        <div className="grid max-w-5xl gap-6 md:grid-cols-2">
          <div>
            <div className="mb-1 text-[13px]">Notes (Internal use. Not visible to client)</div>
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

function Line({ k, v, warn, code }: { k: string; v: number; warn?: boolean; code?: string }) {
  return (
    <div className={clsx('flex justify-between', warn && 'text-red-600')}>
      <span>{k}:</span>
      <span className="tabular-nums">{moneyIn(v, code)}</span>
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
  const templates = useTemplates();
  const [templateId, setTemplateId] = useState<string | undefined>();
  const tpl = useDocTemplate('payment', templateId);
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
              <span className="tabular-nums">{moneyIn(x.amount, x.currencyCode)}</span>
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
              <MenuItem icon={<FileText size={13} />} onClick={() => window.open(`/print/payment/${p.id}?template=${tpl.id}`, '_blank')}>
                PDF
              </MenuItem>
              <MenuItem icon={<Printer size={13} />} onClick={() => window.open(`/print/payment/${p.id}?template=${tpl.id}&auto=1`, '_blank')}>
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
            <CurrencyFacts x={p} amounts={[['Amount', p.amount], ['Unused', p.unusedAmount]]} />
            {(p.currencyCode || 'INR') !== 'INR' && !!p.fxGainLoss && (
              <div className={clsx('no-print mb-3 text-[13px]', p.fxGainLoss > 0 ? 'text-emerald-700' : 'text-red-600')} data-testid="fx-realized">
                Realized exchange {p.fxGainLoss > 0 ? 'gain' : 'loss'}: <b>{moneyIn(Math.abs(p.fxGainLoss), 'INR')}</b>
              </div>
            )}
            <Tabs tabs={[{ value: 'receipt', label: 'Payment Receipt' }, { value: 'journal', label: 'Journal' }, { value: 'activity', label: 'Activity' }]} value={tab} onChange={setTab} className="no-print mb-4" />
            {tab === 'receipt' && (
              <>
                <div className="no-print mb-3 flex items-center justify-between">
                  <div className="text-[13px]">
                    Amount in excess: <b>{moneyIn(p.unusedAmount, p.currencyCode)}</b>
                    {p.refunds.length > 0 && <span className="ml-3 text-slate-500">Refunded {moneyIn(p.refundedAmount, p.currencyCode)}</span>}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    Template
                    <Select className="h-7 w-48 text-xs" value={tpl.id} onChange={(e) => setTemplateId(e.target.value)} options={templates.map((t) => ({ value: t.id, label: t.name }))} />
                  </div>
                </div>
                <ReceiptPreview payment={p} org={org} contact={p.contact} kind="received" template={tpl} rows={p.invoices.filter((x) => x.doc).map((x) => ({ number: x.doc!.number, date: x.doc!.date, total: x.doc!.total, amount: x.amount }))} />
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
              body={`Dear ${p.contactName},\n\nThank you for your payment. It was a pleasure doing business with you. We look forward to work together again!\n\nPayment Amount: ${moneyIn(p.amount, p.currencyCode)}\nPayment Date: ${fmtDate(p.date)}\n\nRegards,\n${org.name}`}
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
  const fx = usePaymentRate(p.currencyCode, f.date);
  const save = useAction(() => api(`/payments-received/${p.id}/actions/refund`, { body: { ...f, ...(fx.foreign ? { exchangeRate: fx.rate } : {}) } }), 'Refund recorded');
  return (
    <Modal open onClose={onClose} title={`Refund (${p.number})`} width="max-w-2xl" footer={<><button className="btn-primary" onClick={() => save.mutate(undefined, { onSuccess: onClose })}>Save</button><button className="btn-secondary" onClick={onClose}>Cancel</button></>}>
      <div className="space-y-3">
        <Field label="Total Refund Amount" required hint={`Balance : ${moneyIn(p.unusedAmount, p.currencyCode)}`}>
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
