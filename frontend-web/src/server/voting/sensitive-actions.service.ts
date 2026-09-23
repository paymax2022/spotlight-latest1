/**
 * UAT Batch 8 (SEC-005/G-MC) — executable core of the three Contest admin
 * actions that now require dual control (maker-checker):
 *
 *   - executeVoteReversal    (was: votes/[voteId]/reverse/route.ts)
 *   - executeVoteAdjustment  (was: [contestId]/adjust/route.ts)
 *   - executeResultsPublish  (was: rounds/[roundId]/publish-results/route.ts)
 *
 * These are the exact bodies of the three original route handlers, extracted
 * so `contest-approvals.service.ts#approveApproval` can invoke them at
 * approve-time instead of at propose-time. Behavior is preserved exactly:
 * the only change is that error conditions (404/400/409) are now thrown as
 * `ApiError` rather than returned directly as `errorResponse(...)`, since
 * these are no longer top-level route handlers — the caller (the approve
 * route, via contest-approvals.service.ts) catches and translates.
 *
 * `identity` here is the ACTOR who triggers execution — at approve-time this
 * is the checker (the second approver), not the original initiator. The
 * initiator's reason/params travel in the approval row's payload; the
 * checker's identity is what gets recorded on the resulting audit log entry
 * and vote/round mutation, matching ADR-005's stamp-the-checker convention.
 */
import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';
import { incrementVoteTotals, recomputeRanks, getVoteTotals } from '@/src/server/voting/totals.service';
import { appendAuditLog } from '@/src/server/voting/audit.service';
import { reverseWalletDebit } from '@/src/server/wallet/service';
import { bridgedRecomputeRanksForResults } from '@/src/server/voting-bridge/leaderboard-ranks';
import { TIE_BREAK_RULE } from '@/app/api/admin/voting/rounds/[roundId]/_shared';
import type { AdminAdjustmentType } from '@/src/features/voting/types';

export interface ExecutionIdentity {
  actorId: string;
  role: string;
}

// ---------------------------------------------------------------------------
// executeVoteReversal — was votes/[voteId]/reverse/route.ts
// ---------------------------------------------------------------------------

export interface VoteReversalResult {
  voteId: string;
  reversedQuantity: number;
  walletRefund: { refunded: boolean; amountKobo: number; alreadyRefunded: boolean };
}

