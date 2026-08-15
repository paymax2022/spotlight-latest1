// ── Types for the Spotlight Academy admin console (Phase 0+1) ─────────────────
// Shapes are intentionally pragmatic; the live Go backend may extend them. All
// monetary amounts are integers in minor units (kobo). Times are ISO-8601.

export type ActivityKind =
  | 'pool_funded' | 'reward_redeemed' | 'item_approved' | 'item_rejected'
  | 'cards_generated' | 'plan_published' | 'badge_earned' | 'exam_opened'
  | 'campaign_launched';

export type ActivityItem = {
  id: string;
  label: string;
  kind: ActivityKind;
  ref: string | null;
  created_at: string;
};

export type TrendPoint = { date: string; value: number };

// ── Executive dashboard ───────────────────────────────────────────────────────
export type AcademyDashboard = {
  active_learners: number;
  active_learners_30d: number;
  mock_attempts_30d: number;
  mock_attempts_today: number;
  exam_readiness_avg: number;       // 0..1
  reward_spend_30d_kobo: number;
  reward_pool_balance_kobo: number;
  revenue_30d_kobo: number;
  revenue_today_kobo: number;
  paying_learners: number;
  question_items_total: number;
  items_pending_review: number;
  attempts_trend: TrendPoint[];     // 14d mock attempts
  activity: ActivityItem[];
};

// ── Curriculum ────────────────────────────────────────────────────────────────
export type CurriculumVersion = {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'legacy';
  effective_date: string;
  classes_count: number;
  subjects_count: number;
};

export type CurriculumClass = { id: string; version_id: string; name: string; order: number };
export type CurriculumSubject = { id: string; class_id: string; name: string; code: string; topics_count: number };
export type CurriculumTopic = { id: string; subject_id: string; name: string; objectives_count: number };

export type CurriculumTree = {
  versions: CurriculumVersion[];
  classes: CurriculumClass[];
  subjects: CurriculumSubject[];
};

export type CurriculumVersionInput = { name: string; effective_date: string; status?: CurriculumVersion['status'] };

// ── Question bank ─────────────────────────────────────────────────────────────
export type QuestionDifficulty = 'easy' | 'medium' | 'hard';
export type QuestionReviewStatus = 'draft' | 'in_review' | 'approved' | 'rejected' | 'duplicate';

export type QuestionItem = {
  id: string;
  stem: string;
  type: 'mcq' | 'multi_select' | 'numeric' | 'short_text';
  subject: string;
  topic: string;
  difficulty: QuestionDifficulty;
  objective: string | null;
  options: string[];
  answer_key: string;
  review_status: QuestionReviewStatus;
  author: string;
  difficulty_index: number | null;     // p-value 0..1
  discrimination: number | null;       // point-biserial
  created_at: string;
};

export type QuestionItemInput = {
  stem: string;
  type: QuestionItem['type'];
  subject: string;
  topic: string;
  difficulty: QuestionDifficulty;
  objective?: string | null;
  options: string[];
  answer_key: string;
};

export type QuestionReviewInput = { action: 'approve' | 'reject' | 'flag_duplicate'; notes?: string };

// ── Exams ─────────────────────────────────────────────────────────────────────
export type ExamArena = {
  id: string;
  exam_code: 'CCE' | 'BECE' | 'WASSCE' | 'NECO' | 'UTME' | 'NABTEB';
  name: string;
  status: 'draft' | 'active' | 'archived';
  next_session_at: string | null;
  registered: number;
};

export type ExamBlueprint = {
  id: string;
  arena_id: string;
  name: string;
  duration_minutes: number;
  question_count: number;
  pass_mark_pct: number;             // 0..1
  negative_marking: boolean;
  subjects: string[];
};

export type SubjectCombinationRule = {
  id: string;
  course: string;
  required_subjects: string[];
  electives_pick: number;
  elective_pool: string[];
};

export type ExamBlueprintInput = {
  arena_id: string;
  name: string;
  duration_minutes: number;
  question_count: number;
  pass_mark_pct: number;
  negative_marking: boolean;
  subjects: string[];
};

