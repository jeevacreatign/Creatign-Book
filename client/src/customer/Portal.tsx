// Customer portal at /portal: sign-in, invitations, password reset, and the signed-in
// area (dashboard, quotes, sales orders, invoices, credit notes, payments, statement, profile).
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, ChevronRight, CreditCard, Download, FileCheck2, FileText, Home, KeyRound, LogOut, Menu, Package, Receipt, ScrollText, User, Wallet, X } from 'lucide-react';
import { DOC_META } from '@shared/docmeta';
import { fmtDate, money, today } from '@shared/format';
import type { Contact, DocKind, Organization } from '@shared/types';
import { clsx } from '../components/ui';
import { toast } from '../lib/toast';
import { CustomerApiError, capi, useCustomer } from './api';
import { CustomerDocument, OrgBrand, StatusChip, type CustomerDocPayload } from './CustomerDocument';

interface Info {
  enabled: boolean;
  name: string;
  organization: Pick<Organization, 'name' | 'logo' | 'email' | 'phone' | 'website'>;
}
interface Me {
  user: { id: string; email: string; name: string; lastLoginAt?: string };
  contact: Contact;
  organization: Organization;
  settings: { name: string; bannerMessage?: string; allowQuoteAcceptance: boolean; allowStatements: boolean; allowPaymentNotices: boolean };
  summary: Summary;
}
interface Summary {
  outstanding: number;
  unusedCredits: number;
  overdue: number;
  overdueCount: number;
  unpaidCount: number;
  openQuotes: number;
}
interface Row {
  id: string;
  kind: DocKind;
  number: string;
  date: string;
  dueDate?: string;
  expiryDate?: string;
  referenceNumber?: string;
  status: string;
  total: number;
  balance: number;
}

const KIND_PATHS: { path: string; kind: DocKind; icon: ReactNode }[] = [
  { path: 'quotes', kind: 'quote', icon: <FileCheck2 size={16} /> },
  { path: 'sales-orders', kind: 'sales_order', icon: <Package size={16} /> },
  { path: 'invoices', kind: 'invoice', icon: <FileText size={16} /> },
  { path: 'credit-notes', kind: 'credit_note', icon: <Receipt size={16} /> },
];

export default function PortalApp() {
  return (
    <Routes>
      <Route path="login" element={<Login />} />
      <Route path="forgot" element={<Forgot />} />
      <Route path="reset/:token" element={<SetPassword mode="reset" />} />
      <Route path="invite/:token" element={<SetPassword mode="invite" />} />
      <Route path="*" element={<SignedIn />} />
    </Routes>
  );
}

// ================================================================== auth screens

function AuthCard({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  const { data: info } = useCustomer<Info>('/portal/info', { staleTime: Infinity });
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 px-4 py-12">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex justify-center">{info && <OrgBrand org={info.organization} sub={info.name} />}</div>
        <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
          {sub && <p className="mt-1 text-[13px] text-slate-600">{sub}</p>}
          <div className="mt-5">{children}</div>
        </div>
        {info && !info.enabled && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-center text-xs text-amber-800">The portal is currently turned off. Contact {info.organization.name} for help.</div>}
        {info?.organization.email && <p className="mt-6 text-center text-xs text-slate-500">Need help? Email {info.organization.email}</p>}
      </div>
    </div>
  );
}

function Input({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-slate-700">{label}</span>
      <input className="input h-10 text-sm" {...props} />
    </label>
  );
}

function ErrorNote({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">
      <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {text}
    </div>
  );
}

function Login() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(undefined);
    try {
      await capi('/portal/login', { body: { email, password } });
      await qc.invalidateQueries({ queryKey: ['customer'] });
      const next = search.get('next');
      navigate(next && next.startsWith('/portal') ? next : '/portal', { replace: true });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthCard title="Sign in" sub="View your quotes, invoices, payments and statement.">
      <form className="space-y-4" onSubmit={submit}>
        <ErrorNote text={err} />
        <Input label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        <Input label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="btn-primary h-10 w-full text-sm" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <div className="text-center">
          <Link to="/portal/forgot" className="text-[13px] text-brand-700 hover:underline">
            Forgot your password?
          </Link>
        </div>
      </form>
    </AuthCard>
  );
}

