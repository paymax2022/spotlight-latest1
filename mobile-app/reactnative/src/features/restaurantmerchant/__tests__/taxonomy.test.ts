// node --experimental-strip-types --test "src/features/restaurantmerchant/__tests__/taxonomy.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nairaToKobo, parsePrepMinutes, subcategoriesFor, validateItemDraft, type TaxonomyCategory,
} from '../taxonomy.ts';

const tree: TaxonomyCategory[] = [
  { id: 'rice', name: 'Rice Dishes', slug: 'rice-dishes', kind: 'FOOD', children: [
    { id: 'jollof', name: 'Jollof Rice', slug: 'jollof-rice' },
    { id: 'fried', name: 'Fried Rice', slug: 'fried-rice' },
  ] },
  { id: 'desserts', name: 'Desserts', slug: 'desserts', kind: 'FOOD', children: [] },
];

test('naira converts to kobo as text, never through a float', () => {
  assert.equal(nairaToKobo('2500'), 250000);
  assert.equal(nairaToKobo('350.5'), 35050);
  assert.equal(nairaToKobo('0.1'), 10);
  assert.equal(nairaToKobo('1,200.75'), 120075);
  assert.equal(nairaToKobo('  900  '), 90000);
});

test('bad or non-positive prices are refused', () => {
  for (const bad of ['', '0', '0.00', '-5', 'abc', '12.345', '1e3', '2500.', '.5']) {
    assert.equal(nairaToKobo(bad), null, `expected ${JSON.stringify(bad)} to be refused`);
  }
});

test('sub-categories depend on the chosen category and nothing else', () => {
  assert.deepEqual(subcategoriesFor(tree, 'rice').map((s) => s.id), ['jollof', 'fried']);
  assert.deepEqual(subcategoriesFor(tree, 'desserts'), []);
  assert.deepEqual(subcategoriesFor(tree, null), []);
  assert.deepEqual(subcategoriesFor(tree, 'missing'), []);
});

test('a valid draft becomes the server payload', () => {
  const r = validateItemDraft({ categoryId: 'rice', subcategoryId: 'jollof', name: '  Party Jollof ', priceNaira: '3500' }, tree);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.payload, {
      taxonomyCategoryId: 'rice', taxonomySubcategoryId: 'jollof', name: 'Party Jollof', priceKobo: 350000,
    });
  }
});

test('a category is required: the owner cannot add an item with none', () => {
  const r = validateItemDraft({ categoryId: null, subcategoryId: null, name: 'Mystery', priceNaira: '100' }, tree);
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.category);
});

test('a sub-category from another category is refused', () => {
  const r = validateItemDraft({ categoryId: 'desserts', subcategoryId: 'jollof', name: 'X', priceNaira: '100' }, tree);
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.subcategory);
});

test('an unknown category id is refused', () => {
  const r = validateItemDraft({ categoryId: 'ghost', subcategoryId: null, name: 'X', priceNaira: '100' }, tree);
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.category);
});

test('name and price errors are reported together', () => {
  const r = validateItemDraft({ categoryId: 'rice', subcategoryId: null, name: '   ', priceNaira: '0' }, tree);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.name);
    assert.ok(r.errors.price);
    assert.equal(r.errors.category, undefined);
  }
});

test('prep time: empty means the restaurant default, otherwise whole minutes 5 to 180', () => {
  assert.equal(parsePrepMinutes(''), undefined);
  assert.equal(parsePrepMinutes('   '), undefined);
  assert.equal(parsePrepMinutes('5'), 5);
  assert.equal(parsePrepMinutes('25'), 25);
  assert.equal(parsePrepMinutes('180'), 180);
  for (const bad of ['4', '181', '12.5', '-5', 'abc', '1e2']) {
    assert.equal(parsePrepMinutes(bad), null, `${bad} should be refused`);
  }
});

test('an out-of-range prep time is reported on the form and not sent', () => {
  const r = validateItemDraft({ categoryId: 'rice', subcategoryId: null, name: 'X', priceNaira: '100', prepMinutes: '400' }, tree);
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.prep);
});

test('a valid prep time is carried in the payload; an empty one is left out', () => {
  const withPrep = validateItemDraft({ categoryId: 'rice', subcategoryId: null, name: 'X', priceNaira: '100', prepMinutes: '20' }, tree);
  assert.equal(withPrep.ok && withPrep.payload.prepTimeMinutes, 20);
  const without = validateItemDraft({ categoryId: 'rice', subcategoryId: null, name: 'X', priceNaira: '100', prepMinutes: '' }, tree);
  assert.equal(without.ok && 'prepTimeMinutes' in without.payload, false);
});