// ── Gamification ──────────────────────────────────────────────────────────────
export type XpLevel = { level: number; xp_required: number };
export type StreakConfig = { daily_xp: number; freeze_tokens_per_month: number; grace_hours: number };
export type Badge = {
  id: string;
  name: string;
  criteria: string;
  status: 'active' | 'draft' | 'archived';
  awarded_count: number;
};
export type Challenge = {
  id: string;
  name: string;
  cadence: 'daily' | 'weekly' | 'seasonal';
  status: 'live' | 'upcoming' | 'ended';
  reward_xp: number;
  participants: number;
};
export type LeaderboardConfig = {
  id: string;
  scope: 'global' | 'class' | 'school';
  reset: 'daily' | 'weekly' | 'monthly' | 'never';
  anti_cheat_threshold: number;
};

export type GamificationConfig = {
  xp_curve: XpLevel[];
  streak: StreakConfig;
  badges: Badge[];
  challenges: Challenge[];
  leaderboards: LeaderboardConfig[];
};

// ── Rewards ───────────────────────────────────────────────────────────────────
// Invariant: no reward without a funded pool. balance_kobo must cover redemptions.
export type RewardPool = {
  id: string;
  name: string;
  status: 'unfunded' | 'funded' | 'low_balance' | 'depleted';
  funded_kobo: number;
  balance_kobo: number;
  spent_kobo: number;
  per_user_cap_kobo: number;
  sponsor: string | null;
  created_at: string;
};

export type RewardCatalogItem = {
  id: string;
  name: string;
  category: 'airtime' | 'data' | 'voucher' | 'cash' | 'physical';
  point_cost: number;
  value_kobo: number;
  pool_id: string;
  stock: number | null;
  status: 'active' | 'inactive';
};

export type RewardLedgerEntry = {
  id: string;
  pool_id: string;
  type: 'fund' | 'redeem' | 'reversal';
  amount_kobo: number;
  user_id: string | null;
  ref: string;
  created_at: string;
};

export type RewardPoolInput = { name: string; per_user_cap_kobo: number; sponsor?: string | null };
export type RewardFundInput = { pool_id: string; amount_kobo: number };

// ── Commerce ──────────────────────────────────────────────────────────────────
export type Plan = {
  id: string;
  name: string;
  cadence: 'monthly' | 'termly' | 'annual';
  price_kobo: number;
  status: 'active' | 'draft' | 'archived';
  active_subscribers: number;
};

export type ExamBundle = {
  id: string;
  name: string;
  exam_code: string;
  price_kobo: number;
  status: 'active' | 'draft' | 'archived';
  sold: number;
};

export type AccessCardBatch = {
  id: string;
  label: string;
  plan_id: string;
  quantity: number;
  generated: number;
  allocated: number;
  status: 'generated' | 'partial' | 'allocated';
  agent: string | null;
  created_at: string;
};

export type PaymentsOverview = {
  gross_30d_kobo: number;
  net_30d_kobo: number;
  refunds_30d_kobo: number;
  successful_txns_30d: number;
  failed_txns_30d: number;
};

export type AccessCardGenerateInput = { plan_id: string; quantity: number; label: string };
export type AccessCardAllocateInput = { batch_id: string; agent: string; quantity: number };
export type RefundInput = { txn_ref: string; amount_kobo: number; reason: string };

// ── Identity (admin user lookup) ──────────────────────────────────────────────
export type AcademyUser = {
  id: string;
  display_name: string;
  email: string;
  role: 'learner' | 'parent' | 'tutor';
  status: 'active' | 'suspended';
  tier: string;
  kyc: 'tier0' | 'tier1' | 'tier2' | 'tier3';
  joined_at: string;
};

// ── Sponsors ──────────────────────────────────────────────────────────────────
export type Sponsor = {
  id: string;
  name: string;
  status: 'active' | 'inactive';
  funded_pools: number;
  total_funded_kobo: number;
};

