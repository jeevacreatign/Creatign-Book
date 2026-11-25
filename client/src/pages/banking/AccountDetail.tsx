// One bank / cash / card account: uncategorized statement lines, categorized lines, excluded lines and
// every transaction in the books, with the categorize / match panel.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, ChevronDown, Plus, Upload, Wand2, X } from 'lucide-react';
import { BANK_TXN_TYPES } from '@shared/accountant';
import { fmtDate, money } from '@shared/format';
import type { BankRule, BankTxnType, StatementLine } from '@shared/types';
import { api, qs, useAction, useApi } from '../../api';
import { useBoot } from '../../lib/app';
import { toast } from '../../lib/toast';
import { AccountSelect, ContactPicker, Drawer, Dropdown, Field, MenuItem, SearchBox, Spinner, Status, Tabs, clsx, useConfirm } from '../../components/ui';
import { DetailHeader, MoreMenu, TabStrip, useSelection } from '../../components/split';
import { AccountIcon, subTypeLabel } from './Overview';
import { BankTxnModal, EditBankTxn, entryLink, offsetFilter, offsetLabel, type BankAccountRow, type BookEntry } from './common';

type Line = StatementLine & { ruleName?: string };
type Tab = 'uncategorized' | 'categorized' | 'excluded' | 'all';

const MONEY_OUT: { value: string; label: string }[] = [
  { value: 'expense', label: 'Expense' },
  { value: 'vendor_payment', label: 'Vendor Payment' },
  { value: 'transfer_out', label: 'Transfer To Another Account' },
  { value: 'card_payment', label: 'Card Payment' },
  { value: 'owner_drawings', label: 'Owner Drawings' },
];
const MONEY_IN: { value: string; label: string }[] = [
  { value: 'customer_payment', label: 'Customer Payment' },
  { value: 'deposit', label: 'Deposit' },
  { value: 'transfer_in', label: 'Transfer From Another Account' },
  { value: 'owner_contribution', label: "Owner's Contribution" },
  { value: 'other_income', label: 'Other Income' },
  { value: 'interest_income', label: 'Interest Income' },
  { value: 'expense_refund', label: 'Expense Refund' },
];

