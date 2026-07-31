// Atomic free-vote claim for the voting bridge.
//
// This replaces the RACY core of the legacy castFreeVote() (which the bridge
// must not edit) with a single atomic Postgres claim (claim_free_vote), while
// keeping the app-side concerns — settings guards, voter identity, fraud
// scoring, audit — at parity with the legacy path. Fixes:
//   D-001 — the daily bucket (p_vote_date) is computed in the contest timezone.
//   D-002 — the per-contestant cap is row-locked in claim_free_vote (no race).
//   D-003 — vote_totals is upserted atomically + NULL-round-correct in the RPC.
//
// Imports (never edits) the protected service helpers.
import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';
import { FRAUD_SCORE_THRESHOLDS } from '@/src/features/voting/constants';
import type {
  CastFreeVoteRequest,
  CastFreeVoteResponse,
  VotingSettings,
  FraudStatus,
} from '@/src/features/voting/types';
import { getVotingSettings, assertVotingOpen } from '@/src/server/voting/free-vote.service';
import { scoreFreeFraud } from '@/src/server/voting/fraud.service';
import { appendAuditLog } from '@/src/server/voting/audit.service';
import { resolveVoteDate, nextLocalMidnightIso } from './vote-window';

// Binding per-contestant daily cap. Mirrors the legacy service: an explicit
// per-contestant setting wins, else the per-day default (table default 3).
function resolvePerContestantCap(s: VotingSettings): number {
  return s.freeVotesPerContestant ?? s.freeVotesPerDay ?? 3;
}

// Resolve the daily-limit identifier from the contest's configured scope.
// Mirrors free-vote.service.resolveVoterIdentifier (which is module-private).
function resolveVoterIdentifier(
  scope: VotingSettings['freeVoteLimitScope'],
  opts: { userId?: string; email?: string; phone?: string; deviceFingerprint?: string; ipAddress?: string },
): { identifier: string; type: string } {
  switch (scope) {
    case 'user':
      if (!opts.userId) throw new ApiError('Login required to vote', 401);
      return { identifier: opts.userId, type: 'user' };
    case 'email':
      if (!opts.email) throw new ApiError('Email required to vote', 400);
      return { identifier: opts.email.toLowerCase(), type: 'email' };
    case 'phone':
      if (!opts.phone) throw new ApiError('Phone number required to vote', 400);
      return { identifier: opts.phone, type: 'phone' };
    case 'device':
      if (!opts.deviceFingerprint) throw new ApiError('Device fingerprint required', 400);
      return { identifier: opts.deviceFingerprint, type: 'device' };
    case 'ip':
      if (!opts.ipAddress) throw new ApiError('IP address required', 400);
      return { identifier: opts.ipAddress, type: 'ip' };
    default:
      throw new ApiError('Invalid vote limit scope', 500);
  }
}

export async function castFreeVoteAtomic(
  req: CastFreeVoteRequest,
  ipAddress: string,
  deviceFingerprint: string,
  userAgent: string,
  userId?: string,
  now: Date = new Date(),
): Promise<CastFreeVoteResponse> {
  const settings = await getVotingSettings(req.contestId);

  assertVotingOpen(settings);
  if (!settings.freeVotingEnabled) throw new ApiError('Free voting is not enabled', 400);
  if (settings.requireLoginForFreeVote && !userId) {
    throw new ApiError('You must be logged in to vote', 401);
  }

  const identifierText = req.voterIdentifier;
  const { identifier, type } = resolveVoterIdentifier(settings.freeVoteLimitScope, {
    userId,
    email: identifierText?.includes('@') ? identifierText : undefined,
    phone: identifierText && !identifierText.includes('@') ? identifierText : undefined,
    deviceFingerprint,
    ipAddress,
  });

  const voteQuantity = Math.max(1, req.voteQuantity ?? 1);
  const cap = resolvePerContestantCap(settings);

  // D-001: timezone-correct day bucket + reset boundary.
  const voteDate = resolveVoteDate(now, settings.timezone);
  const resetAt = nextLocalMidnightIso(now, settings.timezone);

  // Fraud scoring stays app-side (parity with legacy).
  const fraudScore = await scoreFreeFraud({
    contestId: req.contestId,
    contestantId: req.contestantId,
    ipAddress,
    deviceFingerprint,
    userId,
    settings,
  });

  let fraudStatus: FraudStatus = 'clean';
  if (fraudScore >= FRAUD_SCORE_THRESHOLDS.QUARANTINE) fraudStatus = 'quarantined';
  else if (fraudScore >= FRAUD_SCORE_THRESHOLDS.FLAGGED) fraudStatus = 'flagged';
  else if (fraudScore >= FRAUD_SCORE_THRESHOLDS.SUSPICIOUS) fraudStatus = 'suspicious';

  const voteStatus =
    fraudStatus === 'quarantined'
      ? 'quarantined'
      : fraudStatus === 'flagged' && settings.enableVoteQuarantine
        ? 'quarantined'
        : 'confirmed';

  // D-002/D-003: single atomic claim (row-locked cap + append vote + totals upsert).
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('claim_free_vote', {
    p_contest_id: req.contestId,
    p_contestant_id: req.contestantId,
    p_voter: identifier,
    p_voter_type: type,
    p_vote_date: voteDate,
    p_cap: cap,
    p_qty: voteQuantity,
    p_round_id: null,
    p_vote_status: voteStatus,
    p_fraud_score: fraudScore,
    p_fraud_status: fraudStatus,
    p_ip: ipAddress,
    p_device: deviceFingerprint,
    p_user_agent: userAgent,
    p_share_code: req.shareCode ?? null,
    p_voter_user_id: userId ?? null,
    p_source: 'web',
  });

  if (error) throw new ApiError('Failed to record vote', 500);

  const row = (Array.isArray(data) ? data[0] : data) as
    | { granted: number; total_used: number; cap: number; vote_id: string | null; vote_status: string | null }
    | undefined;
  const granted = Number(row?.granted ?? 0);
  const totalUsed = Number(row?.total_used ?? cap);

  if (granted === 0) {
    throw new ApiError(
      `You have used all ${cap} free votes for this contestant today. Free votes reset at the next daily reset — buy votes to keep supporting them.`,
      429,
    );
  }

  await appendAuditLog({
    actorId: userId ?? 'anonymous',
    actorRole: 'voter',
    action: 'free_vote_cast',
    entityType: 'vote',
    entityId: row?.vote_id ?? 'unknown',
    contestId: req.contestId,
    contestantId: req.contestantId,
    newValue: { voteQuantity: granted, fraudStatus, voteStatus, path: 'bridge_v2' },
    ipAddress,
    userAgent,
  });

  return {
    success: true,
    votesAdded: granted,
    totalFreeVotesUsed: totalUsed,
    freeVotesRemaining: Math.max(0, cap - totalUsed),
    newTotalVotes: 0, // caller can fetch from totals
    fraudStatus,
    resetAt,
    contestantId: req.contestantId,
  };
}