function Forgot() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(undefined);
    try {
      await capi('/portal/forgot', { body: { email } });
      setSent(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthCard title="Reset your password" sub={sent ? undefined : 'Enter the email address you use for the portal and we will send you a reset link.'}>
      {sent ? (
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[13px] text-emerald-800">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> If {email} has a portal account, a reset link is on its way. It expires in 2 hours.
          </div>
          <Link to="/portal/login" className="btn-secondary h-10 w-full">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          <ErrorNote text={err} />
          <Input label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          <button className="btn-primary h-10 w-full text-sm" disabled={busy}>
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
          <div className="text-center">
            <Link to="/portal/login" className="text-[13px] text-brand-700 hover:underline">
              Back to sign in
            </Link>
          </div>
        </form>
      )}
    </AuthCard>
  );
}

function passwordIssues(p: string) {
  const out = [];
  if (p.length < 8) out.push('at least 8 characters');
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) out.push('letters and a number');
  return out;
}

function SetPassword({ mode }: { mode: 'invite' | 'reset' }) {
  const { token } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, error } = useCustomer<{ email: string; name?: string; organization?: string; portalName?: string }>(`/portal/${mode}/${token}`);
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data?.name) setName(data.name);
  }, [data?.name]);
  const issues = passwordIssues(pw);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (issues.length) return setErr(`Use ${issues.join(' and ')}.`);
    if (pw !== pw2) return setErr('The passwords do not match.');
    setBusy(true);
    setErr(undefined);
    try {
      await capi(`/portal/${mode}/${token}`, { body: { password: pw, name } });
      await qc.invalidateQueries({ queryKey: ['customer'] });
      toast.success(mode === 'invite' ? 'Welcome! Your account is ready.' : 'Your password has been changed.');
      navigate('/portal', { replace: true });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (error)
    return (
      <AuthCard title={mode === 'invite' ? 'Invitation unavailable' : 'Link unavailable'}>
        <ErrorNote text={(error as Error).message} />
        <Link to={mode === 'invite' ? '/portal/login' : '/portal/forgot'} className="btn-secondary mt-4 h-10 w-full">
          {mode === 'invite' ? 'Go to sign in' : 'Request a new link'}
        </Link>
      </AuthCard>
    );
  return (
    <AuthCard title={mode === 'invite' ? 'Accept your invitation' : 'Choose a new password'} sub={data ? (mode === 'invite' ? `${data.organization} invited ${data.email} to the ${data.portalName}. Set a password to finish.` : `For ${data.email}`) : undefined}>
      <form className="space-y-4" onSubmit={submit}>
        <ErrorNote text={err} />
        {mode === 'invite' && <Input label="Your name" required value={name} onChange={(e) => setName(e.target.value)} />}
        <div>
          <Input label="Password" type="password" autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} autoFocus={mode === 'reset'} />
          <div className={clsx('mt-1 text-xxs', pw && !issues.length ? 'text-emerald-600' : 'text-slate-500')}>{pw && !issues.length ? 'Looks good.' : 'At least 8 characters, with letters and a number.'}</div>
        </div>
        <Input label="Confirm password" type="password" autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} />
        <button className="btn-primary h-10 w-full text-sm" disabled={busy || !data}>
          {busy ? 'Saving…' : mode === 'invite' ? 'Create account' : 'Save password'}
        </button>
      </form>
    </AuthCard>
  );
}

// ================================================================== signed-in area

