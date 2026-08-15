// ── Admin — Paymax Health · Veterinary (HEALTH-BUILD Phase 3 ADM) ──────────────
// Mock by default (mirrors healthPharmacyAdminService P1 / healthLabAdminService P2).
// Flip with NEXT_PUBLIC_HEALTH_USE_MOCK=false to hit the live Go backend at
// /api/health/vet/admin/*. RBAC: health.vet.* gates wired on the sidebar.
// Money is BIGINT kobo (minor units) throughout — formatNaira() converts kobo → ₦.
// Surfaces HEALTH invariants the Vet vertical enforces:
//  HL-1 marketplace, not provider · HL-2 credential-gated supply (VCN licences; VCN surfaced;
//  auto-suspend on expiry) · HL-3 e-Rx discipline (issued by licensed vet; dispense-once; POM gating)
//  · HL-8 health data sensitive NDPA (masked; consent gates) · HL-9 money held→released→refunded
//  (escrow released on consult completion) · HL-10 payout KYC+AML gate · HL-11 emergency safety
//  (tele ≠ emergency; SOS → in-person) · HL-12 immutable audit on every state transition.

import { env } from '@/config/env';
import type {
  VetDashboard,
  VcnApplication,
  VcnDecision,
  VcnDecisionResult,
  VetService,
  VetServiceGovernanceAction,
  VetServiceGovernanceResult,
  VetAppointment,
  VetAppointmentDetail,
  EprescriptionAuditItem,
  VetPayoutRecord,
  VetPayoutDecision,
  VetPayoutDecisionResult,
  ModerationItem,
  ModerationAction,
  ModerationResult,
  VetReportingData,
} from '@/types/healthVetAdmin';

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

