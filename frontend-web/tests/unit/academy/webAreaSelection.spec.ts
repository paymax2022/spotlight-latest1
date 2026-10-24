/**
 * Web apply page area selection (C1): the web form is NOT ported to the option
 * picker, so with area options enabled any area that HAS options is app-only —
 * never selectable, never sent, never in the running total.
 */
import { describe, expect, it } from 'vitest';
import {
  APP_ONLY_AREA_TEXT,
  isAppOnlyArea,
  legacyTuitionTotal,
  submittableAreaSlugs,
  type WebInterestArea,
} from '@/src/lib/academy/webAreaSelection';

const OPTION = {
  id: 'o1', label: 'Weekend', duration_label: null,
  price_no_boarding_ngn: 100000, price_with_boarding_ngn: null,
};
const priced: WebInterestArea = { slug: 'acting', label: 'Acting', description: null, fee_ngn: 50000, options: [OPTION] };
const plain: WebInterestArea = { slug: 'plain', label: 'Plain', description: null, fee_ngn: 12000, options: [] };
const old: WebInterestArea = { slug: 'old', label: 'Old server', description: null, fee_ngn: 9000 };
const areas = [priced, plain, old];

describe('web area selection', () => {
  it('an area with options is app-only only when the feature is enabled', () => {
    expect(isAppOnlyArea(priced, true)).toBe(true);
    expect(isAppOnlyArea(priced, false)).toBe(false);
    expect(isAppOnlyArea(plain, true)).toBe(false);
    expect(isAppOnlyArea(old, true)).toBe(false);
  });

  it('tells the user where to choose an app-only area', () => {
    expect(APP_ONLY_AREA_TEXT).toBe('Choose this area in the Paymax app');
  });

  it('never submits an app-only area, even if it got into the selection', () => {
    expect(submittableAreaSlugs(['acting', 'plain'], areas, true)).toEqual(['plain']);
    expect(submittableAreaSlugs(['acting'], areas, true)).toEqual([]);
  });

  it('drops slugs that are not in the offered list', () => {
    expect(submittableAreaSlugs(['plain', 'ghost'], areas, true)).toEqual(['plain']);
  });

  it('flag off (or older server): every offered area keeps legacy behaviour', () => {
    expect(submittableAreaSlugs(['acting', 'plain'], areas, false)).toEqual(['acting', 'plain']);
  });

  it('running total ignores app-only areas', () => {
    expect(legacyTuitionTotal(['acting', 'plain'], areas, true)).toBe(12000);
    expect(legacyTuitionTotal(['acting', 'plain'], areas, false)).toBe(62000);
    expect(legacyTuitionTotal([], areas, true)).toBe(0);
  });

  it('a non-finite or negative fee contributes nothing to the total', () => {
    const bad: WebInterestArea[] = [
      { slug: 'nan', label: 'NaN', description: null, fee_ngn: Number.NaN },
      { slug: 'neg', label: 'Neg', description: null, fee_ngn: -5 },
      plain,
    ];
    expect(legacyTuitionTotal(['nan', 'neg', 'plain'], bad, true)).toBe(12000);
  });
});
