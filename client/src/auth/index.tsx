// Team sign-up, sign-in, password reset and invitations, plus the gate that keeps the app behind sign-in.
import { createContext, useContext, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BarChart3, CheckCircle2, Eye, EyeOff, Landmark, Lock, ReceiptText, ShieldCheck } from 'lucide-react';
import { api, ApiError, useApi } from '../api';

export interface Me {
  id: string;
  name: string;
  email?: string;
  role: 'Admin' | 'Staff' | 'Timesheet Staff';
  status: string;
}
interface MeResponse {
  user: Me;
  organization: string;
  authDisabled?: boolean;
}
interface Status {
  needsSetup: boolean;
  organization: string;
  authDisabled: boolean;
}

const MeCtx = createContext<MeResponse | null>(null);
/** The signed-in team member. */
export function useMe() {
  const v = useContext(MeCtx);
  if (!v) throw new Error('AuthGate missing');
  return v;
}

/** Shows the app only to a signed-in team member; otherwise sends the browser to sign in (or to set up the owner). */
export function AuthGate({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const me = useApi<MeResponse>('/auth/me', { retry: false, staleTime: 60_000 });
  if (me.isLoading) return <div className="flex h-full items-center justify-center text-slate-400">Loading Creatign Ledger…</div>;
  if (me.error) {
    const e = me.error as ApiError;
    if (e.status === 401) {
      const next = loc.pathname === '/' ? '' : `?next=${encodeURIComponent(loc.pathname + loc.search)}`;
      return <Navigate to={e.message === 'setup' ? '/signup' : `/signin${next}`} replace />;
    }
    return <div className="p-10 text-red-600">Could not reach the Creatign Ledger API. Is the server running on port 4000? ({e.message})</div>;
  }
  return <MeCtx.Provider value={me.data!}>{children}</MeCtx.Provider>;
}

export function useSignOut() {
  const qc = useQueryClient();
  return async () => {
    try {
      await api('/auth/signout', { method: 'POST' });
    } finally {
      qc.clear();
      window.location.assign('/signin');
    }
  };
}

// ------------------------------------------------------------------ layout

function Shell({ title, sub, children, footer }: { title: string; sub?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-full bg-white">
      <aside className="relative hidden w-[44%] max-w-[560px] flex-col justify-between overflow-hidden bg-ink-900 p-10 text-white lg:flex">
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-brand-600/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-teal-400/10 blur-3xl" />
        <Brand light />
        <div className="relative">
          <h2 className="text-[28px] font-semibold leading-tight tracking-tight">Books that close themselves.</h2>
          <p className="mt-3 max-w-sm text-[15px] text-slate-300">GST-ready invoicing, payables, banking and reports for Indian businesses, in one ledger your accountant will trust.</p>
          <ul className="mt-8 space-y-3 text-[14px] text-slate-200">
            <li className="flex items-center gap-3">
              <ReceiptText size={17} className="text-teal-300" /> GST invoices, delivery challans and credit notes
            </li>
            <li className="flex items-center gap-3">
              <Landmark size={17} className="text-teal-300" /> Bank statement import, matching and reconciliation
            </li>
            <li className="flex items-center gap-3">
              <BarChart3 size={17} className="text-teal-300" /> GSTR-1, GSTR-3B and Schedule III statements
            </li>
          </ul>
        </div>
        <div className="relative flex items-center gap-2 text-xs text-slate-400">
          <ShieldCheck size={14} /> Passwords are stored encrypted and sessions are secure.
        </div>
      </aside>
      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 lg:hidden">
            <Brand />
          </div>
          <h1 className="text-[24px] font-semibold tracking-tight text-slate-900">{title}</h1>
          {sub && <p className="mt-1.5 text-[14px] text-slate-500">{sub}</p>}
          <div className="mt-7">{children}</div>
          {footer && <div className="mt-6 text-center text-[13px] text-slate-500">{footer}</div>}
        </div>
      </main>
    </div>
  );
}

function Brand({ light }: { light?: boolean }) {
  return (
    <div className="relative flex items-center gap-2.5">
      <img src="/logo.svg" alt="" className="h-8 w-8" />
      <span className={`text-[17px] font-semibold tracking-tight ${light ? 'text-white' : 'text-slate-900'}`}>
        Creatign <span className={light ? 'font-normal text-brand-300' : 'font-normal text-brand-600'}>Ledger</span>
      </span>
    </div>
  );
}

function Input({ label, hint, right, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; right?: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-[13px] font-medium text-slate-700">
        {label}
        {right}
      </span>
      <input {...props} className="block h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-[14px] text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" />
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

function Password({ label = 'Password', value, onChange, autoComplete, hint, right, autoFocus }: { label?: string; value: string; onChange: (v: string) => void; autoComplete: string; hint?: ReactNode; right?: ReactNode; autoFocus?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-[13px] font-medium text-slate-700">
        {label}
        {right}
      </span>
      <span className="relative block">
        <input type={show ? 'text' : 'password'} required autoFocus={autoFocus} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} className="block h-10 w-full rounded-md border border-slate-300 bg-white px-3 pr-10 text-[14px] text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" />
        <button type="button" className="absolute right-2 top-2 rounded p-1 text-slate-400 hover:text-slate-600" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </span>
      {hint}
    </label>
  );
}

function Strength({ pw }: { pw: string }) {
  const checks = [pw.length >= 8, /[A-Za-z]/.test(pw) && /\d/.test(pw), pw.length >= 12 || /[^A-Za-z0-9]/.test(pw)];
  const score = checks.filter(Boolean).length;
  const label = !pw ? 'At least 8 characters, with letters and a number' : score === 3 ? 'Strong password' : score === 2 ? 'Good password' : 'Too weak';
  return (
    <span className="mt-1.5 block">
      <span className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className={`h-1 flex-1 rounded-full ${pw && i < score ? (score === 3 ? 'bg-emerald-500' : score === 2 ? 'bg-amber-400' : 'bg-red-400') : 'bg-slate-200'}`} />
        ))}
      </span>
      <span className="mt-1 block text-xs text-slate-500">{label}</span>
    </span>
  );
}

