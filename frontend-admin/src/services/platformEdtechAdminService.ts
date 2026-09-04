// ── Service — Platform SUPER-ADMIN console for the EdTech module (SU-01..SU-12) ──
//
// This is a NEW platform-operator surface. It is RBAC-separated from every
// school-level role: the ONLY capability that unlocks it is `platform_edtech_admin`.
// A school owner / bursar / class_teacher / head_teacher has ZERO visibility — the
// nav section is filtered on this permission (AdminSidebar.tsx) and each page
// re-asserts it via <PlatformGuard> (see app/admin/platform/edtech/_ui.tsx).
// This is Checkpoint E: a platform-operator surface, NOT an escalated school-admin
// surface. Backend RBAC (Go middleware.RequirePermission) remains authoritative.
//
// Request stack copies academyAdminService.ts EXACTLY:
//   • base() rewrites env.apiBaseUrl (…/api/v1) → the platform/academy admin group
//   • authHeaders() attaches the admin Bearer token from localStorage
//   • mock by default (NEXT_PUBLIC_EDTECH_PLATFORM_USE_MOCK); flip to 'false' to hit
//     the live Go backend (academy fees admin + platform routes).
// Live routes target the academy fees admin group + platform oversight endpoints:
//   /api/academy/admin/platform/<module> — gated academy.fees.* + platform_edtech_admin.

import { env } from '@/config/env';
import type {
  PlatformSchool, VerificationSubmission, VerificationReviewInput,
  CollectionsOverview, RiskCase, RiskActionInput,
  GovSyncRow, ComplianceExportLog, AuditLogEntry,
  Competition, CompetitionTransitionInput,
  TrustScoreRow, TrustScoreOverrideInput,
  ScholarshipPledge, SupportTicket, TicketActionInput,
  FeatureFlag, FlagToggleInput, CompliancePosture,
} from '@/types/platformEdtechAdmin';

const USE_MOCK =
  (process.env.NEXT_PUBLIC_EDTECH_PLATFORM_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function base(): string {
  // …/api/v1 → …/api/academy/admin/platform (the platform oversight admin group)
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/academy/admin/platform');
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}
const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms));

// Verified against backend/internal/app/academy_platform_routes.go +
// backend/internal/academy/platform/{handlers,actions,feature_flags}.go.
// Every write below has a real endpoint (some of the route file's own "no
// store → no-op" comments were stale — the flag store is real and persists);
// fixture mode has nothing to add and refuses loudly instead of reporting a
// write it did not perform. See docs/audit/ADMIN_SIMULATED_WRITES.md.
const NOT_IN_FIXTURE_MODE =
  'is unavailable in fixture mode: this console will not report a write it did not perform. ' +
  'Set NEXT_PUBLIC_EDTECH_PLATFORM_USE_MOCK=false to make this change against the live backend.';
const NO_BACKEND_YET =
  'has no backend yet (see the comment on the live-mode call below). ' +
  'This console cannot perform this action until that endpoint is built.';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${base()}${path}`, { headers: authHeaders(), cache: 'no-store' });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}
async function sendJson<T>(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base()}${path}`, { method, headers: authHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}

// ── Mock fixture helpers ──────────────────────────────────────────────────────
const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
const dstr = (daysFromNow: number) => new Date(Date.now() + daysFromNow * 86_400_000).toISOString().slice(0, 10);
const naira = (n: number) => n * 100; // ₦ → kobo
function trendKobo(n: number, base: number, jitter: number) {
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(Date.now() - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10),
    value_kobo: naira(Math.round(base + Math.sin(i / 2) * jitter + (i % 3) * (jitter / 4))),
  }));
}

