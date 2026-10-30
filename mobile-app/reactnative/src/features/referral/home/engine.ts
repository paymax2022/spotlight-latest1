// Wire shapes of the live Direct Rewards engine (/api/v1/referrals/*, bare snake_case JSON).
// Kept apart from api.ts so the mapping in homeMap.ts can be tested without the HTTP client.

export interface EngineNextMilestone {
  threshold: number;
  bonus_kobo: number;
  remaining: number;
}

export interface EngineDashboard {
  code: string;
  current_tier: string;
  current_rate: number;
  active_referral_count: number;
  invited_count?: number;
  activated_count?: number;
  this_month_earned_kobo: number;
  lifetime_earned_kobo: number;
  next_milestone?: EngineNextMilestone;
}

/** GET /api/v1/referral/my-rewards (singular): the reward-ledger summary by state. */
export interface EngineRewards {
  total_earned_kobo?: number;
  eligible_kobo?: number;
  paid_kobo?: number;
  clawed_back_kobo?: number;
  by_state?: Record<string, number>;
}

export interface EngineEarning {
  id: string;
  referred_user_id: string;
  module: string;
  margin_kobo: number;
  applied_rate: number;
  reward_kobo: number;
  status: string;
  created_at: string;
  credited_at?: string;
  reversed_at?: string;
}

/** GET /api/v1/referrals/me/referrals row. `masked_contact` is already masked server-side. */
export interface EngineReferral {
  referred_user_id: string;
  masked_contact: string;
  joined_at: string;
  /** Made a qualifying purchase in the trailing 30 days. */
  active: boolean;
  lifetime_earned_kobo: number;
}
