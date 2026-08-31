/**
 * Every contest is votable, and the two contest planes stay joined.
 *
 * Guards migrations 20270127000000 (package ladder), 20270128000000 (open
 * contests always votable) and 20270129000000 (connect -> legacy mirror).
 *
 * The failure these exist to prevent is silent: a contest opens, a contestant is
 * approved onto the roster, and nobody can vote — either because there is no
 * package to price the purchase from, or because the contest has no legacy row
 * and therefore cannot hold a package at all.
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

const PREFIX = 'zz-voting-spec';
const created: string[] = [];
/** Legacy rows created directly, with no connect twin — cleaned separately. */
const legacyOnly: string[] = [];

/**
 * A connect contest. Its legacy twin and, when priced, its package ladder are
 * created by triggers — the tests assert that rather than arranging it.
 */
async function makeContest(fields: {
  status?: string;
  paidVoteKobo?: number;
  freeVotes?: number;
  slug?: string;
}): Promise<Record<string, unknown>> {
  const { data, error } = await db()
    .from('connect_contests')
    .insert({
      title: 'ZZ Voting Spec',
      slug: fields.slug ?? `${PREFIX}-${created.length}`,
      status: fields.status ?? 'draft',
      paid_vote_kobo: fields.paidVoteKobo ?? 0,
      free_votes_per_user: fields.freeVotes ?? 0,
    })
    .select('id, status, paid_vote_kobo, free_votes_per_user')
    .single();
  expect(error, error?.message).toBeNull();
  const row = data as Record<string, unknown>;
  created.push(String(row.id));
  return row;
}

// Cleanup covers BOTH planes. An earlier version deleted only connect_contests
// and leaked 5 legacy rows, which then collided on the unique slug index and
// failed the next run — the mirror means a fixture now touches three tables.
afterAll(async () => {
  if (!live) return;
  for (const id of created) {
    await db().from('vote_packages').delete().eq('contest_id', id);
    await db().from('contests').delete().eq('id', id);
    await db().from('connect_contests').delete().eq('id', id);
  }
  for (const id of legacyOnly) {
    await db().from('contests').delete().eq('id', id);
  }
  const { data: connect } = await db().from('connect_contests').select('id').like('slug', `${PREFIX}%`);
  const { data: legacy } = await db().from('contests').select('id').like('slug', `${PREFIX}%`);
  expect(connect ?? [], 'connect fixtures must not leak').toHaveLength(0);
  expect(legacy ?? [], 'legacy mirror fixtures must not leak').toHaveLength(0);
});

describe.skipIf(!live)('default vote package ladder', () => {
  it('prices the ladder in naira from the contest per-vote kobo price', async () => {
    const row = await makeContest({ paidVoteKobo: 10_000 }); // NGN 100/vote
    const { data } = await db()
      .from('vote_packages').select('votes, amount').eq('contest_id', row.id).order('display_order');

    const rows = (data ?? []) as Array<{ votes: number; amount: number }>;
    expect(rows).toHaveLength(3);
    // NAIRA, not kobo: 10 votes at NGN 100 is 1000, not 100000. Getting this
    // wrong publishes every package at 100x its price.
    for (const r of rows) expect(Number(r.amount) / r.votes).toBe(100);
  });

  it('seeds nothing for an unpriced contest — there is no rate to derive', async () => {
    const row = await makeContest({ paidVoteKobo: 0, freeVotes: 1 });
    const { data } = await db().from('vote_packages').select('id').eq('contest_id', row.id);
    expect(data ?? []).toHaveLength(0);
  });

  it('does not resurrect packages an admin retired', async () => {
    const row = await makeContest({ paidVoteKobo: 10_000 });
    await db().from('vote_packages').update({ is_active: false }).eq('contest_id', row.id);
    await db().from('connect_contests').update({ paid_vote_kobo: 50_000 }).eq('id', row.id);

    const { data } = await db().from('vote_packages').select('is_active').eq('contest_id', row.id);
    const rows = (data ?? []) as Array<{ is_active: boolean }>;
    expect(rows).toHaveLength(3);
    expect(rows.some((r) => r.is_active)).toBe(false);
  });
});

