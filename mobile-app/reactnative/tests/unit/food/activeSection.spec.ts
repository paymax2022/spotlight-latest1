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