// ── Shared mock school set (SU-01) ────────────────────────────────────────────
const MOCK_SCHOOLS: PlatformSchool[] = [
  { id: 'sch_001', name: 'Bright Future Academy', state: 'Lagos', owner_identity_id: 'id_9a1', verification_tier: 'verified', status: 'active', students: 1240, gmv_kobo: naira(48_500_000), trust_score: 87, gov_sync_opt_in: true, created_at: iso(24 * 210) },
  { id: 'sch_002', name: 'Crescent Model College', state: 'Kano', owner_identity_id: 'id_4c2', verification_tier: 'basic', status: 'active', students: 860, gmv_kobo: naira(21_300_000), trust_score: 74, gov_sync_opt_in: false, created_at: iso(24 * 160) },
  { id: 'sch_003', name: 'Green Valley Schools', state: 'Rivers', owner_identity_id: 'id_7d3', verification_tier: 'premium', status: 'active', students: 2010, gmv_kobo: naira(96_800_000), trust_score: 92, gov_sync_opt_in: true, created_at: iso(24 * 320) },
  { id: 'sch_004', name: 'Unity Comprehensive', state: 'Oyo', owner_identity_id: 'id_2e4', verification_tier: 'unverified', status: 'draft', students: 0, gmv_kobo: 0, trust_score: 40, gov_sync_opt_in: false, created_at: iso(24 * 6) },
  { id: 'sch_005', name: 'Royal Heritage Int’l', state: 'Abuja', owner_identity_id: 'id_5f5', verification_tier: 'basic', status: 'suspended', students: 430, gmv_kobo: naira(5_900_000), trust_score: 51, gov_sync_opt_in: false, created_at: iso(24 * 95) },
];
const schoolName = (id: string) => MOCK_SCHOOLS.find((s) => s.id === id)?.name ?? id;

// ════════════════════ SU-01 — Platform School Directory ══════════════════════
export async function listPlatformSchools(): Promise<PlatformSchool[]> {
  if (USE_MOCK) { await delay(); return [...MOCK_SCHOOLS]; }
  return getJson<PlatformSchool[]>('/schools');
}

// ════════════════════ SU-02 — School Verification Queue ══════════════════════
const MOCK_VERIFICATIONS: VerificationSubmission[] = [
  { id: 'ver_01', school_id: 'sch_004', school_name: 'Unity Comprehensive', requested_tier: 'verified', cac_number: 'RC-1839221', cac_doc_url: '/mock/cac/unity.pdf', references: [{ name: 'Mrs A. Bello', role: 'PTA Chair', phone: '0803...' }, { name: 'Mr K. Ojo', role: 'LGA Education Officer', phone: '0812...' }], submitted_at: iso(30), status: 'pending' },
  { id: 'ver_02', school_id: 'sch_002', school_name: 'Crescent Model College', requested_tier: 'premium', cac_number: 'RC-2201004', cac_doc_url: '/mock/cac/crescent.pdf', references: [{ name: 'Alh. M. Sani', role: 'Proprietor', phone: '0806...' }], submitted_at: iso(52), status: 'pending' },
  { id: 'ver_03', school_id: 'sch_005', school_name: 'Royal Heritage Int’l', requested_tier: 'verified', cac_number: 'RC-9930210', cac_doc_url: '/mock/cac/royal.pdf', references: [{ name: 'Dr N. Eze', role: 'Head Teacher', phone: '0705...' }], submitted_at: iso(120), status: 'rejected', reviewer: 'ops@paymax', decided_at: iso(90), reason: 'CAC document did not match declared proprietor.' },
];
export async function listVerificationQueue(): Promise<VerificationSubmission[]> {
  if (USE_MOCK) { await delay(); return [...MOCK_VERIFICATIONS]; }
  return getJson<VerificationSubmission[]>('/verification-queue');
}
export async function reviewVerification(input: VerificationReviewInput): Promise<VerificationSubmission> {
  if (USE_MOCK) throw new Error(`Reviewing a verification submission ${NOT_IN_FIXTURE_MODE}`);
  return sendJson<VerificationSubmission>('POST', `/verification-queue/${input.id}/review`, input);
}

