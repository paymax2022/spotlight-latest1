// ── Spotlight Academy — Domain types (Phase 0 + Phase 1) ─────────────────────
// Source of truth for the data layer the screens code against. Mirrors the
// /api/finance/academy contract. Money is always integers in minor units (kobo).
// Reward points are plain non-monetary integers (never spendable as cash).

// ── Identity & roles ─────────────────────────────────────────────────────────
export type AcademyRole = 'learner' | 'parent' | 'tutor' | 'kid';

export type KycTier = 'tier0' | 'tier1' | 'tier2';

export interface AcademyProfile {
  id: string;
  displayName: string;
  role: AcademyRole;
  /** ISO date of birth — drives minor classification + KYC tier. */
  dob?: string;
  isMinor: boolean;
  kycTier: KycTier;
  /** Selected class e.g. "SSS2". Empty until onboarding A9 completes. */
  classCode?: string;
  curriculumVersion?: string;
  stream?: 'science' | 'humanities' | 'commercial';
  /** Guardian-consent state — gates purchase/redeem/community for minors. */
  guardianConsent: GuardianConsentState;
  /** Linked guardian (for a minor) or linked children (for a parent). */
  guardianId?: string;
  childIds?: string[];
  onboardingComplete: boolean;
}

export type GuardianConsentState = 'not_required' | 'pending' | 'granted';

// ── Curriculum tree ──────────────────────────────────────────────────────────
export interface CurriculumVersion {
  id: string;
  label: string;       // e.g. "NERDC 2024 (new 12-subject)"
  effectiveYear: number;
  isLegacy: boolean;
}

export interface AcademyClass {
  id: string;
  code: string;        // "SSS2"
  label: string;       // "Senior Secondary 2"
  band: 'primary' | 'jss' | 'sss';
  curriculumVersionId: string;
}

export interface Subject {
  id: string;
  classCode: string;
  name: string;
  icon: string;        // lucide name
  colorKey: string;
  topicCount: number;
  masteredTopics: number;
  /** 0–100 derived progress for the subject ring (L3). */
  progressPct: number;
  examRelevance: ExamSlug[];
}

export interface Topic {
  id: string;
  subjectId: string;
  name: string;
  order: number;
  mastery: MasteryState;
  locked: boolean;
  examRelevant: boolean;
  objectiveCount: number;
  lessonCount: number;
}

export interface Objective {
  id: string;
  topicId: string;
  statement: string;     // "Solve simultaneous linear equations"
  mastery: MasteryState;
  masteryPct: number;    // 0–100
}

export type MasteryState = 'not_started' | 'learning' | 'proficient' | 'mastered';

// ── Lessons (L6 player) ──────────────────────────────────────────────────────
export interface Lesson {
  id: string;
  topicId: string;
  title: string;
  durationSec: number;
  /** Low-data variants surfaced in the player (L6). */
  hasCaptions: boolean;
  hasAudioOnly: boolean;
  /** kB budget for the standard variant — surfaced before download. */
  dataBudgetKb: number;
  /** Already in the offline library (L17 concept). */
  downloaded: boolean;
  transcript: string;
}

// ── Assessment (practice + mastery) ──────────────────────────────────────────
export type QuestionType = 'mcq' | 'multi' | 'true_false';

export interface Question {
  id: string;
  objectiveId?: string;
  subjectId?: string;
  type: QuestionType;
  stem: string;
  options: { id: string; text: string }[];
  /** Option id(s) that are correct. */
  correct: string[];
  hint?: string;
  explanation: string;
  /** Year/source tag for past-question provenance. */
  source?: string;
}

export interface PracticeSubmission {
  objectiveId?: string;
  answers: { questionId: string; selected: string[] }[];
}

export interface PracticeResult {
  total: number;
  correct: number;
  scorePct: number;
  masteryGained: boolean;
  newMastery: MasteryState;
  /** Per-question correctness + explanation for the results screen (L13). */
  breakdown: {
    questionId: string;
    stem: string;
    correct: boolean;
    selected: string[];
    correctAnswers: string[];
    explanation: string;
  }[];
  /** Reward points awarded for this set (queued offline). */
  pointsEarned: number;
}

export interface MasterySnapshot {
  objectiveId: string;
  topicId: string;
  subjectId: string;
  statement: string;
  state: MasteryState;
  pct: number;
}

// ── Exam arenas (the Crown) ──────────────────────────────────────────────────
export type ExamSlug = 'utme' | 'bece' | 'wassce' | 'neco' | 'cce' | 'nabteb';

