/**
 * PATCH /api/admin/contests/[slug] must not reject the type a contest already
 * carries.
 *
 * public.contests.contest_type is free text, and it holds two vocabularies.
 * The registration catalog ships twelve engine types; the unified contest engine
 * writes its own into the same free-text column ('general' is its DEFAULT,
 * 'multi_skill' and 'reality_tv_show' come from its migrations, 'STEM' from
 * src/server/stem/persistence.ts, and
 * backend/internal/repositories/competition_supabase_repository.go COUNTs on
 * 'multi_skill' and 'reality_tv_show'). The route validated against the catalog
 * alone.
 *
 * The read path is what makes that a dead end rather than a cosmetic gap:
 * listPersistedContests() reconstructs a definition for any row without a usable
 * contest_config snapshot and returns contest_type VERBATIM (it has to — rewriting
 * it there would corrupt the engine and the admin overview counts). So GET hands
 * the editor 'multi_skill', the editor sends back what it was given, and the
 * validator refuses it. Every such contest was unsavable: the console reported
 * "Updating contest failed: Invalid contest type." for a form the admin had
 * changed nothing in.
 *
 * Fix under test: a type the caller did not change — the value already stored for
 * THAT slug — is accepted. A type the admin actually picked from the dropdown is
 * still checked against the catalog, so nothing new becomes writable that was not
 * already a real row, and 'multi_skill' stored on one contest does not license
 * putting 'multi_skill' on another.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  update: [] as Array<{ slug: string; def: Record<string, unknown> }>,
  persist: [] as Array<Record<string, unknown>>,
  stored: null as Record<string, unknown> | null,
}));

vi.mock('@/src/server/admin/auth', () => ({
  assertAdminPermission: vi.fn(async () => ({})),
}));

// 'other' is what the reconstructed definition reports for a row whose category
// column holds a human label; the editor sends that back unchanged.
vi.mock('@/src/server/contests/categories', () => ({
  allowedCategorySlugs: async () => ['music', 'film_production', 'other'],
}));

// The memory catalog holds only the code-defined contests, so a real Postgres row
// is "not found" there — the same throw the route already tolerates.
vi.mock('@/src/server/registration/store', () => ({
  updateRegistrationContest: () => {
    throw new Error('Contest not found.');
  },
  getRegistrationContestBySlug: () => null,
}));

vi.mock('@/src/server/registration-v2/contest-store', () => ({
  getPersistedContestBySlug: async () => calls.stored,
  updateContestDefinition: async (slug: string, def: Record<string, unknown>) => {
    calls.update.push({ slug, def });
  },
  persistContestDefinition: async (def: Record<string, unknown>) => {
    calls.persist.push(def);
    return { id: 'contest-1' };
  },
  deleteContestDefinition: async () => undefined,
}));

import { PATCH } from '@/app/api/admin/contests/[slug]/route';

/**
 * Nollywood Rising Star as the read path actually renders it: a row with an empty
 * contest_config, so contest_type comes off the column and category comes back as
 * the 'other' slug.
 */
function storedContest(over: Record<string, unknown> = {}) {
  return {
    id: 'contest-1',
    slug: 'nollywood-rising-star',
    title: 'Nollywood Rising Star',
    contestCategory: 'other',
    contestType: 'multi_skill',
    seasonOrEdition: 'Season 1',
    regionScope: 'national',
    isPaid: false,
    registrationFeeNgn: 0,
    requiresGuardianConsentForMinors: false,
    legalAdultAge: 18,
    requiresMedical: false,
    requiresBootcampReadiness: false,
    supportsVoting: true,
    supportsAuditionScheduling: false,
    supportsSchoolEntry: false,
    supportsGroupEntry: false,
    auditionStates: [],
    applicantCategories: [],
    categoryQuestionSet: 'other',
    rulesText: '',
    bannerImageUrl: '',
    logoUrl: '',
    startDate: '',
    endDate: '',
    prizePool: '',
    ...over,
  };
}

function patchRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/admin/contests/nollywood-rising-star', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  calls.update = [];
  calls.persist = [];
  calls.stored = storedContest();
});

describe('PATCH /api/admin/contests/[slug] and the stored contest type', () => {
  it('saves an edit that leaves a legacy type untouched', async () => {
    // The reported bug: open the editor, change the banner, hit Save. The form
    // resends contestType because the route treats PATCH as a whole definition,
    // and 'multi_skill' — a value this app wrote, and one Go counts — was in no
    // list the validator knew.
    const res = await PATCH(
      patchRequest(storedContest({ bannerImageUrl: '/api/admin/contests/banner/abc' })),
      { params: Promise.resolve({ slug: 'nollywood-rising-star' }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(calls.update).toHaveLength(1);
    expect(calls.update[0].def).toMatchObject({
      contestType: 'multi_skill',
      bannerImageUrl: '/api/admin/contests/banner/abc',
    });
    expect(body.contest).toMatchObject({ contestType: 'multi_skill' });
  });
});

describe('PATCH /api/admin/contests/[slug] type validation still bites', () => {
  it('refuses a type that is neither in the catalog nor the stored value', async () => {
    const res = await PATCH(patchRequest(storedContest({ contestType: 'definitely_not_a_type' })), {
      params: Promise.resolve({ slug: 'nollywood-rising-star' }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid contest type.');
    expect(calls.update).toHaveLength(0);
  });

  it('refuses a legacy type stored on some other contest', async () => {
    // Tolerance is per-contest, not a second global allow-list: 'general' is the
    // column DEFAULT and exists on 155 rows, but this row never said it. Without
    // this case the obvious "just add the legacy values" fix would let any
    // contest be relabelled with an engine type nobody chose.
    const res = await PATCH(patchRequest(storedContest({ contestType: 'general' })), {
      params: Promise.resolve({ slug: 'nollywood-rising-star' }),
    });

    expect(res.status).toBe(400);
    expect(calls.update).toHaveLength(0);
  });

  it('accepts a catalog type chosen over the legacy one', async () => {
    // Moving a legacy contest onto the registration catalog stays the deliberate
    // act it was meant to be.
    const res = await PATCH(
      patchRequest(storedContest({ contestType: 'public_voting_contest' })),
      { params: Promise.resolve({ slug: 'nollywood-rising-star' }) },
    );

    expect(res.status).toBe(200);
    expect(calls.update[0].def).toMatchObject({ contestType: 'public_voting_contest' });
  });
});
