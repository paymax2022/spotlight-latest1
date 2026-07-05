// ── Admin — Paymax Health · Pharmacy (HEALTH-BUILD Phase 1 ADM) ────────────────
// Mock by default (mirrors stays / savings / events admin services). Flip with
// NEXT_PUBLIC_HEALTH_USE_MOCK=false to hit the live Go backend at
// /api/health/pharmacy/admin/*. RBAC: health.pharmacy.* gates wired on the sidebar.
// Money is BIGINT kobo (minor units) throughout — formatNaira() converts kobo → ₦.
// Surfaces HEALTH invariants: HL-2 credential-gated supply (PCN/premises),
// HL-3 Rx discipline + dispense-once, HL-4 controlled substances excluded at MVP,
// HL-5 NAFDAC-only catalog (reject at write), HL-8 NDPA sensitive data (masked),
// HL-9 money held→released→refunded, HL-10 payout KYC gate, HL-12 immutable audit.

import { env } from '@/config/env';
import type {
  PharmacyDashboard,
  PcnApplication,
  PcnDecision,
  PcnDecisionResult,
  CatalogItem,
  CatalogGovernanceAction,
  CatalogGovernanceResult,
  RxAuditItem,
  ControlledLogEntry,
  PharmacyOrderSummary,
  PharmacyOrderDetail,
  RecallRecord,
  CreateRecallInput,
  CreateRecallResult,
  PayoutRecord,
  PayoutDecision,
  PayoutDecisionResult,
  ReportingData,
} from '@/types/healthAdmin';

