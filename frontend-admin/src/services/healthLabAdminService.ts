// ── Admin — Paymax Health · Laboratory (HEALTH-BUILD Phase 2 ADM) ──────────────
// Mock by default (mirrors healthPharmacyAdminService P1). Flip with
// NEXT_PUBLIC_HEALTH_USE_MOCK=false to hit the live Go backend at
// /api/health/lab/admin/*. RBAC: health.lab.* gates wired on the sidebar.
// Money is BIGINT kobo (minor units) throughout — formatNaira() converts kobo → ₦.
// Surfaces HEALTH invariants the Lab vertical enforces:
//  HL-2 credential-gated supply (MLSCN lab + scientist licences; auto-suspend on expiry),
//  HL-6 chain-of-custody integrity (break → recollect; no result without an unbroken chain),
//  HL-7 critical-result human escalation (never silent),
//  HL-8 health data sensitive NDPA (masked; consent gates release),
//  HL-9 money held→released→refunded, HL-10 payout KYC+AML gate, HL-12 immutable audit.

import { env } from '@/config/env';
import type {
  LabDashboard,
  MlscnApplication,
  MlscnDecision,
  MlscnDecisionResult,
  LabCatalogItem,
  LabCatalogGovernanceAction,
  LabCatalogGovernanceResult,
  CustodySample,
  CustodyChain,
  CustodyBreakResult,
  ResultAuditItem,
  ResultReleaseAction,
  ResultReleaseResult,
  Escalation,
  EscalationResolveAction,
  EscalationResolveResult,
  Phlebotomist,
  LabPayoutRecord,
  LabPayoutDecision,
  LabPayoutDecisionResult,
  LabReportingData,
} from '@/types/healthLabAdmin';

