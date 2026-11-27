import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Trash2, X, ScanLine, ListPlus, Settings2 } from 'lucide-react';
import { computeTotals, lineAmount } from '@shared/calc';
import { isUnposted } from '@shared/approval';
import { DOC_META } from '@shared/docmeta';
import { dueDateFor, money, num, round2, today, addDays } from '@shared/format';
import { BASE_CURRENCY, moneyIn, rateLabel, toBase } from '@shared/currency';
import { CurrencyBadge, RateInput } from '../../components/currency';
import { PAYMENT_TERMS, TCS_RATES, TDS_RATES, type Contact, type DocKind, type Item, type LineItem, type TxnDoc } from '@shared/types';
import { api, qs, useApi } from '../../api';
import { useBoot } from '../../lib/app';
import { toast } from '../../lib/toast';
import { AccountSelect, Checkbox, Combo, ContactPicker, DateInput, Field, FormFooter, Modal, PageHeader, Radio, Select, Spinner, clsx } from '../../components/ui';
import { Attachments } from '../../components/shared';
import { AddressBlock } from '../../components/DocumentPreview';
import { DOC_UI } from './config';
import { GstFields, TaxInclusiveSelect, TaxRows, TaxSelect } from '../../components/gst';
import { stateFromGstin, treatmentChargesTax } from '@shared/gst';
import { customFieldsFor, docDefaults, type CustomFieldDef } from '@shared/pdfTemplate';

type Draft = Partial<TxnDoc> & { lineItems: LineItem[] };

let rowSeq = 0;
const blankLine = (): LineItem => ({ id: `new_${++rowSeq}`, name: '', quantity: 1, rate: 0, amount: 0 });

