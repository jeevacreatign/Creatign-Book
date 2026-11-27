import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Home, Package, ShoppingCart, ShoppingBag, Clock, Landmark, UserCog, BarChart3, FolderOpen, Wallet, CreditCard, ChevronRight, ChevronDown, Search, Plus, Settings, Bell, RefreshCw, PanelLeftClose, PanelLeftOpen, Building2, Check, Sparkles, LogOut, UserRound, Users,
} from 'lucide-react';
import clsx from 'clsx';
import { useOrg } from '../lib/app';
import { api, qs } from '../api';
import { useOutside } from './ui';
import { TimerChip } from '../pages/time/common';
import { useMe, useSignOut } from '../auth';

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

type NavItem = { to: string; label: string; noNew?: boolean };
const SALES: NavItem[] = [
  { to: '/sales/customers', label: 'Clients' },
  { to: '/sales/quotes', label: 'Estimates' },
  { to: '/sales/sales-orders', label: 'Sales Orders' },
  { to: '/sales/invoices', label: 'Invoices' },
  { to: '/sales/retainer-invoices', label: 'Advance Invoices' },
  { to: '/sales/recurring-invoices', label: 'Invoice Schedules' },
  { to: '/sales/delivery-challans', label: 'Delivery Challans' },
  { to: '/sales/payments-received', label: 'Client Payments' },
  { to: '/sales/credit-notes', label: 'Credit Notes' },
];
const PURCHASES: NavItem[] = [
  { to: '/purchases/vendors', label: 'Suppliers' },
  { to: '/purchases/expenses', label: 'Expenses' },
  { to: '/purchases/recurring-expenses', label: 'Expense Schedules' },
  { to: '/purchases/purchase-orders', label: 'Purchase Orders' },
  { to: '/purchases/bills', label: 'Purchase Bills' },
  { to: '/purchases/recurring-bills', label: 'Bill Schedules' },
  { to: '/purchases/payments-made', label: 'Supplier Payments' },
  { to: '/purchases/vendor-credits', label: 'Debit Notes' },
];
const ACCOUNTANT: NavItem[] = [
  { to: '/accountant/manual-journals', label: 'Journal Vouchers' },
  { to: '/accountant/recurring-journals', label: 'Voucher Schedules' },
  { to: '/accountant/bulk-update', label: 'Batch Reclassify', noNew: true },
  { to: '/accountant/currency-adjustments', label: 'FX Revaluations', noNew: true },
  { to: '/accountant/chart-of-accounts', label: 'Chart of Accounts', noNew: true },
  { to: '/accountant/budgets', label: 'Budgets' },
  { to: '/accountant/transaction-locking', label: 'Period Close', noNew: true },
];
const TIME: NavItem[] = [
  { to: '/time-tracking/projects', label: 'Projects' },
  { to: '/time-tracking/timesheet', label: 'Timesheet' },
];

/** Labels used by the top-bar search placeholder ("Search in Invoices ( / )") */
export function moduleLabel(pathname: string): string {
  const all = [...SALES, ...PURCHASES, ...ACCOUNTANT, ...TIME, { to: '/items', label: 'Products & Services' }, { to: '/banking', label: 'Cash & Bank' }, { to: '/reports', label: 'Financial Reports' }, { to: '/documents', label: 'Document Vault' }];
  return all.find((n) => pathname.startsWith(n.to))?.label ?? 'Creatign Ledger';
}

