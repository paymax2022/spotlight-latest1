// the live Go backend. TELEMEDICINE-004: the backend now has a real admin route
// group — GET /api/v1/telemedicine/admin/{dashboard,doctors,appointments} and
// POST /api/v1/telemedicine/admin/doctors/:userId/verify (RBAC-gated on
// telemedicine.admin.view / telemedicine.admin.manage — see
// backend/internal/app/finance_routes.go and
// backend/internal/telemedicine/admin_{model,service,handler}.go). This
// replaces the earlier fallback of reading the member-scoped /doctors and
// /appointments endpoints, which could not offer real platform-wide oversight
// (availability-filtered roster, no verification status, caller-scoped
// appointment list, zero write capability).
// Money is BIGINT kobo (minor units) throughout.

import { apiV1 } from '@/config/env';
import { resolveUseMock } from '@/config/useMock';
import { operationKey } from './idempotency';

export const USE_MOCK = resolveUseMock(process.env.NEXT_PUBLIC_TELEMEDICINE_ADMIN_USE_MOCK);
/** Named so the fixture banner can cite the exact switch. */
export const USE_MOCK_ENV = 'NEXT_PUBLIC_TELEMEDICINE_ADMIN_USE_MOCK';

// backend/internal/app/finance_routes.go — member routes directly on that
// group, admin routes under its /admin sub-group (teleAdmin). apiV1() gives
// onto it, and the admin-specific helper appends '/admin' further.
// which stopped matching once apiBaseUrl became the same-origin proxy path
// (<origin>/api/admin-proxy, no /api/v1 suffix) — see insuranceAdminService.ts
// for the same regression. The replace became a no-op and every live request
// 404'd against <proxy>/doctors instead of <proxy>/api/v1/telemedicine/doctors.
function readBase(): string {
  return `${apiV1()}/telemedicine`;
}
function adminBase(): string {
  return `${readBase()}/admin`;
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  return { 'Content-Type': 'application/json' };
}
const delay = (ms = 240) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* ignore parse failure */ }
    throw new Error(msg);
  }
  const j = await res.json();
  return (j?.data ?? j) as T;
}

