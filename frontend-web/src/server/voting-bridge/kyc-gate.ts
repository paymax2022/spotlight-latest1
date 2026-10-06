/**
 * KYC tier gating for vote eligibility
 * Ensures users meet tier requirements before voting
 */

import { createAdminClient } from '@/lib/supabase/server';

export class KycGateError extends Error {
  constructor(
    message: string,
    public statusCode: number = 403
  ) {
    super(message);
    this.name = 'KycGateError';
  }
}

/**
 * Assert that a user meets the KYC tier requirements for a contest
 */
export async function assertKycTier(userId: string, contestantId: string) {
  const supabase = createAdminClient();

  try {
    // user_profiles is the table the on_auth_user_created trigger populates —
    // `profiles` is the enterprise RBAC table, a different store that a normal
    // signup never writes to, so it 404'd every real voter.
    const { data: user, error: userErr } = await supabase
      .from('user_profiles')
      .select('kyc_tier')
      .eq('id', userId)
      .single();

    if (userErr || !user) {
      throw new KycGateError('User not found', 404);
    }

    const { data: contestant, error: contestErr } = await supabase
      .from('contestants')
      .select('contest_id')
      .eq('id', contestantId)
      .single();

    if (contestErr || !contestant) {
      throw new KycGateError('Contestant not found', 404);
    }

    // No required_kyc_tier column exists on contests yet — a missing column
    // errors the select, which is tolerated exactly like a missing row: the
    // requirement is tier 0 until the schema grows one.
    const { data: competition, error: compErr } = await supabase
      .from('contests')
      .select('required_kyc_tier')
      .eq('id', contestant.contest_id)
      .single();

    if (compErr || !competition) {
      // If no tier requirement is set, allow the vote
      return true;
    }

    const requiredTier = competition.required_kyc_tier || 0;
    const userTier = user.kyc_tier || 0;

    if (userTier < requiredTier) {
      throw new KycGateError(
        `User tier ${userTier} does not meet requirement ${requiredTier} for this contest`,
        403
      );
    }

    return true;
  } catch (error) {
    if (error instanceof KycGateError) {
      throw error;
    }
    console.error('[KycGate] assertKycTier error:', error);
    throw new KycGateError('KYC verification failed', 500);
  }
}

/**
 * Get user's current KYC tier
 */
export async function getUserKycTier(userId: string): Promise<number> {
  const supabase = createAdminClient();

  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('kyc_tier')
      .eq('id', userId)
      .single();

    if (error || !data) {
      return 0;
    }

    return data.kyc_tier || 0;
  } catch (error) {
    console.error('[KycGate] getUserKycTier error:', error);
    return 0;
  }
}

/**
 * Get contest KYC requirements
 */
export async function getContestKycRequirement(contestantId: string): Promise<number> {
  const supabase = createAdminClient();

  try {
    const { data: contestant, error: contestErr } = await supabase
      .from('contestants')
      .select('contest_id')
      .eq('id', contestantId)
      .single();

    if (contestErr || !contestant) {
      return 0;
    }

    const { data: competition, error: compErr } = await supabase
      .from('contests')
      .select('required_kyc_tier')
      .eq('id', contestant.contest_id)
      .single();

    if (compErr || !competition) {
      return 0;
    }

    return competition.required_kyc_tier || 0;
  } catch (error) {
    console.error('[KycGate] getContestKycRequirement error:', error);
    return 0;
  }
}
