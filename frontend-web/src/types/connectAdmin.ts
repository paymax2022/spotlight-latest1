// ── Admin — Paymax Connect types ─────────────────────────────────────────────
// Field names mirror the Go JSON (snake_case) from /api/connect/admin/*.

export type ConnectCaseStatus = 'open' | 'investigating' | 'resolved' | 'closed';

export interface ConnectCase {
  id: string;
  reporter_id?: string | null;
  subject_id?: string | null;
  type: string;
  source_ref?: string | null;
  status: ConnectCaseStatus;
  resolution?: string | null;
  severity: string;
  assigned_admin?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConnectAuditEntry {
  id: string;
  actor_id?: string | null;
  actor_role?: string | null;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  reason?: string | null;
  created_at: string;
}

// ── §11.1 Dashboard ──────────────────────────────────────────────────────────
export interface ConnectDashboardActivity {
  id: string;
  kind: string;        // case_opened | aml_alert | payout_requested | str_filed | identity_review …
  label: string;
  ref?: string | null;
  created_at: string;
}
export interface ConnectDashboard {
  dau: number;
  mau: number;
  matches_today: number;
  live_sessions: number;
  gift_volume_today_kobo: number;   // money in kobo
  gift_volume_30d_kobo: number;
  open_cases: number;
  aml_alerts_open: number;
  payouts_pending: number;
  identity_queue: number;
  underage_queue: number;
  media_queue: number;
  activity: ConnectDashboardActivity[];
}

// ── §11.2 User & identity ────────────────────────────────────────────────────
export type ConnectUserStatus = 'active' | 'suspended' | 'banned' | 'restricted' | 'pending';
export type ConnectVerificationBadge = 'unverified' | 'selfie' | 'bvn' | 'nin' | 'id' | 'full';

export interface ConnectUserSummary {
  id: string;
  handle: string;
  display_name: string;
  tier: number;                 // CBN tier 0..3
  status: ConnectUserStatus;
  region: string;
  verification: ConnectVerificationBadge;
  flags: string[];
  wallet_balance_kobo: number;  // money in kobo
  created_at: string;
  last_active_at: string;
}
export interface ConnectUserDevice { id: string; label: string; last_seen: string; trusted: boolean; }
export interface ConnectUserTierEvent { id: string; from_tier: number; to_tier: number; reason: string; created_at: string; }
export interface ConnectUserDetail extends ConnectUserSummary {
  email_masked: string;         // PII masked — never raw
  phone_masked: string;
  modes: string[];              // dating | friendship | professional | creator | event
  lifetime_gift_sent_kobo: number;
  lifetime_gift_received_kobo: number;
  bvn_status: 'verified' | 'pending' | 'failed' | 'none';
  nin_status: 'verified' | 'pending' | 'failed' | 'none';
  devices: ConnectUserDevice[];
  tier_history: ConnectUserTierEvent[];
  open_cases: number;
}

export type IdentityReviewState = 'pending' | 'in_review' | 'approved' | 'rejected' | 'resubmit';
export interface IdentityReview {
  id: string;
  user_id: string;
  handle: string;
  doc_type: 'selfie_liveness' | 'national_id' | 'passport' | 'drivers_license' | 'bvn' | 'nin';
  badge_target: ConnectVerificationBadge;
  state: IdentityReviewState;
  // PII NEVER rendered inline — only a masked reference + encrypted-vault pointer.
  doc_ref_masked: string;       // e.g. NIN ••••1234
  submitted_at: string;
  liveness_score?: number | null;
}

export interface UnderageFlag {
  id: string;
  user_id: string;
  handle: string;
  signal: 'dob_under_18' | 'age_estimation' | 'report' | 'document_mismatch';
  declared_dob_masked: string;  // masked DOB, never raw
  status: 'open' | 'confirmed_minor' | 'cleared';
  case_id?: string | null;      // reports → case, never silent
  created_at: string;
}

// ── §11.4 Moderation ─────────────────────────────────────────────────────────
export type ModerationStatus = 'open' | 'investigating' | 'actioned' | 'dismissed';
export interface ModerationCaseSummary {
  id: string;
  case_id: string;              // each report = a case
  content_type: 'message' | 'profile' | 'photo' | 'stream' | 'bio' | 'comment';
  reason: string;
  ai_reason_codes: string[];    // AI moderation reason codes — reviewable
  reporter_id?: string | null;
  subject_id: string;
  severity: string;
  status: ModerationStatus;
  created_at: string;
}
export interface ModerationCaseDetail extends ModerationCaseSummary {
  ai_confidence: number;        // 0..1
  evidence_ref: string;         // pointer, not raw content
  history: { at: string; actor: string; action: string; note?: string }[];
  notes?: string | null;
}

export type MediaReviewState = 'pending' | 'approved' | 'rejected';
export interface MediaReviewItem {
  id: string;
  user_id: string;
  handle: string;
  media_kind: 'profile_photo' | 'gallery' | 'stream_thumbnail';
  ai_reason_codes: string[];
  ai_confidence: number;
  state: MediaReviewState;      // moderated BEFORE public visibility
  submitted_at: string;
}

// ── §11.5 Finance, gifting & AML ─────────────────────────────────────────────
export interface ConnectFinanceSummary {
  gift_volume_today_kobo: number;
  gift_volume_30d_kobo: number;
  paid_vote_volume_30d_kobo: number;
  payout_volume_30d_kobo: number;
  take_rate_30d_kobo: number;
  float_balance_kobo: number;
  ledger_debits_kobo: number;
  ledger_credits_kobo: number;
  pending_payouts_kobo: number;
}
export interface GiftTransaction {
  id: string;
  reference: string;
  sender_id: string;
  recipient_id: string;
  gift_label: string;           // rose | crown | flower …
  amount_kobo: number;          // money in kobo
  fee_kobo: number;
  tier_at_send: number;
  limit_state: 'within' | 'near_limit' | 'blocked';
  status: 'successful' | 'pending' | 'reversed' | 'failed';
  created_at: string;
}

export type AmlAlertStatus = 'open' | 'investigating' | 'escalated' | 'cleared' | 'str_filed';
export interface AmlAlert {
  id: string;
  subject_id: string;
  reason_codes: string[];       // AML reason codes ONLY — no raw PII
  rule: 'velocity' | 'structuring' | 'smurfing' | 'gifting_ring' | 'sanctions_hit' | 'pep_match';
  amount_kobo: number;          // money in kobo
  severity: string;
  status: AmlAlertStatus;
  case_id?: string | null;
  created_at: string;
}
export interface AmlCaseDetail extends AmlAlert {
  window_txn_count: number;
  window_volume_kobo: number;
  str_reference?: string | null;
  str_filed_at?: string | null;
  history: { at: string; actor: string; action: string; reason_code?: string }[];
  notes?: string | null;
}
export interface StrFilingResult {
  str_reference: string;
  filed_at: string;
  status: 'submitted';
}

export interface ConnectPayout {
  id: string;
  reference: string;
  user_id: string;
  handle: string;
  amount_kobo: number;          // money in kobo
  fee_kobo: number;
  tier: number;
  status: 'pending' | 'approved' | 'paid' | 'rejected' | 'review';
  requested_at: string;
}

// ── §11.6 Voting integrity ───────────────────────────────────────────────────
export type VotingContestStatus = 'scheduled' | 'live' | 'closed' | 'finalized';
export interface VotingContestSummary {
  id: string;
  title: string;
  status: VotingContestStatus;
  paid_votes: number;
  free_votes: number;
  paid_vote_volume_kobo: number;  // money in kobo
  integrity_score: number;        // 0..100
  flags_open: number;
  starts_at: string;
  ends_at: string;
}
export interface VotingIntegrityFlag {
  id: string;
  signal: 'bot_pattern' | 'sybil_cluster' | 'vote_buying' | 'velocity_spike' | 'collusion';
  reason_codes: string[];
  affected_votes: number;
  amount_kobo: number;
  status: 'open' | 'reviewing' | 'upheld' | 'dismissed';
  created_at: string;
}
export interface VotingContestDetail extends VotingContestSummary {
  entrants: { id: string; name: string; paid_votes: number; free_votes: number; tally_kobo: number }[];
  flags: VotingIntegrityFlag[];
  notes?: string | null;
}
