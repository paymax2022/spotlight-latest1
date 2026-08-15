/**
 * KYC tier gating for vote eligibility
 * Ensures users meet tier requirements before voting
 */

import { createAdminClient } from '@/lib/supabase/admin';

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
    // Step 1: Fetch user KYC tier
    const { data: user, error: userErr } = await supabase
      .from('profiles')
      .select('kyc_tier')
      .eq('id', userId)
      .single();

    if (userErr || !user) {
      throw new KycGateError('User not found', 404);
    }

    // Step 2: Fetch contest requirements
    const { data: contestant, error: contestErr } = await supabase
      .from('contestants')
      .select('competition_id')
      .eq('id', contestantId)
      .single();

    if (contestErr || !contestant) {
      throw new KycGateError('Contestant not found', 404);
    }

    const { data: competition, error: compErr } = await supabase
      .from('competitions')
      .select('required_kyc_tier')
      .eq('id', contestant.competition_id)
      .single();

    if (compErr || !competition) {
      // If no tier requirement is set, allow the vote
      return true;
    }

    // Step 3: Validate tier
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
      .from('profiles')
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
      .select('competition_id')
      .eq('id', contestantId)
      .single();

    if (contestErr || !contestant) {
      return 0;
    }

    const { data: competition, error: compErr } = await supabase
      .from('competitions')
      .select('required_kyc_tier')
      .eq('id', contestant.competition_id)
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
