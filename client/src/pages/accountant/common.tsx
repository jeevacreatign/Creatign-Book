// Shared Accountant widgets: contact picker over customers and vendors, account type picker,
// the journal lines editor (Account / Description / Contact / Debits / Credits).
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { ACCOUNT_TYPES } from '@shared/accountant';
import { money } from '@shared/format';
import type { Account, Contact, JournalLine } from '@shared/types';
import { useApi } from '../../api';
import { AccountSelect, Combo, clsx } from '../../components/ui';

export function AnyContactPicker({ value, onChange, placeholder = 'Select Contact', className }: { value?: string; onChange: (id: string) => void; placeholder?: string; className?: string }) {
  const { data = [] } = useApi<Contact[]>('/contacts?status=all');
  return <Combo className={className} value={value} onChange={onChange} placeholder={placeholder} options={data.map((c) => ({ value: c.id, label: c.displayName, sub: c.kind === 'customer' ? 'Customer' : 'Vendor' }))} />;
}

export function AccountTypeSelect({ value, onChange, disabled }: { value?: string; onChange: (v: Account['subType']) => void; disabled?: boolean }) {
  const groups = ['Asset', 'Liability', 'Equity', 'Income', 'Expense'] as const;
  return (
    <select className="input" value={value || ''} disabled={disabled} onChange={(e) => onChange(e.target.value as Account['subType'])}>
      <option value="" disabled>
        Select an account type
      </option>
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {ACCOUNT_TYPES.filter((t) => t.group === g).map((t) => (
            <option key={t.subType} value={t.subType}>
              {t.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export type DraftLine = Partial<Omit<JournalLine, 'debit' | 'credit'>> & { debit?: number | string; credit?: number | string };

export const lineTotals = (lines: DraftLine[]) => {
  const dr = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const cr = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  return { dr, cr, diff: Math.round((dr - cr) * 100) / 100 };
};

/** Account | Description | Contact (INR) | Debits | Credits, with the Zoho totals box underneath. */
export function JournalLinesEditor({ accounts, lines, onChange }: { accounts: Account[]; lines: DraftLine[]; onChange: (l: DraftLine[]) => void }) {
  const t = lineTotals(lines);
  const up = (i: number, p: Partial<DraftLine>) => onChange(lines.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <div className="max-w-5xl">
      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="table min-w-[760px]">
          <thead>
            <tr>
              <th className="w-6 px-1" />
              <th className="min-w-[200px]">Account</th>
              <th className="min-w-[180px]">Description</th>
              <th className="min-w-[160px]">Contact (INR)</th>
              <th className="w-32 text-right">Debits</th>
              <th className="w-32 text-right">Credits</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="px-1 pt-4 text-slate-300">
                  <GripVertical size={13} />
                </td>
                <td>
                  <AccountSelect accounts={accounts} value={l.accountId} onChange={(v) => up(i, { accountId: v })} />
                </td>
                <td>
                  <textarea className="input min-h-[32px]" rows={1} placeholder="Description" value={l.description || ''} onChange={(e) => up(i, { description: e.target.value })} />
                </td>
                <td>
                  <AnyContactPicker value={l.contactId} onChange={(v) => up(i, { contactId: v || undefined })} />
                </td>
                <td>
                  <input inputMode="decimal" className="input text-right tabular-nums" aria-label={`Debit line ${i + 1}`} value={l.debit ?? ''} onChange={(e) => up(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} />
                </td>
                <td>
                  <input inputMode="decimal" className="input text-right tabular-nums" aria-label={`Credit line ${i + 1}`} value={l.credit ?? ''} onChange={(e) => up(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} />
                </td>
                <td>
                  <button type="button" className="mt-2 text-slate-400 hover:text-red-500 disabled:opacity-30" disabled={lines.length <= 2} onClick={() => onChange(lines.filter((_, j) => j !== i))} aria-label="Remove row">
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <button type="button" className="btn-secondary btn-sm text-brand-700" onClick={() => onChange([...lines, {}])}>
          <Plus size={13} /> Add New Row
        </button>
        <div className="w-full max-w-md rounded-lg bg-slate-50 px-5 py-4 text-[13px]">
          <div className="grid grid-cols-[1fr_110px_110px] gap-y-2">
            <span className="text-slate-600">Sub Total</span>
            <span className="text-right tabular-nums">{money(t.dr, '')}</span>
            <span className="text-right tabular-nums">{money(t.cr, '')}</span>
            <span className="text-[15px] font-semibold">Total (₹)</span>
            <span className="text-right text-[15px] font-semibold tabular-nums">{money(t.dr, '')}</span>
            <span className="text-right text-[15px] font-semibold tabular-nums">{money(t.cr, '')}</span>
            <span className={clsx(t.diff ? 'text-red-600' : 'text-slate-500')}>Difference</span>
            <span />
            <span className={clsx('text-right tabular-nums', t.diff ? 'text-red-600' : 'text-slate-500')}>{money(Math.abs(t.diff), '')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