export interface ExamArena {
  id: string;
  slug: ExamSlug;
  name: string;
  /** ISO date of the next official sitting — drives countdown (X2). */
  nextSittingDate: string;
  /** 0–100 readiness score. */
  readinessPct: number;
  syllabusCoveragePct: number;
  subjectsRequired: number;
  isCbt: boolean;
  description: string;
}

export interface ExamBlueprint {
  id: string;
  arenaId: string;
  label: string;            // "Full Mock — 4 subjects"
  subjects: { subjectId: string; subjectName: string; questionCount: number }[];
  durationMin: number;
  totalQuestions: number;
  calculatorAllowed: boolean;
  /** Bundled item count available offline for this blueprint. */
  offlineItemCount: number;
}

export type ExamAttemptStatus = 'in_progress' | 'paused' | 'submitted';

export interface ExamAttempt {
  id: string;
  arenaId: string;
  blueprintId: string;
  status: ExamAttemptStatus;
  startedAt: string;
  /** Client-side remaining seconds (advisory; server is authoritative). */
  remainingSec: number;
  durationSec: number;
  questions: Question[];
  /** questionId → selected option id(s). */
  answers: Record<string, string[]>;
  /** questionId set flagged for review. */
  flagged: string[];
  calculatorAllowed: boolean;
  /** True if this attempt is being run from a downloaded offline bundle. */
  offlineOrigin: boolean;
}

export interface ExamResult {
  attemptId: string;
  scorePct: number;
  totalQuestions: number;
  correct: number;
  unanswered: number;
  timeSpentSec: number;
  /** Per-subject breakdown for X9. */
  subjects: { subjectId: string; subjectName: string; correct: number; total: number; scorePct: number }[];
  readinessDelta: number;
  pointsEarned: number;
}

export interface UtmeCombination {
  course: string;
  institution?: string;
  subjects: string[];
  note: string;
}

// ── Gamification ─────────────────────────────────────────────────────────────
export interface GamificationProfile {
  level: number;
  xp: number;
  xpToNext: number;
  streakDays: number;
  freezeTokens: number;
  rank?: number;
}

export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  earned: boolean;
  earnedAt?: string;
}

export interface Challenge {
  id: string;
  title: string;
  description: string;
  cadence: 'daily' | 'weekly' | 'sponsor';
  progress: number;
  target: number;
  rewardPoints: number;
  sponsor?: string;
  completed: boolean;
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  xp: number;
  isMe: boolean;
}

// ── Rewards (learn-to-earn) ──────────────────────────────────────────────────
export interface RewardBalance {
  /** Non-monetary reward points. */
  points: number;
  /** Pending points queued offline awaiting sync. */
  pendingPoints: number;
  lifetimeEarned: number;
}

export interface RewardLedgerEntry {
  id: string;
  ts: string;
  kind: 'earn' | 'redeem';
  reason: string;
  points: number;          // positive earn / negative redeem
  synced: boolean;
}

export interface RewardCatalogItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** Points cost to redeem. */
  pointsCost: number;
  /** If redeeming credits wallet, value in kobo. */
  walletValueKobo?: number;
  category: 'airtime' | 'data' | 'voucher' | 'wallet' | 'exam';
}

// ── Commerce (plans, bundles, store) ─────────────────────────────────────────
export interface Plan {
  id: string;
  name: string;
  tagline: string;
  priceKobo: number;       // monthly, kobo
  period: 'monthly' | 'termly';
  features: string[];
  recommended?: boolean;
}

export interface Bundle {
  id: string;
  examSlug: ExamSlug;
  name: string;
  description: string;
  priceKobo: number;
  bnplEligible: boolean;
  itemCount: number;
  dataBudgetMb: number;
  icon: string;
}

export interface BundleManifestItem {
  id: string;
  type: 'lesson' | 'mock' | 'past_questions' | 'drill';
  title: string;
  sizeKb: number;
}

export type OrderStatus = 'pending' | 'paid' | 'bnpl' | 'failed' | 'fulfilled';

export interface Order {
  id: string;
  bundleId?: string;
  planId?: string;
  amountKobo: number;
  status: OrderStatus;
  createdAt: string;
  /** Set when fulfilled via BNPL. */
  bnplInstalments?: number;
}

export interface AccessCardResult {
  cardCode: string;
  unlocked: { kind: 'bundle' | 'plan' | 'data'; label: string }[];
  valueKobo: number;
}

