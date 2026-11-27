// Products & Services extras: client price lists, stock on hand for tracked goods, and
// inventory adjustments. Stock is counted (not valued): opening stock, plus bills and debit
// notes reversed, minus invoices and credit notes reversed, plus manual adjustments.
import type { Router } from 'express';
import type { Database, InventoryAdjustment, Item, PriceList } from '../shared/types';
import { isUnposted } from '../shared/approval';
import { round2, today } from '../shared/format';
import { priceFor } from '../shared/pricing';
import { getDb, newId, now, peekNumber, takeNumber } from './db';
import { logActivity } from './engine';
import { HttpError } from './services';

type Wrap = (fn: (req: import('express').Request) => unknown) => import('express').RequestHandler;
const bad = (m: string) => new HttpError(400, m);
const str = (v: unknown) => (v == null ? undefined : String(v).trim() || undefined);
const num = (v: unknown) => (v === '' || v == null || Number.isNaN(Number(v)) ? 0 : Number(v));

// ------------------------------------------------------------------ stock

const COUNTED = new Set(['open', 'sent', 'due_today', 'overdue', 'partially_paid', 'paid', 'closed']);
const SIGN: Partial<Record<string, number>> = { bill: 1, vendor_credit: -1, invoice: -1, credit_note: 1 };