const USE_MOCK = (process.env.NEXT_PUBLIC_HEALTH_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function adminBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/health/pharmacy/admin');
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
const DASHBOARD: PharmacyDashboard = {
  generated_at: iso(0.1),
  orders_today: 1_840,
  orders_30d: 48_220,
  gmv_today_kobo: 14_820_000_00,
  gmv_30d_kobo: 392_660_000_00,
  net_revenue_30d_kobo: 27_486_200_0,
  take_rate: 0.07,
  avg_order_value_kobo: 8_140_00,
  rx_pending_verification: 37,
  rx_verify_sla_minutes: 11,
  rx_verify_sla_target_minutes: 15,
  rx_verify_breaches: 4,
  pcn_pending_review: 9,
  catalog_pending_governance: 23,
  catalog_unregistered_blocked: 142, // HL-5 reject-at-write (30d)
  controlled_attempts_blocked: 6, // HL-4
  recalls_open: 2,
  payouts_kyc_hold: 5, // HL-10
  held_balance_kobo: 36_400_000_00, // HL-9 escrow held until delivery/pickup
  released_30d_kobo: 351_900_000_00,
  refunded_30d_kobo: 4_260_000_00,
  pharmacies_active: 214,
  pharmacies_suspended: 7,
  order_mix: [
    { label: 'OTC', orders: 31_340, gmv_kobo: 196_330_000_00, share_pct: 0.5 },
    { label: 'POM (Rx)', orders: 13_900, gmv_kobo: 168_840_000_00, share_pct: 0.43 },
    { label: 'Refill', orders: 2_980, gmv_kobo: 27_490_000_00, share_pct: 0.07 },
  ],
  gmv_trend: Array.from({ length: 14 }).map((_, i) => {
    const gmv = (9_800_000 + i * 360_000 + Math.round(Math.sin(i / 2) * 900_000)) * 100;
    return { date: dateStr(13 - i), gmv_kobo: gmv, net_kobo: Math.round(gmv * 0.07) };
  }),
  activity: [
    { id: 'h1', kind: 'pcn_approved', label: 'Pharmacy approved & capability granted — "HealthPlus Ikeja" (PCN premises verified, HL-2)', ref: 'pcn_4471', created_at: iso(0.4) },
    { id: 'h2', kind: 'rx_verified', label: 'POM e-prescription verified by licensed pharmacist; dispense-once armed (HL-3)', ref: 'rx_9920', created_at: iso(1.0) },
    { id: 'h3', kind: 'catalog_rejected', label: 'Catalog item rejected at write — no valid NAFDAC registration (HL-5)', ref: 'cat_5530', created_at: iso(2.1) },
    { id: 'h4', kind: 'order_dispensed', label: 'Order dispensed & dispatched on last-mile rail; payment stays HELD until delivery (HL-9)', ref: 'ord_8810', created_at: iso(3.3) },
    { id: 'h5', kind: 'recall_issued', label: 'Pharmacovigilance recall opened — batch quarantined, patients notified', ref: 'rcl_2207', created_at: iso(5.0) },
    { id: 'h6', kind: 'payout_held', label: 'Provider payout held — KYC tier insufficient (HL-10)', ref: 'pay_5521', created_at: iso(7.0) },
    { id: 'h7', kind: 'controlled_blocked', label: 'Controlled-substance listing attempt blocked — excluded at MVP (HL-4)', ref: 'cat_5560', created_at: iso(9.0) },
  ],
};
export async function getPharmacyDashboard(): Promise<PharmacyDashboard> {
  if (USE_MOCK) { await delay(); return { ...DASHBOARD, order_mix: [...DASHBOARD.order_mix], gmv_trend: [...DASHBOARD.gmv_trend], activity: [...DASHBOARD.activity] }; }
  return getJson<PharmacyDashboard>('/dashboard');
}

// ════════════════════════════════════════════════════════════════════════════
// B · PCN / premises verification audit queue (HL-2)
// ════════════════════════════════════════════════════════════════════════════
const PCN_APPS: PcnApplication[] = [
  { id: 'pcn_4471', pharmacy_name: 'HealthPlus Ikeja', superintendent_masked: 'Pharm. A. Okafor•••', pcn_premises_no: 'PCN/PR/LA/2024/03318', pcn_pharmacist_no: 'PCN/RP/2017/14820', cac_rc_no: 'RC-1442087', state: 'Lagos', lga: 'Ikeja', status: 'submitted', premises_verified: false, pharmacist_verified: true, licence_expires_at: dateStr(-330), docs: [{ kind: 'PCN_premises_licence', reference: 'PCN/PR/LA/2024/03318', expires_at: dateStr(-330), verified: false }, { kind: 'superintendent_pharmacist', reference: 'PCN/RP/2017/14820', expires_at: dateStr(-210), verified: true }, { kind: 'CAC', reference: 'RC-1442087', verified: true }], submitted_at: iso(6), created_at: iso(48) },
  { id: 'pcn_4472', pharmacy_name: 'MedPlus Wuse 2', superintendent_masked: 'Pharm. C. Bello•••', pcn_premises_no: 'PCN/PR/FC/2023/01190', pcn_pharmacist_no: 'PCN/RP/2015/09931', cac_rc_no: 'RC-0998120', state: 'FCT', lga: 'Abuja Municipal', status: 'under_review', premises_verified: true, pharmacist_verified: true, licence_expires_at: dateStr(-120), docs: [{ kind: 'PCN_premises_licence', reference: 'PCN/PR/FC/2023/01190', expires_at: dateStr(-120), verified: true }, { kind: 'superintendent_pharmacist', reference: 'PCN/RP/2015/09931', expires_at: dateStr(-90), verified: true }], submitted_at: iso(30), created_at: iso(96) },
  { id: 'pcn_4473', pharmacy_name: 'Alpha Pharmacy Aba', superintendent_masked: 'Pharm. E. Nwosu•••', pcn_premises_no: 'PCN/PR/AB/2022/00712', pcn_pharmacist_no: 'PCN/RP/2012/04410', cac_rc_no: 'RC-0712334', state: 'Abia', lga: 'Aba South', status: 'needs_info', premises_verified: false, pharmacist_verified: false, licence_expires_at: dateStr(40), docs: [{ kind: 'PCN_premises_licence', reference: 'PCN/PR/AB/2022/00712', expires_at: dateStr(40), verified: false }, { kind: 'facility_photo', reference: 'photo-set-3', verified: false }], submitted_at: iso(72), created_at: iso(220) },
  { id: 'pcn_4474', pharmacy_name: 'Greenlife Chemists PH', superintendent_masked: 'Pharm. T. Igwe•••', pcn_premises_no: 'PCN/PR/RV/2021/00455', pcn_pharmacist_no: 'PCN/RP/2010/02218', cac_rc_no: 'RC-0455901', state: 'Rivers', lga: 'Port Harcourt', status: 'approved', premises_verified: true, pharmacist_verified: true, licence_expires_at: dateStr(-15), docs: [{ kind: 'PCN_premises_licence', reference: 'PCN/PR/RV/2021/00455', expires_at: dateStr(-15), verified: true }, { kind: 'superintendent_pharmacist', reference: 'PCN/RP/2010/02218', expires_at: dateStr(-200), verified: true }], submitted_at: iso(400), created_at: iso(600) },
  { id: 'pcn_4475', pharmacy_name: 'QuickMeds Express', superintendent_masked: 'Pharm. (unverified)•••', pcn_premises_no: 'PCN/PR/PENDING', pcn_pharmacist_no: 'PCN/RP/PENDING', cac_rc_no: 'RC-PENDING', state: 'Lagos', lga: 'Surulere', status: 'rejected', premises_verified: false, pharmacist_verified: false, licence_expires_at: null, docs: [{ kind: 'PCN_premises_licence', reference: 'PCN/PR/PENDING', verified: false }], submitted_at: iso(120), created_at: iso(300) },
  { id: 'pcn_4476', pharmacy_name: 'CarePoint Ph. Enugu', superintendent_masked: 'Pharm. O. Eze•••', pcn_premises_no: 'PCN/PR/EN/2019/00120', pcn_pharmacist_no: 'PCN/RP/2008/00990', cac_rc_no: 'RC-0120765', state: 'Enugu', lga: 'Enugu North', status: 'suspended', premises_verified: true, pharmacist_verified: true, licence_expires_at: dateStr(8), docs: [{ kind: 'PCN_premises_licence', reference: 'PCN/PR/EN/2019/00120', expires_at: dateStr(8), verified: true }], submitted_at: iso(900), created_at: iso(1200) },
];
export async function listPcnApplications(opts?: { status?: string; q?: string }): Promise<PcnApplication[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...PCN_APPS];
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.pharmacy_name.toLowerCase().includes(q) || r.pcn_premises_no.toLowerCase().includes(q) || r.state.toLowerCase().includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<PcnApplication[]>(`/pcn/applications${qs.toString() ? `?${qs}` : ''}`);
}
export async function decidePcn(id: string, decision: PcnDecision, note?: string): Promise<PcnDecisionResult> {
  if (USE_MOCK) {
    await delay();
    const app = PCN_APPS.find((a) => a.id === id);
    if (decision === 'approve' && app && (!app.premises_verified || !app.pharmacist_verified)) {
      return { id, status: 'needs_info', capability_granted: false, audit_id: auditId(), message: `Approval blocked — PCN premises or superintendent-pharmacist licence not verified (HL-2). Supply stays credential-gated and fail-closed. Recorded to immutable audit (HL-12).` };
    }
    const status =
      decision === 'approve' ? 'approved'
      : decision === 'reject' ? 'rejected'
      : decision === 'need_info' ? 'needs_info'
      : decision === 'suspend' ? 'suspended'
      : 'approved'; // reinstate
    return { id, status, capability_granted: decision === 'approve', audit_id: auditId(), message: `PCN application ${id}: ${decision} applied. ${decision === 'approve' ? 'Provider pharmacy capability idempotently granted and discoverability unlocked (HL-2). ' : ''}State machine SUBMITTED→UNDER_REVIEW→${status.toUpperCase()} enforced. Recorded to immutable audit (HL-12).` };
  }
  return sendJson<PcnDecisionResult>('POST', `/pcn/applications/${id}/decision`, { decision, note });
}

