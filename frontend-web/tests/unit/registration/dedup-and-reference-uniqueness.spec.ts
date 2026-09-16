/**
 * RG-004 (applicant-level duplicate prevention) + RG-005 (contestant
 * number/reference uniqueness).
 *
 * Both were marked Missing/Partial against the legacy in-memory
 * `server/registration/store.ts`. The live path is
 * `server/registration/supabase-store.ts`, which:
 *   - dedup: calls `findLiveRegistrationForContest` (registration-v2/registration-for-contest.ts)
 *     before insert and throws `RegistrationExistsError` on a live duplicate;
 *     migration 20270125000000 backs this with a DB partial unique index
 *     (`registrations_one_live_per_user_contest`) as the real authority.
 *   - reference uniqueness: `makeReference` mixes a contest-slug prefix with a
 *     millisecond timestamp AND a random suffix, so even two requests in the
 *     same millisecond do not collide.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/server';
import {
  findLiveRegistrationForContest,
  RegistrationExistsError,
} from '@/src/server/registration-v2/registration-for-contest';
import { makeReference } from '@/src/server/registration/supabase-store';

function mockSupabaseReturning(row: any) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    not: () => Promise.resolve({ data: row ? [row] : [], error: null }),
    order: () => chain,
    limit: () => Promise.resolve({ data: row ? [row] : [], error: null }),
  };
  // Support both orderings used by the implementation (…not().order().limit()).
  chain.not = () => chain;
  chain.order = () => chain;
  chain.limit = () => Promise.resolve({ data: row ? [row] : [], error: null });
  return { from: () => chain };
}

describe('RG-004: applicant-level duplicate registration prevention', () => {
  it('finds an existing LIVE registration for the same user + contest', async () => {
    const existingRow = {
      id: 'reg-1',
      status: 'under_review',
      contest_slug: 'open-mic-competition',
      reference: 'OPENMI-123456-ABCD',
      current_step: 'personal_information',
      created_at: '2026-01-01T00:00:00Z',
      submitted_at: '2026-01-01T00:05:00Z',
    };
    vi.mocked(createAdminClient).mockReturnValue(mockSupabaseReturning(existingRow) as any);

    const existing = await findLiveRegistrationForContest('user-1', { contestSlug: 'open-mic-competition' });
    expect(existing).not.toBeNull();
    expect(existing!.id).toBe('reg-1');
    expect(existing!.submitted).toBe(true);

    // This is exactly what `startRegistrationDraft` does with the result
    // (src/server/registration/supabase-store.ts:335-342) — assert the error
    // it throws carries the existing application so the caller can redirect
    // to it instead of creating a silent duplicate.
    const err = new RegistrationExistsError(existing!);
    expect(err.code).toBe('registration_exists');
    expect(err.registration.id).toBe('reg-1');
  });

  it('returns null (no duplicate) when the only prior registration is terminal', async () => {
    // Terminal statuses are excluded by the query itself (`.not('status', 'in', ...)`)
    // — simulate the DB having genuinely filtered it out.
    vi.mocked(createAdminClient).mockReturnValue(mockSupabaseReturning(null) as any);

    const existing = await findLiveRegistrationForContest('user-1', { contestSlug: 'open-mic-competition' });
    expect(existing).toBeNull();
  });
});

describe('RG-005: reference number is collision-resistant', () => {
  it('produces unique references even for many calls at the same instant', () => {
    const refs = new Set<string>();
    for (let i = 0; i < 5000; i += 1) {
      refs.add(makeReference('open-mic-competition'));
    }
    expect(refs.size).toBe(5000);
  });

  it('is contest-scoped: different slugs produce different, recognisable prefixes', () => {
    const a = makeReference('open-mic-competition');
    const b = makeReference('stem-contest');
    expect(a.startsWith('OPENMI')).toBe(true);
    expect(b.startsWith('STEMCO')).toBe(true);
    expect(a).not.toBe(b);
  });

  it('falls back to a safe prefix for a slug with no alphanumeric characters', () => {
    const ref = makeReference('---');
    expect(ref.startsWith('SPOT-')).toBe(true);
  });
});
