// Pricing helpers for the Film Academy area options. Prices are NAIRA (the
// academy tables predate kobo). The server re-prices every selection from the
// DB; these only drive what the applicant sees before submitting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optionPrice, fromPrice, summarise, naira, normaliseOptions } from '@/features/filmAcademy/optionPricing';
import type { FilmAcademyAreaOption, FilmAcademyInterestArea } from '@/features/filmAcademy/types';

const opt = (id: string, no: number, withB: number | null): FilmAcademyAreaOption => ({
  id,
  label: `Option ${id}`,
  duration_label: '4 weeks',
  price_no_boarding_ngn: no,
  price_with_boarding_ngn: withB,
});

const area = (slug: string, options: FilmAcademyAreaOption[]): FilmAcademyInterestArea => ({
  slug,
  label: slug,
  description: null,
  fee_ngn: 0,
  options,
});

test('optionPrice returns the right amount for boarding true/false', () => {
  const o = opt('a', 100000, 150000);
  assert.equal(optionPrice(o, false), 100000);
  assert.equal(optionPrice(o, true), 150000);
});

test('optionPrice returns null when boarding unavailable', () => {
  assert.equal(optionPrice(opt('a', 100000, null), true), null);
  assert.equal(optionPrice(opt('a', 100000, null), false), 100000);
});

test('fromPrice is the lowest active no-boarding price', () => {
  const a = area('directing', [opt('a', 300000, null), opt('b', 120000, 200000), opt('c', 250000, null)]);
  assert.equal(fromPrice(a), 120000);
});

test('fromPrice is null with no options', () => {
  assert.equal(fromPrice(area('acting', [])), null);
});

test('summarise sums lines', () => {
  const a1 = area('directing', []);
  const a2 = area('acting', []);
  const r = summarise([
    { area: a1, option: opt('a', 100000, 150000), boarding: true },
    { area: a2, option: opt('b', 80000, null), boarding: false },
  ]);
  assert.equal(r.total, 230000);
  assert.equal(r.lines.length, 2);
});

test('summarise orders lines as picked', () => {
  const a1 = area('directing', []);
  const a2 = area('acting', []);
  const r = summarise([
    { area: a2, option: opt('b', 80000, null), boarding: false },
    { area: a1, option: opt('a', 100000, null), boarding: false },
  ]);
  assert.deepEqual(r.lines.map((l) => l.price), [80000, 100000]);
  assert.match(r.lines[0].label, /acting/);
});

test('naira coerces safely', () => {
  assert.equal(naira(null), null);
  assert.equal(naira(undefined), null);
  assert.equal(naira(''), null);
  assert.equal(naira('abc'), null);
  assert.equal(naira(-5), null);
  assert.equal(naira(NaN), null);
  assert.equal(naira('150000'), 150000);
  assert.equal(naira('1500.5'), 1501);
  assert.equal(naira(0), 0);
});

test('normaliseOptions drops unpriceable options and nulls bad boarding prices', () => {
  const raw = [
    { id: 'a', label: 'A', duration_label: null, price_no_boarding_ngn: null, price_with_boarding_ngn: 5 },
    { id: 'b', label: 'B', duration_label: null, price_no_boarding_ngn: '', price_with_boarding_ngn: 5 },
    { id: 'c', label: 'C', duration_label: null, price_no_boarding_ngn: -1, price_with_boarding_ngn: 5 },
    { id: 'd', label: 'D', duration_label: '4w', price_no_boarding_ngn: '100000', price_with_boarding_ngn: '' },
    { id: 'e', label: 'E', duration_label: null, price_no_boarding_ngn: 100, price_with_boarding_ngn: 'abc' },
    { id: 'f', label: 'F', duration_label: null, price_no_boarding_ngn: '1500.5', price_with_boarding_ngn: '2000' },
  ];
  const out = normaliseOptions(raw);
  assert.deepEqual(out.map((o) => o.id), ['d', 'e', 'f']);
  assert.equal(out[0].price_no_boarding_ngn, 100000);
  assert.equal(out[0].price_with_boarding_ngn, null);
  assert.equal(out[1].price_with_boarding_ngn, null);
  assert.equal(out[2].price_no_boarding_ngn, 1501);
  assert.equal(out[2].price_with_boarding_ngn, 2000);
  assert.deepEqual(normaliseOptions(undefined), []);
});

test('summarise excludes a boarding pick whose boarding price is null', () => {
  const a = area('directing', []);
  const r = summarise([{ area: a, option: opt('a', 100000, null), boarding: true }]);
  assert.deepEqual(r, { lines: [], total: 0 });
});

test('summarise with mixed picks sums only valid ones', () => {
  const a = area('directing', []);
  const r = summarise([
    { area: a, option: opt('a', 100000, null), boarding: true },
    { area: a, option: opt('b', 70000, 90000), boarding: true },
    { area: a, option: opt('c', 30000, null), boarding: false },
  ]);
  assert.equal(r.total, 120000);
  assert.equal(r.lines.length, 2);
});

test('fromPrice ignores non-finite prices', () => {
  const a = area('x', [opt('a', NaN, null), opt('b', 5000, null)]);
  assert.equal(fromPrice(a), 5000);
  assert.equal(fromPrice(area('y', [opt('a', NaN, null)])), null);
});
