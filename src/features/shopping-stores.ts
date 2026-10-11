/** Store assignments decorate one shared product; they never create another copy. */
export type ShoppingStore = {
  id: string;
  name: string;
  createdBy?: string;
  archived?: boolean;
  preset?: boolean;
};

export const DEFAULT_SHOPPING_STORES: readonly ShoppingStore[] = Object.freeze([
  { id: 'biedronka', name: 'Biedronka', preset: true },
  { id: 'lidl', name: 'Lidl', preset: true },
  { id: 'dino', name: 'Dino', preset: true },
]);

export function normalizeShopIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === 'string'
    && /^[a-z0-9][a-z0-9-]{0,79}$/.test(id)))].slice(0, 20);
}

export function shoppingStores(custom: readonly ShoppingStore[]): ShoppingStore[] {
  const reserved = new Set(DEFAULT_SHOPPING_STORES.map(store => store.id));
  return [...DEFAULT_SHOPPING_STORES, ...custom.filter(store => !reserved.has(store.id))];
}

export function productsForStore<T extends { shopIds?: unknown }>(items: readonly T[], storeId: string): T[] {
  return storeId === 'all' ? [...items] : items.filter(item => normalizeShopIds(item.shopIds).includes(storeId));
}

export function remainingForStore(items: readonly { done: boolean; shopIds?: unknown }[], storeId: string): number {
  return productsForStore(items, storeId).filter(item => !item.done).length;
}