// ── Display helper: kobo → ₦ ─────────────────────────────────────────────────
export function formatNaira(kobo: number): string {
  const naira = (kobo ?? 0) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const auditId = () => `aud_${Math.random().toString(36).slice(2, 10)}`;
const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
const dateStr = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

// ════════════════════════════════════════════════════════════════════════════
// A · Dashboard
// ════════════════════════════════════════════════════════════════════════════
const DASHBOARD: VetDashboard = {
  generated_at: iso(0.1),
  appointments_today: 414,
  appointments_30d: 11_280,
  consults_completed_30d: 10_460,
  appointment_completion_rate: 0.927,
  no_show_rate: 0.041,
  gmv_today_kobo: 5_360_000_00,
  gmv_30d_kobo: 142_700_000_00,
  net_revenue_30d_kobo: 14_270_000_0,
  take_rate: 0.1,
  avg_appointment_value_kobo: 12_650_00,
  held_balance_kobo: 12_900_000_00, // HL-9 escrow held until consult completion
  released_30d_kobo: 127_440_000_00,
  refunded_30d_kobo: 2_010_000_00,
  vcn_pending_review: 6, // HL-2
  vets_active: 78,
  vets_suspended: 3,
  vcn_expiring_30d: 5, // licences nearing expiry → auto-suspend risk (HL-2)
  eprescriptions_30d: 6_840, // HL-3
  eprescriptions_pom_30d: 2_910,
  eprescription_flags_open: 3,
  services_pending_governance: 11,
  moderation_open: 4,
  payouts_kyc_hold: 2, // HL-10
  sos_routed_30d: 37, // HL-11 emergency requests routed to in-person care
  appointment_mix: [
    { label: 'Tele-consult', appointments: 6_540, gmv_kobo: 64_220_000_00, share_pct: 0.58 },
    { label: 'Home visit', appointments: 2_820, gmv_kobo: 49_940_000_00, share_pct: 0.25 },
    { label: 'Clinic visit', appointments: 1_920, gmv_kobo: 28_540_000_00, share_pct: 0.17 },
  ],
  appointments_trend: Array.from({ length: 14 }).map((_, i) => {
    const base = 360 + Math.round(Math.sin(i / 2) * 60) + i * 4;
    return { date: dateStr(13 - i), appointments: Math.max(120, base) };
  }),
  activity: [
    { id: 'va1', kind: 'vcn_approved', label: 'Vet approved & capability granted — "Dr A. Bello, PetCare Vet Clinic Lekki" (VCN licence verified, HL-2)', ref: 'vcn_5501', created_at: iso(0.4) },
    { id: 'va2', kind: 'eprescription_issued', label: 'e-Prescription issued by VCN-licensed vet — Amoxicillin 250mg ×14 (POM); dispense-once enforced server-side (HL-3)', ref: 'erx_8810', created_at: iso(0.8) },
    { id: 'va3', kind: 'appointment_completed', label: 'Tele-consult completed — SOAP note persisted; escrow released to vet (HL-9)', ref: 'apt_7720', created_at: iso(1.5) },
    { id: 'va4', kind: 'sos_routed', label: 'Emergency (SOS) request routed to nearest in-person clinic — tele-consult is not a substitute for emergency care (HL-11)', ref: 'apt_7790', created_at: iso(2.6) },
    { id: 'va5', kind: 'content_moderated', label: 'Vet profile credential claim flagged for moderation — VCN number mismatch under review', ref: 'mod_3310', created_at: iso(4.1) },
    { id: 'va6', kind: 'payout_held', label: 'Vet payout held — KYC tier insufficient (HL-10)', ref: 'vpay_9910', created_at: iso(8.2) },
  ],
};
export async function getVetDashboard(): Promise<VetDashboard> {
  if (USE_MOCK) { await delay(); return { ...DASHBOARD, appointment_mix: [...DASHBOARD.appointment_mix], appointments_trend: [...DASHBOARD.appointments_trend], activity: [...DASHBOARD.activity] }; }
  return getJson<VetDashboard>('/dashboard');
}

// ════════════════════════════════════════════════════════════════════════════
// B · VCN credential audit queue (HL-2)
// ════════════════════════════════════════════════════════════════════════════
const VCN_APPS: VcnApplication[] = [
  { id: 'vcn_5501', vet_name_masked: 'Dr A. Bello•••', clinic_name: 'PetCare Vet Clinic Lekki', vcn_licence_no: 'VCN/2015/04120', vcn_register_year: 2015, cac_rc_no: 'RC-2210984', specialties: ['small-animal', 'surgery'], state: 'Lagos', lga: 'Eti-Osa', status: 'submitted', vcn_verified: true, licence_expires_at: dateStr(-300), docs: [{ kind: 'VCN_licence', reference: 'VCN/2015/04120', expires_at: dateStr(-300), verified: true }, { kind: 'vet_degree', reference: 'DVM-UI-2013', verified: true }, { kind: 'CAC', reference: 'RC-2210984', verified: true }], submitted_at: iso(5), created_at: iso(50) },
  { id: 'vcn_5502', vet_name_masked: 'Dr C. Okonkwo•••', clinic_name: 'Garki Animal Hospital', vcn_licence_no: 'VCN/2012/02810', vcn_register_year: 2012, cac_rc_no: 'RC-1880221', specialties: ['large-animal', 'small-animal'], state: 'FCT', lga: 'Abuja Municipal', status: 'under_review', vcn_verified: true, licence_expires_at: dateStr(-120), docs: [{ kind: 'VCN_licence', reference: 'VCN/2012/02810', expires_at: dateStr(-120), verified: true }, { kind: 'clinic_premises_photo', reference: 'photo-set-3', verified: true }, { kind: 'indemnity_cover', reference: 'IND-2026-441', verified: true }], submitted_at: iso(28), created_at: iso(110) },
  { id: 'vcn_5503', vet_name_masked: 'Dr E. Adeyemi•••', clinic_name: 'Aba Vet Surgery', vcn_licence_no: 'VCN/2018/06602', vcn_register_year: 2018, cac_rc_no: 'RC-0998771', specialties: ['avian', 'exotics'], state: 'Abia', lga: 'Aba South', status: 'needs_info', vcn_verified: false, licence_expires_at: dateStr(45), docs: [{ kind: 'VCN_licence', reference: 'VCN/2018/06602', expires_at: dateStr(45), verified: false }, { kind: 'vet_degree', reference: 'DVM-ABU-2016', verified: false }], submitted_at: iso(70), created_at: iso(240) },
  { id: 'vcn_5504', vet_name_masked: 'Dr T. Wodu•••', clinic_name: 'Bridge Vet Clinic PH', vcn_licence_no: 'VCN/2009/00910', vcn_register_year: 2009, cac_rc_no: 'RC-0118660', specialties: ['small-animal', 'dermatology'], state: 'Rivers', lga: 'Port Harcourt', status: 'approved', vcn_verified: true, licence_expires_at: dateStr(-20), docs: [{ kind: 'VCN_licence', reference: 'VCN/2009/00910', expires_at: dateStr(-20), verified: true }, { kind: 'vet_degree', reference: 'DVM-UNN-2007', verified: true }], submitted_at: iso(420), created_at: iso(700) },
  { id: 'vcn_5505', vet_name_masked: 'Dr (unverified)•••', clinic_name: 'QuickVet Express', vcn_licence_no: 'VCN/PENDING', vcn_register_year: 2024, cac_rc_no: 'RC-PENDING', specialties: ['small-animal'], state: 'Lagos', lga: 'Surulere', status: 'rejected', vcn_verified: false, licence_expires_at: null, docs: [{ kind: 'VCN_licence', reference: 'VCN/PENDING', verified: false }], submitted_at: iso(130), created_at: iso(320) },
  { id: 'vcn_5506', vet_name_masked: 'Dr O. Ani•••', clinic_name: 'Wellness Vet Enugu', vcn_licence_no: 'VCN/2007/00220', vcn_register_year: 2007, cac_rc_no: 'RC-0070554', specialties: ['large-animal'], state: 'Enugu', lga: 'Enugu North', status: 'suspended', vcn_verified: true, licence_expires_at: dateStr(8), docs: [{ kind: 'VCN_licence', reference: 'VCN/2007/00220', expires_at: dateStr(8), verified: true }], submitted_at: iso(950), created_at: iso(1300) },
];
export async function listVcnApplications(opts?: { status?: string; q?: string }): Promise<VcnApplication[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...VCN_APPS];
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.clinic_name.toLowerCase().includes(q) || r.vcn_licence_no.toLowerCase().includes(q) || r.state.toLowerCase().includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<VcnApplication[]>(`/vcn/applications${qs.toString() ? `?${qs}` : ''}`);
}
export async function decideVcn(id: string, decision: VcnDecision, note?: string): Promise<VcnDecisionResult> {
  if (USE_MOCK) {
    await delay();
    const app = VCN_APPS.find((a) => a.id === id);
    if (decision === 'approve' && app && !app.vcn_verified) {
      return { id, status: 'needs_info', capability_granted: false, audit_id: auditId(), message: `Approval blocked — VCN practising licence not verified (HL-2). Supply stays credential-gated and fail-closed. Recorded to immutable audit (HL-12).` };
    }
    const status =
      decision === 'approve' ? 'approved'
      : decision === 'reject' ? 'rejected'
      : decision === 'need_info' ? 'needs_info'
      : decision === 'suspend' ? 'suspended'
      : 'approved'; // reinstate
    return { id, status, capability_granted: decision === 'approve', audit_id: auditId(), message: `VCN application ${id}: ${decision} applied. ${decision === 'approve' ? 'Provider vet capability idempotently granted and discoverability unlocked (HL-2). ' : ''}State machine SUBMITTED→UNDER_REVIEW→${status.toUpperCase()} enforced. Recorded to immutable audit (HL-12).` };
  }
  return sendJson<VcnDecisionResult>('POST', `/vcn/applications/${id}/decision`, { decision, note });
}

