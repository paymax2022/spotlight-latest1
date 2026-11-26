// The contest's own locality has to reach the draft, or the applicant never learns
// they are filling a LOCAL contest.
//
// `public.contests.locality_*` is read by the v2 contest store and the admin
// console already edits it, but the draft a wizard renders only carries what
// `src/server/registration/supabase-store.ts` stamps into `formData` as
// `derived.*`. Without these four keys the state -> LGA -> village cascade renders
// as three generic questions, and an applicant in the wrong LGA finds out only when
// they do not appear in the local leaderboard.
import { describe, expect, it } from 'vitest';
import { derivedLocalityFor } from '@/src/features/registration/locality-fields';
import type { ContestRegistrationDefinition } from '@/src/features/registration/types';

function contest(overrides: Partial<ContestRegistrationDefinition> = {}): ContestRegistrationDefinition {
  return {
    slug: 'open-mic-competition',
    title: 'Open Mic',
    contestCategory: 'performing_arts',
    contestType: 'online_contest',
    seasonOrEdition: '',
    regionScope: 'national',
    isPaid: false,
    requiresGuardianConsentForMinors: false,
    legalAdultAge: 18,
    requiresMedical: false,
    requiresBootcampReadiness: false,
    supportsVoting: true,
    supportsAuditionScheduling: false,
    supportsSchoolEntry: false,
    supportsGroupEntry: false,
    ...overrides,
  } as ContestRegistrationDefinition;
}

describe('derivedLocalityFor — the locality a draft is allowed to know', () => {
  it('always answers all four keys', () => {
    // A missing key and an empty one behave differently on a re-save: if a contest
    // is demoted from village to national and only non-empty values were written,
    // the old hint would stay on every draft forever. Empty IS the answer.
    expect(Object.keys(derivedLocalityFor(contest())).sort()).toEqual([
      'derived.localityLga',
      'derived.localityScope',
      'derived.localityState',
      'derived.localityVillage',
    ]);
  });

  it('writes empty strings for a national contest', () => {
    expect(derivedLocalityFor(contest({ regionScope: 'national' }))).toEqual({
      'derived.localityScope': 'national',
      'derived.localityState': '',
      'derived.localityLga': '',
      'derived.localityVillage': '',
    });
  });

  it('carries the triple of a village-scoped contest', () => {
    expect(
      derivedLocalityFor(
        contest({
          regionScope: 'village',
          localityState: 'Anambra',
          localityLga: 'Onitsha North',
          localityVillage: 'Ogbendida',
        }),
      ),
    ).toEqual({
      'derived.localityScope': 'village',
      'derived.localityState': 'Anambra',
      'derived.localityLga': 'Onitsha North',
      'derived.localityVillage': 'Ogbendida',
    });
  });

  it('leaves the quarter empty on an LGA-scoped contest', () => {
    const derived = derivedLocalityFor(
      contest({ regionScope: 'lga', localityState: 'Anambra', localityLga: 'Onitsha North' }),
    );
    expect(derived['derived.localityLga']).toBe('Onitsha North');
    expect(derived['derived.localityVillage']).toBe('');
  });

  it('trims stored padding', () => {
    const derived = derivedLocalityFor(
      contest({ regionScope: 'lga', localityState: '  Anambra ', localityLga: 'Onitsha North  ' }),
    );
    expect(derived['derived.localityState']).toBe('Anambra');
    expect(derived['derived.localityLga']).toBe('Onitsha North');
  });

  it('survives a definition with junk or missing locality values', () => {
    // Definitions come from a JSONB snapshot written by whatever console version
    // was deployed then, so an absent or non-string locality is normal, not an error.
    const derived = derivedLocalityFor({
      regionScope: 42,
      localityState: null,
      localityLga: 7,
    } as unknown as ContestRegistrationDefinition);
    expect(derived).toEqual({
      'derived.localityScope': '',
      'derived.localityState': '',
      'derived.localityLga': '',
      'derived.localityVillage': '',
    });
  });

  it('answers the empty shape for an unresolvable contest', () => {
    // resolveAnyContest returns null on a bogus slug; the caller must still stamp
    // consistent keys rather than leave a previous contest's locality behind.
    expect(derivedLocalityFor(null)).toEqual({
      'derived.localityScope': '',
      'derived.localityState': '',
      'derived.localityLga': '',
      'derived.localityVillage': '',
    });
    expect(derivedLocalityFor(undefined)).toEqual(derivedLocalityFor(null));
  });
});