/** Quantity movements per item (positive in, negative out) with their sources. */
export function stockMovements(db: Database, itemId?: string) {
  const rows: { itemId: string; date: string; quantity: number; source: string; sourceId: string; number: string }[] = [];
  for (const d of db.docs) {
    const s = SIGN[d.kind];
    if (!s || isUnposted(d.status) || d.status === 'void' || !COUNTED.has(d.status)) continue;
    for (const l of d.lineItems) if (l.itemId && (!itemId || l.itemId === itemId)) rows.push({ itemId: l.itemId, date: d.date, quantity: s * l.quantity, source: d.kind, sourceId: d.id, number: d.number });
  }
  for (const a of db.inventoryAdjustments ?? []) for (const l of a.lines) if (!itemId || l.itemId === itemId) rows.push({ itemId: l.itemId, date: a.date, quantity: l.quantity, source: 'inventory_adjustment', sourceId: a.id, number: a.number });
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

export function stockLevels(db: Database): Map<string, number> {
  const out = new Map<string, number>();
  for (const i of db.items) if (i.trackInventory) out.set(i.id, num(i.openingStock));
  for (const m of stockMovements(db)) if (out.has(m.itemId)) out.set(m.itemId, round2(out.get(m.itemId)! + m.quantity));
  return out;
}

/** Items as the API returns them: tracked goods carry stockOnHand. */
export function withStock(db: Database, items: Item[]): Item[] {
  const levels = stockLevels(db);
  return items.map((i) => (i.trackInventory ? { ...i, stockOnHand: levels.get(i.id) ?? 0 } : i));
}

function saveAdjustment(db: Database, b: Partial<InventoryAdjustment>): InventoryAdjustment {
  const date = str(b.date) ?? today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('Enter a valid date');
  const reason = str(b.reason);
  if (!reason) throw bad('Reason is required');
  const lines = (b.lines ?? []).map((l) => ({ itemId: String(l.itemId), quantity: round2(num(l.quantity)) })).filter((l) => l.quantity !== 0);
  if (!lines.length) throw bad('Add at least one item with a quantity change');
  for (const l of lines) {
    const item = db.items.find((i) => i.id === l.itemId);
    if (!item) throw bad('Select a valid item');
    if (!item.trackInventory) throw bad(`${item.name} does not track stock. Turn on stock tracking for it first.`);
  }
  if (new Set(lines.map((l) => l.itemId)).size !== lines.length) throw bad('Each item can appear once in an adjustment');
  const number = str(b.number) ?? peekNumber('inventory_adjustment', 'ADJ-');
  if ((db.inventoryAdjustments ?? []).some((a) => a.number === number)) throw bad(`Adjustment ${number} already exists`);
  const a: InventoryAdjustment = { id: newId('adj'), number, date, reason, reference: str(b.reference), notes: str(b.notes), lines, createdAt: now() };
  (db.inventoryAdjustments ??= []).push(a);
  takeNumber('inventory_adjustment', 'ADJ-', number);
  for (const l of lines) logActivity(db, 'item', l.itemId, undefined, `Stock adjusted by ${l.quantity > 0 ? '+' : ''}${l.quantity}`, `${number}: ${reason}`);
  return a;
}

// ------------------------------------------------------------------ price lists

function savePriceList(db: Database, b: Partial<PriceList>, existing?: PriceList): PriceList {
  const name = str(b.name) ?? existing?.name;
  if (!name) throw bad('Name is required');
  if ((db.priceLists ?? []).some((x) => x.name.toLowerCase() === name.toLowerCase() && x.id !== existing?.id)) throw bad(`A price list named "${name}" already exists`);
  const type = (b.type ?? existing?.type ?? 'percentage') as PriceList['type'];
  if (type !== 'percentage' && type !== 'per_item') throw bad('Choose a price list type');
  const percentage = round2(num(b.percentage ?? existing?.percentage));
  if (type === 'percentage' && (percentage <= 0 || percentage > 100)) throw bad('Percentage must be more than 0 and at most 100');
  const items = (b.items ?? existing?.items ?? [])
    .map((x) => ({ itemId: String(x.itemId), rate: round2(num(x.rate)) }))
    .filter((x) => db.items.some((i) => i.id === x.itemId));
  if (items.some((x) => x.rate < 0)) throw bad('Rates cannot be negative');
  if (type === 'per_item' && !items.length) throw bad('Add a custom rate for at least one item');
  const ts = now();
  const list: PriceList = {
    id: existing?.id ?? newId('pl'),
    name,
    description: str(b.description ?? existing?.description),
    type,
    direction: (b.direction ?? existing?.direction) === 'markdown' ? 'markdown' : 'markup',
    percentage: type === 'percentage' ? percentage : 0,
    rounding: (['none', 'whole', 'nearest_10'] as const).includes(b.rounding as never) ? (b.rounding as PriceList['rounding']) : existing?.rounding ?? 'none',
    items: type === 'per_item' ? items : [],
    status: (b.status ?? existing?.status) === 'inactive' ? 'inactive' : 'active',
    createdAt: existing?.createdAt ?? ts,
    updatedAt: ts,
  };
  if (existing) Object.assign(existing, list);
  else (db.priceLists ??= []).push(list);
  return list;
}

export function registerCatalogRoutes(api: Router, h: Wrap, m: Wrap) {
  const p = (req: import('express').Request, k: string) => String(req.params[k]);
  const findList = (id: string) => {
    const x = getDb().priceLists?.find((l) => l.id === id);
    if (!x) throw new HttpError(404, 'Price list not found');
    return x;
  };
  api.get('/price-lists', h(() => {
    const db = getDb();
    return (db.priceLists ?? []).map((l) => ({ ...l, clients: db.contacts.filter((c) => c.priceListId === l.id).length }));
  }));
  api.get('/price-lists/:id', h((req) => {
    const db = getDb();
    const l = findList(p(req, 'id'));
    return {
      ...l,
      clients: db.contacts.filter((c) => c.priceListId === l.id).map((c) => ({ id: c.id, displayName: c.displayName })),
      rates: db.items.filter((i) => i.sellable && i.status === 'active').map((i) => ({ itemId: i.id, name: i.name, sellingPrice: i.sellingPrice, rate: priceFor(l, i) })),
    };
  }));
  api.post('/price-lists', m((req) => savePriceList(getDb(), req.body || {})));
  api.put('/price-lists/:id', m((req) => savePriceList(getDb(), req.body || {}, findList(p(req, 'id')))));
  api.delete('/price-lists/:id', m((req) => {
    const db = getDb();
    const l = findList(p(req, 'id'));
    for (const c of db.contacts) if (c.priceListId === l.id) c.priceListId = undefined;
    db.priceLists = db.priceLists.filter((x) => x.id !== l.id);
    return { ok: true };
  }));
  /** Selling rates of items for a client (used by the item table of sales documents). */
  api.get('/price-lists/for-contact/:contactId', h((req) => {
    const db = getDb();
    const c = db.contacts.find((x) => x.id === p(req, 'contactId'));
    const l = c?.priceListId ? db.priceLists?.find((x) => x.id === c.priceListId && x.status === 'active') : undefined;
    return { priceList: l ? { id: l.id, name: l.name } : null, rates: l ? Object.fromEntries(db.items.map((i) => [i.id, priceFor(l, i)])) : {} };
  }));

  api.get('/inventory-adjustments', h(() => {
    const db = getDb();
    const name = (id: string) => db.items.find((i) => i.id === id)?.name ?? 'Deleted item';
    return [...(db.inventoryAdjustments ?? [])].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).map((a) => ({ ...a, lines: a.lines.map((l) => ({ ...l, name: name(l.itemId) })) }));
  }));
  api.get('/inventory-adjustments/next-number', h(() => ({ number: peekNumber('inventory_adjustment', 'ADJ-') })));
  api.post('/inventory-adjustments', m((req) => saveAdjustment(getDb(), req.body || {})));
  api.delete('/inventory-adjustments/:id', m((req) => {
    const db = getDb();
    const a = db.inventoryAdjustments?.find((x) => x.id === p(req, 'id'));
    if (!a) throw new HttpError(404, 'Adjustment not found');
    db.inventoryAdjustments = db.inventoryAdjustments.filter((x) => x.id !== a.id);
    for (const l of a.lines) logActivity(db, 'item', l.itemId, undefined, `Stock adjustment ${a.number} deleted`);
    return { ok: true };
  }));
  api.get('/items/:id/stock', h((req) => {
    const db = getDb();
    const item = db.items.find((i) => i.id === p(req, 'id'));
    if (!item) throw new HttpError(404, 'Item not found');
    let running = num(item.openingStock);
    const rows = stockMovements(db, item.id).map((r) => ({ ...r, balance: (running = round2(running + r.quantity)) }));
    return { openingStock: num(item.openingStock), stockOnHand: running, reorderLevel: item.reorderLevel, movements: rows.reverse() };
  }));
}
