import { adminApiBase, authHeaders, readOrThrow } from './usersService';

/**
 * Read-only referral case for the admin user profile. Backend:
 * GET /api/finance/admin/referrals/:id (Go thin alias of /v1/admin/referrals/:referrerId/case; referral.admin.case RBAC). Reads
 * throw AdminUsersRequestError (via readOrThrow) so callers can tell 403 apart.
 */
export type ReferralCase = {
  referrer_id: string;
  tier: {
    referrer_id: string;
    active_referral_count: number;
    current_tier: string;
    current_rate: number;
    last_recalculated_at?: string;
  } | null;
  rewards: Array<{
    id: string;
    referrer_id: string;
    referred_user_id: string;
    module: string;
    margin_kobo: number;
    applied_rate: number;
    reward_kobo: number;
    status: string;
  }>;
  milestones: Array<{
    id: string;
    threshold: number;
    bonus_kobo: number;
    status: string;
    achieved_at?: string;
    paid_at?: string;
    voided_at?: string;
  }>;
};

export async function getUserReferralCase(id: string): Promise<ReferralCase> {
  const res = await fetch(`${adminApiBase()}/finance/admin/referrals/${encodeURIComponent(id)}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  const payload = await readOrThrow(res, 'Loading referral summary');
  return {
    referrer_id: String(payload.referrer_id ?? id),
    tier: (payload.tier ?? null) as ReferralCase['tier'],
    rewards: Array.isArray(payload.rewards) ? (payload.rewards as ReferralCase['rewards']) : [],
    milestones: Array.isArray(payload.milestones) ? (payload.milestones as ReferralCase['milestones']) : [],
  };
}
