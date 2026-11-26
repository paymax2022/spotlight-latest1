// The client half of the locality cascade.
//
// The wizard is a 900-line component; putting the state -> LGA -> village rules
// in a module keeps them testable in the node environment the registration suite
// runs in, and keeps the three rules that applicants actually feel in one place:
//
//   1. the LGA list follows the state of ORIGIN (not residence — residence keeps
//      feeding the audition-city matching it already feeds);
//   2. changing a level clears the levels below it, so a stored row can never say
//      "Onitsha North / Ikeja" and then be counted under the wrong locality;
//   3. a failed or empty village read degrades to a free-text box. It never
//      becomes an error the applicant has to dismiss before applying, because
//      locality is display + filter, not an eligibility gate.
import { describe, expect, it } from 'vitest';

import {
  lgaOptionsFor,
  localityResetsFor,
  parseVillagesResponse,
  villagesUrl,
} from '@/src/features/registration/locality-picker';

describe('LGA options', () => {
  it('lists the local governments of the state of origin', () => {
    const lgas = lgaOptionsFor('Anambra');
    expect(lgas).toContain('Onitsha North');
    expect(lgas).toContain('Onitsha South');
    expect(lgas).not.toContain('Ewekoro');
  });

  it('returns an empty list rather than throwing for a blank or unknown state', () => {
    expect(lgaOptionsFor('')).toEqual([]);
    expect(lgaOptionsFor('Somewhere Not In The Table')).toEqual([]);
  });
});

describe('cascade resets', () => {
  // The helper hands back keys to wipe so the wizard can spread them into the
  // same setFormData call it already makes. {} means "touch nothing".
  it('clears the LGA and the village when the state of origin changes', () => {
    expect(
      localityResetsFor('personal.stateOfOrigin', {
        'personal.stateOfOrigin': 'Anambra',
        'personal.localGovernment': 'Onitsha North',
        'personal.village': 'Ogbendida',
      }, 'Lagos'),
    ).toEqual({ 'personal.localGovernment': '', 'personal.village': '' });
  });

  it('leaves the fields alone when the state is re-selected unchanged', () => {
    expect(
      localityResetsFor('personal.stateOfOrigin', {
        'personal.stateOfOrigin': 'Anambra',
        'personal.localGovernment': 'Onitsha North',
        'personal.village': 'Ogbendida',
      }, 'Anambra'),
    ).toEqual({});
  });

  it('clears only the village when the LGA changes', () => {
    expect(
      localityResetsFor('personal.localGovernment', {
        'personal.stateOfOrigin': 'Anambra',
        'personal.localGovernment': 'Onitsha North',
        'personal.village': 'Ogbendida',
      }, 'Onitsha South'),
    ).toEqual({ 'personal.village': '' });
  });

  it('does not clear a village the applicant has not finished with when nothing moved', () => {
    expect(
      localityResetsFor('personal.localGovernment', {
        'personal.localGovernment': 'Onitsha North',
        'personal.village': 'Ogbenda',
      }, 'Onitsha North'),
    ).toEqual({});
  });

  it('ignores every field that is not a locality level', () => {
    expect(localityResetsFor('personal.city', { 'personal.village': 'Ogboli' }, 'Awka')).toEqual({});
  });
});

describe('villages fetch', () => {
  it('builds an encoded query for the pair', () => {
    expect(villagesUrl('Anambra', 'Onitsha North')).toBe(
      '/api/registration/villages?state=Anambra&lga=Onitsha%20North',
    );
  });

  it('reads a curated payload', () => {
    const got = parseVillagesResponse({
      success: true,
      state: 'Anambra',
      lga: 'Onitsha North',
      mode: 'curated',
      villages: ['Isiokwe', 'Ogbendida'],
    });
    expect(got).toEqual({ mode: 'curated', villages: ['Isiokwe', 'Ogbendida'] });
  });

  it('reads an uncurated LGA as free text with an empty list', () => {
    expect(
      parseVillagesResponse({ success: true, mode: 'free_text', villages: [] }),
    ).toEqual({ mode: 'free_text', villages: [] });
  });

  it('falls back to free text for anything unrecognised, including a server error body', () => {
    const fallback = { mode: 'free_text' as const, villages: [] as string[] };
    expect(parseVillagesResponse(null)).toEqual(fallback);
    expect(parseVillagesResponse(undefined)).toEqual(fallback);
    expect(parseVillagesResponse({})).toEqual(fallback);
    expect(parseVillagesResponse({ success: false, error: 'village list unavailable.' })).toEqual(fallback);
    expect(parseVillagesResponse({ mode: 'curated', villages: null })).toEqual(fallback);
    // A list of non-strings must not reach the picker as "[object Object]".
    expect(parseVillagesResponse({ mode: 'curated', villages: [{ name: 'Ogboli' }] })).toEqual(fallback);
  });
});
