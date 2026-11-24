// Bank rules: recognize or categorize imported statement lines automatically.
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Plus, Trash2, Wand2, X } from 'lucide-react';
import { BANK_TXN_TYPES, bankTxnLabel } from '@shared/accountant';
import type { BankRule, BankTxnType, RuleCriterion } from '@shared/types';
import { api, qs, useAction, useApi } from '../../api';
import { useBoot } from '../../lib/app';
import { AccountSelect, Field, FormFooter, Radio, Spinner, useConfirm } from '../../components/ui';
import { ListHeader } from '../../components/split';
import { AnyContactPicker } from '../accountant/common';
import { offsetFilter, offsetLabel, type BankAccountRow } from './common';

type RuleRow = BankRule & { offsetAccountName?: string; contactName?: string; matches: number };

const FIELD_OPTS: { value: RuleCriterion['field']; label: string }[] = [
  { value: 'description', label: 'Description' },
  { value: 'reference', label: 'Reference Number' },
  { value: 'payee', label: 'Payee' },
  { value: 'amount', label: 'Amount' },
];
const TEXT_OPS: { value: RuleCriterion['op']; label: string }[] = [
  { value: 'contains', label: 'Contains' },
  { value: 'not_contains', label: 'Does not contain' },
  { value: 'equals', label: 'Is' },
  { value: 'starts_with', label: 'Starts with' },
  { value: 'ends_with', label: 'Ends with' },
];
const AMOUNT_OPS: { value: RuleCriterion['op']; label: string }[] = [
  { value: 'eq', label: 'Is' },
  { value: 'gt', label: 'Greater than' },
  { value: 'lt', label: 'Less than' },
];