function Group({ icon, label, items, base, collapsed }: { icon: ReactNode; label: string; items: NavItem[]; base: string; collapsed?: boolean }) {
  const { pathname } = useLocation();
  const active = pathname.startsWith(base);
  const [open, setOpen] = useState(active);
  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);
  const navigate = useNavigate();
  if (collapsed)
    return (
      <NavLink to={items[0].to} title={label} className={clsx('relative flex h-9 w-9 items-center justify-center rounded-lg', active ? 'bg-white/10 text-brand-300' : 'text-slate-400 hover:bg-white/5 hover:text-white')}>
        {icon}
      </NavLink>
    );
  return (
    <div>
      <button
        className={clsx('group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[13px] transition-colors', active ? 'text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white')}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {active && !open && <span className="absolute left-0 top-1.5 h-[calc(100%-12px)] w-[3px] rounded-r bg-brand-400" />}
        <span className={clsx(active ? 'text-brand-300' : 'text-slate-400 group-hover:text-slate-200')}>{icon}</span>
        <span className="flex-1 font-medium">{label}</span>
        <ChevronDown size={13} className={clsx('text-slate-500 transition-transform', !open && '-rotate-90')} />
      </button>
      {open && (
        <div className="relative ml-[19px] mt-0.5 space-y-px border-l border-white/10 pb-1 pl-2.5">
          {items.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              className={({ isActive }) => clsx('group relative flex items-center justify-between rounded-md px-2.5 py-[5px] text-[12.5px] transition-colors', isActive ? 'bg-white/[0.08] font-medium text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100')}
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute -left-[11px] top-1 h-[calc(100%-8px)] w-[2px] rounded bg-brand-400" />}
                  <span>{i.label}</span>
                  {!i.noNew && (
                    <span
                      role="button"
                      aria-label={`New ${i.label}`}
                      title={`New ${i.label}`}
                      onClick={(e) => {
                        e.preventDefault();
                        navigate(`${i.to}/new`);
                      }}
                      className={clsx('flex h-4 w-4 items-center justify-center rounded text-brand-300 hover:bg-brand-400 hover:text-ink-900', isActive ? 'visible' : 'invisible group-hover:visible')}
                    >
                      <Plus size={12} />
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function Leaf({ to, icon, label, end, badge, collapsed }: { to: string; icon: ReactNode; label: string; end?: boolean; badge?: string; collapsed?: boolean }) {
  if (collapsed)
    return (
      <NavLink to={to} end={end} title={label} className={({ isActive }) => clsx('flex h-9 w-9 items-center justify-center rounded-lg', isActive ? 'bg-white/10 text-brand-300' : 'text-slate-400 hover:bg-white/5 hover:text-white')}>
        {icon}
      </NavLink>
    );
  return (
    <NavLink to={to} end={end} className={({ isActive }) => clsx('group relative flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] font-medium transition-colors', isActive ? 'bg-white/[0.08] text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white')}>
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute left-0 top-1.5 h-[calc(100%-12px)] w-[3px] rounded-r bg-brand-400" />}
          <span className={clsx(isActive ? 'text-brand-300' : 'text-slate-400 group-hover:text-slate-200')}>{icon}</span>
          <span className="flex-1">{label}</span>
          {badge && <span className="rounded-full border border-brand-400/40 px-1.5 text-[10px] font-medium text-brand-300">{badge}</span>}
        </>
      )}
    </NavLink>
  );
}

function SideBrand({ collapsed }: { collapsed: boolean }) {
  return (
    <Link to="/" className={clsx('flex h-14 shrink-0 items-center gap-2.5', collapsed ? 'justify-center' : 'px-4')}>
      <img src="/logo.png" alt="Creatign" className="h-8 w-8 drop-shadow-[0_2px_6px_rgba(207,159,62,0.35)]" />
      {!collapsed && (
        <span className="leading-tight">
          <span className="block text-[15px] font-semibold tracking-tight text-white">Creatign</span>
          <span className="block text-[10px] font-medium uppercase tracking-[0.28em] text-brand-300">Ledger</span>
        </span>
      )}
    </Link>
  );
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const timeOnly = useMe().user.role === 'Timesheet Staff';
  const ic = 'shrink-0';
  const sz = 16;
  const toggle = (
    <div className={clsx('flex border-t border-white/10 p-2', collapsed ? 'justify-center' : 'justify-end')}>
      <button className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
      </button>
    </div>
  );
  const shell = (children: ReactNode) => (
    <aside className={clsx('no-print flex shrink-0 flex-col bg-ink-900 bg-[radial-gradient(120%_60%_at_0%_0%,rgba(207,159,62,0.10),transparent_60%)] text-slate-300', collapsed ? 'w-[60px]' : 'w-[236px]')}>
      <SideBrand collapsed={collapsed} />
      <nav className={clsx('flex-1 overflow-y-auto pb-3 pt-1 [scrollbar-color:#2c3b56_transparent]', collapsed ? 'flex flex-col items-center gap-1 px-2' : 'space-y-0.5 px-3')}>{children}</nav>
      {toggle}
    </aside>
  );
  const c = collapsed;
  if (timeOnly)
    return shell(
      <>
        <Leaf collapsed={c} to="/time-tracking/timesheet" icon={<Clock size={sz} className={ic} />} label="Timesheet" />
        <Leaf collapsed={c} to="/time-tracking/projects" icon={<FolderOpen size={sz} className={ic} />} label="My Projects" />
      </>,
    );
  const section = (t: string) => (c ? <div className="my-2 h-px w-6 bg-white/10" /> : <div className="px-2.5 pb-1.5 pt-5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t}</div>);
  return shell(
    <>
      <Leaf collapsed={c} to="/" end icon={<Home size={sz} className={ic} />} label="Dashboard" />
      {section('Operations')}
      <Leaf collapsed={c} to="/items" icon={<Package size={sz} className={ic} />} label="Products & Services" />
      <Group collapsed={c} base="/sales" icon={<ShoppingCart size={sz} className={ic} />} label="Receivables" items={SALES} />
      <Group collapsed={c} base="/purchases" icon={<ShoppingBag size={sz} className={ic} />} label="Payables" items={PURCHASES} />
      <Group collapsed={c} base="/time-tracking" icon={<Clock size={sz} className={ic} />} label="Projects & Time" items={TIME} />
      {section('Accounting')}
      <Leaf collapsed={c} to="/banking" icon={<Landmark size={sz} className={ic} />} label="Cash & Bank" />
      <Group collapsed={c} base="/accountant" icon={<UserCog size={sz} className={ic} />} label="General Ledger" items={ACCOUNTANT} />
      <Leaf collapsed={c} to="/reports" icon={<BarChart3 size={sz} className={ic} />} label="Financial Reports" />
      <Leaf collapsed={c} to="/documents" icon={<FolderOpen size={sz} className={ic} />} label="Document Vault" />
      {section('Apps')}
      <Leaf collapsed={c} to="/apps/payroll" icon={<Wallet size={sz} className={ic} />} label="Payroll" badge="Soon" />
      <Leaf collapsed={c} to="/apps/payments" icon={<CreditCard size={sz} className={ic} />} label="Payment Gateway" badge="Soon" />
      {!c && (
        <div className="pt-4">
          <Link to="/settings/features" className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[12.5px] text-slate-300 hover:border-brand-400/50 hover:text-white">
            Feature Settings <ChevronRight size={14} />
          </Link>
        </div>
      )}
    </>,
  );
}

const QUICK_CREATE: { group: string; items: NavItem[] }[] = [
  { group: 'General', items: [{ to: '/items/new', label: 'Product or Service' }, { to: '/accountant/manual-journals/new', label: 'Journal Voucher' }, { to: '/time-tracking/timesheet?new=1', label: 'Log Time' }, { to: '/time-tracking/projects/new', label: 'Project' }] },
  { group: 'Receivables', items: [{ to: '/sales/customers/new', label: 'Client' }, { to: '/sales/quotes/new', label: 'Estimate' }, { to: '/sales/sales-orders/new', label: 'Sales Order' }, { to: '/sales/invoices/new', label: 'Invoice' }, { to: '/sales/retainer-invoices/new', label: 'Advance Invoice' }, { to: '/sales/recurring-invoices/new', label: 'Invoice Schedule' }, { to: '/sales/delivery-challans/new', label: 'Delivery Challan' }, { to: '/sales/payments-received/new', label: 'Client Payment' }, { to: '/sales/credit-notes/new', label: 'Credit Note' }] },
  { group: 'Payables', items: [{ to: '/purchases/vendors/new', label: 'Supplier' }, { to: '/purchases/expenses/new', label: 'Expense' }, { to: '/purchases/recurring-expenses/new', label: 'Expense Schedule' }, { to: '/purchases/purchase-orders/new', label: 'Purchase Order' }, { to: '/purchases/bills/new', label: 'Bill' }, { to: '/purchases/recurring-bills/new', label: 'Bill Schedule' }, { to: '/purchases/payments-made/new', label: 'Supplier Payment' }, { to: '/purchases/vendor-credits/new', label: 'Debit Note' }] },
];

function GlobalSearch() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ type: string; title: string; subtitle?: string; path: string }[]>([]);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useOutside(box, () => setOpen(false));
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) && !(e.target as HTMLElement).isContentEditable) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  useEffect(() => {
    if (!q.trim()) return setResults([]);
    const t = setTimeout(() => api<typeof results>(`/search${qs({ q })}`).then(setResults).catch(() => setResults([])), 150);
    return () => clearTimeout(t);
  }, [q]);
  const label = moduleLabel(pathname);
  return (
    <div ref={box} className="relative w-full max-w-md">
      <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
      <kbd className="pointer-events-none absolute right-2 top-2 rounded border border-slate-200 bg-white px-1.5 text-[11px] leading-[18px] text-slate-400">/</kbd>
      <input
        ref={input}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results[0]) {
            navigate(results[0].path);
            setOpen(false);
            setQ('');
          }
          if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
        }}
        placeholder={`Search in ${label}`}
        className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-10 text-[13px] text-slate-800 placeholder:text-slate-400 transition-colors hover:border-slate-300 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-[3px] focus:ring-brand-100"
      />
      {open && q && (
        <div className="menu left-0 right-0 max-h-96 overflow-auto">
          {results.length === 0 && <div className="px-3 py-2 text-slate-400">No matches for “{q}”</div>}
          {results.map((r, i) => (
            <button
              key={i}
              className="menu-item justify-between"
              onClick={() => {
                navigate(r.path);
                setOpen(false);
                setQ('');
              }}
            >
              <span>
                <span className="font-medium">{r.title}</span> {r.subtitle && <span className="text-slate-500">· {r.subtitle}</span>}
              </span>
              <span className="text-xxs uppercase text-slate-400">{r.type}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Topbar() {
  const org = useOrg();
  const navigate = useNavigate();
  const [plus, setPlus] = useState(false);
  const [orgOpen, setOrgOpen] = useState(false);
  const [profile, setProfile] = useState(false);
  const plusRef = useRef<HTMLDivElement>(null);
  const orgRef = useRef<HTMLDivElement>(null);
  const profRef = useRef<HTMLDivElement>(null);
  useOutside(plusRef, () => setPlus(false));
  useOutside(orgRef, () => setOrgOpen(false));
  useOutside(profRef, () => setProfile(false));
  const me = useMe();
  const signOut = useSignOut();
  const timeOnly = me.user.role === 'Timesheet Staff';
  return (
    <header className="no-print flex h-14 shrink-0 items-center gap-3 border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur">
      <button className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-ink-900" title="Refresh" aria-label="Refresh" onClick={() => window.location.reload()}>
        <RefreshCw size={15} />
      </button>
      {!timeOnly && <GlobalSearch />}
      <div className="flex-1" />
      <TimerChip />
      <div ref={orgRef} className="relative">
        <button className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-2.5 text-[13px] font-medium text-ink-900 hover:border-slate-300 hover:bg-slate-50" onClick={() => setOrgOpen((o) => !o)}>
          <Building2 size={14} className="text-brand-600" />
          {org.name}
          <ChevronDown size={13} className="text-slate-400" />
        </button>
        {orgOpen && (
          <div className="menu right-0 w-72 text-slate-800">
            <div className="px-3 py-2 text-xxs font-semibold uppercase text-slate-400">My Organizations</div>
            <div className="flex items-center gap-3 px-3 py-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink-900 font-semibold text-brand-300">{org.logoText || org.name[0]}</div>
              <div className="flex-1">
                <div className="font-medium">{org.name}</div>
                <div className="text-xxs text-slate-500">
                  {org.state}, {org.country} · {org.currencyCode}
                </div>
              </div>
              <Check size={16} className="text-emerald-600" />
            </div>
            <button
              className="menu-item border-t border-slate-100"
              onClick={() => {
                setOrgOpen(false);
                navigate('/settings');
              }}
            >
              <Settings size={14} /> Manage organization
            </button>
          </div>
        )}
      </div>
      {!timeOnly && <div ref={plusRef} className="relative">
        <button className="flex h-9 items-center gap-1.5 rounded-lg bg-ink-900 pl-2.5 pr-3 text-[13px] font-medium text-white shadow-sm hover:bg-ink-700" aria-label="Quick create" title="Quick create" onClick={() => setPlus((p) => !p)}>
          <Plus size={15} className="text-brand-300" /> Create
        </button>
        {plus && (
          <div className="menu right-0 grid w-[640px] grid-cols-3 gap-3 p-3 text-slate-800">
            {QUICK_CREATE.map((g) => (
              <div key={g.group}>
                <div className="mb-1 px-2 text-xxs font-semibold uppercase tracking-wide text-slate-400">{g.group}</div>
                {g.items.map((i) => (
                  <button
                    key={i.to}
                    className="menu-item rounded"
                    onClick={() => {
                      setPlus(false);
                      navigate(i.to);
                    }}
                  >
                    <Plus size={12} className="text-brand-500" /> {i.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>}
      {!timeOnly && (
        <>
          <button className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-ink-900" title="Notifications" aria-label="Notifications" onClick={() => navigate('/?tab=updates')}>
            <Bell size={17} />
          </button>
          <button className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-ink-900" title="Settings" aria-label="Settings" onClick={() => navigate('/settings')}>
            <Settings size={17} />
          </button>
        </>
      )}
      <div ref={profRef} className="relative">
        <button className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-900 text-[12px] font-semibold text-brand-300 ring-2 ring-brand-200 ring-offset-1" onClick={() => setProfile((p) => !p)} aria-label="Profile" title={me.user.name}>
          {initials(me.user.name)}
        </button>
        {profile && (
          <div className="menu right-0 w-72 p-0 text-slate-800">
            <div className="flex items-center gap-3 border-b border-slate-100 p-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink-900 text-[15px] font-semibold text-brand-300">{initials(me.user.name)}</span>
              <div className="min-w-0">
                <div className="truncate font-medium">{me.user.name}</div>
                <div className="truncate text-xxs text-slate-500">{me.user.email}</div>
                <div className="mt-0.5 text-xxs text-slate-500">
                  {me.user.role} · {org.name}
                </div>
              </div>
            </div>
            <div className="p-1.5">
              <button className="menu-item rounded" onClick={() => { setProfile(false); navigate('/settings/account'); }}>
                <UserRound size={14} /> My Account
              </button>
              {me.user.role === 'Admin' && (
                <button className="menu-item rounded" onClick={() => { setProfile(false); navigate('/settings/users'); }}>
                  <Users size={14} /> Users & Access
                </button>
              )}
              <button className="menu-item rounded" onClick={() => { setProfile(false); navigate('/settings'); }}>
                <Settings size={14} /> Settings
              </button>
            </div>
            {!me.authDisabled && (
              <div className="border-t border-slate-100 p-1.5">
                <button className="menu-item rounded text-red-600 hover:bg-red-50 hover:text-red-700" onClick={signOut}>
                  <LogOut size={14} /> Sign out
                </button>
              </div>
            )}
            <div className="flex items-center gap-1 border-t border-slate-100 px-3 py-2 text-xxs text-slate-400">
              <Sparkles size={12} /> Organization ID: {org.id}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

export default function Layout() {
  const me = useMe();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('cb.sidebar') === 'collapsed';
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem('cb.sidebar', c ? 'open' : 'collapsed');
      } catch {
        /* ignore */
      }
      return !c;
    });
  // Timesheet Staff only have the timesheet and their projects (the server refuses the rest)
  if (me.user.role === 'Timesheet Staff' && !pathname.startsWith('/time-tracking') && pathname !== '/settings/account') return <Navigate to="/time-tracking/timesheet" replace />;
  return (
    <div className="flex h-full bg-canvas">
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="min-h-0 flex-1 p-2 sm:p-3">
          <div className="h-full overflow-auto rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.05)]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
