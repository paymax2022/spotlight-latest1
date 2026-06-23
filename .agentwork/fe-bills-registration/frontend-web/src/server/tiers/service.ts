/**
 * Tier limits enforcement service — Block 7.
 *
 * Reads the user's KYC tier, applies the per-tier daily caps defined in
 * docs/prd.md § EPIC 2, and records every enforcement decision to
 * tier_limit_events for audit.
 *
 * All checks fail-closed: a DB error is treated as a deny.
 * Flag FEATURE_TIER_LIMITS_ENABLED=false bypasses all limit checks.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { getKycTier } from '@/src/server/kyc/service';
import {
  TIER_WALLET_LIMIT_KOBO,
  TIER_VOTE_LIMIT,
  type KycTier,
} from '@/src/server/kyc/types';
import { ApiError } from '@/src/lib/api/responses';
import { featureFlags } from '@/src/lib/feature-flags';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TierConfig {
  tier: KycTier;
  dailyWalletLimitKobo: number | null;  // null = unlimited (Tier 3)
  dailyVoteLimit: number | null;         // null = unlimited (Tier 3)
}

export interface WalletLimitResult {
  /** Pass to debit_wallet_atomic as p_daily_limit_kobo. null = unlimited. */
  dailyLimitKobo: number | null;
}

// ---------------------------------------------------------------------------
// getTierConfig
// ---------------------------------------------------------------------------

export function getTierConfig(tier: KycTier): TierConfig {
  return {
    tier,
    dailyWalletLimitKobo: TIER_WALLET_LIMIT_KOBO[tier],
    dailyVoteLimit: TIER_VOTE_LIMIT[tier],
  };
}

// ---------------------------------------------------------------------------
// enforceWalletLimit
// ---------------------------------------------------------------------------

/**
 * Validates that a user is allowed to debit `amountKobo` from their wallet
 * given their KYC tier.
 *
 * Returns the daily limit (kobo) to pass to debit_wallet_atomic, or null for
 * unlimited. Throws ApiError(403) for tier 0 or a projected daily overage.
 *
 * When FEATURE_TIER_LIMITS_ENABLED is false, returns { dailyLimitKobo: null }
 * immediately — the atomic RPC will still enforce the available balance check.
 */
export async function enforceWalletLimit(
  userId: string,
  amountKobo: number,
): Promise<WalletLimitResult> {
  if (!featureFlags.tierLimits()) {
    return { dailyLimitKobo: null };
  }

  let tier: KycTier;
  try {
    tier = await getKycTier(userId);
  } catch {
    // Fail closed — cannot read tier → deny
    await recordLimitEvent(userId, 0 as KycTier, 'wallet_daily', {
      amountKobo,
      denied: true,
    });
    throw new ApiError('Wallet limit check failed. Please try again.', 503);
  }

  const config = getTierConfig(tier);

  // Tier 0: wallet is fully disabled
  if (config.dailyWalletLimitKobo === 0) {
    await recordLimitEvent(userId, tier, 'wallet_daily', {
      amountKobo,
      limitKobo: 0,
      denied: true,
    });
    throw new ApiError(
      'Wallet is disabled for unverified accounts. Complete KYC to enable your wallet.',
      403,
    );
  }

  // Tier 3 or any tier with null limit: unlimited
  if (config.dailyWalletLimitKobo === null) {
    return { dailyLimitKobo: null };
  }

  // Tier 1 / 2: project today's total to give an early TypeScript-layer deny
  // before hitting the DB RPC. The RPC re-checks atomically — this is the fast path.
  const supabase = createAdminClient();

  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);

  // Fetch account id for this user
  const { data: acct, error: acctErr } = await supabase
    .from('ledger_accounts')
    .select('id')
    .eq('user_id', userId)
    .eq('type', 'wallet')
    .maybeSingle();

  if (acctErr || !acct) {
    // No account yet — first debit; daily total is 0, always within limits
    return { dailyLimitKobo: config.dailyWalletLimitKobo };
  }

  const { data: sumRow, error: sumErr } = await supabase
    .from('ledger_entries')
    .select('amount_kobo')
    .eq('account_id', acct.id)
    .eq('type', 'DEBIT')
    .gte('created_at', todayUtc.toISOString());

  if (sumErr) {
    // Fail closed
    await recordLimitEvent(userId, tier, 'wallet_daily', {
      amountKobo,
      limitKobo: config.dailyWalletLimitKobo,
      denied: true,
    });
    throw new ApiError('Wallet limit check failed. Please try again.', 503);
  }

  const dailyTotal = (sumRow ?? []).reduce(
    (acc, row) => acc + (Number(row.amount_kobo) || 0),
    0,
  );

  if (dailyTotal + amountKobo > config.dailyWalletLimitKobo) {
    await recordLimitEvent(userId, tier, 'wallet_daily', {
      amountKobo,
      dailyTotalKobo: dailyTotal,
      limitKobo: config.dailyWalletLimitKobo,
      denied: true,
    });
    throw new ApiError(
      `Daily wallet limit of ₦${config.dailyWalletLimitKobo / 100} reached for your KYC tier.`,
      403,
    );
  }

  return { dailyLimitKobo: config.dailyWalletLimitKobo };
}

