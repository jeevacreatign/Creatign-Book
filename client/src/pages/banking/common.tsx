// Shared types and the money in / money out form used across the Banking pages.
import { useEffect, useState } from 'react';
import { BANK_TXN_TYPES, isBankingAccount } from '@shared/accountant';
import { today } from '@shared/format';
import type { Account, BankTransaction, BankTxnType } from '@shared/types';
import { api, useAction, useApi } from '../../api';
import { useBoot } from '../../lib/app';
import { AccountSelect, DateInput, Field, Modal, MoneyInput } from '../../components/ui';
import { AnyContactPicker } from '../accountant/common';
import { sourceLink } from '../accountant/ChartOfAccounts';

export interface BankAccountRow {
  id: string;
  name: string;
  code?: string;
  subType: string;
  type: string;
  accountNumber?: string;
  bankName?: string;
  ifsc?: string;
  currencyCode: string;
  description?: string;
  primary?: boolean;
  active?: boolean;
  system?: boolean;
  booksBalance: number;
  statementBalance?: number;
  uncategorized: number;
  lastImport?: string;
  lastReconciled?: string;
}

export interface BookEntry {
  journalId: string;
  date: string;
  sourceType: string;
  sourceId?: string;
  number: string;
  type: string;
  reference?: string;
  description?: string;
  contactId?: string;
  contact?: string;
  deposit: number;
  withdrawal: number;
  balance?: number;
  reconciled: boolean;
  statementLineId?: string;
}

/** Filter for the "other side" account of a money in / out type. */
export function offsetFilter(type: BankTxnType, accountId: string): (a: Account) => boolean {
  const info = BANK_TXN_TYPES.find((t) => t.value === type);
  switch (info?.offset) {
    case 'bank':
      return (a) => isBankingAccount(a) && a.id !== accountId;
    case 'card':
      return (a) => a.subType === 'credit_card' && a.id !== accountId;
    case 'equity':
      return (a) => a.type === 'equity';
    case 'income':
      return (a) => a.type === 'income';
    case 'expense':
      return (a) => a.type === 'expense';
    default:
      return (a) => a.id !== accountId;
  }
}

export function offsetLabel(type: BankTxnType) {
  const info = BANK_TXN_TYPES.find((t) => t.value === type);
  if (info?.offset === 'bank') return info.direction === 'in' ? 'From Account' : 'To Account';
  if (info?.offset === 'card') return 'Credit Card';
  return info?.direction === 'in' ? 'Received Via' : 'Paid Via';
}

/** Where a ledger entry links to. */
export const entryLink = (e: { sourceType: string; sourceId?: string; journalId: string }) => sourceLink(e.sourceType, e.sourceId, e.journalId);

/** Add / edit a Money In or Money Out transaction (transfers, deposits, owner's contribution, drawings...). */
export function BankTxnModal({ accountId, type: initialType, existing, onClose }: { accountId: string; type: BankTxnType; existing?: BankTransaction; onClose: () => void }) {
  const { accounts } = useBoot();
  const [f, setF] = useState({ type: initialType, date: today(), offsetAccountId: '', amount: '' as number | string, referenceNumber: '', description: '', contactId: '' });
  useEffect(() => {
    if (existing) setF({ type: existing.type, date: existing.date, offsetAccountId: existing.offsetAccountId, amount: existing.amount, referenceNumber: existing.referenceNumber || '', description: existing.description || '', contactId: existing.contactId || '' });
  }, [existing]);
  const info = BANK_TXN_TYPES.find((t) => t.value === f.type)!;
  const save = useAction(() => (existing ? api(`/banking/transactions/${existing.id}`, { method: 'PUT', body: f }) : api('/banking/transactions', { body: { ...f, accountId } })), 'Transaction saved');
  const sameDir = BANK_TXN_TYPES.filter((t) => t.direction === info.direction && t.value !== 'expense');
  return (
    <Modal
      open
      onClose={onClose}
      title={`${existing ? 'Edit' : 'Add'} ${info.direction === 'in' ? 'Money In' : 'Money Out'}: ${info.label}`}
      width="max-w-xl"
      footer={
        <>
          <button className="btn-primary" onClick={() => save.mutate(undefined, { onSuccess: onClose })} disabled={save.isPending}>
            Save
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Transaction Type">
          <select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as BankTxnType, offsetAccountId: '' })}>
            {sameDir.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={offsetLabel(f.type)} required>
          <AccountSelect accounts={accounts} value={f.offsetAccountId} onChange={(v) => setF({ ...f, offsetAccountId: v })} filter={offsetFilter(f.type, accountId)} />
        </Field>
        <Field label="Date" required>
          <DateInput value={f.date} onChange={(v) => setF({ ...f, date: v })} />
        </Field>
        <Field label="Amount" required>
          <MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
        </Field>
        {(f.type === 'deposit' || f.type === 'other_income' || f.type === 'expense_refund' || f.type === 'interest_income') && (
          <Field label="Contact">
            <AnyContactPicker value={f.contactId} onChange={(v) => setF({ ...f, contactId: v })} />
          </Field>
        )}
        <Field label="Reference#">
          <input className="input" value={f.referenceNumber} onChange={(e) => setF({ ...f, referenceNumber: e.target.value })} />
        </Field>
        <Field label="Description">
          <textarea className="input" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

/** Loads a bank transaction then opens the edit modal. */
export function EditBankTxn({ id, onClose }: { id: string; onClose: () => void }) {
  const { data } = useApi<BankTransaction>(`/banking/transactions/${id}`);
  if (!data) return null;
  return <BankTxnModal accountId={data.accountId} type={data.type} existing={data} onClose={onClose} />;
}