// ════════════════════════════════════════════════════════════════════════════
// C · Service / fee governance
// ════════════════════════════════════════════════════════════════════════════
const SERVICES: VetService[] = [
  { id: 'vsvc_4401', service_name: 'Tele-consult (general)', mode: 'tele', category: 'consult', vet_masked: 'Dr A. Bello•••', clinic_masked: 'PetCare Lekki•••', duration_minutes: 20, fee_kobo: 8_000_00, platform_fee_pct: 0.1, status: 'approved', flagged_reason: null, created_at: dateStr(30) },
  { id: 'vsvc_4410', service_name: 'Home vaccination visit', mode: 'home', category: 'vaccination', vet_masked: 'Dr C. Okonkwo•••', clinic_masked: 'Garki Animal Hospital•••', duration_minutes: 45, fee_kobo: 18_000_00, platform_fee_pct: 0.1, status: 'pending', flagged_reason: null, created_at: dateStr(2) },
  { id: 'vsvc_4415', service_name: 'Clinic surgery consult', mode: 'clinic', category: 'surgery', vet_masked: 'Dr T. Wodu•••', clinic_masked: 'Bridge Vet PH•••', duration_minutes: 40, fee_kobo: 25_000_00, platform_fee_pct: 0.1, status: 'pending', flagged_reason: null, created_at: dateStr(1) },
  { id: 'vsvc_4420', service_name: 'Exotic pet wellness package', mode: 'clinic', category: 'consult', vet_masked: 'Dr E. Adeyemi•••', clinic_masked: 'Aba Vet Surgery•••', duration_minutes: 30, fee_kobo: 120_000_00, platform_fee_pct: 0.45, status: 'suspended', flagged_reason: 'Platform fee 45% exceeds the 10% governed take-rate ceiling — pricing policy review required', created_at: dateStr(8) },
  { id: 'vsvc_4430', service_name: 'Home euthanasia (end-of-life)', mode: 'home', category: 'consult', vet_masked: 'Dr O. Ani•••', clinic_masked: 'Wellness Vet Enugu•••', duration_minutes: 60, fee_kobo: 35_000_00, platform_fee_pct: 0.1, status: 'rejected', flagged_reason: 'Vet suspended — listing blocked (HL-2)', created_at: dateStr(10) },
  { id: 'vsvc_4440', service_name: 'Tele dermatology review', mode: 'tele', category: 'dermatology', vet_masked: 'Dr T. Wodu•••', clinic_masked: 'Bridge Vet PH•••', duration_minutes: 15, fee_kobo: 6_500_00, platform_fee_pct: 0.1, status: 'approved', flagged_reason: null, created_at: dateStr(40) },
];
export async function listServices(opts?: { status?: string; mode?: string; q?: string }): Promise<VetService[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...SERVICES];
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.mode) rows = rows.filter((r) => r.mode === opts.mode);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.service_name.toLowerCase().includes(q) || r.vet_masked.toLowerCase().includes(q) || r.category.toLowerCase().includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.mode) qs.set('mode', opts.mode);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<VetService[]>(`/services${qs.toString() ? `?${qs}` : ''}`);
}
export async function governService(id: string, action: VetServiceGovernanceAction, note?: string): Promise<VetServiceGovernanceResult> {
  if (USE_MOCK) {
    await delay();
    const item = SERVICES.find((s) => s.id === id);
    if (action === 'approve' && item && item.platform_fee_pct > 0.1) {
      return { id, status: 'pending', audit_id: auditId(), message: `Approval blocked — platform fee ${(item.platform_fee_pct * 100).toFixed(0)}% exceeds the governed 10% take-rate ceiling; fee policy must be corrected before listing. Recorded to immutable audit (HL-12).` };
    }
    const status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'suspended';
    return { id, status, audit_id: auditId(), message: `Service ${id}: ${action} applied. Service/fee governance enforced. Recorded to immutable audit (HL-12).` };
  }
  return sendJson<VetServiceGovernanceResult>('POST', `/services/${id}/govern`, { action, note });
}