export function formatNaira(kobo: number): string {
  const naira = (kobo ?? 0) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
const dateStr = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

// TelemedDashboard keeps its existing field names (the pages already render
// them) but every field is now mapped from the REAL backend response
// (GET /admin/dashboard -> AdminDashboard in
// backend/internal/telemedicine/admin_model.go) rather than a client-side
// fixture. Fields the real endpoint does not compute are explicitly zeroed /
// emptied below with a comment at the mapping site — never fabricated.
export interface TelemedDashboard {
  clinicians_total: number;
  clinicians_verified: number;
  clinicians_pending: number;
  consultations_today: number;
  consultations_open: number;
  consultations_completed_30d: number;
  consultation_revenue_30d_kobo: number;
  avg_rating: number;
  cancellations_30d: number;
  prescriptions_issued_30d: number;
  specialties: { name: string; clinicians: number; consultations_30d: number }[];
  activity: { id: string; kind: string; label: string; ref?: string | null; created_at: string }[];
}

/** Raw shape of GET /api/v1/telemedicine/admin/dashboard's `data`. */
interface RawAdminDashboard {
  total_doctors: number;
  doctors_pending_approval: number;
  doctors_approved: number;
  appointments_this_week: number;
  platform_revenue_kobo_week: number;
  consultations_today?: number;
  consultations_open?: number;
  consultations_completed_30d?: number;
  cancellations_30d?: number;
  platform_revenue_kobo_30d?: number;
  avg_rating?: number;
  prescriptions_issued_30d?: number;
  specialties?: { name: string; clinicians: number; consultations_30d: number }[];
  activity?: { id: string; kind: string; label: string; ref?: string | null; created_at: string }[];
}

export type ClinicianStatus = 'verified' | 'pending' | 'suspended' | 'rejected' | 'unverified';
export interface ClinicianRecord {
  id: string;
  name: string;
  specialty: string;
  status: ClinicianStatus;
  mdcn_number: string;
  rating: number;
  reviews_count: number;
  consult_fee_kobo: number;
  consultations_total: number;
  joined_at: string;
  /** user_id — required by the verify action; absent on mock rows. */
  user_id?: string;
}

/** Raw shape of one row in GET /api/v1/telemedicine/admin/doctors's `data`. */
interface RawAdminDoctor {
  id: string;
  user_id: string;
  name: string;
  specialty: string;
  consult_fee_kobo: number;
  is_available: boolean;
  is_online: boolean;
  created_at: string;
  verification_status?: string | null;
  verification_id?: string | null;
  mdcn_number?: string | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  rejection_reason?: string | null;
  rating?: number;
  reviews_count?: number;
  consultations_total?: number;
}

export type ConsultStatus = 'booked' | 'confirmed' | 'completed' | 'cancelled';
export interface ConsultationRecord {
  id: string;
  patient_masked: string;
  clinician_name: string;
  specialty: string;
  status: ConsultStatus;
  fee_kobo: number;
  scheduled_at: string;
  prescription_issued: boolean;
  created_at: string;
}

/** Raw shape of one row in GET /api/v1/telemedicine/admin/appointments's `data`. */
interface RawAdminAppointment {
  id: string;
  patient_id: string;
  doctor_id: string;
  doctor_name?: string;
  scheduled_at: string;
  status: string;
  fee_kobo: number;
  platform_fee_kobo: number;
  total_kobo: number;
  created_at: string;
  specialty?: string;
  prescription_issued?: boolean;
  consultation_type?: string;
}

/** Masks a raw patient UUID for display — the backend never returns a name. */
function maskPatientId(patientId: string): string {
  return patientId ? `${patientId.slice(0, 8)}…` : 'Unknown';
}

const DASHBOARD: TelemedDashboard = {
  clinicians_total: 184,
  clinicians_verified: 152,
  clinicians_pending: 27,
  consultations_today: 96,
  consultations_open: 41,
  consultations_completed_30d: 2_310,
  consultation_revenue_30d_kobo: 34_650_000_00,
  avg_rating: 4.6,
  cancellations_30d: 118,
  prescriptions_issued_30d: 1_440,
  specialties: [
    { name: 'General practice', clinicians: 62, consultations_30d: 980 },
    { name: 'Paediatrics', clinicians: 28, consultations_30d: 410 },
    { name: 'Dermatology', clinicians: 21, consultations_30d: 360 },
    { name: 'Mental health', clinicians: 19, consultations_30d: 300 },
    { name: 'Gynaecology', clinicians: 17, consultations_30d: 260 },
  ],
  activity: [
    { id: 'ev1', kind: 'consultation_completed', label: 'Consultation completed — GP follow-up, summary issued', ref: 'cns_7710', created_at: iso(0.5) },
    { id: 'ev2', kind: 'clinician_pending', label: 'Clinician submitted MDCN credentials for verification', ref: 'doc_330', created_at: iso(1.2) },
    { id: 'ev3', kind: 'prescription_issued', label: 'e-Prescription issued and routed to pharmacy fulfilment', ref: 'cns_7702', created_at: iso(2.1) },
    { id: 'ev4', kind: 'cancelled', label: 'Consultation cancelled by patient — fee auto-refunded', ref: 'cns_7689', created_at: iso(4) },
  ],
};
export async function getTelemedDashboard(): Promise<TelemedDashboard> {
  if (USE_MOCK) { await delay(); return { ...DASHBOARD, specialties: [...DASHBOARD.specialties], activity: [...DASHBOARD.activity] }; }
  const raw = await getJson<RawAdminDashboard>('/dashboard');
  return {
    clinicians_total: raw.total_doctors,
    clinicians_verified: raw.doctors_approved,
    clinicians_pending: raw.doctors_pending_approval,
    consultations_today: raw.consultations_today ?? 0,
    consultations_open: raw.consultations_open ?? 0,
    consultations_completed_30d: raw.consultations_completed_30d ?? 0,
    // Prefer the trailing-30d revenue; older backends only return the 7d figure.
    consultation_revenue_30d_kobo: raw.platform_revenue_kobo_30d ?? raw.platform_revenue_kobo_week,
    avg_rating: raw.avg_rating ?? 0,
    cancellations_30d: raw.cancellations_30d ?? 0,
    prescriptions_issued_30d: raw.prescriptions_issued_30d ?? 0,
    specialties: raw.specialties ?? [],
    activity: raw.activity ?? [],
  };
}

const CLINICIANS: ClinicianRecord[] = [
  { id: 'doc_330', name: 'Dr. Adaeze N.', specialty: 'General practice', status: 'pending', mdcn_number: 'MDCN/2019/44821', rating: 0, reviews_count: 0, consult_fee_kobo: 5_000_00, consultations_total: 0, joined_at: dateStr(2) },
  { id: 'doc_311', name: 'Dr. Bola A.', specialty: 'Paediatrics', status: 'verified', mdcn_number: 'MDCN/2014/22018', rating: 4.8, reviews_count: 212, consult_fee_kobo: 7_500_00, consultations_total: 940, joined_at: dateStr(420) },
  { id: 'doc_298', name: 'Dr. Chuka E.', specialty: 'Dermatology', status: 'verified', mdcn_number: 'MDCN/2016/30551', rating: 4.5, reviews_count: 156, consult_fee_kobo: 8_000_00, consultations_total: 610, joined_at: dateStr(300) },
  { id: 'doc_270', name: 'Dr. Halima S.', specialty: 'Mental health', status: 'suspended', mdcn_number: 'MDCN/2011/15003', rating: 3.9, reviews_count: 88, consult_fee_kobo: 10_000_00, consultations_total: 320, joined_at: dateStr(600) },
];
export async function listClinicians(opts?: { status?: string; q?: string }): Promise<ClinicianRecord[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...CLINICIANS];
    if (opts?.status) rows = rows.filter((c) => c.status === opts.status);
    if (opts?.q) { const q = opts.q.toLowerCase(); rows = rows.filter((c) => c.name.toLowerCase().includes(q) || c.specialty.toLowerCase().includes(q) || c.id.includes(q)); }
    return rows;
  }
  const qs = new URLSearchParams();
  qs.set('limit', '200');
  const raw = await getJson<RawAdminDoctor[]>(`/doctors?${qs.toString()}`);
  let rows: ClinicianRecord[] = raw.map((d) => ({
    id: d.id,
    user_id: d.user_id,
    name: d.name,
    specialty: d.specialty,
    status: mapVerificationStatus(d.verification_status),
    mdcn_number: d.mdcn_number ?? '',
    // Not returned by GET /admin/doctors (no rating aggregate in this batch) —
    // 0 rather than fabricated.
    rating: d.rating ?? 0,
    reviews_count: d.reviews_count ?? 0,
    consult_fee_kobo: d.consult_fee_kobo,
    // Not returned by GET /admin/doctors — 0 rather than fabricated.
    consultations_total: d.consultations_total ?? 0,
    joined_at: d.created_at,
  }));
  if (opts?.status) rows = rows.filter((c) => c.status === opts.status);
  if (opts?.q) {
    const q = opts.q.toLowerCase();
    rows = rows.filter((c) => c.name.toLowerCase().includes(q) || c.specialty.toLowerCase().includes(q) || c.id.includes(q));
  }
  return rows;
}

