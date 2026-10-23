import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveTaxonomyIds } from '@/features/food/taxonomyIds';

const tax = {
  cuisines: [{ id: 'c1', slug: 'a', name: 'A' }],
  categories: [{ id: 'k1', name: 'K', slug: 'k', icon: null, sortOrder: 0, children: [] }],
};

describe('effectiveTaxonomyIds', () => {
  it('returns [] when taxonomy is null', () => {
    assert.deepEqual(effectiveTaxonomyIds(['c1'], null, 'cuisines'), []);
    assert.deepEqual(effectiveTaxonomyIds(['k1'], null, 'categories'), []);
  });
  it('drops stale ids', () => {
    assert.deepEqual(effectiveTaxonomyIds(['gone'], tax, 'cuisines'), []);
    assert.deepEqual(effectiveTaxonomyIds(['c1', 'gone'], tax, 'cuisines'), ['c1']);
  });
  it('keeps valid ids per kind', () => {
    assert.deepEqual(effectiveTaxonomyIds(['c1'], tax, 'cuisines'), ['c1']);
    assert.deepEqual(effectiveTaxonomyIds(['k1'], tax, 'categories'), ['k1']);
    assert.deepEqual(effectiveTaxonomyIds(['k1'], tax, 'cuisines'), []);
  });
});