// ════════════════════════════════════════════════════════════════════════════
// D · Appointment oversight
// ════════════════════════════════════════════════════════════════════════════
const APPOINTMENTS: VetAppointment[] = [
  { id: 'apt_7720', pet_name: 'Bingo', pet_species: 'dog', owner_masked: 'pt Chioma•••', vet_masked: 'Dr A. Bello•••', clinic_masked: 'PetCare Lekki•••', mode: 'tele', service_summary: 'Tele-consult (general) · 20m', status: 'completed', payment_state: 'released', fee_kobo: 8_000_00, is_emergency: false, scheduled_at: iso(3), created_at: iso(28), updated_at: iso(2) },
  { id: 'apt_7740', pet_name: 'Milo', pet_species: 'cat', owner_masked: 'pt Aisha•••', vet_masked: 'Dr C. Okonkwo•••', clinic_masked: 'Garki Animal Hospital•••', mode: 'home', service_summary: 'Home vaccination visit · 45m', status: 'confirmed', payment_state: 'held', fee_kobo: 18_000_00, is_emergency: false, scheduled_at: iso(-26), created_at: iso(10), updated_at: iso(6) },
  { id: 'apt_7760', pet_name: 'Coco', pet_species: 'bird', owner_masked: 'pt Tunde•••', vet_masked: 'Dr E. Adeyemi•••', clinic_masked: 'Aba Vet Surgery•••', mode: 'clinic', service_summary: 'Avian wellness consult · 30m', status: 'in_progress', payment_state: 'held', fee_kobo: 12_000_00, is_emergency: false, scheduled_at: iso(0.5), created_at: iso(48), updated_at: iso(0.4) },
  { id: 'apt_7790', pet_name: 'Rex', pet_species: 'dog', owner_masked: 'pt Bola•••', vet_masked: 'Dr T. Wodu•••', clinic_masked: 'Bridge Vet PH•••', mode: 'clinic', service_summary: 'EMERGENCY — suspected poisoning · routed in-person', status: 'confirmed', payment_state: 'held', fee_kobo: 25_000_00, is_emergency: true, scheduled_at: iso(-2), created_at: iso(3), updated_at: iso(2.5) },
  { id: 'apt_7810', pet_name: 'Whiskers', pet_species: 'cat', owner_masked: 'pt Ngozi•••', vet_masked: 'Dr A. Bello•••', clinic_masked: 'PetCare Lekki•••', mode: 'tele', service_summary: 'Tele dermatology review · 15m', status: 'requested', payment_state: 'pending', fee_kobo: 6_500_00, is_emergency: false, scheduled_at: iso(-50), created_at: iso(4), updated_at: iso(4) },
  { id: 'apt_7820', pet_name: 'Bella', pet_species: 'rabbit', owner_masked: 'pt Emeka•••', vet_masked: 'Dr O. Ani•••', clinic_masked: 'Wellness Vet Enugu•••', mode: 'home', service_summary: 'Home wellness check · 30m', status: 'cancelled', payment_state: 'refunded', fee_kobo: 15_000_00, is_emergency: false, scheduled_at: iso(72), created_at: iso(120), updated_at: iso(80) },
  { id: 'apt_7830', pet_name: 'Shadow', pet_species: 'dog', owner_masked: 'pt Fatima•••', vet_masked: 'Dr C. Okonkwo•••', clinic_masked: 'Garki Animal Hospital•••', mode: 'clinic', service_summary: 'Clinic surgery consult · 40m', status: 'no_show', payment_state: 'refunded', fee_kobo: 25_000_00, is_emergency: false, scheduled_at: iso(96), created_at: iso(160), updated_at: iso(94) },
];
export async function listAppointments(opts?: { status?: string; mode?: string; emergency?: string; q?: string }): Promise<VetAppointment[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...APPOINTMENTS];
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.mode) rows = rows.filter((r) => r.mode === opts.mode);
    if (opts?.emergency === 'yes') rows = rows.filter((r) => r.is_emergency);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.pet_name.toLowerCase().includes(q) || r.owner_masked.toLowerCase().includes(q) || r.vet_masked.toLowerCase().includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.mode) qs.set('mode', opts.mode);
  if (opts?.emergency) qs.set('emergency', opts.emergency);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<VetAppointment[]>(`/appointments${qs.toString() ? `?${qs}` : ''}`);
}
export async function getAppointment(id: string): Promise<VetAppointmentDetail> {
  if (USE_MOCK) {
    await delay();
    const base = APPOINTMENTS.find((a) => a.id === id) ?? APPOINTMENTS[0];
    const completed = base.status === 'completed';
    return {
      ...base,
      triage_summary: base.is_emergency ? 'Emergency triage: suspected toxin ingestion 30m ago; owner advised to proceed to nearest in-person clinic (HL-11).' : 'Owner-reported: reduced appetite 2 days; vaccinations up to date; no known allergies.',
      consult_note_present: completed,
      eprescription_ref: completed ? 'erx_8810' : null,
      lab_order_ref: completed ? 'lab_pet_3301' : null,
      consent_on_file: true,
      timeline: [
        { step: 'REQUESTED', label: 'Appointment requested by owner; payment authorised → held in escrow (HL-9)', actor_masked: base.owner_masked, audit_id: 'aud_a001', at: base.created_at },
        { step: 'ACCEPTED', label: 'Accepted by VCN-licensed vet', actor_masked: base.vet_masked, audit_id: 'aud_a002', at: iso(20) },
        { step: 'CONFIRMED', label: `Confirmed — ${base.mode} appointment scheduled`, actor_masked: 'system', audit_id: 'aud_a003', at: iso(18) },
        ...(base.is_emergency ? [{ step: 'SOS_ROUTED', label: 'Emergency flagged — routed to nearest in-person clinic; tele-consult is not a substitute for emergency care (HL-11)', actor_masked: 'system', audit_id: 'aud_a004', at: iso(2.5) }] : []),
        ...(completed
          ? [{ step: 'IN_PROGRESS', label: 'Consult started', actor_masked: base.vet_masked, audit_id: 'aud_a005', at: iso(3.2) },
             { step: 'COMPLETED', label: 'Consult completed — SOAP note persisted; e-Rx emitted (HL-3); escrow released to vet (HL-9)', actor_masked: base.vet_masked, audit_id: 'aud_a006', at: base.updated_at }]
          : []),
      ],
    };
  }
  return getJson<VetAppointmentDetail>(`/appointments/${id}`);
}