export default function AccountDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: acc, isLoading } = useApi<BankAccountRow & { imports: { id: string; fileName: string; lines: number; duplicates: number; from?: string; to?: string; createdAt: string }[] }>(`/banking/accounts/${id}`);
  const [tab, setTab] = useState<Tab>('uncategorized');
  const [adding, setAdding] = useState<BankTxnType | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    if (acc && !acc.uncategorized && tab === 'uncategorized') setTab('all');
    // only on first load of an account
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acc?.id]);
  if (isLoading || !acc) return <Spinner />;

  const addTxn = (v: string) => {
    if (v === 'expense') navigate(`/purchases/expenses/new${qs({ paidThrough: id })}`);
    else if (v === 'vendor_payment') navigate('/purchases/payments-made/new');
    else if (v === 'customer_payment') navigate('/sales/payments-received/new');
    else setAdding(v as BankTxnType);
  };

  return (
    <div className="flex min-h-full flex-col">
      <DetailHeader
        kicker={
          <span className="flex items-center gap-1.5">
            <AccountIcon subType={acc.subType} size={13} />
            {subTypeLabel(acc.subType)}
            {acc.accountNumber && <span>· xx{acc.accountNumber.slice(-4)}</span>}
          </span>
        }
        title={acc.name}
      >
        <Dropdown
          align="right"
          button={() => (
            <button className="btn-primary">
              <Plus size={15} /> Add Transaction <ChevronDown size={14} />
            </button>
          )}
        >
          <div className="px-3 pb-1 pt-2 text-xxs font-semibold uppercase tracking-wide text-slate-400">Money Out</div>
          {MONEY_OUT.map((t) => (
            <MenuItem key={t.value} onClick={() => addTxn(t.value)}>
              {t.label}
            </MenuItem>
          ))}
          <div className="border-t border-slate-100 px-3 pb-1 pt-2 text-xxs font-semibold uppercase tracking-wide text-slate-400">Money In</div>
          {MONEY_IN.map((t) => (
            <MenuItem key={t.value} onClick={() => addTxn(t.value)}>
              {t.label}
            </MenuItem>
          ))}
        </Dropdown>
        <button className="btn-secondary" onClick={() => navigate(`/banking/${id}/import`)}>
          <Upload size={14} /> Import Statement
        </button>
        <MoreMenu>
          <MenuItem onClick={() => navigate(`/banking/${id}/reconcile`)}>Reconcile Account</MenuItem>
          <MenuItem onClick={() => navigate(`/banking/rules${qs({ accountId: id })}`)}>Manage Rules</MenuItem>
          <MenuItem onClick={() => navigate(`/banking/${id}/edit`)}>Edit Account</MenuItem>
          <MenuItem onClick={() => navigate(`/reports/account-transactions${qs({ accountId: id, period: 'this_fiscal_year' })}`)}>View Account Transactions</MenuItem>
        </MoreMenu>
        <button className="btn-ghost w-8 px-0 text-red-500" onClick={() => navigate('/banking')} aria-label="Close">
          <X size={18} />
        </button>
      </DetailHeader>

      <div className="grid grid-cols-2 gap-px border-b border-slate-200 bg-slate-200 md:grid-cols-4">
        <Stat label="Amount in Bank" value={acc.statementBalance == null ? '-' : money(acc.statementBalance)} hint={acc.statementBalance != null ? `Per statement imported ${fmtDate(acc.lastImport?.slice(0, 10))}` : acc.lastImport ? 'Map the Balance column on import to see it' : 'Import a statement to compare'} />
        <Stat label="Amount in Creatign Books" value={money(acc.booksBalance)} />
        <Stat label="Uncategorized" value={String(acc.uncategorized)} tone={acc.uncategorized ? 'text-amber-700' : undefined} />
        <Stat label="Reconciled Through" value={acc.lastReconciled ? fmtDate(acc.lastReconciled) : 'Never'} action={<Link className="link text-xs" to={`/banking/${id}/reconcile`}>Reconcile</Link>} />
      </div>

      <div className="px-5 pt-3">
        <TabStrip<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'uncategorized', label: `Uncategorized Transactions${acc.uncategorized ? ` (${acc.uncategorized})` : ''}` },
            { value: 'categorized', label: 'Categorized' },
            { value: 'excluded', label: 'Excluded' },
            { value: 'all', label: 'All Transactions' },
          ]}
        />
      </div>
      <div className="flex-1 px-5 pb-8 pt-3">
        {tab === 'all' ? <BooksTab accountId={id} /> : <LinesTab accountId={id} status={tab} onOpen={setOpen} />}
      </div>
      {adding && <BankTxnModal accountId={id} type={adding} onClose={() => setAdding(null)} />}
      {open && <CategorizeDrawer lineId={open} accountId={id} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Stat({ label, value, hint, tone, action }: { label: string; value: string; hint?: string; tone?: string; action?: React.ReactNode }) {
  return (
    <div className="bg-white px-5 py-3">
      <div className="flex items-center justify-between text-xs text-slate-500">
        {label}
        {action}
      </div>
      <div className={clsx('mt-0.5 text-[17px] font-semibold tabular-nums', tone)}>{value}</div>
      {hint && <div className="text-xxs text-slate-400">{hint}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ statement lines

function LinesTab({ accountId, status, onOpen }: { accountId: string; status: Exclude<Tab, 'all'>; onOpen: (id: string) => void }) {
  const navigate = useNavigate();
  const { data = [], isLoading } = useApi<Line[]>(`/banking/accounts/${accountId}/statement-lines${qs({ status: status === 'categorized' ? 'all' : status })}`);
  const rows = status === 'categorized' ? data.filter((l) => l.status === 'categorized' || l.status === 'matched') : data;
  const sel = useSelection(rows.map((r) => r.id));
  const bulk = useAction((action: string) => api<{ done: number; errors: string[] }>('/banking/statement-lines-bulk', { body: { ids: sel.selected, action } }), (r) => {
    if (r.errors.length) toast.error(r.errors[0]);
    return r.done ? `${r.done} transaction${r.done === 1 ? '' : 's'} updated` : undefined;
  });
  const one = useAction((v: { id: string; action: string }) => api(`/banking/statement-lines/${v.id}/${v.action}`, { body: {} }), 'Transaction updated');
  const confirm = useConfirm();
  if (isLoading) return <Spinner />;
  if (!rows.length)
    return (
      <div className="rounded-md border border-dashed border-slate-300 py-14 text-center text-slate-500">
        {status === 'uncategorized' ? (
          <>
            <CheckCircle2 className="mx-auto mb-2 text-emerald-500" size={28} />
            All caught up. <button className="link" onClick={() => navigate(`/banking/${accountId}/import`)}>Import a statement</button> to bring in new bank transactions.
          </>
        ) : status === 'excluded' ? (
          'Excluded transactions show here. Exclude duplicates or lines that should not be recorded.'
        ) : (
          'Statement lines you categorize or match show here.'
        )}
      </div>
    );
  return (
    <div>
      {sel.selected.length > 0 && (
        <div className="mb-2 flex items-center gap-2 rounded-md bg-brand-50 px-3 py-2 text-[13px]">
          <span className="font-medium">{sel.selected.length} selected</span>
          {status === 'uncategorized' && (
            <>
              <button className="btn-secondary h-7" onClick={() => bulk.mutate('apply-rule', { onSuccess: sel.clear })}>
                <Wand2 size={13} /> Apply Rules
              </button>
              <button className="btn-secondary h-7" onClick={() => bulk.mutate('exclude', { onSuccess: sel.clear })}>
                Exclude
              </button>
            </>
          )}
          {status === 'excluded' && (
            <button className="btn-secondary h-7" onClick={() => bulk.mutate('restore', { onSuccess: sel.clear })}>
              Restore
            </button>
          )}
          {status === 'categorized' && (
            <button className="btn-secondary h-7" onClick={() => bulk.mutate('uncategorize', { onSuccess: sel.clear })}>
              Uncategorize
            </button>
          )}
          {status !== 'categorized' && (
            <button className="btn-secondary h-7 text-red-600" onClick={() => confirm.ask('Delete transactions', 'Delete the selected statement lines? This does not change your books.', () => bulk.mutate('delete', { onSuccess: sel.clear }), { danger: true, label: 'Delete' })}>
              Delete
            </button>
          )}
          <button className="ml-auto text-slate-500 hover:text-slate-700" onClick={sel.clear} aria-label="Clear selection">
            <X size={15} />
          </button>
        </div>
      )}
      <table className="table rounded-md border border-slate-200">
        <thead>
          <tr>
            <th className="w-8 pl-3">
              <input type="checkbox" className="accent-brand-600" checked={sel.all} onChange={sel.toggleAll} aria-label="Select all" />
            </th>
            <th>Date</th>
            <th>Statement Details</th>
            {status === 'categorized' ? <th>Status</th> : <th>Suggestion</th>}
            <th className="text-right">Deposits</th>
            <th className="pr-4 text-right">Withdrawals</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id} className="row-link" onClick={() => (status === 'uncategorized' ? onOpen(l.id) : status === 'categorized' ? onOpen(l.id) : undefined)}>
              <td className="pl-3" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" className="accent-brand-600" checked={sel.selected.includes(l.id)} onChange={() => sel.toggle(l.id)} aria-label="Select" />
              </td>
              <td className="whitespace-nowrap">{fmtDate(l.date)}</td>
              <td>
                <div className="font-medium text-slate-800">{l.description || l.payee || '-'}</div>
                {(l.reference || l.payee) && <div className="text-xs text-slate-500">{[l.payee && l.description ? l.payee : '', l.reference && `Ref# ${l.reference}`].filter(Boolean).join(' · ')}</div>}
              </td>
              <td>
                {status === 'categorized' ? (
                  <div className="flex items-center gap-2">
                    <Status status={l.status} />
                    <button
                      className="link text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        one.mutate({ id: l.id, action: 'uncategorize' });
                      }}
                    >
                      {l.status === 'matched' ? 'Unmatch' : 'Uncategorize'}
                    </button>
                  </div>
                ) : status === 'excluded' ? (
                  <button
                    className="link text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      one.mutate({ id: l.id, action: 'restore' });
                    }}
                  >
                    Restore
                  </button>
                ) : l.ruleName ? (
                  <span className="inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-xs text-violet-700">
                    <Wand2 size={11} /> {l.ruleName}
                  </span>
                ) : (
                  <span className="text-xs text-slate-400">Categorize or match</span>
                )}
              </td>
              <td className="text-right tabular-nums">{l.deposit ? money(l.deposit) : ''}</td>
              <td className="pr-4 text-right tabular-nums">{l.withdrawal ? money(l.withdrawal) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {confirm.node}
    </div>
  );
}