const USE_MOCK = (process.env.NEXT_PUBLIC_HEALTH_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function adminBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/health/lab/admin');
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
const DASHBOARD: LabDashboard = {
  generated_at: iso(0.1),
  orders_today: 920,
  orders_30d: 24_360,
  gmv_today_kobo: 9_640_000_00,
  gmv_30d_kobo: 248_900_000_00,
  net_revenue_30d_kobo: 19_912_000_0,
  take_rate: 0.08,
  avg_order_value_kobo: 10_220_00,
  tat_median_hours: 22,
  tat_target_hours: 24,
  tat_breaches: 6,
  critical_results_open: 2, // HL-7 — human escalation in progress, never silent
  critical_results_30d: 41,
  escalation_sla_minutes: 14,
  escalation_sla_target_minutes: 30,
  custody_breaks_open: 1, // HL-6 — awaiting recollection
  custody_breaks_30d: 9,
  samples_in_transit: 58,
  recollections_required: 1,
  mlscn_pending_review: 7, // HL-2
  catalog_pending_governance: 18,
  results_pending_release: 12, // HL-8
  results_released_30d: 23_980,
  payouts_kyc_hold: 4, // HL-10
  held_balance_kobo: 21_300_000_00, // HL-9 escrow held until result release / fulfilment
  released_30d_kobo: 226_400_000_00,
  refunded_30d_kobo: 3_180_000_00,
  labs_active: 96,
  labs_suspended: 4,
  phlebotomists_active: 142,
  order_mix: [
    { label: 'Home collection', orders: 14_010, gmv_kobo: 158_330_000_00, share_pct: 0.58 },
    { label: 'Walk-in', orders: 7_840, gmv_kobo: 64_990_000_00, share_pct: 0.32 },
    { label: 'Health packages', orders: 2_510, gmv_kobo: 25_580_000_00, share_pct: 0.1 },
  ],
  tat_trend: Array.from({ length: 14 }).map((_, i) => {
    const tat = 24 + Math.round(Math.sin(i / 2) * 4) - Math.round(i / 6);
    return { date: dateStr(13 - i), tat_hours: Math.max(14, tat) };
  }),
  activity: [
    { id: 'la1', kind: 'mlscn_approved', label: 'Lab approved & capability granted — "PathCare Diagnostics Lekki" (MLSCN facility + scientist verified, HL-2)', ref: 'mlscn_7741', created_at: iso(0.5) },
    { id: 'la2', kind: 'critical_escalated', label: 'Critical result escalated to a named human owner — Potassium 7.2 mmol/L; never released silently (HL-7)', ref: 'esc_3301', created_at: iso(0.9) },
    { id: 'la3', kind: 'custody_breach', label: 'Chain-of-custody break flagged — seal broken in transit; recollection required, no result will release (HL-6)', ref: 'smp_6620', created_at: iso(1.8) },
    { id: 'la4', kind: 'result_released', label: 'Result signed off by lab scientist & released to patient vault under NDPA consent (HL-8)', ref: 'res_5510', created_at: iso(3.0) },
    { id: 'la5', kind: 'catalog_governed', label: 'Test catalog item suspended — missing LOINC mapping pending governance review', ref: 'lcat_4420', created_at: iso(4.4) },
    { id: 'la6', kind: 'payout_held', label: 'Lab payout held — KYC tier insufficient (HL-10)', ref: 'lpay_8810', created_at: iso(7.5) },
  ],
};
export async function getLabDashboard(): Promise<LabDashboard> {
  if (USE_MOCK) { await delay(); return { ...DASHBOARD, order_mix: [...DASHBOARD.order_mix], tat_trend: [...DASHBOARD.tat_trend], activity: [...DASHBOARD.activity] }; }
  return getJson<LabDashboard>('/dashboard');
}

// ════════════════════════════════════════════════════════════════════════════
// B · MLSCN credential audit queue (HL-2)
// ════════════════════════════════════════════════════════════════════════════
const MLSCN_APPS: MlscnApplication[] = [
  { id: 'mlscn_7741', lab_name: 'PathCare Diagnostics Lekki', lab_scientist_masked: 'MLS A. Olawale•••', mlscn_lab_no: 'MLSCN/LAB/LA/2024/00821', mlscn_scientist_no: 'MLSCN/RS/2016/04412', cac_rc_no: 'RC-2210984', state: 'Lagos', lga: 'Eti-Osa', status: 'submitted', lab_verified: false, scientist_verified: true, licence_expires_at: dateStr(-300), docs: [{ kind: 'MLSCN_lab_licence', reference: 'MLSCN/LAB/LA/2024/00821', expires_at: dateStr(-300), verified: false }, { kind: 'lab_scientist_licence', reference: 'MLSCN/RS/2016/04412', expires_at: dateStr(-180), verified: true }, { kind: 'CAC', reference: 'RC-2210984', verified: true }], submitted_at: iso(5), created_at: iso(50) },
  { id: 'mlscn_7742', lab_name: 'Synlab Garki', lab_scientist_masked: 'MLS C. Danjuma•••', mlscn_lab_no: 'MLSCN/LAB/FC/2023/00440', mlscn_scientist_no: 'MLSCN/RS/2014/02201', cac_rc_no: 'RC-1880221', state: 'FCT', lga: 'Abuja Municipal', status: 'under_review', lab_verified: true, scientist_verified: true, licence_expires_at: dateStr(-95), docs: [{ kind: 'MLSCN_lab_licence', reference: 'MLSCN/LAB/FC/2023/00440', expires_at: dateStr(-95), verified: true }, { kind: 'lab_scientist_licence', reference: 'MLSCN/RS/2014/02201', expires_at: dateStr(-60), verified: true }, { kind: 'equipment_cert', reference: 'EQ-CAL-2026-118', verified: true }], submitted_at: iso(28), created_at: iso(110) },
  { id: 'mlscn_7743', lab_name: 'Clina-Lancet Aba', lab_scientist_masked: 'MLS E. Okereke•••', mlscn_lab_no: 'MLSCN/LAB/AB/2022/00210', mlscn_scientist_no: 'MLSCN/RS/2011/00912', cac_rc_no: 'RC-0998771', state: 'Abia', lga: 'Aba South', status: 'needs_info', lab_verified: false, scientist_verified: false, licence_expires_at: dateStr(35), docs: [{ kind: 'MLSCN_lab_licence', reference: 'MLSCN/LAB/AB/2022/00210', expires_at: dateStr(35), verified: false }, { kind: 'facility_photo', reference: 'photo-set-7', verified: false }], submitted_at: iso(70), created_at: iso(240) },
  { id: 'mlscn_7744', lab_name: 'Bridge Clinical Labs PH', lab_scientist_masked: 'MLS T. Wodu•••', mlscn_lab_no: 'MLSCN/LAB/RV/2021/00118', mlscn_scientist_no: 'MLSCN/RS/2009/00310', cac_rc_no: 'RC-0118660', state: 'Rivers', lga: 'Port Harcourt', status: 'approved', lab_verified: true, scientist_verified: true, licence_expires_at: dateStr(-20), docs: [{ kind: 'MLSCN_lab_licence', reference: 'MLSCN/LAB/RV/2021/00118', expires_at: dateStr(-20), verified: true }, { kind: 'lab_scientist_licence', reference: 'MLSCN/RS/2009/00310', expires_at: dateStr(-150), verified: true }], submitted_at: iso(420), created_at: iso(700) },
  { id: 'mlscn_7745', lab_name: 'QuickLab Express', lab_scientist_masked: 'MLS (unverified)•••', mlscn_lab_no: 'MLSCN/LAB/PENDING', mlscn_scientist_no: 'MLSCN/RS/PENDING', cac_rc_no: 'RC-PENDING', state: 'Lagos', lga: 'Surulere', status: 'rejected', lab_verified: false, scientist_verified: false, licence_expires_at: null, docs: [{ kind: 'MLSCN_lab_licence', reference: 'MLSCN/LAB/PENDING', verified: false }], submitted_at: iso(130), created_at: iso(320) },
  { id: 'mlscn_7746', lab_name: 'Wellness Path Enugu', lab_scientist_masked: 'MLS O. Ani•••', mlscn_lab_no: 'MLSCN/LAB/EN/2019/00070', mlscn_scientist_no: 'MLSCN/RS/2007/00120', cac_rc_no: 'RC-0070554', state: 'Enugu', lga: 'Enugu North', status: 'suspended', lab_verified: true, scientist_verified: true, licence_expires_at: dateStr(6), docs: [{ kind: 'MLSCN_lab_licence', reference: 'MLSCN/LAB/EN/2019/00070', expires_at: dateStr(6), verified: true }], submitted_at: iso(950), created_at: iso(1300) },
];
export async function listMlscnApplications(opts?: { status?: string; q?: string }): Promise<MlscnApplication[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...MLSCN_APPS];
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.lab_name.toLowerCase().includes(q) || r.mlscn_lab_no.toLowerCase().includes(q) || r.state.toLowerCase().includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<MlscnApplication[]>(`/mlscn/applications${qs.toString() ? `?${qs}` : ''}`);
}
export async function decideMlscn(id: string, decision: MlscnDecision, note?: string): Promise<MlscnDecisionResult> {
  if (USE_MOCK) {
    await delay();
    const app = MLSCN_APPS.find((a) => a.id === id);
    if (decision === 'approve' && app && (!app.lab_verified || !app.scientist_verified)) {
      return { id, status: 'needs_info', capability_granted: false, audit_id: auditId(), message: `Fixture — nothing was saved. Approval blocked — MLSCN facility or medical-laboratory-scientist licence not verified (HL-2). Supply stays credential-gated and fail-closed. (HL-12).` };
    }
    const status =
      decision === 'approve' ? 'approved'
      : decision === 'reject' ? 'rejected'
      : decision === 'need_info' ? 'needs_info'
      : decision === 'suspend' ? 'suspended'
      : 'approved'; // reinstate
    return { id, status, capability_granted: decision === 'approve', audit_id: auditId(), message: `Fixture — nothing was saved. MLSCN application ${id}: ${decision} applied. ${decision === 'approve' ? 'Provider lab capability idempotently granted and discoverability unlocked (HL-2). ' : ''}State machine SUBMITTED→UNDER_REVIEW→${status.toUpperCase()} enforced. (HL-12).` };
  }
  return sendJson<MlscnDecisionResult>('POST', `/mlscn/applications/${id}/decision`, { decision, note });
}

