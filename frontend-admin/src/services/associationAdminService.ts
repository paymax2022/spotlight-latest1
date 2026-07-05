// ── Admin — Associations ops console ─────────────────────────────────────────
// Mock by default. Flip with NEXT_PUBLIC_ASSOCIATION_ADMIN_USE_MOCK=false to hit
// the live Go backend at /api/finance/associations/admin/*. The associations
// module ships a real admin surface (KPIs, application approvals, finance summary
// + offline-payment review, member actions, CSV import).
// Money is BIGINT kobo (minor units). Balances are ledger projections (NL-8);
// every approval / offline decision / member action is recorded to audit (NL-12).

import { env } from '@/config/env';

const USE_MOCK = (process.env.NEXT_PUBLIC_ASSOCIATION_ADMIN_USE_MOCK ?? 'true').toLowerCase() !== 'false';

// /api/finance/associations/admin — approvals, finance, offline decisions,
// member actions, import, audit-log all live under this admin sub-group
// (routes.go: rg.GET("/admin/kpis") etc., where rg is already the
// /api/finance/associations group).
function adminBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/finance/associations/admin');
}
// /api/finance/associations — the module root. The member DIRECTORY reads
// (GET /members, GET /members/:id) are registered directly on the module
// group, not under /admin (routes.go lines 30-31), so they need the
// non-admin base. Member ACTIONS (suspend/restore/transfer/role) ARE under
// /admin/members/:id/* (routes.go lines 79-88) — those use adminBase().
function moduleBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/finance/associations');
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