// ------------------------------------------------------------------ books

function BooksTab({ accountId }: { accountId: string }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState('all');
  const [edit, setEdit] = useState<string | null>(null);
  const { data = [], isLoading } = useApi<BookEntry[]>(`/banking/accounts/${accountId}/transactions${qs({ search, period })}`);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="w-64">
          <SearchBox value={search} onChange={setSearch} placeholder="Search transactions" />
        </div>
        <select className="input w-auto" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period">
          <option value="all">All dates</option>
          <option value="this_month">This Month</option>
          <option value="previous_month">Previous Month</option>
          <option value="this_quarter">This Quarter</option>
          <option value="this_fiscal_year">This Fiscal Year</option>
          <option value="previous_fiscal_year">Previous Fiscal Year</option>
        </select>
      </div>
      {isLoading ? (
        <Spinner />
      ) : (
        <table className="table rounded-md border border-slate-200">
          <thead>
            <tr>
              <th className="pl-4">Date</th>
              <th>Reference#</th>
              <th>Type</th>
              <th>Status</th>
              <th className="text-right">Deposits</th>
              <th className="text-right">Withdrawals</th>
              <th className="pr-4 text-right">Running Balance</th>
            </tr>
          </thead>
          <tbody>
            {data.map((e) => (
              <tr key={e.journalId} className="row-link" onClick={() => (e.sourceType === 'bank_transaction' && e.sourceId ? setEdit(e.sourceId) : navigate(entryLink(e)))}>
                <td className="whitespace-nowrap pl-4">{fmtDate(e.date)}</td>
                <td>
                  <div className="font-medium text-brand-700">{e.number || e.reference || '-'}</div>
                  {(e.contact || e.description) && <div className="max-w-[320px] truncate text-xs text-slate-500">{[e.contact, e.description].filter(Boolean).join(' · ')}</div>}
                </td>
                <td>{e.type}</td>
                <td>{e.reconciled ? <Status status="reconciled" /> : e.statementLineId ? <Status status="matched" /> : <span className="text-xs text-slate-500">Manually Added</span>}</td>
                <td className="text-right tabular-nums">{e.deposit ? money(e.deposit) : ''}</td>
                <td className="text-right tabular-nums">{e.withdrawal ? money(e.withdrawal) : ''}</td>
                <td className="pr-4 text-right tabular-nums">{money(e.balance)}</td>
              </tr>
            ))}
            {!data.length && (
              <tr>
                <td colSpan={7} className="py-14 text-center text-slate-500">
                  No transactions{search ? ' match your search' : ' in this account yet'}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {edit && <EditBankTxn id={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------ categorize / match

type LineDetail = Line & {
  rule?: BankRule;
  ruleSuggestion?: { as: string; offsetAccountId?: string; contactId?: string; referenceNumber?: string };
  suggestions: (BookEntry & { days: number })[];
  matched?: BookEntry;
};

function CategorizeDrawer({ lineId, accountId, onClose }: { lineId: string; accountId: string; onClose: () => void }) {
  const { data: l } = useApi<LineDetail>(`/banking/statement-lines/${lineId}`);
  const [mode, setMode] = useState<'match' | 'categorize'>('match');
  useEffect(() => {
    if (l && !l.suggestions.length) setMode('categorize');
  }, [l?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = useAction((a: string) => api(`/banking/statement-lines/${lineId}/${a}`, { body: {} }), 'Transaction updated');
  if (!l) return null;
  const inflow = l.deposit > 0;
  const amount = l.deposit || l.withdrawal;
  return (
    <Drawer open onClose={onClose} title={l.status === 'uncategorized' ? 'Categorize Transaction' : 'Bank Transaction'} width="max-w-2xl">
      <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs text-slate-500">{fmtDate(l.date)}</div>
            <div className="font-medium">{l.description || l.payee || 'Bank transaction'}</div>
            {l.reference && <div className="text-xs text-slate-500">Ref# {l.reference}</div>}
          </div>
          <div className="text-right">
            <div className={clsx('text-lg font-semibold tabular-nums', inflow ? 'text-emerald-700' : 'text-slate-800')}>{money(amount)}</div>
            <div className="text-xxs uppercase tracking-wide text-slate-500">{inflow ? 'Deposit' : 'Withdrawal'}</div>
          </div>
        </div>
      </div>

      {l.status !== 'uncategorized' ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Status status={l.status} />
            {l.matched && (
              <span className="text-[13px] text-slate-600">
                {l.matched.type} <Link className="link" to={entryLink(l.matched)} onClick={onClose}>{l.matched.number || l.matched.reference || 'View'}</Link>
                {l.matched.contact && ` · ${l.matched.contact}`}
              </span>
            )}
          </div>
          {l.status !== 'excluded' && (
            <button className="btn-secondary" onClick={() => act.mutate('uncategorize', { onSuccess: onClose })}>
              {l.status === 'matched' ? 'Unmatch' : 'Uncategorize'}
            </button>
          )}
          {l.status === 'categorized' && <p className="text-xs text-slate-500">Uncategorizing deletes the transaction that was created from this statement line.</p>}
        </div>
      ) : (
        <>
          {l.rule && l.ruleSuggestion && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-violet-200 bg-violet-50 px-4 py-2.5 text-[13px]">
              <span className="flex items-center gap-2 text-violet-800">
                <Wand2 size={14} /> Rule <b>{l.rule.name}</b> suggests {BANK_TXN_TYPES.find((t) => t.value === l.ruleSuggestion?.as)?.label ?? l.ruleSuggestion.as}.
              </span>
              <button className="btn-primary h-7" onClick={() => act.mutate('apply-rule', { onSuccess: onClose })}>
                Apply
              </button>
            </div>
          )}
          <Tabs
            value={mode}
            onChange={setMode}
            tabs={[
              { value: 'match', label: `Match Transactions${l.suggestions.length ? ` (${l.suggestions.length})` : ''}` },
              { value: 'categorize', label: 'Categorize Manually' },
            ]}
          />
          <div className="pt-4">{mode === 'match' ? <MatchPane line={l} onDone={onClose} /> : <CategorizePane line={l} accountId={accountId} onDone={onClose} />}</div>
          <div className="mt-6 flex gap-4 border-t border-slate-100 pt-3 text-[13px]">
            <button className="link" onClick={() => act.mutate('exclude', { onSuccess: onClose })}>
              Exclude this transaction
            </button>
          </div>
        </>
      )}
    </Drawer>
  );
}

function MatchPane({ line, onDone }: { line: LineDetail; onDone: () => void }) {
  const [pick, setPick] = useState(line.suggestions[0]?.journalId ?? '');
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(!line.suggestions.length);
  const { data: found = [] } = useApi<BookEntry[]>(searching ? `/banking/statement-lines/${line.id}/search${qs({ search })}` : null);
  const match = useAction(() => api(`/banking/statement-lines/${line.id}/match`, { body: { journalId: pick } }), 'Transaction matched');
  const list: BookEntry[] = searching ? found : line.suggestions;
  const amount = line.deposit || line.withdrawal;
  const picked = list.find((x) => x.journalId === pick);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[13px] font-medium text-slate-700">{searching ? 'Search other transactions in this account' : 'Best matches (same amount, within 30 days)'}</div>
        <button className="link text-[13px]" onClick={() => setSearching(!searching)}>
          {searching ? 'Show best matches' : 'Search other transactions'}
        </button>
      </div>
      {searching && (
        <div className="mb-2">
          <SearchBox value={search} onChange={setSearch} placeholder="Reference, contact or description" />
        </div>
      )}
      <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
        {list.map((e) => (
          <label key={e.journalId} className={clsx('flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-slate-50', pick === e.journalId && 'bg-brand-50/60')}>
            <input type="radio" name="match" className="accent-brand-600" checked={pick === e.journalId} onChange={() => setPick(e.journalId)} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">
                {e.type} {e.number && <span className="text-brand-700">{e.number}</span>}
              </div>
              <div className="truncate text-xs text-slate-500">{[fmtDate(e.date), e.contact, e.reference && `Ref# ${e.reference}`].filter(Boolean).join(' · ')}</div>
            </div>
            <div className="text-right text-[13px] font-medium tabular-nums">{money(e.deposit || e.withdrawal)}</div>
          </label>
        ))}
        {!list.length && <div className="px-3 py-8 text-center text-[13px] text-slate-500">{searching ? 'No unmatched transactions found.' : 'No transactions with the same amount. Search other transactions or categorize it manually.'}</div>}
      </div>
      {picked && Math.abs((picked.deposit || picked.withdrawal) - amount) > 0.004 && <div className="mt-2 text-xs text-red-600">The amounts must be the same to match. Difference {money((picked.deposit || picked.withdrawal) - amount)}.</div>}
      <div className="mt-4">
        <button className="btn-primary" disabled={!picked || match.isPending} onClick={() => match.mutate(undefined, { onSuccess: onDone })}>
          Match
        </button>
      </div>
    </div>
  );
}

interface OpenDoc {
  id: string;
  number: string;
  date: string;
  dueDate?: string;
  total: number;
  balance: number;
}

function CategorizePane({ line, accountId, onDone }: { line: LineDetail; accountId: string; onDone: () => void }) {
  const { accounts } = useBoot();
  const inflow = line.deposit > 0;
  const amount = line.deposit || line.withdrawal;
  const opts = inflow ? MONEY_IN : MONEY_OUT;
  const [f, setF] = useState({ as: line.ruleSuggestion?.as ?? opts[0].value, offsetAccountId: line.ruleSuggestion?.offsetAccountId ?? '', contactId: line.ruleSuggestion?.contactId ?? '', referenceNumber: line.ruleSuggestion?.referenceNumber ?? line.reference ?? '', description: line.description ?? '' });
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const isPayment = f.as === 'customer_payment' || f.as === 'vendor_payment';
  const docKind = f.as === 'customer_payment' ? 'invoice' : 'bill';
  const { data: docsData } = useApi<OpenDoc[]>(isPayment && f.contactId ? `/docs${qs({ kind: docKind, contactId: f.contactId, status: 'unpaid' })}` : null);
  const docs = useMemo(() => docsData ?? [], [docsData]);
  useEffect(() => {
    // fill the oldest documents first, like Zoho's auto-apply
    let left = amount;
    const next: Record<string, string> = {};
    for (const d of docs.slice().sort((a, b) => a.date.localeCompare(b.date))) {
      const a = Math.min(left, d.balance);
      if (a > 0) next[d.id] = String(Math.round(a * 100) / 100);
      left -= a;
    }
    setAlloc(next);
  }, [docs, amount]);
  const used = useMemo(() => Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0), [alloc]);
  const save = useAction(
    () =>
      api(`/banking/statement-lines/${line.id}/categorize`, {
        body: { ...f, allocations: isPayment ? Object.entries(alloc).map(([docId, a]) => ({ docId, amount: Number(a) || 0 })) : undefined },
      }),
    'Transaction categorized',
  );
  const txType = f.as as BankTxnType;
  return (
    <div className="space-y-3">
      <Field label="Category" required>
        <select className="input" value={f.as} onChange={(e) => setF({ ...f, as: e.target.value, offsetAccountId: '', contactId: '' })}>
          {opts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      {isPayment ? (
        <Field label={f.as === 'customer_payment' ? 'Customer' : 'Vendor'} required>
          <ContactPicker kind={f.as === 'customer_payment' ? 'customer' : 'vendor'} value={f.contactId} onChange={(v) => setF({ ...f, contactId: v })} />
        </Field>
      ) : (
        <>
          <Field label={f.as === 'expense' ? 'Expense Account' : offsetLabel(txType)} required>
            <AccountSelect accounts={accounts} value={f.offsetAccountId} onChange={(v) => setF({ ...f, offsetAccountId: v })} filter={offsetFilter(txType, accountId)} />
          </Field>
          {(f.as === 'expense' || f.as === 'deposit' || f.as === 'other_income' || f.as === 'expense_refund') && (
            <Field label={f.as === 'expense' ? 'Vendor' : 'Contact'}>
              {f.as === 'expense' ? <ContactPicker kind="vendor" value={f.contactId} onChange={(v) => setF({ ...f, contactId: v })} /> : <ContactPicker kind="customer" value={f.contactId} onChange={(v) => setF({ ...f, contactId: v })} />}
            </Field>
          )}
        </>
      )}
      <Field label="Reference#">
        <input className="input" value={f.referenceNumber} onChange={(e) => setF({ ...f, referenceNumber: e.target.value })} />
      </Field>
      <Field label="Description">
        <textarea className="input" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </Field>
      {isPayment && f.contactId && (
        <div>
          <div className="mb-1 text-[13px] font-medium">{f.as === 'customer_payment' ? 'Unpaid Invoices' : 'Unpaid Bills'}</div>
          <table className="table rounded-md border border-slate-200">
            <thead>
              <tr>
                <th>Date</th>
                <th>{f.as === 'customer_payment' ? 'Invoice#' : 'Bill#'}</th>
                <th className="text-right">Balance Due</th>
                <th className="w-36 text-right">Payment</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td>{fmtDate(d.date)}</td>
                  <td>{d.number}</td>
                  <td className="text-right tabular-nums">{money(d.balance)}</td>
                  <td className="text-right">
                    <input className="input h-7 text-right" type="number" min="0" step="0.01" value={alloc[d.id] ?? ''} onChange={(e) => setAlloc({ ...alloc, [d.id]: e.target.value })} />
                  </td>
                </tr>
              ))}
              {!docs.length && (
                <tr>
                  <td colSpan={4} className="py-5 text-center text-[13px] text-slate-500">
                    Nothing unpaid. The full amount is recorded as {f.as === 'customer_payment' ? 'an excess payment' : 'a vendor advance'}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {docs.length > 0 && (
            <div className="mt-1 text-right text-xs text-slate-500">
              Applied {money(used)} of {money(amount)}
              {amount - used > 0.004 && ` · ${money(amount - used)} kept as ${f.as === 'customer_payment' ? 'excess payment' : 'vendor advance'}`}
            </div>
          )}
        </div>
      )}
      <div className="pt-2">
        <button className="btn-primary" disabled={save.isPending || used > amount + 0.004} onClick={() => save.mutate(undefined, { onSuccess: onDone })}>
          Save
        </button>
      </div>
    </div>
  );
}

