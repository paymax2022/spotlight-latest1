/**
 * Paid votes must reach the plane the app actually reads.
 *
 * THE DEFECT
 * A wallet purchase debited NGN 5,000, reported "50 votes credited", and the
 * contestant's count never moved. The purchase writes the UNIVERSAL engine
 * (votes / vote_totals); the mobile roster is served by Go's ListRoster, which
 * sums connect_votes.quantity (backend/internal/connect/voting/repo.go:34).
 * Two vote engines, and the money path only wrote one.
 *
 * These specs are written against the bridge that mirrors a credited purchase
 * into connect_votes. They fail before it exists — that is the point.
 *
 *   set -a; source frontend-web/.env.local; set +a
 *   npm run test:integration
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { mirrorPaidVoteToConnect } from '@/src/server/voting-bridge/connect-tally';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const live = Boolean(URL && KEY);
const db = () => createClient(URL as string, KEY as string, { auth: { persistSession: false } });

const SLUG = 'zz-tally-spec';
let contestId = '';
let contestantId = '';
let strangerId = '';
let voterId = '';
const refs: string[] = [];

describe.skipIf(!live)('paid votes reach the connect tally', () => {
  beforeAll(async () => {
    const { data: contest } = await db()
      .from('connect_contests')
      .insert({ title: 'ZZ Tally Spec', slug: SLUG, status: 'open', paid_vote_kobo: 10_000, free_votes_per_user: 0 })
      .select('id').single();
    contestId = (contest as { id: string }).id;

    const { data: other } = await db()
      .from('connect_contests')
      .insert({ title: 'ZZ Tally Other', slug: `${SLUG}-other`, status: 'open', paid_vote_kobo: 10_000, free_votes_per_user: 0 })
      .select('id').single();
    const otherContestId = (other as { id: string }).id;

    const { data: voter } = await db().from('registrations').select('user_id').not('user_id', 'is', null).limit(1);
    voterId = (voter?.[0] as { user_id: string }).user_id;

    const mk = async (cid: string, name: string) => {
      const { data } = await db().from('contestants')
        .insert({ name, contest_id: null, connect_contest_id: cid, status: 'approved', is_active: true })
        .select('id').single();
      return (data as { id: string }).id;
    };
    contestantId = await mk(contestId, 'ZZ Tally Contestant');
    strangerId = await mk(otherContestId, 'ZZ Tally Stranger');
    refs.push(otherContestId);
  });

  afterAll(async () => {
    await db().from('connect_votes').delete().eq('contest_id', contestId);
    await db().from('contestants').delete().in('id', [contestantId, strangerId].filter(Boolean));
    await db().from('vote_packages').delete().eq('contest_id', contestId);
    await db().from('voting_settings').delete().eq('contest_id', contestId);
    await db().from('contests').delete().eq('id', contestId);
    await db().from('connect_contests').delete().like('slug', `${SLUG}%`);
    const { data } = await db().from('connect_contests').select('id').like('slug', `${SLUG}%`);
    expect(data ?? [], 'fixtures must not leak').toHaveLength(0);
  });

  it('records the purchase as a paid connect vote the roster can count', async () => {
    const reference = `ZZTALLY-${Date.now()}-A`;
    const result = await mirrorPaidVoteToConnect({
      contestId, contestantId, voterUserId: voterId,
      quantity: 50, amountKobo: 500_000, reference,
    });
    expect(result.recorded).toBe(true);

    const { data } = await db()
      .from('connect_votes')
      .select('option_ref, quantity, amount_kobo, paid, ledger_ref')
      .eq('contest_id', contestId);

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    // option_ref holds the contestant UUID as text — the convention ListRoster
    // joins the tally on.
    expect(rows[0].option_ref).toBe(contestantId);
    expect(rows[0].quantity).toBe(50);
    expect(rows[0].amount_kobo).toBe(500_000);
    expect(rows[0].paid).toBe(true);
    expect(rows[0].ledger_ref).toBe(reference);
  });

  it('is idempotent — a replayed reference does not double the tally', async () => {
    const reference = `ZZTALLY-${Date.now()}-B`;
    const args = {
      contestId, contestantId, voterUserId: voterId,
      quantity: 10, amountKobo: 100_000, reference,
    };
    const first = await mirrorPaidVoteToConnect(args);
    const second = await mirrorPaidVoteToConnect(args);

    expect(first.recorded).toBe(true);
    expect(second.recorded).toBe(false);
    expect(second.reason).toBe('already_recorded');

    const { data } = await db()
      .from('connect_votes').select('id').eq('contest_id', contestId).eq('ledger_ref', reference);
    expect(data ?? [], 'a webhook and a redirect must not both count').toHaveLength(1);
  });

  it('refuses a contestant that is not on this contest — no phantom tally', async () => {
    const result = await mirrorPaidVoteToConnect({
      contestId, contestantId: strangerId, voterUserId: voterId,
      quantity: 5, amountKobo: 50_000, reference: `ZZTALLY-${Date.now()}-C`,
    });
    expect(result.recorded).toBe(false);
    expect(result.reason).toBe('contestant_not_in_contest');
  });

  it('refuses a non-positive quantity rather than writing a bad row', async () => {
    const result = await mirrorPaidVoteToConnect({
      contestId, contestantId, voterUserId: voterId,
      quantity: 0, amountKobo: 0, reference: `ZZTALLY-${Date.now()}-D`,
    });
    expect(result.recorded).toBe(false);
    expect(result.reason).toBe('invalid_quantity');
  });
});
