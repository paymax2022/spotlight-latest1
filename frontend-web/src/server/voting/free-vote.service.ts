import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';
import { VOTING_DEFAULTS, FRAUD_SCORE_THRESHOLDS } from '@/src/features/voting/constants';
import type {
  CastFreeVoteRequest,
  CastFreeVoteResponse,
  RemainingFreeVotesResponse,
  VotingSettings,
  FraudStatus,
} from '@/src/features/voting/types';
import { scoreFreeFraud } from './fraud.service';
import { appendAuditLog } from './audit.service';
import { incrementVoteTotals } from './totals.service';

// Resolve the voter's daily-limit identifier based on the contest's configured scope.
function resolveVoterIdentifier(
  scope: VotingSettings['freeVoteLimitScope'],
  opts: {
    userId?: string;
    email?: string;
    phone?: string;
    deviceFingerprint?: string;
    ipAddress?: string;
    sessionId?: string;
  },
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
    case 'session':
      if (!opts.sessionId) throw new ApiError('Session required', 400);
      return { identifier: opts.sessionId, type: 'session' };
    default:
      throw new ApiError('Invalid vote limit scope', 500);
  }
}

function getVoteDateUTC(): string {
  return new Date().toISOString().split('T')[0];
}

export async function getVotingSettings(contestId: string): Promise<VotingSettings> {
  const supabase = createAdminClient();
  // Fetched WITHOUT the status filter so the two very different causes can be
  // told apart. Filtering in the query collapsed both into "Voting is not
  // enabled for this contest", which is actively misleading: an admin who has
  // ticked Enable Voting AND Enable Paid Voting reads it as a contradiction and
  // has no way to discover that the settings row is merely still in draft.
  const { data, error } = await supabase
    .from('voting_settings')
    .select('*')
    .eq('contest_id', contestId)
    .maybeSingle();

  if (error) throw new ApiError('Failed to load voting settings', 500);

  if (!data) {
    throw new ApiError('Voting has not been set up for this contest yet.', 400);
  }

  const status = (data as { status?: string }).status;
  if (status !== 'active') {
    throw new ApiError(
      `Voting for this contest is still ${status ?? 'inactive'}. ` +
        'Set its status to active in the voting settings to open it.',
      400,
    );
  }

  return mapSettingsRow(data);
}

// The per-contestant daily free-vote cap. Each voter gets this many free votes
// for EACH contestant per day. Falls back to the legacy per-day value so the
// default behaviour (e.g. 3 per contestant) works without extra config.
export function perContestantCap(settings: VotingSettings): number {
  return settings.freeVotesPerContestant ?? settings.freeVotesPerDay;
}

export async function getRemainingFreeVotes(
  contestId: string,
  voterOpts: {
    userId?: string;
    email?: string;
    phone?: string;
    deviceFingerprint?: string;
    ipAddress?: string;
  },
  contestantId?: string,
): Promise<RemainingFreeVotesResponse> {
  const settings = await getVotingSettings(contestId);
  if (!settings.freeVotingEnabled) {
    return {
      contestId,
      contestantId,
      freeVotesPerDay: 0,
      freeVotesUsed: 0,
      freeVotesRemaining: 0,
      resetAt: nextResetAt(settings.freeVoteResetTime, settings.timezone),
      nextResetHours: 0,
    };
  }

  const { identifier, type } = resolveVoterIdentifier(settings.freeVoteLimitScope, voterOpts);
  const voteDate = getVoteDateUTC();
  const supabase = createAdminClient();
  const resetAt = nextResetAt(settings.freeVoteResetTime, settings.timezone);

  // Per-contestant remaining: how many free votes the voter has left for THIS
  // contestant today. This is the cap the user watches reset.
  if (contestantId) {
    const cap = perContestantCap(settings);
    const { data } = await supabase
      .from('voter_contestant_daily_limits')
      .select('free_votes_used, free_votes_limit')
      .eq('contest_id', contestId)
      .eq('contestant_id', contestantId)
      .eq('voter_identifier', identifier)
      .eq('voter_identifier_type', type)
      .eq('vote_date', voteDate)
      .maybeSingle();

    const used = data?.free_votes_used ?? 0;
    const limit = data?.free_votes_limit ?? cap;
    return {
      contestId,
      contestantId,
      freeVotesPerDay: limit,
      freeVotesUsed: used,
      freeVotesRemaining: Math.max(0, limit - used),
      resetAt,
      nextResetHours: hoursUntil(resetAt),
    };
  }

  // Contest-wide tally (no contestant scope requested).
  const { data } = await supabase
    .from('voter_daily_limits')
    .select('free_votes_used, free_votes_limit')
    .eq('contest_id', contestId)
    .eq('voter_identifier', identifier)
    .eq('voter_identifier_type', type)
    .eq('vote_date', voteDate)
    .maybeSingle();

  const used = data?.free_votes_used ?? 0;
  const limit = data?.free_votes_limit ?? settings.freeVotesPerDay;
  const remaining = Math.max(0, limit - used);

  return {
    contestId,
    freeVotesPerDay: limit,
    freeVotesUsed: used,
    freeVotesRemaining: remaining,
    resetAt,
    nextResetHours: hoursUntil(resetAt),
  };
}

