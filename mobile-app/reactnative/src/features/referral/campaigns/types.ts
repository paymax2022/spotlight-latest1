// ── Referral Campaigns types (M-CMP-01..03) ──────────────────────────────────
// Active campaigns, campaign detail (eligibility, reward, vesting, end date),
// featured/seasonal. Money is ALWAYS integer kobo. Rewards tie to a referred
// friend's verified activity (§7).

export type CampaignStatus = 'active' | 'ending_soon' | 'upcoming' | 'ended';

export type CampaignRewardType = 'flat' | 'dynamic' | 'ltv_priced';

export interface CampaignReward {
  type: CampaignRewardType;
  /** Display headline for the reward (e.g. "Up to ₦2,000 per friend"). */
  headline: string;
  /** Referrer-side reward in integer kobo (max if dynamic). */
  referrerKobo: number;
  /** Referee/welcome-side reward in integer kobo, if any. */
  refereeKobo: number | null;
}

export interface CampaignSummary {
  id: string;
  title: string;
  blurb: string;
  icon: string;
  /** Vertical/context the campaign promotes. */
  vertical: 'property' | 'bills' | 'savings' | 'general' | 'sport' | 'festive';
  status: CampaignStatus;
  reward: CampaignReward;
  endsAt: string | null;
  featured: boolean;
}

export interface VestingTranche {
  label: string;
  amountKobo: number;
  /** Condition copy that releases this tranche. */
  condition: string;
}

export interface CampaignDetail extends CampaignSummary {
  /** Compliant explanation tying reward to verified activity. */
  explanation: string;
  eligibility: string[];
  qualifyingActions: string[];
  vesting: VestingTranche[];
  /** Per-referrer cap in integer kobo, if any. */
  capKobo: number | null;
  terms: string[];
}
