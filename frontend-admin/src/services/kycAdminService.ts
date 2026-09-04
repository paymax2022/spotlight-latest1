import { env } from '@/config/env';
import { operationKey } from './idempotency';
import type {
  KycReviewItem,
  KycCaseDetail,
  KycRoutingRule,
  KycEvent,
  VerificationSession,
  VerificationCheck,
  EvidenceRef,
  CheckType,
} from '@/types/kycAdmin';

// KYC verification admin console — service layer.
// Backend: Go, mounted at /api/finance/admin/kyc (RBAC: finance.admin.kyc).
// Auth: Bearer localStorage 'spotlight_admin_access_token' (matches fintechService).
//
// Backend / flag may not be running — default to deterministic fixtures unless
// explicitly disabled, so every screen renders. Mirrors transfersAdminService.
const USE_FIXTURES =
  (process.env.NEXT_PUBLIC_KYC_ADMIN_USE_MOCK ?? 'true') !== 'false';

// Go backend finance admin routes live at /api/finance/admin/...
// env.apiBaseUrl looks like http://localhost:8080/api/v1 → /api/finance/admin.
export function kycAdminBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/finance/admin');
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  if (!token) return { 'Content-Type': 'application/json' };
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// Idempotency-Key per the house iron rule (see services/idempotency.ts). A KYC
// decision moves the user's tier and therefore their money limits, so it must
// fail-closed without a key. Keyed on the decision identity (action + case id) so
// a double-submit dedupes at the backend rather than re-deciding a case.
function idempotencyKeyFor(action: string, id: string): string {
  return operationKey('kyc', action, id);
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const now = Date.now();
const iso = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();

const FIXTURE_SESSIONS: Record<string, VerificationSession> = {
  ver_01HKA1: { id: 'ver_01HKA1', user_id: 'usr_8f2a', target_tier: 2, status: 'NEEDS_REVIEW', created_at: iso(35), updated_at: iso(30) },
  ver_01HKA2: { id: 'ver_01HKA2', user_id: 'usr_3c7d', target_tier: 3, status: 'NEEDS_REVIEW', created_at: iso(120), updated_at: iso(90) },
  ver_01HKA3: { id: 'ver_01HKA3', user_id: 'usr_5e1f', target_tier: 2, status: 'NEEDS_REVIEW', created_at: iso(12), updated_at: iso(10) },
};

const FIXTURE_CHECKS: Record<string, VerificationCheck[]> = {
  ver_01HKA1: [
    { id: 'chk_a1', session_id: 'ver_01HKA1', type: 'ID_NUMBER', provider: 'smile_id', status: 'PASSED', match: true, confidence: 99, extracted_fields: { full_name: 'Adaeze O.', dob: '****-**-14' }, reason: null, created_at: iso(34) },
    { id: 'chk_a2', session_id: 'ver_01HKA1', type: 'ID_FACIAL', provider: 'smile_id', status: 'REVIEW', match: null, confidence: 71, extracted_fields: null, reason: 'Facial match confidence 71% below 85% threshold', created_at: iso(33) },
    { id: 'chk_a3', session_id: 'ver_01HKA1', type: 'LIVENESS', provider: 'smile_id', status: 'PASSED', match: true, confidence: 96, extracted_fields: null, reason: null, created_at: iso(33) },
  ],
  ver_01HKA2: [
    { id: 'chk_b1', session_id: 'ver_01HKA2', type: 'ID_NUMBER', provider: 'dojah', status: 'PASSED', match: true, confidence: 98, extracted_fields: { full_name: 'Emeka B.', bvn_last4: '**87' }, reason: null, created_at: iso(119) },
    { id: 'chk_b2', session_id: 'ver_01HKA2', type: 'DOCUMENT', provider: 'dojah', status: 'REVIEW', match: null, confidence: 62, extracted_fields: { doc_type: 'passport' }, reason: 'Document image quality flagged — possible glare/edge crop', created_at: iso(118) },
    { id: 'chk_b3', session_id: 'ver_01HKA2', type: 'AML', provider: 'complyadvantage', status: 'REVIEW', match: true, confidence: 88, extracted_fields: { list: 'PEP', match_name: 'E. Balogun' }, reason: 'Possible PEP match — requires compliance disposition', created_at: iso(117) },
  ],
  ver_01HKA3: [
    { id: 'chk_c1', session_id: 'ver_01HKA3', type: 'ID_NUMBER', provider: 'smile_id', status: 'PASSED', match: true, confidence: 99, extracted_fields: { full_name: 'Bright L.' }, reason: null, created_at: iso(11) },
    { id: 'chk_c2', session_id: 'ver_01HKA3', type: 'ID_FACIAL', provider: 'smile_id', status: 'FAILED', match: false, confidence: 41, extracted_fields: null, reason: 'Facial match failed (41%) — possible identity mismatch', created_at: iso(11) },
  ],
};

const FIXTURE_EVIDENCE: Record<string, EvidenceRef[]> = {
  ver_01HKA1: [
    { id: 'evd_a_self', check_id: 'chk_a2', kind: 'selfie', label: 'Enrolment selfie', access_logged: true },
    { id: 'evd_a_id', check_id: 'chk_a1', kind: 'id_document', label: 'NIN slip', access_logged: true },
  ],
  ver_01HKA2: [
    { id: 'evd_b_doc', check_id: 'chk_b2', kind: 'id_document', label: 'Passport data page', access_logged: true },
  ],
  ver_01HKA3: [
    { id: 'evd_c_self', check_id: 'chk_c2', kind: 'selfie', label: 'Enrolment selfie', access_logged: true },
    { id: 'evd_c_live', check_id: 'chk_c2', kind: 'liveness_video', label: 'Liveness capture', access_logged: true },
  ],
};

const FIXTURE_ROUTING: KycRoutingRule[] = [
  { check_type: 'ID_NUMBER', ordered_providers: ['smile_id', 'dojah'], threshold: 90, enabled: true },
  { check_type: 'ID_FACIAL', ordered_providers: ['smile_id', 'dojah'], threshold: 85, enabled: true },
  { check_type: 'LIVENESS', ordered_providers: ['smile_id'], threshold: 80, enabled: true },
  { check_type: 'DOCUMENT', ordered_providers: ['dojah', 'smile_id'], threshold: 75, enabled: true },
  { check_type: 'AML', ordered_providers: ['complyadvantage', 'dojah'], threshold: 80, enabled: true },
];

const FIXTURE_EVENTS: KycEvent[] = [
  { id: 'evt_1', provider: 'smile_id', event_type: 'job.complete', status: 'delivered', attempts: 1, session_id: 'ver_01HKA1', received_at: iso(30), signature_valid: true },
  { id: 'evt_2', provider: 'dojah', event_type: 'verification.result', status: 'retried', attempts: 3, session_id: 'ver_01HKA2', received_at: iso(88), signature_valid: true },
  { id: 'evt_3', provider: 'complyadvantage', event_type: 'screening.hit', status: 'delivered', attempts: 1, session_id: 'ver_01HKA2', received_at: iso(117), signature_valid: true },
  { id: 'evt_4', provider: 'smile_id', event_type: 'job.complete', status: 'deduped', attempts: 2, session_id: 'ver_01HKA3', received_at: iso(9), signature_valid: true },
  { id: 'evt_5', provider: 'dojah', event_type: 'verification.result', status: 'signature_failed', attempts: 1, session_id: null, received_at: iso(5), signature_valid: false },
];

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), 120));
}

