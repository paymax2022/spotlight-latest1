// ── Admin — Associations ops console ─────────────────────────────────────────
// Mock by default. Flip with NEXT_PUBLIC_ASSOCIATION_ADMIN_USE_MOCK=false to hit
// the live Go backend at /api/finance/associations/admin/*. The associations
// module ships a real admin surface (KPIs, application approvals, finance summary
// + offline-payment review, member actions, CSV import).
// Money is BIGINT kobo (minor units). Balances are ledger projections (NL-8);
// every approval / offline decision / member action is recorded to audit (NL-12).

import { apiRoot } from '@/config/env';
import { resolveUseMock } from '@/config/useMock';

// Migrated to resolveUseMock now that the Go endpoints are confirmed live
// (backend/internal/association, registered at /api/finance/associations —
// see routes.go). The old inline check defaulted to MOCK unless someone
// remembered to set the flag, which is why this console showed fixtures with
// nothing to indicate it.
const USE_MOCK = resolveUseMock(process.env.NEXT_PUBLIC_ASSOCIATION_ADMIN_USE_MOCK);

// /api/finance/associations/admin — approvals, finance, offline decisions,
// member actions, import, audit-log all live under this admin sub-group
// (routes.go: rg.GET("/admin/kpis") etc., where rg is already the
// /api/finance/associations group).
//
// apiRoot() strips a trailing /api/v1 (if present) before appending the
// module's absolute path — same shape crowdfundingAdminService uses. This
// used to REPLACE /api/v1 with the module path directly on env.apiBaseUrl,
// which silently produced a base with no module prefix at all once
// env.apiBaseUrl became the same-origin proxy path (<origin>/api/admin-proxy,
// no /api/v1 suffix): the regex no longer matched, so every call went to
// <proxy>/kpis instead of <proxy>/api/finance/associations/admin/kpis, and
// 404'd — the exact regression apiRoot()'s own doc comment describes.
function adminBase(): string {
  return `${apiRoot()}/api/finance/associations/admin`;
}
// /api/finance/associations — the module root. The member DIRECTORY reads
// (GET /members, GET /members/:id) are registered directly on the module
// group, not under /admin (routes.go lines 30-31), so they need the
// non-admin base. Member ACTIONS (suspend/restore/transfer/role) ARE under
// /admin/members/:id/* (routes.go lines 79-88) — those use adminBase().
function moduleBase(): string {
  return `${apiRoot()}/api/finance/associations`;
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}
function authHeadersNoContentType(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}
function newIdempotencyKey(): string {
  return `assoc-admin-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
const delay = (ms = 240) => new Promise((r) => setTimeout(r, ms));

// ── Org picker ───────────────────────────────────────────────────────────────
// Every admin read below is scoped to ONE association organisation
// (backend/internal/association/service.go resolveOrgID). A real per-org
// officer using the mobile in-app admin surface never needs this — the
// backend falls back to their own membership when org_id is omitted. The
// platform console has no such membership, so it must always pass one
// explicitly; this module-level singleton (backed by localStorage so it
// survives navigation between the seven association admin pages) is that
// selection. useSelectedOrg() in _ui.tsx is the React-facing wrapper.
const ORG_STORAGE_KEY = 'association_admin_selected_org';
let selectedOrgId: string | null = null;
let orgHydrated = false;
const orgListeners = new Set<(id: string | null) => void>();

export function getSelectedOrgId(): string | null {
  if (!orgHydrated) {
    orgHydrated = true;
    if (typeof window !== 'undefined') selectedOrgId = localStorage.getItem(ORG_STORAGE_KEY);
  }
  return selectedOrgId;
}
export function setSelectedOrgId(id: string | null): void {
  selectedOrgId = id;
  orgHydrated = true;
  if (typeof window !== 'undefined') {
    if (id) localStorage.setItem(ORG_STORAGE_KEY, id);
    else localStorage.removeItem(ORG_STORAGE_KEY);
  }
  orgListeners.forEach((fn) => fn(id));
}
export function onSelectedOrgChange(fn: (id: string | null) => void): () => void {
  orgListeners.add(fn);
  return () => orgListeners.delete(fn);
}
/** Merge org_id (if one is selected) into an existing query string. */
function withOrg(qs: URLSearchParams): URLSearchParams {
  const id = getSelectedOrgId();
  if (id) qs.set('org_id', id);
  return qs;
}

/**
 * Turn a failed Response into a useful Error.
 *
 * Every handler in internal/association answers a failure with
 * `{"error": "<message>"}` (handler_org_admin.go and friends). The old
 * `Request failed (409)` swallowed that message, which matters most on the
 * child-delete routes: the backend refuses a chapter/category delete while
 * members still reference it and says exactly which — a bare status code
 * turns that into an unexplained failure the operator cannot act on.
 */
async function failure(res: Response): Promise<Error> {
  let detail = '';
  try {
    const body = await res.json();
    const raw = (body?.error ?? body?.message) as unknown;
    if (typeof raw === 'string' && raw.trim()) detail = raw.trim();
  } catch { /* non-JSON body (proxy/gateway error) — status alone is all we have */ }
  // Backend errors are prefixed "association: " by the service layer; that
  // prefix is noise in a console that is already inside the module.
  detail = detail.replace(/^association:\s*/i, '');
  return new Error(detail ? `${detail} (${res.status})` : `Request failed (${res.status})`);
}

async function getJson<T>(path: string, base: 'admin' | 'module' = 'admin'): Promise<T> {
  const root = base === 'admin' ? adminBase() : moduleBase();
  const res = await fetch(`${root}${path}`, { headers: authHeaders() });
  if (!res.ok) throw await failure(res);
  const j = await res.json();
  return (j?.data ?? j) as T;
}
async function sendJson<T>(
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body: unknown,
  opts?: { idempotent?: boolean; base?: 'admin' | 'module' },
): Promise<T> {
  const root = (opts?.base ?? 'admin') === 'admin' ? adminBase() : moduleBase();
  const headers = authHeaders();
  // Money-mutating endpoints (offline payment decision, dues-tier create/update)
  // require an Idempotency-Key per house doctrine (CLAUDE.md — every money
  // mutation). The application decision endpoint declares one in the contract too.
  if (opts?.idempotent) headers['Idempotency-Key'] = newIdempotencyKey();
  const res = await fetch(`${root}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw await failure(res);
  const j = await res.json();
  return (j?.data ?? j) as T;
}
async function sendForm<T>(path: string, form: FormData, base: 'admin' | 'module' = 'admin'): Promise<T> {
  const root = base === 'admin' ? adminBase() : moduleBase();
  const res = await fetch(`${root}${path}`, { method: 'POST', headers: authHeadersNoContentType(), body: form });
  if (!res.ok) throw await failure(res);
  const j = await res.json();
  return (j?.data ?? j) as T;
}

