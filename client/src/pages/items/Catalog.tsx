// Products & Services: price lists for clients and stock adjustments.
import { useEffect, useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2, X, Tags, PackageMinus } from 'lucide-react';
import { fmtDate, money, today } from '@shared/format';
import type { InventoryAdjustment, Item, PriceList } from '@shared/types';
import { api, useAction, useApi } from '../../api';
import { toast } from '../../lib/toast';
import { Field, FormFooter, MoneyInput, PageHeader, Radio, Select, Spinner, clsx, useConfirm } from '../../components/ui';

/** Sub-navigation shared by the Products & Services pages. */
export function ItemsNav() {
  const tab = ({ isActive }: { isActive: boolean }) => clsx('tab', isActive && 'tab-active');
  return (
    <div className="flex gap-5 border-b border-slate-200 px-5 pt-3">
      <NavLink end to="/items" className={tab}>
        Products & Services
      </NavLink>
      <NavLink to="/items/price-lists" className={tab}>
        Price Lists
      </NavLink>
      <NavLink to="/items/adjustments" className={tab}>
        Stock Adjustments
      </NavLink>
    </div>
  );
}

type ListRow = PriceList & { clients: number };

const describe = (l: PriceList) => (l.type === 'per_item' ? `Custom rates for ${l.items.length} item${l.items.length === 1 ? '' : 's'}` : `${l.direction === 'markup' ? 'Mark up' : 'Mark down'} ${l.percentage}%${l.rounding === 'whole' ? ', rounded to the rupee' : l.rounding === 'nearest_10' ? ', rounded to ₹10' : ''}`);

