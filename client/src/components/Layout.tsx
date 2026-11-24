import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Home, Package, ShoppingCart, ShoppingBag, Clock, Landmark, UserCog, BarChart3, FolderOpen, Wallet, CreditCard, ChevronRight, ChevronDown, Search, Plus, Settings, Bell, RefreshCw, PanelLeftClose, PanelLeftOpen, Building2, Check, Sparkles,
} from 'lucide-react';
import clsx from 'clsx';
import { useOrg } from '../lib/app';
import { api, qs } from '../api';
import { useOutside } from './ui';
import { TimerChip } from '../pages/time/common';

type NavItem = { to: string; label: string };
const SALES: NavItem[] = [
  { to: '/sales/customers', label: 'Customers' },
  { to: '/sales/quotes', label: 'Quotes' },
  { to: '/sales/sales-orders', label: 'Sales Orders' },
  { to: '/sales/invoices', label: 'Invoices' },
  { to: '/sales/recurring-invoices', label: 'Recurring Invoices' },
  { to: '/sales/delivery-challans', label: 'Delivery Challans' },
  { to: '/sales/payments-received', label: 'Payments Received' },
  { to: '/sales/credit-notes', label: 'Credit Notes' },
];
const PURCHASES: NavItem[] = [
  { to: '/purchases/vendors', label: 'Vendors' },
  { to: '/purchases/expenses', label: 'Expenses' },
  { to: '/purchases/recurring-expenses', label: 'Recurring Expenses' },
  { to: '/purchases/purchase-orders', label: 'Purchase Orders' },
  { to: '/purchases/bills', label: 'Bills' },
  { to: '/purchases/recurring-bills', label: 'Recurring Bills' },
  { to: '/purchases/payments-made', label: 'Payments Made' },
  { to: '/purchases/vendor-credits', label: 'Vendor Credits' },
];
const ACCOUNTANT: NavItem[] = [
  { to: '/accountant/manual-journals', label: 'Manual Journals' },
  { to: '/accountant/chart-of-accounts', label: 'Chart of Accounts' },
];
const TIME: NavItem[] = [
  { to: '/time-tracking/projects', label: 'Projects' },
  { to: '/time-tracking/timesheet', label: 'Timesheet' },
];