export function formatNaira(kobo: number): string {
  const naira = (kobo ?? 0) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
const dateStr = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

// ── Types ────────────────────────────────────────────────────────────────────

/** One entry in the org picker — see ListAdminOrganisations (routes.go). */
export interface AdminOrgOption {
  id: string;
  name: string;
  acronym: string | null;
  category: string;
  status: string;
  published: boolean;
  verified: boolean;
  memberCount: number;
  createdAt: string;
}

/** Filters accepted by the organisation register. */
export interface AdminOrgListOpts {
  limit?: number;
  offset?: number;
  category?: string;
  status?: string;
  published?: boolean;
  verified?: boolean;
}

// Mirrors the real Go AdminKpis struct field-for-field (service.go GetAdminKpis) —
// scoped to ONE organisation (the org picker's selection), not a platform-wide
// total. There is no "associations_total" or activity-feed concept at this
// level; the dashboard page reads recent activity from listAuditLog() instead,
// which already has a real backend behind it.
export interface AssociationKpis {
  totalMembers: number;
  activeMembers: number;
  pendingApprovals: number;
  unpaidMembers: number;
  duesCollectedKobo: number;
  duesOutstandingKobo: number;
}

// Mirrors the real Go AdminApplicationSummary field-for-field (model.go).
// There is no per-application "association_name" or "membership_tier" —
// category/chapter/jurisdiction are what the backend actually tracks, and
// the queue is already scoped to one org (the org picker's selection).
export type ApprovalStatus = 'PENDING' | 'PENDING_CHAPTER' | 'PENDING_NATIONAL' | 'INFO_REQUESTED' | 'APPROVED' | 'REJECTED';
export interface ApprovalRecord {
  id: string;
  applicantName: string;
  category: string;
  chapter: string;
  submittedAt: string;
  status: ApprovalStatus;
  jurisdiction: string;
  paid: boolean;
}
// Backend ApprovalDecisionRequest.Decision is APPROVE | REJECT | REQUEST_INFO
// (model.go) — the console only offers the two-button approve/reject flow.
export type ApprovalDecision = 'approve' | 'reject';

// ── KPIs / dashboard ─────────────────────────────────────────────────────────
const KPIS: AssociationKpis = {
  totalMembers: 12_440,
  activeMembers: 11_680,
  pendingApprovals: 23,
  unpaidMembers: 340,
  duesCollectedKobo: 64_200_000_00,
  duesOutstandingKobo: 18_900_000_00,
};
export async function getAssociationKpis(): Promise<AssociationKpis> {
  if (USE_MOCK) { await delay(); return { ...KPIS }; }
  return getJson<AssociationKpis>(`/kpis?${withOrg(new URLSearchParams())}`);
}

// ── Approvals ────────────────────────────────────────────────────────────────
const APPROVALS: ApprovalRecord[] = [
  { id: 'app_551', applicantName: 'Chioma Adeyemi', category: 'Standard', chapter: 'Lagos Chapter', submittedAt: iso(6), status: 'PENDING', jurisdiction: 'LAGOS', paid: true },
  { id: 'app_549', applicantName: 'Tunde Balogun', category: 'Premium', chapter: 'Abuja Chapter', submittedAt: iso(20), status: 'PENDING', jurisdiction: 'ABUJA', paid: false },
  { id: 'app_540', applicantName: 'Aisha Mohammed', category: 'Standard', chapter: 'Kano Chapter', submittedAt: iso(72), status: 'PENDING_NATIONAL', jurisdiction: 'KANO', paid: true },
];
// The backend never accepts a status filter (GetApprovalQueue hardcodes
// PENDING/PENDING_CHAPTER/PENDING_NATIONAL/INFO_REQUESTED) — it's already a
// pending-only action queue, not a full history. jurisdiction is the one
// filter it does support.
export async function listApprovals(opts?: { jurisdiction?: string }): Promise<ApprovalRecord[]> {
  if (USE_MOCK) { await delay(); return [...APPROVALS]; }
  const qs = withOrg(new URLSearchParams());
  if (opts?.jurisdiction) qs.set('jurisdiction', opts.jurisdiction);
  return getJson<ApprovalRecord[]>(`/approvals?${qs}`);
}
export async function decideApplication(id: string, decision: ApprovalDecision, note?: string): Promise<{ ok: boolean }> {
  if (USE_MOCK) { await delay(); return { ok: true }; }
  // Idempotency-Key: the contract declares one on this endpoint and approving an
  // application can settle a registration fee — a double-submitted approval must
  // not be able to post twice. This console was sending the decision WITHOUT the
  // header, so every retry (or double-click) was a fresh, unguarded request.
  return sendJson<{ ok: boolean }>(
    'POST',
    `/approvals/${id}/decision`,
    { decision: decision === 'approve' ? 'APPROVE' : 'REJECT', note },
    { idempotent: true },
  );
}

/**
 * One application in full (GET /admin/approvals/:id — handler.go GetApproval).
 * The queue row (ApprovalRecord) carries only the summary; this adds the
 * applicant's contact details, sponsor and the registration fee they owe.
 */
export interface ApprovalDetail extends ApprovalRecord {
  email: string;
  phone: string;
  profession: string;
  sponsor?: string | null;
  registrationFeeKobo: number;
}
export async function getApproval(id: string): Promise<ApprovalDetail> {
  if (USE_MOCK) {
    await delay();
    const a = APPROVALS.find((x) => x.id === id);
    if (!a) throw new Error('Application not found');
    return { ...a, email: 'applicant@example.com', phone: '+234800000000', profession: 'Trader', sponsor: null, registrationFeeKobo: 5_000_00 };
  }
  return getJson<ApprovalDetail>(`/approvals/${id}`);
}

// ── Finance + offline payments ───────────────────────────────────────────────
// Mirrors the real Go FinanceSummary / OfflinePayment structs field-for-field
// (model.go) — scoped to one org, no "association_name" per row.
export interface AssociationFinance {
  collectedKobo: number;
  outstandingKobo: number;
  paidMembers: number;
  unpaidMembers: number;
  offlinePending: number;
}
export interface OfflinePayment {
  id: string;
  memberName: string;
  memberId: string;
  amountKobo: number;
  method: string;
  reference: string;
  forItem: string;
  submittedAt: string;
  status: string;
}

const FINANCE: AssociationFinance = {
  collectedKobo: 64_200_000_00,
  outstandingKobo: 18_900_000_00,
  paidMembers: 11_340,
  unpaidMembers: 340,
  offlinePending: 11,
};
export async function getAssociationFinance(): Promise<AssociationFinance> {
  if (USE_MOCK) { await delay(); return { ...FINANCE }; }
  return getJson<AssociationFinance>(`/finance?${withOrg(new URLSearchParams())}`);
}

const OFFLINE: OfflinePayment[] = [
  { id: 'off_204', memberName: 'Bola Thompson', memberId: 'LTU-2201', amountKobo: 50_000_00, method: 'bank_transfer', reference: 'TRF-99201', forItem: '2026 Annual Dues', submittedAt: iso(3), status: 'PENDING' },
  { id: 'off_199', memberName: 'Seun Kolawole', memberId: 'TFG-0043', amountKobo: 120_000_00, method: 'cash_deposit', reference: 'DEP-44120', forItem: '2026 Annual Dues', submittedAt: iso(10), status: 'PENDING' },
];
// GetOfflinePayments hardcodes status='PENDING' — there is no status filter
// to pass (an approved/rejected payment simply stops appearing here).
export async function listOfflinePayments(): Promise<OfflinePayment[]> {
  if (USE_MOCK) { await delay(); return [...OFFLINE]; }
  return getJson<OfflinePayment[]>(`/finance/offline?${withOrg(new URLSearchParams())}`);
}
export async function decideOfflinePayment(id: string, decision: ApprovalDecision, note?: string): Promise<{ ok: boolean }> {
  if (USE_MOCK) { await delay(); return { ok: true }; }
  // Backend contract (handler_actions.go DecideOfflinePayment): POST body is
  // { approve: boolean }, keyed on Idempotency-Key (money path — NL-6/NL-8).
  // note has nowhere to go on this endpoint — it isn't part of the request.
  void note;
  return sendJson<{ ok: boolean }>('POST', `/finance/offline/${id}/decision`, { approve: decision === 'approve' }, { idempotent: true });
}

// ── Members directory + detail + actions ────────────────────────────────────
// Mirrors backend internal/association model.go MemberProfileSummary / MemberProfile
// and handler_actions.go suspend/restore/transfer/role bodies exactly.
export interface MemberSummary {
  id: string;
  fullName: string;
  memberId: string;
  photoUrl?: string | null;
  categoryLabel: string;
  chapterName?: string | null;
  status: string; // active | suspended | pending | ...
  profession?: string | null;
}
export interface MemberDetail extends MemberSummary {
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  joinedAt: string;
  paymentStanding: string;
  bio?: string | null;
  contactRestricted: boolean;
}
export interface MemberDirectoryFilters {
  search?: string;
  chapterId?: string;
  category?: string;
  status?: string;
}
export interface MemberActionResult { ok: boolean }

const MEMBERS: MemberSummary[] = [
  { id: 'mem_9981', fullName: 'Bola Thompson', memberId: 'LTU-2201', photoUrl: null, categoryLabel: 'Standard', chapterName: 'Lagos Chapter', status: 'suspended', profession: 'Trader' },
  { id: 'mem_7742', fullName: 'Chioma Adeyemi', memberId: 'LTU-1187', photoUrl: null, categoryLabel: 'Premium', chapterName: 'Lagos Chapter', status: 'active', profession: 'Fashion Designer' },
  { id: 'mem_5510', fullName: 'Tunde Balogun', memberId: 'TFG-0043', photoUrl: null, categoryLabel: 'Standard', chapterName: 'Abuja Chapter', status: 'active', profession: 'Software Engineer' },
];
const MEMBER_DETAILS: Record<string, MemberDetail> = Object.fromEntries(
  MEMBERS.map((m) => [m.id, {
    ...m,
    email: `${m.memberId.toLowerCase()}@example.com`,
    phone: '+234800000000',
    location: 'Lagos, Nigeria',
    joinedAt: iso(24 * 30),
    paymentStanding: m.status === 'suspended' ? 'in_default' : 'current',
    bio: null,
    contactRestricted: false,
  }]),
);

export async function listMembers(filters?: MemberDirectoryFilters): Promise<MemberSummary[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...MEMBERS];
    if (filters?.status) rows = rows.filter((m) => m.status === filters.status);
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      rows = rows.filter((m) => m.fullName.toLowerCase().includes(q) || m.memberId.toLowerCase().includes(q));
    }
    return rows;
  }
  const qs = withOrg(new URLSearchParams());
  if (filters?.search) qs.set('search', filters.search);
  if (filters?.chapterId) qs.set('chapterId', filters.chapterId);
  if (filters?.category) qs.set('category', filters.category);
  if (filters?.status) qs.set('status', filters.status);
  // GET /members is on the module root, not /admin (routes.go line 30). The
  // org_id override is what makes this usable from the platform console at
  // all — the endpoint's DEFAULT scoping is "orgs I actively belong to",
  // which is empty for a platform admin (service.go GetDirectory).
  return getJson<MemberSummary[]>(`/members${qs.toString() ? `?${qs}` : ''}`, 'module');
}