export async function executeVoteReversal(
  voteId: string,
  reason: string,
  identity: ExecutionIdentity,
): Promise<VoteReversalResult> {
  const supabase = createAdminClient();

  // Fetch the vote
  const { data: vote, error: voteErr } = await supabase
    .from('votes')
    .select('*')
    .eq('id', voteId)
    .maybeSingle();

  if (voteErr || !vote) throw new ApiError('Vote not found', 404);
  if ((vote as any).vote_status === 'reversed') {
    throw new ApiError('Vote is already reversed', 400);
  }

  const v = vote as any;

  // ---------------------------------------------------------------------
  // Wallet refund (P0): if the original vote was funded from the in-app
  // wallet, post a REVERSING ledger entry crediting the user the original
  // amount. The payment_provider lives on vote_transactions (not on votes),
  // so resolve the linked transaction via votes.transaction_id.
  //
  // Idempotency is guaranteed at the ledger level: reverseWalletDebit keys
  // off a deterministic idempotency_key derived from the transaction id, and
  // the ledger_entries.idempotency_key UNIQUE constraint makes a re-run a
  // no-op (returns alreadyProcessed). Combined with the vote_status guard
  // above (a 'reversed' vote throws before reaching here), the refund can
  // never be posted twice.
  // ---------------------------------------------------------------------
  let walletRefund: { refunded: boolean; amountKobo: number; alreadyRefunded: boolean } = {
    refunded: false,
    amountKobo: 0,
    alreadyRefunded: false,
  };

  if (v.transaction_id) {
    const { data: tx } = await supabase
      .from('vote_transactions')
      .select('id, payment_provider, payment_reference, amount_paid, voter_user_id')
      .eq('id', v.transaction_id)
      .maybeSingle();

    const t = tx as any;
    // Only refund wallet-funded purchases. Paystack-funded purchases are
    // refunded out-of-band via Paystack (not this ledger), and bridge/Go
    // wallet votes (payment_provider !== 'wallet') hold their balance in the
    // Go ledger and must be reversed there — never fabricate a credit here.
    if (
      t &&
      t.payment_provider === 'wallet' &&
      t.voter_user_id &&
      t.amount_paid != null &&
      Number(t.amount_paid) > 0
    ) {
      const amountKobo = Math.round(Number(t.amount_paid) * 100);
      const refundRef = String(t.payment_reference ?? t.id);
      const refundResult = await reverseWalletDebit(t.voter_user_id as string, {
        amountKobo,
        reference: refundRef,
        // Deterministic, transaction-scoped key — re-running the reversal
        // hits the UNIQUE constraint and is treated as alreadyProcessed.
        idempotencyKey: `vote-reversal-refund:${t.id}`,
        description: `Refund: reversed vote ${voteId}`,
        metadata: {
          type: 'vote_reversal_refund',
          voteId,
          transactionId: t.id,
          contestId: v.contest_id,
          contestantId: v.contestant_id,
        },
      });
      walletRefund = {
        refunded: !refundResult.alreadyProcessed,
        amountKobo,
        alreadyRefunded: refundResult.alreadyProcessed,
      };
    }
  }

  // Mark vote reversed
  await supabase
    .from('votes')
    .update({
      vote_status: 'reversed',
      reversal_reason: reason,
      reversed_at: new Date().toISOString(),
    })
    .eq('id', voteId);

  // Mark the linked transaction refunded (idempotent — already-refunded
  // transactions just re-set the same status).
  //
  // This used to be gated on walletRefund.amountKobo > 0, which is only ever
  // true for payment_provider='wallet'. A card-funded reversal therefore left
  // vote_credit_status = 'credited', with two consequences: the connect tally
  // trigger never removed the mirrored votes, so a refunded purchase kept its
  // votes on the mobile roster permanently; and repair-connect-tally.sh, which
  // selects on 'credited', would re-create a mirror row an operator had
  // removed by hand. The status describes the vote, not the funding rail.
  if (v.transaction_id) {
    await supabase
      .from('vote_transactions')
      .update({ payment_status: 'refunded', vote_credit_status: 'reversed', updated_at: new Date().toISOString() })
      .eq('id', v.transaction_id);
  }

  // Update totals
  const quantity = Math.abs(Number(v.vote_quantity));
  await incrementVoteTotals(v.contest_id, v.contestant_id, {
    reversedVotes: quantity,
  });

  // VI-008: an invalidated vote must be reflected in the leaderboard
  // immediately — otherwise the fraud-review "invalidation" is audited but
  // the public/admin leaderboard keeps showing the stale rank until the
  // next unrelated recompute. Best-effort: never fail the reversal itself
  // (which already succeeded and is audited below) if rank recompute errors.
  try {
    await recomputeRanks(v.contest_id);
  } catch {
    // non-fatal — ranks will self-correct on the next vote/recompute
  }

  await appendAuditLog({
    actorId: identity.actorId,
    actorRole: identity.role,
    action: 'vote_reversed',
    entityType: 'vote',
    entityId: voteId,
    contestId: v.contest_id,
    contestantId: v.contestant_id,
    oldValue: { vote_status: v.vote_status, vote_quantity: v.vote_quantity },
    newValue: {
      vote_status: 'reversed',
      reversal_reason: reason,
      walletRefundKobo: walletRefund.amountKobo,
      walletRefunded: walletRefund.refunded,
      walletAlreadyRefunded: walletRefund.alreadyRefunded,
    },
    reason,
  });

  return {
    voteId,
    reversedQuantity: quantity,
    walletRefund,
  };
}

// ---------------------------------------------------------------------------
// executeVoteAdjustment — was [contestId]/adjust/route.ts
// ---------------------------------------------------------------------------

export interface VoteAdjustmentParams {
  contestId: string;
  contestantId: string;
  adjustmentType: AdminAdjustmentType;
  voteQuantity: number;
  reason: string;
}

export interface VoteAdjustmentResult {
  beforeTotal: number;
  afterTotal: number;
  adjustment: number;
}

