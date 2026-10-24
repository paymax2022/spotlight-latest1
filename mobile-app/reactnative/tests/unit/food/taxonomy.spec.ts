import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapTaxonomy } from '@/features/food/taxonomy';
import { serializeQueryParams } from '@/features/food/queryString';

describe('mapTaxonomy', () => {
  it('maps nodes + cuisines, sorted by sortOrder, children recursive', () => {
    const out = mapTaxonomy(
      { data: [
        { id: 'b', parent_id: null, name: 'B', slug: 'b', kind: 'category', icon: null, sort_order: 2, children: [] },
        { id: 'a', parent_id: null, name: 'A', slug: 'a', kind: 'category', icon: 'x', sort_order: 1,
          children: [
            { id: 'a2', parent_id: 'a', name: 'A2', slug: 'a2', sort_order: 5 },
            { id: 'a1', parent_id: 'a', name: 'A1', slug: 'a1', sort_order: 3 },
          ] },
      ] },
      { data: [
        { id: 'c2', name: 'Thai', slug: 'thai', sort_order: 2 },
        { id: 'c1', name: 'Igbo', slug: 'igbo', sort_order: 1 },
      ] },
    );
    assert.deepEqual(out.categories.map((c) => c.id), ['a', 'b']);
    assert.equal(out.categories[0].icon, 'x');
    assert.equal(out.categories[1].icon, null);
    assert.equal(out.categories[0].sortOrder, 1);
    assert.deepEqual(out.categories[0].children.map((c) => c.id), ['a1', 'a2']);
    assert.deepEqual(out.cuisines, [
      { id: 'c1', slug: 'igbo', name: 'Igbo' },
      { id: 'c2', slug: 'thai', name: 'Thai' },
    ]);
  });
  it('malformed input yields empty arrays', () => {
    for (const bad of [null, undefined, 'x', 3, {}, { data: 'no' }]) {
      assert.deepEqual(mapTaxonomy(bad, bad), { categories: [], cuisines: [] });
    }
  });
  it('skips rows without an id', () => {
    const out = mapTaxonomy({ data: [{ name: 'x' }] }, { data: [{ slug: 'y' }] });
    assert.deepEqual(out, { categories: [], cuisines: [] });
  });
});

describe('serializeQueryParams', () => {
  it('repeats array params, skips undefined, encodes values', () => {
    const qs = serializeQueryParams({ q: 'a b', cuisine_id: ['x', 'y'], category_id: ['z'], promo: undefined, limit: 20, empty: [] });
    assert.equal(qs, 'q=a%20b&cuisine_id=x&cuisine_id=y&category_id=z&limit=20');
  });
});