export async function getMember(id: string): Promise<MemberDetail> {
  if (USE_MOCK) {
    await delay();
    const m = MEMBER_DETAILS[id];
    if (!m) throw new Error('Member not found');
    return { ...m };
  }
  // GET /members/:id is on the module root, not /admin (routes.go line 31).
  return getJson<MemberDetail>(`/members/${id}`, 'module');
}

// Member actions ARE under /admin/members/:id/* (routes.go lines 79-88).
export async function suspendMember(id: string, reason: string): Promise<MemberActionResult> {
  if (USE_MOCK) { await delay(); return { ok: true }; }
  return sendJson<MemberActionResult>('POST', `/members/${id}/suspend`, { reason });
}
export async function restoreMember(id: string): Promise<MemberActionResult> {
  if (USE_MOCK) { await delay(); return { ok: true }; }
  return sendJson<MemberActionResult>('POST', `/members/${id}/restore`, {});
}
export async function transferMember(id: string, chapter: string): Promise<MemberActionResult> {
  if (USE_MOCK) { await delay(); return { ok: true }; }
  return sendJson<MemberActionResult>('POST', `/members/${id}/transfer`, { chapter });
}
export async function assignMemberRole(id: string, role: string): Promise<MemberActionResult> {
  if (USE_MOCK) { await delay(); return { ok: true }; }
  return sendJson<MemberActionResult>('POST', `/members/${id}/role`, { role });
}

// ── Bulk import (CSV) ────────────────────────────────────────────────────────
// Backend: model_ext.go ImportRow / ImportPreview / ImportConfirmRequest /
// ImportResult; handler_ext.go ImportPreview (multipart "file" + org_id query)
// + ConfirmImport (JSON { sendInvites }).
export interface ImportRow {
  rowNum: number;
  name: string;
  phone: string;
  email: string;
  chapter: string;
  issue?: string | null;
}
export interface ImportPreviewResult {
  fileName: string;
  total: number;
  valid: number;
  duplicates: number;
  invalid: number;
  rows: ImportRow[];
}
export interface ImportConfirmResult {
  imported: number;
  skipped: number;
  invited: number;
  batchId: string;
}