// ---------------------------------------------------------------------------
// enforceVoteLimit
// ---------------------------------------------------------------------------

/**
 * Validates that a user has not exceeded their tier's daily paid-vote cap.
 * Throws ApiError(403) when the limit is reached, ApiError(503) on DB error.
 *
 * When FEATURE_TIER_LIMITS_ENABLED is false, returns immediately.
 */
export async function enforceVoteLimit(userId: string): Promise<void> {
  if (!featureFlags.tierLimits()) return;

  let tier: KycTier;
  try {
    tier = await getKycTier(userId);
  } catch {
    await recordLimitEvent(userId, 0 as KycTier, 'vote_daily', { denied: true });
    throw new ApiError('Vote limit check failed. Please try again.', 503);
  }

  const config = getTierConfig(tier);

  if (config.dailyVoteLimit === null) return; // Tier 3: unlimited

  const supabase = createAdminClient();

  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from('vote_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('voter_user_id', userId)
    .eq('vote_credit_status', 'credited')
    .gte('created_at', todayUtc.toISOString());

  if (error) {
    await recordLimitEvent(userId, tier, 'vote_daily', {
      limitVotes: config.dailyVoteLimit,
      denied: true,
    });
    throw new ApiError('Vote limit check failed. Please try again.', 503);
  }

  const dailyCount = count ?? 0;

  if (dailyCount >= config.dailyVoteLimit) {
    await recordLimitEvent(userId, tier, 'vote_daily', {
      dailyVoteCount: dailyCount,
      limitVotes: config.dailyVoteLimit,
      denied: true,
    });
    throw new ApiError(
      `Daily paid vote limit of ${config.dailyVoteLimit} reached for your KYC tier.`,
      403,
    );
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface LimitEventPayload {
  amountKobo?: number;
  dailyTotalKobo?: number;
  limitKobo?: number;
  voteCount?: number;
  dailyVoteCount?: number;
  limitVotes?: number;
  denied: boolean;
}

async function recordLimitEvent(
  userId: string,
  tier: KycTier,
  limitType: 'wallet_daily' | 'vote_daily',
  payload: LimitEventPayload,
): Promise<void> {
  try {
    const supabase = createAdminClient();
    await supabase.from('tier_limit_events').insert({
      user_id:          userId,
      tier,
      limit_type:       limitType,
      amount_kobo:      payload.amountKobo      ?? null,
      daily_total_kobo: payload.dailyTotalKobo  ?? null,
      limit_kobo:       payload.limitKobo       ?? null,
      vote_count:       payload.voteCount        ?? null,
      daily_vote_count: payload.dailyVoteCount  ?? null,
      limit_votes:      payload.limitVotes      ?? null,
      denied:           payload.denied,
    });
  } catch {
    // Audit write failures must not block the enforcement path.
  }
}