export type SponsorCampaign = {
  id: string;
  sponsor_id: string;
  name: string;
  status: 'live' | 'upcoming' | 'ended';
  pool_id: string | null;
  funded_kobo: number;
  spent_kobo: number;
  attribution_code: string;
  signups_attributed: number;
};

// ════════════════════════════════════════════════════════════════════════════
// PHASE 2 — Content/CMS · Content production · Bundles · Curriculum (deep) ·
//           EduPay · Notifications. (Additive — Phase 0+1 shapes untouched.)
// ════════════════════════════════════════════════════════════════════════════

// ── Content management (CMS) ──────────────────────────────────────────────────
// RBAC: academy.content. Publish workflow is a forward-only state machine:
// draft → review → approved → live → archived (archive is terminal).
export type ContentStatus = 'draft' | 'review' | 'approved' | 'live' | 'archived';
export type ContentKind = 'lesson' | 'bundle' | 'series_episode';

export type MediaVariant = {
  quality: 'low_data' | 'standard' | 'hd' | 'audio_only';
  size_mb: number;
  ready: boolean;
};

export type ContentItem = {
  id: string;
  title: string;
  kind: ContentKind;
  subject: string;
  class_name: string;
  status: ContentStatus;
  owner: string;
  duration_min: number;
  variants: MediaVariant[];
  localizations: string[];        // language codes available, e.g. ['en','ha','yo']
  version: number;
  updated_at: string;
};

// Allowed publish transitions exposed so the UI can render only valid actions.
export type ContentTransition = 'submit_review' | 'approve' | 'publish' | 'archive' | 'send_back';
export type ContentTransitionInput = { id: string; action: ContentTransition; notes?: string };

export type Localization = {
  id: string;
  content_id: string;
  language: string;               // 'Hausa', 'Yoruba', 'Igbo', 'Pidgin'…
  status: 'missing' | 'in_translation' | 'review' | 'published';
  translator: string | null;
  coverage_pct: number;           // 0..1
  updated_at: string;
};

// ── Content production tracker (Spotlight pipeline) ───────────────────────────
// RBAC: academy.content. Board stages: script → storyboard → shoot → edit → qa → publish.
export type ProductionStage = 'script' | 'storyboard' | 'shoot' | 'edit' | 'qa' | 'publish';

export type ProductionCard = {
  id: string;
  title: string;
  subject: string;
  stage: ProductionStage;
  owner: string;
  sla_due: string;                // ISO date
  blocked: boolean;
  blocked_reason: string | null;
  priority: 'low' | 'normal' | 'high';
  updated_at: string;
};

export type ProductionAdvanceInput = { id: string };
export type ProductionBlockInput = { id: string; blocked: boolean; reason?: string };

// ── Offline bundle builder ────────────────────────────────────────────────────
// RBAC: academy.content. Compose offline-distributable bundles from lessons,
// budget the total size, and map to an access-card plan for agent distribution.
export type OfflineBundle = {
  id: string;
  name: string;
  exam_code: string;
  lesson_ids: string[];
  size_mb: number;
  size_budget_mb: number;
  access_card_plan_id: string | null;
  status: 'draft' | 'packaged' | 'published';
  updated_at: string;
};

export type BundleBuildInput = {
  name: string;
  exam_code: string;
  lesson_ids: string[];
  size_budget_mb: number;
  access_card_plan_id?: string | null;
};

// ── Curriculum (deep) ─────────────────────────────────────────────────────────
// Extends the Phase-1 tree shapes with objectives + exam-relevance alignment.
export type ObjectiveExamRelevance = {
  exam_code: string;              // 'UTME' | 'WASSCE' …
  relevance: 'core' | 'frequent' | 'occasional' | 'rare';
};

export type CurriculumObjective = {
  id: string;
  topic_id: string;
  code: string;                   // e.g. 'PHY.MOT.3'
  statement: string;
  bloom_level: 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';
  exam_relevance: ObjectiveExamRelevance[];
};

