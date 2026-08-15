// ── Admin — Paymax Health · Vet VCN verification review (Mode B / ASSISTED) ─────
// Mirrors healthVetAdminService.ts exactly for request building / auth / errors:
//  • adminBase() rewrites env.apiBaseUrl (…/api/v1) → …/api/health/vet/admin
//  • authHeaders() attaches the admin Bearer token from localStorage
//  • getJson/sendJson unwrap { data } and throw on non-2xx
// These verification endpoints live under …/api/health/vet/admin/verification and
// require RBAC permission `health.vet.review` (carried by the admin session token).
// Mock by default (NEXT_PUBLIC_HEALTH_USE_MOCK); flip to false to hit the live Go
// backend. Every document-url read is access-logged server-side (HL-8 / NDPA).

import { env } from '@/config/env';
import type {
  VcnVerificationRecord,
  VcnQueueItem,
  VcnDecisionInput,
} from '@/types/healthVetVerification';

const USE_MOCK = (process.env.NEXT_PUBLIC_HEALTH_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function adminBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/health/vet/admin');
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}
const delay = (ms = 240) => new Promise((r) => setTimeout(r, ms));

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

// ── Mock fixtures (parallel to the existing vet admin service) ──────────────────
const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
const dateStr = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

const RECORDS: VcnVerificationRecord[] = [
  {
    id: 'vver_7001', provider_application_id: 'papp_5501', capability: 'health.vet.provider', source: 'VCN', method: 'ASSISTED',
    status: 'PENDING', reg_number: 'VCN/2015/04120',
    matched_fields: { name: 'match', dob: 'match', kyc: 'match' },
    licence_expiry: null, reviewer_id: null, notes: '',
    evidence_doc_ids: ['doc_vcn_001', 'doc_dvm_001'], consent_at: iso(6), created_at: iso(5), decided_at: null,
  },
  {
    id: 'vver_7002', provider_application_id: 'papp_5502', capability: 'health.vet.provider', source: 'VCN', method: 'ASSISTED',
    status: 'PENDING', reg_number: 'VCN/2018/06602',
    matched_fields: { name: 'mismatch', dob: 'match', kyc: 'unverifiable' },
    licence_expiry: null, reviewer_id: null, notes: '',
    evidence_doc_ids: ['doc_vcn_002'], consent_at: iso(30), created_at: iso(28), decided_at: null,
  },
  {
    id: 'vver_7003', provider_application_id: 'papp_5503', capability: 'health.vet.provider', source: 'VCN', method: 'ASSISTED',
    status: 'NEEDS_INFO', reg_number: 'VCN/2012/02810',
    matched_fields: { name: 'match', dob: 'unverifiable', kyc: 'match' },
    licence_expiry: null, reviewer_id: 'ops_admin_1', notes: 'DOB unverifiable against KYC — please upload a government ID.',
    evidence_doc_ids: ['doc_vcn_003', 'doc_cac_003'], consent_at: iso(70), created_at: iso(68), decided_at: iso(50),
  },
  {
    id: 'vver_7004', provider_application_id: 'papp_5504', capability: 'health.vet.provider', source: 'VCN', method: 'ASSISTED',
    status: 'VERIFIED', reg_number: 'VCN/2009/00910',
    matched_fields: { name: 'match', dob: 'match', kyc: 'match' },
    licence_expiry: dateStr(-365), reviewer_id: 'ops_admin_1', notes: 'Documents verified; out-of-band VCN confirmation done.',
    evidence_doc_ids: ['doc_vcn_004'], consent_at: iso(420), created_at: iso(410), decided_at: iso(400),
  },
];

const QUEUE: VcnQueueItem[] = [
  { record: RECORDS[0], owner_user_id: 'usr_aa01', display_name: 'Dr A. Bello', application_state: 'SUBMITTED', identity_flag: false },
  { record: RECORDS[1], owner_user_id: 'usr_ee03', display_name: 'Dr E. Adeyemi', application_state: 'SUBMITTED', identity_flag: true },
  { record: RECORDS[2], owner_user_id: 'usr_cc02', display_name: 'Dr C. Okonkwo', application_state: 'NEEDS_INFO', identity_flag: false },
  { record: RECORDS[3], owner_user_id: 'usr_tt04', display_name: 'Dr T. Wodu', application_state: 'APPROVED', identity_flag: false },
];

export async function listVerificationQueue(): Promise<VcnQueueItem[]> {
  if (USE_MOCK) { await delay(); return QUEUE.map((q) => ({ ...q, record: { ...q.record } })); }
  return getJson<VcnQueueItem[]>('/verification/queue');
}

export async function getVerificationRecord(id: string): Promise<VcnVerificationRecord> {
  if (USE_MOCK) { await delay(); return { ...(RECORDS.find((r) => r.id === id) ?? RECORDS[0]) }; }
  return getJson<VcnVerificationRecord>(`/verification/${id}`);
}

export async function getVerificationDocUrl(docId: string): Promise<{ url: string }> {
  if (USE_MOCK) { await delay(); return { url: `https://example.invalid/health/vet/verification/doc/${docId}?mock=1` }; }
  // Server access-logs this read (HL-8 / NDPA).
  return getJson<{ url: string }>(`/verification/documents/${docId}/url`);
}

export async function decideVerification(id: string, input: VcnDecisionInput): Promise<VcnVerificationRecord> {
  if (USE_MOCK) {
    await delay();
    const base = RECORDS.find((r) => r.id === id) ?? RECORDS[0];
    const status =
      input.action === 'approve' ? 'VERIFIED'
      : input.action === 'reject' ? 'REJECTED'
      : 'NEEDS_INFO';
    return {
      ...base,
      status,
      licence_expiry: input.action === 'approve' ? (input.licence_expiry ?? base.licence_expiry) : base.licence_expiry,
      notes: input.notes ?? base.notes,
      reviewer_id: 'ops_admin_1',
      decided_at: new Date().toISOString(),
    };
  }
  return sendJson<VcnVerificationRecord>('POST', `/verification/${id}/decision`, input);
}
