import { taxLabel } from '@shared/gst';
import { useEffect, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, MoreHorizontal, Pencil, Plus, X } from 'lucide-react';
import { DOC_META } from '@shared/docmeta';
import { fmtDate, money } from '@shared/format';
import { UNITS, type Contact, type DocKind, type Item } from '@shared/types';
import { api, useAction, useApi } from '../../api';
import { useBoot } from '../../lib/app';
import { toast } from '../../lib/toast';
import { ExportMenu } from '../../components/ExportMenu';
import { AdjustmentForm, Adjustments, ItemsNav, PriceListForm, PriceLists, StockHistory } from './Catalog';
import { AccountSelect, Checkbox, Combo, Dropdown, Field, FormFooter, KV, MenuItem, MoneyInput, PageHeader, Radio, SearchBox, Select, Spinner, Status, Tabs, clsx, useConfirm } from '../../components/ui';

type ItemDetail = Item & { usage: { id: string; kind: DocKind; number: string; date: string; status: string; contact: string; total: number }[] };

function ItemList() {
  const navigate = useNavigate();
  const { accounts } = useBoot();
  const [status, setStatus] = useState('active');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const { data = [], isLoading } = useApi<Item[]>(`/items?status=${status}&q=${encodeURIComponent(q)}`);
  const acct = (id: string) => accounts.find((a) => a.id === id)?.name;
  const allSelected = data.length > 0 && data.every((i) => selected.includes(i.id));
  const exportRows = selected.length ? data.filter((i) => selected.includes(i.id)) : data;
  const views = [
    { value: 'all', label: 'All Products & Services' },
    { value: 'active', label: 'Active Items' },
    { value: 'inactive', label: 'Inactive Items' },
  ];
  const tracking = data.some((i) => i.trackInventory);
  return (
    <div>
      <ItemsNav />
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <Dropdown button={() => <button className="flex items-center gap-1 text-[15px] font-semibold">{views.find((v) => v.value === status)?.label} <ChevronDown size={15} className="text-brand-600" /></button>}>
          {views.map((v) => (
            <MenuItem key={v.value} onClick={() => { setStatus(v.value); setSelected([]); }}>
              {v.label}
            </MenuItem>
          ))}
        </Dropdown>
        <div className="flex items-center gap-2">
          <ExportMenu
            rows={exportRows}
            filename="products-and-services"
            label={selected.length ? 'Export Selected' : 'Export'}
            columns={[
              { header: 'Name', value: (i) => i.name },
              { header: 'Type', value: (i) => i.type },
              { header: 'Purchase Description', value: (i) => i.purchaseDescription },
              { header: 'Purchase Rate', value: (i) => i.purchasable ? i.costPrice : '' },
              { header: 'Description', value: (i) => i.salesDescription },
              { header: 'Rate', value: (i) => i.sellable ? i.sellingPrice : '' },
              { header: 'Usage Unit', value: (i) => i.unit },
            ]}
          />
        <button className="btn-primary" onClick={() => navigate('/items/new')}>
          <Plus size={15} /> New
        </button>
        </div>
      </div>
      <div className="px-5 py-3">
        <div className="w-72">
          <SearchBox value={q} onChange={(v) => { setQ(v); setSelected([]); }} placeholder="Search items" />
        </div>
      </div>
      {isLoading ? (
        <Spinner />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th className="w-8 pl-4">
                <input type="checkbox" className="accent-brand-600" checked={allSelected} onChange={() => setSelected(allSelected ? [] : data.map((i) => i.id))} aria-label="Select all" />
              </th>
              <th>Name</th>
              <th>Purchase Description</th>
              <th className="text-right">Purchase Rate</th>
              <th>Description</th>
              <th className="text-right">Rate</th>
              {tracking && <th className="text-right">Stock on Hand</th>}
              <th>Usage Unit</th>
            </tr>
          </thead>
          <tbody>
            {data.map((i) => (
            <tr key={i.id} className={clsx('row-link', selected.includes(i.id) && 'bg-brand-50/50')} onClick={() => navigate(`/items/${i.id}`)}>
              <td className="pl-4" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" className="accent-brand-600" checked={selected.includes(i.id)} onChange={() => setSelected((s) => s.includes(i.id) ? s.filter((x) => x !== i.id) : [...s, i.id])} aria-label={`Select ${i.name}`} />
              </td>
                <td>
                  <div className="font-medium text-brand-600">{i.name}</div>
                  <div className="text-xxs uppercase text-slate-400">{i.type}</div>
                </td>
                <td className="max-w-[220px] truncate text-slate-600">{i.purchaseDescription}</td>
                <td className="text-right tabular-nums">{i.purchasable ? money(i.costPrice) : '-'}</td>
                <td className="max-w-[220px] truncate text-slate-600">{i.salesDescription}</td>
                <td className="text-right tabular-nums">{i.sellable ? money(i.sellingPrice) : '-'}</td>
                {tracking && (
                  <td className="text-right tabular-nums">
                    {i.trackInventory ? (
                      <span className={clsx((i.stockOnHand ?? 0) <= (i.reorderLevel ?? -Infinity) && 'font-semibold text-red-600')} title={(i.stockOnHand ?? 0) <= (i.reorderLevel ?? -Infinity) ? 'At or below the reorder level' : undefined}>
                        {i.stockOnHand ?? 0}
                      </span>
                    ) : (
                      <span className="text-slate-300">-</span>
                    )}
                  </td>
                )}
                <td>{i.unit}</td>
              </tr>
            ))}
            {!data.length && (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-400">
                  No items yet. <Link to="/items/new" className="link">Create your first item</Link>.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      <div className="sr-only">{acct('')}</div>
    </div>
  );
}

function ItemForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { accounts } = useBoot();
  const { data: existing } = useApi<Item>(id ? `/items/${id}` : null);
  const { data: vendors = [] } = useApi<Contact[]>('/contacts?kind=vendor');
  const [f, setF] = useState<Partial<Item> | null>(id ? null : { type: 'goods', sellable: true, purchasable: true, salesAccountId: 'acc_sales', purchaseAccountId: 'acc_cogs', unit: '' });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (existing && !f) setF(existing);
  }, [existing, f]);
  if (!f) return <Spinner />;
  const set = (p: Partial<Item>) => setF({ ...f, ...p });
  async function save() {
    setSaving(true);
    try {
      const saved = await api<Item>(id ? `/items/${id}` : '/items', { method: id ? 'PUT' : 'POST', body: f });
      toast.success(`Item ${id ? 'updated' : 'created'}`);
      navigate(`/items/${saved.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader title={id ? 'Edit Item' : 'New Item'}>
        <button className="btn-ghost w-8 px-0" onClick={() => navigate(-1)} aria-label="Close">
          <X size={18} />
        </button>
      </PageHeader>
      <div className="flex-1 space-y-5 px-5 py-5">
        <div className="max-w-5xl space-y-4 rounded-md bg-slate-50 p-4">
          <Field label="Name" required>
            <input className="input max-w-md" value={f.name || ''} onChange={(e) => set({ name: e.target.value })} autoFocus />
          </Field>
          <Field label="Type">
            <Radio name="type" value={f.type || 'goods'} onChange={(v) => set({ type: v })} options={[{ value: 'goods', label: 'Goods' }, { value: 'service', label: 'Service' }]} />
          </Field>
          <Field label="Unit">
            <Combo className="max-w-md" allowFree freeValue={f.unit} onFree={(v) => set({ unit: v })} value={f.unit} onChange={(v) => set({ unit: v })} placeholder="Select or type to add" options={UNITS.map((u) => ({ value: u, label: u }))} />
          </Field>
        </div>
        <div className="max-w-5xl border-t border-slate-200 pt-5">
          <div className="mb-4">
            <Checkbox checked={!!f.sellable} onChange={(v) => set({ sellable: v })} label={<span className="font-semibold">Sales Information</span>} />
          </div>
          <div className="grid max-w-5xl gap-x-8 gap-y-3 md:grid-cols-2">
            <Field label="Selling Price" required={f.sellable}>
              <MoneyInput value={f.sellingPrice} onChange={(v) => set({ sellingPrice: v as unknown as number })} disabled={!f.sellable} />
            </Field>
            <Field label="Account" required={f.sellable}>
              <AccountSelect accounts={accounts} value={f.salesAccountId} onChange={(v) => set({ salesAccountId: v })} filter={(a) => a.type === 'income'} disabled={!f.sellable} />
            </Field>
            <Field label="Description">
              <textarea className="input" rows={3} value={f.salesDescription || ''} onChange={(e) => set({ salesDescription: e.target.value })} disabled={!f.sellable} />
            </Field>
          </div>
        </div>
        <div className="max-w-5xl border-t border-slate-200 pt-5">
          <div className="mb-4">
            <Checkbox checked={!!f.purchasable} onChange={(v) => set({ purchasable: v })} label={<span className="font-semibold">Purchase Information</span>} />
          </div>
          <div className="grid max-w-5xl gap-x-8 gap-y-3 md:grid-cols-2">
            <Field label="Cost Price" required={f.purchasable}>
              <MoneyInput value={f.costPrice} onChange={(v) => set({ costPrice: v as unknown as number })} disabled={!f.purchasable} />
            </Field>
            <Field label="Account" required={f.purchasable}>
              <AccountSelect accounts={accounts} value={f.purchaseAccountId} onChange={(v) => set({ purchaseAccountId: v })} filter={(a) => a.type === 'expense' || a.subType === 'fixed_asset'} disabled={!f.purchasable} />
            </Field>
            <Field label="Description">
              <textarea className="input" rows={3} value={f.purchaseDescription || ''} onChange={(e) => set({ purchaseDescription: e.target.value })} disabled={!f.purchasable} />
            </Field>
            <Field label="Preferred Vendor">
              <Select value={f.preferredVendorId || ''} onChange={(e) => set({ preferredVendorId: e.target.value || undefined })} placeholder="" options={vendors.map((v) => ({ value: v.id, label: v.displayName }))} disabled={!f.purchasable} />
            </Field>
          </div>
        </div>
        {f.type !== 'service' && (
          <div className="max-w-5xl border-t border-slate-200 pt-5">
            <div className="mb-1">
              <Checkbox checked={!!f.trackInventory} onChange={(v) => set({ trackInventory: v })} label={<span className="font-semibold">Track stock for this item</span>} />
            </div>
            <p className="mb-4 ml-6 text-xs text-slate-500">Bills and debit notes add stock, invoices and credit notes remove it, and Stock Adjustments correct it.</p>
            {f.trackInventory && (
              <div className="grid max-w-5xl gap-x-8 gap-y-3 md:grid-cols-2">
                <Field label="Opening Stock">
                  <input className="input" type="number" value={f.openingStock ?? ''} onChange={(e) => set({ openingStock: e.target.value as unknown as number })} />
                </Field>
                <Field label="Reorder Level" hint="The item is flagged when stock falls to this level.">
                  <input className="input" type="number" min={0} value={f.reorderLevel ?? ''} onChange={(e) => set({ reorderLevel: e.target.value as unknown as number })} />
                </Field>
              </div>
            )}
          </div>
        )}
      </div>
      <FormFooter>
        <button className="btn-primary" disabled={saving} onClick={save}>
          Save
        </button>
        <button className="btn-secondary" onClick={() => navigate(-1)}>
          Cancel
        </button>
      </FormFooter>
    </div>
  );
}

function ItemDetailView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { accounts } = useBoot();
  const { data: list = [] } = useApi<Item[]>('/items?status=all');
  const { data: i } = useApi<ItemDetail>(`/items/${id}`);
  const [tab, setTab] = useState('overview');
  const confirm = useConfirm();
  const status = useAction((s: string) => api(`/items/${id}`, { method: 'PUT', body: { status: s } }), 'Item status updated');
  const del = useAction(() => api(`/items/${id}`, { method: 'DELETE' }), 'Item deleted');
  const acct = (aid: string) => accounts.find((a) => a.id === aid)?.name;
  return (
    <div className="flex h-full">
      <div className="w-[280px] shrink-0 overflow-y-auto border-r border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5">
          <span className="font-semibold">All Items</span>
          <button className="btn-primary w-8 px-0" onClick={() => navigate('/items/new')} aria-label="New item">
            <Plus size={15} />
          </button>
        </div>
        {list.map((x) => (
          <Link key={x.id} to={`/items/${x.id}`} className={clsx('block border-b border-slate-100 px-3 py-2.5 hover:bg-slate-50', x.id === id && 'bg-brand-50/70')}>
            <div className="flex justify-between">
              <span className="font-medium">{x.name}</span>
              <span className="tabular-nums">{money(x.sellingPrice)}</span>
            </div>
            <div className="text-xxs uppercase text-slate-400">{x.type}{x.status === 'inactive' ? ' · inactive' : ''}</div>
          </Link>
        ))}
      </div>
      {!i ? (
        <Spinner />
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
            <h1 className="text-lg">{i.name}</h1>
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={() => navigate(`/items/${i.id}/edit`)}>
                <Pencil size={14} /> Edit
              </button>
              <Dropdown align="right" button={() => <button className="btn-icon" aria-label="More"><MoreHorizontal size={15} /></button>}>
                <MenuItem onClick={() => status.mutate(i.status === 'active' ? 'inactive' : 'active')}>Mark as {i.status === 'active' ? 'Inactive' : 'Active'}</MenuItem>
                <MenuItem onClick={() => navigate(`/items/new`)}>New Item</MenuItem>
                <MenuItem danger onClick={() => confirm.ask('Delete item', `Delete ${i.name}?`, () => del.mutate(undefined, { onSuccess: () => navigate('/items') }), { danger: true, label: 'Delete' })}>
                  Delete
                </MenuItem>
              </Dropdown>
              <button className="btn-ghost w-8 px-0" onClick={() => navigate('/items')} aria-label="Close">
                <X size={18} />
              </button>
            </div>
          </div>
          <div className="px-5 py-4">
            <Tabs tabs={[{ value: 'overview', label: 'Overview' }, { value: 'transactions', label: 'Transactions' }, ...(i.trackInventory ? [{ value: 'stock', label: 'Stock History' }] : [])]} value={tab} onChange={setTab} className="mb-4" />
            {tab === 'stock' && i.trackInventory ? (
              <StockHistory itemId={i.id} />
            ) : tab === 'overview' ? (
              <div className="max-w-3xl space-y-6">
                <div>
                  <KV k="Item Type" v={i.type === 'goods' ? 'Goods' : 'Service'} />
                  <KV k="SKU" v={i.sku} />
                  <KV k="Unit" v={i.unit} />
                  <KV k="Status" v={<Status status={i.status} />} />
                  <KV k="Created" v={fmtDate(i.createdAt.slice(0, 10))} />
                </div>
                {i.trackInventory && (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="card p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Stock on Hand</div>
                      <div className={clsx('mt-1 text-2xl font-semibold tabular-nums', (i.stockOnHand ?? 0) <= (i.reorderLevel ?? -Infinity) ? 'text-red-600' : 'text-ink-900')}>{i.stockOnHand ?? 0} <span className="text-sm font-normal text-slate-500">{i.unit}</span></div>
                    </div>
                    <div className="card p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Reorder Level</div>
                      <div className="mt-1 text-2xl font-semibold tabular-nums text-ink-900">{i.reorderLevel ?? '-'}</div>
                    </div>
                    <div className="card flex items-center justify-center p-4">
                      <button className="btn-secondary" onClick={() => navigate('/items/adjustments/new')}>Adjust Stock</button>
                    </div>
                  </div>
                )}
                <div className="grid gap-6 md:grid-cols-2">
                  <div className="rounded-md border border-slate-200 p-4">
                    <div className="mb-2 font-semibold">Sales Information</div>
                    <KV k="Selling Price" v={money(i.sellingPrice)} />
                    <KV k="Sales Account" v={acct(i.salesAccountId)} />
                    <KV k="Description" v={i.salesDescription} />
                  </div>
                  <div className="rounded-md border border-slate-200 p-4">
                    <div className="mb-2 font-semibold">Purchase Information</div>
                    <KV k="Cost Price" v={money(i.costPrice)} />
                    <KV k="HSN/SAC" v={i.hsnSac} />
                    <KV k="Tax" v={i.taxId ? taxLabel(i.taxId, true) : i.taxPreference === 'taxable' || !i.taxPreference ? '-' : i.taxPreference} />
                    <KV k="Purchase Account" v={acct(i.purchaseAccountId)} />
                    <KV k="Description" v={i.purchaseDescription} />
                  </div>
                </div>
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Number</th>
                    <th>Contact</th>
                    <th>Status</th>
                    <th className="text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {i.usage.map((u) => (
                    <tr key={u.id} className="row-link" onClick={() => navigate(`${DOC_META[u.kind].path}/${u.id}`)}>
                      <td>{fmtDate(u.date)}</td>
                      <td>{DOC_META[u.kind].label}</td>
                      <td className="text-brand-600">{u.number}</td>
                      <td>{u.contact}</td>
                      <td>
                        <Status status={u.status} />
                      </td>
                      <td className="text-right">{money(u.total)}</td>
                    </tr>
                  ))}
                  {!i.usage.length && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400">
                        This item has not been used in any transaction yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
      {confirm.node}
    </div>
  );
}

export default function Items() {
  return (
    <Routes>
      <Route index element={<ItemList />} />
      <Route path="price-lists" element={<PriceLists />} />
      <Route path="price-lists/:id" element={<PriceListForm />} />
      <Route path="adjustments" element={<Adjustments />} />
      <Route path="adjustments/new" element={<AdjustmentForm />} />
      <Route path="new" element={<ItemForm />} />
      <Route path=":id/edit" element={<ItemForm />} />
      <Route path=":id" element={<ItemDetailView />} />
    </Routes>
  );
}
