import type { KycStatus, KycTier } from '@/api/profile.api';

/**
 * The KYC ladder and Tier-0 notice as the customer reads them, in one place so the
 * words cannot drift from what the two gates enforce:
 *   backend/internal/finance/tiers (Go)  ·  frontend-web/src/server/tiers (Next.js)
 *
 * Extracted from app/(tabs)/profile.tsx, which used to hold these strings inline.
 * Dependency-free on purpose — the copy is pinned by tests/unit/account/tierCopy.spec.ts.
 */

export type WalletTier = KycTier;

/**
 * Tier 0 gets no naira figure at all. Both gates give it ₦0/day of wallet debits and
 * ADR-043 keeps transfers and withdrawals out of every Tier-0 allowance, so the only
 * honest statement is that sends are locked. The label used to read "₦10,000 / day" —
 * that number is the Tier-0 checkout PER-PURCHASE cap (`CheckoutMaxSingleKobo`),
 * quoted here as if it were a daily wallet limit, which is what sent a funded Tier-0
 * customer in circles: verify, "KYC Verified", refused again.
 */
export function tierWalletLimitLabel(tier: WalletTier): string {
  switch (tier) {
    case 1:
      return '₦50,000 / day';
    case 2:
      return '₦200,000 / day';
    case 3:
      return '₦5,000,000 / day';
    default:
      return 'Sends locked — needs Tier 1';
  }
}

/**
 * The no-document claim fills in email/DOB/phone and sets `kyc_status = 'verified'`
 * while `kyc_tier` stays 0. Calling that "Quick Activation" told the customer the
 * wallet had been switched on; the name of the fix is Tier 1, and the panel has to
 * say so in the same breath.
 */
export function tier0ClaimPanelCopy(): { title: string; sub: string; cta: string } {
  return {
    title: 'Tier 0 — Basic profile',
    sub: 'Confirms your email, date of birth and phone — no documents needed. Your wallet still cannot send or withdraw: that needs Tier 1 with your BVN.',
    cta: 'Confirm my details',
  };
}

/** The one line under the KYC status chip on the profile screen. */
export function walletTierNotice(kyc: {
  tier: WalletTier;
  status: KycStatus;
  requestedTier?: 1 | 2 | 3 | null;
}): string {
  if (kyc.status === 'pending' && kyc.requestedTier) {
    return `Tier ${kyc.requestedTier} request is awaiting admin review.`;
  }
  if (kyc.tier > 0) {
    return `Your active account level is Tier ${kyc.tier}.`;
  }
  // Tier 0 reads "verified" once the no-document claim is done, and that combination
  // is the trap: the refusal says complete KYC, this card says verified, so the
  // customer goes looking for a LIMIT to raise instead of the TIER they are missing.
  if (kyc.status === 'verified') {
    return 'You are verified at Tier 0, so your wallet cannot send or withdraw yet. Verify your BVN for Tier 1.';
  }
  return 'Your wallet cannot send or withdraw until you verify your BVN for Tier 1.';
}
