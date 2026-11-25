// Add / edit a bank or credit card account.
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CreditCard, Landmark, X } from 'lucide-react';
import type { Account } from '@shared/types';
import { api, useAction, useApi } from '../../api';
import { Checkbox, Field, FormFooter, Spinner, clsx } from '../../components/ui';

type Kind = 'bank' | 'credit_card';

export default function AccountForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: existing, isLoading } = useApi<Account>(id ? `/accounts/${id}` : null);
  const { data: currencies = [] } = useApi<{ code: string; name: string }[]>('/currencies');
  const [f, setF] = useState({ subType: 'bank' as Account['subType'], name: '', code: '', currencyCode: 'INR', accountNumber: '', bankName: '', ifsc: '', description: '', primary: false });
  useEffect(() => {
    if (existing) setF({ subType: existing.subType, name: existing.name, code: existing.code || '', currencyCode: existing.currencyCode || 'INR', accountNumber: existing.accountNumber || '', bankName: existing.bankName || '', ifsc: existing.ifsc || '', description: existing.description || '', primary: !!existing.primary });
  }, [existing]);
  const save = useAction(() => api<Account>(id ? `/accounts/${id}` : '/accounts', { method: id ? 'PUT' : 'POST', body: { ...f, ifsc: f.ifsc.toUpperCase() } }), id ? 'Account updated' : 'Account created');
  if (id && isLoading) return <Spinner />;
  const isCard = f.subType === 'credit_card';
  const showKind = !existing || existing.subType === 'bank' || existing.subType === 'credit_card';
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <h1 className="text-[19px]">{id ? 'Edit Account' : 'Add Bank or Credit Card'}</h1>
        <button className="btn-ghost w-8 px-0" onClick={() => navigate(-1)} aria-label="Close">
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 px-5 py-5">
        <div className="max-w-2xl space-y-3">
          {showKind && (
            <Field label="Select Account Type" required>
              <div className="flex gap-3">
                {(
                  [
                    ['bank', 'Bank', <Landmark key="b" size={16} />],
                    ['credit_card', 'Credit Card', <CreditCard key="c" size={16} />],
                  ] as [Kind, string, React.ReactNode][]
                ).map(([v, label, icon]) => (
                  <button key={v} type="button" disabled={!!existing && existing.system} onClick={() => setF({ ...f, subType: v })} className={clsx('flex items-center gap-2 rounded-md border px-4 py-2 text-[13px]', f.subType === v ? 'border-brand-500 bg-brand-50 text-brand-700 ring-1 ring-brand-200' : 'border-slate-300 text-slate-600 hover:border-slate-400')}>
                    {icon}
                    {label}
                  </button>
                ))}
              </div>
            </Field>
          )}
          <Field label="Account Name" required>
            <input className="input max-w-[340px]" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Account Code">
            <input className="input max-w-[340px]" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
          </Field>
          <Field label="Currency" required>
            <select className="input max-w-[340px]" value={f.currencyCode} onChange={(e) => setF({ ...f, currencyCode: e.target.value })}>
              {(currencies.length ? currencies : [{ code: 'INR', name: 'Indian Rupee' }]).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} - {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={isCard ? 'Card Number (last 4 digits)' : 'Account Number'}>
            <input className="input max-w-[340px]" value={f.accountNumber} onChange={(e) => setF({ ...f, accountNumber: e.target.value })} />
          </Field>
          <Field label="Bank Name">
            <input className="input max-w-[340px]" value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} />
          </Field>
          {!isCard && (
            <Field label="IFSC">
              <input className="input max-w-[340px] uppercase" maxLength={11} value={f.ifsc} onChange={(e) => setF({ ...f, ifsc: e.target.value })} placeholder="e.g. HDFC0001234" />
            </Field>
          )}
          <Field label="Description">
            <textarea className="input max-w-[340px]" rows={3} maxLength={500} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </Field>
          {!isCard && (
            <Field label="">
              <Checkbox checked={f.primary} onChange={(v) => setF({ ...f, primary: v })} label="Make this primary" />
            </Field>
          )}
        </div>
      </div>
      <FormFooter>
        <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: (a) => navigate(`/banking/${a.id}`, { replace: true }) })}>
          Save
        </button>
        <button className="btn-secondary" onClick={() => navigate(-1)}>
          Cancel
        </button>
      </FormFooter>
    </div>
  );
}