/** Maps the real doctor_verifications.status vocabulary onto the console's
 * existing ClinicianStatus badge set. A doctor with NO verification row at
 * all (status is null/undefined) is 'unverified' — distinct from 'pending',
 * which means a submission exists and is awaiting review. */
function mapVerificationStatus(raw?: string | null): ClinicianStatus {
  switch (raw) {
    case 'approved': return 'verified';
    case 'rejected': return 'rejected';
    case 'pending':
    case 'needs_info': return 'pending';
    case 'unsubmitted':
    default: return 'unverified';
  }
}

/** Approve/reject a doctor's MDCN verification via the real admin console
 * write path (POST /admin/doctors/:userId/verify, RBAC telemedicine.admin.manage). */
export async function verifyDoctor(userId: string, decision: 'approved' | 'rejected', reason?: string): Promise<ClinicianRecord> {
  if (USE_MOCK) {
    await delay();
    const idx = CLINICIANS.findIndex((c) => c.id === userId);
    if (idx >= 0) CLINICIANS[idx] = { ...CLINICIANS[idx], status: decision === 'approved' ? 'verified' : 'rejected' };
    return CLINICIANS[idx] ?? { ...CLINICIANS[0], status: decision === 'approved' ? 'verified' : 'rejected' };
  }
  const raw = await postJson<RawAdminDoctor & { verification_status: string }>(`/doctors/${encodeURIComponent(userId)}/verify`, {
    decision,
    reason: reason ?? '',
  });
  return {
    id: raw.id ?? userId,
    user_id: raw.user_id ?? userId,
    name: raw.name ?? '',
    specialty: raw.specialty ?? '',
    status: mapVerificationStatus(raw.verification_status),
    mdcn_number: raw.mdcn_number ?? '',
    rating: 0,
    reviews_count: 0,
    consult_fee_kobo: raw.consult_fee_kobo ?? 0,
    consultations_total: 0,
    joined_at: raw.created_at ?? '',
  };
}