// All three writes below have real, verified live endpoints, so fixture mode
// has nothing to add and refuses loudly instead of reporting a decision it
// did not perform. See docs/audit/ADMIN_SIMULATED_WRITES.md.
const NOT_IN_FIXTURE_MODE =
  'is unavailable in fixture mode: this console will not report a write it did not perform. ' +
  'Set NEXT_PUBLIC_KYC_ADMIN_USE_MOCK=false to make this change against the live backend.';

// Derive a queue row from a session + its checks (worst failing check first).
function toReviewItem(session: VerificationSession): KycReviewItem {
  const checks = FIXTURE_CHECKS[session.id] ?? [];
  const failing =
    checks.find((c) => c.status === 'FAILED') ??
    checks.find((c) => c.status === 'REVIEW') ??
    null;
  return {
    session,
    failing_check_type: failing?.type ?? null,
    provider: failing?.provider ?? null,
    confidence: failing?.confidence ?? null,
    submitted_at: session.created_at ?? null,
    // Lower confidence + older submission → triage sooner.
    priority: failing?.confidence != null ? 100 - failing.confidence : 50,
  };
}

// ─── API ─────────────────────────────────────────────────────────────────────

// AK1 — Review queue: sessions/checks currently in NEEDS_REVIEW, prioritized.
export async function listReviewQueue(): Promise<KycReviewItem[]> {
  if (USE_FIXTURES) {
    const rows = Object.values(FIXTURE_SESSIONS).map(toReviewItem);
    rows.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    return delay(rows);
  }
  const res = await fetch(`${kycAdminBase()}/kyc/review-queue`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`KYC review queue failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : data.data ?? data.items ?? [];
}

// AK2 — Case detail: session + checks + evidence refs (pointers only, no PII).
export async function getCase(id: string): Promise<KycCaseDetail> {
  if (USE_FIXTURES) {
    const session = FIXTURE_SESSIONS[id];
    if (!session) throw new Error(`KYC case ${id} not found`);
    return delay({
      session,
      checks: FIXTURE_CHECKS[id] ?? [],
      evidence_refs: FIXTURE_EVIDENCE[id] ?? [],
    });
  }
  const res = await fetch(`${kycAdminBase()}/kyc/cases/${encodeURIComponent(id)}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`KYC case fetch failed: ${res.status}`);
  return res.json();
}

