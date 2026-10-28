// KYC tier limits for crowdfunding campaign creation.
// Mirrors backend tiers/service.go tier config.

export const CROWDFUNDING_TIER_LIMITS: Record<number, number> = {
  0: 0,               // Tier 0: Blocked (₦0)
  1: 5_000_000,       // Tier 1: ₦5M max goal
  2: 20_000_000,      // Tier 2: ₦20M max goal
  3: 0,               // Tier 3: Unlimited (0 = unlimited)
};

export interface TierAllowance {
  allowed: boolean;
  tier: number;
  limitKobo: number;
  amountKobo: number;
  requiredTier?: number;
}

/**
 * Check if a creator's tier allows them to create a campaign with a given goal.
 * @param userTier - User's current KYC tier
 * @param amountKobo - Campaign goal in kobo (minor units)
 * @returns Object indicating whether the amount is allowed and what tier is needed
 */
export function checkCampaignAmountAllowed(userTier: number, amountKobo: number): TierAllowance {
  const limitKobo = CROWDFUNDING_TIER_LIMITS[userTier] ?? 0;

  // Tier 3 unlimited (limit is 0)
  if (limitKobo === 0 && userTier >= 3) {
    return {
      allowed: true,
      tier: userTier,
      limitKobo,
      amountKobo,
    };
  }

  // Tier 0 always blocked
  if (userTier === 0) {
    return {
      allowed: false,
      tier: userTier,
      limitKobo: 0,
      amountKobo,
      requiredTier: 1,
    };
  }

  // Check if amount exceeds tier limit
  if (amountKobo > limitKobo) {
    // Find the minimum tier that allows this amount
    let requiredTier = userTier + 1;
    for (const [tier, limit] of Object.entries(CROWDFUNDING_TIER_LIMITS)) {
      const t = Number(tier);
      const l = Number(limit);
      if ((l === 0 && t >= 3) || (l > 0 && l >= amountKobo)) {
        requiredTier = t;
        break;
      }
    }

    return {
      allowed: false,
      tier: userTier,
      limitKobo,
      amountKobo,
      requiredTier,
    };
  }

  return {
    allowed: true,
    tier: userTier,
    limitKobo,
    amountKobo,
  };
}

export function tierLimitMessage(userTier: number, amountKobo: number): string {
  const { allowed, limitKobo, requiredTier } = checkCampaignAmountAllowed(userTier, amountKobo);

  if (allowed) {
    return '';
  }

  if (userTier === 0) {
    return 'Complete KYC to create crowdfunding campaigns.';
  }

  const currentLimitLabel = limitKobo / 100_000; // Convert kobo to Naira (display in thousands)
  const neededAmountLabel = amountKobo / 100_000;

  return `Your current tier allows campaigns up to ₦${(limitKobo / 100).toLocaleString('en-NG')}. Complete higher-level KYC to raise up to ₦${(amountKobo / 100).toLocaleString('en-NG')}.`;
}
