// Building blocks for the list / split-view pages used by Banking, Accountant and Documents.
import { useState, type ReactNode } from 'react';
import { ChevronDown, Download, MoreHorizontal } from 'lucide-react';
import { Dropdown, MenuItem, clsx } from './ui';

/** "All Journal Vouchers ▾" view switcher used as a page title. */
export function ViewPicker<T extends string>({ value, onChange, options, compact }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; compact?: boolean }) {
  return (
    <Dropdown
      button={() => (
        <button className={clsx('flex items-center gap-1.5 font-semibold text-slate-900', compact ? 'max-w-[180px] text-[15px]' : 'text-[19px]')}>
          <span className="truncate">{options.find((v) => v.value === value)?.label}</span>
          <ChevronDown size={compact ? 14 : 16} className="shrink-0 text-brand-600" />
        </button>
      )}
    >
      {options.map((v) => (
        <MenuItem key={v.value} onClick={() => onChange(v.value)}>
          <span className={clsx(v.value === value && 'font-semibold text-brand-700')}>{v.label}</span>
        </MenuItem>
      ))}
    </Dropdown>
  );
}

export function ListHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="no-print flex min-h-[57px] flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-2.5">
      <div className="min-w-0">{title}</div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function MoreMenu({ children, label = 'More' }: { children: ReactNode | ((close: () => void) => ReactNode); label?: string }) {
  return (
    <Dropdown align="right" button={() => <button className="btn-icon" aria-label={label}><MoreHorizontal size={15} /></button>}>
      {children}
    </Dropdown>
  );
}

export function ToolbarBtn({ children, icon, onClick, disabled }: { children: ReactNode; icon?: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="inline-flex h-10 items-center gap-1.5 border-r border-slate-200 px-3.5 text-[13px] text-slate-700 hover:bg-white hover:text-brand-700 disabled:opacity-40">
      {icon}
      {children}
    </button>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="no-print flex flex-wrap items-center border-b border-slate-200 bg-slate-50/70 px-2">{children}</div>;
}

export function ToolbarMore({ children }: { children: ReactNode | ((close: () => void) => ReactNode) }) {
  return (
    <Dropdown button={() => <button className="btn-ghost h-10 rounded-none border-r border-slate-200 px-3" aria-label="More actions"><MoreHorizontal size={16} /></button>}>
      {children}
    </Dropdown>
  );
}

export function Detail({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={clsx('grid gap-3 py-1.5 text-[13px]', wide ? 'grid-cols-[180px_minmax(0,1fr)]' : 'grid-cols-[140px_minmax(0,1fr)]')}>
      <div className="text-slate-500">{label}</div>
      <div className="text-slate-800">{children || '-'}</div>
    </div>
  );
}

/** Left pane of a split view (fixed width list). */
export function SplitList({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <div className="no-print flex w-[330px] shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex h-[57px] items-center justify-between gap-2 border-b border-slate-200 px-3">{header}</div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

export function DetailHeader({ kicker, title, children }: { kicker?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="no-print flex min-h-[57px] items-center justify-between gap-3 border-b border-slate-200 px-5 py-2">
      <div className="min-w-0">
        {kicker && <div className="text-xs text-slate-500">{kicker}</div>}
        <h1 className="truncate text-[17px] font-semibold">{title}</h1>
      </div>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}

/** Small "Tabs" strip with an underline. */
export function TabStrip<T extends string>({ tabs, value, onChange, className }: { tabs: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={clsx('flex gap-6 border-b border-slate-200', className)}>
      {tabs.map((t) => (
        <button key={t.value} className={clsx('tab', value === t.value && 'tab-active')} onClick={() => onChange(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Bulk selection helper for tables with checkboxes. */
export function useSelection(ids: string[]) {
  const [sel, setSel] = useState<string[]>([]);
  const live = sel.filter((x) => ids.includes(x));
  return {
    selected: live,
    all: ids.length > 0 && live.length === ids.length,
    toggle: (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])),
    toggleAll: () => setSel(live.length === ids.length ? [] : ids),
    clear: () => setSel([]),
  };
}

/** Download text content as a file (CSV exports). */
export function downloadText(name: string, text: string, type = 'text/csv') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function csvOf(rows: (string | number | undefined | null)[][]) {
  return rows.map((r) => r.map((c) => (c == null ? '' : /[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(',')).join('\n');
}

export function ExportItem({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <MenuItem icon={<Download size={13} />} onClick={onClick}>
      {children}
    </MenuItem>
  );
}