// ── Wallet ───────────────────────────────────────────────────────────────────
export interface AcademyWallet {
  /** Spendable cash balance, kobo. */
  spendableKobo: number;
  /** Reward points (non-monetary). */
  rewardPoints: number;
  /** Mini-statement rows. */
  recent: { id: string; ts: string; label: string; amountKobo?: number; points?: number; kind: 'credit' | 'debit' | 'reward' }[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2 — Progression, Parent/Guardian, EduPay
// New domain types for the Phase-2 backend endpoints. Mock-first like Phase 1;
// money stays in kobo, reward points stay plain integers. Child-safety: parent
// actions require an active guardian link (asserted in the data layer).
// ═══════════════════════════════════════════════════════════════════════════════

// ── Progression (adaptive learning paths) ────────────────────────────────────
export type PathStepStatus = 'locked' | 'available' | 'in_progress' | 'mastered';

export interface LearningStep {
  objectiveId: string;
  topicId: string;
  subjectId: string;
  title: string;
  /** Short "why this next" rationale surfaced on the path map. */
  rationale: string;
  status: PathStepStatus;
  masteryPct: number;        // 0–100
  estMinutes: number;
}

export interface LearningPath {
  id: string;
  subjectId: string;
  subjectName: string;
  /** Ordered steps; the next actionable one is the first non-mastered/unlocked. */
  steps: LearningStep[];
  /** 0–100 overall completion of the path. */
  progressPct: number;
  generatedAt: string;
}

export interface AdaptiveSet {
  id: string;
  /** Weak objectives this set targets (drives remediation copy). */
  targetObjectiveIds: string[];
  reason: string;
  questions: Question[];
}

export interface Recommendation {
  id: string;
  kind: 'lesson' | 'practice' | 'adaptive' | 'mock' | 'review';
  title: string;
  reason: string;
  /** Deep-link target within the academy stack. */
  href: string;
  subjectId?: string;
  objectiveId?: string;
  icon: string;              // lucide name
}

// ── Parent / Guardian ────────────────────────────────────────────────────────
export interface ChildSummary {
  minorId: string;
  displayName: string;
  classCode: string;
  avatarColorKey: string;
  /** Active guardian link — gates all parent actions (child-safety, fail-closed). */
  linked: boolean;
  guardianConsent: GuardianConsentState;
  streakDays: number;
  /** Minutes studied today vs the screen-time cap (P5). */
  minutesToday: number;
  dailyCapMinutes: number;
  readinessPct: number;
  /** Count of unread alerts about this child. */
  alertCount: number;
}

export interface ChildDashboard {
  minorId: string;
  displayName: string;
  classCode: string;
  streakDays: number;
  weeklyMinutes: number;
  weeklyGoalMinutes: number;
  masteredObjectives: number;
  totalObjectives: number;
  readinessPct: number;
  subjects: { subjectId: string; name: string; progressPct: number; masteredTopics: number; topicCount: number }[];
  alerts: ChildAlert[];
}

export interface ChildAlert {
  id: string;
  kind: 'streak_risk' | 'low_mastery' | 'screen_time' | 'purchase_request' | 'achievement';
  message: string;
  ts: string;
  read: boolean;
}

export interface ChildSubjectDetail {
  minorId: string;
  subjectId: string;
  subjectName: string;
  progressPct: number;
  topics: { topicId: string; name: string; mastery: MasteryState; masteryPct: number }[];
  /** Recent activity rows for the subject. */
  recent: { id: string; ts: string; label: string; scorePct?: number }[];
}

export interface UsageControls {
  /** Daily screen-time cap in minutes (0 = unlimited). */
  dailyCapMinutes: number;
  /** 24h window the child may study within, e.g. "06:00"–"21:00". */
  allowedFrom: string;
  allowedTo: string;
  /** Age-appropriate content filter. */
  contentFilter: 'all_ages' | 'teen' | 'unrestricted';
  /** Block in-app purchases without parent approval (P7). */
  requirePurchaseApproval: boolean;
  /** Pause all access (e.g. exams over). */
  paused: boolean;
}

export interface ProgressReport {
  id: string;
  minorId: string;
  childName: string;
  period: 'weekly' | 'termly';
  periodLabel: string;       // "Week of 23 Jun" / "First Term 2025/26"
  generatedAt: string;
  minutesStudied: number;
  lessonsCompleted: number;
  masteryGained: number;
  readinessPct: number;
  highlights: string[];
  /** Mock "download" target — a data URI / path in real impl. */
  shareUrl: string;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface PurchaseApproval {
  id: string;
  minorId: string;
  childName: string;
  /** What the child wants to buy/redeem. */
  itemLabel: string;
  kind: 'bundle' | 'plan' | 'reward_redeem';
  amountKobo?: number;
  pointsCost?: number;
  requestedAt: string;
  status: ApprovalStatus;
}

// ── EduPay (school fees + save-for-school) ───────────────────────────────────
export interface School {
  id: string;
  name: string;
  lga: string;               // local government area
  state: string;
  logoColorKey: string;
  /** True once linked to this guardian (P8). */
  linked: boolean;
  verified: boolean;
}

export interface FeeSchedule {
  id: string;
  schoolId: string;
  schoolName: string;
  term: string;              // "First Term 2025/26"
  classCode: string;
  /** Line items (tuition, levies). */
  items: { id: string; label: string; amountKobo: number }[];
  totalKobo: number;
  dueDate: string;
  bnplEligible: boolean;
  /** True once a child is linked to this fee schedule (P9). */
  linked: boolean;
}

export type EduPayPaymentStatus = 'paid' | 'bnpl' | 'pending' | 'failed';

export interface EduPayPayment {
  id: string;
  feeScheduleId: string;
  schoolName: string;
  term: string;
  amountKobo: number;
  status: EduPayPaymentStatus;
  method: 'wallet' | 'bnpl';
  bnplInstalments?: number;
  paidAt: string;
  receiptUrl: string;
}

export interface EduPayProfile {
  /** Schools the guardian has linked (P8). */
  linkedSchoolIds: string[];
  /** Fee schedules linked to children. */
  linkedFeeScheduleIds: string[];
  payments: EduPayPayment[];
}

export interface SavingsPot {
  id: string;
  name: string;
  /** Target amount in kobo (e.g. next term's fees). */
  targetKobo: number;
  savedKobo: number;
  /** Linked fee schedule the pot is earmarked for (optional). */
  feeScheduleId?: string;
  schoolName?: string;
  createdAt: string;
  /** Auto-save cadence label, advisory. */
  cadence: 'manual' | 'weekly' | 'monthly';
}

// ── Scholarships (P11) ───────────────────────────────────────────────────────
export interface Scholarship {
  id: string;
  title: string;
  sponsor: string;
  /** Coverage in kobo (full or partial). */
  amountKobo: number;
  coverage: 'full' | 'partial';
  eligibility: string;
  deadline: string;
  applied: boolean;
  icon: string;
}

// ── Billing & subscriptions (P12) ────────────────────────────────────────────
export interface Subscription {
  id: string;
  planName: string;
  status: 'active' | 'past_due' | 'cancelled';
  priceKobo: number;
  period: 'monthly' | 'termly';
  renewsAt: string;
  /** Which child(ren) the seat covers. */
  childNames: string[];
}

export interface Invoice {
  id: string;
  label: string;
  amountKobo: number;
  status: 'paid' | 'due' | 'failed';
  ts: string;
  receiptUrl: string;
}

// ── Offline downloads library (L17) ──────────────────────────────────────────
export type DownloadStatus = 'downloaded' | 'downloading' | 'queued' | 'failed' | 'not_downloaded';

export interface DownloadedBundle {
  id: string;
  name: string;
  examSlug: ExamSlug;
  itemCount: number;
  sizeMb: number;
  status: DownloadStatus;
  /** 0–100 download progress when status==='downloading'. */
  progressPct: number;
  /** Whether the local copy is the latest server version. */
  syncState: 'synced' | 'update_available' | 'pending_sync';
  downloadedAt?: string;
}

export interface StorageInfo {
  usedMb: number;
  budgetMb: number;
  bundleCount: number;
}

// ── Bookmarks & notes (L15/L16) ──────────────────────────────────────────────
export interface Bookmark {
  id: string;
  kind: 'lesson' | 'topic' | 'past_question';
  title: string;
  subjectName: string;
  href: string;
  ts: string;
}

export interface LessonNote {
  id: string;
  lessonId: string;
  lessonTitle: string;
  subjectName: string;
  body: string;
  ts: string;
}

// ── Search (L14) ─────────────────────────────────────────────────────────────
export interface SearchResult {
  id: string;
  kind: 'lesson' | 'topic' | 'subject' | 'past_question';
  title: string;
  subtitle: string;
  href: string;
  icon: string;
}

// ── Daily goal & streak (L2) ─────────────────────────────────────────────────
export interface StreakDay {
  date: string;              // ISO date (day granularity)
  state: 'studied' | 'frozen' | 'missed' | 'today' | 'future';
}

export interface DailyGoal {
  goalMinutes: number;
  doneMinutes: number;
  streakDays: number;
  freezeTokens: number;
  /** ~5 weeks of calendar cells for the streak grid. */
  calendar: StreakDay[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 3 — Trade & Skills (the Moat) + Live/Community + Credentials
// Mock-first like Phases 1–2. Money stays in kobo. Child-safety: community is
// group/Q&A only — NO 1:1 DMs for minors (asserted in the data layer).
// ═══════════════════════════════════════════════════════════════════════════════

// ── Trade & Skills tracks (S1–S4) ────────────────────────────────────────────
/** Paymax-relevant vocational trades surfaced as the moat. */
export type TradeSlug = 'solar' | 'fashion' | 'gsm' | 'agric' | 'beauty' | 'catering' | 'auto';

export interface TradeTrack {
  id: string;
  slug: TradeSlug;
  name: string;            // "Solar installation"
  tagline: string;
  icon: string;            // lucide name
  colorKey: string;        // AcademyColors / iconBg key concept
  /** 0–100 overall completion of the chosen track. */
  progressPct: number;
  moduleCount: number;
  completedModules: number;
  /** True once the learner has chosen this trade (A11). */
  chosen: boolean;
  /** Earning roles this credential can unlock once assessed (S6 bridge). */
  unlocksRoles: PaymaxRole[];
}

export type TradeModuleKind = 'practical' | 'project' | 'theory' | 'assessment';

export interface TradeModule {
  id: string;
  trackId: string;
  title: string;
  kind: TradeModuleKind;
  order: number;
  estMinutes: number;
  /** Mastery-style status for the module row. */
  status: 'locked' | 'available' | 'in_progress' | 'completed';
  /** Short practical outcome statement. */
  outcome: string;
  /** Linked project (for kind==='project') or assessment (kind==='assessment'). */
  projectId?: string;
  assessmentId?: string;
}

export interface TradeHub {
  track: TradeTrack;
  modules: TradeModule[];
  /** Open/started project submissions for the portfolio strip (S3). */
  projects: TradeProject[];
  /** Whether a credential has already been earned for this track. */
  credentialEarned: boolean;
}

// ── Project / portfolio submission (S3) ──────────────────────────────────────
export type ProjectSubmissionStatus = 'not_started' | 'submitted' | 'graded' | 'needs_rework';

export interface RubricCriterion {
  id: string;
  label: string;          // "Wiring safety"
  maxPoints: number;
  /** Awarded points once graded (S3 result). */
  awardedPoints?: number;
  note?: string;
}

export interface TradeProject {
  id: string;
  moduleId: string;
  trackId: string;
  title: string;
  brief: string;
  rubric: RubricCriterion[];
  status: ProjectSubmissionStatus;
  /** Mock "uploaded" artefact references (URIs/paths in real impl). */
  attachments: { id: string; name: string; kind: 'photo' | 'video' | 'doc' }[];
  submittedAt?: string;
  scorePct?: number;
  feedback?: string;
}

// ── Skill assessment (S4 → credential) ───────────────────────────────────────
export interface SkillAssessment {
  id: string;
  trackId: string;
  title: string;
  /** Practical/scenario items — reuses the Question shape from Phase 1. */
  questions: Question[];
  passMark: number;        // 0–100
  durationMin: number;
  /** True once passed; gates credential issuance (S5). */
  passed: boolean;
}

export interface AssessmentResult {
  assessmentId: string;
  scorePct: number;
  passed: boolean;
  passMark: number;
  /** Credential minted on pass (S5/G11). */
  credentialId?: string;
  pointsEarned: number;
}

// ── Credentials / verifiable certificates (S5, G10, G11) ─────────────────────
export type CredentialKind = 'academic' | 'trade';

export interface Credential {
  id: string;
  kind: CredentialKind;
  title: string;          // "Solar Installation — Level 1"
  /** Issuing body label (Spotlight Academy / partner). */
  issuer: string;
  recipientName: string;
  issuedAt: string;
  /** Stable public verification id used by GET /credentials/verify/:id. */
  verificationId: string;
  /** Deep-link/URL a verifier scans (encoded into the QR). */
  verifyUrl: string;
  /** Roles this credential unlocks in the Paymax super app (S6). */
  unlocksRoles: PaymaxRole[];
  /** Optional skill grade. */
  scorePct?: number;
  /** Tied trade track (for trade credentials). */
  trackSlug?: TradeSlug;
}

/** Public verification payload (no PII beyond the displayed name). */
export interface CredentialVerification {
  verificationId: string;
  valid: boolean;
  title: string;
  issuer: string;
  recipientName: string;
  issuedAt: string;
  kind: CredentialKind;
  scorePct?: number;
  /** Server-stamped check time. */
  verifiedAt: string;
}

// ── Earning opportunities (S6/S7 — the Paymax bridge) ────────────────────────
/** Roles a learner can unlock in the Paymax super app via credentials. */
export type PaymaxRole = 'driver' | 'agent' | 'creator' | 'merchant' | 'service';

export type EligibilityState = 'eligible' | 'needs_credential' | 'needs_kyc' | 'locked';

export interface EarningOpportunity {
  id: string;
  role: PaymaxRole;
  title: string;          // "Spotlight delivery rider"
  partner: string;
  summary: string;
  icon: string;
  /** Indicative earnings copy, e.g. "₦40k–₦120k / month". */
  earningsLabel: string;
  /** Credential(s) that unlock this role. */
  requiredCredentialKinds: TradeSlug[];
  eligibility: EligibilityState;
  /** What the learner still needs, surfaced on the detail screen (S7). */
  requirements: string[];
  /** True once the learner has applied (routed into Paymax onboarding). */
  applied: boolean;
}

/**
 * Result of POST /earning/apply — this does NOT create the role. It hands off to
 * the existing Paymax role-upgrade / KYC onboarding flow via a deep link.
 */
export interface EarningApplication {
  id: string;
  opportunityId: string;
  role: PaymaxRole;
  status: 'handoff';
  /** Deep-link concept into the existing Paymax onboarding (not rebuilt here). */
  onboardingDeepLink: string;
  /** Next step copy for the learner. */
  nextStep: string;
}

// ── Mentor connect (S8) ──────────────────────────────────────────────────────
export interface Mentor {
  id: string;
  name: string;
  trade: TradeSlug;
  headline: string;       // "12 yrs · Solar & inverters"
  rating: number;         // 0–5
  /** Mentorship is group/cohort-style for safety; no 1:1 DM for minors. */
  groupOnly: boolean;
  avatarColorKey: string;
  /** Whether a match request is already pending/accepted. */
  requestState: 'none' | 'requested' | 'matched';
  bio: string;
}

// ── Live classes (C1–C3) ──────────────────────────────────────────────────────
export type LiveStatus = 'upcoming' | 'live' | 'replay';

export interface LiveSession {
  id: string;
  title: string;
  subjectOrTrade: string;
  host: string;
  status: LiveStatus;
  /** ISO start time. */
  startsAt: string;
  durationMin: number;
  /** Replay playback position 0–100 (status==='replay'). */
  watchedPct?: number;
  /** Live viewer count (status==='live'). */
  viewers?: number;
  /** Moderated — chat is filtered; raise-hand only (no open DMs). */
  moderated: boolean;
}

/** Result of POST /live/sessions/:id/join — a LiveKit room token (placeholder). */
export interface LiveJoinToken {
  sessionId: string;
  roomName: string;
  /** Opaque token the LiveKit client would consume (mock string here). */
  token: string;
  /** Whether the learner may speak or only watch + raise hand. */
  canPublish: boolean;
  /** Moderated room — messages pass a filter; minors cannot DM (group only). */
  moderated: boolean;
}

// ── Community: study groups + discussions (C4, C5) ────────────────────────────
export interface StudyGroup {
  id: string;
  name: string;
  subjectOrTrade: string;
  /** Member count. */
  members: number;
  /** Shared group goal (no personal data). */
  goal: string;
  goalProgressPct: number;
  joined: boolean;
  /** Group/cohort only — child-safety: no 1:1 channels. */
  cohort: boolean;
}

export interface Discussion {
  id: string;
  /** Optional subject/trade scoping. */
  scope: string;
  authorName: string;
  /** Author is an adult tutor/mod or a peer (display only). */
  authorRole: 'tutor' | 'peer' | 'mentor';
  title: string;
  body: string;
  ts: string;
  replyCount: number;
  /** Moderation status surfaced on the thread. */
  moderation: 'clean' | 'pending_review' | 'removed';
  /** True once the current user has reported this item. */
  reported: boolean;
}

export type ReportReason = 'spam' | 'harassment' | 'unsafe' | 'off_topic' | 'other';

export interface ModerationReport {
  id: string;
  targetKind: 'discussion' | 'message' | 'profile';
  targetId: string;
  reason: ReportReason;
  status: 'received';
  ts: string;
}

// ── Notifications & announcements (C6, C7) ────────────────────────────────────
export type NotificationKind =
  | 'lesson' | 'reward' | 'exam_reminder' | 'live' | 'credential' | 'opportunity' | 'parent_msg' | 'community';

export interface AcademyNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  ts: string;
  read: boolean;
  /** Optional deep-link target within the academy stack. */
  href?: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  /** Program update vs sponsor message. */
  kind: 'program' | 'sponsor';
  sponsor?: string;
  ts: string;
  pinned: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 4 — Tutor & School (T1–T8) + ECCE / Little Learners (E1–E3)
// New domain types for the Phase-4 backend endpoints. Mock-first like the earlier
// phases; money stays in kobo, reward points stay plain integers. Tutor verify
// reuses the KYC affordance; tutor payouts reuse the payout-rail concept; ECCE is
// parent-gated (E3) before any settings/purchases.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Tutor identity & verification (T1, T2) ────────────────────────────────────
/** Tutor verification mirrors the KYC tier ladder: unverified → pending → verified. */
export type TutorVerifyState = 'unverified' | 'pending' | 'verified' | 'rejected';

/** Where a tutor wants earnings paid out (reuses the Paymax payout rail concept). */
export interface PayoutMethod {
  id: string;
  kind: 'bank' | 'wallet';
  label: string;            // "GTBank •••• 4471" | "Paymax wallet"
  bankName?: string;
  accountLast4?: string;
  /** Default destination for withdrawals. */
  isDefault: boolean;
}

export interface TutorProfile {
  id: string;
  displayName: string;
  /** Verification state — gates publishing a profile + receiving payouts. */
  verifyState: TutorVerifyState;
  /** KYC tier carried over from the learner identity (verify reuses KYC). */
  kycTier: KycTier;
  bio: string;
  /** Subjects the tutor teaches (subject ids/labels). */
  subjects: string[];
  /** Trades the tutor can mentor (optional). */
  trades: TradeSlug[];
  /** 0–5 aggregate rating. */
  rating: number;
  ratingCount: number;
  /** Learners actively assigned across cohorts. */
  studentCount: number;
  /** Weekly availability slots, free-form labels (e.g. "Mon 4–6pm"). */
  availability: string[];
  /** Hourly rate for paid sessions, kobo. */
  hourlyRateKobo: number;
  /** Payout destinations (T1 setup, T7 withdraw). */
  payoutMethods: PayoutMethod[];
  avatarColorKey: string;
  onboardingComplete: boolean;
}

export interface TutorOnboardInput {
  displayName: string;
  bio: string;
  subjects: string[];
  trades?: TradeSlug[];
  hourlyRateKobo: number;
  availability: string[];
  /** Initial payout destination captured during onboarding. */
  payout?: { kind: 'bank' | 'wallet'; bankName?: string; accountNumber?: string };
}

/** A tutor surfaced in the marketplace (GET /tutors?subject=). */
export interface TutorListing {
  id: string;
  displayName: string;
  headline: string;          // "Maths & Physics · 8 yrs"
  subjects: string[];
  rating: number;
  ratingCount: number;
  hourlyRateKobo: number;
  verifyState: TutorVerifyState;
  avatarColorKey: string;
}

// ── Cohorts & roster (T3) ─────────────────────────────────────────────────────
export interface RosterStudent {
  id: string;
  name: string;
  classCode: string;
  /** Overall progress across assigned work, 0–100. */
  progressPct: number;
  /** Outstanding assignments not yet submitted. */
  pendingCount: number;
  avatarColorKey: string;
}

export interface Cohort {
  id: string;
  name: string;            // "SSS2 Maths — Evening"
  subjectOrTrade: string;
  studentCount: number;
  students: RosterStudent[];
}

// ── Assignments & grading (T4, T5) ────────────────────────────────────────────
export type AssignmentKind = 'lesson' | 'assessment' | 'homework';
export type AssignmentStatus = 'assigned' | 'submitted' | 'graded' | 'overdue';

export interface Assignment {
  id: string;
  cohortId: string;
  cohortName: string;
  kind: AssignmentKind;
  title: string;
  /** Linked lesson/assessment/objective id (display only in mock). */
  refId?: string;
  dueDate: string;
  assignedAt: string;
  /** Counts across the cohort. */
  assignedCount: number;
  submittedCount: number;
  gradedCount: number;
}

export interface CreateAssignmentInput {
  cohortId: string;
  kind: AssignmentKind;
  title: string;
  refId?: string;
  dueDate: string;
}

/** A single learner's submission awaiting review (T5). */
export interface Submission {
  id: string;
  assignmentId: string;
  assignmentTitle: string;
  studentId: string;
  studentName: string;
  submittedAt: string;
  status: AssignmentStatus;
  /** Learner's answer/work preview (text in mock). */
  workPreview: string;
  /** Set once graded. */
  scorePct?: number;
  feedback?: string;
}

export interface GradeInput {
  submissionId: string;
  scorePct: number;
  feedback: string;
}

// ── Earnings & payouts (T7) ───────────────────────────────────────────────────
export type TutorLedgerKind = 'session' | 'assignment_bonus' | 'payout' | 'adjustment';

export interface TutorLedgerEntry {
  id: string;
  ts: string;
  kind: TutorLedgerKind;
  label: string;
  /** Positive = earning credit, negative = payout/withdrawal, kobo. */
  amountKobo: number;
  /** Reconciliation flag — payouts settle T+1 in real life. */
  settled: boolean;
}

export interface TutorEarnings {
  /** Available-to-withdraw balance, kobo. */
  availableKobo: number;
  /** Pending (not yet settled) earnings, kobo. */
  pendingKobo: number;
  /** Lifetime gross earnings, kobo. */
  lifetimeKobo: number;
  /** Minimum withdrawal amount, kobo. */
  minPayoutKobo: number;
  ledger: TutorLedgerEntry[];
}

/** Result of POST /tutor/payouts — a withdrawal request on the payout rail. */
export interface PayoutRequest {
  id: string;
  amountKobo: number;
  method: PayoutMethod;
  status: 'requested' | 'processing' | 'paid' | 'failed';
  requestedAt: string;
  /** Expected settlement copy (T+1). */
  expectedSettlement: string;
}

// ── School admin (lite) (T8) ──────────────────────────────────────────────────
export type LicenceStatus = 'active' | 'expiring' | 'expired';

export interface SchoolClassStat {
  id: string;
  name: string;            // "JSS1 A"
  enrolled: number;
  activePct: number;       // % learners active in last 7d
  avgMasteryPct: number;
}

/** A school the current user administers (member-side admin-lite, T8). */
export interface ManagedSchool {
  id: string;
  name: string;
  lga: string;
  state: string;
  logoColorKey: string;
  role: 'admin' | 'coordinator';
  /** Licence seats. */
  seatsTotal: number;
  seatsUsed: number;
  licenceStatus: LicenceStatus;
  licenceRenewsAt: string;
}

export interface SchoolOverview {
  school: ManagedSchool;
  totalLearners: number;
  activeLearners7d: number;
  avgMasteryPct: number;
  classes: SchoolClassStat[];
  /** Pending bulk-enrol invites not yet accepted. */
  pendingInvites: number;
}

// ── ECCE / Little Learners (E1–E3) ────────────────────────────────────────────
export type EcceActivityKind = 'phonics' | 'numeracy' | 'shapes' | 'colors';

export interface EcceActivity {
  id: string;
  kind: EcceActivityKind;
  title: string;           // "Letter sounds: A, B, C"
  /** Big, friendly emoji/icon key for large-target tiles. */
  emoji: string;
  colorKey: string;
  /** Short audio-led prompt copy (TTS placeholder in mock). */
  prompt: string;
  /** Simple tap-the-answer rounds. */
  rounds: EcceRound[];
  /** Stars earned so far (0–3). */
  stars: number;
}

export interface EcceRound {
  id: string;
  /** Spoken prompt (audio-led). */
  say: string;
  /** Big tappable options. */
  options: { id: string; label: string; emoji: string; correct: boolean }[];
}

export interface EcceHome {
  /** Child display name (no PII beyond first name in mock). */
  childName: string;
  /** Daily play limit reached? (screen-light by design). */
  dailyLimitReached: boolean;
  activities: EcceActivity[];
}
