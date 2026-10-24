// Pricing helpers for the Film Academy area options. Prices are NAIRA (the
// academy tables predate kobo). The server re-prices every selection from the
// DB; these only drive what the applicant sees before submitting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optionPrice, fromPrice, summarise } from '@/features/filmAcademy/optionPricing';
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
