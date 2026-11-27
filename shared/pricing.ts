import type { Item, PriceList } from './types';
import { round2 } from './format';

/** Selling rate of an item for a client on this price list (the item's own rate when the list has none). */
export function priceFor(list: PriceList | undefined, item: Pick<Item, 'id' | 'sellingPrice'>): number {
  if (!list || list.status !== 'active') return item.sellingPrice;
  if (list.type === 'per_item') return list.items.find((x) => x.itemId === item.id)?.rate ?? item.sellingPrice;
  const pct = (Number(list.percentage) || 0) / 100;
  const raw = item.sellingPrice * (list.direction === 'markdown' ? 1 - pct : 1 + pct);
  if (list.rounding === 'whole') return Math.round(raw);
  if (list.rounding === 'nearest_10') return Math.round(raw / 10) * 10;
  return round2(raw);
}