// ════════════════════════════════════════════════════════════════════════════
// C · Catalog / NAFDAC governance (HL-5)
// ════════════════════════════════════════════════════════════════════════════
const CATALOG: CatalogItem[] = [
  { id: 'cat_5501', product_name: 'Paracetamol 500mg', brand: 'Emzor', pharmacy_masked: 'HealthPlus Ikeja•••', nafdac_reg_no: 'A4-0100', nafdac_valid: true, form: 'tablet', strength: '500mg', pom: false, controlled: false, price_kobo: 350_00, stock: 4_200, status: 'approved', flagged_reason: null, created_at: dateStr(30) },
  { id: 'cat_5510', product_name: 'Amoxicillin 500mg', brand: 'Fidson', pharmacy_masked: 'MedPlus Wuse 2•••', nafdac_reg_no: 'A4-7782', nafdac_valid: true, form: 'capsule', strength: '500mg', pom: true, controlled: false, price_kobo: 1_800_00, stock: 980, status: 'pending', flagged_reason: null, created_at: dateStr(2) },
  { id: 'cat_5520', product_name: 'Lisinopril 10mg', brand: 'Swiss Pharma', pharmacy_masked: 'Greenlife PH•••', nafdac_reg_no: 'A4-5521', nafdac_valid: true, form: 'tablet', strength: '10mg', pom: true, controlled: false, price_kobo: 2_400_00, stock: 320, status: 'pending', flagged_reason: null, created_at: dateStr(1) },
  { id: 'cat_5530', product_name: 'Herbal Detox Booster', brand: 'Unknown', pharmacy_masked: 'QuickMeds•••', nafdac_reg_no: null, nafdac_valid: false, form: 'syrup', strength: 'n/a', pom: false, controlled: false, price_kobo: 5_000_00, stock: 60, status: 'rejected', flagged_reason: 'No valid NAFDAC registration number (HL-5)', created_at: dateStr(3) },
  { id: 'cat_5560', product_name: 'Codeine Linctus', brand: 'Generic', pharmacy_masked: 'QuickMeds•••', nafdac_reg_no: 'B1-0099', nafdac_valid: true, form: 'syrup', strength: '15mg/5ml', pom: true, controlled: true, price_kobo: 3_200_00, stock: 0, status: 'rejected', flagged_reason: 'Controlled substance — excluded at MVP (HL-4)', created_at: dateStr(4) },
  { id: 'cat_5570', product_name: 'Vitamin C 1000mg', brand: 'Nature’s Field', pharmacy_masked: 'CarePoint•••', nafdac_reg_no: 'A7-1190', nafdac_valid: true, form: 'tablet', strength: '1000mg', pom: false, controlled: false, price_kobo: 1_200_00, stock: 1_540, status: 'suspended', flagged_reason: 'Pharmacy suspended (HL-2)', created_at: dateStr(20) },
];
export async function listCatalog(opts?: { status?: string; pom?: string; q?: string }): Promise<CatalogItem[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...CATALOG];
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.pom === 'pom') rows = rows.filter((r) => r.pom);
    if (opts?.pom === 'otc') rows = rows.filter((r) => !r.pom);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.product_name.toLowerCase().includes(q) || r.brand.toLowerCase().includes(q) || (r.nafdac_reg_no ?? '').toLowerCase().includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.pom) qs.set('pom', opts.pom);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<CatalogItem[]>(`/catalog${qs.toString() ? `?${qs}` : ''}`);
}
export async function governCatalogItem(id: string, action: CatalogGovernanceAction, note?: string): Promise<CatalogGovernanceResult> {
  if (USE_MOCK) {
    await delay();
    const item = CATALOG.find((c) => c.id === id);
    if (action === 'approve' && item && (!item.nafdac_valid || !item.nafdac_reg_no)) {
      return { id, status: 'rejected', audit_id: auditId(), message: `Approval blocked — product has no valid NAFDAC registration (HL-5). Unregistered items are rejected at write, not merely hidden. Recorded to immutable audit (HL-12).` };
    }
    if (action === 'approve' && item?.controlled) {
      return { id, status: 'rejected', audit_id: auditId(), message: `Approval blocked — controlled substance excluded at MVP (HL-4). Recorded to immutable audit (HL-12).` };
    }
    const status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'suspended';
    return { id, status, audit_id: auditId(), message: `Catalog item ${id}: ${action} applied. NAFDAC governance (HL-5) enforced. Recorded to immutable audit (HL-12).` };
  }
  return sendJson<CatalogGovernanceResult>('POST', `/catalog/${id}/govern`, { action, note });
}

