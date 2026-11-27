/**
 * SPEC §6 — the render starts at SUBMISSION, not at approval.
 *
 * Why the hook is here rather than only in the review path: the first time any
 * code looked at a contestant's photograph used to be the admin's approval
 * click, which meant the moderation verdict, the background removal and the
 * compositing all happened (or failed) inside one request, and a contestant
 * could not be shown a processed portrait before a human had decided to promote
 * them. Queuing at submission moves the vendor off both critical paths; the
 * review then reads whatever the queue concluded (see
 * `review-template-wiring.test.ts` and `photo-jobs/review-no-overwrite.test.ts`).
 *
 * The three properties this file exists to protect are about the hook being
 * *detached*:
 *
 *  1. A successful submission stays successful when the photo queue is broken.
 *     The row is the applicant's submission; a pipeline outage must not be
 *     reported to them as "your application failed", so nothing here is awaited
 *     and the rejection is swallowed with a warning.
 *  2. A submission that has not actually happened yet (awaiting payment) starts
 *     nothing — no vendor spend on an entry that may never exist.
 *  3. A slow queue does not slow the applicant down. The test that makes this
 *     provable hands the hook a promise that never settles.
 *
 * Harness shape is copied from `submission-lock.spec.ts`: one store import at
 * module scope, the row under test read through a closure at query time.
 * Re-importing per test re-transforms the whole module graph and times the file
 * out under a full-suite run.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const APP_ID = '8977dc4a-630c-4658-9967-120dfbad1e44';
// The route the upload endpoint mints, i.e. what today's wizard really stores.
const PHOTO_ROUTE = '/api/registration/uploads/cmVnaXN0cmF0aW9uL3UtOS9mYWNlLmpwZw';

let currentFormData: Record<string, unknown> = { 'media.rightsConfirmed': true };
const captured: { inserts: any[]; updates: any[] } = { inserts: [], updates: [] };

function draftRow() {
  return {
    id: APP_ID,
    reference: 'OPENMI-000001-XXXX',
    // A free contest on purpose: `open-mic-competition` charges a fee, so its
    // submit lands on `awaiting_payment` and the hook would correctly not fire,
    // which is the other test below rather than the subject of this one.
    contest_slug: 'stem-contest',
    status: 'draft',
    role: 'public_user',
    user_id: 'user-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    submitted_at: null,
    completion_percent: 80,
    current_step: 'review_submit',
    fraud_flags: [],
    form_data: currentFormData,
  };
}

function chainFor(table: string, row: () => any, maybeRow: any): any {
  const chain: any = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.not = () => chain;
  chain.order = () => chain;
  chain.update = (vals: any) => {
    captured.updates.push({ table, vals });
    return chain;
  };
  chain.insert = (rows: any) => {
    for (const r of Array.isArray(rows) ? rows : [rows]) captured.inserts.push({ table, row: r });
    return chain;
  };
  chain.single = () => {
    const data = row();
    return Promise.resolve({ data, error: data ? null : { code: 'PGRST116', message: 'nf' } });
  };
  chain.maybeSingle = () => Promise.resolve({ data: maybeRow, error: null });
  chain.then = (resolve: any) => resolve({ data: null, error: null });
  return chain;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: (table: string) =>
      table === 'registrations' ? chainFor(table, draftRow, null) : chainFor(table, () => null, null),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  })),
}));

vi.mock('@/src/server/voting/payment/paystack', () => ({
  verifyPaystackPayment: vi.fn().mockResolvedValue({ success: false, amountKobo: 0 }),
}));

// One always-valid step, so the only thing that can stop the submit is the
// hook itself — which is what these tests would be measuring.
vi.mock('@/src/features/registration/config', async (importOriginal) => {
  const real = (await importOriginal()) as any;
  return {
    ...real,
    buildRegistrationSteps: () => [
      {
        key: 'category_specific',
        title: 'Contest Requirements',
        description: '',
        fields: [{ key: 'media.rightsConfirmed', label: 'Rights', type: 'checkbox', required: true }],
      },
    ],
  };
});

const presentation = vi.hoisted(() => ({
  startPhotoForSubmission: vi.fn(),
  storedPhotoValueFor: vi.fn(),
  resolveReviewPhotoOutcome: vi.fn(),
}));
vi.mock('@/src/server/photo-jobs/presentation', () => presentation);

const store = await import('@/src/server/registration/supabase-store');

beforeEach(() => {
  currentFormData = { 'media.rightsConfirmed': true, 'media.profilePhoto': PHOTO_ROUTE };
  captured.inserts.length = 0;
  captured.updates.length = 0;
  presentation.startPhotoForSubmission.mockResolvedValue({ started: true });
});

describe('spec §6: submitting an application starts its photo render', () => {
  it('hands the hook the registration id, the contest and the stored form data', async () => {
    await store.submitRegistrationApplication(APP_ID);

    // The hook is deliberately detached, so it lands a microtask after the
    // response rather than before it. `waitFor` is the honest way to assert a
    // side effect that is not on the request's critical path — and the test
    // below that hands it a never-settling promise is what proves the
    // detachment is real rather than merely fast.
    await vi.waitFor(() => expect(presentation.startPhotoForSubmission).toHaveBeenCalledTimes(1));
    expect(presentation.startPhotoForSubmission).toHaveBeenCalledWith({
      registrationId: APP_ID,
      contestSlug: 'stem-contest',
      formData: expect.objectContaining({ 'media.profilePhoto': PHOTO_ROUTE }),
    });
  });

  it('queues nothing for an entry that is still waiting to be paid for', async () => {
    // `awaiting_payment` is not a submission: the row exists, the money does
    // not, and a contest fee that is never paid would otherwise have spent
    // vendor calls on an entry that never becomes a contestant.
    currentFormData = { 'media.rightsConfirmed': true, 'media.profilePhoto': PHOTO_ROUTE, 'payment.paymentStatus': 'pending' };

    const result = await store.submitRegistrationApplication(APP_ID);

    expect(result.draft.status).toBe('awaiting_payment');
    expect(presentation.startPhotoForSubmission).not.toHaveBeenCalled();
  });

  it('a broken photo queue does not fail the applicant’s submission', async () => {
    presentation.startPhotoForSubmission.mockRejectedValue(new Error('job store unreachable'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await store.submitRegistrationApplication(APP_ID);

    expect(result.success).toBe(true);
    expect(result.draft.status).toBe('submitted');
    // The rejection is detached, so the warning is what proves it was caught
    // rather than simply never reached yet.
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[photo-jobs] submission enqueue failed:', 'job store unreachable'));
    warn.mockRestore();
  });

  it('an unreachable presentation module is not a failed submission either', async () => {
    // The module arrives through a dynamic import, so its failure is a
    // rejection of the import itself, outside `startPhotoForSubmission`'s own
    // never-throws promise. Same rule, different leg of the chain.
    presentation.startPhotoForSubmission.mockImplementation(() => {
      throw new Error('module evaluation exploded');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(store.submitRegistrationApplication(APP_ID)).resolves.toMatchObject({ success: true });
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    warn.mockRestore();
  });

  it('does not make the applicant wait for the queue', async () => {
    // A promise that never settles: if the hook were awaited, this test would
    // hit vitest's timeout rather than fail an assertion, which is the point.
    presentation.startPhotoForSubmission.mockReturnValue(new Promise(() => {}));

    await expect(store.submitRegistrationApplication(APP_ID)).resolves.toMatchObject({
      success: true,
      draft: { status: 'submitted' },
    });
  });
});