function SignedIn() {
  const location = useLocation();
  const { data: me, error, isLoading } = useCustomer<Me>('/portal/me');
  const [menu, setMenu] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  useEffect(() => setMenu(false), [location.pathname]);
  if (isLoading) return <div className="flex h-full items-center justify-center text-slate-400">Loading…</div>;
  if (error) {
    if ((error as CustomerApiError).status === 401) return <Navigate to={`/portal/login?next=${encodeURIComponent(location.pathname)}`} replace />;
    return (
      <AuthCard title="Portal unavailable">
        <ErrorNote text={(error as Error).message} />
      </AuthCard>
    );
  }
  if (!me) return null;
  async function logout() {
    await capi('/portal/logout', { body: {} }).catch(() => undefined);
    qc.removeQueries({ queryKey: ['customer'] });
    navigate('/portal/login', { replace: true });
  }
  const nav = [
    { to: '/portal', label: 'Home', icon: <Home size={16} />, end: true },
    ...KIND_PATHS.map((k) => ({ to: `/portal/${k.path}`, label: DOC_META[k.kind].plural, icon: k.icon, end: false })),
    { to: '/portal/payments', label: 'Payments', icon: <Wallet size={16} />, end: false },
    ...(me.settings.allowStatements ? [{ to: '/portal/statement', label: 'Statement', icon: <ScrollText size={16} />, end: false }] : []),
  ];
  const sidebar = (
    <nav className="space-y-0.5">
      {nav.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => clsx('flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium', isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900')}>
          {n.icon}
          {n.label}
        </NavLink>
      ))}
    </nav>
  );
  return (
    <div className="flex min-h-full flex-col bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button className="btn-ghost w-9 px-0 lg:hidden" aria-label="Menu" onClick={() => setMenu(!menu)}>
              {menu ? <X size={18} /> : <Menu size={18} />}
            </button>
            <OrgBrand org={me.organization} sub={me.settings.name} />
          </div>
          <div className="flex items-center gap-1">
            <NavLink to="/portal/profile" className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-100">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">{me.user.name.slice(0, 1).toUpperCase()}</span>
              <span className="hidden text-left sm:block">
                <span className="block text-[13px] font-medium leading-4 text-slate-800">{me.user.name}</span>
                <span className="block text-xxs text-slate-500">{me.contact.displayName}</span>
              </span>
            </NavLink>
            <button className="btn-ghost w-9 px-0" aria-label="Sign out" title="Sign out" onClick={logout}>
              <LogOut size={16} />
            </button>
          </div>
        </div>
        {menu && <div className="border-t border-slate-100 px-4 py-3 lg:hidden">{sidebar}</div>}
      </header>
      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-8 px-4 py-6 sm:px-6">
        <aside className="hidden w-52 shrink-0 lg:block">
          <div className="sticky top-24">{sidebar}</div>
        </aside>
        <main className="min-w-0 flex-1">
          <Routes>
            <Route index element={<Dashboard me={me} />} />
            {KIND_PATHS.map((k) => (
              <Route key={k.path} path={k.path} element={<DocList kind={k.kind} />} />
            ))}
            <Route path="docs/:id" element={<DocView me={me} />} />
            <Route path="payments" element={<Payments />} />
            {me.settings.allowStatements && <Route path="statement" element={<Statement />} />}
            <Route path="profile" element={<Profile me={me} />} />
            <Route path="*" element={<Navigate to="/portal" replace />} />
          </Routes>
        </main>
      </div>
      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xxs text-slate-400">
        {me.organization.name}
        {me.organization.email && ` · ${me.organization.email}`}
        {me.organization.phone && ` · ${me.organization.phone}`}
      </footer>
    </div>
  );
}