export function RulesList() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const accountId = search.get('accountId') || '';
  const { data = [], isLoading } = useApi<RuleRow[]>(`/banking/rules${qs({ accountId })}`);
  const { data: accounts = [] } = useApi<BankAccountRow[]>('/banking/accounts');
  const reorder = useAction((ids: string[]) => api('/banking/rules/reorder', { body: { ids } }));
  const del = useAction((id: string) => api(`/banking/rules/${id}`, { method: 'DELETE' }), 'Rule deleted');
  const confirm = useConfirm();
  const move = (i: number, d: number) => {
    const ids = data.map((r) => r.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder.mutate(ids);
  };
  return (
    <div>
      <ListHeader
        title={
          <div>
            <div className="text-xs text-slate-500">Banking</div>
            <h1 className="text-[19px]">Transaction Rules</h1>
          </div>
        }
      >
        <select className="input w-auto" value={accountId} onChange={(e) => navigate(`/banking/rules${qs({ accountId: e.target.value })}`)} aria-label="Account">
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <button className="btn-primary" onClick={() => navigate('/banking/rules/new')}>
          <Plus size={15} /> New Rule
        </button>
        <button className="btn-ghost w-8 px-0" onClick={() => navigate('/banking')} aria-label="Close">
          <X size={18} />
        </button>
      </ListHeader>
      <div className="mx-5 mt-4 rounded-md bg-slate-50 px-4 py-3 text-[13px] text-slate-600">
        Rules run in the order below when you import a statement. The first rule that matches a line wins. <b>Recognize</b> rules suggest a category for you to confirm; <b>Categorize</b> rules record the transaction straight away.
      </div>
      {isLoading ? (
        <Spinner />
      ) : (
        <table className="table mt-3">
          <thead>
            <tr>
              <th className="w-16 pl-5">Order</th>
              <th>Rule Name</th>
              <th>Applies To</th>
              <th>Criteria</th>
              <th>Record As</th>
              <th>Mode</th>
              <th className="text-right">Lines</th>
              <th className="w-10 pr-5" />
            </tr>
          </thead>
          <tbody>
            {data.map((r, i) => (
              <tr key={r.id} className="row-link" onClick={() => navigate(`/banking/rules/${r.id}/edit`)}>
                <td className="pl-5" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-0.5 text-slate-400">
                    <button className="hover:text-brand-600 disabled:opacity-30" disabled={i === 0 || !!accountId} onClick={() => move(i, -1)} aria-label="Move up">
                      <ArrowUp size={14} />
                    </button>
                    <button className="hover:text-brand-600 disabled:opacity-30" disabled={i === data.length - 1 || !!accountId} onClick={() => move(i, 1)} aria-label="Move down">
                      <ArrowDown size={14} />
                    </button>
                  </div>
                </td>
                <td className="font-medium text-brand-700">{r.name}</td>
                <td className="capitalize">{r.applyTo}</td>
                <td className="max-w-[260px] text-xs text-slate-600">
                  {r.criteria.map((c, k) => (
                    <span key={k}>
                      {k > 0 && <b className="mx-1 uppercase text-slate-400">{r.match === 'all' ? 'and' : 'or'}</b>}
                      {FIELD_OPTS.find((f) => f.value === c.field)?.label} {[...TEXT_OPS, ...AMOUNT_OPS].find((o) => o.value === c.op)?.label.toLowerCase()} "{c.value}"
                    </span>
                  ))}
                </td>
                <td>
                  {bankTxnLabel(r.recordAs)}
                  <div className="text-xs text-slate-500">{r.offsetAccountName}</div>
                </td>
                <td>
                  <span className={r.markAs === 'categorized' ? 'rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700' : 'rounded bg-violet-50 px-1.5 py-0.5 text-xs text-violet-700'}>{r.markAs === 'categorized' ? 'Categorize' : 'Recognize'}</span>
                </td>
                <td className="text-right tabular-nums">{r.matches}</td>
                <td className="pr-5" onClick={(e) => e.stopPropagation()}>
                  <button className="text-slate-400 hover:text-red-600" onClick={() => confirm.ask('Delete rule', `Delete the rule "${r.name}"? Transactions it already categorized stay as they are.`, () => del.mutate(r.id), { danger: true, label: 'Delete' })} aria-label="Delete rule">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {!data.length && (
              <tr>
                <td colSpan={8} className="py-16 text-center text-slate-500">
                  <Wand2 className="mx-auto mb-2 text-violet-400" size={26} />
                  No rules yet. Create one for transactions you see every month, like bank charges, rent or salaries.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {confirm.node}
    </div>
  );
}

export function RuleForm() {
  const { ruleId } = useParams();
  const navigate = useNavigate();
  const { accounts } = useBoot();
  const { data: banks = [] } = useApi<BankAccountRow[]>('/banking/accounts');
  const { data: existing, isLoading } = useApi<BankRule>(ruleId ? `/banking/rules/${ruleId}` : null);
  const [f, setF] = useState<Omit<BankRule, 'id' | 'createdAt' | 'order'>>({ name: '', applyTo: 'withdrawals', markAs: 'recognized', match: 'all', criteria: [{ field: 'description', op: 'contains', value: '' }], recordAs: 'expense', offsetAccountId: '', contactId: '', referenceFrom: 'none', accountIds: [], scope: 'all' });
  useEffect(() => {
    if (existing) setF({ ...existing, contactId: existing.contactId || '' });
  }, [existing]);
  const save = useAction(() => (ruleId ? api(`/banking/rules/${ruleId}`, { method: 'PUT', body: f }) : api('/banking/rules', { body: f })), 'Rule saved');
  if (ruleId && isLoading) return <Spinner />;
  const types = BANK_TXN_TYPES.filter((t) => (t.direction === 'in') === (f.applyTo === 'deposits'));
  const setCrit = (i: number, c: Partial<RuleCriterion>) => setF({ ...f, criteria: f.criteria.map((x, k) => (k === i ? { ...x, ...c } : x)) });
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <h1 className="text-[19px]">{ruleId ? 'Edit Rule' : 'New Rule'}</h1>
        <button className="btn-ghost w-8 px-0" onClick={() => navigate(-1)} aria-label="Close">
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 space-y-6 px-5 py-5">
        <div className="max-w-2xl space-y-3">
          <Field label="Rule Name" required>
            <input className="input max-w-[340px]" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Apply this rule to">
            <Radio
              name="scope"
              value={f.scope}
              onChange={(v) => setF({ ...f, scope: v })}
              options={[
                { value: 'all', label: 'All accounts' },
                { value: 'banks', label: 'Bank accounts' },
                { value: 'cards', label: 'Credit cards' },
                { value: 'custom', label: 'Selected accounts' },
              ]}
            />
          </Field>
          {f.scope === 'custom' && (
            <Field label="Accounts" required>
              <div className="flex max-w-md flex-wrap gap-x-4 gap-y-1 pt-1.5">
                {banks.map((a) => (
                  <label key={a.id} className="inline-flex items-center gap-1.5 text-[13px]">
                    <input type="checkbox" className="accent-brand-600" checked={f.accountIds.includes(a.id)} onChange={(e) => setF({ ...f, accountIds: e.target.checked ? [...f.accountIds, a.id] : f.accountIds.filter((x) => x !== a.id) })} />
                    {a.name}
                  </label>
                ))}
              </div>
            </Field>
          )}
          <Field label="Transactions">
            <Radio
              name="applyTo"
              value={f.applyTo}
              onChange={(v) => setF({ ...f, applyTo: v, recordAs: (v === 'deposits' ? 'deposit' : 'expense') as BankTxnType, offsetAccountId: '' })}
              options={[
                { value: 'withdrawals', label: 'Withdrawals' },
                { value: 'deposits', label: 'Deposits' },
              ]}
            />
          </Field>
        </div>

        <div className="max-w-3xl rounded-md border border-slate-200">
          <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-[13px]">
            If
            <select className="input h-7 w-auto" value={f.match} onChange={(e) => setF({ ...f, match: e.target.value as 'all' | 'any' })}>
              <option value="all">all</option>
              <option value="any">any</option>
            </select>
            of these conditions are met
          </div>
          <div className="space-y-2 p-4">
            {f.criteria.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <select className="input w-44" value={c.field} onChange={(e) => setCrit(i, { field: e.target.value as RuleCriterion['field'], op: e.target.value === 'amount' ? 'eq' : 'contains' })}>
                  {FIELD_OPTS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <select className="input w-44" value={c.op} onChange={(e) => setCrit(i, { op: e.target.value as RuleCriterion['op'] })}>
                  {(c.field === 'amount' ? AMOUNT_OPS : TEXT_OPS).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <input className="input flex-1" type={c.field === 'amount' ? 'number' : 'text'} value={c.value} onChange={(e) => setCrit(i, { value: e.target.value })} />
                <button className="text-slate-400 hover:text-red-600 disabled:opacity-30" disabled={f.criteria.length === 1} onClick={() => setF({ ...f, criteria: f.criteria.filter((_, k) => k !== i) })} aria-label="Remove condition">
                  <X size={15} />
                </button>
              </div>
            ))}
            <button className="link text-[13px]" onClick={() => setF({ ...f, criteria: [...f.criteria, { field: 'description', op: 'contains', value: '' }] })}>
              + Add Condition
            </button>
          </div>
        </div>

        <div className="max-w-2xl space-y-3">
          <div className="font-semibold">Then</div>
          <Field label="Record As" required>
            <select className="input max-w-[340px]" value={f.recordAs} onChange={(e) => setF({ ...f, recordAs: e.target.value as BankTxnType, offsetAccountId: '' })}>
              {types.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label={f.recordAs === 'expense' ? 'Expense Account' : offsetLabel(f.recordAs)} required>
            <AccountSelect className="max-w-[340px]" accounts={accounts} value={f.offsetAccountId} onChange={(v) => setF({ ...f, offsetAccountId: v })} filter={offsetFilter(f.recordAs, '')} />
          </Field>
          <Field label="Contact">
            <AnyContactPicker className="max-w-[340px]" value={f.contactId} onChange={(v) => setF({ ...f, contactId: v })} />
          </Field>
          <Field label="Reference#">
            <select className="input max-w-[340px]" value={f.referenceFrom} onChange={(e) => setF({ ...f, referenceFrom: e.target.value as BankRule['referenceFrom'] })}>
              <option value="none">Leave blank</option>
              <option value="reference">From the statement reference</option>
              <option value="description">From the statement description</option>
            </select>
          </Field>
          <Field label="When matched">
            <Radio
              name="markAs"
              value={f.markAs}
              onChange={(v) => setF({ ...f, markAs: v })}
              options={[
                { value: 'recognized', label: 'Recognize (suggest, I confirm)' },
                { value: 'categorized', label: 'Categorize automatically' },
              ]}
            />
          </Field>
        </div>
      </div>
      <FormFooter>
        <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => navigate('/banking/rules') })}>
          Save
        </button>
        <button className="btn-secondary" onClick={() => navigate(-1)}>
          Cancel
        </button>
      </FormFooter>
    </div>
  );
}
