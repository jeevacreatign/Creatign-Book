import { useEffect, useRef, useState, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';
import clsx from 'clsx';
import { Calendar, ChevronDown, X, Search } from 'lucide-react';
import { fmtDate, parseDisplayDate, statusLabel, today } from '@shared/format';
import type { Account, Contact } from '@shared/types';
import { useApi } from '../api';

export { clsx };
import { accountTypeLabel } from '@shared/accountant';

// ------------------------------------------------------------ layout bits

export function Field({ label, required, children, hint, className, inline = true }: { label: ReactNode; required?: boolean; children: ReactNode; hint?: ReactNode; className?: string; inline?: boolean }) {
  return (
    <div className={clsx(inline ? 'grid grid-cols-1 items-start gap-1 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4' : 'flex flex-col gap-1', className)}>
      <label className={clsx(required ? 'label-req' : 'label', inline && 'sm:pt-1.5')}>
        {label}
        {required && '*'}
      </label>
      <div className="min-w-0">
        {children}
        {hint && <div className="mt-1 text-xxs text-slate-500">{hint}</div>}
      </div>
    </div>
  );
}

export function PageHeader({ title, children, sub }: { title: ReactNode; children?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="no-print flex min-h-[56px] items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-2">
      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold">{title}</h1>
        {sub && <div className="text-xs text-slate-500">{sub}</div>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

export function FormFooter({ children }: { children: ReactNode }) {
  return <div className="no-print sticky bottom-0 z-10 flex items-center gap-2 border-t border-slate-200 bg-white px-5 py-3 shadow-[0_-2px_6px_rgba(0,0,0,0.03)]">{children}</div>;
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <div className="p-8 text-center text-slate-400">{label}</div>;
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      {icon && <div className="text-slate-300">{icon}</div>}
      <div className="text-base font-medium text-slate-700">{title}</div>
      {children}
    </div>
  );
}

// ------------------------------------------------------------ status badge

const STATUS_COLORS: Record<string, string> = {
  draft: 'text-slate-500',
  pending_approval: 'text-amber-600',
  approved: 'text-emerald-600',
  rejected: 'text-red-500',
  sent: 'text-sky-600',
  open: 'text-sky-600',
  issued: 'text-sky-600',
  confirmed: 'text-sky-600',
  active: 'text-emerald-600',
  accepted: 'text-emerald-600',
  paid: 'text-emerald-600',
  closed: 'text-emerald-700',
  delivered: 'text-emerald-600',
  billed: 'text-emerald-600',
  invoiced: 'text-emerald-600',
  fulfilled: 'text-emerald-600',
  reimbursed: 'text-emerald-600',
  partially_paid: 'text-amber-600',
  partially_billed: 'text-amber-600',
  partially_invoiced: 'text-amber-600',
  due_today: 'text-amber-600',
  overdue: 'text-orange-600',
  unbilled: 'text-amber-600',
  pending: 'text-amber-600',
  not_invoiced: 'text-slate-500',
  not_billed: 'text-slate-500',
  unpaid: 'text-slate-500',
  non_billable: 'text-slate-500',
  expired: 'text-red-500',
  declined: 'text-red-500',
  void: 'text-slate-400',
  cancelled: 'text-slate-400',
  stopped: 'text-slate-500',
  inactive: 'text-slate-400',
  published: 'text-emerald-600',
  uncategorized: 'text-amber-600',
  categorized: 'text-emerald-600',
  matched: 'text-sky-600',
  excluded: 'text-slate-400',
  reconciled: 'text-emerald-600',
  associated: 'text-emerald-600',
  unassociated: 'text-amber-600',
  locked: 'text-red-500',
};

export function Status({ status, dueDate, className }: { status: string; dueDate?: string; className?: string }) {
  let label = statusLabel(status);
  if (status === 'overdue' && dueDate) {
    const days = Math.round((new Date(today()).getTime() - new Date(dueDate).getTime()) / 86400000);
    label = `OVERDUE BY ${days} DAY${days === 1 ? '' : 'S'}`;
  }
  return <span className={clsx('text-[11px] font-semibold uppercase tracking-wide', STATUS_COLORS[status] || 'text-slate-500', className)}>{label}</span>;
}

export function Pill({ status }: { status: string }) {
  const color = STATUS_COLORS[status] || 'text-slate-500';
  const bg = color.includes('emerald') ? 'bg-emerald-50 border-emerald-200' : color.includes('sky') ? 'bg-sky-50 border-sky-200' : color.includes('amber') || color.includes('orange') ? 'bg-amber-50 border-amber-200' : color.includes('red') ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200';
  return <span className={clsx('inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', bg, color)}>{statusLabel(status)}</span>;
}

// ------------------------------------------------------------ inputs

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx('input', props.className)} />;
}

export function Select({ options, placeholder, className, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string | number; label: string; group?: string }[]; placeholder?: string }) {
  const groups = Array.from(new Set(options.map((o) => o.group).filter(Boolean))) as string[];
  return (
    <select {...props} className={clsx('input pr-7', className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {groups.length
        ? groups.map((g) => (
            <optgroup key={g} label={g}>
              {options.filter((o) => o.group === g).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))
        : options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
    </select>
  );
}

/** Text input that displays/accepts dd/MM/yyyy and stores yyyy-MM-dd, with a native picker. */
export function DateInput({ value, onChange, className, placeholder = 'dd/MM/yyyy', disabled, id }: { value?: string; onChange: (v: string) => void; className?: string; placeholder?: string; disabled?: boolean; id?: string }) {
  const [text, setText] = useState(fmtDate(value));
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => setText(fmtDate(value)), [value]);
  return (
    <div className={clsx('relative', className)}>
      <input
        id={id}
        className="input pr-8"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          const iso = parseDisplayDate(e.target.value);
          if (iso) onChange(iso);
          if (!e.target.value) onChange('');
        }}
        onBlur={() => setText(fmtDate(value))}
      />
      <button type="button" tabIndex={-1} disabled={disabled} aria-label="Pick date" className="absolute right-1.5 top-1.5 text-slate-400 hover:text-slate-600" onClick={() => picker.current?.showPicker?.()}>
        <Calendar size={16} />
      </button>
      <input ref={picker} type="date" tabIndex={-1} aria-hidden className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 opacity-0" value={value || ''} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function MoneyInput({ value, onChange, className, disabled, placeholder, prefix = 'INR' }: { value: number | string | undefined; onChange: (v: string) => void; className?: string; disabled?: boolean; placeholder?: string; prefix?: string }) {
  return (
    <div className={clsx('flex', className)}>
      <span className="inline-flex h-8 items-center rounded-l-md border border-r-0 border-slate-300 bg-slate-50 px-2 text-xs text-slate-500">{prefix}</span>
      <input type="number" step="0.01" min="0" className="input rounded-l-none" value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder={placeholder} />
    </div>
  );
}

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className={clsx('inline-flex cursor-pointer items-center gap-2 text-[13px] text-slate-700', disabled && 'opacity-50')}>
      <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600 accent-brand-600" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Radio<T extends string>({ value, onChange, options, name }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; name: string }) {
  return (
    <div className="flex flex-wrap items-center gap-4 pt-1.5">
      {options.map((o) => (
        <label key={o.value} className="inline-flex cursor-pointer items-center gap-1.5 text-[13px]">
          <input type="radio" name={name} className="accent-brand-600" checked={value === o.value} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

export function AccountSelect({ accounts, value, onChange, filter, placeholder = 'Select an account', className, disabled }: { accounts: Account[]; value?: string; onChange: (v: string) => void; filter?: (a: Account) => boolean; placeholder?: string; className?: string; disabled?: boolean }) {
  const opts = accounts.filter((a) => a.active && (!filter || filter(a))).map((a) => ({ value: a.id, label: a.name, group: accountTypeLabel(a.subType) }));
  return <Select options={opts} value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={className} disabled={disabled} />;
}

/** Searchable contact picker. */
export function ContactPicker({ kind, value, onChange, placeholder, disabled, autoFocus }: { kind: 'customer' | 'vendor'; value?: string; onChange: (id: string, c?: Contact) => void; placeholder?: string; disabled?: boolean; autoFocus?: boolean }) {
  const { data = [] } = useApi<(Contact & { outstanding: number })[]>(`/contacts?kind=${kind}`);
  return (
    <Combo
      value={value}
      disabled={disabled}
      autoFocus={autoFocus}
      placeholder={placeholder || `Select or add a ${kind}`}
      options={data.map((c) => ({ value: c.id, label: c.displayName, sub: [c.companyName !== c.displayName ? c.companyName : '', c.email].filter(Boolean).join(' · ') }))}
      onChange={(id) => onChange(id, data.find((c) => c.id === id))}
      footer={
        <a href={kind === 'customer' ? '/sales/customers/new' : '/purchases/vendors/new'} target="_blank" rel="noreferrer" className="link block px-3 py-2 text-[13px]">
          + New {kind === 'customer' ? 'Client' : 'Supplier'}
        </a>
      }
    />
  );
}

export function Combo({ options, value, onChange, placeholder, disabled, footer, autoFocus, allowFree, freeValue, onFree, className }: { options: { value: string; label: string; sub?: string }[]; value?: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean; footer?: ReactNode; autoFocus?: boolean; allowFree?: boolean; freeValue?: string; onFree?: (text: string) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);
  useOutside(ref, () => setOpen(false));
  const shown = options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()) || o.sub?.toLowerCase().includes(q.toLowerCase())).slice(0, 50);
  const display = selected?.label ?? (allowFree ? freeValue ?? '' : '');
  return (
    <div ref={ref} className={clsx('relative', className)}>
      <div className="relative">
        <input
          className="input pr-7"
          disabled={disabled}
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={open ? q : display}
          onFocus={() => {
            setQ(allowFree ? display : '');
            setOpen(true);
          }}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            if (allowFree) onFree?.(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && open && shown[0]) {
              e.preventDefault();
              onChange(shown[0].value);
              setOpen(false);
            }
            if (e.key === 'Escape') setOpen(false);
          }}
        />
        {value && !disabled ? (
          <button type="button" aria-label="Clear" className="absolute right-2 top-2 text-slate-400 hover:text-slate-600" onClick={() => onChange('')}>
            <X size={14} />
          </button>
        ) : (
          <ChevronDown size={14} className="pointer-events-none absolute right-2 top-2.5 text-slate-400" />
        )}
      </div>
      {open && !disabled && (
        <div className="menu left-0 right-0 max-h-72 overflow-auto">
          {shown.length === 0 && <div className="px-3 py-2 text-slate-400">No results found</div>}
          {shown.map((o) => (
            <button
              type="button"
              key={o.value}
              className={clsx('menu-item flex-col items-start gap-0', o.value === value && 'bg-brand-50')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              <span>{o.label}</span>
              {o.sub && <span className="text-xxs text-slate-500">{o.sub}</span>}
            </button>
          ))}
          {footer && <div className="border-t border-slate-100">{footer}</div>}
        </div>
      )}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = 'Search' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative">
      <Search size={14} className="absolute left-2 top-2.5 text-slate-400" />
      <input className="input pl-7" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

// ------------------------------------------------------------ overlays

export function useOutside(ref: React.RefObject<HTMLElement>, fn: () => void) {
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) fn();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  });
}

export function Dropdown({ button, children, align = 'left', className }: { button: (open: boolean) => ReactNode; children: ReactNode | ((close: () => void) => ReactNode); align?: 'left' | 'right'; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));
  return (
    <div ref={ref} className={clsx('relative inline-block', className)}>
      <div onClick={() => setOpen((o) => !o)}>{button(open)}</div>
      {open && (
        <div className={clsx('menu', align === 'right' ? 'right-0' : 'left-0')} onClick={(e) => (e.target as HTMLElement).closest('[data-close]') && setOpen(false)}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ onClick, children, danger, disabled, icon }: { onClick?: () => void; children: ReactNode; danger?: boolean; disabled?: boolean; icon?: ReactNode }) {
  return (
    <button type="button" data-close className={clsx('menu-item', danger && 'text-red-600 hover:bg-red-50 hover:text-red-700')} onClick={onClick} disabled={disabled}>
      {icon}
      {children}
    </button>
  );
}

export function Modal({ open, onClose, title, children, footer, width = 'max-w-lg' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="no-print fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-16" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal className={clsx('w-full rounded-lg bg-white shadow-xl', width)}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div className="text-[15px] font-semibold">{title}</div>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-red-500">
            <X size={18} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center gap-2 border-t border-slate-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children, footer, width = 'max-w-3xl' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: string }) {
  if (!open) return null;
  return (
    <div className="no-print fixed inset-0 z-50 flex justify-end bg-slate-900/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={clsx('flex h-full w-full flex-col bg-white shadow-2xl', width)}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div className="text-[15px] font-semibold">{title}</div>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-red-500">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center gap-2 border-t border-slate-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ open, title, message, onConfirm, onClose, confirmLabel = 'OK', danger }: { open: boolean; title: string; message: ReactNode; onConfirm: () => void; onClose: () => void; confirmLabel?: string; danger?: boolean }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width="max-w-md"
      footer={
        <>
          <button
            className={danger ? 'btn-danger' : 'btn-primary'}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="text-slate-700">{message}</div>
    </Modal>
  );
}

/** Small hook for "confirm then act" flows. */
export function useConfirm() {
  const [state, setState] = useState<{ title: string; message: ReactNode; action: () => void; danger?: boolean; label?: string } | null>(null);
  const node = state ? <Confirm open title={state.title} message={state.message} onConfirm={state.action} onClose={() => setState(null)} danger={state.danger} confirmLabel={state.label} /> : null;
  return { ask: (title: string, message: ReactNode, action: () => void, opts: { danger?: boolean; label?: string } = {}) => setState({ title, message, action, ...opts }), node };
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={clsx('flex gap-6 border-b border-slate-200', className)}>
      {tabs.map((t) => (
        <button key={t.value} type="button" className={clsx('tab', value === t.value && 'tab-active')} onClick={() => onChange(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function KV({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-3 py-1 text-[13px]">
      <div className="text-slate-500">{k}</div>
      <div className="break-words text-slate-800">{v || '-'}</div>
    </div>
  );
}

export function Section({ title, children, action, className }: { title: ReactNode; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={clsx('mb-6', className)}>
      <div className="mb-2 flex items-center justify-between border-b border-slate-200 pb-1.5">
        <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}
