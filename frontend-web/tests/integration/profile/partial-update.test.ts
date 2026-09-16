/**
 * A partial profile update saves what it was given and touches nothing else.
 *
 * THE DEFECT. updateUserProfile spelled out every column as `patch.x || null`.
 * user_profiles.full_name is NOT NULL, so `PUT /api/me/profile {"phone":"…"}`
 * — which carries no name — sent full_name: null, the upsert failed 23502, and
 * the fallback quietly persisted only id/email/role. The route answered 200 and
 * saved nothing, so no existing user could ever add a phone number. That is why
 * only 2 of 7,034 profiles had one, and why the marketplace seller-phone reveal
 * had almost nobody to reveal.
 *
 * The second defect was latent behind the first: had the write succeeded, a
 * phone-only patch would also have nulled first_name, city, address and every
 * other field the caller never mentioned.
 *
 * WHY THIS IS THE ONLY SPEC LEFT IN tests/integration. The three that sat beside
 * it (vote package ladder, connect tally trigger, one-application-per-contest)
 * asserted pure DATABASE behaviour — triggers, a partial unique index, an RPC —
 * and so were ported to backend/tests/voting/*_live_db_test.go, where the CI
 * Postgres service actually runs them. They could not be wired into
 * integration-verify.yml as they stood: that job provides a migrated BARE
 * Postgres with no PostgREST, so supabase-js would have found no SUPABASE_URL,
 * skipped, and reported green while guarding nothing.
 *
 * This one stays because it is not a database test. It exercises
 * updateUserProfile — application code, and the omit-undefined logic above is
 * the thing under test — so it cannot move to a Go suite. It runs locally only:
 *
 *   set -a; source frontend-web/.env.local; set +a
 *   npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { updateUserProfile } from '@/src/server/user/profile';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const live = Boolean(URL && KEY);
const db = () => createClient(URL as string, KEY as string, { auth: { persistSession: false } });

const EMAIL = `profile-partial-${Date.now()}@seed.test`;
let userId = '';

describe.skipIf(!live)('partial profile update', () => {
  beforeAll(async () => {
    const { data, error } = await db().auth.admin.createUser({
      email: EMAIL,
      email_confirm: true,
      user_metadata: { full_name: 'Original Name' },
    });
    expect(error, error?.message).toBeNull();
    userId = data.user!.id;

    // A profile with a name and a city, and deliberately no phone.
    await db().from('user_profiles').upsert({
      id: userId, email: EMAIL, full_name: 'Original Name', city: 'Lagos', phone: '',
    });
  });

  afterAll(async () => {
    await db().from('user_profiles').delete().eq('id', userId);
    await db().auth.admin.deleteUser(userId).catch(() => {});
    const { data } = await db().from('user_profiles').select('id').eq('id', userId);
    expect(data ?? [], 'fixture must not leak').toHaveLength(0);
  });

  it('saves a phone-only patch', async () => {
    await updateUserProfile({ id: userId, email: EMAIL } as never, { phone: '08099911122' } as never);

    const { data } = await db()
      .from('user_profiles').select('phone').eq('id', userId).single();
    expect((data as { phone: string }).phone).toBe('08099911122');
  });

  it('leaves the fields it was not given alone', async () => {
    await updateUserProfile({ id: userId, email: EMAIL } as never, { phone: '08099911122' } as never);

    const { data } = await db()
      .from('user_profiles').select('full_name, city').eq('id', userId).single();
    const row = data as { full_name: string; city: string };
    // Before the fix these were nulled by a patch that never mentioned them —
    // or, more often, the whole write failed and nothing was saved at all.
    expect(row.full_name).toBe('Original Name');
    expect(row.city).toBe('Lagos');
  });
});
