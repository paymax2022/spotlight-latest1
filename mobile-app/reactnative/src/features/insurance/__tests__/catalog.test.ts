// Pure-logic unit tests for insurance category presentation + browse filtering.
//   node --experimental-strip-types --test src/features/insurance/__tests__/catalog.test.ts
//
// The seven categories are fixed (they are MyCover's own), but the COUNTS never
// are: the aggregator adds and retires products, so anything hardcoded goes
// stale silently. These tests pin the two properties that keep the browse screen
// honest — counts are computed from the live list, and an unrecognised product
// line degrades to a usable tile instead of a blank one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES,
  categoryLabel,
  categoryMeta,
  countByLine,
  filterProducts,
} from '../live/catalog.ts';

// A product shaped just enough for the functions under test.
const P = (o: Partial<{
  name: string;
  description: string;
  underwriter: string;
  productLine: string;
  active: boolean;
}> = {}) => ({
  name: 'Cover',
  description: '',
  underwriter: '',
  productLine: 'auto',
  active: true,
  ...o,
});

// ── the category table itself ───────────────────────────────────────────────

test('CATEGORIES covers exactly the seven real MyCover product lines', () => {
  const lines = CATEGORIES.map((c) => c.line).sort();
  assert.deepEqual(lines, [
    'auto', 'content', 'gadget', 'health', 'life', 'package', 'travel',
  ]);
});

test('every category carries the presentation fields a tile needs', () => {
  for (const c of CATEGORIES) {
    assert.ok(c.label, `${c.line} has no label`);
    assert.ok(c.blurb, `${c.line} has no blurb`);
    assert.ok(c.description, `${c.line} has no description`);
    assert.ok(c.icon, `${c.line} has no icon name`);
    assert.ok(c.tone, `${c.line} has no tone`);
  }
});

test('category lines are unique so the lookup table cannot silently drop one', () => {
  assert.equal(new Set(CATEGORIES.map((c) => c.line)).size, CATEGORIES.length);
});

// ── categoryMeta ────────────────────────────────────────────────────────────

test('categoryMeta is case-insensitive', () => {
  // The Go catalog sends product_line uppercase ("HEALTH"); the contract is
  // lowercase. Neither side should have to care.
  assert.equal(categoryMeta('HEALTH').label, 'Health');
  assert.equal(categoryMeta('health').label, 'Health');
  assert.equal(categoryLabel('AuTo'), 'Motor');
});

test('categoryMeta falls back to a usable tile for an unknown line', () => {
  // A product line we have never seen must still render — a blank tile with no
  // icon is worse than a generic one.
  for (const bogus of ['motor', '', 'not-a-line']) {
    const m = categoryMeta(bogus);
    assert.ok(m.label, `no label for ${JSON.stringify(bogus)}`);
    assert.ok(m.icon, `no icon for ${JSON.stringify(bogus)}`);
  }
  assert.equal(categoryMeta('motor').label, 'Cover');
});

test('categoryMeta survives null and undefined', () => {
  assert.equal(categoryMeta(null).label, 'Cover');
  assert.equal(categoryMeta(undefined).label, 'Cover');
});

// ── countByLine ─────────────────────────────────────────────────────────────

test('countByLine seeds every known line so a tile can render zero', () => {
  // A category with no products must show "0", not vanish from the grid.
  const counts = countByLine([]);
  for (const c of CATEGORIES) {
    assert.equal(counts[c.line], 0, `${c.line} missing from an empty count`);
  }
});

test('countByLine counts from the live list rather than a hardcoded total', () => {
  const counts = countByLine([
    P({ productLine: 'auto' }),
    P({ productLine: 'auto' }),
    P({ productLine: 'health' }),
  ]);
  assert.equal(counts.auto, 2);
  assert.equal(counts.health, 1);
  assert.equal(counts.travel, 0);
});

test('countByLine normalises case before bucketing', () => {
  const counts = countByLine([P({ productLine: 'AUTO' }), P({ productLine: 'auto' })]);
  assert.equal(counts.auto, 2);
});

test('countByLine buckets an unknown line under its own key', () => {
  // Documented consequence: countByLine keeps "motor" as its own bucket, while
  // categoryMeta("motor") collapses to the generic tile. A browse screen that
  // iterates the COUNT keys would therefore render a tile CATEGORIES has no
  // metadata for — iterate CATEGORIES and look the count up, not the reverse.
  const counts = countByLine([P({ productLine: 'motor' })]);
  assert.equal(counts.motor, 1);
  assert.equal(categoryMeta('motor').line, 'package');
});

// ── filterProducts ──────────────────────────────────────────────────────────

test('filterProducts hides inactive products unconditionally', () => {
  // An inactive product must not be reachable by search either — it cannot be
  // bought, so surfacing it only produces a dead end at the quote step.
  const out = filterProducts(
    [P({ name: 'Retired', active: false }), P({ name: 'Live' })],
    {},
  );
  assert.deepEqual(out.map((p) => p.name), ['Live']);

  const searched = filterProducts(
    [P({ name: 'Retired', active: false })],
    { query: 'retired' },
  );
  assert.deepEqual(searched, []);
});

test('filterProducts narrows by product line, case-insensitively', () => {
  const out = filterProducts(
    [P({ name: 'A', productLine: 'auto' }), P({ name: 'B', productLine: 'life' })],
    { line: 'LIFE' },
  );
  assert.deepEqual(out.map((p) => p.name), ['B']);
});

test('filterProducts matches name, underwriter and description', () => {
  const list = [
    P({ name: 'FlexiCare Retail' }),
    P({ name: 'B', underwriter: 'Leadway Assurance' }),
    P({ name: 'C', description: 'Surgery and outpatient hospicash' }),
  ];
  // By name...
  assert.deepEqual(filterProducts(list, { query: 'flexicare' }).map((p) => p.name), ['FlexiCare Retail']);
  // ...by underwriter, which is how people actually search for insurance...
  assert.deepEqual(filterProducts(list, { query: 'leadway' }).map((p) => p.name), ['B']);
  // ...and by description, so a benefit word finds the product offering it.
  assert.deepEqual(filterProducts(list, { query: 'hospicash' }).map((p) => p.name), ['C']);
});

test('filterProducts combines line and query as AND, not OR', () => {
  const list = [
    P({ name: 'AutoCare', productLine: 'auto' }),
    P({ name: 'AutoCare', productLine: 'life' }),
  ];
  const out = filterProducts(list, { line: 'auto', query: 'autocare' });
  assert.equal(out.length, 1);
  assert.equal(out[0].productLine, 'auto');
});

test('filterProducts ignores surrounding whitespace in the query', () => {
  const list = [P({ name: 'FlexiCare' })];
  assert.equal(filterProducts(list, { query: '  flexicare  ' }).length, 1);
});

test('filterProducts returns everything active when no filters are given', () => {
  const list = [P({ name: 'A' }), P({ name: 'B' })];
  assert.equal(filterProducts(list, {}).length, 2);
  assert.equal(filterProducts(list, { line: null, query: null }).length, 2);
  assert.equal(filterProducts(list, { query: '' }).length, 2);
});
