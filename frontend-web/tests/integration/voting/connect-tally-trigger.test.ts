/**
 * The connect tally follows the credit — guards migration 20270140000000.
 *
 * A money-path audit found the first attempt at this (a TypeScript bridge called
 * from two routes) covered ONE of four entry points: voting/payment/webhook.ts
 * calls verifyAndCreditPaidVote() directly and app/vote-callback still posts to
 * the v1 verify route, and all of those files are brownfield-protected. Every
 * rail ends at vote_transactions.vote_credit_status = 'credited', so the
 * projection is driven from there instead and cannot be bypassed by a new caller.
 *
 * These specs exercise the rails through the TABLE, which is what the webhook
 * does — not through a route, which is what only one rail does.
 *
 *   set -a; source frontend-web/.env.local; set +a
 *   npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const live = Boolean(URL && KEY);
const db = () => createClient(URL as string, KEY as string, { auth: { persistSession: false } });

const SLUG = 'zz-trigger-spec';
let contestId = '';
let contestantId = '';
let voterId = '';
const txIds: string[] = [];

async function credit(reference: string, opts: {
  contestantId?: string; votes?: number; naira?: number; status?: string;
} = {}): Promise<string> {
  const { data, error } = await db().from('vote_transactions').insert({
    contest_id: contestId,
    contestant_id: opts.contestantId ?? contestantId,
    voter_user_id: voterId,
    payment_provider: 'paystack',
    payment_reference: reference,
    amount_expected: opts.naira ?? 5000.0,
    votes_purchased: opts.votes ?? 50,
    bonus_votes: 0,
    total_votes_to_credit: opts.votes ?? 50,
    payment_status: 'successful',
    vote_credit_status: opts.status ?? 'pending',
    voter_email: 'zz@example.com',
    voter_name: 'ZZ',
  }).select('id').single();
  expect(error, error?.message).toBeNull();
  const id = (data as { id: string }).id;
  txIds.push(id);
  return id;
}

const mirrorRows = async (reference: string) =>
  (await db().from('connect_votes').select('quantity, amount_kobo, paid, option_ref').eq('ledger_ref', reference)).data ?? [];

describe.skipIf(!live)('connect tally follows the credit', () => {
  beforeAll(async () => {
    const { data: c } = await db().from('connect_contests')
      .insert({ title: 'ZZ Trigger Spec', slug: SLUG, status: 'open', paid_vote_kobo: 10_000, free_votes_per_user: 0 })
      .select('id').single();
    contestId = (c as { id: string }).id;

    const { data: ct } = await db().from('contestants')
      .insert({ name: 'ZZ Trigger Contestant', connect_contest_id: contestId, status: 'approved', is_active: true })
      .select('id').single();
    contestantId = (ct as { id: string }).id;

    const { data: u } = await db().from('registrations').select('user_id').not('user_id', 'is', null).limit(1);
    voterId = (u?.[0] as { user_id: string }).user_id;
  });

  afterAll(async () => {
    for (const id of txIds) await db().from('vote_transactions').delete().eq('id', id);
    await db().from('connect_votes').delete().eq('contest_id', contestId);
    await db().from('bridge_outbox').delete().eq('event_type', 'votes.paid.tally_skipped');
    await db().from('contestants').delete().eq('id', contestantId);
    await db().from('vote_packages').delete().eq('contest_id', contestId);
    await db().from('voting_settings').delete().eq('contest_id', contestId);
    await db().from('contests').delete().eq('id', contestId);
    await db().from('connect_contests').delete().eq('id', contestId);
    const { data } = await db().from('connect_contests').select('id').like('slug', `${SLUG}%`);
    expect(data ?? [], 'fixtures must not leak').toHaveLength(0);
  });

  it('does not count a purchase that has not been credited', async () => {
    const ref = `ZZTRG-${Date.now()}-PENDING`;
    await credit(ref);
    expect(await mirrorRows(ref)).toHaveLength(0);
  });

  it('counts the purchase when the webhook credits it, with no route involved', async () => {
    const ref = `ZZTRG-${Date.now()}-WEBHOOK`;
    const id = await credit(ref);
    await db().from('vote_transactions').update({ vote_credit_status: 'credited' }).eq('id', id);

    const rows = await mirrorRows(ref) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(50);
    // amount_expected is NAIRA (5000.00); connect_votes.amount_kobo is minor units.
    expect(rows[0].amount_kobo).toBe(500_000);
    expect(rows[0].paid).toBe(true);
    expect(rows[0].option_ref).toBe(contestantId);
  });

  it('does not double when a webhook and a redirect both credit', async () => {
    const ref = `ZZTRG-${Date.now()}-RACE`;
    const id = await credit(ref);
    await db().from('vote_transactions').update({ vote_credit_status: 'credited' }).eq('id', id);
    await db().from('vote_transactions').update({ vote_credit_status: 'credited' }).eq('id', id);
    expect(await mirrorRows(ref)).toHaveLength(1);
  });

  it('stops counting reversed votes — money back, tally back', async () => {
    const ref = `ZZTRG-${Date.now()}-REVERSE`;
    const id = await credit(ref);
    await db().from('vote_transactions').update({ vote_credit_status: 'credited' }).eq('id', id);
    expect(await mirrorRows(ref)).toHaveLength(1);

    await db().from('vote_transactions').update({ vote_credit_status: 'reversed' }).eq('id', id);
    // Before this, a refunded purchase kept its votes on the mobile roster
    // permanently, because connect_votes has no reversal concept.
    expect(await mirrorRows(ref)).toHaveLength(0);
  });

  it('refuses a contestant not on the contest and records why', async () => {
    const ref = `ZZTRG-${Date.now()}-STRANGER`;
    const { data: stranger } = await db().from('contestants')
      .insert({ name: 'ZZ Stranger', connect_contest_id: null, status: 'approved', is_active: true })
      .select('id').single();
    const strangerId = (stranger as { id: string }).id;

    const id = await credit(ref, { contestantId: strangerId });
    await db().from('vote_transactions').update({ vote_credit_status: 'credited' }).eq('id', id);

    expect(await mirrorRows(ref)).toHaveLength(0);
    // A buyer who paid and cannot be shown their votes must never be invisible.
    const { data: outbox } = await db().from('bridge_outbox')
      .select('last_error').eq('event_type', 'votes.paid.tally_skipped')
      .filter('payload->>paymentReference', 'eq', ref);
    expect((outbox ?? []).map((r) => (r as { last_error: string }).last_error))
      .toContain('contestant_not_in_contest');

    await db().from('contestants').delete().eq('id', strangerId);
  });
});