// ════════════════════════════════════════════════════════════════════════════
// D · Rx & controlled-substance audit (HL-3 / HL-4)
// ════════════════════════════════════════════════════════════════════════════
const RX_AUDIT: RxAuditItem[] = [
  { id: 'rx_9920', patient_masked: 'pt Chioma•••', prescriber_masked: 'Dr. K. Adeyemi•••', pharmacy_masked: 'HealthPlus Ikeja•••', pharmacist_masked: 'Pharm. A. Okafor•••', status: 'verified', pom_items: 2, controlled_items: 0, dispense_once_ok: true, verify_minutes: 9, order_ref: 'ord_8810', issued_at: iso(5), verified_at: iso(4.5), dispensed_at: null },
  { id: 'rx_9921', patient_masked: 'pt Emeka•••', prescriber_masked: 'Dr. F. Bello•••', pharmacy_masked: 'MedPlus Wuse 2•••', pharmacist_masked: 'Pharm. C. Bello•••', status: 'dispensed', pom_items: 1, controlled_items: 0, dispense_once_ok: true, verify_minutes: 12, order_ref: 'ord_8812', issued_at: iso(26), verified_at: iso(25), dispensed_at: iso(20) },
  { id: 'rx_9922', patient_masked: 'pt Aisha•••', prescriber_masked: 'Dr. T. Igwe•••', pharmacy_masked: 'Greenlife PH•••', pharmacist_masked: null, status: 'verifying', pom_items: 3, controlled_items: 0, dispense_once_ok: true, verify_minutes: null, order_ref: 'ord_8814', issued_at: iso(1), verified_at: null, dispensed_at: null },
  { id: 'rx_9923', patient_masked: 'pt Bola•••', prescriber_masked: 'Dr. O. Eze•••', pharmacy_masked: 'CarePoint•••', pharmacist_masked: 'Pharm. O. Eze•••', status: 'rejected', pom_items: 1, controlled_items: 1, dispense_once_ok: true, verify_minutes: 6, order_ref: null, issued_at: iso(40), verified_at: iso(39), dispensed_at: null },
  { id: 'rx_9924', patient_masked: 'pt Tunde•••', prescriber_masked: 'Dr. K. Adeyemi•••', pharmacy_masked: 'HealthPlus Ikeja•••', pharmacist_masked: 'Pharm. A. Okafor•••', status: 'fulfilled', pom_items: 2, controlled_items: 0, dispense_once_ok: true, verify_minutes: 8, order_ref: 'ord_8800', issued_at: iso(120), verified_at: iso(119), dispensed_at: iso(115) },
];
export async function listRxAudit(opts?: { status?: string; q?: string }): Promise<RxAuditItem[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...RX_AUDIT];
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.patient_masked.toLowerCase().includes(q) || r.pharmacy_masked.toLowerCase().includes(q) || r.id.includes(q) || (r.order_ref ?? '').includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<RxAuditItem[]>(`/rx-audit${qs.toString() ? `?${qs}` : ''}`);
}
const CONTROLLED_LOG: ControlledLogEntry[] = [
  { id: 'ctl_3301', substance: 'Codeine Linctus', schedule: 'Schedule (controlled)', pharmacy_masked: 'QuickMeds•••', attempted_by_masked: 'Pharm. (unverified)•••', outcome: 'blocked', reason: 'Controlled-substance listing/order excluded at MVP (HL-4)', created_at: iso(4) },
  { id: 'ctl_3302', substance: 'Tramadol 225mg', schedule: 'Schedule (controlled)', pharmacy_masked: 'Greenlife PH•••', attempted_by_masked: 'Pharm. T. Igwe•••', outcome: 'blocked', reason: 'Controlled-substance order blocked — requires statutory register; excluded at MVP (HL-4)', created_at: iso(30) },
  { id: 'ctl_3303', substance: 'Diazepam 5mg', schedule: 'Schedule (controlled)', pharmacy_masked: 'CarePoint•••', attempted_by_masked: 'Pharm. O. Eze•••', outcome: 'blocked', reason: 'Controlled-substance dispense attempt blocked (HL-4)', created_at: iso(80) },
];
export async function listControlledLog(opts?: { q?: string }): Promise<ControlledLogEntry[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...CONTROLLED_LOG];
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.substance.toLowerCase().includes(q) || r.pharmacy_masked.toLowerCase().includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.q) qs.set('q', opts.q);
  return getJson<ControlledLogEntry[]>(`/controlled-log${qs.toString() ? `?${qs}` : ''}`);
}

