// Public page for a shared link: /share/:token (no sign-in needed).
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { LinkIcon, ShieldCheck } from 'lucide-react';
import { DOC_META } from '@shared/docmeta';
import { capi, useCustomer } from './api';
import { CustomerDocument, OrgBrand, type CustomerDocPayload } from './CustomerDocument';

export default function SharePage() {
  const { token } = useParams();
  const qc = useQueryClient();
  const url = `/public/share/${token}`;
  const { data, error, isLoading } = useCustomer<CustomerDocPayload>(url, { staleTime: Infinity });
  const refresh = () => qc.invalidateQueries({ queryKey: ['customer', url] });
  return (
    <div className="min-h-full bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          {data ? <OrgBrand org={data.organization} sub={`${DOC_META[data.doc.kind].label} for ${data.doc.contactName}`} /> : <div className="h-9" />}
          {data && (
            <a href="/portal" className="hidden text-[13px] text-brand-700 hover:underline sm:block">
              Sign in to {data.portalName}
            </a>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {isLoading && <div className="py-24 text-center text-slate-400">Loading…</div>}
        {error && (
          <div className="mx-auto mt-16 max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <LinkIcon className="mx-auto mb-3 text-slate-300" size={28} />
            <div className="font-semibold text-slate-900">Link unavailable</div>
            <div className="mt-1 text-[13px] text-slate-600">{(error as Error).message}</div>
          </div>
        )}
        {data && (
          <CustomerDocument
            data={data}
            pdfUrl={`/api/public/share/${token}/pdf`}
            onRespond={async (b) => {
              await capi(`/public/share/${token}/respond`, { body: b });
              refresh();
            }}
            onNotify={async (b) => {
              await capi(`/public/share/${token}/payment-notice`, { body: b });
              refresh();
            }}
          />
        )}
      </main>
      <footer className="mx-auto flex max-w-6xl items-center justify-center gap-1.5 px-4 pb-8 text-xxs text-slate-400">
        <ShieldCheck size={12} /> Shared securely with Creatign Ledger
      </footer>
    </div>
  );
}