// ════════════════════════════════════════════════════════════════════════════
// C · Test catalog governance
// ════════════════════════════════════════════════════════════════════════════
const CATALOG: LabCatalogItem[] = [
  { id: 'lcat_4401', test_name: 'Full Blood Count (FBC)', loinc_code: '58410-2', category: 'haematology', is_package: false, specimen: 'blood', prep_required: 'None', tat_hours: 6, lab_masked: 'PathCare Lekki•••', price_kobo: 6_500_00, status: 'approved', flagged_reason: null, created_at: dateStr(30) },
  { id: 'lcat_4410', test_name: 'Fasting Blood Sugar', loinc_code: '1558-6', category: 'chemistry', is_package: false, specimen: 'blood', prep_required: 'Fasting 8–12h', tat_hours: 4, lab_masked: 'Synlab Garki•••', price_kobo: 3_500_00, status: 'pending', flagged_reason: null, created_at: dateStr(2) },
  { id: 'lcat_4415', test_name: 'Lipid Profile', loinc_code: '24331-1', category: 'chemistry', is_package: false, specimen: 'blood', prep_required: 'Fasting 9–12h', tat_hours: 12, lab_masked: 'Bridge Clinical PH•••', price_kobo: 9_800_00, status: 'pending', flagged_reason: null, created_at: dateStr(1) },
  { id: 'lcat_4420', test_name: 'Wellness Booster Panel', loinc_code: null, category: 'panel', is_package: true, specimen: 'blood', prep_required: 'Fasting 8h', tat_hours: 24, lab_masked: 'QuickLab•••', price_kobo: 28_000_00, status: 'suspended', flagged_reason: 'No LOINC mapping — test definition pending governance review', created_at: dateStr(8) },
  { id: 'lcat_4430', test_name: 'Malaria Parasite (MP)', loinc_code: '32700-7', category: 'microbiology', is_package: false, specimen: 'blood', prep_required: 'None', tat_hours: 3, lab_masked: 'Wellness Path Enugu•••', price_kobo: 2_500_00, status: 'rejected', flagged_reason: 'Lab suspended — listing blocked (HL-2)', created_at: dateStr(10) },
  { id: 'lcat_4440', test_name: 'HIV 1&2 Screening', loinc_code: '75622-1', category: 'serology', is_package: false, specimen: 'blood', prep_required: 'None', tat_hours: 8, lab_masked: 'PathCare Lekki•••', price_kobo: 5_000_00, status: 'approved', flagged_reason: null, created_at: dateStr(40) },
  { id: 'lcat_4450', test_name: 'COVID-19 PCR', loinc_code: '94500-6', category: 'molecular', is_package: false, specimen: 'swab', prep_required: 'None', tat_hours: 24, lab_masked: 'Synlab Garki•••', price_kobo: 45_000_00, status: 'approved', flagged_reason: null, created_at: dateStr(60) },
];
export async function listCatalog(opts?: { status?: string; category?: string; q?: string }): Promise<LabCatalogItem[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...CATALOG];
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.category) rows = rows.filter((r) => r.category === opts.category);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.test_name.toLowerCase().includes(q) || (r.loinc_code ?? '').toLowerCase().includes(q) || r.lab_masked.toLowerCase().includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.category) qs.set('category', opts.category);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<LabCatalogItem[]>(`/catalog${qs.toString() ? `?${qs}` : ''}`);
}
export async function governTest(id: string, action: LabCatalogGovernanceAction, note?: string): Promise<LabCatalogGovernanceResult> {
  if (USE_MOCK) {
    await delay();
    const item = CATALOG.find((c) => c.id === id);
    if (action === 'approve' && item && !item.loinc_code) {
      return { id, status: 'pending', audit_id: auditId(), message: `Fixture — nothing was saved. Approval blocked — test has no LOINC mapping; a governed test definition is required before listing. (HL-12).` };
    }
    const status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'suspended';
    return { id, status, audit_id: auditId(), message: `Fixture — nothing was saved. Test catalog item ${id}: ${action} applied. Test-definition governance enforced. (HL-12).` };
  }
  return sendJson<LabCatalogGovernanceResult>('POST', `/catalog/${id}/govern`, { action, note });
}