// ════════════════════════════════════════════════════════════════════════════
// E · E-prescription audit (HL-3)
// ════════════════════════════════════════════════════════════════════════════
const EPRESCRIPTIONS: EprescriptionAuditItem[] = [
  { id: 'erx_8810', appointment_ref: 'apt_7720', pet_name: 'Bingo', pet_species: 'dog', owner_masked: 'pt Chioma•••', vet_masked: 'Dr A. Bello•••', vcn_licence_no: 'VCN/2015/04120', drug_summary: 'Amoxicillin 250mg ×14 (POM)', is_pom: true, is_controlled: false, status: 'verified', dispense_once_ok: true, flagged: false, flag_reason: null, issued_at: iso(2), dispensed_at: null },
  { id: 'erx_8820', appointment_ref: 'apt_7740', pet_name: 'Milo', pet_species: 'cat', owner_masked: 'pt Aisha•••', vet_masked: 'Dr C. Okonkwo•••', vcn_licence_no: 'VCN/2012/02810', drug_summary: 'Feline tri-vaccine (vaccination record)', is_pom: false, is_controlled: false, status: 'fulfilled', dispense_once_ok: true, flagged: false, flag_reason: null, issued_at: iso(26), dispensed_at: iso(24) },
  { id: 'erx_8830', appointment_ref: 'apt_7760', pet_name: 'Coco', pet_species: 'bird', owner_masked: 'pt Tunde•••', vet_masked: 'Dr E. Adeyemi•••', vcn_licence_no: 'VCN/2018/06602', drug_summary: 'Enrofloxacin oral suspension (POM)', is_pom: true, is_controlled: false, status: 'verifying', dispense_once_ok: true, flagged: true, flag_reason: 'Prescriber VCN licence verification pending at issue — e-Rx held; a POM e-Rx must be issued by a verified VCN-licensed vet (HL-2/HL-3).', issued_at: iso(1), dispensed_at: null },
  { id: 'erx_8840', appointment_ref: 'apt_7790', pet_name: 'Rex', pet_species: 'dog', owner_masked: 'pt Bola•••', vet_masked: 'Dr T. Wodu•••', vcn_licence_no: 'VCN/2009/00910', drug_summary: 'Atropine injection (controlled)', is_pom: true, is_controlled: true, status: 'rejected', dispense_once_ok: true, flagged: true, flag_reason: 'Controlled substance — excluded at MVP (HL-4). e-Rx rejected; statutory register + extra authorisation required if enabled later.', issued_at: iso(2.4), dispensed_at: null },
  { id: 'erx_8850', appointment_ref: 'apt_7700', pet_name: 'Luna', pet_species: 'dog', owner_masked: 'pt Halima•••', vet_masked: 'Dr A. Bello•••', vcn_licence_no: 'VCN/2015/04120', drug_summary: 'Meloxicam 1.5mg/ml (POM)', is_pom: true, is_controlled: false, status: 'dispensed', dispense_once_ok: true, flagged: false, flag_reason: null, issued_at: iso(50), dispensed_at: iso(46) },
  { id: 'erx_8860', appointment_ref: 'apt_7680', pet_name: 'Max', pet_species: 'dog', owner_masked: 'pt Samuel•••', vet_masked: 'Dr A. Bello•••', vcn_licence_no: 'VCN/2015/04120', drug_summary: 'Meloxicam 1.5mg/ml (POM) — re-dispense attempt', is_pom: true, is_controlled: false, status: 'dispensed', dispense_once_ok: false, flagged: true, flag_reason: 'Duplicate dispense attempt blocked — a prescription cannot be filled twice; DISPENSED is terminal-once (HL-3).', issued_at: iso(60), dispensed_at: iso(58) },
];
export async function listEprescriptionAudit(opts?: { status?: string; pom?: string; flagged?: string; q?: string }): Promise<EprescriptionAuditItem[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...EPRESCRIPTIONS];
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.pom === 'yes') rows = rows.filter((r) => r.is_pom);
    if (opts?.flagged === 'yes') rows = rows.filter((r) => r.flagged);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.pet_name.toLowerCase().includes(q) || r.vet_masked.toLowerCase().includes(q) || r.vcn_licence_no.toLowerCase().includes(q) || r.drug_summary.toLowerCase().includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.pom) qs.set('pom', opts.pom);
  if (opts?.flagged) qs.set('flagged', opts.flagged);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<EprescriptionAuditItem[]>(`/eprescriptions${qs.toString() ? `?${qs}` : ''}`);
}

