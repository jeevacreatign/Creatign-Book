// Banking module routes.
import { Route, Routes } from 'react-router-dom';
import Overview from './Overview';
import AccountForm from './AccountForm';
import AccountDetail from './AccountDetail';
import ImportStatement from './ImportStatement';
import { ReconcileHistory, ReconcileView } from './Reconcile';
import { RuleForm, RulesList } from './Rules';

export default function Banking() {
  return (
    <Routes>
      <Route index element={<Overview />} />
      <Route path="new" element={<AccountForm />} />
      <Route path="import" element={<ImportStatement />} />
      <Route path="rules" element={<RulesList />} />
      <Route path="rules/new" element={<RuleForm />} />
      <Route path="rules/:ruleId/edit" element={<RuleForm />} />
      <Route path=":id" element={<AccountDetail />} />
      <Route path=":id/edit" element={<AccountForm />} />
      <Route path=":id/import" element={<ImportStatement />} />
      <Route path=":id/reconcile" element={<ReconcileHistory />} />
      <Route path=":id/reconcile/:recId" element={<ReconcileView />} />
    </Routes>
  );
}