/** Labels used by the top-bar search placeholder ("Search in Invoices ( / )") */
export function moduleLabel(pathname: string): string {
  const all = [...SALES, ...PURCHASES, ...ACCOUNTANT, ...TIME, { to: '/items', label: 'Items' }, { to: '/banking', label: 'Banking' }, { to: '/reports', label: 'Reports' }, { to: '/documents', label: 'Documents' }];
  return all.find((n) => pathname.startsWith(n.to))?.label ?? 'Creatign Books';
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
                  <span
                    role="button"
                    aria-label={`New ${i.label}`}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(`${i.to}/new`);
                    }}
                    className={clsx('rounded px-1 text-sm leading-none', isActive ? 'text-white' : 'invisible text-brand-600 group-hover:visible')}
                  >
                    +
                  </span>
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
  if (collapsed)
    return (
      <aside className="no-print flex w-12 flex-col items-center border-r border-slate-200 bg-slate-50 py-2">
        <button className="btn-ghost w-8 px-0" onClick={onToggle} aria-label="Expand sidebar">
          <PanelLeftOpen size={16} />
        </button>
      </aside>
    );
  const ic = 'shrink-0 text-current opacity-80';
  return (
    <aside className="no-print flex w-[220px] shrink-0 flex-col border-r border-slate-200 bg-slate-50">
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
        <Leaf to="/" end icon={<Home size={15} className={ic} />} label="Home" />
        <Leaf to="/items" icon={<Package size={15} className={ic} />} label="Items" />
        <Group base="/sales" icon={<ShoppingCart size={15} className={ic} />} label="Sales" items={SALES} />
        <Group base="/purchases" icon={<ShoppingBag size={15} className={ic} />} label="Purchases" items={PURCHASES} />
        <Group base="/time-tracking" icon={<Clock size={15} className={ic} />} label="Time Tracking" items={TIME} />
        <Leaf to="/banking" icon={<Landmark size={15} className={ic} />} label="Banking" />
        <Group base="/accountant" icon={<UserCog size={15} className={ic} />} label="Accountant" items={ACCOUNTANT} />
        <Leaf to="/reports" icon={<BarChart3 size={15} className={ic} />} label="Reports" />
        <Leaf to="/documents" icon={<FolderOpen size={15} className={ic} />} label="Documents" />
        <div className="px-2 pb-1 pt-5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Apps</div>
        <Leaf to="/apps/payroll" icon={<Wallet size={15} className={ic} />} label="Payroll" badge="Soon" />
        <Leaf to="/apps/payments" icon={<CreditCard size={15} className={ic} />} label="Payment Gateway" badge="Soon" />
        <div className="pt-4">
          <Link to="/settings/features" className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-700 hover:border-brand-300">
            Configure Features <ChevronRight size={14} />
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
  { group: 'General', items: [{ to: '/items/new', label: 'Item' }, { to: '/accountant/manual-journals/new', label: 'Journal Entry' }, { to: '/time-tracking/timesheet?new=1', label: 'Log Time' }, { to: '/time-tracking/projects/new', label: 'Project' }] },
  { group: 'Sales', items: [{ to: '/sales/customers/new', label: 'Customer' }, { to: '/sales/quotes/new', label: 'Quote' }, { to: '/sales/sales-orders/new', label: 'Sales Order' }, { to: '/sales/invoices/new', label: 'Invoice' }, { to: '/sales/recurring-invoices/new', label: 'Recurring Invoice' }, { to: '/sales/delivery-challans/new', label: 'Delivery Challan' }, { to: '/sales/payments-received/new', label: 'Customer Payment' }, { to: '/sales/credit-notes/new', label: 'Credit Note' }] },
  { group: 'Purchases', items: [{ to: '/purchases/vendors/new', label: 'Vendor' }, { to: '/purchases/expenses/new', label: 'Expense' }, { to: '/purchases/recurring-expenses/new', label: 'Recurring Expense' }, { to: '/purchases/purchase-orders/new', label: 'Purchase Order' }, { to: '/purchases/bills/new', label: 'Bill' }, { to: '/purchases/recurring-bills/new', label: 'Recurring Bill' }, { to: '/purchases/payments-made/new', label: 'Vendor Payment' }, { to: '/purchases/vendor-credits/new', label: 'Vendor Credit' }] },
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
  return (
    <header className="no-print flex h-12 shrink-0 items-center gap-3 bg-ink-900 px-3 text-white">
      <Link to="/" className="flex w-[196px] items-center gap-2">
        <img src="/logo.svg" alt="" className="h-6 w-6" />
        <span className="text-[15px] font-semibold tracking-tight">
          Creatign <span className="font-normal text-brand-300">Books</span>
        </span>
      </Link>
      <button className="rounded p-1 text-slate-300 hover:bg-white/10" title="Refresh" onClick={() => window.location.reload()}>
        <RefreshCw size={15} />
      </button>
      <GlobalSearch />
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
      <div ref={plusRef} className="relative">
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
      </div>
      <button className="rounded p-1 text-slate-300 hover:bg-white/10" title="Notifications" onClick={() => navigate('/?tab=updates')}>
        <Bell size={16} />
      </button>
      <button className="rounded p-1 text-slate-300 hover:bg-white/10" title="Settings" onClick={() => navigate('/settings')}>
        <Settings size={16} />
      </button>
      <div ref={profRef} className="relative">
        <button className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-400 text-[12px] font-semibold text-ink-900" onClick={() => setProfile((p) => !p)} aria-label="Profile">
          {org.name[0]}
        </button>
        {profile && (
          <div className="menu right-0 w-64 p-3 text-slate-800">
            <div className="font-medium">{org.name} Admin</div>
            <div className="text-xxs text-slate-500">{org.email}</div>
            <div className="mt-2 flex items-center gap-1 text-xxs text-slate-500">
              <Sparkles size={12} /> Organization ID: {org.id}
            </div>
            <button
              className="btn-secondary btn-sm mt-3 w-full"
              onClick={() => {
                setProfile(false);
                navigate('/settings');
              }}
            >
              My Account & Settings
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

export default function Layout() {
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