// ════════════════════════════════════════════════════════════════════════════
// E · Order / delivery oversight
// ════════════════════════════════════════════════════════════════════════════
const ORDERS: PharmacyOrderSummary[] = [
  { id: 'ord_8810', patient_masked: 'pt Chioma•••', pharmacy_masked: 'HealthPlus Ikeja•••', status: 'in_delivery', fulfilment: 'delivery', has_pom: true, amount_kobo: 12_400_00, payment_status: 'held', delivery_ref: 'dsp_77120', created_at: iso(4) },
  { id: 'ord_8812', patient_masked: 'pt Emeka•••', pharmacy_masked: 'MedPlus Wuse 2•••', status: 'delivered', fulfilment: 'delivery', has_pom: true, amount_kobo: 8_800_00, payment_status: 'released', delivery_ref: 'dsp_77105', created_at: iso(20) },
  { id: 'ord_8814', patient_masked: 'pt Aisha•••', pharmacy_masked: 'Greenlife PH•••', status: 'rx_pending_verification', fulfilment: 'pickup', has_pom: true, amount_kobo: 14_600_00, payment_status: 'held', delivery_ref: null, created_at: iso(1) },
  { id: 'ord_8816', patient_masked: 'pt Bola•••', pharmacy_masked: 'CarePoint•••', status: 'cancelled', fulfilment: 'delivery', has_pom: false, amount_kobo: 3_500_00, payment_status: 'refunded', delivery_ref: null, created_at: iso(36) },
  { id: 'ord_8818', patient_masked: 'pt Tunde•••', pharmacy_masked: 'HealthPlus Ikeja•••', status: 'collected', fulfilment: 'pickup', has_pom: false, amount_kobo: 2_100_00, payment_status: 'released', delivery_ref: null, created_at: iso(50) },
  { id: 'ord_8800', patient_masked: 'pt Ngozi•••', pharmacy_masked: 'HealthPlus Ikeja•••', status: 'closed', fulfilment: 'delivery', has_pom: true, amount_kobo: 9_900_00, payment_status: 'released', delivery_ref: 'dsp_76980', created_at: iso(120) },
];
export async function listOrders(opts?: { status?: string; fulfilment?: string; q?: string }): Promise<PharmacyOrderSummary[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...ORDERS];
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.fulfilment) rows = rows.filter((r) => r.fulfilment === opts.fulfilment);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.patient_masked.toLowerCase().includes(q) || r.pharmacy_masked.toLowerCase().includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.fulfilment) qs.set('fulfilment', opts.fulfilment);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<PharmacyOrderSummary[]>(`/orders${qs.toString() ? `?${qs}` : ''}`);
}
export async function getOrder(id: string): Promise<PharmacyOrderDetail> {
  if (USE_MOCK) {
    await delay();
    const base = ORDERS.find((o) => o.id === id) ?? ORDERS[0];
    const lines: PharmacyOrderDetail['lines'] = base.has_pom
      ? [
          { product_name: 'Amoxicillin 500mg (Fidson)', nafdac_reg_no: 'A4-7782', pom: true, qty: 2, unit_price_kobo: 1_800_00, line_total_kobo: 3_600_00 },
          { product_name: 'Paracetamol 500mg (Emzor)', nafdac_reg_no: 'A4-0100', pom: false, qty: 2, unit_price_kobo: 350_00, line_total_kobo: 700_00 },
        ]
      : [{ product_name: 'Vitamin C 1000mg (Nature’s Field)', nafdac_reg_no: 'A7-1190', pom: false, qty: 1, unit_price_kobo: 1_200_00, line_total_kobo: 1_200_00 }];
    const subtotal = lines.reduce((s, l) => s + l.line_total_kobo, 0);
    const delivery_fee = base.fulfilment === 'delivery' ? 1_500_00 : 0;
    return {
      ...base,
      id,
      lines,
      subtotal_kobo: subtotal,
      delivery_fee_kobo: delivery_fee,
      total_kobo: subtotal + delivery_fee,
      rx_ref: base.has_pom ? 'rx_9920' : null,
      pickup_code: base.fulfilment === 'pickup' ? 'PMX-4821' : null,
      timeline: [
        { id: 't1', status: 'created', label: 'Order created — payment captured to HELD balance (HL-9)', actor_masked: base.patient_masked, audit_id: 'aud_o001', at: iso(8) },
        ...(base.has_pom ? [{ id: 't2', status: 'verifying', label: 'POM detected — routed to pharmacist for e-Rx verification (HL-3)', actor_masked: 'system', audit_id: 'aud_o002', at: iso(7) }] : []),
        ...(base.has_pom ? [{ id: 't3', status: 'confirmed', label: 'e-Prescription verified by licensed pharmacist; dispense-once armed', actor_masked: base.pharmacy_masked, audit_id: 'aud_o003', at: iso(6) }] : []),
        { id: 't4', status: 'dispensed', label: 'Dispensed & packed', actor_masked: base.pharmacy_masked, audit_id: 'aud_o004', at: iso(5) },
        { id: 't5', status: base.fulfilment === 'delivery' ? 'in_delivery' : 'ready_for_pickup', label: base.fulfilment === 'delivery' ? 'Dispatched on last-mile transport rail' : 'Ready for pickup — code issued', actor_masked: 'system', audit_id: 'aud_o005', at: iso(4) },
      ],
    };
  }
  return getJson<PharmacyOrderDetail>(`/orders/${id}`);
}