export async function executeVoteAdjustment(
  params: VoteAdjustmentParams,
  identity: ExecutionIdentity,
): Promise<VoteAdjustmentResult> {
  const { contestId, contestantId, adjustmentType, voteQuantity, reason } = params;
  const supabase = createAdminClient();

  // Fetch current totals
  const currentTotals = await getVoteTotals(contestId, contestantId);
  const beforeTotal = currentTotals?.totalConfirmedVotes ?? 0;

  // Apply the adjustment
  let delta: { adminAdjustmentVotes?: number; reversedVotes?: number } = {};
  let voteRecord: Record<string, unknown> = {};

  if (adjustmentType === 'add') {
    delta = { adminAdjustmentVotes: voteQuantity };
    voteRecord = {
      contest_id: contestId,
      contestant_id: contestantId,
      vote_type: 'admin_adjustment',
      vote_quantity: voteQuantity,
      vote_status: 'confirmed',
      fraud_score: 0,
      fraud_status: 'clean',
      confirmed_at: new Date().toISOString(),
    };
  } else if (adjustmentType === 'subtract' || adjustmentType === 'reverse') {
    delta = { reversedVotes: voteQuantity };
    voteRecord = {
      contest_id: contestId,
      contestant_id: contestantId,
      vote_type: 'fraud_reversal',
      vote_quantity: -voteQuantity,
      vote_status: 'reversed',
      reversal_reason: reason,
      reversed_at: new Date().toISOString(),
      fraud_score: 0,
      fraud_status: 'clean',
    };
  }

  await incrementVoteTotals(contestId, contestantId, delta);

  if (Object.keys(voteRecord).length > 0) {
    await supabase.from('votes').insert(voteRecord);
  }

  const afterTotals = await getVoteTotals(contestId, contestantId);
  const afterTotal = afterTotals?.totalConfirmedVotes ?? 0;

  // Record the adjustment with full audit trail
  await supabase.from('admin_vote_adjustments').insert({
    contest_id: contestId,
    contestant_id: contestantId,
    admin_id: identity.actorId,
    adjustment_type: adjustmentType,
    vote_quantity: voteQuantity,
    reason,
    before_total: beforeTotal,
    after_total: afterTotal,
    status: 'applied',
    applied_at: new Date().toISOString(),
  });

  await appendAuditLog({
    actorId: identity.actorId,
    actorRole: identity.role,
    action: 'admin_vote_adjustment',
    entityType: 'vote_totals',
    entityId: contestantId,
    contestId,
    contestantId,
    oldValue: { totalConfirmedVotes: beforeTotal },
    newValue: { totalConfirmedVotes: afterTotal, adjustmentType, voteQuantity },
    reason,
  });

  return { beforeTotal, afterTotal, adjustment: voteQuantity };
}

// ---------------------------------------------------------------------------
// executeResultsPublish — was rounds/[roundId]/publish-results/route.ts
// ---------------------------------------------------------------------------

export interface ResultsPublishResultEntry {
  contestantId: string;
  contestantName: string | null;
  rank: number;
  totalConfirmedVotes: number;
  paidVotes: number;
  prizeId: string | null;
  prizeDescription: string | null;
}

export interface ResultsPublishResult {
  results: ResultsPublishResultEntry[];
  tieBreakRule: string;
}