const CONSULTS: ConsultationRecord[] = [
  { id: 'cns_7710', patient_masked: 'Ngozi U•••', clinician_name: 'Dr. Bola A.', specialty: 'Paediatrics', status: 'completed', fee_kobo: 7_500_00, scheduled_at: iso(1), prescription_issued: true, created_at: iso(3) },
  { id: 'cns_7705', patient_masked: 'Emeka O•••', clinician_name: 'Dr. Chuka E.', specialty: 'Dermatology', status: 'confirmed', fee_kobo: 8_000_00, scheduled_at: iso(-4), prescription_issued: false, created_at: iso(6) },
  { id: 'cns_7689', patient_masked: 'Tunde B•••', clinician_name: 'Dr. Bola A.', specialty: 'Paediatrics', status: 'cancelled', fee_kobo: 7_500_00, scheduled_at: iso(8), prescription_issued: false, created_at: iso(20) },
  { id: 'cns_7701', patient_masked: 'Aisha M•••', clinician_name: 'Dr. Chuka E.', specialty: 'Dermatology', status: 'booked', fee_kobo: 8_000_00, scheduled_at: iso(-26), prescription_issued: false, created_at: iso(2) },
];
export interface ConsultationQuery {
  status?: string;
  /** id/ref prefix or doctor-name substring, matched server-side. */
  search?: string;
  /** Inclusive start date (YYYY-MM-DD, UTC). */
  from?: string;
  /** Exclusive end date (YYYY-MM-DD, UTC). */
  to?: string;
  limit?: number;
  offset?: number;
}

function mapConsult(a: RawAdminAppointment): ConsultationRecord {
  return {
    id: a.id,
    // The backend returns patient_id (a UUID), never a name; mask the id
    // rather than fabricate a display name.
    patient_masked: maskPatientId(a.patient_id),
    clinician_name: a.doctor_name || 'Unknown',
    specialty: a.specialty ?? '',
    status: (a.status as ConsultStatus) ?? 'booked',
    fee_kobo: a.fee_kobo,
    scheduled_at: a.scheduled_at,
    prescription_issued: a.prescription_issued ?? false,
    created_at: a.created_at,
  };
}

const dayStart = (d: string) => `${d}T00:00:00Z`;