const MOCK_IMPORT_PREVIEW: ImportPreviewResult = {
  fileName: 'members.csv',
  total: 4,
  valid: 3,
  duplicates: 1,
  invalid: 0,
  rows: [
    { rowNum: 1, name: 'Femi Okafor', phone: '+2348012345678', email: 'femi@example.com', chapter: 'Lagos Chapter', issue: null },
    { rowNum: 2, name: 'Grace Nwosu', phone: '+2348012345679', email: 'grace@example.com', chapter: 'Lagos Chapter', issue: null },
    { rowNum: 3, name: 'Ibrahim Sule', phone: '+2348012345680', email: 'ibrahim@example.com', chapter: 'Abuja Chapter', issue: null },
    { rowNum: 4, name: 'Grace Nwosu', phone: '+2348012345679', email: 'grace@example.com', chapter: 'Lagos Chapter', issue: 'duplicate of row 2' },
  ],
};

export async function previewImport(orgId: string, file: File): Promise<ImportPreviewResult> {
  if (USE_MOCK) { await delay(); return { ...MOCK_IMPORT_PREVIEW }; }
  const form = new FormData();
  form.append('file', file);
  return sendForm<ImportPreviewResult>(`/import/preview?org_id=${encodeURIComponent(orgId)}`, form);
}

export async function confirmImport(sendInvites: boolean): Promise<ImportConfirmResult> {
  if (USE_MOCK) {
    await delay();
    return { imported: MOCK_IMPORT_PREVIEW.valid, skipped: MOCK_IMPORT_PREVIEW.duplicates + MOCK_IMPORT_PREVIEW.invalid, invited: sendInvites ? MOCK_IMPORT_PREVIEW.valid : 0, batchId: `batch_${Math.random().toString(36).slice(2, 10)}` };
  }
  return sendJson<ImportConfirmResult>('POST', '/import/confirm', { sendInvites });
}

export async function bulkImportMembers(orgId: string, file: File): Promise<{ ok: boolean; imported: number }> {
  if (USE_MOCK) { await delay(); return { ok: true, imported: MOCK_IMPORT_PREVIEW.valid }; }
  const form = new FormData();
  form.append('file', file);
  return sendForm<{ ok: boolean; imported: number }>(`/import/members?org_id=${encodeURIComponent(orgId)}`, form);
}

