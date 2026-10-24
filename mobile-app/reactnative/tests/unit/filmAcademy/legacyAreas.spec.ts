// Feature-flag fallback (FEATURE_FILM_ACADEMY_AREA_OPTIONS_ENABLED off): the
// apply screen reverts to legacy simple area selection. Pure decision logic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  areaPayload, areaPriceCaption, legacyTuition, reconcileLegacyAreas, toggleLegacyArea,
  type AreaPick,
} from '@/features/filmAcademy/picks';
import type { FilmAcademyAreaOption, FilmAcademyInterestArea } from '@/features/filmAcademy/types';

const opt = (id: string, no: number, withB: number | null): FilmAcademyAreaOption => ({
  id, label: `Option ${id}`, duration_label: null,
  price_no_boarding_ngn: no, price_with_boarding_ngn: withB,
});
const area = (slug: string, fee: number, options: FilmAcademyAreaOption[] = []): FilmAcademyInterestArea => ({
  slug, label: slug.toUpperCase(), description: null, fee_ngn: fee, options,
});

const ACT = area('acting', 50000, [opt('a1', 100000, 150000)]);
const DIR = area('directing', 0);
const EDIT = area('editing', 30000);
const offered = [ACT, DIR, EDIT];

test('toggleLegacyArea adds, removes and stops at the cap', () => {
  assert.deepEqual(toggleLegacyArea([], 'acting', offered, 2), ['acting']);
  assert.deepEqual(toggleLegacyArea(['acting'], 'acting', offered, 2), []);
  assert.deepEqual(toggleLegacyArea(['acting', 'directing'], 'editing', offered, 2), ['acting', 'directing']);
  // Removing is always allowed, even at the cap.
  assert.deepEqual(toggleLegacyArea(['acting', 'directing'], 'directing', offered, 2), ['acting']);
});

test('toggleLegacyArea ignores an area the batch does not offer', () => {
  assert.deepEqual(toggleLegacyArea([], 'sound', offered, 2), []);
});

test('legacy selection does not care whether an area has options', () => {
  // With the flag off the server prices every area from fee_ngn.
  assert.deepEqual(toggleLegacyArea([], 'acting', offered, 2), ['acting']);
});

test('reconcileLegacyAreas drops areas no longer offered and enforces the cap', () => {
  assert.deepEqual(reconcileLegacyAreas(['sound', 'acting', 'editing', 'directing'], offered, 2), ['acting', 'editing']);
  assert.deepEqual(reconcileLegacyAreas([], offered, 2), []);
});

test('legacyTuition lists only fee_ngn > 0 and totals them', () => {
  const t = legacyTuition(['acting', 'directing', 'editing'], offered);
  assert.deepEqual(t.lines, [
    { slug: 'acting', label: 'ACTING', fee: 50000 },
    { slug: 'editing', label: 'EDITING', fee: 30000 },
  ]);
  assert.equal(t.total, 80000);
  assert.equal(legacyTuition(['directing'], offered).total, 0);
});

test('legacyTuition never turns a bad fee into money', () => {
  const bad = [area('x', Number.NaN), area('y', -5), { ...area('z', 0), fee_ngn: '7000' as unknown as number }];
  const t = legacyTuition(['x', 'y', 'z'], bad);
  assert.deepEqual(t.lines.map((l) => l.slug), ['z']);
  assert.equal(t.total, 7000);
});

test('areaPayload: flag ON sends selections and NOT areas_of_interest', () => {
  const picks: AreaPick[] = [{ area: ACT, option: ACT.options[0], boarding: true }];
  const p = areaPayload(true, picks, ['editing']);
  assert.deepEqual(p, { selections: [{ area: 'acting', option_id: 'a1', boarding: true }] });
  assert.equal('areas_of_interest' in p, false);
});

test('areaPayload: flag OFF sends areas_of_interest slugs and NOT selections', () => {
  const picks: AreaPick[] = [{ area: ACT, option: ACT.options[0], boarding: false }];
  const p = areaPayload(false, picks, ['acting', 'editing']);
  assert.deepEqual(p, { areas_of_interest: ['acting', 'editing'] });
  assert.equal('selections' in p, false);
});

test('areaPriceCaption: flag OFF shows no option pricing at all', () => {
  assert.deepEqual(areaPriceCaption(ACT, false), { kind: 'none' });
  assert.deepEqual(areaPriceCaption(DIR, false), { kind: 'none' });
});

test('areaPriceCaption: flag ON shows from-price or pricing coming soon', () => {
  assert.deepEqual(areaPriceCaption(ACT, true), { kind: 'from', price: 100000 });
  assert.deepEqual(areaPriceCaption(DIR, true), { kind: 'soon' });
});
