// ── Admin — Telemedicine ops console (read-only oversight) ───────────────────
// Mock by default. Flip with NEXT_PUBLIC_TELEMEDICINE_ADMIN_USE_MOCK=false to hit
// the live Go backend. NOTE: the telemedicine module has NO dedicated /admin route
// group on the backend — only member/clinician read endpoints exist under
// /api/v1/telemedicine/*. This console therefore offers read-only oversight of
// clinicians (doctors) and consultations (appointments) against those endpoints;
// every write/oversight action is mocked until an admin surface is added.
// Money is BIGINT kobo (minor units) throughout.

import { env } from '@/config/env';

const USE_MOCK = (process.env.NEXT_PUBLIC_TELEMEDICINE_ADMIN_USE_MOCK ?? 'true').toLowerCase() !== 'false';

// Telemedicine reads live at /api/v1/telemedicine/* (mobile-facing), not an admin group.
function readBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/v1/telemedicine');
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
  const res = await fetch(`${readBase()}${path}`, { headers: authHeaders() });
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

export type ClinicianStatus = 'verified' | 'pending' | 'suspended';
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

// ── Dashboard ────────────────────────────────────────────────────────────────
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
  return getJson<TelemedDashboard>('/admin/dashboard');
}

// ── Clinicians ───────────────────────────────────────────────────────────────
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
  if (opts?.q) qs.set('q', opts.q);
  return getJson<ClinicianRecord[]>(`/doctors${qs.toString() ? `?${qs}` : ''}`);
}

// ── Consultations ────────────────────────────────────────────────────────────
const CONSULTS: ConsultationRecord[] = [
  { id: 'cns_7710', patient_masked: 'Ngozi U•••', clinician_name: 'Dr. Bola A.', specialty: 'Paediatrics', status: 'completed', fee_kobo: 7_500_00, scheduled_at: iso(1), prescription_issued: true, created_at: iso(3) },
  { id: 'cns_7705', patient_masked: 'Emeka O•••', clinician_name: 'Dr. Chuka E.', specialty: 'Dermatology', status: 'confirmed', fee_kobo: 8_000_00, scheduled_at: iso(-4), prescription_issued: false, created_at: iso(6) },
  { id: 'cns_7689', patient_masked: 'Tunde B•••', clinician_name: 'Dr. Bola A.', specialty: 'Paediatrics', status: 'cancelled', fee_kobo: 7_500_00, scheduled_at: iso(8), prescription_issued: false, created_at: iso(20) },
  { id: 'cns_7701', patient_masked: 'Aisha M•••', clinician_name: 'Dr. Chuka E.', specialty: 'Dermatology', status: 'booked', fee_kobo: 8_000_00, scheduled_at: iso(-26), prescription_issued: false, created_at: iso(2) },
];
export async function listConsultations(opts?: { status?: string; q?: string }): Promise<ConsultationRecord[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...CONSULTS];
    if (opts?.status) rows = rows.filter((c) => c.status === opts.status);
    if (opts?.q) { const q = opts.q.toLowerCase(); rows = rows.filter((c) => c.clinician_name.toLowerCase().includes(q) || c.patient_masked.toLowerCase().includes(q) || c.id.includes(q)); }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  return getJson<ConsultationRecord[]>(`/appointments${qs.toString() ? `?${qs}` : ''}`);
}
