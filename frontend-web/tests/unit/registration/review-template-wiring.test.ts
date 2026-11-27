/**
 * AD-003/CS-004 → spec §6 — the wiring between `reviewRegistrationApplication`
 * and the photo pipeline.
 *
 * This file used to guard the opposite arrangement, and it is worth keeping the
 * shape of that history in words: when the template bridge
 * (`contest_templates.connect_contest_id`, migration
 * 20270212000000_contest_templates_connect_bridge.sql) resolved a template, the
 * review request called `processContestantPhoto` synchronously and assigned the
 * composite over `form_data['media.photoUrl']` — the only pointer to the
 * uploaded file. What that guard was protecting was a defect: every approval
 * destroyed the original it had just promoted.
 *
 * So the three things asserted here are the new contract:
 *
 *  1. An approval consults `presentation.ts` with the stored photo value, the
 *     registration id and the contest slug, and calls neither synchronous
 *     pipeline function. The vendor is not on the critical path of a decision
 *     the admin has already made (spec §6).
 *  2. The row that gets written carries the *decision* — `media.presentation`
 *     plus the asset ids — and `media.photoUrl` is byte-identical to what was
 *     read. That is the regression guard for the overwrite: it is checked on
 *     the payload handed to the UPDATE, because a test that only asserts the
 *     returned outcome would still pass if the assignment came back.
 *  3. A non-promoting decision never reaches the photo code at all.
 *
 * Mocks `@supabase/supabase-js` directly — supabase-store.ts builds its own
 * lazy client via createClient the same way template-resolver.ts does, not
 * through @/lib/supabase/server.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const RAW_PHOTO = 'https://cdn.test/raw-photo.jpg';
const COMPOSITE = 'https://pub.r2.test/contestants/composited/final.png';

const registrationsRow = {
  id: '11111111-1111-4111-8111-111111111111',
  reference: 'OPENMI-000001-ABCD',
  contest_slug: 'open-mic-competition',
  status: 'under_review',
  role: 'public_user',
  user_id: 'user-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  submitted_at: '2026-01-01T00:00:00Z',
  completion_percent: 100,
  current_step: 'review',
  fraud_flags: [],
  form_data: { 'media.photoUrl': RAW_PHOTO },
};

/** Every payload handed to a `.update()` during the review, cloned at call
 *  time: `nextFormData` is mutated after the call is built, so a captured
 *  reference would show the post-mutation object and prove nothing. */
const updatePayloads: Array<Record<string, unknown>> = [];

function makeChain(table: string) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    update: (payload: Record<string, unknown>) => {
      updatePayloads.push(structuredClone(payload));
      return chain;
    },
    single: () => Promise.resolve({ data: registrationsRow, error: null }),
    maybeSingle: () => Promise.resolve({ data: { id: 'connect-contest-1' }, error: null }),
  };
  if (table === 'registrations') {
    // in the notes-write step; .then is provided so `await` on the chain itself resolves.
    chain.then = (resolve: any) => resolve({ data: null, error: null });
  }
  return chain;
}

const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null });

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: (table: string) => makeChain(table),
    rpc: rpcMock,
  })),
}));

// The synchronous pipeline stays mocked so that an accidental call is visible
// as a call to a mock rather than a real vendor round trip — and so the
// "neither one is called" assertion below has something to be false about.
vi.mock('@/src/server/registration/photo-pipeline', () => ({
  processContestantPhoto: vi.fn(),
  processContestantPhotoNoTemplate: vi.fn(),
}));

const presentation = vi.hoisted(() => ({
  storedPhotoValueFor: vi.fn(),
  resolveReviewPhotoOutcome: vi.fn(),
  startPhotoForSubmission: vi.fn(),
}));
vi.mock('@/src/server/photo-jobs/presentation', () => presentation);

import { reviewRegistrationApplication } from '@/src/server/registration/supabase-store';
import { processContestantPhoto, processContestantPhotoNoTemplate } from '@/src/server/registration/photo-pipeline';