// ── Audit log (read-only) ────────────────────────────────────────────────────
// Backend: model_detail.go AuditLogEntry; handler_detail.go GetAuditLog
// (query param `action`, optional filter).
export interface AuditLogEntry {
  id: string;
  actorId: string;
  action: string;
  subjectType: string;
  subjectId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

const MOCK_AUDIT_LOG: AuditLogEntry[] = [
  { id: 'aud_001', actorId: 'admin_1', action: 'approval.approve', subjectType: 'application', subjectId: 'app_540', metadata: { note: 'Docs verified' }, createdAt: iso(72) },
  { id: 'aud_002', actorId: 'admin_1', action: 'offline_payment.approve', subjectType: 'offline_payment', subjectId: 'off_188', metadata: {}, createdAt: iso(48) },
  { id: 'aud_003', actorId: 'admin_2', action: 'member.suspend', subjectType: 'member', subjectId: 'mem_9981', metadata: { reason: 'Dues default' }, createdAt: iso(4) },
];

export async function listAuditLog(action?: string): Promise<AuditLogEntry[]> {
  if (USE_MOCK) {
    await delay();
    return action ? MOCK_AUDIT_LOG.filter((e) => e.action === action) : [...MOCK_AUDIT_LOG];
  }
  const qs = withOrg(new URLSearchParams());
  if (action) qs.set('action', action);
  return getJson<AuditLogEntry[]>(`/audit-log?${qs}`);
}

// ── Org picker ───────────────────────────────────────────────────────────────
const MOCK_ORGS: AdminOrgOption[] = [
  { id: 'org_ltu', name: 'Lagos Traders Union', acronym: 'LTU', category: 'Trade', status: 'ACTIVE', published: true, verified: true, memberCount: 4820, createdAt: '2025-03-04T09:00:00Z' },
  { id: 'org_tfg', name: 'Tech Founders Guild', acronym: 'TFG', category: 'Professional', status: 'ACTIVE', published: true, verified: true, memberCount: 1240, createdAt: '2025-06-18T09:00:00Z' },
  { id: 'org_mwc', name: 'Market Women Co-op', acronym: null, category: 'Cooperative', status: 'SUSPENDED', published: true, verified: false, memberCount: 6380, createdAt: '2024-11-02T09:00:00Z' },
];
/**
 * Feeds the org picker (see the "Org picker" comment above authHeaders).
 * A platform super-admin gets every organisation; a real per-org officer
 * gets only the org(s) they administer (backend/internal/association
 * service.go ListAdminOrganisations).
 */
export async function listAdminOrganisations(
  search?: string,
  page?: AdminOrgListOpts,
): Promise<AdminOrgOption[]> {
  if (USE_MOCK) {
    await delay();
    const q = (search || '').toLowerCase();
    let rows = q
      ? MOCK_ORGS.filter((o) => o.name.toLowerCase().includes(q) || (o.acronym ?? '').toLowerCase().includes(q))
      : [...MOCK_ORGS];
    if (page?.published != null) rows = rows.filter((o) => o.published === page.published);
    if (page?.verified != null) rows = rows.filter((o) => o.verified === page.verified);
    if (page?.status) rows = rows.filter((o) => o.status === page.status);
    if (page?.category) rows = rows.filter((o) => o.category === page.category);
    const off = page?.offset ?? 0;
    return page?.limit ? rows.slice(off, off + page.limit) : rows.slice(off);
  }
  const qs = new URLSearchParams();
  if (search) qs.set('search', search);
  // published/verified/status/category are now narrowed by the QUERY, not by
  // the client after the fact — a client-side filter could empty a page purely
  // because the matching rows happened to sit on another one.
  if (page?.published != null) qs.set('published', String(page.published));
  if (page?.verified != null) qs.set('verified', String(page.verified));
  if (page?.status) qs.set('status', page.status);
  if (page?.category) qs.set('category', page.category);
  // limit/offset are read by pageParams (handler.go) and clamped service-side to
  // 200; without them the backend serves a fixed first 100 with no way to reach
  // organisation 101, which is why the picker could only ever see one page.
  if (page?.limit != null) qs.set('limit', String(page.limit));
  if (page?.offset) qs.set('offset', String(page.offset));
  return getJson<AdminOrgOption[]>(`/organisations${qs.toString() ? `?${qs}` : ''}`);
}

// ── Elections (TS-13 / AD-004/005) ───────────────────────────────────────────
// Officer-facing election administration. Routes live on the MODULE group
// (/api/finance/associations/elections, base:'module'), not under /admin.
// Results stay sealed until PUBLISHED (AD-005): during VOTING only turnout is
// exposed via the tally endpoint.

export type ElectionStatus = 'DRAFT' | 'NOMINATION' | 'VOTING' | 'CLOSED' | 'PUBLISHED' | 'CANCELLED';
export type ElectionRole = 'CHAPTER_ADMIN' | 'FINANCE_ADMIN' | 'SECRETARY' | 'NATIONAL_ADMIN' | '';

export interface AdminElectionSummary {
  id: string; title: string; status: ElectionStatus;
  votingOpensAt: string | null; votingClosesAt: string | null; positionCount: number;
}
export interface AdminElectionCandidate { id: string; name: string; manifesto: string; status: string }
export interface AdminElectionPosition { id: string; title: string; seats: number; role?: ElectionRole; candidates: AdminElectionCandidate[] }
export interface AdminCandidateResult { candidateId: string; name: string; votes: number; isWinner: boolean }
export interface AdminPositionResult { positionId: string; title: string; seats: number; ballotsCast: number; results: AdminCandidateResult[]; checksum?: string }
export interface AdminElectionDetail {
  id: string; title: string; description: string; status: ElectionStatus;
  votingOpensAt: string | null; votingClosesAt: string | null;
  positions: AdminElectionPosition[]; results?: AdminPositionResult[];
}
export interface CreateElectionInput {
  title: string; description?: string; votingOpensAt?: string | null; votingClosesAt?: string | null;
  requireGoodStanding?: boolean;
  positions: { title: string; seats: number; role?: ElectionRole }[];
}
export interface ElectionHandoverResult {
  positions: { positionId: string; title: string; role: string; winners: string[]; revoked: number }[];
}

// ── Mock lifecycle state (USE_MOCK) ──
const mockElections: AdminElectionDetail[] = [
  {
    id: 'elec_mock_1', title: '2026 National Executive Election',
    description: 'Elect the incoming national executive council.', status: 'VOTING',
    votingOpensAt: '2026-07-01T09:00:00Z', votingClosesAt: '2026-08-30T17:00:00Z',
    positions: [
      { id: 'pos_pres', title: 'President', seats: 1, role: 'NATIONAL_ADMIN', candidates: [
        { id: 'c_pres_a', name: 'Dr. Amaka Obi', manifesto: 'Transparency in dues and quarterly town halls.', status: 'APPROVED' },
        { id: 'c_pres_b', name: 'Engr. Tunde Bello', manifesto: 'Digitise the register; group insurance.', status: 'APPROVED' },
      ] },
      { id: 'pos_sec', title: 'Secretary', seats: 1, role: 'SECRETARY', candidates: [
        { id: 'c_sec_a', name: 'Barr. Ngozi Eze', manifesto: 'Minutes within 48 hours; open records.', status: 'APPROVED' },
      ] },
    ],
  },
];
const mockTally: Record<string, number> = { c_pres_a: 128, c_pres_b: 74, c_sec_a: 190 };
let mockSeq = 2;

function mockSummary(e: AdminElectionDetail): AdminElectionSummary {
  return { id: e.id, title: e.title, status: e.status, votingOpensAt: e.votingOpensAt, votingClosesAt: e.votingClosesAt, positionCount: e.positions.length };
}
function mockPositionResults(e: AdminElectionDetail): AdminPositionResult[] {
  return e.positions.map((p) => {
    const results: AdminCandidateResult[] = p.candidates
      .map((c) => ({ candidateId: c.id, name: c.name, votes: mockTally[c.id] ?? 0, isWinner: false }))
      .sort((a, b) => b.votes - a.votes);
    results.forEach((r, i) => { if (i < p.seats && r.votes > 0) r.isWinner = true; });
    const ballotsCast = results.reduce((s, r) => s + r.votes, 0);
    return { positionId: p.id, title: p.title, seats: p.seats, ballotsCast, results, checksum: 'mock-' + p.id };
  });
}

export async function listElections(): Promise<AdminElectionSummary[]> {
  if (USE_MOCK) { await delay(); return mockElections.map(mockSummary); }
  return getJson<AdminElectionSummary[]>(`/elections?${withOrg(new URLSearchParams())}`, 'module');
}
export async function getElection(id: string): Promise<AdminElectionDetail> {
  if (USE_MOCK) {
    await delay();
    const e = mockElections.find((x) => x.id === id);
    if (!e) throw new Error('Election not found');
    return { ...e, results: e.status === 'PUBLISHED' ? mockPositionResults(e) : undefined };
  }
  return getJson<AdminElectionDetail>(`/elections/${id}`, 'module');
}
export async function getElectionTally(id: string): Promise<AdminPositionResult[]> {
  if (USE_MOCK) {
    await delay();
    const e = mockElections.find((x) => x.id === id);
    return e ? mockPositionResults(e) : [];
  }
  return getJson<AdminPositionResult[]>(`/elections/${id}/tally`, 'module');
}
export async function createElection(input: CreateElectionInput): Promise<{ id: string }> {
  if (USE_MOCK) {
    await delay();
    const id = `elec_mock_${mockSeq++}`;
    mockElections.unshift({
      id, title: input.title, description: input.description ?? '', status: 'DRAFT',
      votingOpensAt: input.votingOpensAt ?? null, votingClosesAt: input.votingClosesAt ?? null,
      positions: input.positions.map((p, i) => ({ id: `${id}_p${i}`, title: p.title, seats: p.seats || 1, role: p.role || '', candidates: [] })),
    });
    return { id };
  }
  const orgId = getSelectedOrgId();
  const qs = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
  return sendJson<{ id: string }>('POST', `/elections${qs}`, input, { base: 'module' });
}
export async function addElectionCandidate(id: string, input: { positionId: string; membershipId: string; manifesto?: string }): Promise<{ id: string }> {
  if (USE_MOCK) {
    await delay();
    const e = mockElections.find((x) => x.id === id);
    const p = e?.positions.find((pp) => pp.id === input.positionId);
    const cid = `c_${Math.random().toString(36).slice(2, 8)}`;
    p?.candidates.push({ id: cid, name: input.membershipId, manifesto: input.manifesto ?? '', status: 'APPROVED' });
    return { id: cid };
  }
  return sendJson<{ id: string }>('POST', `/elections/${id}/candidates`, input, { base: 'module' });
}
function mockTransition(id: string, from: ElectionStatus[], to: ElectionStatus) {
  const e = mockElections.find((x) => x.id === id);
  if (!e || !from.includes(e.status)) throw new Error(`Invalid state: election is ${e?.status ?? 'missing'}`);
  e.status = to;
}
export async function openElection(id: string): Promise<void> {
  if (USE_MOCK) { await delay(); mockTransition(id, ['DRAFT', 'NOMINATION'], 'VOTING'); return; }
  await sendJson('POST', `/elections/${id}/open`, {}, { base: 'module' });
}
export async function closeElection(id: string): Promise<void> {
  if (USE_MOCK) { await delay(); mockTransition(id, ['VOTING'], 'CLOSED'); return; }
  await sendJson('POST', `/elections/${id}/close`, {}, { base: 'module' });
}
export async function publishElectionResults(id: string): Promise<AdminPositionResult[]> {
  if (USE_MOCK) { await delay(); mockTransition(id, ['CLOSED'], 'PUBLISHED'); return mockPositionResults(mockElections.find((x) => x.id === id)!); }
  return sendJson<AdminPositionResult[]>('POST', `/elections/${id}/publish`, {}, { base: 'module' });
}
export async function handoverElection(id: string): Promise<ElectionHandoverResult> {
  if (USE_MOCK) {
    await delay();
    const e = mockElections.find((x) => x.id === id);
    if (!e || e.status !== 'PUBLISHED') throw new Error('Handover requires a published election');
    return { positions: mockPositionResults(e).filter((p) => e.positions.find((pp) => pp.id === p.positionId)?.role).map((p) => ({ positionId: p.positionId, title: p.title, role: e.positions.find((pp) => pp.id === p.positionId)?.role || '', winners: p.results.filter((r) => r.isWinner).map((r) => r.name), revoked: 1 })) };
  }
  return sendJson<ElectionHandoverResult>('POST', `/elections/${id}/handover`, {}, { base: 'module' });
}

// ── Organisation management (admin) ──────────────────────────────────────────
// backend/internal/association routes.go "Admin: organisation management".
// assoc_organisations used to be write-once — no UPDATE/DELETE existed against
// it or its chapters / committees / dues tiers, so every field was immutable
// after creation and `verified` was dead schema. These are the routes that
// changed that, and the console pages under
// app/admin/association/organisations/* are their only consumer.
//
// Money rule: duesKobo and registrationFeeKobo are INTEGER KOBO (minor units).
// Never floats, never strings for math — render with formatNaira().

export type ChapterLevel = 'REGION' | 'STATE' | 'LOCAL';
export type DuesCadence = 'MONTHLY' | 'QUARTERLY' | 'ANNUAL' | 'ONE_OFF';
export type OrgGroupType = 'OPEN' | 'CLOSED' | 'INVITE_ONLY' | 'CODE_BASED' | 'PAID';
export type OrgApprovalRule = 'AUTO' | 'ADMIN' | 'CHAPTER_THEN_NATIONAL' | 'PAYMENT_FIRST';

export const CHAPTER_LEVELS: ChapterLevel[] = ['REGION', 'STATE', 'LOCAL'];
export const DUES_CADENCES: DuesCadence[] = ['MONTHLY', 'QUARTERLY', 'ANNUAL', 'ONE_OFF'];
export const ORG_GROUP_TYPES: OrgGroupType[] = ['OPEN', 'CLOSED', 'INVITE_ONLY', 'CODE_BASED', 'PAID'];
export const ORG_APPROVAL_RULES: OrgApprovalRule[] = ['AUTO', 'ADMIN', 'CHAPTER_THEN_NATIONAL', 'PAYMENT_FIRST'];

/** Mirrors Go OrgRestrictions (model.go). */
export interface OrgRestrictions {
  graceDays: number;
  disableVoting: boolean;
  disableEvents: boolean;
  disableChat: boolean;
  disableCard: boolean;
}
/** Mirrors Go Chapter (model.go). */
export interface OrgChapter { id: string; name: string; level: string; parentId?: string | null; memberCount: number }
/** Mirrors Go AdminCommittee (model_org_admin.go). */
export interface OrgCommittee { id: string; name: string; description?: string | null; memberCount: number }
/** Mirrors Go MembershipCategory (model.go) — duesKobo is integer kobo. */
export interface OrgCategory { id: string; label: string; description?: string | null; duesKobo: number; duesCadence: string }
/** Mirrors Go AdminOrgRule (model_org_admin.go). */
export interface OrgRule { id: string; body: string; position: number }
/** Mirrors Go AdminChapterLeader (model_org_admin.go). Read-only in this console. */
export interface OrgChapterLeader {
  id: string; chapterId?: string | null; stateName: string;
  leaderName?: string | null; leaderContact?: string | null; canApproveMembers: boolean;
}

/** Mirrors Go AdminOrganisationDetail (model_org_admin.go) field-for-field. */
export interface AdminOrganisationDetail {
  id: string;
  name: string;
  acronym?: string | null;
  category: string;
  description?: string | null;
  logoUrl?: string | null;
  coverUrl?: string | null;
  groupType: string;
  approvalRule: string;
  registrationFeeKobo: number;
  requiresPayment: boolean;
  foundedYear?: number | null;
  location?: string | null;
  website?: string | null;
  verified: boolean;
  published: boolean;
  status: string;
  structureType?: string | null;
  createdBy?: string | null;
  createdAt: string;
  suspendedAt?: string | null;

