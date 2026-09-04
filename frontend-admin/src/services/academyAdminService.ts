// ── Admin — Spotlight Academy admin console service ───────────────────────────
// Copies the healthVetVerificationService.ts request stack EXACTLY:
//  • adminBase() rewrites env.apiBaseUrl (…/api/v1) → …/api/academy
//  • authHeaders() attaches the admin Bearer token from localStorage
//  • getJson/sendJson unwrap { data } and throw on non-2xx
// Per-route RBAC (academy.*) is carried by the admin session token. Mock by
// default (NEXT_PUBLIC_ACADEMY_USE_MOCK); flip to false to hit the live Go
// backend. Every state-change is audit-logged server-side.

import { env } from '@/config/env';
import type {
  AcademyDashboard,
  CurriculumTree, CurriculumTopic, CurriculumVersion, CurriculumVersionInput,
  QuestionItem, QuestionItemInput, QuestionReviewInput,
  ExamArena, ExamBlueprint, ExamBlueprintInput, SubjectCombinationRule,
  GamificationConfig,
  RewardPool, RewardPoolInput, RewardFundInput, RewardCatalogItem, RewardLedgerEntry,
  Plan, ExamBundle, AccessCardBatch, AccessCardGenerateInput, AccessCardAllocateInput,
  PaymentsOverview, RefundInput, AcademyUser,
  Sponsor, SponsorCampaign,
  ContentItem, ContentTransitionInput, Localization,
  ProductionCard, ProductionAdvanceInput, ProductionBlockInput, ProductionStage,
  OfflineBundle, BundleBuildInput,
  CurriculumObjective, CurriculumClassInput, CurriculumSubjectInput, CurriculumTopicInput, CurriculumObjectiveInput,
  CurriculumClass, CurriculumSubject,
  School, SchoolInput, FeeSchedule, FeeScheduleInput, Disbursement, DisbursementReconcileInput,
  SchoolPot, Scholarship, ScholarshipInput, ScholarshipAwardInput, DisbursementStatus,
  NotificationTemplate, NotificationTemplateInput,
  CredentialTemplate, CredentialTemplateInput, IssuedCredential, CredentialRevokeInput, CredentialVerification,
  EarningOpportunity, EarningOpportunityInput, EarningApplication,
  LiveSession, LiveSessionInput, LiveReplay,
  ModerationReport, ModerationTriageInput, ModerationDecisionInput, ModerationEscalateInput,
  Institution, InstitutionInput, Licence, LicenceIssueInput, LicenceManageInput,
  ClassGroup, ClassGroupInput, BulkEnrolInput, BulkEnrolResult,
  WhiteLabelConfig, WhiteLabelConfigInput, Invoice, InvoiceGenerateInput, InvoiceChargeInput, SchoolsOverview,
  Tutor, TutorVetInput, TutorPayout, TutorDispute, TutorDisputeNoteInput,
  BiDashboard, BiCohortRow, BiDateRange, BiExportInput, BiExportResult, BiSeriesPoint,
} from '@/types/academyAdmin';

const USE_MOCK = (process.env.NEXT_PUBLIC_ACADEMY_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function adminBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/academy');
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}
const delay = (ms = 220) => new Promise((r) => setTimeout(r, ms));

// Every mutation below falls into one of two buckets, verified against the Go
// route registrations (backend/internal/academy/**/handler.go) and the flag
// gates in backend/internal/app/academy_routes.go (RegisterAcademy):
//  1. A real, RBAC-gated route exists (some behind a module feature flag —
//     spineEnabled/eduPayEnabled/credentialsEnabled/liveEnabled/schoolsEnabled/
//     tutorEnabled/examEnabled — which is normal deployment config, not a gap;
//     if the flag is off, getJson/sendJson's existing res.ok check already
//     surfaces that as a real error rather than a fabricated success).
//  2. No route exists anywhere in the module (several of the file's own
//     "TODO(no backend route)" comments already said so; a few more were
//     found the same way while doing this pass). Those get a distinct
//     message that does NOT claim flipping NEXT_PUBLIC_ACADEMY_USE_MOCK will
//     reach a working endpoint, because it will not.
// Either way, fixture mode must not report a write it did not perform. See
// docs/audit/ADMIN_SIMULATED_WRITES.md.
const NOT_IN_FIXTURE_MODE =
  'is unavailable in fixture mode: this console will not report a write it did not perform. ' +
  'Set NEXT_PUBLIC_ACADEMY_USE_MOCK=false to make this change against the live backend.';
const NO_BACKEND_YET =
  'has no backend yet on the Go service (see the TODO comment on the live-mode call below). ' +
  'This console cannot perform this action until that endpoint is built.';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}
async function sendJson<T>(method: 'POST' | 'PATCH' | 'PUT', path: string, body: unknown): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, { method, headers: authHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}

// ── Mock fixture helpers ──────────────────────────────────────────────────────
const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
const dateStr = (daysFromNow: number) => new Date(Date.now() + daysFromNow * 86_400_000).toISOString().slice(0, 10);
const naira = (n: number) => n * 100; // helper: naira → kobo

function trend(n: number, base: number, jitter: number) {
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(Date.now() - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10),
    value: Math.round(base + Math.sin(i / 2) * jitter + (i % 3) * (jitter / 4)),
  }));
}

// ════════════════════════ EXECUTIVE DASHBOARD ════════════════════════
// RBAC: academy.admin
const DASHBOARD: AcademyDashboard = {
  active_learners: 48230,
  active_learners_30d: 61140,
  mock_attempts_30d: 184500,
  mock_attempts_today: 6210,
  exam_readiness_avg: 0.642,
  reward_spend_30d_kobo: naira(2_340_000),
  reward_pool_balance_kobo: naira(8_910_000),
  revenue_30d_kobo: naira(19_870_000),
  revenue_today_kobo: naira(742_000),
  paying_learners: 12480,
  question_items_total: 41200,
  items_pending_review: 318,
  attempts_trend: trend(14, 5800, 1400),
  activity: [
    { id: 'act_1', label: 'Sponsor pool "MTN STEM Drive" funded ₦5,000,000', kind: 'pool_funded', ref: 'pool_mtn01', created_at: iso(2) },
    { id: 'act_2', label: '120 access cards generated for Lagos agents', kind: 'cards_generated', ref: 'batch_lag_07', created_at: iso(5) },
    { id: 'act_3', label: 'UTME 2026 mock arena opened', kind: 'exam_opened', ref: 'arena_utme26', created_at: iso(9) },
    { id: 'act_4', label: '46 question items approved (Physics SS2)', kind: 'item_approved', ref: 'qb_batch_221', created_at: iso(14) },
    { id: 'act_5', label: 'Airtime reward redeemed by learner', kind: 'reward_redeemed', ref: 'rdm_99812', created_at: iso(20) },
    { id: 'act_6', label: 'New WAEC 2025 plan published', kind: 'plan_published', ref: 'plan_waec25', created_at: iso(28) },
  ],
};

export async function getAcademyDashboard(): Promise<AcademyDashboard> {
  if (USE_MOCK) { await delay(); return JSON.parse(JSON.stringify(DASHBOARD)); }
  // TODO(no backend route): there is no academy admin dashboard/summary endpoint. Mock.
  return getJson<AcademyDashboard>('/admin/dashboard');
}

// ════════════════════════ CURRICULUM ════════════════════════
// RBAC: academy.curriculum — /api/academy/admin/curriculum/*
const CURRICULUM: CurriculumTree = {
  versions: [
    { id: 'cv_2024', name: 'NERDC 2024 (current)', status: 'active', effective_date: '2024-09-01', classes_count: 12, subjects_count: 36 },
    { id: 'cv_2014', name: 'NERDC 2014 (legacy)', status: 'legacy', effective_date: '2014-09-01', classes_count: 12, subjects_count: 30 },
    { id: 'cv_2026', name: 'NERDC 2026 (draft)', status: 'draft', effective_date: '2026-09-01', classes_count: 0, subjects_count: 0 },
  ],
  classes: [
    { id: 'cl_jss1', version_id: 'cv_2024', name: 'JSS 1', order: 1 },
    { id: 'cl_jss2', version_id: 'cv_2024', name: 'JSS 2', order: 2 },
    { id: 'cl_jss3', version_id: 'cv_2024', name: 'JSS 3', order: 3 },
    { id: 'cl_ss1', version_id: 'cv_2024', name: 'SS 1', order: 4 },
    { id: 'cl_ss2', version_id: 'cv_2024', name: 'SS 2', order: 5 },
    { id: 'cl_ss3', version_id: 'cv_2024', name: 'SS 3', order: 6 },
  ],
  subjects: [
    { id: 'sub_math_ss2', class_id: 'cl_ss2', name: 'Mathematics', code: 'MTH', topics_count: 18 },
    { id: 'sub_eng_ss2', class_id: 'cl_ss2', name: 'English Language', code: 'ENG', topics_count: 22 },
    { id: 'sub_phy_ss2', class_id: 'cl_ss2', name: 'Physics', code: 'PHY', topics_count: 15 },
    { id: 'sub_chem_ss2', class_id: 'cl_ss2', name: 'Chemistry', code: 'CHM', topics_count: 16 },
    { id: 'sub_bio_ss1', class_id: 'cl_ss1', name: 'Biology', code: 'BIO', topics_count: 14 },
    { id: 'sub_math_jss3', class_id: 'cl_jss3', name: 'Mathematics', code: 'MTH', topics_count: 12 },
  ],
};

export async function getCurriculumTree(): Promise<CurriculumTree> {
  if (USE_MOCK) { await delay(); return JSON.parse(JSON.stringify(CURRICULUM)); }
  // TODO(no backend route): curriculum READS (versions/classes/subjects/topics) are MEMBER routes
  // under /api/finance/academy/curriculum; the curriculum admin group is write-only (create/update/
  // publish) with no /tree aggregate. Not reachable from the admin base. Mock.
  return getJson<CurriculumTree>('/admin/curriculum/tree');
}

export async function getTopics(subjectId: string): Promise<CurriculumTopic[]> {
  if (USE_MOCK) {
    await delay();
    return [
      { id: `${subjectId}_t1`, subject_id: subjectId, name: 'Topic A', objectives_count: 4 },
      { id: `${subjectId}_t2`, subject_id: subjectId, name: 'Topic B', objectives_count: 6 },
      { id: `${subjectId}_t3`, subject_id: subjectId, name: 'Topic C', objectives_count: 3 },
    ];
  }
  // TODO(no backend route): topic reads are MEMBER-only (GET /academy/curriculum/subjects/:id/topics);
  // no admin read. Mock.
  return getJson<CurriculumTopic[]>(`/admin/curriculum/subjects/${subjectId}/topics`);
}

export async function createCurriculumVersion(input: CurriculumVersionInput): Promise<CurriculumVersion> {
  if (USE_MOCK) throw new Error(`Creating a curriculum version ${NOT_IN_FIXTURE_MODE}`);
  return sendJson<CurriculumVersion>('POST', '/admin/curriculum/versions', input);
}

// ════════════════════════ QUESTION BANK ════════════════════════
// RBAC: academy.assessment — /api/academy/admin/question-bank/*
const QUESTIONS: QuestionItem[] = [
  { id: 'q_001', stem: 'A body moves with uniform acceleration. Which graph represents its velocity-time relationship?', type: 'mcq', subject: 'Physics', topic: 'Motion', difficulty: 'medium', objective: 'Describe linear motion graphs', options: ['Straight line through origin', 'Horizontal line', 'Curve', 'Vertical line'], answer_key: 'Straight line through origin', review_status: 'approved', author: 'A. Bello', difficulty_index: 0.58, discrimination: 0.41, created_at: iso(120) },
  { id: 'q_002', stem: 'Which of the following is a balanced chemical equation for the combustion of methane?', type: 'mcq', subject: 'Chemistry', topic: 'Stoichiometry', difficulty: 'hard', objective: 'Balance combustion equations', options: ['CH4 + 2O2 → CO2 + 2H2O', 'CH4 + O2 → CO2 + H2O', 'CH4 + 3O2 → CO2 + 3H2O', '2CH4 + O2 → 2CO + 2H2O'], answer_key: 'CH4 + 2O2 → CO2 + 2H2O', review_status: 'in_review', author: 'C. Okonkwo', difficulty_index: null, discrimination: null, created_at: iso(40) },
  { id: 'q_003', stem: 'Find the value of x if 2x + 5 = 17.', type: 'numeric', subject: 'Mathematics', topic: 'Linear Equations', difficulty: 'easy', objective: 'Solve linear equations', options: [], answer_key: '6', review_status: 'approved', author: 'E. Adeyemi', difficulty_index: 0.82, discrimination: 0.33, created_at: iso(200) },
  { id: 'q_004', stem: 'Identify the parts of speech in: "The quick brown fox jumps."', type: 'multi_select', subject: 'English Language', topic: 'Parts of Speech', difficulty: 'medium', objective: 'Classify parts of speech', options: ['Article', 'Adjective', 'Noun', 'Verb'], answer_key: 'Article,Adjective,Noun,Verb', review_status: 'draft', author: 'T. Wodu', difficulty_index: null, discrimination: null, created_at: iso(8) },
  { id: 'q_005', stem: 'A body moves with uniform acceleration. Which graph shows velocity vs time?', type: 'mcq', subject: 'Physics', topic: 'Motion', difficulty: 'medium', objective: 'Describe linear motion graphs', options: ['Straight line', 'Curve', 'Flat', 'Vertical'], answer_key: 'Straight line', review_status: 'duplicate', author: 'A. Bello', difficulty_index: null, discrimination: null, created_at: iso(5) },
];