export function DocForm({ kind }: { kind: DocKind }) {
  const { id } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const boot = useBoot();
  const meta = DOC_META[kind];
  const ui = DOC_UI[kind];
  const approvals = !meta.recurring && !!boot.approvals?.[kind];
  const sales = meta.side === 'sales';
  const fromId = search.get('from');
  const contactParam = search.get('contactId');
  const editing = Boolean(id);

  const { data: existing } = useApi<TxnDoc>(id ? `/docs/${id}` : null);
  const { data: template } = useApi<Partial<TxnDoc>>(fromId ? `/docs/${fromId}/convert${qs({ to: kind })}` : null);
  const { data: next } = useApi<{ number: string }>(!id && !fromId && !meta.recurring && kind !== 'bill' ? `/docs/next-number${qs({ kind })}` : null);
  const { data: items = [] } = useApi<Item[]>('/items?status=active');
  const { data: customers = [] } = useApi<Contact[]>(ui.lineCustomer ? '/contacts?kind=customer' : null);
  const { data: openInvoices = [] } = useApi<(TxnDoc & { contactName: string })[]>(ui.fields.includes('invoiceRef') ? '/docs?kind=invoice' : null);

  const [d, setD] = useState<Draft | null>(null);
  const [contact, setContact] = useState<Contact | undefined>();
  const [bulk, setBulk] = useState(false);
  const [makeRecurring, setMakeRecurring] = useState(false);
  const [saving, setSaving] = useState(false);
  const prefs = boot.preferences;
  // currency follows the client/supplier; the exchange rate is fixed when the document is created
  const [rateStr, setRateStr] = useState<string | null>(null);
  const [rateTouched, setRateTouched] = useState(false);
  const [confirmRate, setConfirmRate] = useState(false);

  // initialise the draft once its sources are loaded
  useEffect(() => {
    if (d) return;
    if (id && !existing) return;
    if (fromId && !template) return;
    if (!id && !fromId && !meta.recurring && kind !== 'bill' && !next) return;
    if (existing) return setD({ ...existing, lineItems: existing.lineItems.map((l) => ({ ...l })) });
    const base: Draft = {
      kind,
      date: today(),
      number: next?.number ?? '',
      discountPercent: 0,
      tdsRate: 0,
      tcsRate: 0,
      adjustment: 0,
      attachments: [],
      lineItems: [blankLine()],
      customerNotes: sales ? docDefaults(prefs, kind).notes : undefined,
      notes: sales ? undefined : docDefaults(prefs, kind).notes,
      terms: docDefaults(prefs, kind).terms,
      customFields: Object.fromEntries(customFieldsFor(prefs, kind).filter((f) => f.active && f.defaultValue).map((f) => [f.id, f.defaultValue!])),
      repeatEvery: meta.recurring ? { n: 1, unit: 'month' } : undefined,
      neverExpires: meta.recurring ? true : undefined,
      startOn: meta.recurring ? today() : undefined,
      expiryDate: kind === 'quote' ? addDays(today(), 30) : undefined,
      deliveryAddressType: kind === 'purchase_order' ? 'organization' : undefined,
      destinationOfSupply: sales ? undefined : boot.organization.state,
      taxInclusive: false,
      contactId: contactParam || undefined,
      projectId: search.get('projectId') || undefined,
      ...(template || {}),
    };
    if (template?.lineItems) base.lineItems = template.lineItems.map((l) => ({ ...l }));
    if (kind === 'invoice' || kind === 'bill') base.dueDate = base.date;
    setD(base);
  }, [existing, template, next, d, id, fromId, kind, meta.recurring, prefs, sales, contactParam, boot.organization.state]);

  // keep the contact object (addresses, terms) in sync with the picker
  const { data: contactData } = useApi<Contact>(d?.contactId ? `/contacts/${d.contactId}` : null);
  useEffect(() => {
    if (contactData) setContact(contactData);
  }, [contactData]);

  // client price list: selling rates for this client
  const { data: pricing } = useApi<{ priceList: { id: string; name: string } | null; rates: Record<string, number> }>(sales && d?.contactId ? `/price-lists/for-contact/${d.contactId}` : null);
  const sellRate = (it: Item) => pricing?.rates[it.id] ?? it.sellingPrice;

  const currencyCode = contact?.currencyCode || d?.currencyCode || BASE_CURRENCY;
  const rateDate = (meta.recurring ? d?.startOn : d?.date) || today();
  const { data: dayRate } = useApi<{ rate: number }>(currencyCode !== BASE_CURRENCY ? `/currencies/${currencyCode}/rate${qs({ date: rateDate })}` : null);
  useEffect(() => {
    if (existing && rateStr === null) setRateStr(String(existing.exchangeRate ?? 1));
  }, [existing, rateStr]);
  useEffect(() => {
    // new documents take the rate on their date until the user types one
    if (!editing && dayRate && !rateTouched) setRateStr(String(dayRate.rate));
  }, [dayRate, editing, rateTouched]);

  const totals = useMemo(() => (d ? computeTotals({ ...d, roundOff: d.roundOff }) : null), [d]);
  if (!d || !totals) return <Spinner />;
  const foreign = currencyCode !== BASE_CURRENCY;
  const rateNum = foreign ? Number(rateStr) : 1;
  const originalRate = editing ? existing?.exchangeRate ?? 1 : undefined;
  const rateChanged = editing && foreign && originalRate !== undefined && rateNum > 0 && Math.abs(rateNum - originalRate) > 1e-9;
  /** item prices are kept in INR: convert them for a foreign-currency document */
  const inDocCurrency = (inr: number) => (foreign && rateNum > 0 ? round2(inr / rateNum) : inr);

  const set = (patch: Partial<Draft>) => setD((cur) => ({ ...cur!, ...patch }));
  const setLine = (i: number, patch: Partial<LineItem>) => setD((cur) => ({ ...cur!, lineItems: cur!.lineItems.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const pickContact = (cid: string, c?: Contact) => {
    const patch: Partial<Draft> = { contactId: cid || undefined, billingAddress: c?.billingAddress, shippingAddress: c?.shippingAddress };
    if (c && !editing) {
      patch.paymentTerms = c.paymentTerms;
      if (kind === 'invoice' || kind === 'bill') patch.dueDate = dueDateFor(d.date || today(), c.paymentTerms);
      if (c.tdsRate && !sales) patch.tdsRate = c.tdsRate;
    }
    if (c && !sales) {
      patch.gstTreatment = c.gstTreatment || (c.gstin ? 'registered_business' : 'unregistered_business');
      patch.gstin = c.gstin;
      patch.sourceOfSupply = c.placeOfSupply || stateFromGstin(c.gstin) || boot.organization.state;
    }
    setContact(c);
    if ((c?.currencyCode || BASE_CURRENCY) !== currencyCode) setRateTouched(false);
    set(patch);
  };
  const pickItem = (i: number, itemId: string) => {
    const it = items.find((x) => x.id === itemId);
    if (!it) return setLine(i, { itemId: undefined });
    setLine(i, {
      itemId: it.id,
      name: it.name,
      description: sales ? it.salesDescription : it.purchaseDescription,
      rate: inDocCurrency(sales ? sellRate(it) : it.costPrice),
      unit: it.unit,
      accountId: sales ? it.salesAccountId : it.purchaseAccountId,
      taxId: it.taxId,
      hsnSac: it.hsnSac,
    });
  };

  async function save(mode: 'draft' | 'open' | 'send') {
    if (!d) return;
    const body: Record<string, unknown> = { ...d, kind, mode, lineItems: d.lineItems.filter((l) => l.name.trim() || l.itemId) };
    if (foreign) {
      if (!(rateNum > 0)) return toast.error(`Enter the exchange rate for ${currencyCode} (INR per 1 ${currencyCode})`);
      if (rateChanged && !confirmRate) return toast.error(`This ${meta.label.toLowerCase()} was recorded at ${rateLabel(currencyCode, originalRate!)}. Tick the confirmation to change the exchange rate.`);
      Object.assign(body, { currencyCode, exchangeRate: rateNum, confirmRateChange: rateChanged ? true : undefined });
    } else Object.assign(body, { currencyCode: BASE_CURRENCY, exchangeRate: undefined });
    setSaving(true);
    try {
      const saved = await api<TxnDoc>(editing ? `/docs/${id}` : '/docs', { method: editing ? 'PUT' : 'POST', body });
      toast.success(`${meta.label} ${editing ? 'updated' : 'created'} successfully`);
      if (makeRecurring && (kind === 'invoice' || kind === 'bill')) {
        navigate(`${DOC_META[kind === 'invoice' ? 'recurring_invoice' : 'recurring_bill'].path}/new?from=${saved.id}`);
      } else navigate(`${meta.path}/${saved.id}${mode === 'send' ? '?send=1' : ''}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const has = (f: (typeof ui.fields)[number]) => ui.fields.includes(f);
  const contactInvoices = openInvoices.filter((i) => i.contactId === d.contactId && i.status !== 'void' && !isUnposted(i.status || 'draft'));
  const recurringTarget = kind === 'recurring_invoice' ? 'Invoice' : 'Bill';
  const adjustedForRound = totals.roundOffAmount;

  return (
    <div className="flex min-h-full flex-col bg-white">
      <PageHeader title={`${editing ? 'Edit' : 'New'} ${meta.label}`}>
        <button className="btn-ghost w-8 px-0" onClick={() => navigate(-1)} aria-label="Close">
          <X size={18} />
        </button>
      </PageHeader>
      <div className="flex-1 space-y-4 px-5 py-5">
        <div className="max-w-4xl space-y-4 rounded-md bg-slate-50/70 p-4">
          <Field label={sales ? 'Client Name' : 'Supplier Name'} required>
            <ContactPicker kind={sales ? 'customer' : 'vendor'} value={d.contactId} onChange={pickContact} disabled={editing && kind !== 'recurring_invoice' && kind !== 'recurring_bill' && (d.amountPaid ?? 0) > 0} autoFocus={!editing} />
          </Field>
          {!sales && d.contactId && (
            <GstFields value={d} onChange={(p) => set(p)} reverseCharge={kind === 'bill' || kind === 'recurring_bill' || kind === 'vendor_credit'} />
          )}
          {has('addresses') && contact && (
            <div className="grid gap-4 sm:ml-[196px] sm:grid-cols-2">
              <div className="text-xs">
                <div className="mb-1 font-semibold uppercase text-slate-500">Billing Address</div>
                <AddressBlock a={d.billingAddress ?? contact.billingAddress} />
              </div>
              <div className="text-xs">
                <div className="mb-1 font-semibold uppercase text-slate-500">Shipping Address</div>
                <AddressBlock a={d.shippingAddress ?? contact.shippingAddress} />
              </div>
            </div>
          )}
        </div>

        <div className="max-w-4xl space-y-3">
          {has('deliveryAddress') && (
            <Field label="Delivery Address" required>
              <Radio name="delivery" value={d.deliveryAddressType || 'organization'} onChange={(v) => set({ deliveryAddressType: v })} options={[{ value: 'organization', label: 'Organization' }, { value: 'customer', label: 'Client' }]} />
              {d.deliveryAddressType === 'customer' && (
                <div className="mt-2 max-w-sm">
                  <ContactPicker kind="customer" value={d.deliveryCustomerId} onChange={(cid) => set({ deliveryCustomerId: cid })} />
                </div>
              )}
              {d.deliveryAddressType !== 'customer' && (
                <div className="mt-1 text-xs text-slate-500">
                  {boot.organization.name}, {boot.organization.state}, {boot.organization.country}
                </div>
              )}
            </Field>
          )}
          {meta.recurring ? (
            <Field label="Profile Name" required>
              <input className="input max-w-sm" value={d.profileName || ''} onChange={(e) => set({ profileName: e.target.value })} />
            </Field>
          ) : (
            <Field label={meta.numberLabel} required>
              <div className="flex max-w-sm items-center gap-2">
                <input className="input" value={d.number || ''} onChange={(e) => set({ number: e.target.value })} placeholder={kind === 'bill' ? "Supplier's bill number" : undefined} />
                {kind !== 'bill' && <Settings2 size={15} className="shrink-0 text-brand-600" aria-label="Auto-generated" />}
              </div>
            </Field>
          )}
          {has('orderNumber') && (
            <Field label="Order Number">
              <input className="input max-w-sm" value={d.orderNumber || ''} onChange={(e) => set({ orderNumber: e.target.value })} />
            </Field>
          )}
          {has('reference') && (
            <Field label="Reference#">
              <input className="input max-w-sm" value={d.referenceNumber || ''} onChange={(e) => set({ referenceNumber: e.target.value })} />
            </Field>
          )}
          {has('invoiceRef') && (
            <Field label="Invoice#">
              <Select className="max-w-sm" value={d.invoiceId || ''} onChange={(e) => set({ invoiceId: e.target.value || undefined })} placeholder="Select an invoice" options={contactInvoices.map((i) => ({ value: i.id, label: `${i.number} (${moneyIn(i.total, i.currencyCode)})` }))} />
            </Field>
          )}
          {has('recurrence') ? (
            <>
              <Field label="Repeat Every" required>
                <div className="flex max-w-sm gap-2">
                  <input type="number" min={1} className="input w-20" value={d.repeatEvery?.n ?? 1} onChange={(e) => set({ repeatEvery: { n: Number(e.target.value), unit: d.repeatEvery?.unit || 'month' } })} />
                  <Select value={d.repeatEvery?.unit || 'month'} onChange={(e) => set({ repeatEvery: { n: d.repeatEvery?.n || 1, unit: e.target.value as 'month' } })} options={[{ value: 'day', label: 'Day(s)' }, { value: 'week', label: 'Week(s)' }, { value: 'month', label: 'Month(s)' }, { value: 'year', label: 'Year(s)' }]} />
                </div>
              </Field>
              <Field label="Start On">
                <DateInput className="max-w-[200px]" value={d.startOn} onChange={(v) => set({ startOn: v })} />
              </Field>
              <Field label="Ends On">
                <div className="flex items-center gap-4">
                  <DateInput className="max-w-[200px]" value={d.endsOn} disabled={d.neverExpires} onChange={(v) => set({ endsOn: v })} />
                  <Checkbox checked={!!d.neverExpires} onChange={(v) => set({ neverExpires: v })} label="Never Expires" />
                </div>
              </Field>
            </>
          ) : (
            <Field label={meta.dateLabel} required>
              <DateInput
                className="max-w-[200px]"
                value={d.date}
                onChange={(v) => {
                  const patch: Partial<Draft> = { date: v };
                  if ((kind === 'invoice' || kind === 'bill') && d.paymentTerms) patch.dueDate = dueDateFor(v, d.paymentTerms);
                  set(patch);
                }}
              />
            </Field>
          )}
          {d.contactId && (
            <Field label="Currency">
              <div className="flex items-center gap-2 text-[13px] text-slate-600">
                <CurrencyBadge code={currencyCode} />
                <span>{foreign ? `Amounts are in ${currencyCode}, the ${sales ? 'client' : 'supplier'}'s currency.` : 'Indian Rupee (base currency)'}</span>
              </div>
            </Field>
          )}
          {foreign && (
            <Field label="Exchange Rate" required>
              <RateInput code={currencyCode} value={rateStr ?? ''} onChange={(v) => { setRateStr(v); setRateTouched(true); }} amount={totals.total} defaultRate={!editing ? dayRate?.rate : undefined} />
              {rateChanged && (
                <div className="mt-2 max-w-md rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                  This {meta.label.toLowerCase()} was recorded at {rateLabel(currencyCode, originalRate!)}. Changing the rate re-posts its journal in INR.
                  <div className="mt-1">
                    <Checkbox checked={confirmRate} onChange={setConfirmRate} label={`I confirm the new rate ${rateLabel(currencyCode, rateNum)}`} />
                  </div>
                </div>
              )}
            </Field>
          )}
          {has('expiryDate') && (
            <Field label="Expiry Date">
              <DateInput className="max-w-[200px]" value={d.expiryDate} onChange={(v) => set({ expiryDate: v })} />
            </Field>
          )}
          {has('expectedShipment') && (
            <Field label="Expected Shipment Date">
              <DateInput className="max-w-[200px]" value={d.expectedShipmentDate} onChange={(v) => set({ expectedShipmentDate: v })} />
            </Field>
          )}
          {has('deliveryDate') && (
            <Field label="Delivery Date">
              <DateInput className="max-w-[200px]" value={d.deliveryDate} onChange={(v) => set({ deliveryDate: v })} />
            </Field>
          )}
          {has('terms') && (
            <Field label={kind === 'invoice' ? 'Terms' : 'Payment Terms'}>
              <Select
                className="max-w-[240px]"
                value={d.paymentTerms || 'due_on_receipt'}
                onChange={(e) => {
                  const t = e.target.value as TxnDoc['paymentTerms'];
                  set({ paymentTerms: t, ...(kind === 'invoice' || kind === 'bill' ? { dueDate: dueDateFor(d.date || today(), t) } : {}) });
                }}
                options={PAYMENT_TERMS}
              />
            </Field>
          )}
          {has('dueDate') && (
            <Field label="Due Date">
              <DateInput className="max-w-[200px]" value={d.dueDate} onChange={(v) => set({ dueDate: v })} />
            </Field>
          )}
          {has('challanType') && (
            <Field label="Challan Type" required>
              <Select className="max-w-sm" value={d.challanType || ''} onChange={(e) => set({ challanType: e.target.value })} placeholder="Choose a proper challan type" options={(prefs.challanTypes || []).map((c) => ({ value: c, label: c }))} />
            </Field>
          )}
          {has('account') && (
            <Field label={sales ? 'Accounts Receivable' : 'Accounts Payable'}>
              <AccountSelect className="max-w-sm" accounts={boot.accounts} value={d.accountId || (sales ? 'acc_ar' : 'acc_ap')} onChange={(v) => set({ accountId: v })} filter={(a) => a.subType === (sales ? 'accounts_receivable' : 'accounts_payable')} />
            </Field>
          )}
          {has('deliveryMethod') && (
            <Field label="Delivery Method">
              <Combo className="max-w-sm" allowFree freeValue={d.deliveryMethod} onFree={(v) => set({ deliveryMethod: v })} value={d.deliveryMethod} onChange={(v) => set({ deliveryMethod: v })} placeholder="Select a delivery method or type to add" options={(prefs.deliveryMethods || []).map((m) => ({ value: m, label: m }))} />
            </Field>
          )}
          {has('shipmentPreference') && (
            <Field label="Shipment Preference">
              <Combo className="max-w-sm" allowFree freeValue={d.shipmentPreference} onFree={(v) => set({ shipmentPreference: v })} value={d.shipmentPreference} onChange={(v) => set({ shipmentPreference: v })} placeholder="Choose the shipment preference or type to add" options={(prefs.deliveryMethods || []).map((m) => ({ value: m, label: m }))} />
            </Field>
          )}
          {has('salesperson') && (
            <Field label="Salesperson">
              <Combo className="max-w-sm" allowFree freeValue={d.salesperson} onFree={(v) => set({ salesperson: v })} value={d.salesperson} onChange={(v) => set({ salesperson: v })} placeholder="Select or add salesperson" options={(prefs.salespersons || []).map((s) => ({ value: s, label: s }))} />
            </Field>
          )}
          {has('project') && <ProjectField value={d.projectId} name={d.projectName} customerId={sales ? d.contactId : undefined} onChange={(projectId, projectName) => set({ projectId: projectId as string, projectName })} label={kind === 'recurring_invoice' ? 'Associate Project(s) Hours' : 'Project Name'} />}
          {has('subject') && (
            <Field label="Subject">
              <textarea className="input max-w-xl" rows={2} placeholder={`Let your ${sales ? 'customer' : 'vendor'} know what this ${meta.label} is for`} value={d.subject || ''} onChange={(e) => set({ subject: e.target.value })} />
            </Field>
          )}
          {customFieldsFor(prefs, kind)
            .filter((f) => f.active)
            .map((f) => (
              <Field key={f.id} label={f.label} required={f.mandatory}>
                <CustomFieldInput f={f} value={d.customFields?.[f.id] ?? ''} onChange={(v) => set({ customFields: { ...d.customFields, [f.id]: v } })} />
              </Field>
            ))}
        </div>

        {/* ---------------------------------------------------------- item table */}
        <div className="max-w-6xl">
          <div className="flex items-center justify-between rounded-t-md border border-b-0 border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex items-center gap-4">
              <div className="font-semibold">Item Table</div>
              {sales && pricing?.priceList && <span className="chip bg-brand-50 text-brand-800" title="New rows use this client's price list">Price list: {pricing.priceList.name}</span>}
              {!sales && <TaxInclusiveSelect value={!!d.taxInclusive} disabled={!!d.reverseCharge} onChange={(v) => set({ taxInclusive: v })} />}
            </div>
            <div className="flex gap-3 text-xs text-brand-600">
              <button type="button" className="inline-flex items-center gap-1 hover:underline" onClick={() => setBulk(true)}>
                <ScanLine size={13} /> Scan Item
              </button>
              <button type="button" className="inline-flex items-center gap-1 hover:underline" onClick={() => set({ lineItems: d.lineItems.filter((l) => l.name || l.itemId) })}>
                <ListPlus size={13} /> Bulk Actions
              </button>
            </div>
          </div>
          <div className="overflow-x-auto border border-slate-200">
            <table className="w-full text-[13px]">
              <thead className="bg-white text-[11px] uppercase tracking-wide text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="min-w-[260px] px-3 py-2 text-left font-semibold">Item Details</th>
                  {ui.lineAccount && <th className="w-48 px-2 py-2 text-left font-semibold">Account</th>}
                  <th className="w-24 px-2 py-2 text-right font-semibold">Quantity</th>
                  <th className="w-32 px-2 py-2 text-right font-semibold">Rate</th>
                  {ui.lineDiscount && <th className="w-24 px-2 py-2 text-right font-semibold">Discount</th>}
                  {!sales && <th className="w-40 px-2 py-2 text-left font-semibold">Tax</th>}
                  {ui.lineCustomer && <th className="w-44 px-2 py-2 text-left font-semibold">Client Details</th>}
                  <th className="w-32 px-3 py-2 text-right font-semibold">Amount</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {d.lineItems.map((l, i) => (
                  <tr key={l.id} className="border-b border-slate-100 align-top">
                    <td className="px-3 py-2">
                      <Combo
                        allowFree
                        freeValue={l.name}
                        onFree={(v) => setLine(i, { name: v, itemId: undefined })}
                        value={l.itemId}
                        onChange={(v) => pickItem(i, v)}
                        placeholder="Type or click to select an item."
                        options={items.filter((it) => (sales ? it.sellable : it.purchasable)).map((it) => ({ value: it.id, label: it.name, sub: `Rate: ${money(sales ? sellRate(it) : it.costPrice)}${it.unit ? ` / ${it.unit}` : ''}` }))}
                      />
                      <textarea className="input mt-1 text-xs" rows={1} placeholder="Add a description" value={l.description || ''} onChange={(e) => setLine(i, { description: e.target.value })} />
                    </td>
                    {ui.lineAccount && (
                      <td className="px-2 py-2">
                        <AccountSelect accounts={boot.accounts} value={l.accountId} onChange={(v) => setLine(i, { accountId: v })} filter={(a) => (sales ? a.type === 'income' : a.type === 'expense' || a.subType === 'fixed_asset' || a.subType === 'other_current_asset')} />
                      </td>
                    )}
                    <td className="px-2 py-2">
                      <input type="number" min={0} step="any" className="input text-right" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value as unknown as number })} />
                      {l.unit && <div className="mt-0.5 text-right text-xxs text-slate-500">{l.unit}</div>}
                    </td>
                    <td className="px-2 py-2">
                      <input type="number" min={0} step="0.01" className="input text-right" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value as unknown as number })} />
                    </td>
                    {ui.lineDiscount && (
                      <td className="px-2 py-2">
                        <div className="flex">
                          <input type="number" min={0} max={100} className="input rounded-r-none text-right" value={l.discountPercent ?? 0} onChange={(e) => setLine(i, { discountPercent: e.target.value as unknown as number })} />
                          <span className="inline-flex items-center rounded-r-md border border-l-0 border-slate-300 bg-slate-50 px-1.5 text-xs">%</span>
                        </div>
                      </td>
                    )}
                    {!sales && (
                      <td className="px-2 py-2">
                        <TaxSelect value={l.taxId} intra={totals.intraState} onChange={(v) => setLine(i, { taxId: v })} />
                        {l.hsnSac && <div className="mt-0.5 text-xxs text-slate-500">HSN/SAC: {l.hsnSac}</div>}
                      </td>
                    )}
                    {ui.lineCustomer && (
                      <td className="px-2 py-2">
                        <Select value={l.customerId || ''} onChange={(e) => setLine(i, { customerId: e.target.value || undefined })} placeholder="Select Client" options={customers.map((c) => ({ value: c.id, label: c.displayName }))} />
                      </td>
                    )}
                    <td className="px-3 py-3 text-right font-medium tabular-nums">{num(lineAmount(l))}</td>
                    <td className="py-2 pr-2">
                      <button type="button" aria-label="Remove row" className="mt-1.5 text-slate-400 hover:text-red-500" onClick={() => set({ lineItems: d.lineItems.length > 1 ? d.lineItems.filter((_, j) => j !== i) : [blankLine()] })}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-2">
              <button type="button" className="btn-secondary btn-sm text-brand-700" onClick={() => set({ lineItems: [...d.lineItems, blankLine()] })}>
                <Plus size={13} /> Add New Row
              </button>
              <button type="button" className="btn-secondary btn-sm text-brand-700" onClick={() => setBulk(true)}>
                <Plus size={13} /> Add Items in Bulk
              </button>
            </div>
            <div className="w-full rounded-md bg-slate-50 p-4 lg:w-[440px]">
              <TotalLine label="Sub Total" value={totals.subTotal} bold />
              <div className="flex items-center justify-between gap-3 py-1.5">
                <span className="text-slate-600">Discount</span>
                <div className="flex w-24">
                  <input type="number" min={0} max={100} className="input rounded-r-none text-right" value={d.discountPercent ?? 0} onChange={(e) => set({ discountPercent: e.target.value as unknown as number })} />
                  <span className="inline-flex items-center rounded-r-md border border-l-0 border-slate-300 bg-white px-2 text-xs">%</span>
                </div>
                <span className="w-28 text-right tabular-nums">-{num(totals.discountAmount)}</span>
              </div>
              <TaxRows rows={totals.taxBreakdown} reverseCharge={d.reverseCharge} inclusive={!!d.taxInclusive && !d.reverseCharge} />
              <div className="flex items-center justify-between gap-3 py-1.5">
                <span className="text-slate-600">TDS</span>
                <Select className="w-44" value={d.tdsRate ?? 0} onChange={(e) => set({ tdsRate: Number(e.target.value), tcsRate: Number(e.target.value) ? 0 : d.tcsRate })} options={TDS_RATES.map((t) => ({ value: t.value, label: t.label }))} />
                <span className="w-28 text-right tabular-nums">-{num(totals.tdsAmount)}</span>
              </div>
              <div className="flex items-center justify-between gap-3 py-1.5">
                <span className="text-slate-600">TCS</span>
                <Select className="w-44" value={d.tcsRate ?? 0} onChange={(e) => set({ tcsRate: Number(e.target.value), tdsRate: Number(e.target.value) ? 0 : d.tdsRate })} options={TCS_RATES.map((t) => ({ value: t.value, label: t.label }))} />
                <span className="w-28 text-right tabular-nums">{num(totals.tcsAmount)}</span>
              </div>
              <div className="flex items-center justify-between gap-3 py-1.5">
                <input className="input w-28 border-dashed" value={d.adjustmentLabel ?? 'Adjustment'} onChange={(e) => set({ adjustmentLabel: e.target.value })} aria-label="Adjustment label" />
                <input type="number" step="0.01" className="input w-24 text-right" value={d.adjustment ?? 0} onChange={(e) => set({ adjustment: e.target.value as unknown as number })} />
                <span className="w-28 text-right tabular-nums">{num(totals.adjustment)}</span>
              </div>
              {ui.roundOff && (
                <div className="flex items-center justify-between gap-3 py-1.5">
                  <Checkbox checked={!!d.roundOff} onChange={(v) => set({ roundOff: v })} label="Round Off" />
                  <span className="w-28 text-right tabular-nums">{num(adjustedForRound)}</span>
                </div>
              )}
              <div className="mt-2 flex items-center justify-between border-t border-slate-300 pt-3 text-base font-semibold">
                <span>Total ( {currencyCode} )</span>
                <span className="tabular-nums">{num(totals.total)}</span>
              </div>
              {foreign && (
                <div className="mt-1 flex items-center justify-between text-[13px] text-slate-600" data-testid="total-in-inr">
                  <span>Total in INR {rateNum > 0 && <span className="text-xs text-slate-400">({rateLabel(currencyCode, rateNum)})</span>}</span>
                  <span className="font-semibold tabular-nums text-slate-800">{rateNum > 0 ? moneyIn(toBase(totals.total, rateNum), BASE_CURRENCY) : '-'}</span>
                </div>
              )}
              {d.reverseCharge && totals.taxAmount > 0 && <div className="mt-2 text-xxs text-amber-700">Tax of {num(totals.taxAmount)} is payable by you under reverse charge and is not part of the amount owed to the vendor.</div>}
              {!sales && d.gstTreatment && !treatmentChargesTax(d.gstTreatment) && !d.reverseCharge && totals.taxAmount > 0 && <div className="mt-2 text-xxs text-amber-700">Suppliers with this GST treatment do not usually charge GST. Check the tax on each line.</div>}
            </div>
          </div>
        </div>

        <div className="grid max-w-6xl gap-6 lg:grid-cols-2">
          <div>
            <div className="mb-1 text-[13px] text-slate-700">{ui.notesLabel}</div>
            <textarea className="input" rows={3} value={(sales ? d.customerNotes : d.notes) || ''} onChange={(e) => set(sales ? { customerNotes: e.target.value } : { notes: e.target.value })} placeholder={sales || (kind !== 'bill' && kind !== 'recurring_bill') ? 'Will be displayed on the document' : 'It will not be shown in PDF'} />
          </div>
          {kind !== 'bill' && kind !== 'recurring_bill' && (
            <div>
              <div className="mb-1 text-[13px] text-slate-700">Terms & Conditions</div>
              <textarea className="input" rows={3} value={d.terms || ''} onChange={(e) => set({ terms: e.target.value })} placeholder="Enter the terms and conditions of your business to be displayed in your transaction" />
            </div>
          )}
        </div>
        {!meta.recurring && (
          <div className="max-w-6xl">
            <Attachments value={d.attachments || []} onChange={(v) => set({ attachments: v })} max={ui.attachments.max} maxMB={ui.attachments.mb} label={`Attach File(s) to ${meta.label}`} />
          </div>
        )}
        {has('createAsDraft') && (
          <div className="max-w-6xl rounded-md border border-slate-200 p-3">
            <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Preferences</div>
            <Radio name="createAs" value={d.createAsDraft ? 'draft' : 'open'} onChange={(v) => set({ createAsDraft: v === 'draft' })} options={[{ value: 'draft', label: `Create ${recurringTarget}s as Drafts` }, { value: 'open', label: `Create ${recurringTarget}s and save them as Open` }]} />
          </div>
        )}
        {has('emailComms') && contact?.email && (
          <div className="max-w-6xl text-xs text-slate-500">
            Email Communications: <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">{contact.email}</span>
          </div>
        )}
      </div>
      <FormFooter>
        {ui.saveLabels.draft && (!editing || d.status === 'draft') && (
          <button className="btn-secondary" disabled={saving} onClick={() => save('draft')}>
            {ui.saveLabels.draft}
          </button>
        )}
        {approvals ? (
          <button className="btn-primary" disabled={saving} title="Sends this transaction for approval" onClick={() => save('open')}>
            {editing && d.status === 'pending_approval' ? 'Save' : editing && d.status === 'approved' ? 'Save and Resubmit' : editing && !isUnposted(d.status || 'draft') ? 'Save' : 'Save and Submit'}
          </button>
        ) : (
          <button className="btn-primary" disabled={saving} onClick={() => save(editing && d.status !== 'draft' ? 'open' : ui.saveLabels.send ? 'send' : 'open')}>
            {editing && d.status !== 'draft' ? 'Save' : ui.saveLabels.send ?? ui.saveLabels.open}
          </button>
        )}
        {!approvals && ui.saveLabels.send && (!editing || d.status === 'draft') && ui.saveLabels.open !== 'Save' && (
          <button className="btn-secondary" disabled={saving} onClick={() => save('open')}>
            {ui.saveLabels.open}
          </button>
        )}
        <button className="btn-ghost" onClick={() => navigate(-1)}>
          Cancel
        </button>
        {has('makeRecurring') && !editing && (
          <div className="ml-auto">
            <Checkbox checked={makeRecurring} onChange={setMakeRecurring} label="Make Recurring" />
          </div>
        )}
        <div className={clsx('text-right text-xs text-slate-500', !has('makeRecurring') && 'ml-auto')}>
          Total Amount: <span className="font-semibold text-slate-800">{moneyIn(totals.total, currencyCode)}</span>
          {foreign && rateNum > 0 && <span className="ml-2">({moneyIn(toBase(totals.total, rateNum), BASE_CURRENCY)})</span>}
        </div>
      </FormFooter>
      <BulkItems
        open={bulk}
        onClose={() => setBulk(false)}
        items={items.filter((it) => (sales ? it.sellable : it.purchasable)).map((it) => (sales ? { ...it, sellingPrice: sellRate(it) } : it))}
        sales={sales}
        onAdd={(lines) => set({ lineItems: [...d.lineItems.filter((l) => l.name || l.itemId), ...lines.map((l) => ({ ...l, rate: inDocCurrency(l.rate) }))] })}
      />
    </div>
  );
}