// ════════════════════════════════════════════════════════════════════════════
// D · Chain-of-custody oversight (HL-6)
// ════════════════════════════════════════════════════════════════════════════
const CUSTODY: CustodySample[] = [
  { id: 'smp_6610', order_ref: 'lab_9920', patient_masked: 'pt Chioma•••', test_summary: 'FBC + Lipid Profile', lab_masked: 'PathCare Lekki•••', phlebotomist_masked: 'Phleb. A. Musa•••', status: 'accessioned', chain_intact: true, break_reason: null, collected_at: iso(20), updated_at: iso(16) },
  { id: 'smp_6615', order_ref: 'lab_9922', patient_masked: 'pt Aisha•••', test_summary: 'Fasting Blood Sugar', lab_masked: 'Synlab Garki•••', phlebotomist_masked: 'Phleb. B. Yusuf•••', status: 'in_custody', chain_intact: true, break_reason: null, collected_at: iso(6), updated_at: iso(5) },
  { id: 'smp_6618', order_ref: 'lab_9924', patient_masked: 'pt Tunde•••', test_summary: 'COVID-19 PCR', lab_masked: 'Synlab Garki•••', phlebotomist_masked: 'Phleb. C. Ade•••', status: 'handed_over', chain_intact: true, break_reason: null, collected_at: iso(4), updated_at: iso(2) },
  { id: 'smp_6620', order_ref: 'lab_9926', patient_masked: 'pt Bola•••', test_summary: 'Lipid Profile', lab_masked: 'Bridge Clinical PH•••', phlebotomist_masked: 'Phleb. D. Eze•••', status: 'breached', chain_intact: false, break_reason: 'Tamper seal broken in transit; cold-chain temperature excursion logged (>10°C). Unbroken chain required — recollection mandated (HL-6).', collected_at: iso(10), updated_at: iso(8) },
  { id: 'smp_6622', order_ref: 'lab_9926', patient_masked: 'pt Bola•••', test_summary: 'Lipid Profile (recollect)', lab_masked: 'Bridge Clinical PH•••', phlebotomist_masked: 'Phleb. D. Eze•••', status: 'recollect_required', chain_intact: false, break_reason: 'Recollection scheduled after upstream custody break on smp_6620 (HL-6).', collected_at: iso(8), updated_at: iso(7) },
  { id: 'smp_6630', order_ref: 'lab_9900', patient_masked: 'pt Ngozi•••', test_summary: 'Malaria Parasite', lab_masked: 'Wellness Path Enugu•••', phlebotomist_masked: 'Phleb. E. Obi•••', status: 'collected', chain_intact: true, break_reason: null, collected_at: iso(1.5), updated_at: iso(1.5) },
];
export async function listCustody(opts?: { status?: string; chain?: string; q?: string }): Promise<CustodySample[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...CUSTODY];
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.chain === 'broken') rows = rows.filter((r) => !r.chain_intact);
    if (opts?.chain === 'intact') rows = rows.filter((r) => r.chain_intact);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.patient_masked.toLowerCase().includes(q) || r.lab_masked.toLowerCase().includes(q) || r.order_ref.includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.chain) qs.set('chain', opts.chain);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<CustodySample[]>(`/custody${qs.toString() ? `?${qs}` : ''}`);
}
export async function getCustodyChain(id: string): Promise<CustodyChain> {
  if (USE_MOCK) {
    await delay();
    const base = CUSTODY.find((s) => s.id === id) ?? CUSTODY[0];
    const broken = !base.chain_intact;
    return {
      ...base,
      events: [
        { id: 'ce1', step: 'COLLECTED', label: 'Sample collected — barcode + tamper seal applied at point of collection', actor_masked: base.phlebotomist_masked, location: `${base.lab_masked.replace('•••', '')} catchment`, temperature_c: 4, seal_intact: true, audit_id: 'aud_c001', at: base.collected_at },
        { id: 'ce2', step: 'IN_CUSTODY', label: 'In phlebotomist custody — cold-chain box logged', actor_masked: base.phlebotomist_masked, location: 'In transit (last-mile rail)', temperature_c: broken ? 12 : 5, seal_intact: !broken, audit_id: 'aud_c002', at: iso(9) },
        ...(broken
          ? [{ id: 'ce3', step: 'BREACHED', label: 'CHAIN BREAK — tamper seal broken / temperature excursion. No result may be released on a broken chain (HL-6).', actor_masked: 'system', location: 'In transit', temperature_c: 12, seal_intact: false, audit_id: 'aud_c003', at: iso(8) },
             { id: 'ce4', step: 'RECOLLECT_REQUIRED', label: 'Recollection mandated — new sample requested; original quarantined.', actor_masked: 'system', location: '—', temperature_c: null, seal_intact: false, audit_id: 'aud_c004', at: iso(8) }]
          : [{ id: 'ce3', step: 'HANDED_OVER', label: 'Handed over to lab — custody transfer co-signed', actor_masked: base.lab_masked, location: base.lab_masked.replace('•••', ''), temperature_c: 5, seal_intact: true, audit_id: 'aud_c003', at: iso(4) },
             { id: 'ce4', step: 'ACCESSIONED', label: 'Accessioned into LIMS — chain intact end-to-end; eligible for processing', actor_masked: base.lab_masked, location: base.lab_masked.replace('•••', ''), temperature_c: 5, seal_intact: true, audit_id: 'aud_c004', at: iso(3) }]),
      ],
    };
  }
  return getJson<CustodyChain>(`/custody/${id}`);
}
export async function flagCustodyBreak(id: string, reason: string): Promise<CustodyBreakResult> {
  if (USE_MOCK) {
    await delay();
    return { id, status: 'breached', chain_intact: false, recollect_order_ref: `recollect_${Math.random().toString(36).slice(2, 7)}`, audit_id: auditId(), message: `Fixture — nothing was saved. Custody break flagged on sample ${id}: ${reason}. Chain marked BROKEN → recollection mandated; no result will release on this sample (HL-6). (HL-12).` };
  }
  return sendJson<CustodyBreakResult>('POST', `/custody/${id}/break`, { reason });
}