export async function listQuestionItems(): Promise<QuestionItem[]> {
  if (USE_MOCK) { await delay(); return QUESTIONS.map((q) => ({ ...q })); }
  return getJson<QuestionItem[]>('/admin/question-bank/items');
}

export async function createQuestionItem(input: QuestionItemInput): Promise<QuestionItem> {
  if (USE_MOCK) throw new Error(`Creating a question item ${NOT_IN_FIXTURE_MODE}`);
  return sendJson<QuestionItem>('POST', '/admin/question-bank/items', input);
}

export async function reviewQuestionItem(id: string, input: QuestionReviewInput): Promise<QuestionItem> {
  if (USE_MOCK) throw new Error(`Reviewing a question item ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /question-bank/items/:id/transition (assessment.RegisterAcademyAssessment).
  return sendJson<QuestionItem>('POST', `/admin/question-bank/items/${id}/transition`, input);
}

// ════════════════════════ EXAMS ════════════════════════
// RBAC: academy.exam — /api/academy/admin/exam/*
const ARENAS: ExamArena[] = [
  { id: 'arena_utme26', exam_code: 'UTME', name: 'UTME 2026 Mock Arena', status: 'active', next_session_at: dateStr(12), registered: 18420 },
  { id: 'arena_wassce26', exam_code: 'WASSCE', name: 'WASSCE 2026 (May/June)', status: 'active', next_session_at: dateStr(40), registered: 9810 },
  { id: 'arena_bece26', exam_code: 'BECE', name: 'BECE 2026', status: 'active', next_session_at: dateStr(25), registered: 5230 },
  { id: 'arena_neco26', exam_code: 'NECO', name: 'NECO 2026', status: 'draft', next_session_at: null, registered: 0 },
];

const BLUEPRINTS: ExamBlueprint[] = [
  { id: 'bp_utme', arena_id: 'arena_utme26', name: 'UTME Standard (4 subjects)', duration_minutes: 120, question_count: 180, pass_mark_pct: 0.5, negative_marking: false, subjects: ['English', 'Mathematics', 'Physics', 'Chemistry'] },
  { id: 'bp_wassce_phy', arena_id: 'arena_wassce26', name: 'WASSCE Physics Objective', duration_minutes: 75, question_count: 50, pass_mark_pct: 0.45, negative_marking: false, subjects: ['Physics'] },
];

const COMBINATIONS: SubjectCombinationRule[] = [
  { id: 'cmb_med', course: 'Medicine & Surgery', required_subjects: ['English', 'Biology', 'Chemistry', 'Physics'], electives_pick: 0, elective_pool: [] },
  { id: 'cmb_eng', course: 'Engineering', required_subjects: ['English', 'Mathematics', 'Physics'], electives_pick: 1, elective_pool: ['Chemistry', 'Further Mathematics'] },
  { id: 'cmb_law', course: 'Law', required_subjects: ['English', 'Literature'], electives_pick: 2, elective_pool: ['Government', 'History', 'CRS', 'Economics'] },
];

export async function listExamArenas(): Promise<ExamArena[]> {
  if (USE_MOCK) { await delay(); return ARENAS.map((a) => ({ ...a })); }
  // TODO(no backend route): exam arena READS are MEMBER-only (GET /academy/exam/arenas); the exam
  // admin group is write-only (create/update arenas, blueprints, combinations). Mock.
  return getJson<ExamArena[]>('/admin/exam/arenas');
}
export async function listExamBlueprints(): Promise<ExamBlueprint[]> {
  if (USE_MOCK) { await delay(); return BLUEPRINTS.map((b) => ({ ...b })); }
  // TODO(no backend route): blueprint READS are MEMBER-only (GET /academy/exam/arenas/:id/blueprints);
  // no admin blueprint list. Mock.
  return getJson<ExamBlueprint[]>('/admin/exam/blueprints');
}
export async function listSubjectCombinations(): Promise<SubjectCombinationRule[]> {
  if (USE_MOCK) { await delay(); return COMBINATIONS.map((c) => ({ ...c })); }
  // TODO(no backend route): combination READS are MEMBER-only (GET /academy/exam/utme/combinations);
  // no admin combinations list. Mock.
  return getJson<SubjectCombinationRule[]>('/admin/exam/combinations');
}
export async function createExamBlueprint(input: ExamBlueprintInput): Promise<ExamBlueprint> {
  if (USE_MOCK) throw new Error(`Creating an exam blueprint ${NO_BACKEND_YET}`);
  // TODO(no backend route as-shaped): the backend creates blueprints nested under an arena
  // (POST /exam/arenas/:id/blueprints, exam.AdminCreateBlueprint), not at a flat /exam/blueprints —
  // AND the Go CreateBlueprintRequest body shape (name, variant, sections, total_items,
  // total_seconds, navigation, tools, shuffle, pause_policy) does not match ExamBlueprintInput
  // (name, duration_minutes, question_count, pass_mark_pct, negative_marking, subjects) at all.
  // Pointing this at the real nested URL alone would not fix it — the request would still 400 on
  // the required total_seconds field, or silently drop pass_mark_pct/negative_marking/subjects.
  // This needs the admin contract redesigned, not a path fix. Left as a documented gap.
  return sendJson<ExamBlueprint>('POST', '/admin/exam/blueprints', input);
}

// ════════════════════════ GAMIFICATION ════════════════════════
// RBAC: academy.rewards (gamification config) — /api/academy/admin/gamification/*
const GAMIFICATION: GamificationConfig = {
  xp_curve: [
    { level: 1, xp_required: 0 }, { level: 2, xp_required: 100 }, { level: 3, xp_required: 250 },
    { level: 4, xp_required: 500 }, { level: 5, xp_required: 900 }, { level: 6, xp_required: 1500 },
    { level: 7, xp_required: 2400 }, { level: 8, xp_required: 3600 },
  ],
  streak: { daily_xp: 20, freeze_tokens_per_month: 2, grace_hours: 6 },
  badges: [
    { id: 'bdg_first', name: 'First Steps', criteria: 'Complete first lesson', status: 'active', awarded_count: 41200 },
    { id: 'bdg_streak7', name: '7-Day Streak', criteria: 'Maintain a 7-day streak', status: 'active', awarded_count: 8930 },
    { id: 'bdg_mock', name: 'Mock Master', criteria: 'Score 80%+ on 5 mocks', status: 'active', awarded_count: 2140 },
    { id: 'bdg_season', name: 'Season Champion', criteria: 'Top 1% on seasonal leaderboard', status: 'draft', awarded_count: 0 },
  ],
  challenges: [
    { id: 'ch_daily', name: 'Daily 3 Quizzes', cadence: 'daily', status: 'live', reward_xp: 60, participants: 22400 },
    { id: 'ch_phys', name: 'Physics Week Sprint', cadence: 'weekly', status: 'live', reward_xp: 300, participants: 5120 },
    { id: 'ch_utme', name: 'UTME Countdown Challenge', cadence: 'seasonal', status: 'upcoming', reward_xp: 1500, participants: 0 },
  ],
  leaderboards: [
    { id: 'lb_global', scope: 'global', reset: 'weekly', anti_cheat_threshold: 5 },
    { id: 'lb_class', scope: 'class', reset: 'weekly', anti_cheat_threshold: 4 },
    { id: 'lb_school', scope: 'school', reset: 'monthly', anti_cheat_threshold: 6 },
  ],
};

export async function getGamificationConfig(): Promise<GamificationConfig> {
  if (USE_MOCK) { await delay(); return JSON.parse(JSON.stringify(GAMIFICATION)); }
  // TODO(no backend route): the gamification admin group exposes badges/challenges/leaderboards
  // endpoints but NO single /config aggregate (xp curve + streak + badges + challenges +
  // leaderboards). Mock.
  return getJson<GamificationConfig>('/admin/gamification/config');
}

// ════════════════════════ REWARDS ════════════════════════
// RBAC: academy.rewards — /api/academy/admin/rewards/*
// Invariant: no reward without a funded pool.
const POOLS: RewardPool[] = [
  { id: 'pool_mtn01', name: 'MTN STEM Drive', status: 'funded', funded_kobo: naira(5_000_000), balance_kobo: naira(4_120_000), spent_kobo: naira(880_000), per_user_cap_kobo: naira(2_000), sponsor: 'MTN Foundation', created_at: iso(60) },
  { id: 'pool_house', name: 'Academy House Pool', status: 'funded', funded_kobo: naira(8_000_000), balance_kobo: naira(4_790_000), spent_kobo: naira(3_210_000), per_user_cap_kobo: naira(5_000), sponsor: null, created_at: iso(400) },
  { id: 'pool_dangote', name: 'Dangote Scholar Rewards', status: 'low_balance', funded_kobo: naira(2_000_000), balance_kobo: naira(180_000), spent_kobo: naira(1_820_000), per_user_cap_kobo: naira(3_000), sponsor: 'Dangote Foundation', created_at: iso(120) },
  { id: 'pool_q3', name: 'Q3 Engagement Drive', status: 'unfunded', funded_kobo: 0, balance_kobo: 0, spent_kobo: 0, per_user_cap_kobo: naira(1_000), sponsor: null, created_at: iso(2) },
];

const CATALOG: RewardCatalogItem[] = [
  { id: 'rc_air100', name: '₦100 Airtime', category: 'airtime', point_cost: 500, value_kobo: naira(100), pool_id: 'pool_house', stock: null, status: 'active' },
  { id: 'rc_data1g', name: '1GB Data Bundle', category: 'data', point_cost: 2000, value_kobo: naira(350), pool_id: 'pool_mtn01', stock: null, status: 'active' },
  { id: 'rc_voucher', name: 'Bookshop ₦1,000 Voucher', category: 'voucher', point_cost: 5000, value_kobo: naira(1_000), pool_id: 'pool_house', stock: 240, status: 'active' },
  { id: 'rc_cash', name: '₦2,000 Cash to Wallet', category: 'cash', point_cost: 10000, value_kobo: naira(2_000), pool_id: 'pool_dangote', stock: null, status: 'inactive' },
];

const LEDGER: RewardLedgerEntry[] = [
  { id: 'rl_1', pool_id: 'pool_mtn01', type: 'fund', amount_kobo: naira(5_000_000), user_id: null, ref: 'fund_mtn_001', created_at: iso(60) },
  { id: 'rl_2', pool_id: 'pool_house', type: 'redeem', amount_kobo: naira(100), user_id: 'usr_aa01', ref: 'rdm_99812', created_at: iso(20) },
  { id: 'rl_3', pool_id: 'pool_dangote', type: 'redeem', amount_kobo: naira(2_000), user_id: 'usr_bb02', ref: 'rdm_99750', created_at: iso(48) },
  { id: 'rl_4', pool_id: 'pool_house', type: 'reversal', amount_kobo: naira(100), user_id: 'usr_cc03', ref: 'rev_001', created_at: iso(70) },
];

export async function listRewardPools(): Promise<RewardPool[]> {
  if (USE_MOCK) { await delay(); return POOLS.map((p) => ({ ...p })); }
  return getJson<RewardPool[]>('/admin/rewards/pools');
}
export async function createRewardPool(input: RewardPoolInput): Promise<RewardPool> {
  if (USE_MOCK) throw new Error(`Creating a reward pool ${NOT_IN_FIXTURE_MODE}`);
  return sendJson<RewardPool>('POST', '/admin/rewards/pools', input);
}
export async function fundRewardPool(input: RewardFundInput): Promise<RewardPool> {
  if (USE_MOCK) throw new Error(`Funding a reward pool ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /rewards/pools/:id/fund (pool id in path, not body).
  return sendJson<RewardPool>('POST', `/admin/rewards/pools/${input.pool_id}/fund`, input);
}
export async function listRewardCatalog(): Promise<RewardCatalogItem[]> {
  if (USE_MOCK) { await delay(); return CATALOG.map((c) => ({ ...c })); }
  return getJson<RewardCatalogItem[]>('/admin/rewards/catalog');
}
export async function getRewardLedger(): Promise<RewardLedgerEntry[]> {
  if (USE_MOCK) { await delay(); return LEDGER.map((l) => ({ ...l })); }
  // TODO(no backend route): rewards ledger is per-pool only (GET /rewards/pools/:id/ledger);
  // there is no cross-pool aggregate ledger endpoint. Mock.
  return getJson<RewardLedgerEntry[]>('/admin/rewards/ledger');
}

// ════════════════════════ COMMERCE ════════════════════════
// RBAC: academy.commerce — /api/academy/commerce/admin/*
const PLANS: Plan[] = [
  { id: 'plan_basic', name: 'Academy Basic', cadence: 'monthly', price_kobo: naira(1_500), status: 'active', active_subscribers: 7820 },
  { id: 'plan_pro', name: 'Academy Pro (Exam Prep)', cadence: 'termly', price_kobo: naira(6_000), status: 'active', active_subscribers: 3940 },
  { id: 'plan_annual', name: 'Academy Annual', cadence: 'annual', price_kobo: naira(18_000), status: 'active', active_subscribers: 720 },
  { id: 'plan_waec25', name: 'WAEC 2025 Intensive', cadence: 'termly', price_kobo: naira(8_000), status: 'draft', active_subscribers: 0 },
];

const BUNDLES: ExamBundle[] = [
  { id: 'bnd_utme', name: 'UTME Complete Bundle', exam_code: 'UTME', price_kobo: naira(4_500), status: 'active', sold: 5210 },
  { id: 'bnd_wassce', name: 'WASSCE Science Bundle', exam_code: 'WASSCE', price_kobo: naira(5_000), status: 'active', sold: 2840 },
  { id: 'bnd_bece', name: 'BECE Starter Bundle', exam_code: 'BECE', price_kobo: naira(2_500), status: 'draft', sold: 0 },
];

const CARD_BATCHES: AccessCardBatch[] = [
  { id: 'batch_lag_07', label: 'Lagos Agents Batch 07', plan_id: 'plan_pro', quantity: 500, generated: 500, allocated: 120, status: 'partial', agent: 'Lagos Hub', created_at: iso(5) },
  { id: 'batch_abj_03', label: 'Abuja Schools Batch 03', plan_id: 'plan_basic', quantity: 1000, generated: 1000, allocated: 1000, status: 'allocated', agent: 'Abuja Hub', created_at: iso(72) },
  { id: 'batch_kan_01', label: 'Kano Pilot Batch', plan_id: 'plan_basic', quantity: 300, generated: 300, allocated: 0, status: 'generated', agent: null, created_at: iso(10) },
];

const PAYMENTS: PaymentsOverview = {
  gross_30d_kobo: naira(21_400_000),
  net_30d_kobo: naira(19_870_000),
  refunds_30d_kobo: naira(640_000),
  successful_txns_30d: 14820,
  failed_txns_30d: 912,
};

export async function listPlans(): Promise<Plan[]> {
  if (USE_MOCK) { await delay(); return PLANS.map((p) => ({ ...p })); }
  return getJson<Plan[]>('/commerce/admin/plans');
}
export async function listExamBundles(): Promise<ExamBundle[]> {
  if (USE_MOCK) { await delay(); return BUNDLES.map((b) => ({ ...b })); }
  return getJson<ExamBundle[]>('/commerce/admin/bundles');
}
export async function listAccessCardBatches(): Promise<AccessCardBatch[]> {
  if (USE_MOCK) { await delay(); return CARD_BATCHES.map((b) => ({ ...b })); }
  return getJson<AccessCardBatch[]>('/commerce/admin/access-cards');
}
export async function getPaymentsOverview(): Promise<PaymentsOverview> {
  if (USE_MOCK) { await delay(); return { ...PAYMENTS }; }
  return getJson<PaymentsOverview>('/commerce/admin/payments/overview');
}
export async function generateAccessCards(input: AccessCardGenerateInput): Promise<AccessCardBatch> {
  if (USE_MOCK) throw new Error(`Generating access cards ${NOT_IN_FIXTURE_MODE}`);
  return sendJson<AccessCardBatch>('POST', '/commerce/admin/access-cards/generate', input);
}
export async function allocateAccessCards(input: AccessCardAllocateInput): Promise<AccessCardBatch> {
  if (USE_MOCK) throw new Error(`Allocating access cards ${NOT_IN_FIXTURE_MODE}`);
  return sendJson<AccessCardBatch>('POST', '/commerce/admin/access-cards/allocate', input);
}
export async function issueRefund(input: RefundInput): Promise<{ ok: true; ref: string }> {
  if (USE_MOCK) throw new Error(`Issuing a refund ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /academy/commerce/admin/orders/:id/refund (commerce AdminRefund).
  // NOTE(payload): the backend keys the refund by order id in the path; RefundInput carries
  // a txn_ref (transaction reference), not an order id — passed as :id here, but the caller/UI
  // must supply the order id for this to resolve. Body-field alignment is a types-owned follow-up.
  return sendJson<{ ok: true; ref: string }>('POST', `/commerce/admin/orders/${encodeURIComponent(input.txn_ref)}/refund`, input);
}

// ── Identity admin (user lookup) — /api/academy/* ──────────────────────────────
const USERS: AcademyUser[] = [
  { id: 'usr_aa01', display_name: 'Ada Okafor', email: 'ada@example.com', role: 'learner', status: 'active', tier: 'Pro', kyc: 'tier1', joined_at: iso(900) },
  { id: 'usr_bb02', display_name: 'Bola Adeyemi', email: 'bola@example.com', role: 'parent', status: 'active', tier: 'Basic', kyc: 'tier2', joined_at: iso(400) },
  { id: 'usr_cc03', display_name: 'Chidi Nwankwo', email: 'chidi@example.com', role: 'tutor', status: 'suspended', tier: '—', kyc: 'tier1', joined_at: iso(1200) },
];

export async function lookupUser(query: string): Promise<AcademyUser[]> {
  if (USE_MOCK) {
    await delay();
    const q = query.trim().toLowerCase();
    if (!q) return USERS.map((u) => ({ ...u }));
    return USERS.filter((u) => u.display_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.id.includes(q));
  }
  // backend: GET /admin/users/:id (identity.AdminLookup) — single exact-id lookup ONLY.
  // NOTE(no backend search): there is no query/search endpoint; `query` is treated as an
  // exact user id and the single result is wrapped in an array to satisfy the caller shape.
  const u = await getJson<AcademyUser>(`/admin/users/${encodeURIComponent(query.trim())}`);
  return u ? [u] : [];
}

// ════════════════════════ SPONSORS ════════════════════════
// RBAC: academy.sponsor — /api/academy/admin/* (sponsor reporting)
const SPONSORS: Sponsor[] = [
  { id: 'spn_mtn', name: 'MTN Foundation', status: 'active', funded_pools: 1, total_funded_kobo: naira(5_000_000) },
  { id: 'spn_dangote', name: 'Dangote Foundation', status: 'active', funded_pools: 1, total_funded_kobo: naira(2_000_000) },
  { id: 'spn_access', name: 'Access Bank', status: 'inactive', funded_pools: 0, total_funded_kobo: 0 },
];

const CAMPAIGNS: SponsorCampaign[] = [
  { id: 'cmp_mtn_stem', sponsor_id: 'spn_mtn', name: 'MTN STEM Drive 2026', status: 'live', pool_id: 'pool_mtn01', funded_kobo: naira(5_000_000), spent_kobo: naira(880_000), attribution_code: 'TV-MTNSTEM26', signups_attributed: 14210 },
  { id: 'cmp_dangote', sponsor_id: 'spn_dangote', name: 'Dangote Scholars', status: 'live', pool_id: 'pool_dangote', funded_kobo: naira(2_000_000), spent_kobo: naira(1_820_000), attribution_code: 'TV-DANGOTE26', signups_attributed: 6320 },
  { id: 'cmp_access', sponsor_id: 'spn_access', name: 'Access Quiz Show S2', status: 'upcoming', pool_id: null, funded_kobo: 0, spent_kobo: 0, attribution_code: 'TV-ACCESSQUIZ', signups_attributed: 0 },
];

export async function listSponsors(): Promise<Sponsor[]> {
  if (USE_MOCK) { await delay(); return SPONSORS.map((s) => ({ ...s })); }
  // TODO(no backend route): there is no sponsors admin endpoint (sponsor reporting is not wired
  // as a standalone route). Mock.
  return getJson<Sponsor[]>('/admin/sponsors');
}
export async function listSponsorCampaigns(): Promise<SponsorCampaign[]> {
  if (USE_MOCK) { await delay(); return CAMPAIGNS.map((c) => ({ ...c })); }
  // TODO(no backend route): no sponsor campaigns endpoint exists. Mock.
  return getJson<SponsorCampaign[]>('/admin/sponsors/campaigns');
}

// ════════════════════════════════════════════════════════════════════════════
//                              PHASE 2 MODULES
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════ CONTENT (CMS) ════════════════════════
// RBAC: academy.content — /api/academy/admin/content/*
// Publish workflow: draft → review → approved → live → archived (forward-only).
const CONTENT_NEXT: Record<string, { status: ContentItem['status']; back?: ContentItem['status'] }> = {
  submit_review: { status: 'review', back: 'draft' },
  approve: { status: 'approved', back: 'review' },
  publish: { status: 'live', back: 'approved' },
  archive: { status: 'archived' },
  send_back: { status: 'draft' },
};

const CONTENT: ContentItem[] = [
  { id: 'cnt_phy_mot', title: 'Motion: Velocity-Time Graphs', kind: 'lesson', subject: 'Physics', class_name: 'SS 2', status: 'live', owner: 'A. Bello', duration_min: 14, variants: [{ quality: 'low_data', size_mb: 6, ready: true }, { quality: 'standard', size_mb: 22, ready: true }, { quality: 'hd', size_mb: 78, ready: true }, { quality: 'audio_only', size_mb: 3, ready: true }], localizations: ['en', 'ha', 'yo'], version: 4, updated_at: iso(40) },
  { id: 'cnt_chm_stoich', title: 'Stoichiometry: Balancing Equations', kind: 'lesson', subject: 'Chemistry', class_name: 'SS 2', status: 'approved', owner: 'C. Okonkwo', duration_min: 18, variants: [{ quality: 'low_data', size_mb: 7, ready: true }, { quality: 'standard', size_mb: 26, ready: true }, { quality: 'hd', size_mb: 0, ready: false }, { quality: 'audio_only', size_mb: 4, ready: true }], localizations: ['en'], version: 2, updated_at: iso(10) },
  { id: 'cnt_eng_pos', title: 'Parts of Speech (Series Ep. 3)', kind: 'series_episode', subject: 'English Language', class_name: 'JSS 3', status: 'review', owner: 'T. Wodu', duration_min: 12, variants: [{ quality: 'low_data', size_mb: 5, ready: true }, { quality: 'standard', size_mb: 19, ready: true }, { quality: 'hd', size_mb: 0, ready: false }, { quality: 'audio_only', size_mb: 3, ready: true }], localizations: ['en', 'ig'], version: 1, updated_at: iso(5) },
  { id: 'cnt_math_lin', title: 'Linear Equations Workshop', kind: 'lesson', subject: 'Mathematics', class_name: 'SS 1', status: 'draft', owner: 'E. Adeyemi', duration_min: 20, variants: [{ quality: 'low_data', size_mb: 0, ready: false }, { quality: 'standard', size_mb: 0, ready: false }, { quality: 'hd', size_mb: 0, ready: false }, { quality: 'audio_only', size_mb: 0, ready: false }], localizations: ['en'], version: 1, updated_at: iso(2) },
  { id: 'cnt_bio_cell', title: 'The Cell (Legacy)', kind: 'lesson', subject: 'Biology', class_name: 'SS 1', status: 'archived', owner: 'A. Bello', duration_min: 16, variants: [{ quality: 'standard', size_mb: 24, ready: true }], localizations: ['en'], version: 6, updated_at: iso(800) },
];

const LOCALIZATIONS: Localization[] = [
  { id: 'loc_1', content_id: 'cnt_phy_mot', language: 'Hausa', status: 'published', translator: 'M. Sani', coverage_pct: 1, updated_at: iso(38) },
  { id: 'loc_2', content_id: 'cnt_phy_mot', language: 'Yoruba', status: 'published', translator: 'B. Adeyemi', coverage_pct: 1, updated_at: iso(36) },
  { id: 'loc_3', content_id: 'cnt_phy_mot', language: 'Igbo', status: 'in_translation', translator: 'C. Nwankwo', coverage_pct: 0.55, updated_at: iso(6) },
  { id: 'loc_4', content_id: 'cnt_eng_pos', language: 'Igbo', status: 'review', translator: 'C. Nwankwo', coverage_pct: 0.9, updated_at: iso(4) },
  { id: 'loc_5', content_id: 'cnt_chm_stoich', language: 'Pidgin', status: 'missing', translator: null, coverage_pct: 0, updated_at: iso(10) },
];

export async function listContent(): Promise<ContentItem[]> {
  if (USE_MOCK) { await delay(); return CONTENT.map((c) => ({ ...c, variants: c.variants.map((v) => ({ ...v })), localizations: [...c.localizations] })); }
  // TODO(no backend route): the content admin group has no generic content-items list; content is
  // read as member lessons/bundles (GET /content/lessons/:objectiveId, /content/bundles). No admin
  // CMS item list. Mock.
  return getJson<ContentItem[]>('/admin/content/items');
}
export async function transitionContent(input: ContentTransitionInput): Promise<ContentItem> {
  if (USE_MOCK) throw new Error(`Transitioning content ${NO_BACKEND_YET}`);
  // TODO(no backend route): the content admin surface exposes only single-step publish
  // transitions split by kind — POST /content/lessons/:id/publish and
  // POST /content/bundles/:id/publish — not a generic /content/items/:id/transition with the
  // full draft→review→approved→live→archived lifecycle. A ContentItem (kind lesson|series_episode)
  // does not map unambiguously to lessons-vs-bundles, and only "publish" exists (no submit/approve/
  // archive/send_back), so a correct mapping needs a backend lifecycle endpoint. Left on mock.
  return sendJson<ContentItem>('POST', `/admin/content/items/${input.id}/transition`, input);
}
export async function listLocalizations(): Promise<Localization[]> {
  if (USE_MOCK) { await delay(); return LOCALIZATIONS.map((l) => ({ ...l })); }
  return getJson<Localization[]>('/admin/content/localizations');
}

// ════════════════════════ CONTENT PRODUCTION TRACKER ════════════════════════
// RBAC: academy.content — /api/academy/admin/production/*
// Board stages: script → storyboard → shoot → edit → qa → publish.
export const PRODUCTION_STAGES: ProductionStage[] = ['script', 'storyboard', 'shoot', 'edit', 'qa', 'publish'];

const PRODUCTION: ProductionCard[] = [
  { id: 'prd_1', title: 'Motion: Projectiles', subject: 'Physics', stage: 'script', owner: 'A. Bello', sla_due: dateStr(3), blocked: false, blocked_reason: null, priority: 'high', updated_at: iso(8) },
  { id: 'prd_2', title: 'Acids, Bases & Salts', subject: 'Chemistry', stage: 'storyboard', owner: 'C. Okonkwo', sla_due: dateStr(1), blocked: false, blocked_reason: null, priority: 'normal', updated_at: iso(20) },
  { id: 'prd_3', title: 'Photosynthesis Deep-Dive', subject: 'Biology', stage: 'shoot', owner: 'O. Studio', sla_due: dateStr(-1), blocked: true, blocked_reason: 'Awaiting studio slot', priority: 'high', updated_at: iso(30) },
  { id: 'prd_4', title: 'Quadratic Equations', subject: 'Mathematics', stage: 'edit', owner: 'Edit Bay 2', sla_due: dateStr(2), blocked: false, blocked_reason: null, priority: 'normal', updated_at: iso(12) },
  { id: 'prd_5', title: 'Comprehension Strategies', subject: 'English Language', stage: 'qa', owner: 'QA Team', sla_due: dateStr(0), blocked: false, blocked_reason: null, priority: 'low', updated_at: iso(5) },
  { id: 'prd_6', title: 'Ohm’s Law', subject: 'Physics', stage: 'publish', owner: 'A. Bello', sla_due: dateStr(1), blocked: false, blocked_reason: null, priority: 'normal', updated_at: iso(2) },
  { id: 'prd_7', title: 'Trigonometric Ratios', subject: 'Mathematics', stage: 'script', owner: 'E. Adeyemi', sla_due: dateStr(5), blocked: false, blocked_reason: null, priority: 'low', updated_at: iso(48) },
];

export async function listProductionCards(): Promise<ProductionCard[]> {
  if (USE_MOCK) { await delay(); return PRODUCTION.map((c) => ({ ...c })); }
  // backend: GET /content/productions (content.AdminListProductions).
  return getJson<ProductionCard[]>('/admin/content/productions');
}
export async function advanceProductionCard(input: ProductionAdvanceInput): Promise<ProductionCard> {
  if (USE_MOCK) throw new Error(`Advancing a production card ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /content/productions/:id/advance (content.AdminAdvanceProduction).
  return sendJson<ProductionCard>('POST', `/admin/content/productions/${input.id}/advance`, input);
}
export async function blockProductionCard(input: ProductionBlockInput): Promise<ProductionCard> {
  if (USE_MOCK) throw new Error(`Blocking a production card ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /content/productions/:id/block (content.AdminBlockProduction) — the OLD
  // "no block/unblock endpoint" comment here was wrong; the route exists and is registered
  // (spineEnabled), it was just never checked against the actual Go route list before.
  return sendJson<ProductionCard>('POST', `/admin/content/productions/${input.id}/block`, input);
}

// ════════════════════════ OFFLINE BUNDLE BUILDER ════════════════════════
// RBAC: academy.content — /api/academy/admin/offline-bundles/*
const OFFLINE_BUNDLES: OfflineBundle[] = [
  { id: 'ob_utme_phy', name: 'UTME Physics Offline Pack', exam_code: 'UTME', lesson_ids: ['cnt_phy_mot'], size_mb: 28, size_budget_mb: 256, access_card_plan_id: 'plan_pro', status: 'published', updated_at: iso(60) },
  { id: 'ob_wassce_sci', name: 'WASSCE Science Starter', exam_code: 'WASSCE', lesson_ids: ['cnt_chm_stoich', 'cnt_bio_cell'], size_mb: 48, size_budget_mb: 512, access_card_plan_id: 'plan_basic', status: 'packaged', updated_at: iso(20) },
  { id: 'ob_jss_eng', name: 'JSS English Drafts', exam_code: 'BECE', lesson_ids: ['cnt_eng_pos'], size_mb: 19, size_budget_mb: 128, access_card_plan_id: null, status: 'draft', updated_at: iso(4) },
];

export async function listOfflineBundles(): Promise<OfflineBundle[]> {
  if (USE_MOCK) { await delay(); return OFFLINE_BUNDLES.map((b) => ({ ...b, lesson_ids: [...b.lesson_ids] })); }
  // TODO(no backend route): offline-bundle builder has no admin endpoints; offlinesync only exposes
  // a member ingest route (POST /academy/sync). Mock.
  return getJson<OfflineBundle[]>('/admin/offline-bundles');
}
export async function buildOfflineBundle(input: BundleBuildInput): Promise<OfflineBundle> {
  if (USE_MOCK) throw new Error(`Building an offline bundle ${NO_BACKEND_YET}`);
  // TODO(no backend route): no offline-bundle build endpoint on the backend. Mock.
  return sendJson<OfflineBundle>('POST', '/admin/offline-bundles', input);
}

// ════════════════════════ CURRICULUM (DEEP) ════════════════════════
// RBAC: academy.curriculum. Adds objectives + exam-relevance + CRUD over the tree.
const OBJECTIVES: CurriculumObjective[] = [
  { id: 'obj_phy_mot_1', topic_id: 'sub_phy_ss2_t1', code: 'PHY.MOT.1', statement: 'Describe linear motion using velocity-time graphs.', bloom_level: 'understand', exam_relevance: [{ exam_code: 'UTME', relevance: 'core' }, { exam_code: 'WASSCE', relevance: 'frequent' }] },
  { id: 'obj_phy_mot_2', topic_id: 'sub_phy_ss2_t1', code: 'PHY.MOT.2', statement: 'Calculate acceleration from motion graphs.', bloom_level: 'apply', exam_relevance: [{ exam_code: 'UTME', relevance: 'frequent' }] },
  { id: 'obj_phy_mot_3', topic_id: 'sub_phy_ss2_t1', code: 'PHY.MOT.3', statement: 'Analyse non-uniform motion scenarios.', bloom_level: 'analyze', exam_relevance: [{ exam_code: 'WASSCE', relevance: 'occasional' }, { exam_code: 'NECO', relevance: 'rare' }] },
];

export async function getObjectives(topicId: string): Promise<CurriculumObjective[]> {
  if (USE_MOCK) {
    await delay();
    const found = OBJECTIVES.filter((o) => o.topic_id === topicId);
    if (found.length) return found.map((o) => ({ ...o, exam_relevance: o.exam_relevance.map((r) => ({ ...r })) }));
    return [
      { id: `${topicId}_o1`, topic_id: topicId, code: 'OBJ.1', statement: 'Sample objective one for this topic.', bloom_level: 'understand', exam_relevance: [{ exam_code: 'UTME', relevance: 'frequent' }] },
      { id: `${topicId}_o2`, topic_id: topicId, code: 'OBJ.2', statement: 'Sample objective two for this topic.', bloom_level: 'apply', exam_relevance: [{ exam_code: 'WASSCE', relevance: 'occasional' }] },
    ];
  }
  // TODO(no backend route): objective reads are MEMBER-only (GET /academy/curriculum/topics/:id/objectives);
  // no admin read. (Objective CREATE is correctly wired below.) Mock.
  return getJson<CurriculumObjective[]>(`/admin/curriculum/topics/${topicId}/objectives`);
}
export async function createCurriculumClass(input: CurriculumClassInput): Promise<CurriculumClass> {
  if (USE_MOCK) throw new Error(`Creating a curriculum class ${NOT_IN_FIXTURE_MODE}`);
  return sendJson<CurriculumClass>('POST', '/admin/curriculum/classes', input);
}
export async function createCurriculumSubject(input: CurriculumSubjectInput): Promise<CurriculumSubject> {
  if (USE_MOCK) throw new Error(`Creating a curriculum subject ${NOT_IN_FIXTURE_MODE}`);
  return sendJson<CurriculumSubject>('POST', '/admin/curriculum/subjects', input);
}
export async function createCurriculumTopic(input: CurriculumTopicInput): Promise<CurriculumTopic> {
  if (USE_MOCK) throw new Error(`Creating a curriculum topic ${NOT_IN_FIXTURE_MODE}`);
  return sendJson<CurriculumTopic>('POST', '/admin/curriculum/topics', input);
}
export async function createCurriculumObjective(input: CurriculumObjectiveInput): Promise<CurriculumObjective> {
  if (USE_MOCK) throw new Error(`Creating a curriculum objective ${NOT_IN_FIXTURE_MODE}`);
  return sendJson<CurriculumObjective>('POST', '/admin/curriculum/objectives', input);
}

// ════════════════════════ EDUPAY / SCHOOL FEES ════════════════════════
// RBAC: academy.edupay — /api/academy/admin/edupay/*
// Disbursement state machine: fee_due → funding → collected → disbursed → reconciled.
export const DISBURSEMENT_FLOW: DisbursementStatus[] = ['fee_due', 'funding', 'collected', 'disbursed', 'reconciled'];

const SCHOOLS: School[] = [
  { id: 'sch_brightstars', name: 'Bright Stars Academy', state: 'Lagos', status: 'active', students: 1240, bank_account: '****3021 · GTBank', created_at: iso(900) },
  { id: 'sch_unityhigh', name: 'Unity High School', state: 'Oyo', status: 'active', students: 860, bank_account: '****7744 · Access', created_at: iso(500) },
  { id: 'sch_futureleaders', name: 'Future Leaders College', state: 'Abuja', status: 'onboarding', students: 0, bank_account: '****1188 · Zenith', created_at: iso(12) },
  { id: 'sch_pacesetters', name: 'Pacesetters School', state: 'Rivers', status: 'suspended', students: 410, bank_account: '****9032 · UBA', created_at: iso(1200) },
];

const FEE_SCHEDULES: FeeSchedule[] = [
  { id: 'fee_bs_t1', school_id: 'sch_brightstars', term: 'First Term 2025/26', amount_kobo: naira(85_000), due_date: dateStr(20), status: 'published', collected_kobo: naira(54_400_000) },
  { id: 'fee_bs_t2', school_id: 'sch_brightstars', term: 'Second Term 2025/26', amount_kobo: naira(85_000), due_date: dateStr(120), status: 'draft', collected_kobo: 0 },
  { id: 'fee_uh_t1', school_id: 'sch_unityhigh', term: 'First Term 2025/26', amount_kobo: naira(62_000), due_date: dateStr(15), status: 'published', collected_kobo: naira(31_000_000) },
  { id: 'fee_ps_t3', school_id: 'sch_pacesetters', term: 'Third Term 2024/25', amount_kobo: naira(58_000), due_date: dateStr(-40), status: 'closed', collected_kobo: naira(22_040_000) },
];

const DISBURSEMENTS: Disbursement[] = [
  { id: 'dsb_1', school_id: 'sch_brightstars', fee_schedule_id: 'fee_bs_t1', amount_kobo: naira(54_400_000), status: 'reconciled', reference: 'EDUPAY-BS-T1-001', initiated_at: iso(120), reconciled_at: iso(96) },
  { id: 'dsb_2', school_id: 'sch_unityhigh', fee_schedule_id: 'fee_uh_t1', amount_kobo: naira(31_000_000), status: 'disbursed', reference: 'EDUPAY-UH-T1-001', initiated_at: iso(36), reconciled_at: null },
  { id: 'dsb_3', school_id: 'sch_brightstars', fee_schedule_id: 'fee_bs_t1', amount_kobo: naira(8_500_000), status: 'collected', reference: 'EDUPAY-BS-T1-002', initiated_at: iso(10), reconciled_at: null },
  { id: 'dsb_4', school_id: 'sch_pacesetters', fee_schedule_id: 'fee_ps_t3', amount_kobo: naira(22_040_000), status: 'funding', reference: 'EDUPAY-PS-T3-001', initiated_at: iso(4), reconciled_at: null },
  { id: 'dsb_5', school_id: 'sch_futureleaders', fee_schedule_id: 'fee_uh_t1', amount_kobo: naira(1_200_000), status: 'fee_due', reference: 'EDUPAY-FL-T1-001', initiated_at: iso(1), reconciled_at: null },
];

const SCHOOL_POTS: SchoolPot[] = [
  { id: 'pot_1', school_id: 'sch_brightstars', guardian: 'Bola Adeyemi', target_kobo: naira(85_000), balance_kobo: naira(61_000), status: 'open' },
  { id: 'pot_2', school_id: 'sch_unityhigh', guardian: 'Chika Obi', target_kobo: naira(62_000), balance_kobo: naira(62_000), status: 'matured' },
  { id: 'pot_3', school_id: 'sch_brightstars', guardian: 'Musa Ibrahim', target_kobo: naira(85_000), balance_kobo: naira(85_000), status: 'released' },
];

const SCHOLARSHIPS: Scholarship[] = [
  { id: 'shp_mtn', name: 'MTN STEM Scholars', sponsor: 'MTN Foundation', pool_kobo: naira(10_000_000), awarded_kobo: naira(3_400_000), slots: 200, awarded_slots: 68, status: 'open' },
  { id: 'shp_dangote', name: 'Dangote Bright Futures', sponsor: 'Dangote Foundation', pool_kobo: naira(5_000_000), awarded_kobo: naira(5_000_000), slots: 100, awarded_slots: 100, status: 'closed' },
  { id: 'shp_access', name: 'Access Girls in Science', sponsor: 'Access Bank', pool_kobo: naira(8_000_000), awarded_kobo: 0, slots: 150, awarded_slots: 0, status: 'draft' },
];

export async function listSchools(): Promise<School[]> {
  if (USE_MOCK) { await delay(); return SCHOOLS.map((s) => ({ ...s })); }
  // TODO(no backend route): edupay exposes GET schools only as a MEMBER route
  // (/api/finance/academy/edupay/schools); the edupay admin group has no GET schools list. Mock.
  return getJson<School[]>('/admin/edupay/schools');
}
export async function createSchool(input: SchoolInput): Promise<School> {
  if (USE_MOCK) throw new Error(`Creating a school ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /edupay/admin/schools (edupay admin group is admin.Group("/edupay/admin")).
  return sendJson<School>('POST', '/admin/edupay/admin/schools', input);
}
export async function listFeeSchedules(): Promise<FeeSchedule[]> {
  if (USE_MOCK) { await delay(); return FEE_SCHEDULES.map((f) => ({ ...f })); }
  // TODO(no backend route): edupay GET fee-schedules is MEMBER-only
  // (/api/finance/academy/edupay/fee-schedules); no admin-group list endpoint. Mock.
  return getJson<FeeSchedule[]>('/admin/edupay/fee-schedules');
}
export async function createFeeSchedule(input: FeeScheduleInput): Promise<FeeSchedule> {
  if (USE_MOCK) throw new Error(`Creating a fee schedule ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /edupay/admin/fee-schedules (edupay admin group).
  return sendJson<FeeSchedule>('POST', '/admin/edupay/admin/fee-schedules', input);
}
export async function listDisbursements(): Promise<Disbursement[]> {
  if (USE_MOCK) { await delay(); return DISBURSEMENTS.map((d) => ({ ...d })); }
  // TODO(no backend route): edupay has no GET disbursements list (member or admin) — only
  // POST /edupay/admin/disbursements/:id/reconcile. A list endpoint is needed. Mock.
  return getJson<Disbursement[]>('/admin/edupay/disbursements');
}
export async function reconcileDisbursement(input: DisbursementReconcileInput): Promise<Disbursement> {
  if (USE_MOCK) throw new Error(`Reconciling a disbursement ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /edupay/admin/disbursements/:id/reconcile (edupay admin group).
  return sendJson<Disbursement>('POST', `/admin/edupay/admin/disbursements/${input.id}/reconcile`, input);
}
export async function listSchoolPots(): Promise<SchoolPot[]> {
  if (USE_MOCK) { await delay(); return SCHOOL_POTS.map((p) => ({ ...p })); }
  // TODO(no backend route): edupay pots are guardian MEMBER routes only (POST /edupay/pots,
  // /pots/:id/fund, /pots/:id/pay); no admin GET pots list exists. Mock.
  return getJson<SchoolPot[]>('/admin/edupay/pots');
}
export async function listScholarships(): Promise<Scholarship[]> {
  if (USE_MOCK) { await delay(); return SCHOLARSHIPS.map((s) => ({ ...s })); }
  // backend: GET /edupay/admin/scholarships (edupay admin group).
  return getJson<Scholarship[]>('/admin/edupay/admin/scholarships');
}
export async function createScholarship(input: ScholarshipInput): Promise<Scholarship> {
  if (USE_MOCK) throw new Error(`Creating a scholarship ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /edupay/admin/scholarships (edupay admin group).
  return sendJson<Scholarship>('POST', '/admin/edupay/admin/scholarships', input);
}
export async function awardScholarship(input: ScholarshipAwardInput): Promise<Scholarship> {
  if (USE_MOCK) throw new Error(`Awarding a scholarship ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /edupay/admin/scholarships/award (edupay admin group).
  return sendJson<Scholarship>('POST', '/admin/edupay/admin/scholarships/award', input);
}

// ════════════════════════ NOTIFICATIONS & MESSAGING ════════════════════════
// RBAC: academy.notifications — /api/academy/admin/notifications/*
const TEMPLATES: NotificationTemplate[] = [
  { id: 'nt_streak', name: 'Streak Reminder', channel: 'push', subject: 'Keep your streak alive!', body: 'Hi {{first_name}}, you have a {{streak_days}}-day streak. Do one quiz to keep it going!', segment: 'inactive_7d', schedule: 'triggered', status: 'active', updated_at: iso(30) },
  { id: 'nt_utme', name: 'UTME Countdown', channel: 'in_app', subject: 'UTME is {{days_left}} days away', body: 'Your UTME mock arena is open. Practice now to boost readiness.', segment: 'utme_2026', schedule: 'scheduled', status: 'active', updated_at: iso(50) },
  { id: 'nt_fee', name: 'School Fee Due', channel: 'sms', subject: 'PAYMAX', body: 'Dear parent, {{school}} fees of {{amount}} are due {{due_date}}. Pay via the app.', segment: 'all_parents', schedule: 'scheduled', status: 'active', updated_at: iso(12) },
  { id: 'nt_welcome', name: 'Welcome Email', channel: 'email', subject: 'Welcome to Spotlight Academy', body: 'Welcome {{first_name}}! Start your first lesson today.', segment: 'all_learners', schedule: 'triggered', status: 'draft', updated_at: iso(6) },
  { id: 'nt_winback', name: 'Win-back Offer', channel: 'push', subject: 'We miss you', body: 'Come back and unlock 100 bonus XP.', segment: 'inactive_30d', schedule: 'manual', status: 'archived', updated_at: iso(400) },
];

export async function listNotificationTemplates(): Promise<NotificationTemplate[]> {
  if (USE_MOCK) { await delay(); return TEMPLATES.map((t) => ({ ...t })); }
  // TODO(no backend route): no notifications/messaging module on the backend (no templates routes). Mock.
  return getJson<NotificationTemplate[]>('/admin/notifications/templates');
}
export async function createNotificationTemplate(input: NotificationTemplateInput): Promise<NotificationTemplate> {
  if (USE_MOCK) throw new Error(`Creating a notification template ${NO_BACKEND_YET}`);
  // TODO(no backend route): no notification-template create endpoint. Mock.
  return sendJson<NotificationTemplate>('POST', '/admin/notifications/templates', input);
}

// ════════════════════════════════════════════════════════════════════════════
//                              PHASE 3 MODULES
//      Trust, learning-ops & support (admin-console.md §7)
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════ CREDENTIALS & EARNING BRIDGE ════════════════════════
// RBAC: academy.credentials — /api/academy/admin/credentials/* + /earning/*
const CREDENTIAL_TEMPLATES: CredentialTemplate[] = [
  { id: 'ct_wassce_sci', name: 'WASSCE Science Certificate', track: 'academic', issuer: 'Spotlight Academy', validity_months: null, signature_authority: 'Registrar, Spotlight Academy', status: 'active', issued_count: 4120, updated_at: iso(200) },
  { id: 'ct_solar', name: 'Solar PV Installation (Trade)', track: 'trade', issuer: 'Spotlight Academy × REA', signature_authority: 'Lead Assessor, Trade Board', validity_months: 24, status: 'active', issued_count: 318, updated_at: iso(40) },
  { id: 'ct_phlebotomy', name: 'Phlebotomy Assistant (Trade)', track: 'trade', issuer: 'Spotlight Academy', validity_months: 36, signature_authority: 'Clinical Lead', status: 'active', issued_count: 96, updated_at: iso(80) },
  { id: 'ct_data_pro', name: 'Data Analytics Professional', track: 'professional', issuer: 'Spotlight Academy', validity_months: null, signature_authority: 'Programme Director', status: 'draft', issued_count: 0, updated_at: iso(4) },
];

const ISSUED_CREDENTIALS: IssuedCredential[] = [
  { id: 'ic_1', template_id: 'ct_solar', template_name: 'Solar PV Installation (Trade)', learner_id: 'usr_aa01', learner_name: 'Ada Okafor', serial: 'SPL-SOLAR-2026-00112', issued_at: iso(60), expires_at: dateStr(700), status: 'issued', revoke_reason: null },
  { id: 'ic_2', template_id: 'ct_wassce_sci', template_name: 'WASSCE Science Certificate', learner_id: 'usr_bb02', learner_name: 'Bola Adeyemi', serial: 'SPL-WSC-2025-04877', issued_at: iso(400), expires_at: null, status: 'issued', revoke_reason: null },
  { id: 'ic_3', template_id: 'ct_phlebotomy', template_name: 'Phlebotomy Assistant (Trade)', learner_id: 'usr_cc03', learner_name: 'Chidi Nwankwo', serial: 'SPL-PHLEB-2026-00031', issued_at: iso(120), expires_at: dateStr(1000), status: 'revoked', revoke_reason: 'Assessment integrity violation' },
  { id: 'ic_4', template_id: 'ct_solar', template_name: 'Solar PV Installation (Trade)', learner_id: 'usr_dd04', learner_name: 'Ngozi Eze', serial: 'SPL-SOLAR-2024-00009', issued_at: iso(900), expires_at: dateStr(-30), status: 'expired', revoke_reason: null },
];

const EARNING_OPPORTUNITIES: EarningOpportunity[] = [
  { id: 'eo_solar', title: 'Solar Installer — Paymax Field Agent', trade_track: 'Solar PV Installation (Trade)', paymax_role: 'field_agent', eligibility_rule: 'Active Solar credential + Tier-2 KYC', min_credential_status: 'active', status: 'open', applicants: 84, routed: 41, updated_at: iso(30) },
  { id: 'eo_phleb', title: 'Mobile Phlebotomist — Paymax Health Rail', trade_track: 'Phlebotomy Assistant (Trade)', paymax_role: 'health_phlebotomist', eligibility_rule: 'Issued Phlebotomy credential + background check', min_credential_status: 'issued', status: 'open', applicants: 22, routed: 7, updated_at: iso(50) },
  { id: 'eo_data', title: 'Data Analyst — Paymax Insights', trade_track: 'Data Analytics Professional', paymax_role: 'data_analyst', eligibility_rule: 'Active Data credential + portfolio review', min_credential_status: 'active', status: 'paused', applicants: 0, routed: 0, updated_at: iso(4) },
];

const EARNING_APPLICATIONS: EarningApplication[] = [
  { id: 'ea_1', opportunity_id: 'eo_solar', opportunity_title: 'Solar Installer — Paymax Field Agent', learner_id: 'usr_aa01', learner_name: 'Ada Okafor', credential_serial: 'SPL-SOLAR-2026-00112', status: 'routed', submitted_at: iso(28) },
  { id: 'ea_2', opportunity_id: 'eo_solar', opportunity_title: 'Solar Installer — Paymax Field Agent', learner_id: 'usr_dd04', learner_name: 'Ngozi Eze', credential_serial: 'SPL-SOLAR-2024-00009', status: 'rejected', submitted_at: iso(20) },
  { id: 'ea_3', opportunity_id: 'eo_phleb', opportunity_title: 'Mobile Phlebotomist — Paymax Health Rail', learner_id: 'usr_cc03', learner_name: 'Chidi Nwankwo', credential_serial: null, status: 'submitted', submitted_at: iso(6) },
  { id: 'ea_4', opportunity_id: 'eo_phleb', opportunity_title: 'Mobile Phlebotomist — Paymax Health Rail', learner_id: 'usr_ee05', learner_name: 'Tunde Bello', credential_serial: 'SPL-PHLEB-2026-00045', status: 'eligible', submitted_at: iso(2) },
];

export async function listCredentialTemplates(): Promise<CredentialTemplate[]> {
  if (USE_MOCK) { await delay(); return CREDENTIAL_TEMPLATES.map((t) => ({ ...t })); }
  // TODO(no backend route): credentials admin has revoke + earning opportunities only; there is no
  // credential-templates endpoint (list or create). Mock.
  return getJson<CredentialTemplate[]>('/admin/credentials/templates');
}
export async function createCredentialTemplate(input: CredentialTemplateInput): Promise<CredentialTemplate> {
  if (USE_MOCK) throw new Error(`Creating a credential template ${NO_BACKEND_YET}`);
  // TODO(no backend route): no credential-template create endpoint. Mock.
  return sendJson<CredentialTemplate>('POST', '/admin/credentials/templates', input);
}
export async function listIssuedCredentials(): Promise<IssuedCredential[]> {
  if (USE_MOCK) { await delay(); return ISSUED_CREDENTIALS.map((c) => ({ ...c })); }
  // TODO(no backend route): no admin GET issued-credentials list — issued credentials are read as
  // member routes (GET /credentials, /credentials/:id). Only admin revoke exists. Mock.
  return getJson<IssuedCredential[]>('/admin/credentials/issued');
}
export async function revokeCredential(input: CredentialRevokeInput): Promise<IssuedCredential> {
  if (USE_MOCK) throw new Error(`Revoking a credential ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /credentials/:id/revoke (credentials.AdminRevoke) — no "/issued" segment.
  return sendJson<IssuedCredential>('POST', `/admin/credentials/${input.id}/revoke`, input);
}
export async function verifyCredential(query: string): Promise<CredentialVerification> {
  if (USE_MOCK) {
    await delay();
    const q = query.trim().toLowerCase();
    const found = ISSUED_CREDENTIALS.find((c) => c.serial.toLowerCase() === q || c.learner_id.toLowerCase() === q || c.learner_name.toLowerCase().includes(q));
    return { found: !!found, serial: query.trim(), credential: found ? { ...found } : null, verified_at: new Date().toISOString() };
  }
  // TODO(no backend route): credential verification is a MEMBER route keyed by verification id
  // (GET /credentials/verify/:verificationId), not an admin query-search endpoint. Mock.
  return getJson<CredentialVerification>(`/admin/credentials/verify?q=${encodeURIComponent(query)}`);
}
export async function listEarningOpportunities(): Promise<EarningOpportunity[]> {
  if (USE_MOCK) { await delay(); return EARNING_OPPORTUNITIES.map((o) => ({ ...o })); }
  return getJson<EarningOpportunity[]>('/admin/earning/opportunities');
}
export async function createEarningOpportunity(input: EarningOpportunityInput): Promise<EarningOpportunity> {
  if (USE_MOCK) throw new Error(`Creating an earning opportunity ${NOT_IN_FIXTURE_MODE}`);
  return sendJson<EarningOpportunity>('POST', '/admin/earning/opportunities', input);
}
export async function listEarningApplications(): Promise<EarningApplication[]> {
  if (USE_MOCK) { await delay(); return EARNING_APPLICATIONS.map((a) => ({ ...a })); }
  // TODO(no backend route): credentials admin exposes earning OPPORTUNITIES (list/create/update)
  // but no earning-APPLICATIONS list endpoint. Mock.
  return getJson<EarningApplication[]>('/admin/earning/applications');
}

// ════════════════════════ LIVE & EVENTS ════════════════════════
// RBAC: academy.live — /api/academy/admin/live/*
const LIVE_SESSIONS: LiveSession[] = [
  { id: 'ls_phy', title: 'UTME Physics Crash Class', subject: 'Physics', host: 'A. Bello', status: 'scheduled', starts_at: iso(-24), duration_min: 90, registered: 1240, peak_viewers: null, stream_provider: 'hls', ingest_url: 'rtmps://ingest.spotlight.tv/live/****a91', replay_status: 'none', replay_id: null },
  { id: 'ls_chem', title: 'Stoichiometry Live Solve', subject: 'Chemistry', host: 'C. Okonkwo', status: 'live', starts_at: iso(1), duration_min: 60, registered: 880, peak_viewers: 642, stream_provider: 'webrtc', ingest_url: 'rtmps://ingest.spotlight.tv/live/****b22', replay_status: 'none', replay_id: null },
  { id: 'ls_eng', title: 'WAEC English Comprehension Clinic', subject: 'English Language', host: 'T. Wodu', status: 'ended', starts_at: iso(48), duration_min: 75, registered: 2100, peak_viewers: 1510, stream_provider: 'hls', ingest_url: 'rtmps://ingest.spotlight.tv/live/****c03', replay_status: 'ready', replay_id: 'rp_eng' },
  { id: 'ls_math', title: 'Quadratics Masterclass', subject: 'Mathematics', host: 'E. Adeyemi', status: 'ended', starts_at: iso(120), duration_min: 80, registered: 1760, peak_viewers: 1190, stream_provider: 'rtmp', ingest_url: 'rtmps://ingest.spotlight.tv/live/****d44', replay_status: 'processing', replay_id: 'rp_math' },
];

const LIVE_REPLAYS: LiveReplay[] = [
  { id: 'rp_eng', session_id: 'ls_eng', title: 'WAEC English Comprehension Clinic', status: 'ready', duration_min: 75, size_mb: 410, views: 5820, published: true, created_at: iso(47) },
  { id: 'rp_math', session_id: 'ls_math', title: 'Quadratics Masterclass', status: 'processing', duration_min: 80, size_mb: 0, views: 0, published: false, created_at: iso(119) },
];

export async function listLiveSessions(): Promise<LiveSession[]> {
  if (USE_MOCK) { await delay(); return LIVE_SESSIONS.map((s) => ({ ...s })); }
  // TODO(no backend route): live-session LISTING is a MEMBER route (GET /academy/live/sessions);
  // the live admin group only has schedule/start/end/cancel (no admin list). Mock.
  // (scheduleLiveSession below is correctly wired to POST /admin/live/sessions.)
  return getJson<LiveSession[]>('/admin/live/sessions');
}
export async function scheduleLiveSession(input: LiveSessionInput): Promise<LiveSession> {
  if (USE_MOCK) throw new Error(`Scheduling a live session ${NOT_IN_FIXTURE_MODE}`);
  return sendJson<LiveSession>('POST', '/admin/live/sessions', input);
}
export async function listLiveReplays(): Promise<LiveReplay[]> {
  if (USE_MOCK) { await delay(); return LIVE_REPLAYS.map((r) => ({ ...r })); }
  // TODO(no backend route): the live module has no replays endpoint (VOD/replay is not wired). Mock.
  return getJson<LiveReplay[]>('/admin/live/replays');
}

// ════════════════════════ MODERATION & TRUST/SAFETY ════════════════════════
// RBAC: academy.moderation — /api/academy/admin/moderation/*
// Reports queue: open → triaged → actioned | dismissed | escalated.
const MODERATION_REPORTS: ModerationReport[] = [
  { id: 'mr_1', entity_type: 'comment', entity_ref: 'cmt_88102', entity_label: 'Comment on "Motion: Velocity-Time Graphs"', reason: 'harassment', reporter_id: 'usr_bb02', severity: 'medium', child_safety: false, state: 'open', decision: null, assignee: null, notes: null, created_at: iso(3), updated_at: iso(3) },
  { id: 'mr_2', entity_type: 'profile', entity_ref: 'usr_zz99', entity_label: 'Profile @fastcash_tutor', reason: 'csae', reporter_id: 'usr_aa01', severity: 'critical', child_safety: true, state: 'escalated', decision: null, assignee: 'Trust Lead', notes: 'Referred to child-safety desk + NCMEC pipeline.', created_at: iso(8), updated_at: iso(2) },
  { id: 'mr_3', entity_type: 'live_chat', entity_ref: 'lc_ls_chem_441', entity_label: 'Live chat — Stoichiometry Live Solve', reason: 'spam', reporter_id: 'usr_cc03', severity: 'low', child_safety: false, state: 'actioned', decision: 'hide', assignee: 'Mod A', notes: 'Repeated promo links hidden.', created_at: iso(20), updated_at: iso(18) },
  { id: 'mr_4', entity_type: 'content', entity_ref: 'cnt_eng_pos', entity_label: 'Lesson — Parts of Speech (Series Ep. 3)', reason: 'copyright', reporter_id: 'usr_dd04', severity: 'high', child_safety: false, state: 'triaged', decision: null, assignee: 'Mod B', notes: 'Checking licence with content team.', created_at: iso(30), updated_at: iso(26) },
  { id: 'mr_5', entity_type: 'question', entity_ref: 'q_004', entity_label: 'Question item q_004 (English)', reason: 'incorrect_answer', reporter_id: 'usr_ee05', severity: 'low', child_safety: false, state: 'dismissed', decision: 'dismiss', assignee: 'Mod A', notes: 'Answer key verified correct.', created_at: iso(50), updated_at: iso(48) },
];

export async function listModerationReports(): Promise<ModerationReport[]> {
  if (USE_MOCK) { await delay(); return MODERATION_REPORTS.map((r) => ({ ...r })); }
  return getJson<ModerationReport[]>('/admin/moderation/reports');
}
export async function triageModerationReport(input: ModerationTriageInput): Promise<ModerationReport> {
  if (USE_MOCK) throw new Error(`Triaging a moderation report ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /moderation/reports/:id/triage (live.AdminTriageReport) — the OLD "there is NO
  // /triage transition" comment here was wrong; the route exists and is registered (liveEnabled),
  // it was just never checked against the actual Go route list before.
  return sendJson<ModerationReport>('POST', `/admin/moderation/reports/${input.id}/triage`, input);
}
export async function decideModerationReport(input: ModerationDecisionInput): Promise<ModerationReport> {
  if (USE_MOCK) throw new Error(`Deciding a moderation report ${NOT_IN_FIXTURE_MODE}`);
  return sendJson<ModerationReport>('POST', `/admin/moderation/reports/${input.id}/decide`, input);
}
export async function escalateModerationReport(input: ModerationEscalateInput): Promise<ModerationReport> {
  if (USE_MOCK) throw new Error(`Escalating a moderation report ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /moderation/reports/:id/escalate (live.AdminEscalateReport) — the OLD "no
  // /escalate endpoint" comment here was wrong; the route exists and is registered (liveEnabled),
  // it was just never checked against the actual Go route list before.
  return sendJson<ModerationReport>('POST', `/admin/moderation/reports/${input.id}/escalate`, input);
}

// ════════════════════════════════════════════════════════════════════════════
//                              PHASE 4 MODULES
//   Partnerships, marketplace ops & BI depth (admin-console.md §6/§7)
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════ SCHOOL & INSTITUTION MGMT ════════════════════════
// RBAC: academy.schools — /api/academy/admin/schools/*
// B2B2C institutions, seat-based licences, class groups, seat-capped bulk
// enrolment, white-label config, and usage billing. Licences are seat-metered;
// enrolment fails-closed at the seat cap. Invoices are generated then charged.
const INSTITUTIONS: Institution[] = [
  { id: 'inst_brightstars', name: 'Bright Stars Academy', type: 'school', state: 'Lagos', contact_name: 'Mrs. Adeola Smith', contact_email: 'admin@brightstars.ng', status: 'active', learners: 1180, class_groups: 14, created_at: iso(900) },
  { id: 'inst_unityhigh', name: 'Unity High School', type: 'school', state: 'Oyo', contact_name: 'Mr. Femi Lawal', contact_email: 'office@unityhigh.ng', status: 'active', learners: 720, class_groups: 9, created_at: iso(500) },
  { id: 'inst_futurecollege', name: 'Future Leaders College', type: 'college', state: 'Abuja', contact_name: 'Dr. Hauwa Bello', contact_email: 'principal@futureleaders.ng', status: 'onboarding', learners: 0, class_groups: 0, created_at: iso(12) },
  { id: 'inst_brighter_ngo', name: 'Brighter Futures NGO', type: 'ngo', state: 'Kano', contact_name: 'Aisha Yusuf', contact_email: 'programs@brighterfutures.org', status: 'active', learners: 340, class_groups: 5, created_at: iso(220) },
  { id: 'inst_zenithcorp', name: 'Zenith Talent Academy', type: 'corporate', state: 'Lagos', contact_name: 'Tunde Bakare', contact_email: 'lnd@zenithtalent.com', status: 'suspended', learners: 90, class_groups: 2, created_at: iso(1200) },
];

const LICENCES: Licence[] = [
  { id: 'lic_bs_pro', institution_id: 'inst_brightstars', plan_id: 'plan_pro', plan_name: 'Academy Pro (Exam Prep)', seats_total: 1200, seats_used: 1180, status: 'active', starts_on: dateStr(-200), expires_on: dateStr(160), price_per_seat_kobo: naira(6_000), created_at: iso(200 * 24) },
  { id: 'lic_uh_basic', institution_id: 'inst_unityhigh', plan_id: 'plan_basic', plan_name: 'Academy Basic', seats_total: 800, seats_used: 720, status: 'active', starts_on: dateStr(-120), expires_on: dateStr(240), price_per_seat_kobo: naira(1_500), created_at: iso(120 * 24) },
  { id: 'lic_fl_trial', institution_id: 'inst_futurecollege', plan_id: 'plan_pro', plan_name: 'Academy Pro (Exam Prep)', seats_total: 50, seats_used: 0, status: 'trial', starts_on: dateStr(-10), expires_on: dateStr(20), price_per_seat_kobo: naira(6_000), created_at: iso(12 * 24) },
  { id: 'lic_ngo_basic', institution_id: 'inst_brighter_ngo', plan_id: 'plan_basic', plan_name: 'Academy Basic', seats_total: 400, seats_used: 340, status: 'active', starts_on: dateStr(-90), expires_on: dateStr(275), price_per_seat_kobo: naira(1_500), created_at: iso(90 * 24) },
  { id: 'lic_zen_pro', institution_id: 'inst_zenithcorp', plan_id: 'plan_pro', plan_name: 'Academy Pro (Exam Prep)', seats_total: 150, seats_used: 90, status: 'suspended', starts_on: dateStr(-365), expires_on: dateStr(-5), price_per_seat_kobo: naira(6_000), created_at: iso(365 * 24) },
];

const CLASS_GROUPS: ClassGroup[] = [
  { id: 'cg_bs_ss3_gold', institution_id: 'inst_brightstars', name: 'SS 3 — Gold', teacher: 'Mr. Okeke', learners: 42, exam_focus: 'WASSCE', created_at: iso(180 * 24) },
  { id: 'cg_bs_ss3_silver', institution_id: 'inst_brightstars', name: 'SS 3 — Silver', teacher: 'Mrs. Bassey', learners: 38, exam_focus: 'WASSCE', created_at: iso(180 * 24) },
  { id: 'cg_bs_jss3', institution_id: 'inst_brightstars', name: 'JSS 3 — Eagles', teacher: 'Mr. Danjuma', learners: 45, exam_focus: 'BECE', created_at: iso(170 * 24) },
  { id: 'cg_uh_ss3', institution_id: 'inst_unityhigh', name: 'SS 3 — A', teacher: 'Mrs. Lawal', learners: 40, exam_focus: 'WASSCE', created_at: iso(110 * 24) },
  { id: 'cg_ngo_utme', institution_id: 'inst_brighter_ngo', name: 'UTME Bridge Cohort', teacher: 'Mr. Sani', learners: 30, exam_focus: 'UTME', created_at: iso(80 * 24) },
];

const WHITE_LABEL: WhiteLabelConfig[] = [
  { institution_id: 'inst_brightstars', subdomain: 'brightstars.spotlight.academy', brand_name: 'Bright Stars Learning', primary_color: '#0b5d3b', logo_url: 'https://cdn.spotlight.academy/wl/brightstars.png', custom_domain: 'learn.brightstars.ng', support_email: 'help@brightstars.ng', hide_spotlight_branding: true, updated_at: iso(60) },
  { institution_id: 'inst_unityhigh', subdomain: 'unityhigh.spotlight.academy', brand_name: 'Unity High Online', primary_color: '#1d4ed8', logo_url: 'https://cdn.spotlight.academy/wl/unityhigh.png', custom_domain: null, support_email: 'support@unityhigh.ng', hide_spotlight_branding: false, updated_at: iso(120) },
];

const INVOICES: Invoice[] = [
  { id: 'inv_bs_may26', institution_id: 'inst_brightstars', period: 'May 2026', seats_billed: 1180, amount_kobo: naira(1180 * 6_000), status: 'paid', issued_on: dateStr(-58), due_on: dateStr(-44), paid_on: dateStr(-47) },
  { id: 'inv_bs_jun26', institution_id: 'inst_brightstars', period: 'June 2026', seats_billed: 1180, amount_kobo: naira(1180 * 6_000), status: 'issued', issued_on: dateStr(-2), due_on: dateStr(12), paid_on: null },
  { id: 'inv_uh_jun26', institution_id: 'inst_unityhigh', period: 'June 2026', seats_billed: 720, amount_kobo: naira(720 * 1_500), status: 'overdue', issued_on: dateStr(-35), due_on: dateStr(-5), paid_on: null },
  { id: 'inv_ngo_jun26', institution_id: 'inst_brighter_ngo', period: 'June 2026', seats_billed: 340, amount_kobo: naira(340 * 1_500), status: 'draft', issued_on: null, due_on: dateStr(14), paid_on: null },
];

export async function getSchoolsOverview(): Promise<SchoolsOverview> {
  if (USE_MOCK) {
    await delay();
    const active = INSTITUTIONS.filter((i) => i.status === 'active');
    const seatsSold = LICENCES.reduce((s, l) => s + l.seats_total, 0);
    const seatsUsed = LICENCES.reduce((s, l) => s + l.seats_used, 0);
    const mrr = LICENCES.filter((l) => l.status === 'active').reduce((s, l) => s + l.seats_used * l.price_per_seat_kobo, 0);
    const outstanding = INVOICES.filter((i) => i.status === 'issued' || i.status === 'overdue').reduce((s, i) => s + i.amount_kobo, 0);
    return { institutions_total: INSTITUTIONS.length, institutions_active: active.length, seats_sold: seatsSold, seats_used: seatsUsed, learners_total: INSTITUTIONS.reduce((s, i) => s + i.learners, 0), mrr_kobo: mrr, outstanding_kobo: outstanding };
  }
  // TODO(no backend route): schools admin exposes only per-institution overview
  // (GET /schools/admin/institutions/:id/overview); there is no cross-institution aggregate
  // overview endpoint. Mock.
  return getJson<SchoolsOverview>('/admin/schools/overview');
}
export async function listInstitutions(): Promise<Institution[]> {
  if (USE_MOCK) { await delay(); return INSTITUTIONS.map((i) => ({ ...i })); }
  // backend: GET /schools/admin/institutions (schools admin group is admin.Group("/schools/admin")).
  return getJson<Institution[]>('/admin/schools/admin/institutions');
}
export async function createInstitution(input: InstitutionInput): Promise<Institution> {
  if (USE_MOCK) throw new Error(`Creating an institution ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /schools/admin/institutions (schools.AdminOnboard).
  return sendJson<Institution>('POST', '/admin/schools/admin/institutions', input);
}
export async function listLicences(): Promise<Licence[]> {
  if (USE_MOCK) { await delay(); return LICENCES.map((l) => ({ ...l })); }
  // TODO(no backend route): schools admin has no GET licences list — only POST /licences and the
  // lifecycle verbs (suspend/reactivate/expire). A licences list endpoint is needed. Mock.
  return getJson<Licence[]>('/admin/schools/licences');
}
export async function issueLicence(input: LicenceIssueInput): Promise<Licence> {
  if (USE_MOCK) throw new Error(`Issuing a licence ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /schools/admin/licences (schools.AdminIssueLicence).
  return sendJson<Licence>('POST', '/admin/schools/admin/licences', input);
}
export async function manageLicence(input: LicenceManageInput): Promise<Licence> {
  if (USE_MOCK) throw new Error(`Managing a licence ${NOT_IN_FIXTURE_MODE}`);
  // backend: licence lifecycle is split into discrete POST verbs, not a PATCH:
  //   POST /schools/admin/licences/:id/suspend | /reactivate | /expire (schools handler).
  // Map the action → verb for the two verbs the frontend exposes.
  if (input.action === 'suspend' || input.action === 'reactivate') {
    return sendJson<Licence>('POST', `/admin/schools/admin/licences/${input.id}/${input.action}`, input);
  }
  // TODO(no backend route): "set_seats" (licence seat-count change) has NO backend endpoint — the
  // schools admin surface only supports suspend/reactivate/expire lifecycle transitions. Mock.
  return sendJson<Licence>('POST', `/admin/schools/admin/licences/${input.id}/set-seats`, input);
}
export async function listClassGroups(): Promise<ClassGroup[]> {
  if (USE_MOCK) { await delay(); return CLASS_GROUPS.map((c) => ({ ...c })); }
  // TODO(no backend route): class-groups are listed per-institution only
  // (GET /schools/admin/institutions/:id/class-groups); there is no flat cross-institution
  // class-groups list. This function takes no institution id, so no route matches. Mock.
  return getJson<ClassGroup[]>('/admin/schools/class-groups');
}
export async function createClassGroup(input: ClassGroupInput): Promise<ClassGroup> {
  if (USE_MOCK) throw new Error(`Creating a class group ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /schools/admin/class-groups (schools.AdminCreateClassGroup).
  return sendJson<ClassGroup>('POST', '/admin/schools/admin/class-groups', input);
}
export async function bulkEnrol(input: BulkEnrolInput): Promise<BulkEnrolResult> {
  if (USE_MOCK) throw new Error(`Bulk-enrolling learners ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /schools/admin/enrollments/bulk (US spelling "enrollments"; schools.AdminBulkEnroll).
  return sendJson<BulkEnrolResult>('POST', '/admin/schools/admin/enrollments/bulk', input);
}
export async function getWhiteLabelConfig(institutionId: string): Promise<WhiteLabelConfig> {
  if (USE_MOCK) {
    await delay();
    const found = WHITE_LABEL.find((w) => w.institution_id === institutionId);
    if (found) return { ...found };
    const inst = INSTITUTIONS.find((i) => i.id === institutionId);
    return { institution_id: institutionId, subdomain: '', brand_name: inst?.name ?? '', primary_color: '#340075', logo_url: '', custom_domain: null, support_email: inst?.contact_email ?? '', hide_spotlight_branding: false, updated_at: new Date().toISOString() };
  }
  // TODO(no backend route): schools admin exposes no white-label config endpoints (GET or PUT).
  // White-label branding is not yet wired on the backend. Mock.
  return getJson<WhiteLabelConfig>(`/admin/schools/${institutionId}/white-label`);
}
export async function saveWhiteLabelConfig(input: WhiteLabelConfigInput): Promise<WhiteLabelConfig> {
  if (USE_MOCK) throw new Error(`Saving white-label config ${NO_BACKEND_YET}`);
  // TODO(no backend route): no white-label save endpoint on schools admin. Mock.
  return sendJson<WhiteLabelConfig>('PUT', `/admin/schools/${input.institution_id}/white-label`, input);
}
export async function listInvoices(): Promise<Invoice[]> {
  if (USE_MOCK) { await delay(); return INVOICES.map((i) => ({ ...i })); }
  // TODO(no backend route): schools admin has no GET billing/invoices list — only
  // POST /schools/admin/billing and POST /schools/admin/billing/:id/charge. A list endpoint
  // is needed. Mock.
  return getJson<Invoice[]>('/admin/schools/invoices');
}
export async function generateInvoice(input: InvoiceGenerateInput): Promise<Invoice> {
  if (USE_MOCK) throw new Error(`Generating an invoice ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /schools/admin/billing (schools.AdminGenerateBilling) — "billing", not "invoices".
  return sendJson<Invoice>('POST', '/admin/schools/admin/billing', input);
}
export async function chargeInvoice(input: InvoiceChargeInput): Promise<Invoice> {
  if (USE_MOCK) throw new Error(`Charging an invoice ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /schools/admin/billing/:id/charge (schools.AdminChargeBilling).
  return sendJson<Invoice>('POST', `/admin/schools/admin/billing/${input.id}/charge`, input);
}

// ════════════════════════ TUTOR & MARKETPLACE OPS ════════════════════════
// RBAC: academy.tutor — /api/academy/admin/tutors/*
// Vetting: applied → in_review → verified | rejected; verified ↔ suspended.
const TUTORS: Tutor[] = [
  { id: 'tut_okeke', display_name: 'James Okeke', email: 'j.okeke@tutors.ng', subjects: ['Physics', 'Mathematics'], vetting: 'verified', kyc: 'tier2', rating_avg: 4.7, ratings_count: 312, sessions_delivered: 1840, open_disputes: 0, joined_at: iso(700 * 24), updated_at: iso(40) },
  { id: 'tut_bassey', display_name: 'Grace Bassey', email: 'g.bassey@tutors.ng', subjects: ['Chemistry', 'Biology'], vetting: 'verified', kyc: 'tier2', rating_avg: 4.5, ratings_count: 198, sessions_delivered: 1120, open_disputes: 1, joined_at: iso(500 * 24), updated_at: iso(20) },
  { id: 'tut_sani', display_name: 'Musa Sani', email: 'm.sani@tutors.ng', subjects: ['English Language'], vetting: 'in_review', kyc: 'tier1', rating_avg: 0, ratings_count: 0, sessions_delivered: 0, open_disputes: 0, joined_at: iso(6 * 24), updated_at: iso(6) },
  { id: 'tut_amaka', display_name: 'Amaka Obi', email: 'a.obi@tutors.ng', subjects: ['Mathematics', 'Further Mathematics'], vetting: 'applied', kyc: 'tier0', rating_avg: 0, ratings_count: 0, sessions_delivered: 0, open_disputes: 0, joined_at: iso(2 * 24), updated_at: iso(2) },
  { id: 'tut_tunde', display_name: 'Tunde Falana', email: 't.falana@tutors.ng', subjects: ['Government', 'Economics'], vetting: 'suspended', kyc: 'tier2', rating_avg: 3.2, ratings_count: 64, sessions_delivered: 280, open_disputes: 2, joined_at: iso(900 * 24), updated_at: iso(72) },
];

const TUTOR_PAYOUTS: TutorPayout[] = [
  { id: 'tp_1', tutor_id: 'tut_okeke', tutor_name: 'James Okeke', amount_kobo: naira(420_000), period: 'May 2026', status: 'paid', bank_account: '****3021 · GTBank', requested_at: iso(40 * 24), settled_at: iso(37 * 24), failure_reason: null },
  { id: 'tp_2', tutor_id: 'tut_bassey', tutor_name: 'Grace Bassey', amount_kobo: naira(265_000), period: 'May 2026', status: 'paid', bank_account: '****7744 · Access', requested_at: iso(40 * 24), settled_at: iso(36 * 24), failure_reason: null },
  { id: 'tp_3', tutor_id: 'tut_okeke', tutor_name: 'James Okeke', amount_kobo: naira(390_000), period: 'June 2026', status: 'requested', bank_account: '****3021 · GTBank', requested_at: iso(3 * 24), settled_at: null, failure_reason: null },
  { id: 'tp_4', tutor_id: 'tut_bassey', tutor_name: 'Grace Bassey', amount_kobo: naira(210_000), period: 'June 2026', status: 'processing', bank_account: '****7744 · Access', requested_at: iso(2 * 24), settled_at: null, failure_reason: null },
  { id: 'tp_5', tutor_id: 'tut_tunde', tutor_name: 'Tunde Falana', amount_kobo: naira(58_000), period: 'May 2026', status: 'failed', bank_account: '****9032 · UBA', requested_at: iso(38 * 24), settled_at: null, failure_reason: 'Bank account name mismatch — KYC review required.' },
];

const TUTOR_DISPUTES: TutorDispute[] = [
  { id: 'td_1', tutor_id: 'tut_bassey', tutor_name: 'Grace Bassey', learner_name: 'Ada Okafor', reason: 'no_show', detail: 'Tutor missed a scheduled 1:1 session.', status: 'investigating', note: 'Reached out to tutor; awaiting calendar logs.', created_at: iso(30), updated_at: iso(10) },
  { id: 'td_2', tutor_id: 'tut_tunde', tutor_name: 'Tunde Falana', learner_name: 'Bola Adeyemi', reason: 'quality', detail: 'Learner reports off-syllabus content and poor preparation.', status: 'open', note: null, created_at: iso(8), updated_at: iso(8) },
  { id: 'td_3', tutor_id: 'tut_tunde', tutor_name: 'Tunde Falana', learner_name: 'Chidi Nwankwo', reason: 'billing', detail: 'Charged for a session that was cancelled in time.', status: 'open', note: null, created_at: iso(5), updated_at: iso(5) },
  { id: 'td_4', tutor_id: 'tut_okeke', tutor_name: 'James Okeke', learner_name: 'Ngozi Eze', reason: 'quality', detail: 'Minor complaint, later withdrawn by learner.', status: 'resolved', note: 'Learner withdrew complaint; no action.', created_at: iso(120), updated_at: iso(96) },
];

export async function listTutors(): Promise<Tutor[]> {
  if (USE_MOCK) { await delay(); return TUTORS.map((t) => ({ ...t, subjects: [...t.subjects] })); }
  // TODO(no backend route): tutor listing is a MEMBER route (GET /api/finance/academy/tutors);
  // the tutor admin surface has no GET tutors list. Not reachable from the admin base. Mock.
  return getJson<Tutor[]>('/admin/tutors');
}
export async function vetTutor(input: TutorVetInput): Promise<Tutor> {
  if (USE_MOCK) throw new Error(`Vetting a tutor ${NOT_IN_FIXTURE_MODE}`);
  // backend: tutor vetting is split into POST /tutor/:id/verify and POST /tutor/:id/suspend
  // (singular "tutor" segment; tutor.AdminVerify / AdminSuspend). Map action → verb; treat
  // "reactivate" as a re-verify.
  // "reject" has NO backend endpoint — only verify/suspend exist. This used to silently fall
  // through to /verify, which is actively dangerous: an operator clicking "Reject" on a bad
  // tutor application would have VERIFIED them instead, the exact opposite of the intended
  // effect. Refuse instead of guessing at a mapping that inverts the operator's decision.
  if (input.action === 'reject') {
    throw new Error(`Rejecting a tutor ${NO_BACKEND_YET} A dedicated reject endpoint is needed — mapping "reject" to /verify would do the opposite of what the operator asked for.`);
  }
  const verb = input.action === 'suspend' ? 'suspend' : 'verify';
  return sendJson<Tutor>('POST', `/admin/tutor/${input.id}/${verb}`, input);
}
export async function listTutorPayouts(): Promise<TutorPayout[]> {
  if (USE_MOCK) { await delay(); return TUTOR_PAYOUTS.map((p) => ({ ...p })); }
  // backend: GET /tutor/payouts (singular "tutor"; tutor.AdminListPayouts).
  return getJson<TutorPayout[]>('/admin/tutor/payouts');
}
export async function listTutorDisputes(): Promise<TutorDispute[]> {
  if (USE_MOCK) { await delay(); return TUTOR_DISPUTES.map((d) => ({ ...d })); }
  // TODO(no backend route): the tutor package has no disputes endpoints (list or mutate). Mock.
  return getJson<TutorDispute[]>('/admin/tutors/disputes');
}
export async function noteTutorDispute(input: TutorDisputeNoteInput): Promise<TutorDispute> {
  if (USE_MOCK) throw new Error(`Noting a tutor dispute ${NO_BACKEND_YET}`);
  // TODO(no backend route): no tutor dispute route exists on the backend. Mock.
  return sendJson<TutorDispute>('PATCH', `/admin/tutors/disputes/${input.id}`, input);
}

// ════════════════════════ ANALYTICS & BI DEPTH ════════════════════════
// RBAC: academy.analyst (or academy.admin) — /api/academy/admin/analytics/*
// Aggregate dashboards over outcome/engagement/retention/funnel/revenue/exam,
// cohort analysis, and CSV export. Mock returns a deterministic dataset shaped by
// the requested date range (range only labels the data here).
function buildBiDashboard(range: BiDateRange): BiDashboard {
  return {
    range,
    kpis: {
      active_learners: 48230,
      new_signups: 9120,
      pass_rate: 0.671,
      d30_retention: 0.412,
      revenue_kobo: naira(19_870_000),
      avg_readiness: 0.642,
    },
    outcome: [
      { label: 'Mathematics', value: 0.61 }, { label: 'English', value: 0.74 },
      { label: 'Physics', value: 0.58 }, { label: 'Chemistry', value: 0.63 },
      { label: 'Biology', value: 0.69 },
    ],
    engagement: trend(8, 6000, 1200).map((p) => ({ label: p.date.slice(5), value: p.value })),
    retention: [
      { label: 'D1', value: 0.82 }, { label: 'D7', value: 0.61 }, { label: 'D14', value: 0.50 },
      { label: 'D30', value: 0.41 }, { label: 'D60', value: 0.33 }, { label: 'D90', value: 0.28 },
    ],
    funnel: [
      { label: 'Signups', value: 9120 }, { label: 'Activated', value: 6840 },
      { label: 'Subscribed', value: 2980 }, { label: 'Exam-ready', value: 1610 },
    ],
    revenue: [
      { label: 'Subscriptions', value: naira(11_200_000) }, { label: 'Exam bundles', value: naira(5_100_000) },
      { label: 'Access cards', value: naira(2_400_000) }, { label: 'School licences', value: naira(1_170_000) },
    ],
    exam: [
      { label: 'UTME', value: 0.66 }, { label: 'WASSCE', value: 0.62 },
      { label: 'NECO', value: 0.59 }, { label: 'BECE', value: 0.71 },
    ],
  };
}

const BI_COHORTS: BiCohortRow[] = [
  { cohort: 'Jan 2026 signups', size: 7420, retention: [0.84, 0.62, 0.44, 0.36, 0.30] },
  { cohort: 'Feb 2026 signups', size: 8110, retention: [0.86, 0.65, 0.47, 0.38, 0.31] },
  { cohort: 'Mar 2026 signups', size: 9240, retention: [0.83, 0.60, 0.42, 0.34, 0.27] },
  { cohort: 'Apr 2026 signups', size: 8650, retention: [0.85, 0.63, 0.45, 0.37, 0.0] },
  { cohort: 'May 2026 signups', size: 9120, retention: [0.87, 0.66, 0.0, 0.0, 0.0] },
];

export async function getBiDashboard(range: BiDateRange): Promise<BiDashboard> {
  if (USE_MOCK) { await delay(); return buildBiDashboard(range); }
  // TODO(no backend route): no analytics/BI module on the backend (dashboard/cohorts/export). Mock.
  return getJson<BiDashboard>(`/admin/analytics/dashboard?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`);
}
export async function getBiCohorts(range: BiDateRange): Promise<BiCohortRow[]> {
  if (USE_MOCK) { await delay(); return BI_COHORTS.map((c) => ({ ...c, retention: [...c.retention] })); }
  // TODO(no backend route): no analytics cohorts endpoint. Mock.
  return getJson<BiCohortRow[]>(`/admin/analytics/cohorts?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`);
}
export async function exportBi(input: BiExportInput): Promise<BiExportResult> {
  if (USE_MOCK) throw new Error(`Exporting BI data ${NO_BACKEND_YET}`);
  // TODO(no backend route): no analytics export endpoint. Mock.
  return sendJson<BiExportResult>('POST', '/admin/analytics/export', input);
}