// AD-011/VI-010: compute -> publish -> lock, in one action, with the correct
// (bridge-owned) tie-break and immutability enforced server-side.
//
// voting_rounds.contest_id is a FK to the LEGACY public.contests table, not
// connect_contests (see 20260602100000_universal_voting_engine.sql:383-411).
// contest_prizes keys off connect_contests, per the same convention as
// contest_templates.connect_contest_id (20270212000000). The two tables share
// the same row id for any contest reachable here — legacy->connect and
// connect->legacy both preserve `id` when mirroring
// (20261223000000_connect_contests_bridge.sql, 20270129000000_mirror_connect_contests_to_legacy.sql)
// — so round.contest_id is used directly as connect_contest_id below; no
// separate resolver step is needed (see 20270213000000 migration header for
// the full note).
//
// Insert-results + status-flip are done together via the
// publish_voting_round_results() Postgres function (added in that same
// migration) so they cannot partially succeed across two separate Supabase
// calls. Its already-published guard also protects against the race where
// the round is published by another path between this function's own
// pre-check (done in the propose route, before an approval is even created)
// and this execution running later at approve-time.
export async function executeResultsPublish(
  roundId: string,
  identity: ExecutionIdentity,
): Promise<ResultsPublishResult> {
  const supabase = createAdminClient();

  const { data: round, error: roundError } = await supabase
    .from('voting_rounds')
    .select('id, contest_id, status, name')
    .eq('id', roundId)
    .maybeSingle();

  if (roundError) throw new ApiError(`Failed to load round: ${roundError.message}`, 500);
  if (!round) throw new ApiError('Voting round not found', 404);

  if ((round as any).status === 'results_published') {
    throw new ApiError(
      'Results already published and locked for this round — publishing is a one-time, immutable action.',
      409,
    );
  }

  const contestId = (round as any).contest_id as string;

  const ranks = await bridgedRecomputeRanksForResults(contestId, roundId);
  if (ranks.length === 0) {
    throw new ApiError('No leaderboard data to publish for this round', 400);
  }

  // contest_prizes keys off connect_contest_id, which shares round.contest_id's
  // value here — see the module header note above.
  const { data: prizeRows, error: prizesError } = await supabase
    .from('voting_contest_prizes')
    .select('id, position')
    .eq('connect_contest_id', contestId);

  if (prizesError) throw new ApiError(`Failed to load contest prizes: ${prizesError.message}`, 500);

  const prizeByPosition = new Map<number, string>();
  for (const row of prizeRows ?? []) {
    prizeByPosition.set((row as any).position, (row as any).id);
  }

  const resultsPayload = ranks.map((entry) => ({
    contestant_id: entry.contestantId,
    rank: entry.rank,
    total_confirmed_votes: entry.totalConfirmedVotes,
    paid_votes: entry.paidVotes,
    prize_id: prizeByPosition.get(entry.rank) ?? null,
  }));

  const { data: insertedRows, error: publishError } = await supabase.rpc('publish_voting_round_results', {
    p_round_id: roundId,
    p_results: resultsPayload,
    p_published_by: identity.actorId || null,
  });

  if (publishError) {
    if ((publishError as any).message?.includes('voting_round_already_published')) {
      throw new ApiError(
        'Results already published and locked for this round — publishing is a one-time, immutable action.',
        409,
      );
    }
    if ((publishError as any).message?.includes('voting_round_not_found')) {
      throw new ApiError('Voting round not found', 404);
    }
    throw new ApiError(`Failed to publish results: ${(publishError as any).message}`, 500);
  }

  const resultRows = (insertedRows ?? []) as any[];
  const prizeIdToDescription = new Map<string, string>();
  if (prizeRows && prizeRows.length > 0) {
    const { data: fullPrizeRows } = await supabase
      .from('voting_contest_prizes')
      .select('id, prize_description')
      .eq('connect_contest_id', contestId);
    for (const row of fullPrizeRows ?? []) {
      prizeIdToDescription.set((row as any).id, (row as any).prize_description);
    }
  }

  const contestantIds = Array.from(new Set(resultRows.map((r) => r.contestant_id).filter(Boolean)));
  const contestantIdToName = new Map<string, string>();
  if (contestantIds.length > 0) {
    const { data: contestantRows } = await supabase
      .from('contestants')
      .select('id, name')
      .in('id', contestantIds);
    for (const row of contestantRows ?? []) {
      contestantIdToName.set((row as any).id, (row as any).name);
    }
  }

  const results = resultRows
    .map((row) => ({
      contestantId: row.contestant_id,
      contestantName: contestantIdToName.get(row.contestant_id) ?? null,
      rank: row.rank,
      totalConfirmedVotes: Number(row.total_confirmed_votes),
      paidVotes: Number(row.paid_votes),
      prizeId: row.prize_id ?? null,
      prizeDescription: row.prize_id ? prizeIdToDescription.get(row.prize_id) ?? null : null,
    }))
    .sort((a, b) => a.rank - b.rank);

  await appendAuditLog({
    actorId: identity.actorId,
    actorRole: identity.role,
    action: 'voting_round_results_locked',
    entityType: 'voting_round',
    entityId: roundId,
    contestId,
    newValue: {
      contestantCount: results.length,
      topContestantId: results[0]?.contestantId ?? null,
      tieBreakRule: TIE_BREAK_RULE,
    },
  });

  return {
    results,
    tieBreakRule: TIE_BREAK_RULE,
  };
}