export type CurriculumClassInput = { version_id: string; name: string; order: number };
export type CurriculumSubjectInput = { class_id: string; name: string; code: string };
export type CurriculumTopicInput = { subject_id: string; name: string };
export type CurriculumObjectiveInput = {
  topic_id: string;
  code: string;
  statement: string;
  bloom_level: CurriculumObjective['bloom_level'];
};

// ── EduPay / school fees ──────────────────────────────────────────────────────
// RBAC: academy.edupay. Disbursement state machine:
// fee_due → funding → collected → disbursed → reconciled.
export type School = {
  id: string;
  name: string;
  state: string;                  // Nigerian state
  status: 'onboarding' | 'active' | 'suspended';
  students: number;
  bank_account: string;          // masked
  created_at: string;
};

export type SchoolInput = { name: string; state: string; bank_account: string };

export type FeeSchedule = {
  id: string;
  school_id: string;
  term: string;                   // 'First Term 2025/26'
  amount_kobo: number;
  due_date: string;
  status: 'draft' | 'published' | 'closed';
  collected_kobo: number;
};

export type FeeScheduleInput = { school_id: string; term: string; amount_kobo: number; due_date: string };

export type DisbursementStatus = 'fee_due' | 'funding' | 'collected' | 'disbursed' | 'reconciled';

export type Disbursement = {
  id: string;
  school_id: string;
  fee_schedule_id: string;
  amount_kobo: number;
  status: DisbursementStatus;
  reference: string;
  initiated_at: string;
  reconciled_at: string | null;
};

export type DisbursementReconcileInput = { id: string; bank_reference: string };

// Save-for-school pots — parents accumulate toward a school's fees.
export type SchoolPot = {
  id: string;
  school_id: string;
  guardian: string;
  target_kobo: number;
  balance_kobo: number;
  status: 'open' | 'matured' | 'released';
};

export type Scholarship = {
  id: string;
  name: string;
  sponsor: string;
  pool_kobo: number;
  awarded_kobo: number;
  slots: number;
  awarded_slots: number;
  status: 'draft' | 'open' | 'closed';
};

export type ScholarshipInput = { name: string; sponsor: string; pool_kobo: number; slots: number };
export type ScholarshipAwardInput = { scholarship_id: string; learner_id: string; amount_kobo: number };

// ── Notifications & messaging ─────────────────────────────────────────────────
// RBAC: academy.notifications.
export type NotificationChannel = 'push' | 'sms' | 'in_app' | 'email';

export type NotificationTemplate = {
  id: string;
  name: string;
  channel: NotificationChannel;
  subject: string;                // title / SMS sender / email subject
  body: string;                   // supports {{placeholders}}
  segment: string;                // 'all_learners' | 'utme_2026' | 'inactive_7d'…
  schedule: 'manual' | 'triggered' | 'scheduled';
  status: 'draft' | 'active' | 'archived';
  updated_at: string;
};

export type NotificationTemplateInput = {
  name: string;
  channel: NotificationChannel;
  subject: string;
  body: string;
  segment: string;
  schedule: NotificationTemplate['schedule'];
};

// ════════════════════════════════════════════════════════════════════════════
// PHASE 3 — Trust, learning-ops & support (admin-console.md §7)
//   · Credential & earning bridge  (RBAC academy.credentials)
//   · Live & events management     (RBAC academy.live)
//   · Moderation & trust/safety    (RBAC academy.moderation)
// (Additive — Phase 0/1/2 shapes untouched.)
// ════════════════════════════════════════════════════════════════════════════

// ── Credential & earning bridge ───────────────────────────────────────────────
// RBAC: academy.credentials. Certificate templates → issuance → verification
// registry → revocation. A "trade track" credential maps to a Paymax earning
// role + eligibility rule; learners apply and are routed once eligible.
export type CredentialTemplate = {
  id: string;
  name: string;                   // 'WASSCE Science Certificate'
  track: 'academic' | 'trade' | 'professional';
  issuer: string;                 // 'Spotlight Academy'
  validity_months: number | null; // null = lifetime
  signature_authority: string;    // signing officer / body
  status: 'draft' | 'active' | 'retired';
  issued_count: number;
  updated_at: string;
};