function PageTitle({ title, sub, action }: { title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {sub && <p className="mt-0.5 text-[13px] text-slate-500">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

function Stat({ label, value, tone, sub }: { label: string; value: string; tone?: 'red' | 'green'; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={clsx('mt-1 text-xl font-semibold tabular-nums', tone === 'red' ? 'text-red-600' : tone === 'green' ? 'text-emerald-600' : 'text-slate-900')}>{value}</div>
      {sub && <div className="mt-0.5 text-xxs text-slate-500">{sub}</div>}
    </div>
  );
}

function Dashboard({ me }: { me: Me }) {
  const { data } = useCustomer<{ summary: Summary; unpaid: Row[]; quotes: Row[]; payments: { id: string; number: string; date: string; mode: string; amount: number }[]; recent: Row[] }>('/portal/dashboard');
  const s = data?.summary || me.summary;
  const first = me.user.name.replace(/^(mr|mrs|ms|miss|dr|prof)\.?\s+/i, '').split(' ')[0];
  return (
    <div>
      <PageTitle title={`Hello, ${first}`} sub={`Here is your account with ${me.organization.name}.`} />
      {me.settings.bannerMessage && <div className="mb-5 rounded-xl border border-brand-100 bg-brand-50 p-4 text-[13px] text-brand-900">{me.settings.bannerMessage}</div>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Outstanding" value={money(s.outstanding)} sub={`${s.unpaidCount} unpaid invoice${s.unpaidCount === 1 ? '' : 's'}`} />
        <Stat label="Overdue" value={money(s.overdue)} tone={s.overdue > 0 ? 'red' : undefined} sub={s.overdueCount ? `${s.overdueCount} past due` : 'Nothing overdue'} />
        <Stat label="Credits available" value={money(s.unusedCredits)} tone={s.unusedCredits > 0 ? 'green' : undefined} />
        <Stat label="Quotes to review" value={String(s.openQuotes)} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card title="Invoices to pay" link={{ to: '/portal/invoices', label: 'All invoices' }}>
          {!data ? <Loading /> : data.unpaid.length === 0 ? <EmptyLine icon={<CheckCircle2 size={16} className="text-emerald-500" />} text="You are all paid up. Thank you!" /> : <RowList rows={data.unpaid} />}
        </Card>
        <Card title="Quotes awaiting your response" link={{ to: '/portal/quotes', label: 'All quotes' }}>
          {!data ? <Loading /> : data.quotes.length === 0 ? <EmptyLine text="No quotes waiting for you." /> : <RowList rows={data.quotes} />}
        </Card>
        <Card title="Recent payments" link={{ to: '/portal/payments', label: 'All payments' }}>
          {!data ? (
            <Loading />
          ) : data.payments.length === 0 ? (
            <EmptyLine text="No payments yet." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between px-4 py-3 text-[13px]">
                  <span>
                    <span className="font-medium text-slate-800">Payment #{p.number}</span>
                    <span className="block text-xs text-slate-500">
                      {fmtDate(p.date)} · {p.mode}
                    </span>
                  </span>
                  <span className="font-medium tabular-nums text-emerald-700">{money(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Recent documents">{!data ? <Loading /> : data.recent.length === 0 ? <EmptyLine text="Nothing here yet." /> : <RowList rows={data.recent} showKind />}</Card>
      </div>
    </div>
  );
}

function Card({ title, link, children }: { title: string; link?: { to: string; label: string }; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {link && (
          <Link to={link.to} className="inline-flex items-center gap-0.5 text-xs font-medium text-brand-700 hover:underline">
            {link.label} <ChevronRight size={13} />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

const Loading = () => <div className="px-4 py-8 text-center text-[13px] text-slate-400">Loading…</div>;
const EmptyLine = ({ text, icon }: { text: string; icon?: ReactNode }) => (
  <div className="flex items-center justify-center gap-2 px-4 py-8 text-[13px] text-slate-500">
    {icon}
    {text}
  </div>
);

function RowList({ rows, showKind }: { rows: Row[]; showKind?: boolean }) {
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((r) => (
        <li key={r.id}>
          <Link to={`/portal/docs/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-[13px] font-medium text-slate-800">
                  {showKind && `${DOC_META[r.kind].label} `}
                  {r.number}
                </span>
                <StatusChip d={r} />
              </div>
              <div className="text-xs text-slate-500">
                {fmtDate(r.date)}
                {r.kind === 'invoice' && r.dueDate && r.balance > 0 && ` · due ${fmtDate(r.dueDate)}`}
                {r.kind === 'quote' && r.expiryDate && r.status === 'sent' && ` · valid until ${fmtDate(r.expiryDate)}`}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[13px] font-semibold tabular-nums text-slate-900">{money(r.kind === 'invoice' && r.balance > 0 ? r.balance : r.total)}</div>
              {r.kind === 'invoice' && r.balance > 0 && r.balance !== r.total && <div className="text-xxs text-slate-500">of {money(r.total)}</div>}
            </div>
            <ChevronRight size={15} className="text-slate-300" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

const FILTERS: Partial<Record<DocKind, { value: string; label: string }[]>> = {
  invoice: [
    { value: '', label: 'All' },
    { value: 'unpaid', label: 'Unpaid' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'paid', label: 'Paid' },
  ],
  quote: [
    { value: '', label: 'All' },
    { value: 'sent', label: 'Awaiting response' },
    { value: 'accepted', label: 'Accepted' },
    { value: 'declined', label: 'Declined' },
  ],
};

function DocList({ kind }: { kind: DocKind }) {
  const meta = DOC_META[kind];
  const [status, setStatus] = useState('');
  useEffect(() => setStatus(''), [kind]);
  const { data } = useCustomer<Row[]>(`/portal/docs?kind=${kind}${status ? `&status=${status}` : ''}`);
  const filters = FILTERS[kind];
  const total = useMemo(() => (data || []).reduce((s, r) => s + (kind === 'invoice' ? r.balance : 0), 0), [data, kind]);
  return (
    <div>
      <PageTitle title={meta.plural} sub={kind === 'invoice' && data ? `${money(total)} outstanding in this view` : undefined} />
      {filters && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <button key={f.value} onClick={() => setStatus(f.value)} className={clsx('rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset', status === f.value ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50')}>
              {f.label}
            </button>
          ))}
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">{!data ? <Loading /> : data.length === 0 ? <EmptyLine text={`No ${meta.plural.toLowerCase()} here.`} /> : <RowList rows={data} />}</div>
    </div>
  );
}

function DocView({ me }: { me: Me }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const url = `/portal/docs/${id}`;
  const { data, error } = useCustomer<CustomerDocPayload>(url);
  const refresh = () => qc.invalidateQueries({ queryKey: ['customer'] });
  if (error) return <EmptyLine text={(error as Error).message} />;
  if (!data) return <Loading />;
  const back = KIND_PATHS.find((k) => k.kind === data.doc.kind)!;
  return (
    <div>
      <button className="mb-4 inline-flex items-center gap-1 text-[13px] text-slate-600 hover:text-slate-900" onClick={() => navigate(`/portal/${back.path}`)}>
        <ArrowLeft size={14} /> {DOC_META[data.doc.kind].plural}
      </button>
      <CustomerDocument
        data={data}
        signedInName={me.user.name}
        pdfUrl={`/api/portal/docs/${id}/pdf`}
        onRespond={async (b) => {
          await capi(`/portal/docs/${id}/respond`, { body: b });
          refresh();
        }}
        onNotify={async (b) => {
          await capi(`/portal/docs/${id}/payment-notice`, { body: b });
          refresh();
        }}
      />
    </div>
  );
}

function Payments() {
  const { data } = useCustomer<{ id: string; number: string; date: string; mode: string; referenceNumber?: string; amount: number; unusedAmount: number; invoices: { number?: string; amount: number }[] }[]>('/portal/payments');
  const { data: notices } = useCustomer<{ id: string; invoiceNumber?: string; invoiceId: string; amount: number; date: string; mode: string; reference?: string; status: string; createdAt: string }[]>('/portal/notices');
  const pending = (notices || []).filter((n) => n.status === 'pending');
  return (
    <div>
      <PageTitle title="Payments" sub="Payments we have received from you, with downloadable receipts." />
      {pending.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-900">
          <div className="mb-1 font-medium">Waiting for confirmation</div>
          {pending.map((n) => (
            <div key={n.id}>
              {money(n.amount)} for {n.invoiceNumber} paid {fmtDate(n.date)} via {n.mode} (ref {n.reference})
            </div>
          ))}
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {!data ? (
          <Loading />
        ) : data.length === 0 ? (
          <EmptyLine text="No payments yet." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <CreditCard size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-slate-800">Payment #{p.number}</div>
                  <div className="text-xs text-slate-500">
                    {fmtDate(p.date)} · {p.mode}
                    {p.referenceNumber && ` · ref ${p.referenceNumber}`}
                    {p.invoices.length > 0 && ` · for ${p.invoices.map((i) => i.number).join(', ')}`}
                  </div>
                </div>
                <div className="text-right text-[13px] font-semibold tabular-nums text-slate-900">{money(p.amount)}</div>
                <a className="btn-secondary btn-sm" href={`/api/portal/payments/${p.id}/pdf?download=1`}>
                  <Download size={13} /> Receipt
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Statement() {
  const year = today().slice(0, 4);
  const fyStart = today().slice(5, 7) >= '04' ? `${year}-04-01` : `${Number(year) - 1}-04-01`;
  const [from, setFrom] = useState(fyStart);
  const [to, setTo] = useState(today());
  const { data, error } = useCustomer<{ from: string; to: string; opening: number; invoiced: number; paid: number; closing: number; rows: { date: string; type: string; number: string; details: string; amount: number; payment: number; balance: number }[] }>(`/portal/statement?from=${from}&to=${to}`);
  return (
    <div>
      <PageTitle
        title="Statement of accounts"
        action={
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-500">
              From
              <input className="input mt-0.5 h-9 w-40" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="text-xs text-slate-500">
              To
              <input className="input mt-0.5 h-9 w-40" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </label>
            <a className="btn-secondary h-9" href={`/api/portal/statement/pdf?from=${from}&to=${to}&download=1`}>
              <Download size={14} /> PDF
            </a>
          </div>
        }
      />
      {error && <EmptyLine text={(error as Error).message} />}
      {data && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-4">
            <Stat label="Opening balance" value={money(data.opening)} />
            <Stat label="Invoiced" value={money(data.invoiced)} />
            <Stat label="Paid" value={money(data.paid)} />
            <Stat label="Balance due" value={money(data.closing)} tone={data.closing > 0 ? 'red' : 'green'} />
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Transaction</th>
                  <th className="px-4 py-2.5 font-medium">Details</th>
                  <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-4 py-2.5 text-right font-medium">Payments</th>
                  <th className="px-4 py-2.5 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="px-4 py-2.5 text-slate-500">{fmtDate(data.from)}</td>
                  <td className="px-4 py-2.5 font-medium" colSpan={4}>
                    Opening balance
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{money(data.opening)}</td>
                </tr>
                {data.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2.5 text-slate-500">{fmtDate(r.date)}</td>
                    <td className="px-4 py-2.5">
                      {r.type} {r.number && <span className="text-slate-500">{r.number}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{r.details.replace(/\d{4}-\d{2}-\d{2}/g, (x) => fmtDate(x))}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.amount ? money(r.amount) : ''}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700">{r.payment ? money(r.payment) : ''}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{money(r.balance)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold">
                  <td className="px-4 py-2.5" colSpan={5}>
                    Balance due
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{money(data.closing)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Profile({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [name, setName] = useState(me.user.name);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const c = me.contact;
  const addr = (a?: Contact['billingAddress']) => [a?.street1, a?.street2, [a?.city, a?.pin].filter(Boolean).join(' '), a?.state, a?.country].filter(Boolean).join(', ');
  async function saveName(e: FormEvent) {
    e.preventDefault();
    setBusy('name');
    try {
      await capi('/portal/me', { method: 'PUT', body: { name } });
      qc.invalidateQueries({ queryKey: ['customer'] });
      toast.success('Profile updated');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function savePw(e: FormEvent) {
    e.preventDefault();
    if (pw.next !== pw.confirm) return toast.error('The new passwords do not match');
    setBusy('pw');
    try {
      await capi('/portal/me/password', { body: { current: pw.current, next: pw.next } });
      setPw({ current: '', next: '', confirm: '' });
      toast.success('Password changed. Other devices were signed out.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="max-w-3xl">
      <PageTitle title="Profile" />
      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <User size={15} /> Your details
          </h2>
          <form className="space-y-3" onSubmit={saveName}>
            <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input label="Email" value={me.user.email} disabled />
            <button className="btn-primary h-9" disabled={busy === 'name' || !name.trim()}>
              Save
            </button>
          </form>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <KeyRound size={15} /> Change password
          </h2>
          <form className="space-y-3" onSubmit={savePw}>
            <Input label="Current password" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            <Input label="New password" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            <Input label="Confirm new password" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            <button className="btn-primary h-9" disabled={busy === 'pw' || !pw.current || !pw.next}>
              Change password
            </button>
          </form>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">Company on file</h2>
          <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-500">Name</dt>
              <dd>{c.companyName || c.displayName}</dd>
            </div>
            {c.gstin && (
              <div>
                <dt className="text-xs text-slate-500">GSTIN</dt>
                <dd>{c.gstin}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-slate-500">Billing address</dt>
              <dd>{addr(c.billingAddress) || '-'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Shipping address</dt>
              <dd>{addr(c.shippingAddress) || '-'}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-slate-500">
            To change these details, contact {me.organization.name}
            {me.organization.email ? ` at ${me.organization.email}` : ''}.
          </p>
        </section>
      </div>
      <Link to="/portal" className="mt-6 inline-flex items-center gap-1 text-[13px] text-brand-700 hover:underline">
        Back to home <ArrowRight size={13} />
      </Link>
    </div>
  );
}
