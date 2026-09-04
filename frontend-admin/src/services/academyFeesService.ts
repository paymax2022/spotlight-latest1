// ── EdTech School-Fees — school-admin console service ─────────────────────────
// Brownfield: copies academyAdminService.ts EXACTLY.
//  • adminBase() rewrites env.apiBaseUrl (…/api/v1) → …/api/academy
//  • authHeaders() attaches the admin Bearer token from localStorage
//  • getJson/sendJson unwrap { data } and throw on non-2xx
// Live calls target the academy fees admin routes: /api/academy/admin/fees/*
// Per-route RBAC (academy.fees.*) is carried by the admin session token.
// Mock by default (NEXT_PUBLIC_ACADEMY_USE_MOCK) so the console renders without
// the Go backend. Every state-change is audit-logged server-side (module
// 'academy.fees'). All money in kobo. Invariants surfaced: SF-1 (FeeSchedule
// immutable once issued), SF-3 (two-approval promotion), SF-9 (human hardship
// review), SF-11 (opt-in, immutably-logged government export).

import { env } from '@/config/env';
import type {
  FeesSchool, FeesSchoolInput,
  FeesSession, FeesSessionInput,
  FeesClass, FeesClassInput,
  FeeSchedule, FeeScheduleInput, FeeScheduleIssueResult,
  OnboardingRow, OnboardingBatch, OnboardingApproveInput,
  CollectionsOverview, InvoiceRow,
  HardshipRequest, HardshipDecisionInput,
  PromotionBatch, PromotionApproveInput, PromotionStatus,
  Competition, CompetitionRegistration, CompetitionRegisterInput,
  GovExportOptIn, GovExportOptInInput, ComplianceExport, ComplianceExportInput,
  DataCategory,
  SchoolRoleGrant, RoleAssignInput, RoleRevokeInput, SchoolRole,
} from '@/types/academyFees';

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

// Verified against backend/internal/academy/fees/**/handler.go route registrations.
// Some functions below have a real, RBAC-gated route (some behind stale "no backend
// route" comments that were wrong — the route existed, it was just never re-checked);
// those throw NOT_IN_FIXTURE_MODE. A few have no backend route at all, or the real
// route's request shape cannot be built from what this file's input types carry
// (see each function's own comment); those throw NO_BACKEND_YET instead, since
// flipping the mock flag would not reach a working call either way. See
// docs/audit/ADMIN_SIMULATED_WRITES.md.
const NOT_IN_FIXTURE_MODE =
  'is unavailable in fixture mode: this console will not report a write it did not perform. ' +
  'Set NEXT_PUBLIC_ACADEMY_USE_MOCK=false to make this change against the live backend.';
const NO_BACKEND_YET =
  'has no backend yet (see the comment on the live-mode call below). ' +
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

// ════════════════════ SC-29 · SETUP WIZARD (school → session → class → fee schedule) ════════════════════
// RBAC: academy.fees.setup — /api/academy/admin/fees/*
export const PROMOTION_FLOW: PromotionStatus[] = [
  'results_finalized', 'promotion_computed', 'promotion_reviewed', 'promotion_approved', 'applied',
];
export const COMPETITION_FLOW = [
  'draft', 'open_registration', 'registration_closed', 'in_progress', 'results_pending', 'completed', 'archived',
] as const;
export const DATA_CATEGORIES: { key: DataCategory; label: string }[] = [
  { key: 'roster', label: 'Student roster' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'fees', label: 'Fee payment records' },
  { key: 'results', label: 'Assessment results' },
  { key: 'welfare', label: 'Welfare / hardship' },
];

const SCHOOLS: FeesSchool[] = [
  { id: 'sch_brightstars', name: 'Bright Stars Academy', state: 'Lagos', verification_tier: 'verified', status: 'active', owner_email: 'owner@brightstars.ng', bank_account: '****3021 · GTBank', created_at: iso(900) },
  { id: 'sch_unityhigh', name: 'Unity High School', state: 'Oyo', verification_tier: 'basic', status: 'active', owner_email: 'admin@unityhigh.ng', bank_account: '****7744 · Access', created_at: iso(500) },
];

