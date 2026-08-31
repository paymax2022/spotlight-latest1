/**
 * Every paid contest is votable — live-DB integration.
 *
 * Guards migration 20270127000000. The failure it exists to prevent is silent:
 * a contest opens, a contestant is approved onto the roster, and nobody can vote
 * because there is no package to price the purchase from.
 *
 *   set -a; source frontend-web/.env.local; set +a
 *   npm run test:integration
 */
import { describe, it, expect, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const live = Boolean(URL && KEY);
const db = () => createClient(URL as string, KEY as string, { auth: { persistSession: false } });

const SLUG = 'zz-ladder-spec';
const ids: string[] = [];

async function newContest(paidVoteKobo: number, withMirror: boolean): Promise<string> {
  const suffix = ids.length;
  const { data, error } = await db()
    .from('connect_contests')
    .insert({
      title: 'ZZ Ladder Spec',
      slug: `${SLUG}-${suffix}`,
      status: 'draft',
      paid_vote_kobo: paidVoteKobo,
      free_votes_per_user: 0,
    })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();
  const id = (data as { id: string }).id;
  ids.push(id);

  if (withMirror) {
    // vote_packages.contest_id is a FK to the LEGACY `contests` table, and
    // nothing mirrors connect_contests into it automatically.
    const { error: mirrorError } = await db()
      .from('contests')
      .insert({ id, name: 'ZZ Ladder Spec', slug: `${SLUG}-${suffix}`, status: 'draft' });
    expect(mirrorError, mirrorError?.message).toBeNull();
  }
  return id;
}

describe.skipIf(!live)('default vote package ladder', () => {
  afterAll(async () => {
    for (const id of ids) {
      await db().from('vote_packages').delete().eq('contest_id', id);
      await db().from('contests').delete().eq('id', id);
      await db().from('connect_contests').delete().eq('id', id);
    }
    const { data } = await db().from('connect_contests').select('id').like('slug', `${SLUG}%`);
    expect(data ?? [], 'fixture contests must not leak').toHaveLength(0);
  });

  it('prices the ladder in naira from the contest per-vote kobo price', async () => {
    const id = await newContest(10_000, true); // NGN 100/vote
    const { data } = await db()
      .from('vote_packages')
      .select('name, votes, amount')
      .eq('contest_id', id)
      .order('display_order');

    const rows = (data ?? []) as Array<{ votes: number; amount: number }>;
    expect(rows).toHaveLength(3);
    // NAIRA, not kobo: 10 votes at NGN 100 is 1000, not 100000. Getting this
    // wrong publishes every package at 100x its price.
    for (const r of rows) expect(Number(r.amount) / r.votes).toBe(100);
  });

  it('does not abort contest creation when the legacy mirror is missing', async () => {
    const id = await newContest(25_000, false);
    const { data } = await db().from('vote_packages').select('id').eq('contest_id', id);
    // No FK parent yet, so no packages — but the contest itself must exist.
    expect(data ?? []).toHaveLength(0);
    const { data: contest } = await db().from('connect_contests').select('id').eq('id', id).single();
    expect(contest).toBeTruthy();
  });

  it('does not resurrect packages an admin retired', async () => {
    const id = await newContest(10_000, true);
    await db().from('vote_packages').update({ is_active: false }).eq('contest_id', id);
    await db().from('connect_contests').update({ paid_vote_kobo: 50_000 }).eq('id', id);

    const { data } = await db().from('vote_packages').select('is_active').eq('contest_id', id);
    const rows = (data ?? []) as Array<{ is_active: boolean }>;
    expect(rows).toHaveLength(3);
    expect(rows.some((r) => r.is_active)).toBe(false);
  });
});