export async function castFreeVote(
  req: CastFreeVoteRequest,
  ipAddress: string,
  deviceFingerprint: string,
  userAgent: string,
  userId?: string,
): Promise<CastFreeVoteResponse> {
  const supabase = createAdminClient();
  const settings = await getVotingSettings(req.contestId);

  // --- Guard: voting must be open ---
  assertVotingOpen(settings);
  if (!settings.freeVotingEnabled) throw new ApiError('Free voting is not enabled', 400);

  // --- Guard: require login if configured ---
  if (settings.requireLoginForFreeVote && !userId) {
    throw new ApiError('You must be logged in to vote', 401);
  }

  const voteQuantity = Math.max(1, req.voteQuantity ?? 1);

  // --- Resolve voter identity ---
  const { identifier, type } = resolveVoterIdentifier(settings.freeVoteLimitScope, {
    userId,
    email: req.voterIdentifier?.includes('@') ? req.voterIdentifier : undefined,
    phone: req.voterIdentifier && !req.voterIdentifier.includes('@') ? req.voterIdentifier : undefined,
    deviceFingerprint,
    ipAddress,
  });

  const voteDate = getVoteDateUTC();

  const resetAt = nextResetAt(settings.freeVoteResetTime, settings.timezone);

  // --- Per-contestant daily limit (the BINDING cap) ---
  // Each voter gets `perContestantCap` free votes for THIS contestant per day.
  // Once reached, free voting for this contestant is disabled until reset.
  const cap = perContestantCap(settings);
  const { data: cRow, error: cErr } = await supabase
    .from('voter_contestant_daily_limits')
    .upsert(
      {
        contest_id: req.contestId,
        contestant_id: req.contestantId,
        voter_identifier: identifier,
        voter_identifier_type: type,
        vote_date: voteDate,
        free_votes_limit: cap,
      },
      { onConflict: 'contest_id,contestant_id,voter_identifier,voter_identifier_type,vote_date' },
    )
    .select('free_votes_used, free_votes_limit')
    .single();

  if (cErr || !cRow) throw new ApiError('Failed to check vote limit', 500);

  const cUsed = cRow.free_votes_used as number;
  const cLimit = cRow.free_votes_limit as number;

  if (cUsed >= cLimit) {
    throw new ApiError(
      `You have used all ${cLimit} free votes for this contestant today. Free votes reset in 24h — buy votes to keep supporting them.`,
      429,
    );
  }

  // --- Contest-wide tally (only blocks when an explicit per-contest cap is set) ---
  const { data: limitRow, error: limitErr } = await supabase
    .from('voter_daily_limits')
    .upsert(
      {
        contest_id: req.contestId,
        voter_identifier: identifier,
        voter_identifier_type: type,
        vote_date: voteDate,
        free_votes_limit: settings.freeVotesPerContest ?? settings.freeVotesPerDay,
      },
      { onConflict: 'contest_id,voter_identifier,voter_identifier_type,vote_date' },
    )
    .select('free_votes_used, free_votes_limit')
    .single();

  if (limitErr || !limitRow) throw new ApiError('Failed to check vote limit', 500);

  const used = limitRow.free_votes_used as number;
  if (settings.freeVotesPerContest != null && used >= settings.freeVotesPerContest) {
    throw new ApiError(
      `You have used all your free votes for this contest today. Free votes reset in 24h.`,
      429,
    );
  }

  // Bound by the per-contestant remaining (the binding cap).
  let canAdd = Math.min(voteQuantity, cLimit - cUsed);

  // --- Global daily cap check (admin-set ceiling across all voters) ---
  if (settings.dailyFreeVoteCapEnabled && settings.dailyFreeVoteCap !== null) {
    const { data: capRows, error: capErr } = await supabase.rpc('try_claim_global_free_votes', {
      p_contest_id: req.contestId,
      p_vote_date: voteDate,
      p_quantity: canAdd,
      p_cap: settings.dailyFreeVoteCap,
    });

    if (capErr) throw new ApiError('Failed to check global vote cap', 500);

    const cap = (capRows as { allowed: boolean; votes_claimed: number; cap_remaining: number }[])?.[0];
    if (!cap?.allowed) {
      throw new ApiError(
        "Today's free votes for this contest have all been used. Come back tomorrow!",
        429,
      );
    }
    // Cap may grant fewer than requested if we're near the ceiling
    canAdd = cap.votes_claimed;
  }

  // --- Fraud check ---
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

  const voteStatusResolved =
    fraudStatus === 'quarantined'
      ? 'quarantined'
      : fraudStatus === 'flagged' && settings.enableVoteQuarantine
        ? 'quarantined'
        : 'confirmed';

  // --- Insert vote record ---
  const { data: voteRow, error: voteErr } = await supabase
    .from('votes')
    .insert({
      contest_id: req.contestId,
      contestant_id: req.contestantId,
      voter_user_id: userId ?? null,
      vote_type: 'free',
      vote_quantity: canAdd,
      vote_status: voteStatusResolved,
      ip_address: ipAddress,
      device_fingerprint: deviceFingerprint,
      user_agent: userAgent,
      source: 'web',
      share_code: req.shareCode ?? null,
      fraud_score: fraudScore,
      fraud_status: fraudStatus,
      confirmed_at: voteStatusResolved === 'confirmed' ? new Date().toISOString() : null,
    })
    .select('id')
    .single();

  if (voteErr || !voteRow) throw new ApiError('Failed to record vote', 500);

  // --- Increment per-contestant counter (binding cap) ---
  await supabase
    .from('voter_contestant_daily_limits')
    .update({
      free_votes_used: cUsed + canAdd,
      last_vote_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('contest_id', req.contestId)
    .eq('contestant_id', req.contestantId)
    .eq('voter_identifier', identifier)
    .eq('voter_identifier_type', type)
    .eq('vote_date', voteDate);

  // --- Increment contest-wide tally ---
  await supabase
    .from('voter_daily_limits')
    .update({
      free_votes_used: used + canAdd,
      last_vote_at: new Date().toISOString(),
    })
    .eq('contest_id', req.contestId)
    .eq('voter_identifier', identifier)
    .eq('voter_identifier_type', type)
    .eq('vote_date', voteDate);

  // --- Update totals (only if confirmed) ---
  if (voteStatusResolved === 'confirmed') {
    await incrementVoteTotals(req.contestId, req.contestantId, { freeVotes: canAdd });
  }

  await appendAuditLog({
    actorId: userId ?? 'anonymous',
    actorRole: 'voter',
    action: 'free_vote_cast',
    entityType: 'vote',
    entityId: voteRow.id,
    contestId: req.contestId,
    contestantId: req.contestantId,
    newValue: { voteQuantity: canAdd, fraudStatus, voteStatus: voteStatusResolved },
    ipAddress,
    userAgent,
  });

  return {
    success: true,
    votesAdded: canAdd,
    totalFreeVotesUsed: cUsed + canAdd,
    // Remaining for THIS contestant today (the cap the user watches reset).
    freeVotesRemaining: Math.max(0, cLimit - cUsed - canAdd),
    newTotalVotes: 0, // caller can fetch from totals
    fraudStatus,
    resetAt,
    contestantId: req.contestantId,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function assertVotingOpen(settings: VotingSettings) {
  if (!settings.votingEnabled) throw new ApiError('Voting is not open for this contest', 400);
  const now = Date.now();
  if (settings.votingStartsAt && now < Date.parse(settings.votingStartsAt)) {
    throw new ApiError('Voting has not started yet', 400);
  }
  if (settings.votingEndsAt && now > Date.parse(settings.votingEndsAt)) {
    throw new ApiError('Voting has closed', 400);
  }
}

function nextResetAt(resetTime: string, _timezone: string): string {
  const [hh, mm] = resetTime.split(':').map(Number);
  const now = new Date();
  const reset = new Date();
  reset.setUTCHours(hh, mm, 0, 0);
  if (reset <= now) reset.setUTCDate(reset.getUTCDate() + 1);
  return reset.toISOString();
}

function hoursUntil(isoString: string): number {
  return Math.max(0, Math.floor((Date.parse(isoString) - Date.now()) / 3_600_000));
}

function mapSettingsRow(row: Record<string, unknown>): VotingSettings {
  return {
    id: row.id as string,
    contestId: row.contest_id as string,
    votingEnabled: Boolean(row.voting_enabled),
    votingType: (row.voting_type as string) as VotingSettings['votingType'],
    freeVotingEnabled: Boolean(row.free_voting_enabled),
    freeVotesPerDay: Number(row.free_votes_per_day ?? VOTING_DEFAULTS.FREE_VOTES_PER_DAY),
    freeVotesPerContest: row.free_votes_per_contest != null ? Number(row.free_votes_per_contest) : null,
    freeVotesPerContestant: row.free_votes_per_contestant != null ? Number(row.free_votes_per_contestant) : null,
    freeVoteResetTime: (row.free_vote_reset_time as string) ?? VOTING_DEFAULTS.FREE_VOTE_RESET_TIME,
    freeVoteLimitScope: (row.free_vote_limit_scope as string) as VotingSettings['freeVoteLimitScope'],
    allowAnonymousFreeVote: Boolean(row.allow_anonymous_free_vote),
    requireLoginForFreeVote: Boolean(row.require_login_for_free_vote),
    requirePhoneForFreeVote: Boolean(row.require_phone_for_free_vote),
    requireEmailForFreeVote: Boolean(row.require_email_for_free_vote),
    requireCaptcha: Boolean(row.require_captcha),
    voteCooldownSeconds: Number(row.vote_cooldown_seconds ?? 0),
    maxFailedAttempts: Number(row.max_failed_attempts ?? 10),
    paidVotingEnabled: Boolean(row.paid_voting_enabled),
    currency: (row.currency as string) ?? 'NGN',
    paymentProvider: (row.payment_provider as string) as VotingSettings['paymentProvider'],
    allowCustomVoteQuantity: Boolean(row.allow_custom_vote_quantity),
    minPaidVotes: Number(row.min_paid_votes ?? 1),
    maxPaidVotesPerTxn: Number(row.max_paid_votes_per_txn ?? 10000),
    paymentRefPrefix: (row.payment_ref_prefix as string) ?? 'SPT-VOTE',
    applyPaymentFeesToUser: Boolean(row.apply_payment_fees_to_user),
    refundPolicy: (row.refund_policy as string | null) ?? null,
    showPublicVoteCount: Boolean(row.show_public_vote_count),
    showPublicLeaderboard: Boolean(row.show_public_leaderboard),
    showPublicRank: Boolean(row.show_public_rank),
    allowVoteSharing: Boolean(row.allow_vote_sharing),
    votingStartsAt: (row.voting_starts_at as string | null) ?? null,
    votingEndsAt: (row.voting_ends_at as string | null) ?? null,
    timezone: (row.timezone as string) ?? VOTING_DEFAULTS.TIMEZONE,
    leaderboardFreezeEnabled: Boolean(row.leaderboard_freeze_enabled),
    leaderboardFreezeAt: (row.leaderboard_freeze_at as string | null) ?? null,
    leaderboardScope: (row.leaderboard_scope as string) as VotingSettings['leaderboardScope'],
    leaderboardTieBreaker: (row.leaderboard_tie_breaker as string) as VotingSettings['leaderboardTieBreaker'],
    showTopN: row.show_top_n != null ? Number(row.show_top_n) : null,
    dailyFreeVoteCapEnabled: Boolean(row.daily_free_vote_cap_enabled),
    dailyFreeVoteCap: row.daily_free_vote_cap != null ? Number(row.daily_free_vote_cap) : null,
    fraudDetectionEnabled: Boolean(row.fraud_detection_enabled),
    suspiciousIpLimit: Number(row.suspicious_ip_limit ?? 20),
    botSpeedThresholdMs: Number(row.bot_speed_threshold_ms ?? 500),
    blockDisposableEmails: Boolean(row.block_disposable_emails),
    detectVoteSpikes: Boolean(row.detect_vote_spikes),
    enableVoteQuarantine: Boolean(row.enable_vote_quarantine),
    enableManualAudit: Boolean(row.enable_manual_audit),
    status: (row.status as string) as VotingSettings['status'],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export { mapSettingsRow };
