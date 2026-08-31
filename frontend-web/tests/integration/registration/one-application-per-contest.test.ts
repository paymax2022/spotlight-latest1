/**
 * One live application per contest — live-DB integration.
 *
 * Gated on NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY so it skips in
 * environments without a database, matching the repo's live-DB convention.
 * Run against local Supabase with:
 *
 *   set -a; source frontend-web/.env.local; set +a
 *   npx vitest run tests/integration/registration
 *
 * Every row it creates is removed in afterAll; it asserts that itself, because a
 * test that seeds a shared local database and leaks is worse than no test.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const live = Boolean(URL && KEY);

const SLUG = 'zz-vitest-one-per-contest';
const REF = `ZZVITEST-${Math.floor(Math.random() * 900000 + 100000)}-ONE`;

const db = () => createClient(URL as string, KEY as string, { auth: { persistSession: false } });

let userId = '';
let registrationId = '';

describe.skipIf(!live)('one live application per contest', () => {
  beforeAll(async () => {
    const { data: users } = await db().from('registrations').select('user_id').not('user_id', 'is', null).limit(1);
    userId = (users?.[0] as { user_id: string } | undefined)?.user_id ?? '';
    expect(userId, 'need an existing user to attach the fixture to').toBeTruthy();

    const { data, error } = await db()
      .from('registrations')
      .insert({
        user_id: userId,
        contest_slug: SLUG,
        reference: REF,
        status: 'submitted',
        form_data: {},
        current_step: 'review_submit',
        completion_percent: 100,
        role: 'public_user',
      })
      .select('id')
      .single();

    expect(error, error?.message).toBeNull();
    registrationId = (data as { id: string }).id;
  });

  afterAll(async () => {
    await db().from('registration_status_events').delete().eq('registration_id', registrationId);
    await db().from('contestants').delete().eq('registration_id', registrationId);
    await db().from('registrations').delete().eq('contest_slug', SLUG);

    const { data } = await db().from('registrations').select('id').eq('contest_slug', SLUG);
    expect(data ?? [], 'fixture rows must not leak into the shared local database').toHaveLength(0);
  });

  it('rejects a second live application for the same contest', async () => {
    const { error } = await db().from('registrations').insert({
      user_id: userId,
      contest_slug: SLUG,
      reference: `${REF}X`,
      status: 'draft',
      form_data: {},
      current_step: 'contest_selection',
      completion_percent: 0,
      role: 'public_user',
    });

    // 23505 = unique_violation on registrations_one_live_per_user_contest.
    expect(error?.code).toBe('23505');
  });

  it('allows a new application once the first is withdrawn', async () => {
    await db().from('registrations').update({ status: 'withdrawn' }).eq('id', registrationId);

    const { data, error } = await db()
      .from('registrations')
      .insert({
        user_id: userId,
        contest_slug: SLUG,
        reference: `${REF}Y`,
        status: 'draft',
        form_data: {},
        current_step: 'contest_selection',
        completion_percent: 0,
        role: 'public_user',
      })
      .select('id')
      .single();

    expect(error, error?.message).toBeNull();
    expect(data).toBeTruthy();
  });

  it('promotes to the roster on approval and deactivates on rejection', async () => {
    const { data: live } = await db()
      .from('registrations')
      .select('id')
      .eq('contest_slug', SLUG)
      .neq('status', 'withdrawn')
      .limit(1)
      .single();

    const id = (live as { id: string }).id;

    const { data: approved, error: approveError } = await db().rpc('review_registration_application', {
      p_registration_id: id,
      p_status: 'approved',
      p_note: 'vitest',
      p_actor_role: 'admin',
    });
    expect(approveError, approveError?.message).toBeNull();
    expect(approved?.[0]?.promoted).toBe(true);
    expect(approved?.[0]?.contestant_id).toBeTruthy();

    const { data: rejected } = await db().rpc('review_registration_application', {
      p_registration_id: id,
      p_status: 'rejected',
      p_note: 'vitest',
      p_actor_role: 'admin',
    });
    expect(rejected?.[0]?.removed).toBe(true);

    const { data: roster } = await db()
      .from('contestants')
      .select('is_active')
      .eq('registration_id', id)
      .single();
    // Deactivated, never deleted — cast votes reference this row.
    expect((roster as { is_active: boolean }).is_active).toBe(false);
  });
});
