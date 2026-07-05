// ── Direct Referral Rewards — wire types ─────────────────────────────────────
// Field names mirror the Go backend responses VERBATIM (snake_case). Do NOT
// camelCase these on the wire (matches the events module convention). Money is
// always integer minor units (kobo).

import type { ReferralTier } from './constants';

export type { ReferralTier };

// POST /v1/referrals/link
export interface ReferralLink {
  id:          string;
  referrer_id: string;
  code:        string;
  created_at:  string; // ISO
}

// POST /v1/referrals/attribute { code }
export interface AttributionResult {
  referrer_id:      string;
  referred_user_id: string;
}

// GET /v1/referrals/me/dashboard
export interface NextMilestone {
  threshold:  number;
  bonus_kobo: number;
  remaining:  number; // active referrals still needed to reach the threshold
}

export interface ReferralDashboard {
  code:                   string;
  current_tier:           ReferralTier;
  current_rate:           number; // e.g. 0.05
  active_referral_count:  number;
  this_month_earned_kobo: number;
  lifetime_earned_kobo:   number;
  next_milestone:         NextMilestone | null;
}

// GET /v1/referrals/me/referrals
export interface ReferredUser {
  referred_user_id:     string;
  masked_contact:       string; // e.g. "Chidinma • 080****1234"
  joined_at:            string; // ISO
  active:               boolean; // 30-day rolling rule
  lifetime_earned_kobo: number;  // this referrer's earnings from this user
}

export interface ReferralsPage {
  referrals: ReferredUser[];
}

// GET /v1/referrals/me/earnings
export type RewardStatus = 'PENDING' | 'CREDITED' | 'REVERSED';

export interface RewardEntry {
  id:                    string;
  referred_user_id:      string;
  source_transaction_id: string;
  module:                string; // "bills" | "marketplace" | "insurance" | ...
  margin_kobo:           number;
  applied_rate:          number; // tier rate in effect at txn time
  reward_kobo:           number;
  status:                RewardStatus;
  config_version:        number;
  created_at:            string;         // ISO
  credited_at:           string | null;
  reversed_at:           string | null;
}

export interface EarningsPage {
  earnings: RewardEntry[];
}

// GET /v1/referrals/me/milestones
export type MilestoneStatus = 'ACHIEVED' | 'PAID' | 'VOIDED';

export interface AchievedMilestone {
  threshold:  number;
  bonus_kobo: number;
  status:     MilestoneStatus;
  paid_at:    string | null;
}

export interface UpcomingMilestone {
  threshold:  number;
  bonus_kobo: number;
}

export interface MilestonesResponse {
  achieved: AchievedMilestone[];
  upcoming: UpcomingMilestone[];
}

// ── Notification preferences (reuses the existing notif-prefs pattern; local
// to this module — the direct-rewards toggles differ from the legacy tree). ──
export interface RewardsNotificationPrefs {
  new_referral:      boolean; // a referral joined
  first_purchase:    boolean; // a referral's first settled purchase (first reward)
  milestone:         boolean; // milestone bonus achieved
  tier_upgrade:      boolean; // tier rate increased
  monthly_summary:   boolean; // monthly earnings summary
}

// Pagination input shared by the paginated reads.
export interface PageParams {
  limit?:  number;
  offset?: number;
}
