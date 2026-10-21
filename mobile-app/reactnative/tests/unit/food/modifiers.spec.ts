// FOOD-UAT-C-005: modifier selection rules, running price and line identity.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  toggleSelection, validateSelection, runningUnitPriceKobo, resolveSelection, lineKeyOf,
} from '@/features/food/modifiers';
import type { ModifierGroup } from '@/features/food/types';

const size: ModifierGroup = {
  id: 'g-size', name: 'Size', required: true, minSelect: 1, maxSelect: 1,
  options: [
    { id: 'm-reg', name: 'Regular', priceDeltaKobo: 0 },
    { id: 'm-lg', name: 'Large', priceDeltaKobo: 50000 },
  ],
};
const extras: ModifierGroup = {
  id: 'g-ex', name: 'Extras', required: false, minSelect: 0, maxSelect: 2,
  options: [
    { id: 'm-egg', name: 'Egg', priceDeltaKobo: 20000 },
    { id: 'm-fish', name: 'Fish', priceDeltaKobo: 70000 },
    { id: 'm-plan', name: 'Plantain', priceDeltaKobo: 30000 },
  ],
};
const groups = [size, extras];

describe('toggleSelection', () => {
  it('required single-choice behaves as a radio and cannot be cleared', () => {
    let s = toggleSelection(size, [], 'm-reg');
    assert.deepEqual(s, ['m-reg']);
    s = toggleSelection(size, s, 'm-lg');
    assert.deepEqual(s, ['m-lg']);
    assert.deepEqual(toggleSelection(size, s, 'm-lg'), ['m-lg']);
  });
  it('optional multi-select toggles and caps at max', () => {
    let s = toggleSelection(extras, [], 'm-egg');
    s = toggleSelection(extras, s, 'm-fish');
    s = toggleSelection(extras, s, 'm-plan'); // over the cap: ignored
    assert.deepEqual(s, ['m-egg', 'm-fish']);
    assert.deepEqual(toggleSelection(extras, s, 'm-egg'), ['m-fish']);
  });
});

describe('validateSelection', () => {
  it('flags an unpicked required group only', () => {
    assert.deepEqual(Object.keys(validateSelection(groups, [])), ['g-size']);
  });
  it('passes with the required pick and no extras', () => {
    assert.deepEqual(validateSelection(groups, ['m-reg']), {});
  });
  it('treats required with min_select 0 as needing one', () => {
    const g = { ...size, minSelect: 0 };
    assert.equal(Object.keys(validateSelection([g], [])).length, 1);
  });
  it('rejects more than max_select', () => {
    const errs = validateSelection(groups, ['m-reg', 'm-egg', 'm-fish', 'm-plan']);
    assert.ok(errs['g-ex']);
  });
});

describe('running price', () => {
  it('adds deltas in integer kobo', () => {
    assert.equal(runningUnitPriceKobo(250000, groups, ['m-lg', 'm-egg', 'm-fish']), 250000 + 50000 + 20000 + 70000);
    assert.equal(runningUnitPriceKobo(250000, groups, ['m-reg']), 250000);
  });
  it('resolveSelection returns snapshots in group order', () => {
    assert.deepEqual(resolveSelection(groups, ['m-egg', 'm-lg']).map((m) => m.id), ['m-lg', 'm-egg']);
  });
});

describe('lineKeyOf', () => {
  it('is the bare itemId without modifiers (legacy carts keep matching)', () => {
    assert.equal(lineKeyOf({ itemId: 'i1' }), 'i1');
    assert.equal(lineKeyOf({ itemId: 'i1', modifierIds: [] }), 'i1');
  });
  it('is order-independent and distinguishes variants', () => {
    assert.equal(lineKeyOf({ itemId: 'i1', modifierIds: ['b', 'a'] }), lineKeyOf({ itemId: 'i1', modifierIds: ['a', 'b'] }));
    assert.notEqual(lineKeyOf({ itemId: 'i1', modifierIds: ['a'] }), lineKeyOf({ itemId: 'i1' }));
  });
});