export function PriceLists() {
  const navigate = useNavigate();
  const { data, isLoading } = useApi<ListRow[]>('/price-lists');
  return (
    <div>
      <ItemsNav />
      <div className="flex items-center justify-between px-5 py-4">
        <div>
          <h1 className="text-lg">Price Lists</h1>
          <p className="text-[13px] text-slate-500">Give a client their own selling rates. Pick the list on the client; their estimates, orders and invoices then use it.</p>
        </div>
        <button className="btn-primary" onClick={() => navigate('/items/price-lists/new')}>
          <Plus size={15} /> New Price List
        </button>
      </div>
      {isLoading ? (
        <Spinner />
      ) : data?.length ? (
        <table className="table">
          <thead>
            <tr>
              <th className="pl-5">Name</th>
              <th>Rates</th>
              <th className="text-right">Clients</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.map((l) => (
              <tr key={l.id} className="row-link" onClick={() => navigate(`/items/price-lists/${l.id}`)}>
                <td className="pl-5">
                  <div className="font-medium text-brand-700">{l.name}</div>
                  {l.description && <div className="text-xs text-slate-500">{l.description}</div>}
                </td>
                <td>{describe(l)}</td>
                <td className="text-right tabular-nums">{l.clients}</td>
                <td>
                  <span className={clsx('chip', l.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600')}>{l.status === 'active' ? 'Active' : 'Inactive'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="flex flex-col items-center gap-2 px-6 py-20 text-center">
          <Tags size={28} className="text-brand-500" />
          <div className="text-[15px] font-semibold text-ink-900">No price lists yet</div>
          <p className="max-w-md text-slate-500">Create a list to mark all rates up or down by a percentage, or to set special rates for a few items.</p>
          <button className="btn-primary mt-2" onClick={() => navigate('/items/price-lists/new')}>
            <Plus size={15} /> New Price List
          </button>
        </div>
      )}
    </div>
  );
}

type Detail = PriceList & { clients: { id: string; displayName: string }[]; rates: { itemId: string; name: string; sellingPrice: number; rate: number }[] };

export function PriceListForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';
  const { data: existing } = useApi<Detail>(isNew ? null : `/price-lists/${id}`);
  const { data: items = [] } = useApi<Item[]>('/items?status=active');
  const [f, setF] = useState<Partial<PriceList> | null>(isNew ? { type: 'percentage', direction: 'markdown', percentage: 10, rounding: 'none', items: [], status: 'active' } : null);
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();
  const del = useAction(() => api(`/price-lists/${id}`, { method: 'DELETE' }), 'Price list deleted');
  useEffect(() => {
    if (existing && !f) setF(existing);
  }, [existing, f]);
  if (!f) return <Spinner />;
  const set = (p: Partial<PriceList>) => setF({ ...f, ...p });
  const sellable = items.filter((i) => i.sellable);
  const rateOf = (itemId: string) => f.items?.find((x) => x.itemId === itemId)?.rate;
  const setRate = (itemId: string, v: string) => {
    const rest = (f.items ?? []).filter((x) => x.itemId !== itemId);
    set({ items: v === '' ? rest : [...rest, { itemId, rate: Number(v) }] });
  };
  async function save() {
    setSaving(true);
    try {
      await api(isNew ? '/price-lists' : `/price-lists/${id}`, { method: isNew ? 'POST' : 'PUT', body: f });
      toast.success(`Price list ${isNew ? 'created' : 'updated'}`);
      navigate('/items/price-lists');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader title={isNew ? 'New Price List' : f.name}>
        <button className="btn-ghost w-8 px-0" onClick={() => navigate('/items/price-lists')} aria-label="Close">
          <X size={18} />
        </button>
      </PageHeader>
      <div className="flex-1 space-y-4 px-5 py-5">
        <div className="max-w-3xl space-y-3.5">
          <Field label="Name" required>
            <input className="input max-w-md" value={f.name || ''} onChange={(e) => set({ name: e.target.value })} autoFocus={isNew} />
          </Field>
          <Field label="Description">
            <textarea className="input max-w-md" rows={2} value={f.description || ''} onChange={(e) => set({ description: e.target.value })} />
          </Field>
          <Field label="Rates">
            <Radio name="type" value={f.type || 'percentage'} onChange={(v) => set({ type: v })} options={[{ value: 'percentage', label: 'Mark all items up or down' }, { value: 'per_item', label: 'Custom rate per item' }]} />
          </Field>
          {f.type === 'percentage' && (
            <>
              <Field label="Percentage" required>
                <div className="flex max-w-md gap-2">
                  <Select value={f.direction} onChange={(e) => set({ direction: e.target.value as PriceList['direction'] })} options={[{ value: 'markdown', label: 'Mark down by' }, { value: 'markup', label: 'Mark up by' }]} className="w-40" />
                  <div className="relative w-28">
                    <input className="input pr-7" type="number" min={0} max={100} value={f.percentage ?? ''} onChange={(e) => set({ percentage: Number(e.target.value) })} />
                    <span className="absolute right-2.5 top-1.5 text-slate-400">%</span>
                  </div>
                </div>
              </Field>
              <Field label="Round off to">
                <Select className="max-w-md" value={f.rounding} onChange={(e) => set({ rounding: e.target.value as PriceList['rounding'] })} options={[{ value: 'none', label: 'Never mind (keep paise)' }, { value: 'whole', label: 'Nearest rupee' }, { value: 'nearest_10', label: 'Nearest ₹10' }]} />
              </Field>
            </>
          )}
          <Field label="Status">
            <Radio name="status" value={f.status || 'active'} onChange={(v) => set({ status: v })} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
          </Field>
        </div>
        {f.type === 'per_item' && (
          <div className="card max-w-3xl overflow-hidden">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="text-right">Selling Price</th>
                  <th className="w-48 text-right">Custom Rate</th>
                </tr>
              </thead>
              <tbody>
                {sellable.map((i) => (
                  <tr key={i.id}>
                    <td className="font-medium">{i.name}</td>
                    <td className="text-right tabular-nums text-slate-500">{money(i.sellingPrice)}</td>
                    <td>
                      <MoneyInput value={rateOf(i.id) ?? ''} onChange={(v) => setRate(i.id, v)} placeholder="Same as selling price" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {existing && (
          <div className="max-w-3xl text-[13px] text-slate-600">
            <span className="font-medium text-ink-900">Clients on this list: </span>
            {existing.clients.length ? existing.clients.map((c) => c.displayName).join(', ') : 'none yet. Choose this list on a client (Edit client > Other Details > Price List).'}
          </div>
        )}
      </div>
      <FormFooter>
        <button className="btn-primary" disabled={saving} onClick={save}>
          Save
        </button>
        <button className="btn-secondary" onClick={() => navigate('/items/price-lists')}>
          Cancel
        </button>
        <div className="flex-1" />
        {!isNew && (
          <button className="btn-ghost text-red-600" onClick={() => confirm.ask('Delete price list', `Delete ${f.name}? Clients on it go back to the standard rates.`, () => del.mutate(undefined, { onSuccess: () => navigate('/items/price-lists') }), { danger: true, label: 'Delete' })}>
            <Trash2 size={14} /> Delete
          </button>
        )}
      </FormFooter>
      {confirm.node}
    </div>
  );
}

type AdjRow = Omit<InventoryAdjustment, 'lines'> & { lines: (InventoryAdjustment['lines'][number] & { name: string })[] };
const REASONS = ['Stock count', 'Damaged goods', 'Stolen or lost', 'Samples given away', 'Returned to stock', 'Opening stock correction', 'Other'];

export function Adjustments() {
  const navigate = useNavigate();
  const { data, isLoading } = useApi<AdjRow[]>('/inventory-adjustments');
  const confirm = useConfirm();
  const del = useAction((id: string) => api(`/inventory-adjustments/${id}`, { method: 'DELETE' }), 'Adjustment deleted');
  return (
    <div>
      <ItemsNav />
      <div className="flex items-center justify-between px-5 py-4">
        <div>
          <h1 className="text-lg">Stock Adjustments</h1>
          <p className="text-[13px] text-slate-500">Correct stock on hand after a count, damage or samples. Bills add stock and invoices remove it automatically.</p>
        </div>
        <button className="btn-primary" onClick={() => navigate('/items/adjustments/new')}>
          <Plus size={15} /> New Adjustment
        </button>
      </div>
      {isLoading ? (
        <Spinner />
      ) : data?.length ? (
        <table className="table">
          <thead>
            <tr>
              <th className="pl-5">Date</th>
              <th>Adjustment#</th>
              <th>Reason</th>
              <th>Reference</th>
              <th>Items</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((a) => (
              <tr key={a.id}>
                <td className="pl-5">{fmtDate(a.date)}</td>
                <td className="font-medium">{a.number}</td>
                <td>{a.reason}</td>
                <td>{a.reference}</td>
                <td>
                  {a.lines.map((l) => (
                    <div key={l.itemId}>
                      {l.name} <span className={clsx('tabular-nums font-medium', l.quantity > 0 ? 'text-emerald-700' : 'text-red-600')}>{l.quantity > 0 ? '+' : ''}{l.quantity}</span>
                    </div>
                  ))}
                </td>
                <td className="text-right">
                  <button className="btn-ghost btn-sm text-red-600" aria-label={`Delete ${a.number}`} onClick={() => confirm.ask('Delete adjustment', `Delete ${a.number}? Stock goes back to what it was before it.`, () => del.mutate(a.id), { danger: true, label: 'Delete' })}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="flex flex-col items-center gap-2 px-6 py-20 text-center">
          <PackageMinus size={28} className="text-brand-500" />
          <div className="text-[15px] font-semibold text-ink-900">No adjustments yet</div>
          <p className="max-w-md text-slate-500">Turn on stock tracking for a goods item (Edit item &gt; Inventory) to keep a running count, then record corrections here.</p>
        </div>
      )}
      {confirm.node}
    </div>
  );
}

export function AdjustmentForm() {
  const navigate = useNavigate();
  const { data: items = [] } = useApi<Item[]>('/items?status=active');
  const { data: next } = useApi<{ number: string }>('/inventory-adjustments/next-number');
  const tracked = items.filter((i) => i.trackInventory);
  const [f, setF] = useState({ date: today(), reason: REASONS[0], reference: '', notes: '' });
  const [lines, setLines] = useState<{ itemId: string; counted: string; quantity: string }[]>([{ itemId: '', counted: '', quantity: '' }]);
  const [saving, setSaving] = useState(false);
  const stockOf = (id: string) => tracked.find((i) => i.id === id)?.stockOnHand ?? 0;
  const setLine = (i: number, p: Partial<(typeof lines)[number]>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  async function save() {
    setSaving(true);
    try {
      await api('/inventory-adjustments', { body: { ...f, number: next?.number, lines: lines.filter((l) => l.itemId).map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity) || 0 })) } });
      toast.success('Stock adjusted');
      navigate('/items/adjustments');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader title="New Stock Adjustment">
        <button className="btn-ghost w-8 px-0" onClick={() => navigate('/items/adjustments')} aria-label="Close">
          <X size={18} />
        </button>
      </PageHeader>
      <div className="flex-1 space-y-4 px-5 py-5">
        <div className="max-w-3xl space-y-3.5">
          <Field label="Adjustment#">
            <input className="input max-w-xs" value={next?.number ?? ''} disabled />
          </Field>
          <Field label="Date" required>
            <input className="input max-w-xs" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </Field>
          <Field label="Reason" required>
            <Select className="max-w-xs" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} options={REASONS.map((r) => ({ value: r, label: r }))} />
          </Field>
          <Field label="Reference">
            <input className="input max-w-xs" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
          </Field>
          <Field label="Notes">
            <textarea className="input max-w-md" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </Field>
        </div>
        {!tracked.length ? (
          <div className="max-w-3xl rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900">No item tracks stock yet. Edit a goods item and turn on <b>Track stock</b> first.</div>
        ) : (
          <div className="card max-w-3xl overflow-hidden">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="text-right">On Hand</th>
                  <th className="w-36 text-right">New Count</th>
                  <th className="w-36 text-right">Change</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <Select value={l.itemId} onChange={(e) => setLine(i, { itemId: e.target.value, counted: '', quantity: '' })} placeholder="Select an item" options={tracked.filter((t) => t.id === l.itemId || !lines.some((x) => x.itemId === t.id)).map((t) => ({ value: t.id, label: t.name }))} />
                    </td>
                    <td className="text-right tabular-nums">{l.itemId ? stockOf(l.itemId) : '-'}</td>
                    <td>
                      <input className="input text-right" type="number" value={l.counted} disabled={!l.itemId} onChange={(e) => setLine(i, { counted: e.target.value, quantity: e.target.value === '' ? '' : String(Number(e.target.value) - stockOf(l.itemId)) })} />
                    </td>
                    <td>
                      <input className="input text-right" type="number" value={l.quantity} disabled={!l.itemId} onChange={(e) => setLine(i, { quantity: e.target.value, counted: e.target.value === '' ? '' : String(stockOf(l.itemId) + Number(e.target.value)) })} />
                    </td>
                    <td>
                      {lines.length > 1 && (
                        <button className="btn-ghost btn-sm" aria-label="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                          <X size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-slate-100 px-3 py-2">
              <button className="btn-ghost btn-sm text-brand-700" onClick={() => setLines([...lines, { itemId: '', counted: '', quantity: '' }])} disabled={lines.length >= tracked.length}>
                <Plus size={13} /> Add item
              </button>
            </div>
          </div>
        )}
      </div>
      <FormFooter>
        <button className="btn-primary" disabled={saving || !tracked.length} onClick={save}>
          Save Adjustment
        </button>
        <button className="btn-secondary" onClick={() => navigate('/items/adjustments')}>
          Cancel
        </button>
      </FormFooter>
    </div>
  );
}

/** Stock movements of one tracked item (bills, invoices, notes, adjustments). */
export function StockHistory({ itemId }: { itemId: string }) {
  const navigate = useNavigate();
  const { data } = useApi<{ openingStock: number; stockOnHand: number; movements: { date: string; quantity: number; source: string; sourceId: string; number: string; balance: number }[] }>(`/items/${itemId}/stock`);
  if (!data) return <Spinner />;
  const label: Record<string, string> = { bill: 'Bill', invoice: 'Invoice', credit_note: 'Credit Note', vendor_credit: 'Debit Note', inventory_adjustment: 'Adjustment' };
  const path: Record<string, string> = { bill: '/purchases/bills', invoice: '/sales/invoices', credit_note: '/sales/credit-notes', vendor_credit: '/purchases/vendor-credits' };
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Transaction</th>
          <th className="text-right">Quantity</th>
          <th className="text-right">Stock After</th>
        </tr>
      </thead>
      <tbody>
        {data.movements.map((m, i) => (
          <tr key={i} className={path[m.source] ? 'row-link' : ''} onClick={() => path[m.source] && navigate(`${path[m.source]}/${m.sourceId}`)}>
            <td>{fmtDate(m.date)}</td>
            <td>
              {label[m.source]} <span className="text-brand-700">{m.number}</span>
            </td>
            <td className={clsx('text-right tabular-nums font-medium', m.quantity > 0 ? 'text-emerald-700' : 'text-red-600')}>{m.quantity > 0 ? '+' : ''}{m.quantity}</td>
            <td className="text-right tabular-nums">{m.balance}</td>
          </tr>
        ))}
        <tr>
          <td colSpan={3} className="text-slate-500">Opening stock</td>
          <td className="text-right tabular-nums">{data.openingStock}</td>
        </tr>
      </tbody>
    </table>
  );
}