// ════════════════════════════════════════════════════════════════════════════
// E · Results audit & release controls (HL-8)
// ════════════════════════════════════════════════════════════════════════════
const RESULTS: ResultAuditItem[] = [
  { id: 'res_5510', order_ref: 'lab_9920', patient_masked: 'pt Chioma•••', test_summary: 'FBC + Lipid Profile', lab_masked: 'PathCare Lekki•••', scientist_masked: 'MLS A. Olawale•••', status: 'released', abnormal_flag: 'normal', chain_intact: true, signed_off: true, consent_on_file: true, tat_hours: 18, released_at: iso(2), created_at: iso(6) },
  { id: 'res_5520', order_ref: 'lab_9922', patient_masked: 'pt Aisha•••', test_summary: 'Fasting Blood Sugar', lab_masked: 'Synlab Garki•••', scientist_masked: 'MLS C. Danjuma•••', status: 'result_ready', abnormal_flag: 'abnormal', chain_intact: true, signed_off: true, consent_on_file: true, tat_hours: 5, released_at: null, created_at: iso(3) },
  { id: 'res_5530', order_ref: 'lab_9930', patient_masked: 'pt Emeka•••', test_summary: 'Serum Electrolytes (U&E)', lab_masked: 'Synlab Garki•••', scientist_masked: 'MLS C. Danjuma•••', status: 'escalated', abnormal_flag: 'critical', chain_intact: true, signed_off: true, consent_on_file: true, tat_hours: 7, released_at: null, created_at: iso(1) },
  { id: 'res_5540', order_ref: 'lab_9926', patient_masked: 'pt Bola•••', test_summary: 'Lipid Profile', lab_masked: 'Bridge Clinical PH•••', scientist_masked: null, status: 'processing', abnormal_flag: 'normal', chain_intact: false, signed_off: false, consent_on_file: true, tat_hours: null, released_at: null, created_at: iso(8) },
  { id: 'res_5550', order_ref: 'lab_9940', patient_masked: 'pt Fatima•••', test_summary: 'HIV 1&2 Screening', lab_masked: 'PathCare Lekki•••', scientist_masked: 'MLS A. Olawale•••', status: 'result_ready', abnormal_flag: 'normal', chain_intact: true, signed_off: false, consent_on_file: false, tat_hours: 9, released_at: null, created_at: iso(2.5) },
];
export async function listResultsAudit(opts?: { status?: string; abnormal?: string; q?: string }): Promise<ResultAuditItem[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...RESULTS];
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.abnormal) rows = rows.filter((r) => r.abnormal_flag === opts.abnormal);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.patient_masked.toLowerCase().includes(q) || r.lab_masked.toLowerCase().includes(q) || r.order_ref.includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.abnormal) qs.set('abnormal', opts.abnormal);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<ResultAuditItem[]>(`/results${qs.toString() ? `?${qs}` : ''}`);
}
export async function releaseResult(id: string, action: ResultReleaseAction, note?: string): Promise<ResultReleaseResult> {
  if (USE_MOCK) {
    await delay();
    const r = RESULTS.find((x) => x.id === id);
    if (action === 'release' && r && !r.chain_intact) {
      return { id, status: 'processing', audit_id: auditId(), message: `Fixture — nothing was saved. Release blocked — chain-of-custody is broken on this sample; no result may be released without an unbroken chain (HL-6). Recollection required. (HL-12).` };
    }
    if (action === 'release' && r && !r.signed_off) {
      return { id, status: 'result_ready', audit_id: auditId(), message: `Fixture — nothing was saved. Release blocked — result not yet signed off by a registered medical laboratory scientist. (HL-12).` };
    }
    if (action === 'release' && r && !r.consent_on_file) {
      return { id, status: 'result_ready', audit_id: auditId(), message: `Fixture — nothing was saved. Release blocked — NDPA consent not on file; health data may not be released to the patient vault without explicit consent (HL-8). (HL-12).` };
    }
    if (action === 'release' && r && r.abnormal_flag === 'critical' && r.status !== 'escalated') {
      return { id, status: 'escalated', audit_id: auditId(), message: `Fixture — nothing was saved. Release routed through escalation — a critical value must complete the human escalation path before release; it is never released silently (HL-7). (HL-12).` };
    }
    const status = action === 'release' ? 'released' : action === 'amend' ? 'amended' : 'processing';
    return { id, status, audit_id: auditId(), message: `Fixture — nothing was saved. Result ${id}: ${action} applied. Chain-of-custody (HL-6), scientist sign-off and NDPA consent (HL-8) gates passed. (HL-12).` };
  }
  return sendJson<ResultReleaseResult>('POST', `/results/${id}/release`, { action, note });
}