export type CredentialTemplateInput = {
  name: string;
  track: CredentialTemplate['track'];
  issuer: string;
  validity_months?: number | null;
  signature_authority: string;
};

export type IssuedCredential = {
  id: string;
  template_id: string;
  template_name: string;
  learner_id: string;
  learner_name: string;
  serial: string;                 // verification serial / certificate no.
  issued_at: string;
  expires_at: string | null;
  status: 'issued' | 'revoked' | 'expired';
  revoke_reason: string | null;
};

export type CredentialRevokeInput = { id: string; reason: string };

// Verification registry lookup result (by serial or learner id).
export type CredentialVerification = {
  found: boolean;
  serial: string;
  credential: IssuedCredential | null;
  verified_at: string;
};

// Earning opportunity — a trade credential unlocks a Paymax earning role.
export type EarningOpportunity = {
  id: string;
  title: string;                  // 'Solar Installer (Paymax Field Agent)'
  trade_track: string;           // credential track / template name it requires
  paymax_role: string;           // role granted on eligibility, e.g. 'field_agent'
  eligibility_rule: string;      // human-readable rule, e.g. 'active credential + Tier-2 KYC'
  min_credential_status: 'issued' | 'active';
  status: 'open' | 'paused' | 'closed';
  applicants: number;
  routed: number;
  updated_at: string;
};

export type EarningOpportunityInput = {
  title: string;
  trade_track: string;
  paymax_role: string;
  eligibility_rule: string;
  min_credential_status?: EarningOpportunity['min_credential_status'];
};

export type EarningApplication = {
  id: string;
  opportunity_id: string;
  opportunity_title: string;
  learner_id: string;
  learner_name: string;
  credential_serial: string | null;
  status: 'submitted' | 'eligible' | 'routed' | 'rejected';
  submitted_at: string;
};

// ── Live & events management ──────────────────────────────────────────────────
// RBAC: academy.live. Schedule live sessions, configure streaming, manage replays.
export type LiveSession = {
  id: string;
  title: string;
  subject: string;
  host: string;
  status: 'scheduled' | 'live' | 'ended' | 'cancelled';
  starts_at: string;
  duration_min: number;
  registered: number;
  peak_viewers: number | null;
  stream_provider: 'hls' | 'webrtc' | 'rtmp';
  ingest_url: string;             // masked / display
  replay_status: 'none' | 'processing' | 'ready';
  replay_id: string | null;
};

export type LiveSessionInput = {
  title: string;
  subject: string;
  host: string;
  starts_at: string;             // ISO datetime
  duration_min: number;
  stream_provider: LiveSession['stream_provider'];
};

export type LiveReplay = {
  id: string;
  session_id: string;
  title: string;
  status: 'processing' | 'ready' | 'failed';
  duration_min: number;
  size_mb: number;
  views: number;
  published: boolean;
  created_at: string;
};

// ── Moderation & trust/safety ─────────────────────────────────────────────────
// RBAC: academy.moderation. Reports queue with triage + decision; child-safety
// controls; escalation.
export type ReportEntityType = 'content' | 'comment' | 'profile' | 'live_chat' | 'question';
export type ReportState = 'open' | 'triaged' | 'actioned' | 'dismissed' | 'escalated';
export type ModerationDecision = 'hide' | 'warn' | 'ban' | 'dismiss';