  restrictions: OrgRestrictions;
  settings: Record<string, unknown>;

  memberCount: number;
  activeCount: number;
  pendingCount: number;
  chapterCount: number;
  committeeCount: number;
  categoryCount: number;

  chapters: OrgChapter[];
  committees: OrgCommittee[];
  categories: OrgCategory[];
  rules: OrgRule[];
  leaders: OrgChapterLeader[];
}

/**
 * Partial patch — EVERY field is optional and an omitted key means "leave
 * unchanged" (Go UpdateOrganisationRequest uses pointers for exactly this).
 * Do not send `undefined` keys expecting a blank: JSON.stringify drops them,
 * which is the behaviour we want.
 */
export interface UpdateOrganisationInput {
  name?: string;
  acronym?: string;
  category?: string;
  description?: string;
  logoUrl?: string;
  coverUrl?: string;
  groupType?: OrgGroupType;
  approvalRule?: OrgApprovalRule;
  /** Integer kobo. Never a float. */
  registrationFeeKobo?: number;
  foundedYear?: number;
  location?: string;
  website?: string;
  structureType?: string;
  graceDays?: number;
  disableVoting?: boolean;
  disableEvents?: boolean;
  disableChat?: boolean;
  disableCard?: boolean;
}

export interface ChapterInput { name: string; level: ChapterLevel }
export interface CommitteeInput { name: string; description?: string | null }
/** duesKobo is integer kobo (minor units) — the page converts naira → kobo. */
export interface CategoryInput { label: string; description?: string | null; duesKobo: number; cadence: DuesCadence }
export interface RuleInput { body: string; position: number }

// ── Mock organisation state (USE_MOCK) ──
// Mutable so the management pages behave sensibly with the backend switched off
// (add a chapter, see it appear) instead of silently discarding every write.
function mockDetailFor(o: AdminOrgOption): AdminOrganisationDetail {
  return {
    id: o.id, name: o.name, acronym: o.name.split(' ').map((w) => w[0]).join('').toUpperCase(),
    category: 'TRADE', description: 'Sample organisation (mock mode).', logoUrl: null, coverUrl: null,
    groupType: 'OPEN', approvalRule: 'ADMIN', registrationFeeKobo: 5_000_00, requiresPayment: true,
    foundedYear: 2015, location: 'Lagos, Nigeria', website: null,
    verified: o.verified, published: o.published, status: 'ACTIVE', structureType: 'CHAPTERED',
    createdBy: null, createdAt: iso(24 * 365), suspendedAt: null,
    restrictions: { graceDays: 30, disableVoting: false, disableEvents: false, disableChat: false, disableCard: false },
    settings: { welcomeMessage: 'Welcome to the union.', duesReminderDays: 7 },
    memberCount: o.memberCount, activeCount: o.memberCount, pendingCount: 3,
    chapterCount: 2, committeeCount: 1, categoryCount: 2,
    chapters: [
      { id: `${o.id}_ch1`, name: 'Lagos Chapter', level: 'STATE', parentId: null, memberCount: 120 },
      { id: `${o.id}_ch2`, name: 'Abuja Chapter', level: 'STATE', parentId: null, memberCount: 64 },
    ],
    committees: [{ id: `${o.id}_cm1`, name: 'Welfare Committee', description: 'Member welfare and hardship.', memberCount: 8 }],
    categories: [
      { id: `${o.id}_ct1`, label: 'Standard', description: null, duesKobo: 10_000_00, duesCadence: 'ANNUAL' },
      { id: `${o.id}_ct2`, label: 'Premium', description: null, duesKobo: 25_000_00, duesCadence: 'ANNUAL' },
    ],
    rules: [{ id: `${o.id}_r1`, body: 'Dues are payable by 31 March each year.', position: 1 }],
    leaders: [{ id: `${o.id}_l1`, chapterId: `${o.id}_ch1`, stateName: 'Lagos', leaderName: 'Chioma Adeyemi', leaderContact: '+234800000000', canApproveMembers: true }],
  };
}
const MOCK_ORG_DETAILS: Record<string, AdminOrganisationDetail> = Object.fromEntries(
  MOCK_ORGS.map((o) => [o.id, mockDetailFor(o)]),
);
function mockOrg(id: string): AdminOrganisationDetail {
  const d = MOCK_ORG_DETAILS[id];
  if (!d) throw new Error('Organisation not found');
  return d;
}
function mockId(prefix: string): string { return `${prefix}_${Math.random().toString(36).slice(2, 10)}`; }

export async function getAdminOrganisation(id: string): Promise<AdminOrganisationDetail> {
  if (USE_MOCK) { await delay(); return structuredClone(mockOrg(id)); }
  return getJson<AdminOrganisationDetail>(`/organisations/${id}`);
}

export async function updateAdminOrganisation(id: string, patch: UpdateOrganisationInput): Promise<AdminOrganisationDetail> {
  if (USE_MOCK) {
    await delay();
    const d = mockOrg(id);
    const { graceDays, disableVoting, disableEvents, disableChat, disableCard, ...rest } = patch;
    Object.assign(d, rest);
    if (graceDays !== undefined) d.restrictions.graceDays = graceDays;
    if (disableVoting !== undefined) d.restrictions.disableVoting = disableVoting;
    if (disableEvents !== undefined) d.restrictions.disableEvents = disableEvents;
    if (disableChat !== undefined) d.restrictions.disableChat = disableChat;
    if (disableCard !== undefined) d.restrictions.disableCard = disableCard;
    return structuredClone(d);
  }
  return sendJson<AdminOrganisationDetail>('PATCH', `/organisations/${id}`, patch);
}

// ── Lifecycle flags ──
// Six single-purpose POSTs rather than one flag endpoint (routes.go
// orgFlagHandler). verify/unverify is PLATFORM-super-admin only; the other two
// pairs are open to an org admin.
export type OrgFlagAction = 'verify' | 'unverify' | 'publish' | 'unpublish' | 'suspend' | 'restore';
export async function setOrganisationFlag(id: string, action: OrgFlagAction): Promise<{ ok: boolean }> {
  if (USE_MOCK) {
    await delay();
    const d = mockOrg(id);
    if (action === 'verify' || action === 'unverify') d.verified = action === 'verify';
    if (action === 'publish' || action === 'unpublish') d.published = action === 'publish';
    if (action === 'suspend' || action === 'restore') {
      d.status = action === 'suspend' ? 'SUSPENDED' : 'ACTIVE';
      d.suspendedAt = action === 'suspend' ? new Date().toISOString() : null;
    }
    return { ok: true };
  }
  return sendJson<{ ok: boolean }>('POST', `/organisations/${id}/${action}`, {});
}

// ── Per-organisation custom settings ──
// A free-form jsonb object. PUT takes a PARTIAL object and MERGES it server-side;
// a null value DELETES that key. Sending the whole object is therefore never
// required — and a key you omit is never lost.
export async function getOrganisationSettings(id: string): Promise<Record<string, unknown>> {
  if (USE_MOCK) { await delay(); return structuredClone(mockOrg(id).settings); }
  return getJson<Record<string, unknown>>(`/organisations/${id}/settings`);
}
export async function updateOrganisationSettings(
  id: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (USE_MOCK) {
    await delay();
    const d = mockOrg(id);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete d.settings[k];
      else d.settings[k] = v;
    }
    return structuredClone(d.settings);
  }
  return sendJson<Record<string, unknown>>('PUT', `/organisations/${id}/settings`, patch);
}