// ════════════════════════════════════════════════════════════════════════════
// F · Pharmacovigilance / recall
// ════════════════════════════════════════════════════════════════════════════
const RECALLS: RecallRecord[] = [
  { id: 'rcl_2207', product_name: 'Cough Syrup (Batch X)', nafdac_reg_no: 'A4-3380', batch_no: 'BX-2026-014', pharmacy_masked: 'multiple•••', severity: 'high', status: 'open', reason: 'NAFDAC alert — possible contamination; batch quarantined', units_affected: 1_240, patients_notified: 318, created_at: iso(5) },
  { id: 'rcl_2208', product_name: 'Antihypertensive (Batch L)', nafdac_reg_no: 'A4-5521', batch_no: 'BL-2025-220', pharmacy_masked: 'Greenlife PH•••', severity: 'medium', status: 'investigating', reason: 'Reported sub-potency complaints under pharmacovigilance review', units_affected: 410, patients_notified: 96, created_at: iso(48) },
  { id: 'rcl_2205', product_name: 'Paediatric Suspension (Batch P)', nafdac_reg_no: 'A4-9001', batch_no: 'BP-2025-008', pharmacy_masked: 'MedPlus Wuse 2•••', severity: 'critical', status: 'resolved', reason: 'Labelling error — corrected and re-issued', units_affected: 60, patients_notified: 60, created_at: iso(400) },
];
export async function listRecalls(opts?: { status?: string; severity?: string; q?: string }): Promise<RecallRecord[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...RECALLS];
    if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
    if (opts?.severity) rows = rows.filter((r) => r.severity === opts.severity);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.product_name.toLowerCase().includes(q) || r.batch_no.toLowerCase().includes(q) || (r.nafdac_reg_no ?? '').toLowerCase().includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.severity) qs.set('severity', opts.severity);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<RecallRecord[]>(`/recalls${qs.toString() ? `?${qs}` : ''}`);
}
export async function createRecall(input: CreateRecallInput): Promise<CreateRecallResult> {
  if (USE_MOCK) {
    await delay();
    return { id: `rcl_${Math.random().toString(36).slice(2, 8)}`, status: 'open', audit_id: auditId(), message: `Recall opened for "${input.product_name}" batch ${input.batch_no} (${input.severity}). Affected batch quarantined; patient notification dispatched. Recorded to immutable audit (HL-12).` };
  }
  return sendJson<CreateRecallResult>('POST', '/recalls', input);
}