/** One server-side page of the system-wide appointment list. */
export async function listConsultations(opts: ConsultationQuery = {}): Promise<{ items: ConsultationRecord[]; total: number }> {
  const limit = opts.limit ?? 25;
  const offset = opts.offset ?? 0;
  if (USE_MOCK) {
    await delay();
    let rows = [...CONSULTS];
    if (opts.status) rows = rows.filter((c) => c.status === opts.status);
    if (opts.search) { const q = opts.search.toLowerCase(); rows = rows.filter((c) => c.clinician_name.toLowerCase().includes(q) || c.id.includes(q)); }
    return { items: rows.slice(offset, offset + limit), total: rows.length };
  }
  const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (opts.status) qs.set('status', opts.status);
  if (opts.search?.trim()) qs.set('search', opts.search.trim());
  if (opts.from) qs.set('from', dayStart(opts.from));
  if (opts.to) qs.set('to', dayStart(opts.to));
  const res = await fetch(`${adminBase()}/appointments?${qs.toString()}`, { headers: authHeaders() });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const j = await res.json(); if (j?.error) msg = String(j.error); } catch { /* keep default */ }
    throw new Error(msg);
  }
  const j = (await res.json()) as { data?: RawAdminAppointment[]; total?: number };
  const raw = j.data ?? [];
  return { items: raw.map(mapConsult), total: j.total ?? raw.length };
}

export interface ConsultationAudit { action: string; actor_id: string; at: string; detail: Record<string, unknown> }
export interface ConsultationDetail extends ConsultationRecord {
  ref: string;
  notes: string;
  doctor_id: string;
  doctor_user_id: string;
  platform_fee_kobo: number;
  total_kobo: number;
  consultation_type: string;
  settlement_status: string;
  audit: ConsultationAudit[];
}

export async function getConsultation(id: string): Promise<ConsultationDetail> {
  if (USE_MOCK) throw new Error('Consultation detail needs the live backend (mock mode is on).');
  const raw = await getJson<RawAdminAppointment & {
    ref: string; notes: string; doctor_user_id: string; settlement_status: string; audit: ConsultationAudit[];
  }>(`/appointments/${encodeURIComponent(id)}`);
  return {
    ...mapConsult(raw),
    ref: raw.ref,
    notes: raw.notes,
    doctor_id: raw.doctor_id,
    doctor_user_id: raw.doctor_user_id,
    platform_fee_kobo: raw.platform_fee_kobo,
    total_kobo: raw.total_kobo,
    consultation_type: raw.consultation_type ?? '',
    settlement_status: raw.settlement_status,
    audit: raw.audit ?? [],
  };
}

async function postAction<T>(path: string, key: string, body: unknown): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    if (res.status === 403) msg = 'You do not have permission to act on consultations (telemedicine.admin.manage).';
    else { try { const j = await res.json(); if (j?.error) msg = String(j.error); } catch { /* keep default */ } }
    throw new Error(msg);
  }
  const j = await res.json();
  return (j?.data ?? j) as T;
}

export interface ConsultationActionResult { action: string; appointment_id: string; status: string; refunded: boolean; doctor_id?: string; replayed: boolean }

/** Cancels and refunds the escrow. Keyed on the appointment so a double-click dedupes server-side. */
export function cancelConsultation(id: string, reason: string): Promise<ConsultationActionResult> {
  if (USE_MOCK) return Promise.reject(new Error('Cancelling needs the live backend (mock mode is on).'));
  return postAction(`/appointments/${encodeURIComponent(id)}/cancel`, operationKey('telemed:appointment-cancel', id), { reason });
}

export function reassignConsultation(id: string, doctorId: string, reason: string): Promise<ConsultationActionResult> {
  if (USE_MOCK) return Promise.reject(new Error('Reassigning needs the live backend (mock mode is on).'));
  return postAction(`/appointments/${encodeURIComponent(id)}/reassign`,
    operationKey('telemed:appointment-reassign', id, doctorId, Date.now()), { doctor_id: doctorId, reason });
}