describe.skipIf(!live)('open contests are always votable', () => {
  it('leaves an unconfigured draft alone', async () => {
    const row = await makeContest({ status: 'draft' });
    expect(row.free_votes_per_user).toBe(0);
  });

  it('grants the house default when a contest is created open', async () => {
    const row = await makeContest({ status: 'open' });
    expect(row.free_votes_per_user).toBe(1);
  });

  it('grants it at the moment a draft is opened', async () => {
    const row = await makeContest({ status: 'draft' });
    const { data } = await db()
      .from('connect_contests').update({ status: 'open' }).eq('id', row.id)
      .select('free_votes_per_user').single();
    expect((data as { free_votes_per_user: number }).free_votes_per_user).toBe(1);
  });

  it('leaves a priced contest on 0 free votes — the price is the route', async () => {
    const row = await makeContest({ status: 'open', paidVoteKobo: 10_000 });
    expect(row.free_votes_per_user).toBe(0);
  });

  it('never overwrites an explicit allowance', async () => {
    const row = await makeContest({ status: 'open', freeVotes: 5 });
    expect(row.free_votes_per_user).toBe(5);
  });
});

describe.skipIf(!live)('connect contests are mirrored into the legacy plane', () => {
  it('creates the legacy row, so the contest can hold packages', async () => {
    const row = await makeContest({ status: 'open', paidVoteKobo: 10_000 });

    const { data: legacy } = await db().from('contests').select('id').eq('id', row.id).maybeSingle();
    expect(legacy, 'a connect contest must get its legacy twin').toBeTruthy();

    // The payoff: vote_packages.contest_id FKs to `contests`, so before the
    // mirror a connect-created paid contest could hold no package at all.
    const { data: packages } = await db().from('vote_packages').select('id').eq('contest_id', row.id);
    expect(packages ?? []).toHaveLength(3);
  });

  it('keeps the kobo price exact when the legacy naira column cannot hold it', async () => {
    // 10050 kobo is NGN 100.50, and vote_price_ngn is INTEGER naira. Without the
    // restore, the round trip through the legacy plane reprices it to 10100.
    const row = await makeContest({ status: 'open', paidVoteKobo: 10_050 });
    const { data } = await db()
      .from('connect_contests').select('paid_vote_kobo').eq('id', row.id).single();
    expect((data as { paid_vote_kobo: number }).paid_vote_kobo).toBe(10_050);
  });

  it('yields the slug rather than failing when a legacy contest already holds it', async () => {
    // contests.slug carries a UNIQUE INDEX. Copying a colliding slug would raise
    // 23505 inside an AFTER trigger and abort creation of the connect contest.
    //
    // A collision is only reachable when a legacy row has NO connect twin —
    // otherwise connect's own unique slug index rejects the second contest
    // first. sync_connect_contest() skips names shorter than 2 characters, so a
    // 1-character name is how you get a legacy row that was never mirrored.
    const takenSlug = `${PREFIX}-taken`;
    const orphanId = '9f3c1d20-0000-4000-8000-00000000abcd';
    const { error: legacyError } = await db()
      .from('contests')
      .insert({ id: orphanId, name: 'X', slug: takenSlug, status: 'draft' });
    expect(legacyError, legacyError?.message).toBeNull();
    legacyOnly.push(orphanId);

    // The real assertion: this insert must SUCCEED. Before the fix the mirror
    // copied the slug, hit the unique index, and took this whole write down.
    const row = await makeContest({ slug: takenSlug });
    expect(row.id).toBeTruthy();

    // The mirror exists (so packages remain possible) but yielded the slug.
    const { data: mirror } = await db()
      .from('contests').select('slug').eq('id', row.id).single();
    expect((mirror as { slug: string | null }).slug).toBeNull();

    // And the original legacy row kept its slug.
    const { data: original } = await db()
      .from('contests').select('slug').eq('id', orphanId).single();
    expect((original as { slug: string }).slug).toBe(takenSlug);
  });
});