function TotalLine({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className={clsx('flex justify-between py-1.5', bold && 'font-semibold')}>
      <span>{label}</span>
      <span className="tabular-nums">{num(value)}</span>
    </div>
  );
}

/** Project link: stores the project id (and its name for display). Purchases list every active project. */
function ProjectField({ value, name, onChange, customerId, label }: { value?: string; name?: string; onChange: (id: string | null, name?: string) => void; customerId?: string; label: string }) {
  const { data = [] } = useApi<{ id: string; name: string; customerId?: string; customerName?: string; status: string }[]>('/projects?view=all');
  const opts = data.filter((p) => p.id === value || (p.status === 'active' && (!customerId || p.customerId === customerId))).map((p) => ({ value: p.id, label: p.name, sub: p.customerName }));
  return (
    <Field label={label}>
      <Combo className="max-w-sm" value={value} onChange={(id) => onChange(id || null, data.find((p) => p.id === id)?.name)} allowFree={!value} freeValue={value ? undefined : name} onFree={(text) => onChange(null, text)} placeholder={opts.length ? 'Select a project' : customerId ? 'No projects for this client' : 'Select a project'} options={opts} />
    </Field>
  );
}

function BulkItems({ open, onClose, items, sales, onAdd }: { open: boolean; onClose: () => void; items: Item[]; sales: boolean; onAdd: (l: LineItem[]) => void }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Record<string, number>>({});
  const list = items.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Items in Bulk"
      width="max-w-3xl"
      footer={
        <>
          <button
            className="btn-primary"
            onClick={() => {
              onAdd(
                Object.entries(picked).map(([id, qty]) => {
                  const it = items.find((x) => x.id === id)!;
                  return { id: `new_${++rowSeq}`, itemId: it.id, name: it.name, description: sales ? it.salesDescription : it.purchaseDescription, quantity: qty, rate: sales ? it.sellingPrice : it.costPrice, unit: it.unit, accountId: sales ? it.salesAccountId : it.purchaseAccountId, amount: 0 };
                }),
              );
              setPicked({});
              onClose();
            }}
          >
            Add Items
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <div>
          <input className="input mb-2" placeholder="Type to search or scan the barcode of the item" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <div className="max-h-80 overflow-auto rounded-md border border-slate-200">
            {list.map((i) => (
              <button
                key={i.id}
                type="button"
                className={clsx('flex w-full items-center justify-between border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50', picked[i.id] && 'bg-brand-50')}
                onClick={() => setPicked((p) => (p[i.id] ? Object.fromEntries(Object.entries(p).filter(([k]) => k !== i.id)) : { ...p, [i.id]: 1 }))}
              >
                <span>
                  <div className="font-medium">{i.name}</div>
                  <div className="text-xxs text-slate-500">Rate: {money(sales ? i.sellingPrice : i.costPrice)}</div>
                </span>
                {picked[i.id] && <span className="text-xs text-emerald-600">✓</span>}
              </button>
            ))}
            {!list.length && <div className="p-3 text-slate-400">No items found.</div>}
          </div>
        </div>
        <div>
          <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Selected Items ({Object.keys(picked).length})</div>
          {Object.entries(picked).map(([id, qty]) => (
            <div key={id} className="mb-2 flex items-center justify-between gap-2">
              <span className="truncate">{items.find((x) => x.id === id)?.name}</span>
              <input type="number" min={1} className="input w-20 text-right" value={qty} onChange={(e) => setPicked((p) => ({ ...p, [id]: Number(e.target.value) }))} />
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function CustomFieldInput({ f, value, onChange }: { f: CustomFieldDef; value: string; onChange: (v: string) => void }) {
  switch (f.dataType) {
    case 'textarea':
      return <textarea className="input max-w-xl" rows={2} value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'date':
      return <DateInput className="max-w-[200px]" value={value} onChange={onChange} />;
    case 'checkbox':
      return <Checkbox checked={value === 'true'} onChange={(v) => onChange(v ? 'true' : '')} label="" />;
    case 'dropdown':
      return <Select className="max-w-sm" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Select" options={(f.options || []).map((o) => ({ value: o, label: o }))} />;
    default:
      return <input className="input max-w-sm" type={f.dataType === 'number' ? 'number' : f.dataType === 'email' ? 'email' : f.dataType === 'url' ? 'url' : 'text'} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
}