const SESSIONS: FeesSession[] = [
  { id: 'ses_2025_26', school_id: 'sch_brightstars', name: '2025/2026', starts_on: '2025-09-08', ends_on: '2026-07-24', status: 'active' },
  { id: 'ses_2024_25', school_id: 'sch_brightstars', name: '2024/2025', starts_on: '2024-09-09', ends_on: '2025-07-25', status: 'closed' },
];

const CLASSES: FeesClass[] = [
  { id: 'cls_jss1a', school_id: 'sch_brightstars', session_id: 'ses_2025_26', name: 'JSS 1A', curriculum_class: 'JSS1', students: 42 },
  { id: 'cls_jss2a', school_id: 'sch_brightstars', session_id: 'ses_2025_26', name: 'JSS 2A', curriculum_class: 'JSS2', students: 38 },
  { id: 'cls_ss1a', school_id: 'sch_brightstars', session_id: 'ses_2025_26', name: 'SS 1A (Science)', curriculum_class: 'SS1', students: 31 },
];

const FEE_SCHEDULES: FeeSchedule[] = [
  {
    id: 'fs_jss1_t1', school_id: 'sch_brightstars', session_id: 'ses_2025_26', class_id: 'cls_jss1a',
    term: 'First Term 2025/26', status: 'issued', due_date: dateStr(-4),
    fee_items: [
      { id: 'fi_1', name: 'Tuition', amount_kobo: naira(85_000), mandatory: true },
      { id: 'fi_2', name: 'PTA levy', amount_kobo: naira(5_000), mandatory: true },
      { id: 'fi_3', name: 'Boarding (optional)', amount_kobo: naira(120_000), mandatory: false },
    ],
    installment_policy: { enabled: true, count: 3, cadence_days: 30, first_due_date: dateStr(-4) },
    issued_at: iso(120),
  },
  {
    id: 'fs_jss2_t1', school_id: 'sch_brightstars', session_id: 'ses_2025_26', class_id: 'cls_jss2a',
    term: 'First Term 2025/26', status: 'draft', due_date: dateStr(14),
    fee_items: [
      { id: 'fi_4', name: 'Tuition', amount_kobo: naira(90_000), mandatory: true },
    ],
    installment_policy: { enabled: false, count: 1, cadence_days: 0, first_due_date: dateStr(14) },
    issued_at: null,
  },
];

