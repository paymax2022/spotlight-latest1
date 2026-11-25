/**
 * WHY THIS EXISTS — the defect it pins down against a REAL database.
 *
 * An admin at /admin/registration clicked Approve and got
 *   "Reviewing application failed: Failed to review registration application"
 * next to a row showing `Fraud flags: missing_id_number`, which looked like the
 * reason. It was not: nothing in the review path blocks on fraud_flags. The
 * review was refused on purpose because the applicant had never ticked the
 * public-voting consent, and the refusal arrived as a plain Error, which
 * `handleApiError` flattens into a bare 500 with the route's fallback sentence.
 * Correct decision, unreadable answer, and no way for the admin to act.
 *
 * The hermetic specs (tests/unit/registration/consent-gating.test.ts) mock the
 * Supabase client, so they can only prove the shape of the throw. This spec
 * runs the real store against a migrated Postgres + PostgREST and proves the
 * two things a mock cannot:
 *   1. a refusal leaves the applicant's row EXACTLY as it was (status, form_data,
 *      and no audit event), so the admin's retry is safe; and
 *   2. once the consent exists, the same approval goes through and promotes the
 *      applicant — i.e. surfacing the reason did not break the seam.
 *
 * Runs locally only, and skips without a stack:
 *   set -a; source frontend-web/.env.local; set +a
 *   npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { reviewRegistrationApplication, getRegistrationDraft } from '@/src/server/registration/supabase-store';
import { ApiError } from '@/src/lib/api/responses';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const live = Boolean(URL && KEY);
const db = () => createClient(URL as string, KEY as string, { auth: { persistSession: false } });

// registrations.reference has CHECK ~ '^[A-Z0-9]+-[0-9]+-[A-Z0-9]+$'.
const REFERENCE = `REVSPEC-${Date.now()}-SEED`;
// A slug whose OWN built form collects publicProfile.publicVotingConsent and
// whose derived.supportsVoting is true — the exact combination the SEC-010 gate
// enforces. The choice is not cosmetic: the gate checks field presence through
// the real form builder, so a slug that never renders the field would make this
// spec assert a refusal that the code deliberately does not implement.
const CONTEST_SLUG = 'open-mic-competition';

let applicationId = '';

async function seed(status: string, formData: Record<string, unknown>) {
  const { data, error } = await db()
    .from('registrations')
    .insert({
      contest_slug: CONTEST_SLUG,
      reference: REFERENCE,
      status,
      current_step: 'review_submit',
      completion_percent: 100,
      submitted_at: new Date().toISOString(),
      // The flag from the bug report, carried on purpose: it must be irrelevant
      // to whether the review succeeds.
      fraud_flags: ['missing_id_number'],
      form_data: {
        'personal.firstName': 'Review',
        'personal.lastName': 'Spec',
        'personal.email': 'review-spec@example.test',
        'account.email': 'review-spec@example.test',
        'personal.primaryPhone': '+2349000000000',
        ...formData,
      },
    })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();
  return data!.id as string;
}

describe.skipIf(!live)('admin review refusal (live)', () => {
  beforeAll(async () => {
    applicationId = await seed('submitted', {
      'derived.supportsVoting': true,
      'media.rightsConfirmed': true,
      // publicProfile.publicVotingConsent deliberately absent.
    });
  });

  afterAll(async () => {
    await db().from('contestants').delete().eq('registration_id', applicationId);
    await db().from('registration_status_events').delete().eq('registration_id', applicationId);
    await db().from('registrations').delete().eq('id', applicationId);
    const { data } = await db().from('registrations').select('id').eq('reference', REFERENCE);
    expect(data ?? [], 'fixture must not leak').toHaveLength(0);
  });

  it('refuses the promotion as an actionable 409, naming the remedy', async () => {
    const refusal = await reviewRegistrationApplication(applicationId, { status: 'approved' }).then(
      () => null,
      (e) => e as ApiError,
    );

    expect(refusal).toBeInstanceOf(ApiError);
    expect(refusal!.status).toBe(409);
    expect(refusal!.code).toBe('consent_voting_visibility_required');
    // The admin must be able to act on the answer without opening a terminal.
    expect(refusal!.message).toMatch(/public voting visibility/i);
    expect(refusal!.message).toMatch(/more information requested/i);
    // `missing_id_number` was never the cause, and must not appear as one.
    expect(refusal!.message).not.toMatch(/id_number/i);
  });

  it('leaves the application exactly as it was, so retrying after resolving is safe', async () => {
    const before = await db()
      .from('registrations')
      .select('status, form_data, updated_at')
      .eq('id', applicationId)
      .single();
    expect(before.data!.status).toBe('submitted');

    await reviewRegistrationApplication(applicationId, { status: 'approved' }).catch(() => null);

    const after = await db()
      .from('registrations')
      .select('status, form_data, updated_at')
      .eq('id', applicationId)
      .single();
    expect(after.data!.status).toBe('submitted');
    expect(after.data!.updated_at).toBe(before.data!.updated_at);
    expect((after.data!.form_data as any)['admin.reviewNote'] ?? '').toBe('');

    const { data: events } = await db()
      .from('registration_status_events')
      .select('id')
      .eq('registration_id', applicationId)
      .eq('new_status', 'approved');
    expect(events ?? [], 'a refused review must not book a decision').toHaveLength(0);
  });

  it('approves for real once the consent exists, and promotes the applicant', async () => {
    const draft = await getRegistrationDraft(applicationId);
    expect(draft).toBeTruthy();

    // Grant the consent the way the applicant would (the console cannot do this
    // for them — that is the point of the gate), then retry the same action.
    const { error: patchError } = await db()
      .from('registrations')
      .update({ form_data: { ...draft!.formData, 'publicProfile.publicVotingConsent': true } })
      .eq('id', applicationId);
    expect(patchError, patchError?.message).toBeNull();

    const updated = await reviewRegistrationApplication(applicationId, { status: 'approved' });
    expect(updated.status).toBe('approved');

    const { data: roster } = await db()
      .from('contestants')
      .select('id')
      .eq('registration_id', applicationId);
    expect(roster ?? [], 'approve must put the applicant on the roster').toHaveLength(1);
  });
});
