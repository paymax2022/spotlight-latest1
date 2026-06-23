import { createClient } from '@/lib/supabase/server';

type FraudCheckInput = {
  voteId?: string | null;
  contestantId: string;
  contestId?: string | null;
  deviceFingerprint?: string | null;
  voteType?: string | null;
  voteCount?: number | null;
  voterIp?: string | null;
};

type FraudCheckResult = {
  check_passed?: boolean;
  fraud_score?: number;
  checks?: unknown[];
  [key: string]: unknown;
};

export async function runFraudChecks(input: FraudCheckInput): Promise<FraudCheckResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('run_fraud_checks', {
    p_vote_id: input.voteId || null,
    p_contestant_id: input.contestantId,
    p_contest_id: input.contestId || null,
    p_voter_ip: input.voterIp || '0.0.0.0',
    p_device_fingerprint: input.deviceFingerprint || input.voterIp || 'anonymous',
    p_vote_type: input.voteType || 'free',
    p_vote_count: input.voteCount || 1,
  });

  if (error) {
    throw new Error(error.message);
  }

  return (data as FraudCheckResult | null) || {};
}

export async function logFraudCheck(
  input: FraudCheckInput & {
    userAgent?: string | null;
    result: FraudCheckResult;
  }
) {
  const supabase = await createClient();

  const { error } = await supabase.from('vote_fraud_logs').insert({
    vote_id: input.voteId || null,
    contestant_id: input.contestantId,
    contest_id: input.contestId || null,
    voter_ip: input.voterIp || '0.0.0.0',
    device_fingerprint: input.deviceFingerprint || input.voterIp || 'anonymous',
    vote_type: input.voteType || 'free',
    check_passed: input.result.check_passed ?? true,
    fraud_score: input.result.fraud_score ?? 0,
    checks_performed: input.result.checks ?? [],
    user_agent: input.userAgent || '',
  });

  if (error) {
    throw new Error(error.message);
  }
}
