// Accountant module routes.
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { X } from 'lucide-react';
import type { Journal } from '@shared/types';
import { fmtDate } from '@shared/format';
import { useApi } from '../../api';
import { Spinner } from '../../components/ui';
import { JournalTable } from '../../components/shared';
import ManualJournals from './ManualJournals';
import RecurringJournals from './RecurringJournals';
import ChartOfAccounts, { sourceLink } from './ChartOfAccounts';
import Budgets from './Budgets';
import { BulkUpdate, CurrencyAdjustments, TransactionLocking } from './Tools';

/** Read-only view of any ledger journal (system journals created by transactions). */
function JournalView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: j } = useApi<Journal>(`/journals/${id}`);
  if (!j) return <Spinner />;
  if (j.sourceType === 'manual') return <Navigate to={`/accountant/manual-journals/${j.id}`} replace />;
  return (
    <div className="max-w-4xl px-5 py-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-xs text-slate-500">{fmtDate(j.date)}</div>
          <h1 className="text-lg">Journal {j.number}</h1>
        </div>
        <div className="flex gap-2">
          {j.sourceId && (
            <Link className="btn-secondary" to={sourceLink(j.sourceType, j.sourceId, j.id)}>
              View source transaction
            </Link>
          )}
          <button className="btn-ghost w-8 px-0" onClick={() => navigate(-1)} aria-label="Close">
            <X size={18} />
          </button>
        </div>
      </div>
      {j.notes && <div className="mb-4 text-[13px] text-slate-600">{j.notes}</div>}
      <JournalTable journals={[j]} />
    </div>
  );
}

export default function Accountant() {
  return (
    <Routes>
      <Route path="manual-journals/*" element={<ManualJournals />} />
      <Route path="recurring-journals/*" element={<RecurringJournals />} />
      <Route path="journals/:id" element={<JournalView />} />
      <Route path="bulk-update" element={<BulkUpdate />} />
      <Route path="currency-adjustments" element={<CurrencyAdjustments />} />
      <Route path="chart-of-accounts/*" element={<ChartOfAccounts />} />
      <Route path="budgets/*" element={<Budgets />} />
      <Route path="transaction-locking" element={<TransactionLocking />} />
      <Route path="*" element={<Navigate to="/accountant/manual-journals" replace />} />
    </Routes>
  );
}