function ErrorNote({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
      {error}
    </div>
  );
}

function Submit({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button type="submit" disabled={busy} className="flex h-10 w-full items-center justify-center rounded-md bg-brand-600 text-[14px] font-medium text-white hover:bg-brand-700 disabled:opacity-60">
      {busy ? 'Please wait…' : children}
    </button>
  );
}

function useSubmit<T>(fn: () => Promise<T>, onDone: (r: T) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      onDone(await fn());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

/** Only follow local paths after sign-in. */
const safeNext = (next: string | null) => (next && next.startsWith('/') && !next.startsWith('//') ? next : '/');

// ------------------------------------------------------------------ pages

export function SignIn() {
  const [sp] = useSearchParams();
  const qc = useQueryClient();
  const { data: status } = useApi<Status>('/auth/status');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const f = useSubmit(
    () => api('/auth/signin', { body: { email, password, remember } }),
    () => {
      qc.clear();
      window.location.assign(safeNext(sp.get('next')));
    },
  );
  if (status?.needsSetup) return <Navigate to="/signup" replace />;
  return (
    <Shell title="Sign in" sub={status ? `to ${status.organization} on Creatign Ledger` : 'to Creatign Ledger'} footer={<>New to the team? <Link className="font-medium text-brand-600 hover:underline" to="/signup">Create an account</Link></>}>
      <form onSubmit={f.submit} className="space-y-4" noValidate>
        <ErrorNote error={f.error} />
        <Input label="Work email" type="email" required autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
        <Password value={password} onChange={setPassword} autoComplete="current-password" right={<Link to={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ''}`} className="text-xs font-medium text-brand-600 hover:underline">Forgot password?</Link>} />
        <label className="flex items-center gap-2 text-[13px] text-slate-600">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Keep me signed in for 14 days
        </label>
        <Submit busy={f.busy}>Sign in</Submit>
      </form>
    </Shell>
  );
}

export function SignUp() {
  const qc = useQueryClient();
  const { data: status } = useApi<Status>('/auth/status');
  const [f, setF] = useState({ name: '', email: '', password: '', agree: false });
  const [pending, setPending] = useState(false);
  const setup = !!status?.needsSetup;
  const s = useSubmit(
    async () => {
      if (!f.agree) throw new Error('Please confirm you are authorised to use these books');
      return api<{ status: string }>('/auth/signup', { body: { name: f.name, email: f.email, password: f.password } });
    },
    (r) => {
      if (r.status === 'active') {
        qc.clear();
        window.location.assign('/');
      } else setPending(true);
    },
  );
  if (pending)
    return (
      <Shell title="Request sent" footer={<Link className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline" to="/signin"><ArrowLeft size={14} /> Back to sign in</Link>}>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-[14px] text-emerald-900">
          <CheckCircle2 className="mb-2 text-emerald-600" size={22} />
          Your account for <b>{f.email}</b> is created and waiting for an Admin of {status?.organization ?? 'the organization'} to approve it. You can sign in once it is approved.
        </div>
      </Shell>
    );
  return (
    <Shell
      title={setup ? 'Set up Creatign Ledger' : 'Create your account'}
      sub={setup ? <>You are the first person here, so you become the <b>Admin</b> of {status?.organization}.</> : <>An Admin of {status?.organization ?? 'your organization'} approves new accounts before they can sign in.</>}
      footer={setup ? undefined : <>Already have an account? <Link className="font-medium text-brand-600 hover:underline" to="/signin">Sign in</Link></>}
    >
      <form onSubmit={s.submit} className="space-y-4" noValidate>
        <ErrorNote error={s.error} />
        <Input label="Full name" required autoFocus autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Your name" />
        <Input label="Work email" type="email" required autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="you@company.com" />
        <Password value={f.password} onChange={(v) => setF({ ...f, password: v })} autoComplete="new-password" hint={<Strength pw={f.password} />} />
        <label className="flex items-start gap-2 text-[13px] text-slate-600">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={f.agree} onChange={(e) => setF({ ...f, agree: e.target.checked })} />
          <span>I am authorised to access these books and will keep my password private.</span>
        </label>
        <Submit busy={s.busy}>{setup ? 'Create Admin account' : 'Create account'}</Submit>
      </form>
    </Shell>
  );
}

export function ForgotPassword() {
  const [sp] = useSearchParams();
  const [email, setEmail] = useState(sp.get('email') || '');
  const [sent, setSent] = useState(false);
  const f = useSubmit(() => api('/auth/forgot', { body: { email } }), () => setSent(true));
  return (
    <Shell title="Reset your password" sub={sent ? undefined : 'Enter your work email and we will send you a link to choose a new password.'} footer={<Link className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline" to="/signin"><ArrowLeft size={14} /> Back to sign in</Link>}>
      {sent ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-[14px] text-slate-700">
          If <b>{email}</b> has an account, a reset link is on its way. The link works for 2 hours. Check your spam folder if it does not arrive.
        </div>
      ) : (
        <form onSubmit={f.submit} className="space-y-4" noValidate>
          <ErrorNote error={f.error} />
          <Input label="Work email" type="email" required autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Submit busy={f.busy}>Send reset link</Submit>
        </form>
      )}
    </Shell>
  );
}

export function ResetPassword() {
  const { token = '' } = useParams();
  const info = useApi<{ email: string }>(`/auth/reset/${token}`, { retry: false });
  const [password, setPassword] = useState('');
  const f = useSubmit(() => api(`/auth/reset/${token}`, { body: { password } }), () => window.location.assign('/'));
  if (info.isLoading) return <Shell title="Reset your password">Checking your link…</Shell>;
  if (info.error) return <LinkProblem message={(info.error as Error).message} />;
  return (
    <Shell title="Choose a new password" sub={<>for {info.data!.email}</>}>
      <form onSubmit={f.submit} className="space-y-4" noValidate>
        <ErrorNote error={f.error} />
        <Password label="New password" autoFocus value={password} onChange={setPassword} autoComplete="new-password" hint={<Strength pw={password} />} />
        <Submit busy={f.busy}>Save and sign in</Submit>
      </form>
    </Shell>
  );
}

export function AcceptInvite() {
  const { token = '' } = useParams();
  const info = useApi<{ name: string; email: string; role: string; organization: string }>(`/auth/invite/${token}`, { retry: false });
  const [name, setName] = useState<string>();
  const [password, setPassword] = useState('');
  const f = useSubmit(() => api(`/auth/invite/${token}`, { body: { name: name ?? info.data?.name, password } }), () => window.location.assign('/'));
  if (info.isLoading) return <Shell title="Join your team">Checking your invitation…</Shell>;
  if (info.error) return <LinkProblem message={(info.error as Error).message} />;
  const d = info.data!;
  return (
    <Shell title={`Join ${d.organization}`} sub={<>You are invited as <b>{d.role}</b>. Set a password to finish.</>}>
      <form onSubmit={f.submit} className="space-y-4" noValidate>
        <ErrorNote error={f.error} />
        <Input label="Full name" required value={name ?? d.name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        <Input label="Work email" value={d.email} readOnly disabled />
        <Password autoFocus value={password} onChange={setPassword} autoComplete="new-password" hint={<Strength pw={password} />} />
        <Submit busy={f.busy}>Join and sign in</Submit>
      </form>
    </Shell>
  );
}

function LinkProblem({ message }: { message: string }) {
  const navigate = useNavigate();
  return (
    <Shell title="This link can't be used">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-[14px] text-amber-900">
        <Lock className="mb-2 text-amber-600" size={20} />
        {message}
      </div>
      <button className="mt-5 h-10 w-full rounded-md border border-slate-300 text-[14px] font-medium text-slate-700 hover:bg-slate-50" onClick={() => navigate('/signin')}>
        Go to sign in
      </button>
    </Shell>
  );
}
