import { createAdminClient } from '@/lib/supabase/server';
import { FRAUD_SCORE_THRESHOLDS } from '@/src/features/voting/constants';
import type { FraudFlagType, FraudSeverity, VotingSettings } from '@/src/features/voting/types';

interface FraudCheckInput {
  contestId: string;
  contestantId: string;
  ipAddress: string;
  deviceFingerprint: string;
  userId?: string;
  email?: string;
  settings: VotingSettings;
}

interface FraudCheckResult {
  score: number;
  flags: { type: FraudFlagType; severity: FraudSeverity; score: number; reason: string }[];
}

// Returns a 0–100 fraud score. Higher = more suspicious.
export async function scoreFreeFraud(input: FraudCheckInput): Promise<number> {
  const { score } = await runFraudChecks(input);
  return score;
}

export async function runFraudChecks(input: FraudCheckInput): Promise<FraudCheckResult> {
  const { contestId, contestantId, ipAddress, deviceFingerprint, userId, email, settings } = input;
  if (!settings.fraudDetectionEnabled) return { score: 0, flags: [] };

  const supabase = createAdminClient();
  const flags: FraudCheckResult['flags'] = [];
  let totalScore = 0;

  // 1. IP volume check — how many votes from this IP in the last hour?
  if (ipAddress) {
    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const { count } = await supabase
      .from('votes')
      .select('id', { count: 'exact', head: true })
      .eq('contest_id', contestId)
      .eq('ip_address', ipAddress)
      .gte('created_at', oneHourAgo);

    const ipCount = count ?? 0;
    if (ipCount > settings.suspiciousIpLimit) {
      const score = Math.min(40, Math.floor((ipCount / settings.suspiciousIpLimit) * 20));
      flags.push({ type: 'duplicate_ip', severity: 'high', score, reason: `${ipCount} votes from IP in 1h` });
      totalScore += score;
    }
  }

  // 2. Device fingerprint check — multiple accounts on same device?
  if (deviceFingerprint) {
    const { data: deviceVoters } = await supabase
      .from('votes')
      .select('voter_user_id')
      .eq('contest_id', contestId)
      .eq('device_fingerprint', deviceFingerprint)
      .not('voter_user_id', 'is', null)
      .limit(20);

    const uniqueUsers = new Set((deviceVoters ?? []).map((r: any) => r.voter_user_id)).size;
    if (uniqueUsers > 3) {
      flags.push({
        type: 'duplicate_device',
        severity: 'high',
        score: 25,
        reason: `${uniqueUsers} accounts on same device`,
      });
      totalScore += 25;
    }
  }

  // 3. Bot speed check — last vote within threshold?
  const lastVoteWindow = new Date(Date.now() - settings.botSpeedThresholdMs).toISOString();
  const query = supabase
    .from('votes')
    .select('id', { count: 'exact', head: true })
    .eq('contest_id', contestId)
    .gte('created_at', lastVoteWindow);

  if (userId) {
    const { count } = await query.eq('voter_user_id', userId);
    if ((count ?? 0) > 0) {
      flags.push({ type: 'bot_speed', severity: 'medium', score: 15, reason: 'Voted too fast' });
      totalScore += 15;
    }
  } else if (ipAddress) {
    const { count } = await query.eq('ip_address', ipAddress);
    if ((count ?? 0) > 0) {
      flags.push({ type: 'bot_speed', severity: 'medium', score: 15, reason: 'IP voting too fast' });
      totalScore += 15;
    }
  }

  // 4. Vote spike detection — sudden burst in last 5 minutes for this contestant?
  if (settings.detectVoteSpikes) {
    const fiveMinAgo = new Date(Date.now() - 300_000).toISOString();
    const { count: recentCount } = await supabase
      .from('votes')
      .select('id', { count: 'exact', head: true })
      .eq('contest_id', contestId)
      .eq('contestant_id', contestantId)
      .gte('created_at', fiveMinAgo);

    if ((recentCount ?? 0) > 200) {
      flags.push({
        type: 'vote_spike',
        severity: 'high',
        score: 20,
        reason: `${recentCount} votes in 5 minutes`,
      });
      totalScore += 20;
    }
  }

  // 5. Disposable email check
  if (email && settings.blockDisposableEmails) {
    if (isDisposableEmail(email)) {
      flags.push({ type: 'disposable_email', severity: 'medium', score: 20, reason: 'Disposable email domain' });
      totalScore += 20;
    }
  }

  // 6. Self-vote check
  if (userId && contestantId) {
    const { data: contestant } = await supabase
      .from('competition_enrollments')
      .select('user_id')
      .eq('id', contestantId)
      .maybeSingle();

    if (contestant && (contestant as any).user_id === userId) {
      flags.push({ type: 'self_vote', severity: 'critical', score: 50, reason: 'Contestant voting for self' });
      totalScore += 50;
    }
  }

  // Persist flags if above threshold
  if (totalScore >= FRAUD_SCORE_THRESHOLDS.SUSPICIOUS && flags.length > 0) {
    const supabaseAdmin = createAdminClient();
    for (const flag of flags) {
      supabaseAdmin
        .from('fraud_flags')
        .insert({
          contest_id: contestId,
          contestant_id: contestantId,
          voter_profile_id: null,
          flag_type: flag.type,
          severity: flag.severity,
          description: flag.reason,
          status: 'open',
        })
        .then(() => {});  // fire-and-forget
    }
  }

  return { score: Math.min(100, totalScore), flags };
}

export async function createFraudFlag(opts: {
  contestId: string;
  contestantId?: string;
  voterProfileId?: string;
  voteId?: string;
  transactionId?: string;
  flagType: FraudFlagType;
  severity: FraudSeverity;
  description: string;
}): Promise<string> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('fraud_flags')
    .insert({
      contest_id: opts.contestId,
      contestant_id: opts.contestantId ?? null,
      voter_profile_id: opts.voterProfileId ?? null,
      vote_id: opts.voteId ?? null,
      transaction_id: opts.transactionId ?? null,
      flag_type: opts.flagType,
      severity: opts.severity,
      description: opts.description,
      status: 'open',
    })
    .select('id')
    .single();
  return (data as { id: string }).id;
}

export async function resolveFraudFlag(
  flagId: string,
  reviewedBy: string,
  actionTaken: string,
  status: 'resolved' | 'dismissed' | 'actioned',
): Promise<void> {
  const supabase = createAdminClient();
  await supabase
    .from('fraud_flags')
    .update({
      status,
      action_taken: actionTaken,
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', flagId);
}

// Basic disposable email domain list. In production, use an external API.
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com','tempmail.com','guerrillamail.com','10minutemail.com',
  'throwam.com','yopmail.com','dispostable.com','fakeinbox.com',
  'sharklasers.com','guerrillamailblock.com','trashmail.com',
]);

function isDisposableEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  return domain ? DISPOSABLE_DOMAINS.has(domain) : false;
}
