/**
 * GET /api/v1/referrals/me
 *
 * Returns the authenticated user's referral code, total referral count,
 * and total kobo earned from referral rewards.
 * Requires Bearer token and FEATURE_REFERRALS_ENABLED.
 */
import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { requireFeature } from '@/src/lib/feature-flags';
import { getReferralSummary } from '@/src/server/referrals/service';

export async function GET(request: Request) {
  try {
    requireFeature('referrals');
    const user = await requireRequestUser(request);

    const summary = await getReferralSummary(user.id);

    return NextResponse.json({
      success: true,
      referral: {
        code:              summary.code,
        total_referrals:   summary.totalReferrals,
        total_earned_kobo: summary.totalEarnedKobo,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