// ════════════════════════════════════════════════════════════════════════════
// F · Critical-result escalation queue (HL-7)
// ════════════════════════════════════════════════════════════════════════════
const ESCALATIONS: Escalation[] = [
  { id: 'esc_3301', order_ref: 'lab_9930', result_ref: 'res_5530', patient_masked: 'pt Emeka•••', test_summary: 'Serum Electrolytes (U&E)', abnormal_value: 'Potassium 7.2 mmol/L (critical > 6.0)', severity: 'critical', status: 'open', lab_masked: 'Synlab Garki•••', scientist_masked: 'MLS C. Danjuma•••', escalated_to_masked: null, acknowledged_at: null, sla_minutes: 30, minutes_elapsed: 12, created_at: iso(0.2) },
  { id: 'esc_3302', order_ref: 'lab_9912', result_ref: 'res_5490', patient_masked: 'pt Ibrahim•••', test_summary: 'Haematology — Platelets', abnormal_value: 'Platelets 18 ×10⁹/L (critical < 20)', severity: 'critical', status: 'acknowledged', lab_masked: 'PathCare Lekki•••', scientist_masked: 'MLS A. Olawale•••', escalated_to_masked: 'Dr. (on-call)•••', acknowledged_at: iso(1.4), sla_minutes: 30, minutes_elapsed: 95, created_at: iso(1.7) },
  { id: 'esc_3303', order_ref: 'lab_9905', result_ref: 'res_5470', patient_masked: 'pt Halima•••', test_summary: 'Glucose (random)', abnormal_value: 'Glucose 2.1 mmol/L (critical < 2.5)', severity: 'critical', status: 'investigating', lab_masked: 'Synlab Garki•••', scientist_masked: 'MLS C. Danjuma•••', escalated_to_masked: 'Dr. (on-call)•••', acknowledged_at: iso(5), sla_minutes: 30, minutes_elapsed: 310, created_at: iso(6) },
  { id: 'esc_3304', order_ref: 'lab_9890', result_ref: 'res_5440', patient_masked: 'pt Samuel•••', test_summary: 'Liver Function (ALT)', abnormal_value: 'ALT 480 U/L (high)', severity: 'high', status: 'resolved', lab_masked: 'Bridge Clinical PH•••', scientist_masked: 'MLS T. Wodu•••', escalated_to_masked: 'Dr. (on-call)•••', acknowledged_at: iso(40), sla_minutes: 60, minutes_elapsed: 2_400, created_at: iso(48) },
];
export async function listEscalations(opts?: { status?: string; severity?: string; q?: string }): Promise<Escalation[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...ESCALATIONS];
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.severity) rows = rows.filter((r) => r.severity === opts.severity);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.patient_masked.toLowerCase().includes(q) || r.lab_masked.toLowerCase().includes(q) || r.order_ref.includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.severity) qs.set('severity', opts.severity);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<Escalation[]>(`/escalations${qs.toString() ? `?${qs}` : ''}`);
}
export async function resolveEscalation(id: string, action: EscalationResolveAction, note?: string): Promise<EscalationResolveResult> {
  if (USE_MOCK) {
    await delay();
    const status = action === 'acknowledge' ? 'acknowledged' : action === 'resolve' ? 'resolved' : 'closed';
    return { id, status, audit_id: auditId(), message: `Fixture — nothing was saved. Critical-result escalation ${id}: ${action} applied by a named human owner — the escalation path is never closed silently (HL-7). (HL-12).` };
  }
  return sendJson<EscalationResolveResult>('POST', `/escalations/${id}/resolve`, { action, note });
}