// One funnel for the two case decisions (both require a reason for the audit log).
async function postDecision(id: string, action: 'approve' | 'reject', reason: string): Promise<void> {
  if (USE_FIXTURES) throw new Error(`Deciding a KYC case ${NOT_IN_FIXTURE_MODE}`);
  const res = await fetch(
    `${kycAdminBase()}/kyc/cases/${encodeURIComponent(id)}/${action}`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Idempotency-Key': idempotencyKeyFor(action, id) },
      body: JSON.stringify({ reason }),
    },
  );
  if (!res.ok) throw new Error(`KYC ${action} failed: ${res.status}`);
}

export async function approveCase(id: string, reason: string): Promise<void> {
  return postDecision(id, 'approve', reason);
}

export async function rejectCase(id: string, reason: string): Promise<void> {
  return postDecision(id, 'reject', reason);
}

// Request re-submit — modelled as a reject-with-resubmit intent. Backend contract
// currently exposes approve/reject; we tag the reason so the state machine can
// route to a re-submit prompt rather than a hard decline.
export async function requestResubmit(id: string, reason: string): Promise<void> {
  if (USE_FIXTURES) throw new Error(`Requesting a KYC re-submit ${NOT_IN_FIXTURE_MODE}`);
  const res = await fetch(
    `${kycAdminBase()}/kyc/cases/${encodeURIComponent(id)}/reject`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Idempotency-Key': idempotencyKeyFor('resubmit', id) },
      body: JSON.stringify({ reason: `[RE-SUBMIT] ${reason}` }),
    },
  );
  if (!res.ok) throw new Error(`KYC re-submit request failed: ${res.status}`);
}

// AK2 — Access-logged evidence fetch. We deliberately do NOT return raw PII to
// render inline; hitting the case endpoint records the access in the audit trail
// (AK13). Returns the (re-fetched) evidence refs so the UI can confirm access.
export async function fetchEvidenceAccess(id: string, evidenceId: string): Promise<EvidenceRef | null> {
  if (USE_FIXTURES) {
    const refs = FIXTURE_EVIDENCE[id] ?? [];
    return delay(refs.find((r) => r.id === evidenceId) ?? null);
  }
  // Access is recorded server-side when the case detail is fetched with the
  // evidence id in scope. We re-fetch the case (logged) and return the ref.
  const detail = await getCase(id);
  return detail.evidence_refs.find((r) => r.id === evidenceId) ?? null;
}

// AK6 — Provider routing rules.
export async function listRoutingRules(): Promise<KycRoutingRule[]> {
  if (USE_FIXTURES) return delay(FIXTURE_ROUTING.map((r) => ({ ...r, ordered_providers: [...r.ordered_providers] })));
  const res = await fetch(`${kycAdminBase()}/kyc/routing-rules`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`KYC routing rules failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : data.data ?? data.rules ?? [];
}

export async function updateRoutingRule(
  checkType: CheckType,
  rule: { ordered_providers: string[]; threshold: number; enabled: boolean },
): Promise<KycRoutingRule> {
  if (USE_FIXTURES) throw new Error(`Updating a KYC routing rule ${NOT_IN_FIXTURE_MODE}`);
  const res = await fetch(`${kycAdminBase()}/kyc/routing-rules/${encodeURIComponent(checkType)}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(rule),
  });
  if (!res.ok) throw new Error(`KYC routing rule update failed: ${res.status}`);
  return res.json();
}

// AK11 — Webhook / event monitor.
export async function listEvents(): Promise<KycEvent[]> {
  if (USE_FIXTURES) return delay([...FIXTURE_EVENTS]);
  const res = await fetch(`${kycAdminBase()}/kyc/events`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`KYC events fetch failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : data.data ?? data.events ?? [];
}