async function getJson<T>(path: string, base: 'admin' | 'module' = 'admin'): Promise<T> {
  const root = base === 'admin' ? adminBase() : moduleBase();
  const res = await fetch(`${root}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}
async function sendJson<T>(
  method: 'POST' | 'PATCH' | 'PUT',
  path: string,
  body: unknown,
  opts?: { idempotent?: boolean; base?: 'admin' | 'module' },
): Promise<T> {
  const root = (opts?.base ?? 'admin') === 'admin' ? adminBase() : moduleBase();
  const headers = authHeaders();
  // Money-mutating endpoints (offline payment decision) require an
  // Idempotency-Key per house doctrine (CLAUDE.md — every money mutation).
  if (opts?.idempotent) headers['Idempotency-Key'] = newIdempotencyKey();
  const res = await fetch(`${root}${path}`, { method, headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}
async function sendForm<T>(path: string, form: FormData, base: 'admin' | 'module' = 'admin'): Promise<T> {
  const root = base === 'admin' ? adminBase() : moduleBase();
  const res = await fetch(`${root}${path}`, { method: 'POST', headers: authHeadersNoContentType(), body: form });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
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
export interface AssociationKpis {
  associations_total: number;
  members_total: number;
  members_active: number;
  members_suspended: number;
  dues_outstanding_kobo: number;
  dues_collected_30d_kobo: number;
  approvals_pending: number;
  offline_payments_pending: number;
  activity: { id: string; kind: string; label: string; ref?: string | null; created_at: string }[];
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export interface ApprovalRecord {
  id: string;
  association_name: string;
  applicant_masked: string;
  membership_tier: string;
  submitted_at: string;
  status: ApprovalStatus;
}
export type ApprovalDecision = 'approve' | 'reject';
export interface ApprovalDecisionResult { id: string; status: ApprovalStatus; audit_id: string; message: string; }

export interface AssociationFinance {
  dues_outstanding_kobo: number;
  dues_collected_30d_kobo: number;
  offline_pending_kobo: number;
  online_collected_30d_kobo: number;
}
export type OfflineStatus = 'pending' | 'approved' | 'rejected';
export interface OfflinePayment {
  id: string;
  association_name: string;
  member_masked: string;
  amount_kobo: number;
  method: string;
  reference: string;
  status: OfflineStatus;
  submitted_at: string;
}
export type OfflineDecision = 'approve' | 'reject';
export interface OfflineDecisionResult { id: string; status: OfflineStatus; audit_id: string; message: string; }

// ── KPIs / dashboard ─────────────────────────────────────────────────────────
const KPIS: AssociationKpis = {
  associations_total: 86,
  members_total: 12_440,
  members_active: 11_680,
  members_suspended: 92,
  dues_outstanding_kobo: 18_900_000_00,
  dues_collected_30d_kobo: 64_200_000_00,
  approvals_pending: 23,
  offline_payments_pending: 11,
  activity: [
    { id: 'ev1', kind: 'approved', label: 'Membership application approved', ref: 'app_551', created_at: iso(0.5) },
    { id: 'ev2', kind: 'pending', label: 'Offline bank-transfer payment submitted for review', ref: 'off_204', created_at: iso(1.5) },
    { id: 'ev3', kind: 'suspended', label: 'Member suspended for dues default', ref: 'mem_9981', created_at: iso(4) },
  ],
};
export async function getAssociationKpis(): Promise<AssociationKpis> {
  if (USE_MOCK) { await delay(); return { ...KPIS, activity: [...KPIS.activity] }; }
  return getJson<AssociationKpis>('/kpis');
}

// ── Approvals ────────────────────────────────────────────────────────────────
const APPROVALS: ApprovalRecord[] = [
  { id: 'app_551', association_name: 'Lagos Traders Union', applicant_masked: 'Chioma A•••', membership_tier: 'Standard', submitted_at: iso(6), status: 'pending' },
  { id: 'app_549', association_name: 'Tech Founders Guild', applicant_masked: 'Tunde B•••', membership_tier: 'Premium', submitted_at: iso(20), status: 'pending' },
  { id: 'app_540', association_name: 'Market Women Co-op', applicant_masked: 'Aisha M•••', membership_tier: 'Standard', submitted_at: iso(72), status: 'approved' },
];
export async function listApprovals(opts?: { status?: string }): Promise<ApprovalRecord[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...APPROVALS];
    if (opts?.status) rows = rows.filter((a) => a.status === opts.status);
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  return getJson<ApprovalRecord[]>(`/approvals${qs.toString() ? `?${qs}` : ''}`);
}
export async function decideApplication(id: string, decision: ApprovalDecision, note?: string): Promise<ApprovalDecisionResult> {
  if (USE_MOCK) {
    await delay();
    return { id, status: decision === 'approve' ? 'approved' : 'rejected', audit_id: `aud_${Math.random().toString(36).slice(2, 10)}`, message: `Application ${id}: ${decision} recorded to immutable audit (NL-12).` };
  }
  return sendJson<ApprovalDecisionResult>('POST', `/approvals/${id}/decision`, { decision, note });
}

// ── Finance + offline payments ───────────────────────────────────────────────
const FINANCE: AssociationFinance = {
  dues_outstanding_kobo: 18_900_000_00,
  dues_collected_30d_kobo: 64_200_000_00,
  offline_pending_kobo: 2_400_000_00,
  online_collected_30d_kobo: 61_800_000_00,
};
export async function getAssociationFinance(): Promise<AssociationFinance> {
  if (USE_MOCK) { await delay(); return { ...FINANCE }; }
  return getJson<AssociationFinance>('/finance');
}

const OFFLINE: OfflinePayment[] = [
  { id: 'off_204', association_name: 'Lagos Traders Union', member_masked: 'Bola T•••', amount_kobo: 50_000_00, method: 'bank_transfer', reference: 'TRF-99201', status: 'pending', submitted_at: iso(3) },
  { id: 'off_199', association_name: 'Tech Founders Guild', member_masked: 'Seun K•••', amount_kobo: 120_000_00, method: 'cash_deposit', reference: 'DEP-44120', status: 'pending', submitted_at: iso(10) },
  { id: 'off_188', association_name: 'Market Women Co-op', member_masked: 'Funke A•••', amount_kobo: 20_000_00, method: 'bank_transfer', reference: 'TRF-88110', status: 'approved', submitted_at: iso(48) },
];
export async function listOfflinePayments(opts?: { status?: string }): Promise<OfflinePayment[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...OFFLINE];
    if (opts?.status) rows = rows.filter((o) => o.status === opts.status);
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  return getJson<OfflinePayment[]>(`/finance/offline${qs.toString() ? `?${qs}` : ''}`);
}
export async function decideOfflinePayment(id: string, decision: OfflineDecision, note?: string): Promise<OfflineDecisionResult> {
  if (USE_MOCK) {
    await delay();
    return { id, status: decision === 'approve' ? 'approved' : 'rejected', audit_id: `aud_${Math.random().toString(36).slice(2, 10)}`, message: `Offline payment ${id}: ${decision}. ${decision === 'approve' ? 'Balanced ledger entry posted (NL-8).' : 'No funds moved.'} Recorded to audit (NL-12).` };
  }
  // Backend contract (handler_actions.go DecideOfflinePayment): POST body is
  // { approve: boolean }, keyed on Idempotency-Key (money path — NL-6/NL-8).
  return sendJson<OfflineDecisionResult>('POST', `/finance/offline/${id}/decision`, { approve: decision === 'approve' }, { idempotent: true });
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
  const qs = new URLSearchParams();
  if (filters?.search) qs.set('search', filters.search);
  if (filters?.chapterId) qs.set('chapterId', filters.chapterId);
  if (filters?.category) qs.set('category', filters.category);
  if (filters?.status) qs.set('status', filters.status);
  // GET /members is on the module root, not /admin (routes.go line 30).
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
  const qs = new URLSearchParams();
  if (action) qs.set('action', action);
  return getJson<AuditLogEntry[]>(`/audit-log${qs.toString() ? `?${qs}` : ''}`);
}
