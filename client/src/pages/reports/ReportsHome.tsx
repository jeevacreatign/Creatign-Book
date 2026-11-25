// Report Library: categories, search, favourites, recently viewed and custom (saved) reports.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BarChart3, Clock, FolderHeart, LayoutGrid, Search, Star, Trash2 } from 'lucide-react';
import { fmtDate } from '@shared/format';
import { api, qs, useAction, useApi } from '../../api';
import { Spinner, clsx, useConfirm } from '../../components/ui';
import { ListHeader } from '../../components/split';
import { favourites, recent, toggleFavourite, useStored, type Catalog } from './common';

type View = 'all' | 'favourites' | 'recent' | 'custom' | string;

export default function ReportsHome() {
  const navigate = useNavigate();
  const { data, isLoading } = useApi<Catalog>('/report-catalog');
  const [view, setView] = useState<View>('all');
  const [search, setSearch] = useState('');
  const favs = useStored(favourites);
  const recents = useStored(recent);
  const del = useAction((id: string) => api(`/saved-reports/${id}`, { method: 'DELETE' }), 'Custom report deleted');
  const confirm = useConfirm();

  const reports = useMemo(() => {
    if (!data) return [];
    const s = search.trim().toLowerCase();
    let list = data.reports;
    if (s) list = list.filter((r) => r.name.toLowerCase().includes(s) || r.category.toLowerCase().includes(s) || r.description.toLowerCase().includes(s));
    else if (view === 'favourites') list = list.filter((r) => favs.includes(r.key));
    else if (view === 'recent') list = recents.map((k) => list.find((r) => r.key === k)).filter(Boolean) as typeof list;
    else if (view !== 'all' && view !== 'custom') list = list.filter((r) => r.category === view);
    return list;
  }, [data, view, search, favs, recents]);

  if (isLoading || !data) return <Spinner />;
  const groups = view === 'recent' && !search ? [['Recently Viewed', reports] as const] : data.categories.map((c) => [c, reports.filter((r) => r.category === c)] as const).filter(([, xs]) => xs.length);
  const custom = data.saved.filter((s) => !search || s.name.toLowerCase().includes(search.toLowerCase()));

  const RailItem = ({ v, icon, children, count }: { v: View; icon?: React.ReactNode; children: React.ReactNode; count?: number }) => (
    <button onClick={() => setView(v)} className={clsx('flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-[13px]', view === v && !search ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-600 hover:bg-slate-100')}>
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {count != null && count > 0 && <span className="text-xs text-slate-400">{count}</span>}
    </button>
  );

  return (
    <div className="flex h-full min-h-0">
      <aside className="no-print hidden w-60 shrink-0 overflow-y-auto border-r border-slate-200 bg-white px-2 py-3 md:block">
        <RailItem v="all" icon={<LayoutGrid size={14} />}>
          All Reports
        </RailItem>
        <RailItem v="favourites" icon={<Star size={14} />} count={favs.length}>
          Favourites
        </RailItem>
        <RailItem v="recent" icon={<Clock size={14} />} count={recents.length}>
          Recently Viewed
        </RailItem>
        <RailItem v="custom" icon={<FolderHeart size={14} />} count={data.saved.length}>
          Custom Reports
        </RailItem>
        <div className="mb-1 mt-4 px-3 text-xxs font-semibold uppercase tracking-wide text-slate-400">Report Category</div>
        {data.categories.map((c) => (
          <RailItem key={c} v={c} count={data.reports.filter((r) => r.category === c).length}>
            {c}
          </RailItem>
        ))}
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <ListHeader title={<h1 className="text-[19px]">Report Library</h1>}>
          <div className="relative w-72">
            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
            <input className="input pl-8" placeholder="Search reports" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search reports" />
          </div>
        </ListHeader>
        <div className="px-5 py-4">
          {(view === 'custom' || search) && (
            <section className="mb-6">
              <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">Custom Reports</h2>
              {custom.length ? (
                <div className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
                  {custom.map((s) => (
                    <div key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                      <FolderHeart size={15} className="text-brand-500" />
                      <Link className="link flex-1 text-[13px] font-medium" to={`/reports/${s.report}${qs({ ...s.params, saved: s.id })}`}>
                        {s.name}
                      </Link>
                      <span className="text-xs text-slate-500">{data.reports.find((r) => r.key === s.report)?.name}</span>
                      <span className="hidden text-xs text-slate-400 sm:inline">Saved {fmtDate(s.createdAt.slice(0, 10))}</span>
                      <button className="text-slate-400 hover:text-red-600" onClick={() => confirm.ask('Delete custom report', `Delete "${s.name}"?`, () => del.mutate(s.id), { danger: true, label: 'Delete' })} aria-label="Delete custom report">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-md border border-dashed border-slate-300 px-4 py-6 text-center text-[13px] text-slate-500">Open any report, set its filters and columns, then choose Save as Custom Report.</p>
              )}
            </section>
          )}
          {view !== 'custom' &&
            groups.map(([g, xs]) => (
              <section key={g} className="mb-6">
                <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{g}</h2>
                <div className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
                  {xs.map((r) => (
                    <div key={r.key} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                      <button onClick={() => toggleFavourite(r.key)} aria-label={favs.includes(r.key) ? 'Remove from favourites' : 'Add to favourites'} className={favs.includes(r.key) ? 'text-amber-400' : 'text-slate-300 hover:text-amber-400'}>
                        <Star size={15} fill={favs.includes(r.key) ? 'currentColor' : 'none'} />
                      </button>
                      <button className="min-w-0 flex-1 text-left" onClick={() => navigate(`/reports/${r.key}`)}>
                        <div className="text-[13px] font-medium text-brand-700 group-hover:underline">{r.name}</div>
                        <div className="truncate text-xs text-slate-500">{r.description}</div>
                      </button>
                      {search && <span className="hidden text-xs text-slate-400 sm:inline">{r.category}</span>}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          {view !== 'custom' && !groups.length && (
            <div className="py-16 text-center text-slate-500">
              <BarChart3 className="mx-auto mb-2 text-slate-300" size={30} />
              {view === 'favourites' ? 'Star the reports you use most to see them here.' : view === 'recent' ? 'Reports you open show up here.' : 'No reports match your search.'}
            </div>
          )}
        </div>
      </div>
      {confirm.node}
    </div>
  );
}