// ════════════════════════════════════════════════════════════════════════════
// G · Phlebotomist management
// ════════════════════════════════════════════════════════════════════════════
const PHLEBOTOMISTS: Phlebotomist[] = [
  { id: 'phl_8801', name_masked: 'Phleb. A. Musa•••', licence_no: 'MLSCN/PH/2018/01120', licence_expires_at: dateStr(-200), state: 'Lagos', lga: 'Eti-Osa', status: 'active', kyc_tier: 'tier3', kyc_verified: true, collections_30d: 318, custody_breaks_30d: 0, rating: 4.9, created_at: dateStr(400) },
  { id: 'phl_8802', name_masked: 'Phleb. B. Yusuf•••', licence_no: 'MLSCN/PH/2020/02240', licence_expires_at: dateStr(-90), state: 'FCT', lga: 'Abuja Municipal', status: 'active', kyc_tier: 'tier2', kyc_verified: true, collections_30d: 204, custody_breaks_30d: 1, rating: 4.6, created_at: dateStr(260) },
  { id: 'phl_8803', name_masked: 'Phleb. D. Eze•••', licence_no: 'MLSCN/PH/2019/01880', licence_expires_at: dateStr(-30), state: 'Rivers', lga: 'Port Harcourt', status: 'active', kyc_tier: 'tier2', kyc_verified: true, collections_30d: 176, custody_breaks_30d: 2, rating: 4.2, created_at: dateStr(300) },
  { id: 'phl_8804', name_masked: 'Phleb. F. Bala•••', licence_no: 'MLSCN/PH/PENDING', licence_expires_at: null, state: 'Lagos', lga: 'Surulere', status: 'pending', kyc_tier: 'tier0', kyc_verified: false, collections_30d: 0, custody_breaks_30d: 0, rating: 0, created_at: dateStr(5) },
  { id: 'phl_8805', name_masked: 'Phleb. G. Obi•••', licence_no: 'MLSCN/PH/2016/00510', licence_expires_at: dateStr(12), state: 'Enugu', lga: 'Enugu North', status: 'expired', kyc_tier: 'tier1', kyc_verified: true, collections_30d: 12, custody_breaks_30d: 0, rating: 4.0, created_at: dateStr(900) },
  { id: 'phl_8806', name_masked: 'Phleb. H. Sani•••', licence_no: 'MLSCN/PH/2017/00940', licence_expires_at: dateStr(-60), state: 'Kano', lga: 'Nassarawa', status: 'suspended', kyc_tier: 'tier2', kyc_verified: true, collections_30d: 0, custody_breaks_30d: 4, rating: 3.1, created_at: dateStr(600) },
];
export async function listPhlebotomists(opts?: { status?: string; q?: string }): Promise<Phlebotomist[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...PHLEBOTOMISTS];
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.name_masked.toLowerCase().includes(q) || r.licence_no.toLowerCase().includes(q) || r.state.toLowerCase().includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<Phlebotomist[]>(`/phlebotomists${qs.toString() ? `?${qs}` : ''}`);
}

