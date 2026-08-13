// ── Admin — Paymax Health · MDCN doctor verification review (Mode B / ASSISTED) ─
// Mirrors healthVetVerificationService.ts exactly for request building / auth /
// errors:
//  • adminBase() rewrites env.apiBaseUrl (…/api/v1) → …/api/health/doctor/admin
//  • authHeaders() attaches the admin Bearer token from localStorage
//  • getJson/sendJson unwrap { data } and throw on non-2xx
// These verification endpoints live under …/api/health/doctor/admin/verification
// and require RBAC permission `health.doctor.review` (carried by the admin
// session token). Mock by default (NEXT_PUBLIC_HEALTH_USE_MOCK); flip to false to
// hit the live Go backend. Every document-url read is access-logged server-side
// (HL-8 / NDPA). The doctor never sees the MDCN portal.

import { env } from '@/config/env';
import type {
  MdcnReviewRecord,
  MdcnQueueItem,
  MdcnDecisionInput,
} from '@/types/healthDoctorVerification';

const USE_MOCK = (process.env.NEXT_PUBLIC_HEALTH_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function adminBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/health/doctor/admin');
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

// ── Mock fixtures (parallel to the vet admin verification service) ──────────────
const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
const dateStr = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

const RECORDS: MdcnReviewRecord[] = [
  {
    verificationId: 'dver_8001', userId: 'usr_aa01', doctorName: 'Dr A. Bello',
    status: 'pending', source: 'MDCN', method: 'ASSISTED', discipline: 'medical',
    mdcnNumber: 'MDCN/2015/041201',
    matchedFields: { name: 'match', kyc: 'match' },
    licenceExpiry: null, notes: '', submittedAt: iso(5), decidedAt: null,
    documents: [
      { id: 'doc_mdcn_001', verificationId: 'dver_8001', userId: 'usr_aa01', docType: 'mdcn_certificate', label: 'MDCN certificate', fileName: 'mdcn_cert.pdf', fileUrl: null, mimeType: 'application/pdf', sizeBytes: 184320, required: true, uploadedAt: iso(6), createdAt: iso(6) },
      { id: 'doc_id_001', verificationId: 'dver_8001', userId: 'usr_aa01', docType: 'gov_id', label: 'Government ID', fileName: 'nin.jpg', fileUrl: null, mimeType: 'image/jpeg', sizeBytes: 92160, required: true, uploadedAt: iso(6), createdAt: iso(6) },
    ],
  },
  {
    verificationId: 'dver_8002', userId: 'usr_ee03', doctorName: 'Dr E. Adeyemi',
    status: 'pending', source: 'MDCN', method: 'ASSISTED', discipline: 'dental',
    mdcnNumber: 'MDCN/2018/066021',
    matchedFields: { name: 'mismatch', kyc: 'unverifiable' },
    licenceExpiry: null, notes: '', submittedAt: iso(28), decidedAt: null,
    documents: [
      { id: 'doc_mdcn_002', verificationId: 'dver_8002', userId: 'usr_ee03', docType: 'mdcn_certificate', label: 'MDCN certificate', fileName: 'mdcn_cert_2.pdf', fileUrl: null, mimeType: 'application/pdf', sizeBytes: 201728, required: true, uploadedAt: iso(30), createdAt: iso(30) },
    ],
  },
  {
    verificationId: 'dver_8003', userId: 'usr_cc02', doctorName: 'Dr C. Okonkwo',
    status: 'needs_info', source: 'MDCN', method: 'ASSISTED', discipline: 'medical',
    mdcnNumber: 'MDCN/2012/028101',
    matchedFields: { name: 'match', kyc: 'unverifiable' },
    licenceExpiry: null, notes: 'Name matches but KYC unverifiable — please upload a clearer government ID.',
    submittedAt: iso(68), decidedAt: iso(50),
    documents: [
      { id: 'doc_mdcn_003', verificationId: 'dver_8003', userId: 'usr_cc02', docType: 'mdcn_certificate', label: 'MDCN certificate', fileName: 'mdcn_cert_3.pdf', fileUrl: null, mimeType: 'application/pdf', sizeBytes: 176128, required: true, uploadedAt: iso(70), createdAt: iso(70) },
    ],
  },
  {
    verificationId: 'dver_8004', userId: 'usr_tt04', doctorName: 'Dr T. Wodu',
    status: 'approved', source: 'MDCN', method: 'ASSISTED', discipline: 'medical',
    mdcnNumber: 'MDCN/2009/009101',
    matchedFields: { name: 'match', kyc: 'match' },
    licenceExpiry: dateStr(-365), notes: 'Documents verified; out-of-band MDCN confirmation done.',
    submittedAt: iso(410), decidedAt: iso(400),
    documents: [
      { id: 'doc_mdcn_004', verificationId: 'dver_8004', userId: 'usr_tt04', docType: 'mdcn_certificate', label: 'MDCN certificate', fileName: 'mdcn_cert_4.pdf', fileUrl: null, mimeType: 'application/pdf', sizeBytes: 165888, required: true, uploadedAt: iso(412), createdAt: iso(412) },
    ],
  },
];

const QUEUE: MdcnQueueItem[] = [
  { verificationId: 'dver_8001', userId: 'usr_aa01', doctorName: 'Dr A. Bello', mdcnNumber: 'MDCN/2015/041201', discipline: 'medical', status: 'pending', submittedAt: iso(5), matchedFields: { name: 'match', kyc: 'match' }, identityFlag: false },
  { verificationId: 'dver_8002', userId: 'usr_ee03', doctorName: 'Dr E. Adeyemi', mdcnNumber: 'MDCN/2018/066021', discipline: 'dental', status: 'pending', submittedAt: iso(28), matchedFields: { name: 'mismatch', kyc: 'unverifiable' }, identityFlag: true },
  { verificationId: 'dver_8003', userId: 'usr_cc02', doctorName: 'Dr C. Okonkwo', mdcnNumber: 'MDCN/2012/028101', discipline: 'medical', status: 'needs_info', submittedAt: iso(68), matchedFields: { name: 'match', kyc: 'unverifiable' }, identityFlag: false },
  { verificationId: 'dver_8004', userId: 'usr_tt04', doctorName: 'Dr T. Wodu', mdcnNumber: 'MDCN/2009/009101', discipline: 'medical', status: 'approved', submittedAt: iso(410), matchedFields: { name: 'match', kyc: 'match' }, identityFlag: false },
];

export async function listDoctorVerificationQueue(): Promise<MdcnQueueItem[]> {
  if (USE_MOCK) { await delay(); return QUEUE.map((q) => ({ ...q, matchedFields: { ...q.matchedFields } })); }
  return getJson<MdcnQueueItem[]>('/verification/queue');
}

export async function getDoctorVerification(id: string): Promise<MdcnReviewRecord> {
  if (USE_MOCK) { await delay(); const r = RECORDS.find((x) => x.verificationId === id) ?? RECORDS[0]; return { ...r, documents: r.documents.map((d) => ({ ...d })) }; }
  return getJson<MdcnReviewRecord>(`/verification/${id}`);
}

export async function getDoctorVerificationDocUrl(docId: string): Promise<{ url: string }> {
  if (USE_MOCK) { await delay(); return { url: `https://example.invalid/health/doctor/verification/doc/${docId}?mock=1` }; }
  // Server access-logs this read (HL-8 / NDPA).
  return getJson<{ url: string }>(`/verification/documents/${docId}/url`);
}

export async function decideDoctorVerification(id: string, input: MdcnDecisionInput): Promise<MdcnReviewRecord> {
  if (USE_MOCK) {
    await delay();
    const base = RECORDS.find((r) => r.verificationId === id) ?? RECORDS[0];
    const status: MdcnReviewRecord['status'] =
      input.action === 'approve' ? 'approved'
      : input.action === 'reject' ? 'rejected'
      : 'needs_info';
    return {
      ...base,
      status,
      discipline: input.action === 'approve' ? (input.discipline ?? base.discipline) : base.discipline,
      licenceExpiry: input.action === 'approve' ? (input.licence_expiry ?? base.licenceExpiry) : base.licenceExpiry,
      notes: input.notes ?? base.notes,
      decidedAt: new Date().toISOString(),
      documents: base.documents.map((d) => ({ ...d })),
    };
  }
  return sendJson<MdcnReviewRecord>('POST', `/verification/${id}/decision`, input);
}
