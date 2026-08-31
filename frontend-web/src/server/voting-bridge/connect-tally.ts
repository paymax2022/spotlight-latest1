/**
 * Bridge: credited paid votes -> the connect tally the app reads.
 *
 * WHY THIS EXISTS
 * There are two live vote engines. The money path writes the UNIVERSAL one
 * (`votes`, `vote_totals`) via incrementVoteTotals(). The mobile roster and
 * leaderboard are served by Go's ListRoster, which sums `connect_votes.quantity`
 * (backend/internal/connect/voting/repo.go:34). Nothing joined them, so a wallet
 * purchase debited NGN 5,000, reported "50 votes credited", and the contestant's
 * displayed count stayed at zero. Money taken, no visible effect.
 *
 * This is a new file on purpose. paid-vote.service.ts and totals.service.ts are
 * brownfield-protected (see .claude/hooks/protect-legacy.sh and the vote-bridge
 * skill): import and call them, never edit. This adds the missing projection
 * beside them rather than changing how either engine works.
 *
 * IDEMPOTENCY
 * connect_votes already carries the primitive: uq_connect_votes_idem, a partial
 * UNIQUE index on idempotency_key. The payment reference is unique per purchase,
 * so keying on it makes a webhook and a browser redirect arriving together
 * collapse to one row instead of doubling somebody's votes. That is why this
 * relies on the database rather than a read-then-write check, which is exactly
 * the TOCTOU the vote-bridge skill documents in verifyAndCreditPaidVote().
 *
 * FAILURE POSTURE
 * The caller has already moved money by the time this runs. A mirror failure
 * must therefore never reverse a completed purchase or turn a successful
 * response into an error — the votes ARE credited in the universal engine. It
 * returns a reason instead, and the caller logs it loudly. Because the write is
 * idempotent, a missed mirror can be replayed safely afterwards
 * (scripts/dev/repair-connect-tally.sh).
 */
import { createAdminClient } from '@/lib/supabase/server';

export interface MirrorPaidVoteArgs {
  contestId: string;
  /** The roster row being voted for. Stored as connect_votes.option_ref. */
  contestantId: string;
  /** Buyer. connect_votes.voter_id is NOT NULL and FKs auth.users. */
  voterUserId: string;
  quantity: number;
  /** Minor units. connect_votes CHECKs paid = true => amount_kobo > 0. */
  amountKobo: number;
  /** Payment reference — the idempotency anchor. */
  reference: string;
}

export type MirrorSkipReason =
  | 'already_recorded'
  | 'contestant_not_in_contest'
  | 'invalid_quantity'
  | 'invalid_amount'
  | 'missing_voter'
  | 'write_failed';

export interface MirrorResult {
  recorded: boolean;
  reason?: MirrorSkipReason;
  /** Present when the write failed, for the caller's log line. */
  error?: string;
}

/** Namespaced so this projection cannot collide with the Go vote path's keys. */
export function connectTallyIdempotencyKey(reference: string): string {
  return `connect-tally:${reference}`;
}

export async function mirrorPaidVoteToConnect(args: MirrorPaidVoteArgs): Promise<MirrorResult> {
  const { contestId, contestantId, voterUserId, quantity, amountKobo, reference } = args;

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { recorded: false, reason: 'invalid_quantity' };
  }
  // paid = true with amount_kobo = 0 violates connect_votes_check. Refusing here
  // gives a named reason instead of a constraint error in a log nobody reads.
  if (!Number.isFinite(amountKobo) || amountKobo <= 0) {
    return { recorded: false, reason: 'invalid_amount' };
  }
  if (!voterUserId) {
    return { recorded: false, reason: 'missing_voter' };
  }

  const supabase = createAdminClient();

  // The contestant must actually be on this contest. Without this a mispassed id
  // would accumulate a phantom tally against a contest it does not belong to —
  // the same guard Go's checkRosterTarget applies on its own vote path.
  const { data: roster, error: rosterError } = await supabase
    .from('contestants')
    .select('id, contest_id, connect_contest_id')
    .eq('id', contestantId)
    .maybeSingle();

  if (rosterError) {
    return { recorded: false, reason: 'write_failed', error: rosterError.message };
  }

  const belongs =
    roster &&
    ((roster as { connect_contest_id: string | null }).connect_contest_id === contestId ||
      (roster as { contest_id: string | null }).contest_id === contestId);

  if (!belongs) {
    return { recorded: false, reason: 'contestant_not_in_contest' };
  }

  const { error } = await supabase.from('connect_votes').insert({
    contest_id: contestId,
    voter_id: voterUserId,
    // option_ref is free-form TEXT; for roster contests it holds the contestant
    // UUID as text, which is what lets ListRoster join the tally.
    option_ref: contestantId,
    paid: true,
    quantity,
    amount_kobo: amountKobo,
    idempotency_key: connectTallyIdempotencyKey(reference),
    ledger_ref: reference,
  });

  if (error) {
    // 23505 on uq_connect_votes_idem: this purchase is already counted. That is
    // a success for the caller's purposes, not a failure.
    if (error.code === '23505') {
      return { recorded: false, reason: 'already_recorded' };
    }
    return { recorded: false, reason: 'write_failed', error: error.message };
  }

  return { recorded: true };
}