// ════════════════════════════════════════════════════════════════════════════
// G · Payouts (KYC-gated — HL-10)
// ════════════════════════════════════════════════════════════════════════════
const PAYOUTS: PayoutRecord[] = [
  { id: 'pay_5501', pharmacy_masked: 'HealthPlus Ikeja•••', kyc_tier: 'tier3', kyc_verified: true, collected_kobo: 18_400_000_00, fees_kobo: 1_288_000_00, net_payable_kobo: 17_112_000_00, payout_status: 'approved', aml_flag: false, created_at: dateStr(2) },
  { id: 'pay_5521', pharmacy_masked: 'QuickMeds•••', kyc_tier: 'tier0', kyc_verified: false, collected_kobo: 6_200_000_00, fees_kobo: 434_000_00, net_payable_kobo: 5_766_000_00, payout_status: 'kyc_hold', aml_flag: false, created_at: dateStr(1) },
  { id: 'pay_5540', pharmacy_masked: 'MedPlus Wuse 2•••', kyc_tier: 'tier2', kyc_verified: true, collected_kobo: 12_600_000_00, fees_kobo: 882_000_00, net_payable_kobo: 11_718_000_00, payout_status: 'paid', aml_flag: false, created_at: dateStr(10) },
  { id: 'pay_5560', pharmacy_masked: 'Greenlife PH•••', kyc_tier: 'tier1', kyc_verified: true, collected_kobo: 4_100_000_00, fees_kobo: 287_000_00, net_payable_kobo: 3_813_000_00, payout_status: 'pending', aml_flag: true, created_at: dateStr(1) },
];
export async function listPayouts(opts?: { payout_status?: string; q?: string }): Promise<PayoutRecord[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...PAYOUTS];
    if (opts?.payout_status) rows = rows.filter((r) => r.payout_status === opts.payout_status);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((r) => r.pharmacy_masked.toLowerCase().includes(q) || r.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.payout_status) qs.set('payout_status', opts.payout_status);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<PayoutRecord[]>(`/payouts${qs.toString() ? `?${qs}` : ''}`);
}
export async function decidePayout(id: string, decision: PayoutDecision, note?: string): Promise<PayoutDecisionResult> {
  if (USE_MOCK) {
    await delay();
    const p = PAYOUTS.find((x) => x.id === id);
    if (decision === 'approve' && p && !p.kyc_verified) {
      return { id, payout_status: 'kyc_hold', audit_id: auditId(), message: `Payout blocked — pharmacy ${id} KYC tier insufficient (HL-10). Payout stays fail-closed until KYC clears. Recorded to immutable audit (HL-12).` };
    }
    if (decision === 'approve' && p?.aml_flag) {
      return { id, payout_status: 'kyc_hold', audit_id: auditId(), message: `Payout held — AML flag on settlement requires clearance before release (HL-10). Recorded to immutable audit (HL-12).` };
    }
    return { id, payout_status: decision === 'approve' ? 'approved' : 'rejected', audit_id: auditId(), message: `Pharmacy ${id} payout ${decision === 'approve' ? 'approved' : 'rejected'}. KYC + AML gate (HL-10) passed. Recorded to immutable audit (HL-12).` };
  }
  return sendJson<PayoutDecisionResult>('POST', `/payouts/${id}/decision`, { decision, note });
}