// ════════════════════════════════════════════════════════════════════════════
// F · Payouts (KYC-gated — HL-10)
// ════════════════════════════════════════════════════════════════════════════
const PAYOUTS: VetPayoutRecord[] = [
  { id: 'vpay_9901', vet_masked: 'Dr A. Bello•••', clinic_masked: 'PetCare Lekki•••', kyc_tier: 'tier3', kyc_verified: true, released_kobo: 8_400_000_00, fees_kobo: 840_000_00, net_payable_kobo: 7_560_000_00, payout_status: 'approved', aml_flag: false, created_at: dateStr(2) },
  { id: 'vpay_9910', vet_masked: 'Dr (unverified)•••', clinic_masked: 'QuickVet Express•••', kyc_tier: 'tier0', kyc_verified: false, released_kobo: 2_100_000_00, fees_kobo: 210_000_00, net_payable_kobo: 1_890_000_00, payout_status: 'kyc_hold', aml_flag: false, created_at: dateStr(1) },
  { id: 'vpay_9920', vet_masked: 'Dr C. Okonkwo•••', clinic_masked: 'Garki Animal Hospital•••', kyc_tier: 'tier2', kyc_verified: true, released_kobo: 5_600_000_00, fees_kobo: 560_000_00, net_payable_kobo: 5_040_000_00, payout_status: 'paid', aml_flag: false, created_at: dateStr(10) },
  { id: 'vpay_9930', vet_masked: 'Dr T. Wodu•••', clinic_masked: 'Bridge Vet PH•••', kyc_tier: 'tier1', kyc_verified: true, released_kobo: 3_200_000_00, fees_kobo: 320_000_00, net_payable_kobo: 2_880_000_00, payout_status: 'pending', aml_flag: true, created_at: dateStr(1) },
];
export async function listPayouts(opts?: { payout_status?: string; q?: string }): Promise<VetPayoutRecord[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...PAYOUTS];
    if (opts?.payout_status) rows = rows.filter((r) => r.payout_status === opts.payout_status);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.vet_masked.toLowerCase().includes(q) || r.clinic_masked.toLowerCase().includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.payout_status) qs.set('payout_status', opts.payout_status);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<VetPayoutRecord[]>(`/payouts${qs.toString() ? `?${qs}` : ''}`);
}
export async function decidePayout(id: string, decision: VetPayoutDecision, note?: string): Promise<VetPayoutDecisionResult> {
  if (USE_MOCK) {
    await delay();
    const p = PAYOUTS.find((x) => x.id === id);
    if (decision === 'approve' && p && !p.kyc_verified) {
      return { id, payout_status: 'kyc_hold', audit_id: auditId(), message: `Payout blocked — vet ${id} KYC tier insufficient (HL-10). Payout stays fail-closed until KYC clears. Recorded to immutable audit (HL-12).` };
    }
    if (decision === 'approve' && p?.aml_flag) {
      return { id, payout_status: 'kyc_hold', audit_id: auditId(), message: `Payout held — AML flag on settlement requires clearance before release (HL-10). Recorded to immutable audit (HL-12).` };
    }
    return { id, payout_status: decision === 'approve' ? 'approved' : 'rejected', audit_id: auditId(), message: `Vet ${id} payout ${decision === 'approve' ? 'approved' : 'rejected'}. KYC + AML gate (HL-10) passed. Settled funds are the escrow released on consult completion (HL-9). Recorded to immutable audit (HL-12).` };
  }
  return sendJson<VetPayoutDecisionResult>('POST', `/payouts/${id}/decision`, { decision, note });
}