export async function listFeesSchools(): Promise<FeesSchool[]> {
  if (USE_MOCK) { await delay(); return SCHOOLS.map((s) => ({ ...s })); }
  // Admin school directory (SU-01): feesschool admin group → /schools/admin.
  // adminBase()=/api/academy, admin group=/api/academy/admin ⇒ /admin/schools/admin.
  return getJson<FeesSchool[]>('/admin/schools/admin');
}
export async function createFeesSchool(input: FeesSchoolInput): Promise<FeesSchool> {
  if (USE_MOCK) throw new Error(`Creating a school ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /admin/fees/schools (feesadminapi.CreateSchool, reuses feesschool.Service) —
  // the OLD "no admin-group create endpoint exists" comment here was wrong; the route is
  // registered at backend/internal/academy/fees/adminapi/handler.go:66.
  return sendJson<FeesSchool>('POST', '/admin/fees/schools', input);
}
export async function listFeesSessions(schoolId?: string): Promise<FeesSession[]> {
  if (USE_MOCK) { await delay(); return SESSIONS.filter((s) => !schoolId || s.school_id === schoolId).map((s) => ({ ...s })); }
  // backend: GET /admin/fees/sessions?school_id= (feesadminapi.ListSessions, academy.fees.setup).
  return getJson<FeesSession[]>(`/admin/fees/sessions${schoolId ? `?school_id=${schoolId}` : ''}`);
}
export async function createFeesSession(input: FeesSessionInput): Promise<FeesSession> {
  if (USE_MOCK) throw new Error(`Creating a session ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /admin/fees/sessions (feesadminapi.CreateSession) — the OLD "MEMBER-only,
  // no admin-group mount" comment here was wrong; the route is registered at
  // backend/internal/academy/fees/adminapi/handler.go:72.
  return sendJson<FeesSession>('POST', '/admin/fees/sessions', input);
}
export async function listFeesClasses(sessionId?: string): Promise<FeesClass[]> {
  if (USE_MOCK) { await delay(); return CLASSES.filter((c) => !sessionId || c.session_id === sessionId).map((c) => ({ ...c })); }
  // backend: GET /admin/fees/classes?session_id= (feesadminapi.ListClasses, academy.fees.setup).
  return getJson<FeesClass[]>(`/admin/fees/classes${sessionId ? `?session_id=${sessionId}` : ''}`);
}
export async function createFeesClass(input: FeesClassInput): Promise<FeesClass> {
  if (USE_MOCK) throw new Error(`Creating a class ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /admin/fees/classes (feesadminapi.CreateClass) — the OLD "MEMBER-only, no
  // admin-group mount" comment here was wrong; the route is registered at
  // backend/internal/academy/fees/adminapi/handler.go:74.
  return sendJson<FeesClass>('POST', '/admin/fees/classes', input);
}
export async function listFeeSchedules(classId?: string): Promise<FeeSchedule[]> {
  if (USE_MOCK) { await delay(); return FEE_SCHEDULES.filter((f) => !classId || f.class_id === classId).map((f) => ({ ...f, fee_items: f.fee_items.map((i) => ({ ...i })) })); }
  // backend: GET /admin/fees/schedules?class_id= (feesadminapi.ListFeeSchedules, academy.fees.setup).
  return getJson<FeeSchedule[]>(`/admin/fees/schedules${classId ? `?class_id=${classId}` : ''}`);
}
export async function createFeeSchedule(input: FeeScheduleInput): Promise<FeeSchedule> {
  if (USE_MOCK) throw new Error(`Creating a fee schedule ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /admin/fees/schedules (feesadminapi.CreateFeeSchedule — creates a draft, academy.fees.setup).
  return sendJson<FeeSchedule>('POST', '/admin/fees/schedules', input);
}
// SF-1: issuing a schedule freezes it — once issued (an Invoice can reference it) it is immutable.
export async function issueFeeSchedule(scheduleId: string): Promise<FeeScheduleIssueResult> {
  if (USE_MOCK) throw new Error(`Issuing a fee schedule ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /admin/fees/schedules/:id/issue (feesadminapi.IssueFeeSchedule — SF-1 lock/issue, academy.fees.setup).
  return sendJson<FeeScheduleIssueResult>('POST', `/admin/fees/schedules/${scheduleId}/issue`, {});
}

// ════════════════════ SC-32 · BULK ONBOARDING (CSV import → preview → approval queue) ════════════════════
// RBAC: academy.fees.onboarding
const ONBOARDING_BATCHES: OnboardingBatch[] = [
  {
    id: 'ob_1', school_id: 'sch_brightstars', filename: 'jss1a-roster.csv', uploaded_by: 'bursar@brightstars.ng',
    status: 'pending_review', total: 3, valid: 2, errors: 1, uploaded_at: iso(6),
    rows: [
      { line: 1, student_name: 'Chidera Obi', guardian_email: 'obi.parent@example.com', class_name: 'JSS 1A', admission_no: 'BS-2601', status: 'valid', message: null },
      { line: 2, student_name: 'Amina Yusuf', guardian_email: 'a.yusuf@example.com', class_name: 'JSS 1A', admission_no: 'BS-2602', status: 'valid', message: null },
      { line: 3, student_name: 'Tunde Bello', guardian_email: 'not-an-email', class_name: 'JSS 1A', admission_no: 'BS-2603', status: 'error', message: 'Invalid guardian email' },
    ],
  },
];

export async function listOnboardingBatches(): Promise<OnboardingBatch[]> {
  if (USE_MOCK) { await delay(); return ONBOARDING_BATCHES.map((b) => ({ ...b, rows: b.rows.map((r) => ({ ...r })) })); }
  // TODO(no backend route): bulk onboarding is MEMBER-only import preview/approve
  // (POST /api/finance/academy/schools/:schoolId/students/import/{preview,approve});
  // there is no admin batch-listing endpoint and no admin-group mount.
  return getJson<OnboardingBatch[]>('/admin/fees/onboarding/batches');
}
// Client-side CSV preview (does not persist) — mirrors association/import UX.
export function parseOnboardingCsv(text: string): OnboardingRow[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const header = lines[0].toLowerCase();
  const hasHeader = header.includes('student') || header.includes('name');
  const body = hasHeader ? lines.slice(1) : lines;
  return body.map((ln, i) => {
    const [student_name = '', guardian_email = '', class_name = '', admission_no = ''] = ln.split(',').map((c) => c.trim());
    const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(guardian_email);
    const ok = Boolean(student_name) && emailOk && Boolean(class_name);
    return {
      line: i + 1, student_name, guardian_email, class_name, admission_no,
      status: ok ? 'valid' : 'error',
      message: ok ? null : !student_name ? 'Missing student name' : !emailOk ? 'Invalid guardian email' : 'Missing class',
    };
  });
}
export async function approveOnboardingBatch(input: OnboardingApproveInput): Promise<OnboardingBatch> {
  if (USE_MOCK) throw new Error(`Deciding an onboarding batch ${NO_BACKEND_YET}`);
  // TODO(no backend route): onboarding approval is the MEMBER import-approve endpoint
  // (POST /api/finance/academy/schools/:schoolId/students/import/approve), not an admin
  // batch-decision route; no admin-group mount reachable from adminBase().
  return sendJson<OnboardingBatch>('POST', `/admin/fees/onboarding/batches/${input.batch_id}/decision`, input);
}

// ════════════════════ SC-33 · COLLECTIONS DASHBOARD ════════════════════
// RBAC: academy.fees.collections
const COLLECTIONS: CollectionsOverview = {
  invoices_issued: 152,
  invoices_paid: 96,
  invoices_partial: 21,
  invoices_overdue: 35,
  billed_kobo: naira(13_680_000),
  collected_kobo: naira(8_940_000),
  outstanding_kobo: naira(4_740_000),
};

const INVOICES: InvoiceRow[] = [
  { id: 'inv_001', student_name: 'Chidera Obi', class_name: 'JSS 1A', guardian_email: 'obi.parent@example.com', billed_kobo: naira(90_000), paid_kobo: naira(90_000), status: 'paid', due_date: dateStr(-4), issued_at: iso(120) },
  { id: 'inv_002', student_name: 'Amina Yusuf', class_name: 'JSS 1A', guardian_email: 'a.yusuf@example.com', billed_kobo: naira(90_000), paid_kobo: naira(30_000), status: 'partial', due_date: dateStr(-4), issued_at: iso(120) },
  { id: 'inv_003', student_name: 'Emeka Nwosu', class_name: 'JSS 2A', guardian_email: 'nwosu@example.com', billed_kobo: naira(95_000), paid_kobo: 0, status: 'overdue', due_date: dateStr(-11), issued_at: iso(300) },
  { id: 'inv_004', student_name: 'Fatima Sani', class_name: 'SS 1A', guardian_email: 'sani.f@example.com', billed_kobo: naira(140_000), paid_kobo: naira(140_000), status: 'paid', due_date: dateStr(2), issued_at: iso(80) },
  { id: 'inv_005', student_name: 'Grace Udo', class_name: 'SS 1A', guardian_email: 'g.udo@example.com', billed_kobo: naira(140_000), paid_kobo: 0, status: 'issued', due_date: dateStr(9), issued_at: iso(20) },
];

export async function getCollectionsOverview(): Promise<CollectionsOverview> {
  if (USE_MOCK) { await delay(); return { ...COLLECTIONS }; }
  // backend: GET /admin/fees/collections/overview?school_id= (feesadminapi.Collections, academy.fees.collections).
  return getJson<CollectionsOverview>('/admin/fees/collections/overview');
}
export async function listInvoices(): Promise<InvoiceRow[]> {
  if (USE_MOCK) { await delay(); return INVOICES.map((i) => ({ ...i })); }
  // backend: GET /admin/fees/invoices?school_id=&status= (feesadminapi.ListInvoices, academy.fees.collections).
  return getJson<InvoiceRow[]>('/admin/fees/invoices');
}

// ════════════════════ SC-34 · DEFAULTERS & HARDSHIP REVIEW QUEUE (SF-9) ════════════════════
// RBAC: academy.fees.hardship — human review ONLY; never auto-approved / auto-denied.
const HARDSHIP: HardshipRequest[] = [
  { id: 'hs_1', invoice_id: 'inv_003', student_name: 'Emeka Nwosu', class_name: 'JSS 2A', guardian_email: 'nwosu@example.com', outstanding_kobo: naira(95_000), reason: 'Guardian recently lost employment; requesting a 60-day freeze.', requested_at: iso(28), status: 'pending' },
  { id: 'hs_2', invoice_id: 'inv_002', student_name: 'Amina Yusuf', class_name: 'JSS 1A', guardian_email: 'a.yusuf@example.com', outstanding_kobo: naira(60_000), reason: 'Medical emergency in household; requesting revised installment plan.', requested_at: iso(50), status: 'pending' },
];

export async function listHardshipRequests(): Promise<HardshipRequest[]> {
  if (USE_MOCK) { await delay(); return HARDSHIP.map((h) => ({ ...h })); }
  // feeshardship admin group → /hardship/admin (SF-9 review queue, ?schoolId= optional).
  // adminBase()=/api/academy + admin group /admin ⇒ /admin/hardship/admin. Envelope {data}.
  return getJson<HardshipRequest[]>('/admin/hardship/admin');
}
export async function decideHardship(input: HardshipDecisionInput): Promise<HardshipRequest> {
  if (USE_MOCK) throw new Error(`Deciding a hardship request ${NOT_IN_FIXTURE_MODE}`);
  // feeshardship admin: POST /hardship/admin/:id/approve | /hardship/admin/:id/deny.
  // The backend splits the decision into two endpoints (no /decision route); map the
  // decision field to the correct verb. Note is sent in the body. Envelope {data}.
  const verb = input.decision === 'approve' ? 'approve' : 'deny';
  return sendJson<HardshipRequest>('POST', `/admin/hardship/admin/${input.request_id}/${verb}`, input);
}

// ════════════════════ SC-35/36 · PROMOTION CONSOLE + ROLLOVER (SF-3 two-approval) ════════════════════
// RBAC: academy.fees.promotion. NO path may skip promotion_computed → applied.
const PROMOTIONS: PromotionBatch[] = [
  {
    id: 'pr_jss1a', school_id: 'sch_brightstars', session_id: 'ses_2025_26', from_class: 'JSS 1A', to_class: 'JSS 2A',
    students_total: 42, students_promoted: 39, students_retained: 3, status: 'promotion_computed',
    teacher_approved_by: null, teacher_approved_at: null, head_approved_by: null, head_approved_at: null,
    computed_at: iso(6),
  },
  {
    id: 'pr_jss2a', school_id: 'sch_brightstars', session_id: 'ses_2025_26', from_class: 'JSS 2A', to_class: 'JSS 3A',
    students_total: 38, students_promoted: 36, students_retained: 2, status: 'promotion_reviewed',
    teacher_approved_by: 'teacher@brightstars.ng', teacher_approved_at: iso(3), head_approved_by: null, head_approved_at: null,
    computed_at: iso(10),
  },
];

export async function listPromotions(): Promise<PromotionBatch[]> {
  if (USE_MOCK) { await delay(); return PROMOTIONS.map((p) => ({ ...p })); }
  // backend: GET /admin/fees/promotions?school_id= (feesadminapi.ListPromotions, academy.fees.promotion.approve).
  return getJson<PromotionBatch[]>('/admin/fees/promotions');
}
// The state machine advances ONE step per approval. A single approval NEVER reaches `applied`.
// Not in the audit's flagged list — the checker's heuristic treats ANY throw inside a fixture
// block as proof the branch is honest, but these two only throw on state-machine guards; the
// success path below each guard still fabricated a result. Same defect class as
// associationAdminService.ts's old handoverElection. Fixed alongside its flagged siblings.
export async function approvePromotion(input: PromotionApproveInput): Promise<PromotionBatch> {
  if (USE_MOCK) throw new Error(`Approving a promotion ${NO_BACKEND_YET}`);
  // TODO(no backend route): promotion approvals are MEMBER-only and split by role
  // (POST /api/finance/academy/schools/:schoolId/promotions/:promotionId/{teacher-approval,admin-approval}).
  // No admin-group mount reachable from adminBase(), and the batch_id here is not a schoolId-scoped path.
  return sendJson<PromotionBatch>('POST', `/admin/fees/promotions/${input.batch_id}/approve`, input);
}
// Rollover only permitted once BOTH approvals recorded (status === promotion_approved).
export async function applyPromotion(batchId: string): Promise<PromotionBatch> {
  if (USE_MOCK) throw new Error(`Applying a promotion rollover ${NO_BACKEND_YET}`);
  // TODO(no backend route): apply is MEMBER-only
  // (POST /api/finance/academy/schools/:schoolId/promotions/:promotionId/apply); no admin mount.
  return sendJson<PromotionBatch>('POST', `/admin/fees/promotions/${batchId}/apply`, {});
}

// ════════════════════ SC-37 · COMPETITION REGISTRATION ════════════════════
// RBAC: academy.fees.competition
const COMPETITIONS: Competition[] = [
  { id: 'cmp_math26', name: 'National Maths Challenge 2026', subject: 'Mathematics', scope: 'national', status: 'open_registration', starts_on: dateStr(30), registration_closes: dateStr(20), registered_schools: 84, registered_students: 1240 },
  { id: 'cmp_sci_lag', name: 'Lagos Science Bowl', subject: 'Integrated Science', scope: 'state', status: 'draft', starts_on: dateStr(55), registration_closes: dateStr(40), registered_schools: 0, registered_students: 0 },
  { id: 'cmp_spell', name: 'Inter-School Spelling Bee', subject: 'English Language', scope: 'city', status: 'registration_closed', starts_on: dateStr(5), registration_closes: dateStr(-2), registered_schools: 22, registered_students: 88 },
];

const REGISTRATIONS: CompetitionRegistration[] = [
  { id: 'reg_1', competition_id: 'cmp_math26', school_id: 'sch_brightstars', team_name: 'Bright Stars Mathletes', students: 6, status: 'confirmed', registered_at: iso(40) },
];

export async function listCompetitions(): Promise<Competition[]> {
  if (USE_MOCK) { await delay(); return COMPETITIONS.map((c) => ({ ...c })); }
  // backend: GET /admin/fees/competitions (feesadminapi.ListCompetitions, academy.fees.competition.manage).
  return getJson<Competition[]>('/admin/fees/competitions');
}
export async function listCompetitionRegistrations(): Promise<CompetitionRegistration[]> {
  if (USE_MOCK) { await delay(); return REGISTRATIONS.map((r) => ({ ...r })); }
  // backend: GET /admin/fees/competitions/registrations?competition_id= (feesadminapi.ListCompetitionRegistrations,
  // academy.fees.competition.manage).
  return getJson<CompetitionRegistration[]>('/admin/fees/competitions/registrations');
}
// Not in the audit's flagged list for the same reason as approvePromotion/applyPromotion
// above — a state-machine-guard throw hid a fabricated success on the path below it.
export async function registerForCompetition(input: CompetitionRegisterInput): Promise<CompetitionRegistration> {
  if (USE_MOCK) throw new Error(`Registering for a competition ${NOT_IN_FIXTURE_MODE}`);
  // feescompetition admin: POST /competitions/:id/register (RBAC academy.fees.competition.register).
  // adminBase()=/api/academy + admin group /admin/competitions ⇒ /admin/competitions/:id/register.
  // NOTE: this handler responds with the bare payload (c.JSON(status, out)), NOT a {data}
  // envelope — sendJson's (j?.data ?? j) fallback already returns the bare body correctly.
  return sendJson<CompetitionRegistration>('POST', `/admin/competitions/${input.competition_id}/register`, input);
}

// ════════════════════ SC-38 · GOVERNMENT EXPORT CENTER (SF-11) ════════════════════
// RBAC: academy.fees.export. Opt-in per data category; every export logged immutably.
const OPT_INS: GovExportOptIn[] = [
  { school_id: 'sch_brightstars', category: 'roster', opted_in: true, updated_at: iso(200) },
  { school_id: 'sch_brightstars', category: 'attendance', opted_in: true, updated_at: iso(200) },
  { school_id: 'sch_brightstars', category: 'fees', opted_in: false, updated_at: iso(200) },
  { school_id: 'sch_brightstars', category: 'results', opted_in: true, updated_at: iso(120) },
  { school_id: 'sch_brightstars', category: 'welfare', opted_in: false, updated_at: iso(200) },
];

const COMPLIANCE_EXPORTS: ComplianceExport[] = [
  { id: 'ce_1', school_id: 'sch_brightstars', report_type: 'State Ministry of Education — enrolment return', recipient: 'Lagos SUBEB', data_categories: ['roster', 'attendance'], period: '2025 Q3', generated_by: 'admin@brightstars.ng', generated_at: iso(72) },
  { id: 'ce_2', school_id: 'sch_brightstars', report_type: 'WAEC candidate results submission', recipient: 'WAEC', data_categories: ['results'], period: '2025', generated_by: 'admin@brightstars.ng', generated_at: iso(400) },
];

export async function listGovOptIns(schoolId?: string): Promise<GovExportOptIn[]> {
  if (USE_MOCK) { await delay(); return OPT_INS.filter((o) => !schoolId || o.school_id === schoolId).map((o) => ({ ...o })); }
  // backend: GET /admin/fees/gov-export/opt-ins?school_id= (feesadminapi.ListGovOptIns, academy.fees.export.run).
  return getJson<GovExportOptIn[]>(`/admin/fees/gov-export/opt-ins${schoolId ? `?school_id=${schoolId}` : ''}`);
}
export async function setGovOptIn(input: GovExportOptInInput): Promise<GovExportOptIn> {
  if (USE_MOCK) throw new Error(`Setting a government export opt-in ${NOT_IN_FIXTURE_MODE}`);
  // backend: PATCH /admin/fees/gov-export/opt-ins (feesadminapi.SetGovOptIn, academy.fees.export.run).
  return sendJson<GovExportOptIn>('PATCH', '/admin/fees/gov-export/opt-ins', input);
}
export async function listComplianceExports(schoolId?: string): Promise<ComplianceExport[]> {
  if (USE_MOCK) { await delay(); return COMPLIANCE_EXPORTS.filter((e) => !schoolId || e.school_id === schoolId).map((e) => ({ ...e, data_categories: [...e.data_categories] })); }
  // feesexport admin: GET /export/compliance/:schoolId (SF-11 export history). The schoolId
  // is a PATH param, not a query. adminBase()=/api/academy + /admin ⇒ /admin/export/compliance/:schoolId.
  // Envelope {data}. Without a schoolId the backend has no list-all route (see TODO).
  if (!schoolId) {
    // TODO(no backend route): compliance history requires a schoolId path param; there is
    // no list-all-schools export-log endpoint on the backend.
    return getJson<ComplianceExport[]>('/admin/fees/gov-export/log');
  }
  return getJson<ComplianceExport[]>(`/admin/export/compliance/${schoolId}`);
}
export async function generateComplianceExport(input: ComplianceExportInput): Promise<ComplianceExport> {
  if (USE_MOCK) throw new Error(`Generating a compliance export ${NOT_IN_FIXTURE_MODE}`);
  // feesexport admin: POST /export/compliance (SF-11 trigger regulator export, append-only log).
  // adminBase()=/api/academy + /admin ⇒ /admin/export/compliance. Envelope {data}.
  return sendJson<ComplianceExport>('POST', '/admin/export/compliance', input);
}

// ════════════════════ SC-40 · STAFF & BURSAR ROLE MANAGEMENT ════════════════════
// RBAC: academy.fees.roles. School-scoped role grants (scope_type='school').
export const SCHOOL_ROLES: { slug: SchoolRole; label: string }[] = [
  { slug: 'school-owner', label: 'School Owner' },
  { slug: 'bursar', label: 'Bursar' },
  { slug: 'class-teacher', label: 'Class Teacher' },
  { slug: 'head-teacher', label: 'Head Teacher' },
];

const ROLE_GRANTS: SchoolRoleGrant[] = [
  { id: 'gr_1', school_id: 'sch_brightstars', user_email: 'owner@brightstars.ng', role: 'school-owner', granted_by: 'platform', granted_at: iso(900), status: 'active' },
  { id: 'gr_2', school_id: 'sch_brightstars', user_email: 'bursar@brightstars.ng', role: 'bursar', granted_by: 'owner@brightstars.ng', granted_at: iso(500), status: 'active' },
  { id: 'gr_3', school_id: 'sch_brightstars', user_email: 'teacher@brightstars.ng', role: 'class-teacher', granted_by: 'owner@brightstars.ng', granted_at: iso(300), status: 'active' },
  { id: 'gr_4', school_id: 'sch_brightstars', user_email: 'head@brightstars.ng', role: 'head-teacher', granted_by: 'owner@brightstars.ng', granted_at: iso(300), status: 'active' },
];

export async function listRoleGrants(schoolId?: string): Promise<SchoolRoleGrant[]> {
  if (USE_MOCK) { await delay(); return ROLE_GRANTS.filter((g) => !schoolId || g.school_id === schoolId).map((g) => ({ ...g })); }
  // feesroles admin: GET /schools/:schoolId/staff (school-scoped, RequireScopedPermission).
  // adminBase()=/api/academy + /admin ⇒ /admin/schools/:schoolId/staff. Envelope {data}.
  if (!schoolId) {
    // backend: GET /admin/fees/roles (feesadminapi.ListRoleGrants — cross-school grants list,
    // academy.fees.roles.assign). The school-scoped variant below hits feesroles directly.
    return getJson<SchoolRoleGrant[]>('/admin/fees/roles');
  }
  return getJson<SchoolRoleGrant[]>(`/admin/schools/${schoolId}/staff`);
}
export async function assignRole(input: RoleAssignInput): Promise<SchoolRoleGrant> {
  if (USE_MOCK) throw new Error(`Assigning a staff role ${NOT_IN_FIXTURE_MODE}`);
  // feesroles admin: POST /schools/:schoolId/staff {userId, role} (feesroles.Assign).
  // adminBase()=/api/academy + /admin ⇒ /admin/schools/:schoolId/staff. Envelope {data}.
  // Body is remapped to the backend's field names {userId, role}.
  // NOTE(value): RoleAssignInput.user_email is an email, not a user id — the caller/UI must
  // resolve the identity to a real user id before this succeeds (a types-owned follow-up).
  return sendJson<SchoolRoleGrant>('POST', `/admin/schools/${input.school_id}/staff`, { userId: input.user_email, role: input.role });
}
export async function revokeRole(input: RoleRevokeInput): Promise<SchoolRoleGrant> {
  if (USE_MOCK) throw new Error(`Revoking a staff role ${NO_BACKEND_YET}`);
  // TODO(no backend route as-shaped): feesroles revoke is DELETE /schools/:schoolId/staff
  // with body {userId, role}; RoleRevokeInput carries only grant_id (no schoolId/userId/role),
  // so the school-scoped path + required body cannot be built without a types change.
  return sendJson<SchoolRoleGrant>('POST', `/admin/fees/roles/${input.grant_id}/revoke`, input);
}
