import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SHOPPING_STORES, normalizeShopIds, productsForStore, remainingForStore, shoppingStores } from '../src/features/shopping-stores';
import { chatUnreadCounts, groupedChatReactions, isChatReaction, sameChatDay } from '../src/features/chat-state';

test('store filters share a product and its bought state instead of making copies', () => {
  const product = { id: 'milk', title: 'Mleko', done: false, shopIds: ['biedronka', 'lidl'] };
  const items = [product, { id: 'bread', title: 'Chleb', done: false, shopIds: [] }];
  assert.strictEqual(productsForStore(items, 'biedronka')[0], product);
  assert.strictEqual(productsForStore(items, 'lidl')[0], product);
  assert.equal(productsForStore(items, 'all').length, 2);
  assert.equal(remainingForStore(items, 'all'), 2);
  product.done = true;
  assert.equal(remainingForStore(items, 'biedronka'), 0);
  assert.equal(remainingForStore(items, 'lidl'), 0);
  assert.equal(remainingForStore(items, 'all'), 1);
});

test('legacy products without assignments remain in the shared list', () => {
  const items = [{ id: 'legacy', done: false }, { id: 'bought', done: true, shopIds: ['dino'] }];
  assert.deepEqual(productsForStore(items, 'all'), items);
  assert.equal(remainingForStore(items, 'all'), 1);
  assert.equal(remainingForStore(items, 'dino'), 0);
});

test('store IDs reject unsafe paths and deduplicate with a bounded assignment size', () => {
  assert.deepEqual(normalizeShopIds(['lidl', 'lidl', '../other', 'A', null, 'store-123']), ['lidl', 'store-123']);
  assert.deepEqual(normalizeShopIds('lidl'), []);
  assert.equal(normalizeShopIds(Array.from({ length: 100 }, (_, index) => `store-${index}`)).length, 20);
});

test('removing a custom store keeps its identity and historical product assignments', () => {
  const archived = { id: 'store-test', name: 'Sklep osiedlowy', archived: true };
  const stores = shoppingStores([archived, { id: 'lidl', name: 'Forged preset' }]);
  assert.equal(stores.length, DEFAULT_SHOPPING_STORES.length + 1);
  assert.equal(stores.find(store => store.id === 'lidl')?.name, 'Lidl');
  assert.equal(stores.find(store => store.id === archived.id)?.archived, true);
  assert.equal(productsForStore([{ shopIds: [archived.id] }], 'all').length, 1);
});

test('unread counts use own cursors, exclude self messages and duplicate snapshots', () => {
  const messages = [
    { id: 'one', uid: 'other', channel: 'family', createdAt: new Date(1000) },
    { id: 'two', uid: 'other', channel: 'family', createdAt: new Date(2000) },
    { id: 'two', uid: 'other', channel: 'family', createdAt: new Date(2000) },
    { id: 'self', uid: 'me', channel: 'family', createdAt: new Date(3000) },
    { id: 'dm', uid: 'other', channel: 'private:me:other', createdAt: new Date(2500) },
    { id: 'pending', uid: 'other', channel: 'family' },
  ];
  assert.deepEqual(chatUnreadCounts(messages, 'me', { family: 1000 }), { family: 1, 'private:me:other': 1 });
  assert.deepEqual(chatUnreadCounts(messages, 'me', { family: 3000, 'private:me:other': 3000 }), {});
  assert.deepEqual(chatUnreadCounts(messages, 'other', {}), { family: 1 });
});

test('emoji reactions retain one entry per UID, with no arbitrary emoji or media payload', () => {
  assert.equal(isChatReaction('❤️'), true);
  assert.equal(isChatReaction('https://example.com/photo.png'), false);
  assert.equal(isChatReaction({ image: 'image' }), false);
  assert.deepEqual(groupedChatReactions([{ uid: 'a', emoji: '👍' }, { uid: 'a', emoji: '👍' }, { uid: 'b', emoji: '👍' }, { uid: 'c', emoji: '❤️' }]), [{ emoji: '❤️', uids: ['c'] }, { emoji: '👍', uids: ['a', 'b'] }]);
});

test('chat day labels handle different years and missing timestamps', () => {
  assert.equal(sameChatDay(new Date(2026, 9, 11, 8), new Date(2026, 9, 11, 19)), true);
  assert.equal(sameChatDay(new Date(2025, 9, 11), new Date(2026, 9, 11)), false);
  assert.equal(sameChatDay(undefined, new Date()), false);
});
