import { StateSelect, TreatmentSelect } from '../../components/gst';
import { stateFromGstin, treatmentNeedsGstin } from '@shared/gst';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2, X, Mail, Phone } from 'lucide-react';
import { PAYMENT_TERMS, TDS_RATES, type Address, type Contact, type ContactKind } from '@shared/types';
import { api, useApi } from '../../api';
import { useBoot } from '../../lib/app';
import { toast } from '../../lib/toast';
import { AccountSelect, Checkbox, Field, FormFooter, MoneyInput, PageHeader, Radio, Select, Spinner, Tabs } from '../../components/ui';
import { Attachments } from '../../components/shared';

const SALUTATIONS = ['Mr.', 'Mrs.', 'Ms.', 'Miss.', 'Dr.'];
const LANGUAGES = ['English', 'Tamil', 'Hindi', 'Telugu', 'Kannada', 'Malayalam'];
const STATES = ['Tamil Nadu', 'Karnataka', 'Kerala', 'Andhra Pradesh', 'Telangana', 'Maharashtra', 'Delhi', 'Gujarat', 'West Bengal', 'Puducherry', 'Other'];

function AddressForm({ value, onChange, title, onCopy }: { value: Address; onChange: (a: Address) => void; title: string; onCopy?: () => void }) {
  const set = (p: Partial<Address>) => onChange({ ...value, ...p });
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="font-semibold">{title}</div>
        {onCopy && (
          <button type="button" className="link text-xs" onClick={onCopy}>
            ↓ Copy billing address
          </button>
        )}
      </div>
      <Field label="Attention" inline={false}>
        <input className="input" value={value.attention || ''} onChange={(e) => set({ attention: e.target.value })} />
      </Field>
      <Field label="Country/Region" inline={false}>
        <input className="input" value={value.country ?? 'India'} onChange={(e) => set({ country: e.target.value })} />
      </Field>
      <Field label="Address" inline={false}>
        <textarea className="input" rows={2} placeholder="Street 1" value={value.street1 || ''} onChange={(e) => set({ street1: e.target.value })} />
        <textarea className="input mt-2" rows={2} placeholder="Street 2" value={value.street2 || ''} onChange={(e) => set({ street2: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="City" inline={false}>
          <input className="input" value={value.city || ''} onChange={(e) => set({ city: e.target.value })} />
        </Field>
        <Field label="State" inline={false}>
          <Select value={value.state || ''} onChange={(e) => set({ state: e.target.value })} placeholder="Select or type to add" options={STATES.map((s) => ({ value: s, label: s }))} />
        </Field>
        <Field label="Pin Code" inline={false}>
          <input className="input" value={value.pin || ''} onChange={(e) => set({ pin: e.target.value })} />
        </Field>
        <Field label="Phone" inline={false}>
          <input className="input" value={value.phone || ''} onChange={(e) => set({ phone: e.target.value })} />
        </Field>
      </div>
    </div>
  );
}

export function ContactForm({ kind }: { kind: ContactKind }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { accounts } = useBoot();
  const label = kind === 'customer' ? 'Client' : 'Supplier';
  const base = kind === 'customer' ? '/sales/customers' : '/purchases/vendors';
  const { data: existing } = useApi<Contact>(id ? `/contacts/${id}` : null);
  const [f, setF] = useState<Partial<Contact> | null>(
    id ? null : { kind, customerType: 'business', language: 'English', currencyCode: 'INR', paymentTerms: 'due_on_receipt', billingAddress: { country: 'India', state: 'Tamil Nadu' }, shippingAddress: { country: 'India' }, contactPersons: [], bankDetails: [], documents: [], customFields: {}, reportingTags: {}, portalEnabled: false, openingBalance: 0 },
  );
  const [tab, setTab] = useState('other');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (existing && !f) setF(existing);
  }, [existing, f]);
  if (!f) return <Spinner />;
  const set = (p: Partial<Contact>) => setF({ ...f, ...p });
  const nameOptions = Array.from(new Set([[f.salutation, f.firstName, f.lastName].filter(Boolean).join(' '), [f.firstName, f.lastName].filter(Boolean).join(' '), [f.lastName, f.firstName].filter(Boolean).join(', '), f.companyName].filter((x): x is string => !!x && x.trim().length > 0)));

  async function save() {
    setSaving(true);
    try {
      const saved = await api<Contact>(id ? `/contacts/${id}` : '/contacts', { method: id ? 'PUT' : 'POST', body: f });
      toast.success(`${label} ${id ? 'updated' : 'created'} successfully`);
      navigate(`${base}/${saved.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const tabs = [
    { value: 'other', label: 'Other Details' },
    { value: 'address', label: 'Address' },
    { value: 'persons', label: 'Contact Persons' },
    ...(kind === 'vendor' ? [{ value: 'bank', label: 'Bank Details' }] : []),
    { value: 'custom', label: 'Custom Fields' },
    { value: 'tags', label: 'Reporting Tags' },
    { value: 'remarks', label: 'Remarks' },
  ];

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader title={id ? `Edit ${label}` : `New ${label}`}>
        <button className="btn-ghost w-8 px-0" onClick={() => navigate(-1)} aria-label="Close">
          <X size={18} />
        </button>
      </PageHeader>
      <div className="flex-1 space-y-4 px-5 py-5">
        <div className="max-w-3xl space-y-3.5">
          {kind === 'customer' && (
            <Field label="Client Type">
              <Radio name="ctype" value={f.customerType || 'business'} onChange={(v) => set({ customerType: v })} options={[{ value: 'business', label: 'Business' }, { value: 'individual', label: 'Individual' }]} />
            </Field>
          )}
          <Field label="Primary Contact">
            <div className="grid grid-cols-[110px_1fr_1fr] gap-2">
              <Select value={f.salutation || ''} onChange={(e) => set({ salutation: e.target.value })} placeholder="Salutation" options={SALUTATIONS.map((s) => ({ value: s, label: s }))} />
              <input className="input" placeholder="First Name" value={f.firstName || ''} onChange={(e) => set({ firstName: e.target.value })} />
              <input className="input" placeholder="Last Name" value={f.lastName || ''} onChange={(e) => set({ lastName: e.target.value })} />
            </div>
          </Field>
          <Field label="Company Name">
            <input className="input" value={f.companyName || ''} onChange={(e) => set({ companyName: e.target.value })} />
          </Field>
          <Field label="Display Name" required hint={`This name will be displayed on transactions you create for this ${kind}.`}>
            <input className="input" list="display-names" value={f.displayName || ''} onChange={(e) => set({ displayName: e.target.value })} placeholder="Select or type to add" />
            <datalist id="display-names">
              {nameOptions.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </Field>
          <Field label="Email Address">
            <div className="relative">
              <Mail size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
              <input type="email" className="input pl-8" value={f.email || ''} onChange={(e) => set({ email: e.target.value })} />
            </div>
          </Field>
          <Field label="Phone">
            <div className="grid grid-cols-2 gap-2">
              <div className="flex">
                <span className="inline-flex h-8 items-center rounded-l-md border border-r-0 border-slate-300 bg-slate-50 px-2 text-xs">+91</span>
                <input className="input rounded-l-none" placeholder="Work Phone" value={f.workPhone || ''} onChange={(e) => set({ workPhone: e.target.value })} />
              </div>
              <div className="flex">
                <span className="inline-flex h-8 items-center rounded-l-md border border-r-0 border-slate-300 bg-slate-50 px-2 text-xs">+91</span>
                <input className="input rounded-l-none" placeholder="Mobile" value={f.mobile || ''} onChange={(e) => set({ mobile: e.target.value })} />
              </div>
            </div>
          </Field>
          <Field label={`${label} Language`}>
            <Select className="max-w-xs" value={f.language || 'English'} onChange={(e) => set({ language: e.target.value })} options={LANGUAGES.map((l) => ({ value: l, label: l }))} />
          </Field>
        </div>

        <Tabs tabs={tabs} value={tab} onChange={setTab} className="max-w-5xl" />
        <div className="max-w-5xl">
          {tab === 'other' && (
            <div className="max-w-3xl space-y-3.5">
              <Field label="GST Treatment" required>
                <TreatmentSelect className="max-w-xs" value={f.gstTreatment} onChange={(v) => set({ gstTreatment: v || undefined })} />
              </Field>
              {treatmentNeedsGstin(f.gstTreatment) && (
                <Field label="GSTIN / UIN" required>
                  <input className="input max-w-xs uppercase" maxLength={15} placeholder="33ABCDE1234F1Z5" value={f.gstin || ''} onChange={(e) => { const g = e.target.value.toUpperCase(); set({ gstin: g, ...(g.length >= 2 && stateFromGstin(g) ? { placeOfSupply: stateFromGstin(g) } : {}) }); }} />
                </Field>
              )}
              <Field label={kind === 'vendor' ? 'Source of Supply' : 'Place of Supply'} required>
                <StateSelect className="max-w-xs" value={f.placeOfSupply} onChange={(v) => set({ placeOfSupply: v })} />
              </Field>
              <Field label="PAN">
                <input className="input max-w-xs uppercase" value={f.pan || ''} onChange={(e) => set({ pan: e.target.value.toUpperCase() })} maxLength={10} />
              </Field>
              {kind === 'vendor' && (
                <Field label="MSME Registered?">
                  <Checkbox checked={!!f.msmeRegistered} onChange={(v) => set({ msmeRegistered: v })} label="This supplier is MSME registered" />
                </Field>
              )}
              <Field label="Currency">
                <Select className="max-w-xs" value={f.currencyCode || 'INR'} onChange={(e) => set({ currencyCode: e.target.value })} options={[{ value: 'INR', label: 'INR- Indian Rupee' }]} />
              </Field>
              <Field label={kind === 'customer' ? 'Accounts Receivable' : 'Accounts Payable'}>
                <AccountSelect className="max-w-xs" accounts={accounts} value={f.accountId || (kind === 'customer' ? 'acc_ar' : 'acc_ap')} onChange={(v) => set({ accountId: v })} filter={(a) => a.subType === (kind === 'customer' ? 'accounts_receivable' : 'accounts_payable')} />
              </Field>
              <Field label="Opening Balance">
                <MoneyInput className="max-w-xs" value={f.openingBalance} onChange={(v) => set({ openingBalance: v as unknown as number })} />
              </Field>
              <Field label="Payment Terms">
                <Select className="max-w-xs" value={f.paymentTerms || 'due_on_receipt'} onChange={(e) => set({ paymentTerms: e.target.value as Contact['paymentTerms'] })} options={PAYMENT_TERMS} />
              </Field>
              {kind === 'vendor' && (
                <Field label="TDS">
                  <Select className="max-w-xs" value={f.tdsRate ?? 0} onChange={(e) => set({ tdsRate: Number(e.target.value) })} options={TDS_RATES} />
                </Field>
              )}
              <Field label="Enable Portal?">
                <Checkbox checked={!!f.portalEnabled} onChange={(v) => set({ portalEnabled: v })} label={`Allow portal access for this ${kind}`} />
              </Field>
              <Field label="Documents">
                <Attachments compact value={f.documents || []} onChange={(v) => set({ documents: v })} max={10} maxMB={10} />
              </Field>
              <Field label="Website URL">
                <input className="input" placeholder="ex: www.creatign.in" value={f.website || ''} onChange={(e) => set({ website: e.target.value })} />
              </Field>
              <Field label="Department">
                <input className="input max-w-xs" value={f.department || ''} onChange={(e) => set({ department: e.target.value })} />
              </Field>
              <Field label="Designation">
                <input className="input max-w-xs" value={f.designation || ''} onChange={(e) => set({ designation: e.target.value })} />
              </Field>
              <Field label="X">
                <input className="input max-w-xs" placeholder="https://x.com/" value={f.x || ''} onChange={(e) => set({ x: e.target.value })} />
              </Field>
              <Field label="Skype Name/Number">
                <input className="input max-w-xs" value={f.skype || ''} onChange={(e) => set({ skype: e.target.value })} />
              </Field>
              <Field label="Facebook">
                <input className="input max-w-xs" placeholder="http://www.facebook.com/" value={f.facebook || ''} onChange={(e) => set({ facebook: e.target.value })} />
              </Field>
            </div>
          )}
          {tab === 'address' && (
            <div className="grid gap-10 md:grid-cols-2">
              <AddressForm title="Billing Address" value={f.billingAddress || {}} onChange={(a) => set({ billingAddress: a })} />
              <AddressForm title="Shipping Address" value={f.shippingAddress || {}} onChange={(a) => set({ shippingAddress: a })} onCopy={() => set({ shippingAddress: { ...f.billingAddress } })} />
            </div>
          )}
          {tab === 'persons' && (
            <div>
              <table className="table border border-slate-200">
                <thead>
                  <tr>
                    <th>Salutation</th>
                    <th>First Name</th>
                    <th>Last Name</th>
                    <th>Email Address</th>
                    <th>Work Phone</th>
                    <th>Mobile</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(f.contactPersons || []).map((p, i) => {
                    const up = (patch: object) => set({ contactPersons: f.contactPersons!.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                    return (
                      <tr key={p.id || i}>
                        <td>
                          <Select value={p.salutation || ''} onChange={(e) => up({ salutation: e.target.value })} placeholder="" options={SALUTATIONS.map((s) => ({ value: s, label: s }))} />
                        </td>
                        <td>
                          <input className="input" value={p.firstName || ''} onChange={(e) => up({ firstName: e.target.value })} />
                        </td>
                        <td>
                          <input className="input" value={p.lastName || ''} onChange={(e) => up({ lastName: e.target.value })} />
                        </td>
                        <td>
                          <input className="input" value={p.email || ''} onChange={(e) => up({ email: e.target.value })} />
                        </td>
                        <td>
                          <input className="input" value={p.workPhone || ''} onChange={(e) => up({ workPhone: e.target.value })} />
                        </td>
                        <td>
                          <input className="input" value={p.mobile || ''} onChange={(e) => up({ mobile: e.target.value })} />
                        </td>
                        <td>
                          <button className="mt-2 text-slate-400 hover:text-red-500" onClick={() => set({ contactPersons: f.contactPersons!.filter((_, j) => j !== i) })} aria-label="Remove">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <button className="btn-secondary btn-sm mt-2 text-brand-700" onClick={() => set({ contactPersons: [...(f.contactPersons || []), { id: '' }] })}>
                <Plus size={13} /> Add Contact Person
              </button>
            </div>
          )}
          {tab === 'bank' && (
            <div className="max-w-3xl space-y-4">
              {(f.bankDetails || []).map((b, i) => {
                const up = (patch: object) => set({ bankDetails: f.bankDetails!.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                return (
                  <div key={b.id || i} className="space-y-2.5 rounded-md border border-slate-200 p-4">
                    <div className="flex justify-between font-semibold">
                      Bank {i + 1}
                      <button className="text-slate-400 hover:text-red-500" onClick={() => set({ bankDetails: f.bankDetails!.filter((_, j) => j !== i) })} aria-label="Remove bank">
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <Field label="Account Holder Name">
                      <input className="input" value={b.accountHolderName || ''} onChange={(e) => up({ accountHolderName: e.target.value })} />
                    </Field>
                    <Field label="Bank Name">
                      <input className="input" value={b.bankName || ''} onChange={(e) => up({ bankName: e.target.value })} />
                    </Field>
                    <Field label="Account Number" required>
                      <input className="input" value={b.accountNumber || ''} onChange={(e) => up({ accountNumber: e.target.value })} />
                    </Field>
                    <Field label="IFSC" required>
                      <input className="input uppercase" value={b.ifsc || ''} onChange={(e) => up({ ifsc: e.target.value.toUpperCase() })} />
                    </Field>
                  </div>
                );
              })}
              <button className="btn-secondary btn-sm text-brand-700" onClick={() => set({ bankDetails: [...(f.bankDetails || []), { id: '' }] })}>
                <Plus size={13} /> Add Bank Account
              </button>
            </div>
          )}
          {tab === 'custom' && <KeyValueEditor value={f.customFields || {}} onChange={(v) => set({ customFields: v })} hint="Add custom fields such as GST treatment, region or client code." />}
          {tab === 'tags' && <KeyValueEditor value={f.reportingTags || {}} onChange={(v) => set({ reportingTags: v })} hint="Reporting tags let you segment reports, e.g. Region = South." />}
          {tab === 'remarks' && (
            <Field label="Remarks" inline={false} className="max-w-3xl">
              <textarea className="input" rows={4} value={f.remarks || ''} onChange={(e) => set({ remarks: e.target.value })} placeholder="For internal use" />
            </Field>
          )}
        </div>
      </div>
      <FormFooter>
        <button className="btn-primary" onClick={save} disabled={saving}>
          Save
        </button>
        <button className="btn-secondary" onClick={() => navigate(-1)}>
          Cancel
        </button>
        <span className="ml-auto flex items-center gap-1 text-xxs text-slate-400">
          <Phone size={11} /> Phone numbers default to +91
        </span>
      </FormFooter>
    </div>
  );
}

function KeyValueEditor({ value, onChange, hint }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void; hint: string }) {
  const entries = Object.entries(value);
  const [k, setK] = useState('');
  const [v, setV] = useState('');
  return (
    <div className="max-w-2xl space-y-2">
      <div className="text-xs text-slate-500">{hint}</div>
      {entries.map(([key, val]) => (
        <div key={key} className="flex items-center gap-2">
          <input className="input w-48" value={key} readOnly />
          <input className="input flex-1" value={val} onChange={(e) => onChange({ ...value, [key]: e.target.value })} />
          <button className="text-slate-400 hover:text-red-500" aria-label="Remove" onClick={() => onChange(Object.fromEntries(entries.filter(([x]) => x !== key)))}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <input className="input w-48" placeholder="Field / Tag" value={k} onChange={(e) => setK(e.target.value)} />
        <input className="input flex-1" placeholder="Value" value={v} onChange={(e) => setV(e.target.value)} />
        <button
          className="btn-secondary btn-sm"
          onClick={() => {
            if (!k.trim()) return;
            onChange({ ...value, [k.trim()]: v });
            setK('');
            setV('');
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}
