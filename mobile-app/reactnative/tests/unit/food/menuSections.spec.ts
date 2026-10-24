import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sectionsForDisplay } from '@/features/food/menuSections';
import type { RestaurantDetail, MenuItem } from '@/features/food/types';

const item = (id: string): MenuItem => ({ id, name: id, priceKobo: 100, available: true }) as MenuItem;
const base = { id: 'r1', name: 'R' } as unknown as RestaurantDetail;

describe('sectionsForDisplay', () => {
  it('prefers taxonomy sections when non-empty', () => {
    const d = {
      ...base,
      sections: [{ id: 's1', name: 'Rice', items: [item('a')] }],
      menu: [{ id: 'c1', name: 'Legacy', items: [item('b')] }],
    } as RestaurantDetail;
    assert.deepEqual(sectionsForDisplay(d).map((s) => s.name), ['Rice']);
  });
  it('falls back to legacy menu when sections absent or empty', () => {
    const menu = [{ id: 'c1', name: 'Legacy', items: [item('b')] }];
    const out = sectionsForDisplay({ ...base, menu } as RestaurantDetail);
    assert.deepEqual(out, [{ id: 'c1', name: 'Legacy', items: [item('b')] }]);
    assert.equal(sectionsForDisplay({ ...base, sections: [], menu } as RestaurantDetail).length, 1);
  });
  it('drops sections with zero items', () => {
    const d = { ...base, sections: [{ id: null, name: 'Empty', items: [] }, { id: null, name: 'Full', items: [item('a')] }], menu: [] } as RestaurantDetail;
    assert.deepEqual(sectionsForDisplay(d).map((s) => s.name), ['Full']);
    const legacy = { ...base, menu: [{ id: 'c', name: 'E', items: [] }] } as RestaurantDetail;
    assert.deepEqual(sectionsForDisplay(legacy), []);
  });
});
