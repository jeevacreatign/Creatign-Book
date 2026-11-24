import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import type { DocKind } from '@shared/types';
import Layout from './components/Layout';
import { AppProvider } from './lib/app';
import { Toaster } from './lib/toast';
import Home from './pages/Home';
import Items from './pages/items/Items';
import Contacts from './pages/contacts/Contacts';
import DocModule from './pages/docs/DocModule';
import PaymentsReceived from './pages/payments/PaymentsReceived';
import PaymentsMade from './pages/payments/PaymentsMade';
import Expenses, { RecurringExpenses } from './pages/expenses/Expenses';
import { Reports } from './pages/misc/Accounting';
import Banking from './pages/banking';
import Accountant from './pages/accountant';
import { AppPlaceholder, Documents, PrintDoc, PrintExpense, PrintPayment, PrintStatement, Settings } from './pages/misc/Other';
import TimeTracking from './pages/time';
import SharePage from './customer/SharePage';
import PortalApp from './customer/Portal';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false } } });

const DOC_ROUTES: [string, DocKind][] = [
  ['sales/quotes', 'quote'],
  ['sales/sales-orders', 'sales_order'],
  ['sales/invoices', 'invoice'],
  ['sales/recurring-invoices', 'recurring_invoice'],
  ['sales/delivery-challans', 'delivery_challan'],
  ['sales/credit-notes', 'credit_note'],
  ['purchases/purchase-orders', 'purchase_order'],
  ['purchases/bills', 'bill'],
  ['purchases/recurring-bills', 'recurring_bill'],
  ['purchases/vendor-credits', 'vendor_credit'],
];

/** Remount document forms when the query string changes (e.g. ?from=...). */
function Keyed({ kind }: { kind: DocKind }) {
  const { search } = useLocation();
  return <DocModule key={`${kind}${search.includes('from=') ? search : ''}`} kind={kind} />;
}

/** Customer-facing pages (shared links, customer portal) never load the staff app. */
function Root() {
  return (
    <Routes>
      <Route path="/share/:token" element={<SharePage />} />
      <Route path="/portal/*" element={<PortalApp />} />
      <Route
        path="*"
        element={
          <AppProvider>
            <App />
          </AppProvider>
        }
      />
    </Routes>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/print/doc/:id" element={<PrintDoc />} />
      <Route path="/print/payment/:id" element={<PrintPayment />} />
      <Route path="/print/payment-made/:id" element={<PrintPayment made />} />
      <Route path="/print/statement/:id" element={<PrintStatement />} />
      <Route path="/print/expense/:id" element={<PrintExpense />} />
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="items/*" element={<Items />} />
        <Route path="sales" element={<Navigate to="/sales/customers" replace />} />
        <Route path="purchases" element={<Navigate to="/purchases/vendors" replace />} />
        <Route path="sales/customers/*" element={<Contacts key="customer" kind="customer" />} />
        <Route path="purchases/vendors/*" element={<Contacts key="vendor" kind="vendor" />} />
        {DOC_ROUTES.map(([path, kind]) => (
          <Route key={path} path={`${path}/*`} element={<Keyed kind={kind} />} />
        ))}
        <Route path="sales/payments-received/*" element={<PaymentsReceived />} />
        <Route path="purchases/payments-made/*" element={<PaymentsMade />} />
        <Route path="purchases/expenses/*" element={<Expenses />} />
        <Route path="purchases/recurring-expenses/*" element={<RecurringExpenses />} />
        <Route path="time-tracking/*" element={<TimeTracking />} />
        <Route path="banking/*" element={<Banking />} />
        <Route path="accountant/*" element={<Accountant />} />
        <Route path="reports/*" element={<Reports />} />
        <Route path="documents" element={<Documents />} />
        <Route path="settings/*" element={<Settings />} />
        <Route path="apps/payroll" element={<AppPlaceholder app="payroll" />} />
        <Route path="apps/payments" element={<AppPlaceholder app="payments" />} />
        <Route path="*" element={<div className="p-10 text-slate-500">Page not found.</div>} />
      </Route>
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Root />
        <Toaster />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