// ════════════════════════════════════════════════════════════════════════════
// G · Content / credential moderation
// ════════════════════════════════════════════════════════════════════════════
const MODERATION: ModerationItem[] = [
  { id: 'mod_3310', kind: 'credential_mismatch', subject_masked: 'Dr E. Adeyemi•••', summary: 'Profile lists VCN/2018/06602 but VCN register lookup returns a different name — credential claim under review (HL-2).', severity: 'high', status: 'open', vcn_licence_no: 'VCN/2018/06602', reporter_masked: 'system', created_at: iso(4) },
  { id: 'mod_3320', kind: 'unlicensed_advice', subject_masked: 'Reviewer J•••', summary: 'Public review thread contains unlicensed dosing advice — Paymax never provides clinical advice (HL-1); content flagged.', severity: 'medium', status: 'investigating', vcn_licence_no: null, reporter_masked: 'pt Aisha•••', created_at: iso(12) },
  { id: 'mod_3330', kind: 'review_abuse', subject_masked: 'Dr T. Wodu•••', summary: 'Coordinated 1-star review spike flagged by anomaly detection.', severity: 'low', status: 'open', vcn_licence_no: null, reporter_masked: null, created_at: iso(20) },
  { id: 'mod_3340', kind: 'image_violation', subject_masked: 'QuickVet Express•••', summary: 'Clinic premises photo appears stock/duplicated; verification photo re-requested.', severity: 'medium', status: 'resolved', vcn_licence_no: null, reporter_masked: 'system', created_at: iso(48) },
];
export async function listModeration(opts?: { status?: string; severity?: string; q?: string }): Promise<ModerationItem[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...MODERATION];
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.severity) rows = rows.filter((r) => r.severity === opts.severity);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.subject_masked.toLowerCase().includes(q) || r.kind.toLowerCase().includes(q) || (r.vcn_licence_no ?? '').toLowerCase().includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.severity) qs.set('severity', opts.severity);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<ModerationItem[]>(`/moderation${qs.toString() ? `?${qs}` : ''}`);
}
export async function moderate(id: string, action: ModerationAction, note?: string): Promise<ModerationResult> {
  if (USE_MOCK) {
    await delay();
    const status =
      action === 'investigate' ? 'investigating'
      : action === 'resolve' ? 'resolved'
      : action === 'ignore' ? 'ignored'
      : 'resolved'; // suspend_provider closes the moderation item
    const extra = action === 'suspend_provider' ? ' Provider vet capability suspended — discoverability revoked pending review (HL-2).' : '';
    return { id, status, audit_id: auditId(), message: `Moderation ${id}: ${action.replace(/_/g, ' ')} applied.${extra} Recorded to immutable audit (HL-12).` };
  }
  return sendJson<ModerationResult>('POST', `/moderation/${id}/action`, { action, note });
}