beforeEach(() => {
  vi.clearAllMocks();
  updatePayloads.length = 0;
  rpcMock.mockResolvedValue({ data: null, error: null });
  presentation.storedPhotoValueFor.mockReturnValue(RAW_PHOTO);
  presentation.resolveReviewPhotoOutcome.mockResolvedValue({
    mode: 'composite',
    photoUrl: COMPOSITE,
    photoAssetId: 'asset-final-1',
    originalAssetId: 'asset-original-1',
  });
});

describe('spec §6: the review path asks the job-backed presentation layer, and writes no photo value', () => {
  it('consults the presentation layer with the stored value, the id and the slug', async () => {
    await reviewRegistrationApplication('11111111-1111-4111-8111-111111111111', { status: 'approved' });

    expect(presentation.resolveReviewPhotoOutcome).toHaveBeenCalledWith({
      rawPhotoUrl: RAW_PHOTO,
      registrationId: '11111111-1111-4111-8111-111111111111',
      contestSlug: 'open-mic-competition',
    });
  });

  it('records the decision beside an untouched original', async () => {
    await reviewRegistrationApplication('11111111-1111-4111-8111-111111111111', { status: 'approved' });

    // The review writes notes/form_data in one UPDATE before the status RPC;
    // that payload is where an overwrite would show up.
    const written = updatePayloads.map((p) => p.form_data).filter((f) => f && typeof f === 'object');
    expect(written.length).toBeGreaterThan(0);
    for (const formData of written as Array<Record<string, unknown>>) {
      expect(formData['media.photoUrl']).toBe(RAW_PHOTO);
    }
    expect(written.at(-1)).toMatchObject({
      'media.presentation': 'composite',
      'media.photoAssetId': 'asset-final-1',
      'media.originalAssetId': 'asset-original-1',
    });
  });

  it('marks the row with the mode it actually got, including a pending render', async () => {
    presentation.resolveReviewPhotoOutcome.mockResolvedValue({
      mode: 'processing',
      photoUrl: RAW_PHOTO,
      originalAssetId: 'asset-original-1',
    });

    await reviewRegistrationApplication('11111111-1111-4111-8111-111111111111', { status: 'approved' });

    const written = updatePayloads.at(-1)?.form_data as Record<string, unknown>;
    expect(written['media.presentation']).toBe('processing');
    expect(written['media.photoAssetId']).toBeUndefined();
    expect(written['media.photoUrl']).toBe(RAW_PHOTO);
  });

  it('still refuses an approval whose job came back moderated, and writes nothing', async () => {
    presentation.resolveReviewPhotoOutcome.mockResolvedValue({
      mode: 'rejected',
      photoUrl: RAW_PHOTO,
      reason: 'adult_content',
    });

    const err = await reviewRegistrationApplication('11111111-1111-4111-8111-111111111111', {
      status: 'approved',
    }).then(
      () => null,
      (e) => e,
    );

    expect(err).toBeInstanceOf(Error);
    expect((err as { status?: number }).status).toBe(409);
    expect((err as { code?: string }).code).toBe('photo_moderation_rejected');
    expect(updatePayloads).toHaveLength(0);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('does not call the synchronous pipeline in either direction', async () => {
    await reviewRegistrationApplication('11111111-1111-4111-8111-111111111111', { status: 'approved' });

    expect(processContestantPhoto).not.toHaveBeenCalled();
    expect(processContestantPhotoNoTemplate).not.toHaveBeenCalled();
  });

  it('leaves the photo code alone for a non-promoting decision', async () => {
    await reviewRegistrationApplication('11111111-1111-4111-8111-111111111111', { status: 'rejected' });

    expect(presentation.storedPhotoValueFor).not.toHaveBeenCalled();
    expect(presentation.resolveReviewPhotoOutcome).not.toHaveBeenCalled();
    expect(processContestantPhoto).not.toHaveBeenCalled();
    expect(processContestantPhotoNoTemplate).not.toHaveBeenCalled();
  });

  it('does not consult a job for an application with no photograph at all', async () => {
    presentation.storedPhotoValueFor.mockReturnValue(undefined);

    await reviewRegistrationApplication('11111111-1111-4111-8111-111111111111', { status: 'approved' });

    expect(presentation.resolveReviewPhotoOutcome).not.toHaveBeenCalled();
    const written = updatePayloads.at(-1)?.form_data as Record<string, unknown>;
    expect(written['media.presentation']).toBeUndefined();
  });
});
