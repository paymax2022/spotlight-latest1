// ── Referral Ambassador Zone types (M-AMB-01..06) ────────────────────────────
// Dashboard funnel, creative toolkit, referred-audience, analytics, payouts,
// tier progression. Money is ALWAYS integer kobo. Ambassador earnings tie to
// referred users' verified activity (§7) — never to recruitment.

// ── Dashboard (M-AMB-01) ─────────────────────────────────────────────────────
export interface FunnelStage {
  key: 'clicks' | 'signups' | 'kyc' | 'activated' | 'retained';
  label: string;
  value: number;
  /** Conversion from the previous stage, 0..1 (null for the first stage). */
  conversion: number | null;
}

export interface AmbassadorDashboard {
  tier: string;
  /** Lifetime ambassador earnings (verified-activity based), integer kobo. */
  earnedKobo: number;
  pendingKobo: number;
  eligibleKobo: number;
  /** Overall click→activated rate, 0..1. */
  conversionRate: number;
  funnel: FunnelStage[];
}

// ── Creative toolkit (M-AMB-02) ──────────────────────────────────────────────
export type AssetKind = 'banner' | 'caption' | 'vanity_link' | 'video';

export interface CreativeAsset {
  id: string;
  kind: AssetKind;
  title: string;
  /** Caption text or link URL; null for image/video-only assets. */
  content: string | null;
  /** Compliance status — only approved assets should be shared. */
  approved: boolean;
  icon: string;
}

// ── Referred audience (M-AMB-03) ─────────────────────────────────────────────
export type AudienceStatus = 'invited' | 'signed_up' | 'kyc' | 'activated' | 'retained' | 'churned';

export interface AudienceMember {
  id: string;
  name: string;
  status: AudienceStatus;
  channel: string;
  joinedAt: string;
  /** Activity-based earnings this member generated, integer kobo. */
  earnedKobo: number;
}

// ── Analytics (M-AMB-04) ─────────────────────────────────────────────────────
export interface TrendPoint {
  label: string;
  clicks: number;
  activations: number;
}

export interface ChannelPerformance {
  channel: string;
  clicks: number;
  activations: number;
  /** Conversion 0..1. */
  rate: number;
}

export interface AmbassadorAnalytics {
  trend: TrendPoint[];
  channels: ChannelPerformance[];
  bestChannel: string;
}

// ── Payouts (M-AMB-05) ───────────────────────────────────────────────────────
export interface AmbassadorPayouts {
  eligibleKobo: number;
  pendingKobo: number;
  vestingKobo: number;
  minWithdrawKobo: number;
  /** Recent payout history. */
  history: { id: string; amountKobo: number; at: string; reference: string }[];
}

export interface AmbassadorWithdrawResult {
  ok: boolean;
  amountKobo: number;
  newEligibleKobo: number;
  reference: string;
  error?: 'below_min' | 'insufficient' | 'kyc_required';
}

// ── Tier progression (M-AMB-06) ──────────────────────────────────────────────
export interface AmbassadorTier {
  key: string;
  name: string;
  /** Activated-referrals required to reach this tier (activity, not signups). */
  activatedRequired: number;
  perks: string[];
  /** Reward multiplier applied to activity-based earnings. */
  rewardMultiplier: number;
  reached: boolean;
  current: boolean;
}

export interface TierProgression {
  currentTier: string;
  nextTier: string | null;
  activatedReferrals: number;
  activatedToNext: number | null;
  tiers: AmbassadorTier[];
}

// ── Application (M-AMB-00) ───────────────────────────────────────────────────
// Becoming an ambassador. The disclosure is mandatory and stored verbatim: the
// programme pays commission on referrals, and NDPC/FTC-style rules require the
// ambassador to have acknowledged that they must disclose it to their audience.

/** Backend lifecycle for referral_ambassadors.status. */
export type AmbassadorStatus = 'applied' | 'approved' | 'suspended' | 'rejected';

export interface AmbassadorApplication {
  id: string;
  tier: string;
  status: AmbassadorStatus;
  /** The disclosure the applicant accepted, stored verbatim. */
  disclosureText: string;
  disclosureAcceptedAt: string | null;
  appliedAt: string;
  approvedAt: string | null;
}

export interface ApplyInput {
  tier: string;
  /** Must be true; the backend rejects an unaccepted disclosure with 400. */
  disclosureAccepted: boolean;
}
