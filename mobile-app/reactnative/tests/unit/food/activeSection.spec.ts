import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { activeSectionIndex } from '@/features/food/activeSection';

describe('activeSectionIndex', () => {
  const offsets = [400, 900, 1500];
  it('is 0 before the first section', () => {
    assert.equal(activeSectionIndex(0, offsets, 8), 0);
  });
  it('switches exactly at the boundary (offset - slack)', () => {
    assert.equal(activeSectionIndex(891, offsets, 8), 0);
    assert.equal(activeSectionIndex(892, offsets, 8), 1);
  });
  it('picks the section containing scrollY between sections', () => {
    assert.equal(activeSectionIndex(1000, offsets, 8), 1);
  });
  it('stays on the last section once past it', () => {
    assert.equal(activeSectionIndex(99999, offsets, 8), 2);
  });
  it('returns -1 for empty offsets', () => {
    assert.equal(activeSectionIndex(100, [], 8), -1);
  });
  it('ignores sections not yet measured (undefined/NaN)', () => {
    assert.equal(activeSectionIndex(1000, [400, undefined as unknown as number, 1500], 8), 0);
  });
});

import { menuTabsVisible, contentOffsetFromWindow } from '@/features/food/activeSection';

describe('menuTabsVisible', () => {
  it('is false before the menu is reached', () => {
    assert.equal(menuTabsVisible(100, [400, 900], 24), false);
  });
  it('is true at and after first offset minus slack', () => {
    assert.equal(menuTabsVisible(375, [400, 900], 24), false);
    assert.equal(menuTabsVisible(376, [400, 900], 24), true);
    assert.equal(menuTabsVisible(5000, [400, 900], 24), true);
  });
  it('is false for empty or unmeasured offsets', () => {
    assert.equal(menuTabsVisible(5000, [], 24), false);
    assert.equal(menuTabsVisible(5000, [undefined as unknown as number, NaN], 24), false);
  });
  it('uses the first measured entry when the leading ones are unmeasured', () => {
    assert.equal(menuTabsVisible(580, [undefined as unknown as number, 600], 24), true);
  });
});

describe('contentOffsetFromWindow', () => {
  it('is scroll-invariant for a fixed section', () => {
    // section at content y 700, viewport top at window y 120
    assert.equal(contentOffsetFromWindow(820, 120, 0), 700);
    assert.equal(contentOffsetFromWindow(520, 120, 300), 700);
  });
  it('handles a section scrolled above the viewport', () => {
    assert.equal(contentOffsetFromWindow(20, 120, 800), 700);
  });
});
