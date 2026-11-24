import { createContext, useContext, type ReactNode } from 'react';
import type { Account, Organization } from '@shared/types';
import type { PdfTemplate } from '@shared/pdfTemplate';
import { useApi } from '../api';

export interface Bootstrap {
  organization: Organization;
  accounts: Account[];
  /** approvals turned on per module (Settings > Approvals) */
  approvals: Record<string, boolean>;
  /** PDF templates (Settings > Templates, Customize on a transaction) */
  pdfTemplates: PdfTemplate[];
  preferences: Record<string, unknown> & { salespersons?: string[]; challanTypes?: string[]; deliveryMethods?: string[]; invoiceTerms?: string; customerNotes?: string; quoteNotes?: string; mileageRatePerKm?: number };
}

const Ctx = createContext<Bootstrap | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const { data, error } = useApi<Bootstrap>('/bootstrap');
  if (error) return <div className="p-10 text-red-600">Could not reach the Creatign Books API. Is the server running on port 4000? ({(error as Error).message})</div>;
  if (!data) return <div className="flex h-full items-center justify-center text-slate-400">Loading Creatign Books…</div>;
  return <Ctx.Provider value={data}>{children}</Ctx.Provider>;
}

export function useBoot() {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppProvider missing');
  return v;
}

export const useOrg = () => useBoot().organization;
export const useAccounts = () => useBoot().accounts;

export function accountsWhere(accounts: Account[], pred: (a: Account) => boolean) {
  return accounts.filter((a) => a.active && pred(a));
}

export const isCashLike = (a: Account) => a.subType === 'cash' || a.subType === 'bank' || a.subType === 'credit_card';
export const isIncome = (a: Account) => a.type === 'income';
export const isExpenseLike = (a: Account) => a.type === 'expense';