// ════════════════════════════════════════════════════════════════════════════
// H · Reporting
// ════════════════════════════════════════════════════════════════════════════
const REPORTING: VetReportingData = {
  generated_at: iso(0.2),
  period_label: 'Last 30 days',
  gmv_kobo: 142_700_000_00,
  net_revenue_kobo: 14_270_000_0,
  appointments: 11_280,
  tele_appointments: 6_540,
  home_appointments: 2_820,
  clinic_appointments: 1_920,
  completion_rate: 0.927,
  no_show_rate: 0.041,
  refund_rate: 0.014,
  eprescriptions: 6_840, // HL-3
  pom_share: 0.425,
  sos_routed: 37, // HL-11
  payouts_kyc_hold: 2, // HL-10
  by_state: [
    { state: 'Lagos', appointments: 5_640, gmv_kobo: 71_350_000_00, share_pct: 0.5 },
    { state: 'FCT (Abuja)', appointments: 2_370, gmv_kobo: 29_960_000_00, share_pct: 0.21 },
    { state: 'Rivers', appointments: 1_350, gmv_kobo: 17_120_000_00, share_pct: 0.12 },
    { state: 'Enugu', appointments: 900, gmv_kobo: 11_420_000_00, share_pct: 0.08 },
    { state: 'Abia', appointments: 560, gmv_kobo: 7_130_000_00, share_pct: 0.05 },
    { state: 'Others', appointments: 460, gmv_kobo: 5_720_000_00, share_pct: 0.04 },
  ],
  monthly: Array.from({ length: 6 }).map((_, i) => {
    const m = new Date(Date.now() - (5 - i) * 30 * 86_400_000);
    const gmv = (95_000_000 + i * 11_000_000) * 100;
    return { month: m.toLocaleDateString('en-NG', { month: 'short', year: '2-digit' }), gmv_kobo: gmv, net_kobo: Math.round(gmv * 0.1), appointments: 8_000 + i * 850 };
  }),
};
export async function getReporting(opts?: { period?: string }): Promise<VetReportingData> {
  if (USE_MOCK) { await delay(); return { ...REPORTING, by_state: [...REPORTING.by_state], monthly: [...REPORTING.monthly] }; }
  const qs = new URLSearchParams();
  if (opts?.period) qs.set('period', opts.period);
  return getJson<VetReportingData>(`/reporting${qs.toString() ? `?${qs}` : ''}`);
}