// ════════════════════════════════════════════════════════════════════════════
// H · Reporting
// ════════════════════════════════════════════════════════════════════════════
const REPORTING: ReportingData = {
  generated_at: iso(0.2),
  period_label: 'Last 30 days',
  gmv_kobo: 392_660_000_00,
  net_revenue_kobo: 27_486_200_0,
  orders: 48_220,
  rx_orders: 13_900,
  otc_orders: 34_320,
  refund_rate: 0.011,
  avg_verify_minutes: 11,
  nafdac_block_rate: 0.034, // HL-5 catalog writes rejected
  controlled_blocked: 6, // HL-4
  recalls_issued: 3,
  payouts_kyc_hold: 5, // HL-10
  by_state: [
    { state: 'Lagos', orders: 22_180, gmv_kobo: 188_440_000_00, share_pct: 0.48 },
    { state: 'FCT (Abuja)', orders: 9_640, gmv_kobo: 86_380_000_00, share_pct: 0.22 },
    { state: 'Rivers', orders: 6_120, gmv_kobo: 47_120_000_00, share_pct: 0.12 },
    { state: 'Enugu', orders: 4_390, gmv_kobo: 35_710_000_00, share_pct: 0.09 },
    { state: 'Abia', orders: 3_010, gmv_kobo: 21_540_000_00, share_pct: 0.06 },
    { state: 'Others', orders: 2_880, gmv_kobo: 13_470_000_00, share_pct: 0.03 },
  ],
  monthly: Array.from({ length: 6 }).map((_, i) => {
    const m = new Date(Date.now() - (5 - i) * 30 * 86_400_000);
    const gmv = (260_000_000 + i * 26_000_000) * 100;
    return { month: m.toLocaleDateString('en-NG', { month: 'short', year: '2-digit' }), gmv_kobo: gmv, net_kobo: Math.round(gmv * 0.07), orders: 32_000 + i * 3_200 };
  }),
};
export async function getReporting(opts?: { period?: string }): Promise<ReportingData> {
  if (USE_MOCK) { await delay(); return { ...REPORTING, by_state: [...REPORTING.by_state], monthly: [...REPORTING.monthly] }; }
  const qs = new URLSearchParams();
  if (opts?.period) qs.set('period', opts.period);
  return getJson<ReportingData>(`/reporting${qs.toString() ? `?${qs}` : ''}`);
}
