// Team dashboard, onboard sub-referrers, member detail, override ledger, team
// leaderboard, training, disclosure. Money is ALWAYS integer kobo.
// COMPLIANCE (PRD §7, §10): agent/team overrides are a CAPPED percentage of the
// VERIFIED ACTIVITY/REVENUE of network members — NEVER a payment for recruiting
// people. Every override field carries the activity basis and the cap, and the
// disclosure copy is load-bearing. No multi-level "downline recruitment" bonus.

export interface TeamDashboard {
  teamName: string;
  memberCount: number;
  activeMemberCount: number;
  /** Overrides earned this period — from members' verified activity, kobo. */
  overrideEarnedKobo: number;
  /** Total verified network activity (revenue) the override is computed on, kobo. */
  networkActivityKobo: number;
  /** Override rate applied to verified activity, 0..1 (e.g. 0.05 = 5%). */
  overrideRate: number;
  /** Per-period override cap, integer kobo. */
  overrideCapKobo: number;
  /** How much of the cap is used this period, integer kobo. */
  capUsedKobo: number;
}

export type InviteState = 'pending' | 'accepted' | 'declined';

export interface TeamInvite {
  id: string;
  name: string;
  contact: string;
  state: InviteState;
  sentAt: string;
}

export interface OnboardResult {
  ok: boolean;
  inviteId: string;
}

export type MemberStatus = 'active' | 'onboarding' | 'inactive';

export interface TeamMember {
  id: string;
  name: string;
  status: MemberStatus;
  joinedAt: string;
  /** Member's own verified activity (revenue) this period, integer kobo. */
  activityKobo: number;
  /** Activity-based override YOU earned from this member, integer kobo. */
  overrideKobo: number;
  /** Count of the member's verified referrals (their own activity proof). */
  verifiedReferrals: number;
}

export interface MemberActivityRow {
  id: string;
  label: string;
  at: string;
  /** Verified activity amount that contributed to override, integer kobo. */
  activityKobo: number;
  /** Override accrued from this activity, integer kobo. */
  overrideKobo: number;
}

export interface MemberDetail extends TeamMember {
  /** Activity-based explanation (NOT recruitment) — load-bearing. */
  activityBasis: string;
  rows: MemberActivityRow[];
}

export interface OverrideLedgerRow {
  id: string;
  memberName: string;
  /** The member's verified activity this override is based on, integer kobo. */
  activityKobo: number;
  /** Override rate applied, 0..1. */
  rate: number;
  /** Override accrued, integer kobo. */
  overrideKobo: number;
  /** Whether the cap clipped this accrual. */
  capped: boolean;
  at: string;
}

export interface OverrideLedger {
  /** Override rate applied to verified activity, 0..1. */
  rate: number;
  capKobo: number;
  capUsedKobo: number;
  totalOverrideKobo: number;
  totalActivityKobo: number;
  rows: OverrideLedgerRow[];
}

export interface TeamLeaderboardRow {
  rank: number;
  name: string;
  /** Member's verified activity (the basis of any override), integer kobo. */
  activityKobo: number;
  verifiedReferrals: number;
  isYou: boolean;
}

export interface TeamTarget {
  label: string;
  current: number;
  target: number;
  unit: string;
}

export interface TeamLeaderboard {
  resetAt: string | null;
  rows: TeamLeaderboardRow[];
  targets: TeamTarget[];
}

export interface TrainingResource {
  id: string;
  title: string;
  type: 'script' | 'guide' | 'video' | 'policy';
  blurb: string;
  /** True for compliance-critical material (e.g. what NOT to promise). */
  compliance: boolean;
  icon: string;
}

export interface AgentDisclosure {
  /** Override rate applied to verified activity, 0..1. */
  overrideRate: number;
  /** Per-period cap, integer kobo. */
  capKobo: number;
  /** Number of override tiers (kept shallow + capped by policy). */
  maxDepth: number;
  /** Load-bearing disclosure points (activity-based, capped, never recruitment). */
  points: string[];
  /** Versioned disclosure id + acceptance state. */
  version: string;
  accepted: boolean;
}
