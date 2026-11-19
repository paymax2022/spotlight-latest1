/**
 * The default sources of the Open Mic applicant console, against the real stack.
 *
 * WHY THIS EXISTS — the defect it would have caught.
 * `defaultOpenMicApplicantActionSources.findContest` selected `slug, title` from
 * `contests`. The column is `name`; there is no `title`. Every applicant action
 * therefore died on the FIRST read, before any decision, contact edit or email,
 * and the console answered 500 "Failed to update the Open Mic applicant" for all
 * seven buttons — approve, shortlist, waitlist, reject, disqualify, request
 * information, withdraw.
 *
 * None of that is visible in tests/unit/openmic/admin-applicant-actions.spec.ts.
 * Those specs inject fake sources on purpose (hermetic, no client), so they pass
 * whatever column list the real one happens to use. Only running the real
 * readers and writers against a migrated Postgres + PostgREST proves the shape
 * of the table matches the shape of the code. So this spec exercises the actual
 * exported object, not a stand-in.
 *
 * Only the mailer is replaced — a fake resolving false, so the spec never sends
 * a message to a real address. Everything else (findContest, findApplication,
 * review → the RPC, writeContact) is the production code path.
 *
 * Runs locally only, and skips without a stack:
 *   set -a; source frontend-web/.env.local; set +a
 *   npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import {
  applyOpenMicApplicantStatus,
  defaultOpenMicApplicantActionSources,
  editOpenMicApplicantContact,
} from '@/src/server/registration-v2/open-mic-applicant-actions';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const live = Boolean(URL && KEY);
const db = () => createClient(URL as string, KEY as string, { auth: { persistSession: false } });

/** The real sources with one seam: never send mail from a spec. */
const sources = { ...defaultOpenMicApplicantActionSources, mail: async () => false };

// registrations.reference has CHECK ~ '^[A-Z0-9]+-[0-9]+-[A-Z0-9]+$'.
const REFERENCE = `OPENMICSPEC-${Date.now()}-SEED`;
let contestId = '';
let contestSlug = '';
let contestName = '';
let applicationId = '';

describe.skipIf(!live)('open mic applicant action sources (live)', () => {
  beforeAll(async () => {
    // An Open Mic edition if the stack has one, otherwise any contest with a
    // slug. A slug is required, not cosmetic: the apply form keys registrations
    // by it, and rows seeded by other tools can have none — which the service
    // correctly reads as "no such contest", so it would fail this spec for a
    // reason that has nothing to do with the code under test.
    const openMic = await db()
      .from('contests')
      .select('id, slug, name')
      .like('slug', 'open-mic%')
      .limit(1);
    expect(openMic.error, openMic.error?.message).toBeNull();
    let row = (openMic.data ?? [])[0] as { id: string; slug: string; name: string } | undefined;
    if (!row) {
      const any = await db()
        .from('contests')
        .select('id, slug, name')
        .not('slug', 'is', null)
        .limit(1);
      expect(any.error, any.error?.message).toBeNull();
      row = (any.data ?? [])[0] as { id: string; slug: string; name: string } | undefined;
    }
    expect(row, 'no contest with a slug to read — seed the local stack first').toBeTruthy();
    contestId = row!.id;
    contestSlug = row!.slug;
    contestName = row!.name ?? '';

    const seed = await db()
      .from('registrations')
      .insert({
        contest_slug: contestSlug,
        reference: REFERENCE,
        status: 'submitted',
        current_step: 'review_submit',
        completion_percent: 100,
        submitted_at: new Date().toISOString(),
        form_data: {
          'personal.firstName': 'Openmic',
          'personal.lastName': 'Spec',
          'personal.email': 'openmic-spec@example.test',
          'account.email': 'openmic-spec@example.test',
          'personal.primaryPhone': '+2349000000000',
        },
      })
      .select('id')
      .single();
    expect(seed.error, seed.error?.message).toBeNull();
    applicationId = seed.data!.id;
  });

  afterAll(async () => {
    // The RPC writes an audit row per decision, so cleanup is two tables. The
    // roster is only touched by statuses this spec never applies, but a leaked
    // contestants row would be worse than a leaked registration, so it goes too.
    await db().from('contestants').delete().eq('registration_id', applicationId);
    await db().from('registration_status_events').delete().eq('registration_id', applicationId);
    await db().from('registrations').delete().eq('id', applicationId);
    const { data } = await db().from('registrations').select('id').eq('reference', REFERENCE);
    expect(data ?? [], 'fixture must not leak').toHaveLength(0);
  });

  it('reads the contest through the columns contests actually has', async () => {
    const contest = await defaultOpenMicApplicantActionSources.findContest(contestId);
    expect(contest, 'findContest returned null for a row that exists').toBeTruthy();
    expect(contest!.slug).toBe(contestSlug);
    // The assertion that fails on a wrong column name: `title` must be filled
    // from `contests.name`, because that is the only title-like column there is.
    expect(contest!.title).toBe(contestName);
  });

  it('reads the seeded application as a draft the console can act on', async () => {
    const draft = await defaultOpenMicApplicantActionSources.findApplication(applicationId);
    expect(draft, 'findApplication returned null for a row that exists').toBeTruthy();
    expect(draft!.contestSlug).toBe(contestSlug);
    expect(draft!.formData?.['personal.email']).toBe('openmic-spec@example.test');
  });

  it('writes a decision through the review RPC and audits it', async () => {
    const result = await applyOpenMicApplicantStatus(
      { contestId, applicationId, action: 'request_information', note: 'Please re-upload a clearer profile photo.' },
      sources,
    );
    // false is the mailer seam, not a bug: this spec replaces mail.
    expect(result).toEqual({ status: 'more_information_requested', emailDelivered: false });

    const stored = await db().from('registrations').select('status').eq('id', applicationId).single();
    expect(stored.data?.status).toBe('more_information_requested');

    const events = await db()
      .from('registration_status_events')
      .select('old_status, new_status, note')
      .eq('registration_id', applicationId)
      .order('created_at', { ascending: false });
    expect(events.error, events.error?.message).toBeNull();
    expect(events.data?.[0]).toMatchObject({
      old_status: 'submitted',
      new_status: 'more_information_requested',
      note: 'Please re-upload a clearer profile photo.',
    });
  });

  it('merges a contact edit into form_data instead of replacing it', async () => {
    await editOpenMicApplicantContact(
      { contestId, applicationId, patch: { email: 'fixed@example.test', phone: '+2348000001111' } },
      sources,
    );

    const stored = await db().from('registrations').select('form_data').eq('id', applicationId).single();
    const data = stored.data?.form_data as Record<string, string>;
    // Both email columns move together, and the names the patch never mentions survive.
    expect(data['personal.email']).toBe('fixed@example.test');
    expect(data['account.email']).toBe('fixed@example.test');
    expect(data['personal.primaryPhone']).toBe('+2348000001111');
    expect(data['personal.firstName']).toBe('Openmic');
  });

  it('refuses to act on an application from another contest', async () => {
    const others = await db()
      .from('contests')
      .select('id, slug')
      .neq('id', contestId)
      .not('slug', 'is', null)
      .limit(1);
    const other = (others.data ?? [])[0] as { id: string; slug: string } | undefined;
    if (!other) return; // a single-contest stack cannot prove this case

    await expect(
      applyOpenMicApplicantStatus({ contestId: other.id, applicationId, action: 'approve' }, sources),
    ).rejects.toThrow(/contest/i);

    const stored = await db().from('registrations').select('status').eq('id', applicationId).single();
    expect(stored.data?.status, 'a refused action must leave the row alone').not.toBe('approved');
  });
});