// ── Chapters ──
export async function createChapter(orgId: string, input: ChapterInput): Promise<{ id: string }> {
  if (USE_MOCK) {
    await delay();
    const d = mockOrg(orgId);
    const id = mockId('ch');
    d.chapters.push({ id, name: input.name, level: input.level, parentId: null, memberCount: 0 });
    d.chapterCount = d.chapters.length;
    return { id };
  }
  return sendJson<{ id: string }>('POST', `/organisations/${orgId}/chapters`, input);
}
export async function updateChapter(chapterId: string, input: ChapterInput): Promise<{ ok: boolean }> {
  if (USE_MOCK) {
    await delay();
    for (const d of Object.values(MOCK_ORG_DETAILS)) {
      const c = d.chapters.find((x) => x.id === chapterId);
      if (c) { c.name = input.name; c.level = input.level; return { ok: true }; }
    }
    throw new Error('Chapter not found');
  }
  // PATCH sends the FULL body: Go binds ChapterRequest with `binding:"required"`
  // on name, so a name-less "partial" patch is a 400, not a no-op.
  return sendJson<{ ok: boolean }>('PATCH', `/chapters/${chapterId}`, input);
}
export async function deleteChapter(chapterId: string): Promise<{ ok: boolean }> {
  if (USE_MOCK) {
    await delay();
    for (const d of Object.values(MOCK_ORG_DETAILS)) {
      const i = d.chapters.findIndex((x) => x.id === chapterId);
      if (i >= 0) {
        if (d.chapters[i].memberCount > 0) throw new Error('Chapter still has members assigned to it');
        d.chapters.splice(i, 1); d.chapterCount = d.chapters.length; return { ok: true };
      }
    }
    throw new Error('Chapter not found');
  }
  // The backend refuses while members still reference the chapter and says so —
  // failure() surfaces that message rather than a bare status code.
  return sendJson<{ ok: boolean }>('DELETE', `/chapters/${chapterId}`, undefined);
}

