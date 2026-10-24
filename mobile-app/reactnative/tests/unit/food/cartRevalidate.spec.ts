import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartStorageKey, revalidateCartLines, staleToastMessage } from '@/features/food/cartRevalidate';
import type { CartPackage, MenuCategory } from '@/features/food/types';

const line = (o: Partial<CartPackage['lines'][number]> & { itemId: string }) =>
  ({ name: o.itemId, priceKobo: 1000, qty: 1, restaurantId: 'r1', ...o }) as CartPackage['lines'][number];
const pkg = (lines: CartPackage['lines']): CartPackage => ({ id: 'p1', lines, restaurantId: 'r1' }) as CartPackage;
const menu = (items: { id: string; priceKobo: number; available?: boolean }[]): MenuCategory[] =>
  [{ id: 'c', name: 'c', items: items.map((i) => ({ name: i.id, available: true, ...i })) }] as MenuCategory[];

test('storage key is user scoped', () => {
  assert.equal(cartStorageKey('u-1'), 'food-cart-storage::u-1');
  assert.notEqual(cartStorageKey('u-1'), cartStorageKey('u-2'));
  assert.equal(cartStorageKey(null), 'food-cart-storage::anon');
});

test('unchanged cart is untouched', () => {
  const r = revalidateCartLines([pkg([line({ itemId: 'a', priceKobo: 1000 })])], { r1: menu([{ id: 'a', priceKobo: 1000 }]) });
  assert.equal(r.stale.length, 0);
});

test('price change is re-applied with modifier surcharge kept, and flagged', () => {
  const l = line({ itemId: 'a', priceKobo: 1500, modifierIds: ['m'], modifiers: [{ id: 'm', name: 'x', priceDeltaKobo: 500 }] as never });
  const r = revalidateCartLines([pkg([l])], { r1: menu([{ id: 'a', priceKobo: 1200 }]) });
  assert.equal(r.stale[0].reason, 'price_changed');
  assert.equal(r.packages[0].lines[0].priceKobo, 1700);
});

test('unavailable and removed dishes are flagged, not dropped', () => {
  const r = revalidateCartLines(
    [pkg([line({ itemId: 'a' }), line({ itemId: 'b' })])],
    { r1: menu([{ id: 'a', priceKobo: 1000, available: false }]) },
  );
  assert.deepEqual(r.stale.map((s) => s.reason).sort(), ['removed', 'unavailable']);
  assert.equal(r.packages[0].lines.length, 2);
  assert.match(staleToastMessage(r.stale), /no longer available/);
});

test('a restaurant whose menu failed to load is never flagged', () => {
  const r = revalidateCartLines([pkg([line({ itemId: 'a', restaurantId: 'r2' })])], { r1: menu([]) });
  assert.equal(r.stale.length, 0);
});
