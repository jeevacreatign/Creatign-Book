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

function Group({ icon, label, items, base }: { icon: ReactNode; label: string; items: NavItem[]; base: string }) {
  const { pathname } = useLocation();
  const active = pathname.startsWith(base);
  const [open, setOpen] = useState(active);
  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);
  const navigate = useNavigate();
  return (
    <div>
      <button className={clsx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-slate-200/60', active && !open && 'bg-brand-50 text-brand-700')} onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={12} className="text-slate-400" /> : <ChevronRight size={12} className="text-slate-400" />}
        {icon}
        <span>{label}</span>
      </button>
      {open && (
        <div className="ml-5 mt-0.5 space-y-0.5">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} className={({ isActive }) => clsx('group flex items-center justify-between rounded-md px-3 py-1.5 text-[12.5px]', isActive ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-200/60')}>
              {({ isActive }) => (
                <>
                  <span>{i.label}</span>
                  {!i.noNew && <span
                    role="button"
                    aria-label={`New ${i.label}`}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(`${i.to}/new`);
                    }}
                    className={clsx('rounded px-1 text-sm leading-none', isActive ? 'text-white' : 'invisible text-brand-600 group-hover:visible')}
                  >
                    +
                  </span>}
                </>
              )}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function Leaf({ to, icon, label, end, badge }: { to: string; icon: ReactNode; label: string; end?: boolean; badge?: string }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => clsx('flex items-center gap-2 rounded-md py-1.5 pl-[26px] pr-2 text-[13px]', isActive ? 'bg-brand-600 text-white' : 'hover:bg-slate-200/60')}>
      {icon}
      <span className="flex-1">{label}</span>
      {badge && <span className="rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-700">{badge}</span>}
    </NavLink>
  );
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const timeOnly = useMe().user.role === 'Timesheet Staff';
  if (collapsed)
    return (
      <aside className="no-print flex w-12 flex-col items-center border-r border-slate-200 bg-slate-50 py-2">
        <button className="btn-ghost w-8 px-0" onClick={onToggle} aria-label="Expand sidebar">
          <PanelLeftOpen size={16} />
        </button>
      </aside>
    );
  const ic = 'shrink-0 text-current opacity-80';
  if (timeOnly)
    return (
      <aside className="no-print flex w-[220px] shrink-0 flex-col border-r border-slate-200 bg-slate-50">
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
          <Leaf to="/time-tracking/timesheet" icon={<Clock size={15} className={ic} />} label="Timesheet" />
          <Leaf to="/time-tracking/projects" icon={<FolderOpen size={15} className={ic} />} label="My Projects" />
        </nav>
      </aside>
    );
  return (
    <aside className="no-print flex w-[220px] shrink-0 flex-col border-r border-slate-200 bg-slate-50">
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
        <Leaf to="/" end icon={<Home size={15} className={ic} />} label="Dashboard" />
        <Leaf to="/items" icon={<Package size={15} className={ic} />} label="Products & Services" />
        <Group base="/sales" icon={<ShoppingCart size={15} className={ic} />} label="Receivables" items={SALES} />
        <Group base="/purchases" icon={<ShoppingBag size={15} className={ic} />} label="Payables" items={PURCHASES} />
        <Group base="/time-tracking" icon={<Clock size={15} className={ic} />} label="Projects & Time" items={TIME} />
        <Leaf to="/banking" icon={<Landmark size={15} className={ic} />} label="Cash & Bank" />
        <Group base="/accountant" icon={<UserCog size={15} className={ic} />} label="General Ledger" items={ACCOUNTANT} />
        <Leaf to="/reports" icon={<BarChart3 size={15} className={ic} />} label="Financial Reports" />
        <Leaf to="/documents" icon={<FolderOpen size={15} className={ic} />} label="Document Vault" />
        <div className="px-2 pb-1 pt-5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Apps</div>
        <Leaf to="/apps/payroll" icon={<Wallet size={15} className={ic} />} label="Payroll" badge="Soon" />
        <Leaf to="/apps/payments" icon={<CreditCard size={15} className={ic} />} label="Payment Gateway" badge="Soon" />
        <div className="pt-4">
          <Link to="/settings/features" className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-700 hover:border-brand-300">
            Feature Settings <ChevronRight size={14} />
          </Link>
        </div>
      </nav>
      <div className="flex justify-end border-t border-slate-200 p-2">
        <button className="btn-ghost w-8 px-0" onClick={onToggle} aria-label="Collapse sidebar">
          <PanelLeftClose size={16} />
        </button>
      </div>
    </aside>
  );
}

const QUICK_CREATE: { group: string; items: NavItem[] }[] = [
  { group: 'General', items: [{ to: '/items/new', label: 'Product or Service' }, { to: '/accountant/manual-journals/new', label: 'Journal Voucher' }, { to: '/time-tracking/timesheet?new=1', label: 'Log Time' }, { to: '/time-tracking/projects/new', label: 'Project' }] },
  { group: 'Receivables', items: [{ to: '/sales/customers/new', label: 'Client' }, { to: '/sales/quotes/new', label: 'Estimate' }, { to: '/sales/sales-orders/new', label: 'Sales Order' }, { to: '/sales/invoices/new', label: 'Invoice' }, { to: '/sales/recurring-invoices/new', label: 'Invoice Schedule' }, { to: '/sales/delivery-challans/new', label: 'Delivery Challan' }, { to: '/sales/payments-received/new', label: 'Client Payment' }, { to: '/sales/credit-notes/new', label: 'Credit Note' }] },
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
      <Search size={14} className="absolute left-2.5 top-2 text-slate-400" />
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
        placeholder={`Search in ${label} ( / )`}
        className="h-7 w-full rounded-md border border-white/10 bg-white/10 pl-8 pr-2 text-[13px] text-white placeholder:text-slate-400 focus:bg-white focus:text-slate-800 focus:outline-none"
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
    <header className="no-print flex h-12 shrink-0 items-center gap-3 bg-ink-900 px-3 text-white">
      <Link to="/" className="flex w-[196px] items-center gap-2">
        <img src="/logo.svg" alt="" className="h-6 w-6" />
        <span className="text-[15px] font-semibold tracking-tight">
          Creatign <span className="font-normal text-brand-300">Ledger</span>
        </span>
      </Link>
      <button className="rounded p-1 text-slate-300 hover:bg-white/10" title="Refresh" onClick={() => window.location.reload()}>
        <RefreshCw size={15} />
      </button>
      {!timeOnly && <GlobalSearch />}
      <div className="flex-1" />
      <TimerChip />
      <div ref={orgRef} className="relative">
        <button className="flex items-center gap-1.5 rounded px-2 py-1 text-[13px] hover:bg-white/10" onClick={() => setOrgOpen((o) => !o)}>
          <Building2 size={14} className="text-slate-300" />
          {org.name}
          <ChevronDown size={13} className="text-slate-400" />
        </button>
        {orgOpen && (
          <div className="menu right-0 w-72 text-slate-800">
            <div className="px-3 py-2 text-xxs font-semibold uppercase text-slate-400">My Organizations</div>
            <div className="flex items-center gap-3 px-3 py-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-600 font-semibold text-white">{org.logoText || org.name[0]}</div>
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
        <button className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-600 hover:bg-brand-500" aria-label="Quick create" onClick={() => setPlus((p) => !p)}>
          <Plus size={16} />
        </button>
        {plus && (
          <div className="menu right-0 grid w-[620px] grid-cols-3 gap-2 p-3 text-slate-800">
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
                    <Plus size={12} className="text-brand-600" /> {i.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>}
      {!timeOnly && (
        <>
          <button className="rounded p-1 text-slate-300 hover:bg-white/10" title="Notifications" onClick={() => navigate('/?tab=updates')}>
            <Bell size={16} />
          </button>
          <button className="rounded p-1 text-slate-300 hover:bg-white/10" title="Settings" onClick={() => navigate('/settings')}>
            <Settings size={16} />
          </button>
        </>
      )}
      <div ref={profRef} className="relative">
        <button className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-400 text-[12px] font-semibold text-ink-900" onClick={() => setProfile((p) => !p)} aria-label="Profile" title={me.user.name}>
          {initials(me.user.name)}
        </button>
        {profile && (
          <div className="menu right-0 w-72 p-0 text-slate-800">
            <div className="flex items-center gap-3 border-b border-slate-100 p-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-400 text-[15px] font-semibold text-ink-900">{initials(me.user.name)}</span>
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
    <div className="flex h-full flex-col">
      <Topbar />
      <div className="flex min-h-0 flex-1">
        <Sidebar collapsed={collapsed} onToggle={toggle} />
        <main className="min-w-0 flex-1 overflow-auto bg-white">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