// ── Committees ──
export async function createCommittee(orgId: string, input: CommitteeInput): Promise<{ id: string }> {
  if (USE_MOCK) {
    await delay();
    const d = mockOrg(orgId);
    const id = mockId('cm');
    d.committees.push({ id, name: input.name, description: input.description ?? null, memberCount: 0 });
    d.committeeCount = d.committees.length;
    return { id };
  }
  return sendJson<{ id: string }>('POST', `/organisations/${orgId}/committees`, input);
}
export async function updateCommittee(committeeId: string, input: CommitteeInput): Promise<{ ok: boolean }> {
  if (USE_MOCK) {
    await delay();
    for (const d of Object.values(MOCK_ORG_DETAILS)) {
      const c = d.committees.find((x) => x.id === committeeId);
      if (c) { c.name = input.name; c.description = input.description ?? null; return { ok: true }; }
    }
    throw new Error('Committee not found');
  }
  return sendJson<{ ok: boolean }>('PATCH', `/committees/${committeeId}`, input);
}
export async function deleteCommittee(committeeId: string): Promise<{ ok: boolean }> {
  if (USE_MOCK) {
    await delay();
    for (const d of Object.values(MOCK_ORG_DETAILS)) {
      const i = d.committees.findIndex((x) => x.id === committeeId);
      if (i >= 0) { d.committees.splice(i, 1); d.committeeCount = d.committees.length; return { ok: true }; }
    }
    throw new Error('Committee not found');
  }
  return sendJson<{ ok: boolean }>('DELETE', `/committees/${committeeId}`, undefined);
}

// ── Membership categories (dues tiers) — MONEY PATH ──
// Both create and update REQUIRE an Idempotency-Key (service_org_admin.go returns
// ErrIdempotencyRequired without one): a retried create must not silently mint a
// second tier at the same price, and a retried re-price must not double-apply.
export async function createCategory(orgId: string, input: CategoryInput): Promise<{ id: string }> {
  if (USE_MOCK) {
    await delay();
    const d = mockOrg(orgId);
    const id = mockId('ct');
    d.categories.push({ id, label: input.label, description: input.description ?? null, duesKobo: input.duesKobo, duesCadence: input.cadence });
    d.categoryCount = d.categories.length;
    return { id };
  }
  return sendJson<{ id: string }>('POST', `/organisations/${orgId}/categories`, input, { idempotent: true });
}
export async function updateCategory(categoryId: string, input: CategoryInput): Promise<{ ok: boolean }> {
  if (USE_MOCK) {
    await delay();
    for (const d of Object.values(MOCK_ORG_DETAILS)) {
      const c = d.categories.find((x) => x.id === categoryId);
      if (c) { c.label = input.label; c.description = input.description ?? null; c.duesKobo = input.duesKobo; c.duesCadence = input.cadence; return { ok: true }; }
    }
    throw new Error('Category not found');
  }
  return sendJson<{ ok: boolean }>('PATCH', `/categories/${categoryId}`, input, { idempotent: true });
}
export async function deleteCategory(categoryId: string): Promise<{ ok: boolean }> {
  if (USE_MOCK) {
    await delay();
    for (const d of Object.values(MOCK_ORG_DETAILS)) {
      const i = d.categories.findIndex((x) => x.id === categoryId);
      if (i >= 0) { d.categories.splice(i, 1); d.categoryCount = d.categories.length; return { ok: true }; }
    }
    throw new Error('Category not found');
  }
  // Refused by the backend while members are still on this dues tier.
  return sendJson<{ ok: boolean }>('DELETE', `/categories/${categoryId}`, undefined);
}

// ── Rules ──
export async function createRule(orgId: string, input: RuleInput): Promise<{ id: string }> {
  if (USE_MOCK) {
    await delay();
    const d = mockOrg(orgId);
    const id = mockId('r');
    d.rules.push({ id, body: input.body, position: input.position });
    d.rules.sort((a, b) => a.position - b.position);
    return { id };
  }
  return sendJson<{ id: string }>('POST', `/organisations/${orgId}/rules`, input);
}
export async function updateRule(ruleId: string, input: RuleInput): Promise<{ ok: boolean }> {
  if (USE_MOCK) {
    await delay();
    for (const d of Object.values(MOCK_ORG_DETAILS)) {
      const r = d.rules.find((x) => x.id === ruleId);
      if (r) { r.body = input.body; r.position = input.position; d.rules.sort((a, b) => a.position - b.position); return { ok: true }; }
    }
    throw new Error('Rule not found');
  }
  return sendJson<{ ok: boolean }>('PATCH', `/rules/${ruleId}`, input);
}
export async function deleteRule(ruleId: string): Promise<{ ok: boolean }> {
  if (USE_MOCK) {
    await delay();
    for (const d of Object.values(MOCK_ORG_DETAILS)) {
      const i = d.rules.findIndex((x) => x.id === ruleId);
      if (i >= 0) { d.rules.splice(i, 1); return { ok: true }; }
    }
    throw new Error('Rule not found');
  }
  return sendJson<{ ok: boolean }>('DELETE', `/rules/${ruleId}`, undefined);
}

// ── Naira ⇄ kobo at the form boundary ────────────────────────────────────────
// Kobo is the ONLY representation that reaches the API. These two exist so a
// page never does `parseFloat(x) * 100` inline — that is where the rounding
// bugs live (0.1 * 100 === 10.000000000000002).

/** Parse an operator-typed naira string into integer kobo. Throws on garbage. */
export function nairaToKobo(text: string): number {
  const cleaned = text.replace(/[,\s₦]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) throw new Error('Enter an amount in naira, e.g. 5000 or 5000.50');
  const [whole, frac = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}
/** Render integer kobo as a plain naira string for an <input> (no ₦, no commas). */
export function koboToNairaInput(kobo: number): string {
  const k = Math.trunc(kobo ?? 0);
  return `${Math.trunc(k / 100)}.${String(Math.abs(k % 100)).padStart(2, '0')}`;
}
