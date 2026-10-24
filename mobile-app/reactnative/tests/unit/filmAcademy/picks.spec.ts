// Area-option picks held by the apply screen. Pure logic only; the UI is
// verified by type-check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasOptions, offersBoarding, canAddArea, upsertPick, removePick, reconcilePicks,
  toSelections, normaliseSelectedOptions, type AreaPick,
} from '@/features/filmAcademy/picks';
import { summarise } from '@/features/filmAcademy/optionPricing';
import type { FilmAcademyAreaOption, FilmAcademyInterestArea } from '@/features/filmAcademy/types';

const opt = (id: string, no: number, withB: number | null): FilmAcademyAreaOption => ({
  id, label: `Option ${id}`, duration_label: '4 weeks',
  price_no_boarding_ngn: no, price_with_boarding_ngn: withB,
});
const area = (slug: string, options: FilmAcademyAreaOption[]): FilmAcademyInterestArea => ({
  slug, label: slug.toUpperCase(), description: null, fee_ngn: 0, options,
});

const A = area('acting', [opt('a1', 100, 150), opt('a2', 200, null)]);
const B = area('directing', [opt('b1', 300, 400)]);
const C = area('editing', [opt('c1', 500, null)]);
const EMPTY = area('sound', []);

const pick = (a: FilmAcademyInterestArea, i = 0, boarding = false): AreaPick =>
  ({ area: a, option: a.options[i], boarding });

test('hasOptions / offersBoarding', () => {
  assert.equal(hasOptions(A), true);
  assert.equal(hasOptions(EMPTY), false);
  assert.equal(offersBoarding(A), true);
  assert.equal(offersBoarding(C), false);
  assert.equal(offersBoarding(EMPTY), false);
});

test('canAddArea respects the cap, allows re-editing a picked area, refuses option-less areas', () => {
  const picks = [pick(A), pick(B)];
  assert.equal(canAddArea(picks, C, 2), false);
  assert.equal(canAddArea(picks, A, 2), true);
  assert.equal(canAddArea([pick(A)], C, 2), true);
  assert.equal(canAddArea([], EMPTY, 2), false);
});

test('upsertPick replaces in place, appends under the cap, refuses over the cap', () => {
  const picks = [pick(A), pick(B)];
  const replaced = upsertPick(picks, pick(A, 1), 2);
  assert.equal(replaced.length, 2);
  assert.equal(replaced[0].option.id, 'a2');
  assert.equal(replaced[1].area.slug, 'directing');
  assert.equal(upsertPick(picks, pick(C), 2), picks);
  assert.equal(upsertPick([pick(A)], pick(C), 2).length, 2);
});

test('upsertPick refuses boarding where the option does not offer it, and an option of another area', () => {
  assert.deepEqual(upsertPick([], pick(A, 1, true), 2), []);
  assert.deepEqual(upsertPick([], { area: A, option: B.options[0], boarding: false }, 2), []);
});

test('removePick drops by slug', () => {
  assert.deepEqual(removePick([pick(A), pick(B)], 'acting').map((p) => p.area.slug), ['directing']);
});

test('reconcilePicks drops areas the batch no longer offers and refreshes option data', () => {
  const freshA = area('acting', [opt('a1', 120, 170)]);
  const out = reconcilePicks([pick(A), pick(B)], [freshA, C]);
  assert.equal(out.length, 1);
  assert.equal(out[0].area, freshA);
  assert.equal(out[0].option.price_no_boarding_ngn, 120);
});

test('reconcilePicks drops a pick whose option vanished or lost boarding', () => {
  const noBoarding = area('acting', [opt('a1', 100, null)]);
  assert.deepEqual(reconcilePicks([pick(A, 0, true)], [noBoarding]), []);
  const gone = area('acting', [opt('zz', 1, null)]);
  assert.deepEqual(reconcilePicks([pick(A)], [gone]), []);
});

test('reconcilePicks also enforces the cap', () => {
  assert.equal(reconcilePicks([pick(A), pick(B), pick(C)], [A, B, C], 2).length, 2);
});

test('toSelections sends slug, option id and a real boolean — never a price', () => {
  const sel = toSelections([pick(A, 0, true), pick(B)]);
  assert.deepEqual(sel, [
    { area: 'acting', option_id: 'a1', boarding: true },
    { area: 'directing', option_id: 'b1', boarding: false },
  ]);
  for (const s of sel) assert.equal('price' in s, false);
});

test('a boarding pick whose option has no boarding price never reaches selections or the summary', () => {
  // The apply screen submits toSelections(reconcilePicks(raw, ...)) and totals summarise(picks).
  const bad: AreaPick = { area: A, option: A.options[1], boarding: true }; // a2: no boarding price
  const good = pick(B, 0, true);
  const picks = reconcilePicks([bad, good], [A, B], 2);
  assert.deepEqual(toSelections(picks), [{ area: 'directing', option_id: 'b1', boarding: true }]);
  const s = summarise(picks);
  assert.equal(s.lines.length, 1);
  assert.equal(s.total, 400);
  // Even if handed the raw (unreconciled) picks, the summary never prices it.
  assert.equal(summarise([bad]).lines.length, 0);
  assert.equal(summarise([bad]).total, 0);
});

test('normaliseSelectedOptions coerces the snapshot and drops junk', () => {
  assert.deepEqual(normaliseSelectedOptions(null), []);
  assert.deepEqual(normaliseSelectedOptions('x'), []);
  const out = normaliseSelectedOptions([
    { area_slug: 'acting', option_id: 'a1', label: 'Foundation', duration_label: '4 weeks', boarding: true, price_ngn: '150000' },
    { option_id: 'no-slug' },
    null,
  ]);
  assert.deepEqual(out, [
    { area_slug: 'acting', option_id: 'a1', label: 'Foundation', duration_label: '4 weeks', boarding: true, price_ngn: 150000 },
  ]);
});