// ════════════════════ SU-03 — Platform-Wide Collections ══════════════════════
export async function getCollectionsOverview(): Promise<CollectionsOverview> {
  if (USE_MOCK) {
    await delay();
    const gmv = MOCK_SCHOOLS.reduce((s, x) => s + x.gmv_kobo, 0);
    return {
      gmv_kobo: gmv,
      gmv_today_kobo: naira(3_180_000),
      active_schools: MOCK_SCHOOLS.filter((s) => s.status === 'active').length,
      invoices_issued: 18_420,
      invoices_paid: 15_930,
      collection_rate: 0.865,
      reconciliation: { matched: 15_712, pending: 188, drift_flagged: 30, last_run_at: iso(6) },
      gmv_trend: trendKobo(14, 2_600_000, 700_000),
      top_schools: [...MOCK_SCHOOLS].sort((a, b) => b.gmv_kobo - a.gmv_kobo).slice(0, 4).map((s) => ({ school_id: s.id, name: s.name, gmv_kobo: s.gmv_kobo })),
    };
  }
  return getJson<CollectionsOverview>('/collections');
}

// ════════════════════ SU-04 — Fraud & Risk Queue ═════════════════════════════
const MOCK_RISK: RiskCase[] = [
  { id: 'rsk_01', kind: 'anomalous_payment', school_id: 'sch_003', school_name: 'Green Valley Schools', severity: 'high', amount_kobo: naira(1_450_000), summary: '32 fee payments from a single card in 4 minutes.', opened_at: iso(9), status: 'open' },
  { id: 'rsk_02', kind: 'disputed_promotion', school_id: 'sch_001', school_name: 'Bright Future Academy', severity: 'low', summary: 'Guardian disputes a repeat decision recorded before the second approval.', opened_at: iso(40), status: 'investigating' },
  { id: 'rsk_03', kind: 'chargeback', school_id: 'sch_005', school_name: 'Royal Heritage Int’l', severity: 'critical', amount_kobo: naira(320_000), summary: 'Chargeback on a term-fee payment; funds already applied to invoice.', opened_at: iso(70), status: 'open' },
];
export async function listRiskCases(): Promise<RiskCase[]> {
  if (USE_MOCK) { await delay(); return [...MOCK_RISK]; }
  return getJson<RiskCase[]>('/risk');
}
export async function actionRiskCase(input: RiskActionInput): Promise<RiskCase> {
  if (USE_MOCK) throw new Error(`Actioning a risk case ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /risk/:id/action (platform.Handler.ActionRiskCase) — audit-only by
  // design (no risk-case status table exists yet); it records the decision to the
  // immutable audit log and echoes it back rather than persisting a status column.
  return sendJson<RiskCase>('POST', `/risk/${input.id}/action`, input);
}

// ═══════════ SU-05 — Gov/Regulator Sync Oversight (+ ComplianceExport SF-11) ══
export async function listGovSync(): Promise<GovSyncRow[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_SCHOOLS.map((s) => ({
      school_id: s.id, school_name: s.name, opted_in: s.gov_sync_opt_in,
      data_categories: s.gov_sync_opt_in ? ['enrollment', 'results', 'fees_summary'] : [],
      regulator: s.state + ' SUBEB', last_export_at: s.gov_sync_opt_in ? iso(24 * 7) : null,
      export_count: s.gov_sync_opt_in ? 4 : 0,
    }));
  }
  return getJson<GovSyncRow[]>('/gov-sync');
}
export async function listComplianceExports(): Promise<ComplianceExportLog[]> {
  if (USE_MOCK) {
    await delay();
    return [
      { id: 'exp_01', school_id: 'sch_001', school_name: 'Bright Future Academy', report_type: 'Termly Enrollment', period: '2026/2027-T1', data_categories: ['enrollment'], regulator: 'Lagos SUBEB', generated_at: iso(24 * 7), generated_by: 'ops@paymax', immutable_hash: 'a91f…d2' },
      { id: 'exp_02', school_id: 'sch_003', school_name: 'Green Valley Schools', report_type: 'Fees Summary', period: '2026/2027-T1', data_categories: ['fees_summary'], regulator: 'Rivers SUBEB', generated_at: iso(24 * 14), generated_by: 'ops@paymax', immutable_hash: 'c73b…9a' },
    ];
  }
  return getJson<ComplianceExportLog[]>('/compliance-exports');
}

// ════════════ SU-11 — Platform Audit Log Viewer (immutable trail) ════════════
export async function searchAuditLog(q: { module?: string; entity?: string; school_id?: string }): Promise<AuditLogEntry[]> {
  if (USE_MOCK) {
    await delay();
    const all: AuditLogEntry[] = [
      { id: 'aud_01', module: 'academy.fees', entity: 'invoice', entity_id: 'inv_5521', action: 'issued', actor: 'bursar@bfa', actor_role: 'bursar', school_id: 'sch_001', at: iso(3), immutable_hash: '9f2a…11' },
      { id: 'aud_02', module: 'academy.fees', entity: 'promotion', entity_id: 'pro_882', action: 'approved', actor: 'head@bfa', actor_role: 'head_teacher', school_id: 'sch_001', at: iso(5), immutable_hash: '4b8c…7d', metadata: { step: 'second_approval' } },
      { id: 'aud_03', module: 'academy.fees', entity: 'invoice', entity_id: 'inv_5522', action: 'waived', actor: 'owner@gvs', actor_role: 'school_owner', school_id: 'sch_003', at: iso(11), immutable_hash: 'e11d…0a', metadata: { reason: 'scholarship override' } },
      { id: 'aud_04', module: 'academy.fees', entity: 'vault', entity_id: 'vlt_204', action: 'applied_to_invoice', actor: 'guardian', actor_role: 'guardian', school_id: 'sch_002', at: iso(20), immutable_hash: 'aa02…3e' },
      { id: 'aud_05', module: 'academy.fees', entity: 'payment', entity_id: 'pay_9910', action: 'reversed', actor: 'ops@paymax', actor_role: 'platform_edtech_admin', school_id: 'sch_005', at: iso(30), immutable_hash: 'bc44…88', metadata: { reason: 'chargeback' } },
    ];
    return all.filter((e) =>
      (!q.module || e.module.includes(q.module)) &&
      (!q.entity || e.entity === q.entity) &&
      (!q.school_id || e.school_id === q.school_id));
  }
  const params = new URLSearchParams();
  if (q.module) params.set('module', q.module);
  if (q.entity) params.set('entity', q.entity);
  if (q.school_id) params.set('school_id', q.school_id);
  return getJson<AuditLogEntry[]>(`/audit-log?${params.toString()}`);
}

// ════════════ SU-06 — Competition & Tournament Ops (E12 Schools Cup) ═════════
const MOCK_COMPETITIONS: Competition[] = [
  { id: 'cmp_01', name: 'Spotlight Schools Cup 2027 — National', scope: 'national', status: 'open_registration', participating_schools: 128, sponsor: 'Paymax Foundation', start_date: dstr(30), end_date: dstr(75), broadcast_ready: false },
  { id: 'cmp_02', name: 'Lagos Inter-School Maths Challenge', scope: 'state', status: 'in_progress', participating_schools: 40, sponsor: 'GTBank', start_date: dstr(-5), end_date: dstr(10), broadcast_ready: true },
  { id: 'cmp_03', name: 'Rivers City Quiz Bowl', scope: 'city', status: 'results_pending', participating_schools: 16, start_date: dstr(-20), end_date: dstr(-2), broadcast_ready: true },
  { id: 'cmp_04', name: 'Kano Regional Science Fair', scope: 'state', status: 'draft', participating_schools: 0, start_date: dstr(60), end_date: dstr(95), broadcast_ready: false },
];
export async function listCompetitions(): Promise<Competition[]> {
  if (USE_MOCK) { await delay(); return [...MOCK_COMPETITIONS]; }
  return getJson<Competition[]>('/competitions');
}
// Target status → state-machine event name (backend/internal/academy/fees/
// statemachine/competition.go). The backend fires named EVENTS, not target
// statuses — sending { to: 'in_progress' } as the body (the old behaviour)
// bound to nothing, since the handler only reads an `event` field.
const COMPETITION_EVENT: Partial<Record<CompetitionTransitionInput['to'], string>> = {
  open_registration: 'open_registration',
  registration_closed: 'close_registration',
  in_progress: 'start',
  results_pending: 'pend_results',
  completed: 'complete',
  archived: 'archive',
};

export async function transitionCompetition(input: CompetitionTransitionInput): Promise<Competition> {
  if (USE_MOCK) throw new Error(`Transitioning a competition ${NOT_IN_FIXTURE_MODE}`);
  const event = COMPETITION_EVENT[input.to];
  if (!event) throw new Error(`"${input.to}" has no matching transition event — draft is the initial state and cannot be entered via a transition.`);
  return sendJson<Competition>('POST', `/competitions/${input.id}/transition`, { event });
}

// ════════════════════ SU-07 — School Trust Score Admin ══════════════════════
const MOCK_TRUST: TrustScoreRow[] = MOCK_SCHOOLS.map((s) => ({
  school_id: s.id, school_name: s.name, score: s.trust_score,
  components: [
    { label: 'Collection reliability', weight: 0.35, value: Math.min(100, s.trust_score + 3) },
    { label: 'Reconciliation health', weight: 0.25, value: Math.max(0, s.trust_score - 4) },
    { label: 'Dispute rate (inverse)', weight: 0.2, value: Math.min(100, s.trust_score + 6) },
    { label: 'Verification tier', weight: 0.2, value: s.verification_tier === 'premium' ? 100 : s.verification_tier === 'verified' ? 80 : s.verification_tier === 'basic' ? 55 : 20 },
  ],
  overridden: false, updated_at: iso(48),
}));
export async function listTrustScores(): Promise<TrustScoreRow[]> {
  if (USE_MOCK) { await delay(); return [...MOCK_TRUST]; }
  return getJson<TrustScoreRow[]>('/trust-scores');
}
export async function overrideTrustScore(input: TrustScoreOverrideInput): Promise<TrustScoreRow> {
  if (USE_MOCK) throw new Error(`Overriding a trust score ${NOT_IN_FIXTURE_MODE}`);
  return sendJson<TrustScoreRow>('POST', `/trust-scores/${input.school_id}/override`, input);
}

// ════════════════ SU-08 — Sponsor & Scholarship Oversight ════════════════════
export async function listScholarshipPledges(): Promise<ScholarshipPledge[]> {
  if (USE_MOCK) {
    await delay();
    return [
      { id: 'plg_01', sponsor: 'Dangote Foundation', sponsor_identity_id: 'id_spn1', target_student_ref: 'stu_ref_8841', school_name: 'Bright Future Academy', amount_kobo: naira(450_000), status: 'disbursed', ledger_ref: 'LDG-9021', created_at: iso(24 * 20) },
      { id: 'plg_02', sponsor: 'Anonymous Sponsor', sponsor_identity_id: 'id_spn2', target_student_ref: 'stu_ref_2210', school_name: 'Green Valley Schools', amount_kobo: naira(120_000), status: 'funded', ledger_ref: 'LDG-9107', created_at: iso(24 * 8) },
      { id: 'plg_03', sponsor: 'Alumni Circle', sponsor_identity_id: 'id_spn3', target_student_ref: 'stu_ref_5533', school_name: 'Crescent Model College', amount_kobo: naira(80_000), status: 'pledged', ledger_ref: '—', created_at: iso(24 * 2) },
      { id: 'plg_04', sponsor: 'GTBank CSR', sponsor_identity_id: 'id_spn4', target_student_ref: 'stu_ref_7712', school_name: 'Royal Heritage Int’l', amount_kobo: naira(200_000), status: 'refunded', ledger_ref: 'LDG-8890', created_at: iso(24 * 40) },
    ];
  }
  return getJson<ScholarshipPledge[]>('/scholarship-pledges');
}

// ════════════════════ SU-09 — Support Ticket Queue ══════════════════════════
const MOCK_TICKETS: SupportTicket[] = [
  { id: 'tkt_01', subject: 'Payment applied to wrong invoice', origin: 'parent', school_name: 'Bright Future Academy', priority: 'high', status: 'open', opened_at: iso(4), last_update_at: iso(4) },
  { id: 'tkt_02', subject: 'Cannot generate data export (SF-10)', origin: 'school_admin', school_name: 'Green Valley Schools', priority: 'low', status: 'in_review', opened_at: iso(28), last_update_at: iso(10) },
  { id: 'tkt_03', subject: 'Promotion stuck at computed — second approver missing', origin: 'school_admin', school_name: 'Crescent Model College', priority: 'critical', status: 'escalated', opened_at: iso(50), last_update_at: iso(6) },
];
export async function listSupportTickets(): Promise<SupportTicket[]> {
  if (USE_MOCK) { await delay(); return [...MOCK_TICKETS]; }
  return getJson<SupportTicket[]>('/support-tickets');
}
export async function actionSupportTicket(input: TicketActionInput): Promise<SupportTicket> {
  // No backend at all: SU-09 has no backing table (academy_platform_routes.go's
  // own comment says so) — only GET /support-tickets (documented empty) is
  // registered; there is no action route to mutate a ticket's status.
  if (USE_MOCK) throw new Error(`Actioning a support ticket ${NO_BACKEND_YET}`);
  return sendJson<SupportTicket>('POST', `/support-tickets/${input.id}/action`, input);
}

// ════════════════ SU-10 — Feature Flag & Tenant Configuration ════════════════
const MOCK_FLAGS: FeatureFlag[] = [
  { key: 'FEATURE_ACADEMY_FEES_ENABLED', label: 'Academy Fees module', description: 'Master flag for the EdTech fees domain.', scope_type: 'global', scope_ref: '', enabled: true, updated_at: iso(24 * 30) },
  { key: 'fees.installments', label: 'Installment payments (Model A)', description: 'Guardian-pays-school-over-time only. Never Paymax fronting fees.', scope_type: 'tier', scope_ref: 'verified', enabled: true, updated_at: iso(24 * 12) },
  { key: 'competition.schools_cup', label: 'Schools Cup (E12)', description: 'Cross-school tournament pipeline.', scope_type: 'region', scope_ref: 'Lagos', enabled: true, updated_at: iso(24 * 5) },
  { key: 'gov.sync', label: 'Gov/regulator sync', description: 'Opt-in per school, per data category (SF-11).', scope_type: 'school', scope_ref: 'sch_003', enabled: true, updated_at: iso(24 * 3) },
];
export async function listFeatureFlags(): Promise<FeatureFlag[]> {
  if (USE_MOCK) { await delay(); return [...MOCK_FLAGS]; }
  return getJson<FeatureFlag[]>('/flags');
}
export async function toggleFeatureFlag(input: FlagToggleInput): Promise<FeatureFlag> {
  if (USE_MOCK) throw new Error(`Toggling a feature flag ${NOT_IN_FIXTURE_MODE}`);
  // backend: POST /flags/toggle (platform.Handler.ToggleFlag → academy_feature_flags,
  // a real per-key upsert — a route.go comment calling this "no override store, no-op"
  // was stale). But the store is GLOBAL ONLY: scope_type/scope_ref are accepted in the
  // body and silently DROPPED (the handler hardcodes "scope_type": "global" in its
  // response, never reads them into the query). Toggling a tier/region/school-scoped
  // flag here would silently flip it for EVERYONE instead of the intended scope — the
  // opposite of what the operator asked for. Refuse rather than do that.
  if (input.scope_type !== 'global') {
    throw new Error(
      `This backend only supports global feature flags — scoping to ${input.scope_type}:${input.scope_ref} is not ` +
      'possible today. Toggling would silently apply globally instead, which is not what you asked for.',
    );
  }
  return sendJson<FeatureFlag>('POST', '/flags/toggle', input);
}

// ════════════ SU-12 — Compliance & Licensing (Model-A-only posture) ══════════
export async function getCompliancePosture(): Promise<CompliancePosture> {
  if (USE_MOCK) {
    await delay();
    return {
      model_a_only: true,
      bnpl_rail_repurposed: false,
      license_category: 'Payment facilitation (Model A — collections only)',
      last_reviewed_at: iso(24 * 2),
      drift_signals: [
        { id: 'drf_01', school_name: 'Royal Heritage Int’l', signal: 'Installment plan configured with platform disbursing full fee to school before guardian completes payments (factoring-like).', severity: 'critical', detected_at: iso(12) },
        { id: 'drf_02', school_name: 'Crescent Model College', signal: 'Fee schedule references a "financing partner" advance in metadata.', severity: 'warn', detected_at: iso(36) },
      ],
    };
  }
  return getJson<CompliancePosture>('/compliance-posture');
}

export { schoolName };