// ════════════════════════════════════════════════════════════════════════════
// H · Payouts (KYC-gated — HL-10)
// ════════════════════════════════════════════════════════════════════════════
const PAYOUTS: LabPayoutRecord[] = [
  { id: 'lpay_8801', lab_masked: 'PathCare Lekki•••', kyc_tier: 'tier3', kyc_verified: true, collected_kobo: 14_200_000_00, fees_kobo: 1_136_000_00, net_payable_kobo: 13_064_000_00, payout_status: 'approved', aml_flag: false, created_at: dateStr(2) },
  { id: 'lpay_8810', lab_masked: 'QuickLab•••', kyc_tier: 'tier0', kyc_verified: false, collected_kobo: 4_800_000_00, fees_kobo: 384_000_00, net_payable_kobo: 4_416_000_00, payout_status: 'kyc_hold', aml_flag: false, created_at: dateStr(1) },
  { id: 'lpay_8820', lab_masked: 'Synlab Garki•••', kyc_tier: 'tier2', kyc_verified: true, collected_kobo: 9_900_000_00, fees_kobo: 792_000_00, net_payable_kobo: 9_108_000_00, payout_status: 'paid', aml_flag: false, created_at: dateStr(10) },
  { id: 'lpay_8830', lab_masked: 'Bridge Clinical PH•••', kyc_tier: 'tier1', kyc_verified: true, collected_kobo: 3_400_000_00, fees_kobo: 272_000_00, net_payable_kobo: 3_128_000_00, payout_status: 'pending', aml_flag: true, created_at: dateStr(1) },
];
export async function listPayouts(opts?: { payout_status?: string; q?: string }): Promise<LabPayoutRecord[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...PAYOUTS];
    if (opts?.payout_status) rows = rows.filter((r) => r.payout_status === opts.payout_status);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.lab_masked.toLowerCase().includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.payout_status) qs.set('payout_status', opts.payout_status);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<LabPayoutRecord[]>(`/payouts${qs.toString() ? `?${qs}` : ''}`);
}
export async function decidePayout(id: string, decision: LabPayoutDecision, note?: string): Promise<LabPayoutDecisionResult> {
  if (USE_MOCK) {
    await delay();
    const p = PAYOUTS.find((x) => x.id === id);
    if (decision === 'approve' && p && !p.kyc_verified) {
      return { id, payout_status: 'kyc_hold', audit_id: auditId(), message: `Fixture — nothing was saved. Payout blocked — lab ${id} KYC tier insufficient (HL-10). Payout stays fail-closed until KYC clears. (HL-12).` };
    }
    if (decision === 'approve' && p?.aml_flag) {
      return { id, payout_status: 'kyc_hold', audit_id: auditId(), message: `Fixture — nothing was saved. Payout held — AML flag on settlement requires clearance before release (HL-10). (HL-12).` };
    }
    return { id, payout_status: decision === 'approve' ? 'approved' : 'rejected', audit_id: auditId(), message: `Fixture — nothing was saved. Lab ${id} payout ${decision === 'approve' ? 'approved' : 'rejected'}. KYC + AML gate (HL-10) passed. (HL-12).` };
  }
  return sendJson<LabPayoutDecisionResult>('POST', `/payouts/${id}/decision`, { decision, note });
}

// ════════════════════════════════════════════════════════════════════════════
// I · Reporting
// ════════════════════════════════════════════════════════════════════════════
const REPORTING: LabReportingData = {
  generated_at: iso(0.2),
  period_label: 'Last 30 days',
  gmv_kobo: 248_900_000_00,
  net_revenue_kobo: 19_912_000_0,
  orders: 24_360,
  home_collection_orders: 14_010,
  walk_in_orders: 10_350,
  refund_rate: 0.013,
  tat_median_hours: 22,
  tat_breach_rate: 0.041,
  custody_break_rate: 0.0037, // HL-6
  critical_results: 41, // HL-7
  critical_escalation_compliance: 0.976, // share acknowledged within SLA
  payouts_kyc_hold: 4, // HL-10
  by_state: [
    { state: 'Lagos', orders: 11_840, gmv_kobo: 124_900_000_00, share_pct: 0.49 },
    { state: 'FCT (Abuja)', orders: 5_220, gmv_kobo: 52_660_000_00, share_pct: 0.21 },
    { state: 'Rivers', orders: 3_180, gmv_kobo: 29_410_000_00, share_pct: 0.13 },
    { state: 'Enugu', orders: 2_010, gmv_kobo: 19_330_000_00, share_pct: 0.08 },
    { state: 'Abia', orders: 1_290, gmv_kobo: 12_440_000_00, share_pct: 0.05 },
    { state: 'Others', orders: 820, gmv_kobo: 10_160_000_00, share_pct: 0.04 },
  ],
  monthly: Array.from({ length: 6 }).map((_, i) => {
    const m = new Date(Date.now() - (5 - i) * 30 * 86_400_000);
    const gmv = (160_000_000 + i * 18_000_000) * 100;
    return { month: m.toLocaleDateString('en-NG', { month: 'short', year: '2-digit' }), gmv_kobo: gmv, net_kobo: Math.round(gmv * 0.08), orders: 18_000 + i * 1_900 };
  }),
};
export async function getReporting(opts?: { period?: string }): Promise<LabReportingData> {
  if (USE_MOCK) { await delay(); return { ...REPORTING, by_state: [...REPORTING.by_state], monthly: [...REPORTING.monthly] }; }
  const qs = new URLSearchParams();
  if (opts?.period) qs.set('period', opts.period);
  return getJson<LabReportingData>(`/reporting${qs.toString() ? `?${qs}` : ''}`);
}