export type ModerationReport = {
  id: string;
  entity_type: ReportEntityType;
  entity_ref: string;             // id of the reported object
  entity_label: string;          // human-readable subject
  reason: string;                 // 'hate_speech' | 'csae' | 'spam' …
  reporter_id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  child_safety: boolean;         // flagged as a minor-safety concern
  state: ReportState;
  decision: ModerationDecision | null;
  assignee: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// Triage = take ownership / mark reviewed; Decide = apply a moderation decision.
export type ModerationTriageInput = { id: string; assignee?: string };
export type ModerationDecisionInput = { id: string; decision: ModerationDecision; notes?: string };
export type ModerationEscalateInput = { id: string; reason: string };

// ════════════════════════════════════════════════════════════════════════════
// PHASE 4 — Partnerships, marketplace ops & BI depth (admin-console.md §6/§7)
//   · School & institution mgmt    (RBAC academy.schools)
//   · Tutor & marketplace ops      (RBAC academy.tutor)
//   · Analytics & BI depth         (RBAC academy.analyst)
// (Additive — Phase 0/1/2/3 shapes untouched.)
// ════════════════════════════════════════════════════════════════════════════

// ── School & institution management (B2B2C) ───────────────────────────────────
// RBAC: academy.schools. Institutions onboard, take seat-based licences, organise
// learners into class groups, bulk-enrol (seat-capped), configure white-label, and
// are billed per usage. Licence state machine: trial → active → suspended (and back).
export type LicenceStatus = 'trial' | 'active' | 'suspended' | 'expired';

export type Institution = {
  id: string;
  name: string;
  type: 'school' | 'college' | 'ngo' | 'corporate';
  state: string;                  // Nigerian state
  contact_name: string;
  contact_email: string;
  status: 'onboarding' | 'active' | 'suspended';
  learners: number;
  class_groups: number;
  created_at: string;
};

export type InstitutionInput = {
  name: string;
  type: Institution['type'];
  state: string;
  contact_name: string;
  contact_email: string;
};

export type Licence = {
  id: string;
  institution_id: string;
  plan_id: string;                // references a commerce Plan
  plan_name: string;
  seats_total: number;
  seats_used: number;
  status: LicenceStatus;
  starts_on: string;              // ISO date
  expires_on: string;             // ISO date
  price_per_seat_kobo: number;
  created_at: string;
};

export type LicenceIssueInput = {
  institution_id: string;
  plan_id: string;
  seats_total: number;
  price_per_seat_kobo: number;
  expires_on: string;
};

// action: suspend | reactivate | set_seats (set_seats requires seats_total)
export type LicenceManageInput = {
  id: string;
  action: 'suspend' | 'reactivate' | 'set_seats';
  seats_total?: number;
};

export type ClassGroup = {
  id: string;
  institution_id: string;
  name: string;                   // 'JSS 1 — Gold'
  teacher: string;
  learners: number;
  exam_focus: string;             // 'BECE' | 'WASSCE' …
  created_at: string;
};

export type ClassGroupInput = {
  institution_id: string;
  name: string;
  teacher: string;
  exam_focus: string;
};

// Bulk enrolment is seat-capped: requested learner ids beyond available seats are
// rejected. Result reports enrolled vs rejected with a reason.
export type BulkEnrolInput = {
  institution_id: string;
  licence_id: string;
  learner_ids: string[];
};

export type BulkEnrolResult = {
  institution_id: string;
  licence_id: string;
  requested: number;
  enrolled: number;
  rejected: number;
  seats_remaining: number;
  rejected_ids: string[];
  reason: string | null;          // why rejected (e.g. 'seat cap reached')
};

export type WhiteLabelConfig = {
  institution_id: string;
  subdomain: string;              // 'brightstars.spotlight.academy'
  brand_name: string;
  primary_color: string;          // hex
  logo_url: string;
  custom_domain: string | null;
  support_email: string;
  hide_spotlight_branding: boolean;
  updated_at: string;
};

export type WhiteLabelConfigInput = {
  institution_id: string;
  subdomain?: string;
  brand_name?: string;
  primary_color?: string;
  logo_url?: string;
  custom_domain?: string | null;
  support_email?: string;
  hide_spotlight_branding?: boolean;
};

export type Invoice = {
  id: string;
  institution_id: string;
  period: string;                 // 'May 2026'
  seats_billed: number;
  amount_kobo: number;
  status: 'draft' | 'issued' | 'paid' | 'overdue' | 'void';
  issued_on: string | null;
  due_on: string;
  paid_on: string | null;
};

// Generate a usage invoice from a licence's billed seats for a period.
export type InvoiceGenerateInput = {
  institution_id: string;
  licence_id: string;
  period: string;
};

export type InvoiceChargeInput = { id: string };

export type SchoolsOverview = {
  institutions_total: number;
  institutions_active: number;
  seats_sold: number;
  seats_used: number;
  learners_total: number;
  mrr_kobo: number;               // monthly recurring revenue from licences
  outstanding_kobo: number;       // unpaid invoices
};

// ── Tutor & marketplace ops ───────────────────────────────────────────────────
// RBAC: academy.tutor. Tutor vetting (verify/suspend) with KYC state, payouts and
// ratings/disputes. Vetting state machine: applied → in_review → verified | rejected;
// verified ↔ suspended.
export type TutorVetting = 'applied' | 'in_review' | 'verified' | 'suspended' | 'rejected';
export type TutorKyc = 'tier0' | 'tier1' | 'tier2' | 'tier3';

export type Tutor = {
  id: string;
  display_name: string;
  email: string;
  subjects: string[];
  vetting: TutorVetting;
  kyc: TutorKyc;
  rating_avg: number;             // 0..5
  ratings_count: number;
  sessions_delivered: number;
  open_disputes: number;
  joined_at: string;
  updated_at: string;
};

// action: verify | suspend | reactivate | reject
export type TutorVetInput = {
  id: string;
  action: 'verify' | 'suspend' | 'reactivate' | 'reject';
  notes?: string;
};

export type TutorPayout = {
  id: string;
  tutor_id: string;
  tutor_name: string;
  amount_kobo: number;
  period: string;                 // 'May 2026'
  status: 'requested' | 'processing' | 'paid' | 'failed';
  bank_account: string;          // masked
  requested_at: string;
  settled_at: string | null;
  failure_reason: string | null;
};

export type TutorDispute = {
  id: string;
  tutor_id: string;
  tutor_name: string;
  learner_name: string;
  reason: string;                 // 'no_show' | 'quality' | 'billing' …
  detail: string;
  status: 'open' | 'investigating' | 'resolved' | 'dismissed';
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type TutorDisputeNoteInput = {
  id: string;
  status?: TutorDispute['status'];
  note: string;
};

// ── Analytics & BI depth ──────────────────────────────────────────────────────
// RBAC: academy.analyst (or academy.admin). Aggregate dashboards across outcome,
// engagement, retention, funnel, revenue and exam; cohort analysis; CSV export.
export type BiSeriesPoint = { label: string; value: number };

export type BiDashboard = {
  range: { from: string; to: string };
  kpis: {
    active_learners: number;
    new_signups: number;
    pass_rate: number;            // 0..1 outcome
    d30_retention: number;        // 0..1
    revenue_kobo: number;
    avg_readiness: number;        // 0..1 exam
  };
  outcome: BiSeriesPoint[];       // pass-rate by subject
  engagement: BiSeriesPoint[];    // active learners by day (or week)
  retention: BiSeriesPoint[];     // retention by cohort-age bucket (D1, D7, D30 …)
  funnel: BiSeriesPoint[];        // signup → activation → paid → exam-ready
  revenue: BiSeriesPoint[];       // revenue (kobo) by channel/stream
  exam: BiSeriesPoint[];          // readiness by exam code
};

export type BiCohortRow = {
  cohort: string;                 // 'Jan 2026 signups'
  size: number;
  retention: number[];           // [D1, D7, D30, D60, D90] each 0..1
};

export type BiDateRange = { from: string; to: string };

export type BiExportInput = {
  dataset: 'outcome' | 'engagement' | 'retention' | 'funnel' | 'revenue' | 'exam' | 'cohort';
  from: string;
  to: string;
};

export type BiExportResult = {
  dataset: BiExportInput['dataset'];
  filename: string;
  csv: string;
  rows: number;
};
