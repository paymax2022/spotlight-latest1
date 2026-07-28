// ── Admin — Paymax Insurance control-plane service ───────────────────────────
// Mock by default (mirrors connect/referral admin services). Flip with
// NEXT_PUBLIC_INSURANCE_USE_MOCK=false to hit the live Go backend at
// /api/insurance/admin/*. RBAC: insurance.* gates wired on the sidebar.
// Money is BIGINT kobo (minor units) throughout. Underwriter always disclosed.

import { env } from '@/config/env';
import type {
  InsuranceDashboard,
  InsuranceProduct,
  InsuranceProductDetail,
  ProductUpsert,
  RoutingRule,
  SchemaField,
  PolicySummary,
  PolicyDetail,
  ClaimSummary,
  ClaimDetail,
  PremiumTransaction,
  CommissionEntry,
  ReconciliationBreak,
  BreakResolution,
  BreakStatus,
  RefundRequest,
  RefundDecision,
  RefundStatus,
  ProviderConfig,
  ProviderEvent,
  WebhookDelivery,
  WebhookReplayResult,
  ConsentAuditEntry,
  SweepsMonitor,
  ReportDefinition,
} from '@/types/insuranceAdmin';

const USE_MOCK = (process.env.NEXT_PUBLIC_INSURANCE_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function adminBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/insurance/admin');
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

const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
const dateStr = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

// NAICOM-licensed underwriters behind each aggregator (disclosed everywhere).
const UW_MYCOVER = 'AXA Mansard Insurance Plc';
const UW_MYCOVER_HEALTH = 'Hygeia HMO';
const UW_OCTAMILE = 'Leadway Assurance Company Ltd';
const UW_OCTAMILE_MOTOR = 'Cornerstone Insurance Plc';

// ════════════════════════════════════════════════════════════════════════════
// Dashboard
// ════════════════════════════════════════════════════════════════════════════
const DASHBOARD: InsuranceDashboard = {
  gwp_today_kobo: 3_184_500_00,
  gwp_30d_kobo: 84_920_300_00,
  policies_active: 41_882,
  policies_bound_today: 612,
  attach_rate: 0.27,
  claims_ratio: 0.41,
  claims_open: 138,
  claims_settled_30d: 1_204,
  premium_collected_30d_kobo: 84_920_300_00,
  commission_earned_30d_kobo: 11_839_840_00,
  reconciliation_breaks_open: 7,
  reconciliation_break_value_kobo: 2_410_500_00,
  refunds_pending: 14,
  renewals_due_7d: 389,
  provider_health: [
    { provider: 'mycover', underwriter: UW_MYCOVER, status: 'healthy', uptime_pct: 99.94, quote_p95_ms: 1820, webhook_lag_s: 3, open_breaks: 2 },
    { provider: 'octamile', underwriter: UW_OCTAMILE, status: 'degraded', uptime_pct: 98.71, quote_p95_ms: 4120, webhook_lag_s: 41, open_breaks: 5 },
  ],
  premium_vs_commission: Array.from({ length: 14 }).map((_, i) => ({
    date: dateStr(13 - i),
    premium_kobo: (2_400_000 + i * 92_000 + Math.round(Math.sin(i / 2) * 320_000)) * 100,
    commission_kobo: (330_000 + i * 12_000 + Math.round(Math.cos(i / 3) * 41_000)) * 100,
  })),
  activity: [
    { id: 'ev1', kind: 'reconciliation_break', label: 'Premium remittance mismatch — Octamile motor batch', ref: 'rec_5521', created_at: iso(0.5) },
    { id: 'ev2', kind: 'claim_settled', label: 'Motor fast-track claim settled ₦185,000.00 (Octamile)', ref: 'clm_8841', created_at: iso(1) },
    { id: 'ev3', kind: 'bind_succeeded', label: 'Device cover bound on purchase event (MyCover)', ref: 'pol_10231', created_at: iso(2) },
    { id: 'ev4', kind: 'bind_failed', label: 'Bind failed → premium auto-reversed (insufficient sum-insured)', ref: 'pol_10240', created_at: iso(3) },
    { id: 'ev5', kind: 'renewal_due', label: '389 micro-health policies entering renewal window', ref: 'sweep_renewal', created_at: iso(6) },
    { id: 'ev6', kind: 'commission_recorded', label: 'Commission recorded on SME package bind', ref: 'com_4410', created_at: iso(9) },
  ],
};
export async function getDashboard(): Promise<InsuranceDashboard> {
  if (USE_MOCK) { await delay(); return { ...DASHBOARD, provider_health: [...DASHBOARD.provider_health], premium_vs_commission: [...DASHBOARD.premium_vs_commission], activity: [...DASHBOARD.activity] }; }
  return getJson<InsuranceDashboard>('/dashboard');
}

// ════════════════════════════════════════════════════════════════════════════
// Catalog
// ════════════════════════════════════════════════════════════════════════════
const PRODUCTS: InsuranceProductDetail[] = [
  {
    code: 'WALLET-PROT-01', name: 'Wallet Protection (fraud cover)', product_line: 'wallet_protection',
    provider: 'mycover', underwriter: UW_MYCOVER, provider_product_code: 'MC-WALLET-2024', binding_mode: 'embedded',
    premium_model: 'recurring', required_kyc_tier: 1, sum_insured: { min_kobo: 50_000_00, max_kobo: 2_000_000_00, default_kobo: 500_000_00, step_kobo: 50_000_00 },
    base_premium_kobo: 50_000, commission_basis_pct: 12, active: true, version: 3, policies_active: 18_204,
    description: 'Covers unauthorised wallet transactions and account-takeover loss, bound on wallet funding.',
    required_fields: ['full_name', 'phone', 'bvn'], consent_version: 'NDPA-v2',
    history: [
      { version: 1, change: 'Initial publish', actor: 'admin@paymax', created_at: iso(4800) },
      { version: 2, change: 'Raised max sum insured to ₦2m', actor: 'admin@paymax', created_at: iso(2200) },
      { version: 3, change: 'Lowered required KYC tier to 1', actor: 'ops@paymax', created_at: iso(400) },
    ],
    updated_at: iso(400), created_at: iso(4800),
  },
  {
    code: 'HEALTH-MICRO-01', name: 'Micro-Health (HMO lite)', product_line: 'health',
    provider: 'mycover', underwriter: UW_MYCOVER_HEALTH, provider_product_code: 'MC-HEALTH-LITE', binding_mode: 'voluntary',
    premium_model: 'recurring', required_kyc_tier: 2, sum_insured: { min_kobo: 100_000_00, max_kobo: 5_000_000_00, default_kobo: 1_000_000_00, step_kobo: 100_000_00 },
    base_premium_kobo: 350_000, commission_basis_pct: 10, active: true, version: 2, policies_active: 6_410,
    description: 'Monthly micro-health plan with outpatient + limited inpatient cover via Hygeia HMO.',
    required_fields: ['full_name', 'dob', 'phone', 'nin', 'address'], consent_version: 'NDPA-v2',
    history: [
      { version: 1, change: 'Initial publish', actor: 'admin@paymax', created_at: iso(3600) },
      { version: 2, change: 'Added dependants field schema', actor: 'admin@paymax', created_at: iso(900) },
    ],
    updated_at: iso(900), created_at: iso(3600),
  },
  {
    code: 'DEVICE-01', name: 'Device / Gadget Protection', product_line: 'device',
    provider: 'mycover', underwriter: UW_MYCOVER, provider_product_code: 'MC-DEVICE-2024', binding_mode: 'embedded',
    premium_model: 'one_off', required_kyc_tier: 1, sum_insured: { min_kobo: 50_000_00, max_kobo: 3_000_000_00, default_kobo: 400_000_00 },
    base_premium_kobo: 120_000, commission_basis_pct: 15, active: true, version: 1, policies_active: 9_120,
    description: 'Accidental damage + theft cover bound on device purchase.',
    required_fields: ['device_imei', 'device_value', 'purchase_ref'], consent_version: 'NDPA-v2',
    history: [{ version: 1, change: 'Initial publish', actor: 'admin@paymax', created_at: iso(1800) }],
    updated_at: iso(1800), created_at: iso(1800),
  },
  {
    code: 'MOTOR-COMP-01', name: 'Motor Comprehensive', product_line: 'motor',
    provider: 'octamile', underwriter: UW_OCTAMILE_MOTOR, provider_product_code: 'OCT-MOTOR-COMP', binding_mode: 'voluntary',
    premium_model: 'recurring', required_kyc_tier: 2, sum_insured: { min_kobo: 1_000_000_00, max_kobo: 50_000_000_00, default_kobo: 5_000_000_00, step_kobo: 500_000_00 },
    base_premium_kobo: 4_500_000, commission_basis_pct: 8, active: true, version: 4, policies_active: 3_188,
    description: 'Comprehensive motor cover with Octamile fast-track claims (≤60 min target).',
    required_fields: ['vehicle_reg', 'vehicle_value', 'chassis_no', 'full_name', 'nin'], consent_version: 'NDPA-v2',
    history: [
      { version: 1, change: 'Initial publish', actor: 'admin@paymax', created_at: iso(5200) },
      { version: 4, change: 'Routing moved to Cornerstone underwriter', actor: 'admin@paymax', created_at: iso(300) },
    ],
    updated_at: iso(300), created_at: iso(5200),
  },
  {
    code: 'PARCEL-01', name: 'Parcel Delivery Protection', product_line: 'parcel',
    provider: 'octamile', underwriter: UW_OCTAMILE, provider_product_code: 'OCT-PARCEL', binding_mode: 'embedded',
    premium_model: 'per_event', required_kyc_tier: 0, sum_insured: { min_kobo: 5_000_00, max_kobo: 500_000_00, default_kobo: 50_000_00 },
    base_premium_kobo: 5_000, commission_basis_pct: 18, active: true, version: 1, policies_active: 2_940,
    description: 'Per-parcel loss/damage cover bound on parcel booking (idempotent on source event).',
    required_fields: ['parcel_value', 'origin', 'destination'], consent_version: 'NDPA-v2',
    history: [{ version: 1, change: 'Initial publish', actor: 'admin@paymax', created_at: iso(2400) }],
    updated_at: iso(2400), created_at: iso(2400),
  },
  {
    code: 'CREDIT-LIFE-01', name: 'Credit-Life (loan cover)', product_line: 'credit_life',
    provider: 'mycover', underwriter: UW_MYCOVER, provider_product_code: 'MC-CREDITLIFE', binding_mode: 'embedded',
    premium_model: 'one_off', required_kyc_tier: 2, sum_insured: { min_kobo: 100_000_00, max_kobo: 10_000_000_00, default_kobo: 1_000_000_00 },
    base_premium_kobo: 90_000, commission_basis_pct: 11, active: false, version: 2, policies_active: 0,
    description: 'Outstanding-loan settlement on death/disability, bound on loan disbursement.',
    required_fields: ['loan_ref', 'loan_amount', 'full_name', 'dob', 'bvn'], consent_version: 'NDPA-v2',
    history: [
      { version: 1, change: 'Initial publish', actor: 'admin@paymax', created_at: iso(3000) },
      { version: 2, change: 'Deactivated pending underwriter re-contract (D-1)', actor: 'admin@paymax', created_at: iso(120) },
    ],
    updated_at: iso(120), created_at: iso(3000),
  },
];
export async function listProducts(opts?: { provider?: string; active?: boolean; q?: string }): Promise<InsuranceProduct[]> {
  if (USE_MOCK) {
    await delay();
    let r = PRODUCTS.map(stripDetail);
    if (opts?.provider) r = r.filter((p) => p.provider === opts.provider);
    if (opts?.active !== undefined) r = r.filter((p) => p.active === opts.active);
    if (opts?.q) { const s = opts.q.toLowerCase(); r = r.filter((p) => p.name.toLowerCase().includes(s) || p.code.toLowerCase().includes(s) || p.product_line.includes(s)); }
    return r;
  }
  const qs = new URLSearchParams();
  if (opts?.provider) qs.set('provider', opts.provider);
  if (opts?.active !== undefined) qs.set('active', String(opts.active));
  if (opts?.q) qs.set('q', opts.q);
  const s = qs.toString();
  return getJson<InsuranceProduct[]>(`/products${s ? `?${s}` : ''}`);
}
function stripDetail(p: InsuranceProductDetail): InsuranceProduct {
  const { description, required_fields, consent_version, history, ...rest } = p;
  void description; void required_fields; void consent_version; void history;
  return rest;
}
export async function getProduct(code: string): Promise<InsuranceProductDetail> {
  if (USE_MOCK) { await delay(); return { ...(PRODUCTS.find((p) => p.code === code) ?? PRODUCTS[0]) }; }
  return getJson<InsuranceProductDetail>(`/products/${encodeURIComponent(code)}`);
}
export async function upsertProduct(payload: ProductUpsert): Promise<InsuranceProductDetail> {
  if (USE_MOCK) {
    await delay();
    const base = PRODUCTS.find((p) => p.code === payload.code) ?? PRODUCTS[0];
    return { ...base, ...payload, version: (base.version ?? 0) + 1, updated_at: new Date().toISOString() } as InsuranceProductDetail;
  }
  return sendJson<InsuranceProductDetail>('PUT', `/products/${encodeURIComponent(payload.code)}`, payload);
}

// ── Routing ──────────────────────────────────────────────────────────────────
const ROUTING: RoutingRule[] = [
  { id: 'rt_1', product_line: 'wallet_protection', provider: 'mycover', underwriter: UW_MYCOVER, binding_trigger: 'wallet_funded', enabled: true, priority: 1, updated_at: iso(400) },
  { id: 'rt_2', product_line: 'health', provider: 'mycover', underwriter: UW_MYCOVER_HEALTH, binding_trigger: 'opt_in', enabled: true, priority: 1, updated_at: iso(900) },
  { id: 'rt_3', product_line: 'device', provider: 'mycover', underwriter: UW_MYCOVER, binding_trigger: 'device_purchased', enabled: true, priority: 1, updated_at: iso(1800) },
  { id: 'rt_4', product_line: 'credit_life', provider: 'mycover', underwriter: UW_MYCOVER, binding_trigger: 'loan_disbursed', enabled: false, priority: 1, updated_at: iso(120) },
  { id: 'rt_5', product_line: 'motor', provider: 'octamile', underwriter: UW_OCTAMILE_MOTOR, binding_trigger: 'vehicle_onboarded', enabled: true, priority: 1, updated_at: iso(300) },
  { id: 'rt_6', product_line: 'parcel', provider: 'octamile', underwriter: UW_OCTAMILE, binding_trigger: 'parcel_booked', enabled: true, priority: 1, updated_at: iso(2400) },
  { id: 'rt_7', product_line: 'ride_hailing', provider: 'octamile', underwriter: UW_OCTAMILE, binding_trigger: 'trip_start', enabled: true, priority: 1, updated_at: iso(600) },
  { id: 'rt_8', product_line: 'git', provider: 'octamile', underwriter: UW_OCTAMILE, binding_trigger: 'shipment_created', enabled: true, priority: 1, updated_at: iso(700) },
];
export async function getRouting(): Promise<RoutingRule[]> {
  if (USE_MOCK) { await delay(); return ROUTING.map((r) => ({ ...r })); }
  return getJson<RoutingRule[]>('/routing');
}
export async function updateRouting(rules: RoutingRule[]): Promise<RoutingRule[]> {
  if (USE_MOCK) { await delay(); return rules.map((r) => ({ ...r, updated_at: new Date().toISOString() })); }
  return sendJson<RoutingRule[]>('PUT', '/routing', { rules });
}

// ── Field schema ─────────────────────────────────────────────────────────────
const SCHEMA: SchemaField[] = [
  { key: 'full_name', label: 'Full name', type: 'string', required: true, pii: true, product_lines: ['wallet_protection', 'health', 'motor', 'credit_life'] },
  { key: 'dob', label: 'Date of birth', type: 'date', required: true, pii: true, product_lines: ['health', 'credit_life'] },
  { key: 'phone', label: 'Phone number', type: 'string', required: true, pii: true, product_lines: ['wallet_protection', 'health'] },
  { key: 'bvn', label: 'BVN', type: 'string', required: true, pii: true, product_lines: ['wallet_protection', 'credit_life'] },
  { key: 'nin', label: 'NIN', type: 'string', required: true, pii: true, product_lines: ['health', 'motor'] },
  { key: 'address', label: 'Residential address', type: 'string', required: false, pii: true, product_lines: ['health'] },
  { key: 'device_imei', label: 'Device IMEI', type: 'string', required: true, pii: false, product_lines: ['device'] },
  { key: 'device_value', label: 'Device value (kobo)', type: 'number', required: true, pii: false, product_lines: ['device'] },
  { key: 'vehicle_reg', label: 'Vehicle registration', type: 'string', required: true, pii: false, product_lines: ['motor'] },
  { key: 'parcel_value', label: 'Parcel value (kobo)', type: 'number', required: true, pii: false, product_lines: ['parcel', 'git'] },
];
export async function getSchema(): Promise<SchemaField[]> {
  if (USE_MOCK) { await delay(); return SCHEMA.map((f) => ({ ...f, product_lines: [...f.product_lines] })); }
  return getJson<SchemaField[]>('/schema');
}
export async function updateSchema(fields: SchemaField[]): Promise<SchemaField[]> {
  if (USE_MOCK) { await delay(); return fields.map((f) => ({ ...f })); }
  return sendJson<SchemaField[]>('PUT', '/schema', { fields });
}

// ════════════════════════════════════════════════════════════════════════════
// Policies
// ════════════════════════════════════════════════════════════════════════════
const POLICIES: PolicyDetail[] = [
  {
    id: 'pol_10231', provider_policy_ref: 'MC-POL-88412', policyholder_masked: 'Ada O••••', policyholder_user_id: 'usr_a',
    product_code: 'DEVICE-01', product_name: 'Device / Gadget Protection', provider: 'mycover', underwriter: UW_MYCOVER,
    binding_mode: 'embedded', state: 'active', sum_insured_kobo: 400_000_00, premium_kobo: 120_000,
    effective_at: iso(48), expires_at: iso(-8736), created_at: iso(48),
    capability_id: 'cap_dev_1', source_event_id: 'evt_purchase_551', currency: 'NGN', version: 2,
    beneficiaries: [], premium_transactions: [
      { id: 'ptx_1', reference: 'PRM-77120', amount_kobo: 120_000, direction: 'DEBIT', status: 'settled', wallet_ledger_ref: 'led_991', created_at: iso(48) },
    ],
    commission: { amount_kobo: 18_000, basis: '15% of premium', revenue_ledger_ref: 'rev_410', reconciled: true },
    consent: { version: 'NDPA-v2', granted_at: iso(48), scope: 'device_imei, device_value' },
    timeline: [
      { at: iso(48.2), state: 'quoted', actor: 'system', note: 'Embedded quote on purchase event' },
      { at: iso(48.1), state: 'pending_payment', actor: 'system' },
      { at: iso(48.05), state: 'binding', actor: 'octamile_gateway', note: 'Premium held' },
      { at: iso(48), state: 'active', actor: 'mycover', note: 'provider_policy_ref MC-POL-88412 stored' },
    ],
  },
  {
    id: 'pol_10240', provider_policy_ref: 'MC-POL-88420', policyholder_masked: 'Tunde A••••', policyholder_user_id: 'usr_b',
    product_code: 'WALLET-PROT-01', product_name: 'Wallet Protection (fraud cover)', provider: 'mycover', underwriter: UW_MYCOVER,
    binding_mode: 'embedded', state: 'bind_failed', sum_insured_kobo: 500_000_00, premium_kobo: 50_000,
    effective_at: null, expires_at: null, created_at: iso(3),
    capability_id: 'cap_wal_2', source_event_id: 'evt_fund_882', currency: 'NGN', version: 1,
    beneficiaries: [], premium_transactions: [
      { id: 'ptx_2', reference: 'PRM-77140', amount_kobo: 50_000, direction: 'DEBIT', status: 'reversed', wallet_ledger_ref: 'led_998', created_at: iso(3) },
      { id: 'ptx_2r', reference: 'PRM-77140-REV', amount_kobo: 50_000, direction: 'CREDIT', status: 'settled', wallet_ledger_ref: 'led_998r', created_at: iso(3) },
    ],
    commission: null,
    consent: { version: 'NDPA-v2', granted_at: iso(3), scope: 'bvn' },
    timeline: [
      { at: iso(3.1), state: 'binding', actor: 'mycover_gateway', note: 'Premium held' },
      { at: iso(3.05), state: 'bind_failed', actor: 'mycover', note: 'Sum insured below product minimum' },
      { at: iso(3), state: 'void', actor: 'system', note: 'Premium auto-reversed (mandatory invariant)' },
    ],
  },
  {
    id: 'pol_10300', provider_policy_ref: 'OCT-POL-33112', policyholder_masked: 'Zara M••••', policyholder_user_id: 'usr_c',
    product_code: 'MOTOR-COMP-01', product_name: 'Motor Comprehensive', provider: 'octamile', underwriter: UW_OCTAMILE_MOTOR,
    binding_mode: 'voluntary', state: 'active', sum_insured_kobo: 5_000_000_00, premium_kobo: 4_500_000,
    effective_at: iso(720), expires_at: iso(-8016), created_at: iso(720),
    capability_id: 'cap_motor_3', source_event_id: null, currency: 'NGN', version: 1,
    beneficiaries: [], premium_transactions: [
      { id: 'ptx_3', reference: 'PRM-71001', amount_kobo: 4_500_000, direction: 'DEBIT', status: 'settled', wallet_ledger_ref: 'led_700', created_at: iso(720) },
    ],
    commission: { amount_kobo: 360_000, basis: '8% of premium', revenue_ledger_ref: 'rev_700', reconciled: false },
    consent: { version: 'NDPA-v2', granted_at: iso(720), scope: 'vehicle_reg, chassis_no, nin' },
    timeline: [
      { at: iso(720.2), state: 'quoted', actor: 'agent_44' },
      { at: iso(720.1), state: 'pending_payment', actor: 'agent_44' },
      { at: iso(720), state: 'active', actor: 'octamile', note: 'provider_policy_ref OCT-POL-33112 stored' },
    ],
  },
  {
    id: 'pol_10355', provider_policy_ref: 'MC-POL-90011', policyholder_masked: 'Chidi N••••', policyholder_user_id: 'usr_d',
    product_code: 'HEALTH-MICRO-01', product_name: 'Micro-Health (HMO lite)', provider: 'mycover', underwriter: UW_MYCOVER_HEALTH,
    binding_mode: 'voluntary', state: 'renewal_due', sum_insured_kobo: 1_000_000_00, premium_kobo: 350_000,
    effective_at: iso(8016), expires_at: iso(72), created_at: iso(8016),
    capability_id: 'cap_hlth_4', source_event_id: null, currency: 'NGN', version: 3,
    beneficiaries: [{ id: 'ben_1', name_masked: 'Ngozi N••••', relationship: 'spouse', share_pct: 100 }],
    premium_transactions: [
      { id: 'ptx_4', reference: 'PRM-60010', amount_kobo: 350_000, direction: 'DEBIT', status: 'settled', wallet_ledger_ref: 'led_600', created_at: iso(744) },
    ],
    commission: { amount_kobo: 35_000, basis: '10% of premium', revenue_ledger_ref: 'rev_600', reconciled: true },
    consent: { version: 'NDPA-v2', granted_at: iso(8016), scope: 'full_name, dob, nin, address' },
    timeline: [
      { at: iso(8016), state: 'active', actor: 'mycover' },
      { at: iso(72), state: 'renewal_due', actor: 'system', note: 'Renewal sweep flagged — expires in 72h' },
    ],
  },
  {
    id: 'pol_10380', provider_policy_ref: 'OCT-POL-33880', policyholder_masked: 'Fave K••••', policyholder_user_id: 'usr_e',
    product_code: 'PARCEL-01', product_name: 'Parcel Delivery Protection', provider: 'octamile', underwriter: UW_OCTAMILE,
    binding_mode: 'embedded', state: 'expired', sum_insured_kobo: 50_000_00, premium_kobo: 5_000,
    effective_at: iso(200), expires_at: iso(8), created_at: iso(200),
    capability_id: 'cap_parcel_5', source_event_id: 'evt_parcel_9912', currency: 'NGN', version: 1,
    beneficiaries: [], premium_transactions: [
      { id: 'ptx_5', reference: 'PRM-55001', amount_kobo: 5_000, direction: 'DEBIT', status: 'settled', wallet_ledger_ref: 'led_550', created_at: iso(200) },
    ],
    commission: { amount_kobo: 900, basis: '18% of premium', revenue_ledger_ref: 'rev_550', reconciled: true },
    consent: { version: 'NDPA-v2', granted_at: iso(200), scope: 'parcel_value, origin, destination' },
    timeline: [
      { at: iso(200), state: 'active', actor: 'octamile' },
      { at: iso(8), state: 'expired', actor: 'system', note: 'Per-parcel term ended' },
    ],
  },
];
export async function listPolicies(opts?: { state?: string; provider?: string; product_code?: string; q?: string }): Promise<PolicySummary[]> {
  if (USE_MOCK) {
    await delay();
    let r = POLICIES.map(stripPolicy);
    if (opts?.state) r = r.filter((p) => p.state === opts.state);
    if (opts?.provider) r = r.filter((p) => p.provider === opts.provider);
    if (opts?.product_code) r = r.filter((p) => p.product_code === opts.product_code);
    if (opts?.q) { const s = opts.q.toLowerCase(); r = r.filter((p) => p.provider_policy_ref.toLowerCase().includes(s) || p.policyholder_masked.toLowerCase().includes(s) || p.id.includes(s) || p.policyholder_user_id.includes(s)); }
    return r;
  }
  const qs = new URLSearchParams();
  if (opts?.state) qs.set('state', opts.state);
  if (opts?.provider) qs.set('provider', opts.provider);
  if (opts?.product_code) qs.set('product_code', opts.product_code);
  if (opts?.q) qs.set('q', opts.q);
  const s = qs.toString();
  return getJson<PolicySummary[]>(`/policies${s ? `?${s}` : ''}`);
}
function stripPolicy(p: PolicyDetail): PolicySummary {
  const { capability_id, source_event_id, currency, version, beneficiaries, premium_transactions, commission, consent, timeline, ...rest } = p;
  void capability_id; void source_event_id; void currency; void version; void beneficiaries; void premium_transactions; void commission; void consent; void timeline;
  return rest;
}
export async function getPolicy(id: string): Promise<PolicyDetail> {
  if (USE_MOCK) { await delay(); return { ...(POLICIES.find((p) => p.id === id) ?? POLICIES[0]) }; }
  return getJson<PolicyDetail>(`/policies/${encodeURIComponent(id)}`);
}

// ════════════════════════════════════════════════════════════════════════════
// Claims
// ════════════════════════════════════════════════════════════════════════════
const CLAIMS: ClaimDetail[] = [
  {
    id: 'clm_8841', provider_claim_ref: 'OCT-CLM-22011', policy_id: 'pol_10300', product_name: 'Motor Comprehensive',
    provider: 'octamile', underwriter: UW_OCTAMILE_MOTOR, claimant_masked: 'Zara M••••', state: 'settled',
    claimed_amount_kobo: 185_000_00, approved_amount_kobo: 185_000_00, loss_event_at: iso(30), reported_at: iso(28),
    payout_ledger_ref: 'led_pay_881', sla_target_minutes: 60, created_at: iso(28),
    evidence: [
      { id: 'ev_1', kind: 'photo', label: 'Damage photo (front bumper)', signed_url_ref: 'vault://claim/clm_8841/p1', uploaded_at: iso(28) },
      { id: 'ev_2', kind: 'document', label: 'Police report', signed_url_ref: 'vault://claim/clm_8841/d1', uploaded_at: iso(27) },
    ],
    timeline: [
      { at: iso(28), state: 'fnol_submitted', actor: 'usr_c' },
      { at: iso(27.5), state: 'under_assessment', actor: 'octamile' },
      { at: iso(27.2), state: 'approved', actor: 'octamile', note: 'Fast-track motor approval' },
      { at: iso(27.1), state: 'payout_pending', actor: 'octamile' },
      { at: iso(27), state: 'settled', actor: 'system', note: 'Payout credited to wallet led_pay_881' },
    ],
    notes: 'Octamile fast-track — settled within SLA.',
  },
  {
    id: 'clm_8855', provider_claim_ref: 'MC-CLM-44120', policy_id: 'pol_10355', product_name: 'Micro-Health (HMO lite)',
    provider: 'mycover', underwriter: UW_MYCOVER_HEALTH, claimant_masked: 'Chidi N••••', state: 'needs_more_info',
    claimed_amount_kobo: 90_000_00, approved_amount_kobo: 0, loss_event_at: iso(20), reported_at: iso(18),
    payout_ledger_ref: null, sla_target_minutes: null, created_at: iso(18),
    evidence: [
      { id: 'ev_3', kind: 'document', label: 'Hospital invoice', signed_url_ref: 'vault://claim/clm_8855/d1', uploaded_at: iso(18) },
    ],
    timeline: [
      { at: iso(18), state: 'fnol_submitted', actor: 'usr_d' },
      { at: iso(16), state: 'under_assessment', actor: 'mycover' },
      { at: iso(14), state: 'needs_more_info', actor: 'mycover', note: 'Diagnosis report requested' },
    ],
    notes: 'Awaiting diagnosis report from claimant.',
  },
  {
    id: 'clm_8870', provider_claim_ref: 'MC-CLM-44190', policy_id: 'pol_10231', product_name: 'Device / Gadget Protection',
    provider: 'mycover', underwriter: UW_MYCOVER, claimant_masked: 'Ada O••••', state: 'under_assessment',
    claimed_amount_kobo: 400_000_00, approved_amount_kobo: 0, loss_event_at: iso(10), reported_at: iso(9),
    payout_ledger_ref: null, sla_target_minutes: null, created_at: iso(9),
    evidence: [
      { id: 'ev_4', kind: 'photo', label: 'Cracked screen photo', signed_url_ref: 'vault://claim/clm_8870/p1', uploaded_at: iso(9) },
      { id: 'ev_5', kind: 'document', label: 'Purchase receipt', signed_url_ref: 'vault://claim/clm_8870/d1', uploaded_at: iso(9) },
    ],
    timeline: [
      { at: iso(9), state: 'fnol_submitted', actor: 'usr_a' },
      { at: iso(7), state: 'under_assessment', actor: 'mycover' },
    ],
    notes: null,
  },
  {
    id: 'clm_8890', provider_claim_ref: 'OCT-CLM-22099', policy_id: 'pol_10380', product_name: 'Parcel Delivery Protection',
    provider: 'octamile', underwriter: UW_OCTAMILE, claimant_masked: 'Fave K••••', state: 'rejected',
    claimed_amount_kobo: 50_000_00, approved_amount_kobo: 0, loss_event_at: iso(60), reported_at: iso(50),
    payout_ledger_ref: null, sla_target_minutes: null, created_at: iso(50),
    evidence: [],
    timeline: [
      { at: iso(50), state: 'fnol_submitted', actor: 'usr_e' },
      { at: iso(48), state: 'under_assessment', actor: 'octamile' },
      { at: iso(44), state: 'rejected', actor: 'octamile', note: 'Reported after policy term expired' },
    ],
    notes: 'Loss event outside cover window.',
  },
];
export async function listClaims(opts?: { state?: string; provider?: string; q?: string }): Promise<ClaimSummary[]> {
  if (USE_MOCK) {
    await delay();
    let r = CLAIMS.map(stripClaim);
    if (opts?.state) r = r.filter((c) => c.state === opts.state);
    if (opts?.provider) r = r.filter((c) => c.provider === opts.provider);
    if (opts?.q) { const s = opts.q.toLowerCase(); r = r.filter((c) => c.provider_claim_ref.toLowerCase().includes(s) || c.claimant_masked.toLowerCase().includes(s) || c.id.includes(s) || c.policy_id.includes(s)); }
    return r;
  }
  const qs = new URLSearchParams();
  if (opts?.state) qs.set('state', opts.state);
  if (opts?.provider) qs.set('provider', opts.provider);
  if (opts?.q) qs.set('q', opts.q);
  const s = qs.toString();
  return getJson<ClaimSummary[]>(`/claims${s ? `?${s}` : ''}`);
}
function stripClaim(c: ClaimDetail): ClaimSummary {
  const { underwriter, payout_ledger_ref, sla_target_minutes, evidence, timeline, notes, ...rest } = c;
  void underwriter; void payout_ledger_ref; void sla_target_minutes; void evidence; void timeline; void notes;
  return rest;
}
export async function getClaim(id: string): Promise<ClaimDetail> {
  if (USE_MOCK) { await delay(); return { ...(CLAIMS.find((c) => c.id === id) ?? CLAIMS[0]) }; }
  return getJson<ClaimDetail>(`/claims/${encodeURIComponent(id)}`);
}

// ════════════════════════════════════════════════════════════════════════════
// Finance — premiums / commission / reconciliation / refunds
// ════════════════════════════════════════════════════════════════════════════
const PREMIUMS: PremiumTransaction[] = [
  { id: 'ptx_1', reference: 'PRM-77120', policy_id: 'pol_10231', provider: 'mycover', amount_kobo: 120_000, direction: 'DEBIT', status: 'settled', idempotency_key: 'idem-77120', provider_remittance_ref: 'MC-RMT-9001', reconciled: true, created_at: iso(48) },
  { id: 'ptx_3', reference: 'PRM-71001', policy_id: 'pol_10300', provider: 'octamile', amount_kobo: 4_500_000, direction: 'DEBIT', status: 'settled', idempotency_key: 'idem-71001', provider_remittance_ref: null, reconciled: false, created_at: iso(720) },
  { id: 'ptx_2', reference: 'PRM-77140', policy_id: 'pol_10240', provider: 'mycover', amount_kobo: 50_000, direction: 'DEBIT', status: 'reversed', idempotency_key: 'idem-77140', provider_remittance_ref: null, reconciled: true, created_at: iso(3) },
  { id: 'ptx_2r', reference: 'PRM-77140-REV', policy_id: 'pol_10240', provider: 'mycover', amount_kobo: 50_000, direction: 'CREDIT', status: 'settled', idempotency_key: 'idem-77140-rev', provider_remittance_ref: null, reconciled: true, created_at: iso(3) },
  { id: 'ptx_4', reference: 'PRM-60010', policy_id: 'pol_10355', provider: 'mycover', amount_kobo: 350_000, direction: 'DEBIT', status: 'settled', idempotency_key: 'idem-60010', provider_remittance_ref: 'MC-RMT-8800', reconciled: true, created_at: iso(744) },
  { id: 'ptx_5', reference: 'PRM-55001', policy_id: 'pol_10380', provider: 'octamile', amount_kobo: 5_000, direction: 'DEBIT', status: 'settled', idempotency_key: 'idem-55001', provider_remittance_ref: 'OCT-RMT-1200', reconciled: true, created_at: iso(200) },
];
export async function listPremiums(opts?: { provider?: string; status?: string; reconciled?: boolean }): Promise<PremiumTransaction[]> {
  if (USE_MOCK) {
    await delay();
    let r = PREMIUMS.map((p) => ({ ...p }));
    if (opts?.provider) r = r.filter((p) => p.provider === opts.provider);
    if (opts?.status) r = r.filter((p) => p.status === opts.status);
    if (opts?.reconciled !== undefined) r = r.filter((p) => p.reconciled === opts.reconciled);
    return r;
  }
  const qs = new URLSearchParams();
  if (opts?.provider) qs.set('provider', opts.provider);
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.reconciled !== undefined) qs.set('reconciled', String(opts.reconciled));
  const s = qs.toString();
  return getJson<PremiumTransaction[]>(`/premiums${s ? `?${s}` : ''}`);
}

const COMMISSION: CommissionEntry[] = [
  { id: 'com_410', policy_id: 'pol_10231', premium_transaction_id: 'ptx_1', provider: 'mycover', commission_amount_kobo: 18_000, commission_basis: '15% of premium', revenue_ledger_ref: 'rev_410', reconciled: true, reversed: false, created_at: iso(48) },
  { id: 'com_700', policy_id: 'pol_10300', premium_transaction_id: 'ptx_3', provider: 'octamile', commission_amount_kobo: 360_000, commission_basis: '8% of premium', revenue_ledger_ref: 'rev_700', reconciled: false, reversed: false, created_at: iso(720) },
  { id: 'com_600', policy_id: 'pol_10355', premium_transaction_id: 'ptx_4', provider: 'mycover', commission_amount_kobo: 35_000, commission_basis: '10% of premium', revenue_ledger_ref: 'rev_600', reconciled: true, reversed: false, created_at: iso(744) },
  { id: 'com_550', policy_id: 'pol_10380', premium_transaction_id: 'ptx_5', provider: 'octamile', commission_amount_kobo: 900, commission_basis: '18% of premium', revenue_ledger_ref: 'rev_550', reconciled: true, reversed: false, created_at: iso(200) },
  { id: 'com_540', policy_id: 'pol_10240', premium_transaction_id: 'ptx_2', provider: 'mycover', commission_amount_kobo: 7_500, commission_basis: '15% of premium', revenue_ledger_ref: 'rev_540', reconciled: false, reversed: true, created_at: iso(3) },
];
export async function listCommission(opts?: { provider?: string; reconciled?: boolean }): Promise<CommissionEntry[]> {
  if (USE_MOCK) {
    await delay();
    let r = COMMISSION.map((c) => ({ ...c }));
    if (opts?.provider) r = r.filter((c) => c.provider === opts.provider);
    if (opts?.reconciled !== undefined) r = r.filter((c) => c.reconciled === opts.reconciled);
    return r;
  }
  const qs = new URLSearchParams();
  if (opts?.provider) qs.set('provider', opts.provider);
  if (opts?.reconciled !== undefined) qs.set('reconciled', String(opts.reconciled));
  const s = qs.toString();
  return getJson<CommissionEntry[]>(`/commission${s ? `?${s}` : ''}`);
}

const BREAKS: ReconciliationBreak[] = [
  { id: 'rec_5521', provider: 'octamile', break_type: 'premium', policy_id: 'pol_10300', paymax_amount_kobo: 4_500_000, provider_amount_kobo: 4_410_000, delta_kobo: 90_000, status: 'open', age_hours: 80, sla_breached: true, detail: 'Provider remittance short by ₦900 vs Paymax debit', created_at: iso(80) },
  { id: 'rec_5530', provider: 'octamile', break_type: 'commission', policy_id: 'pol_10300', paymax_amount_kobo: 360_000, provider_amount_kobo: 352_800, delta_kobo: 7_200, status: 'investigating', age_hours: 36, sla_breached: false, detail: 'Commission basis mismatch (8.0% vs 7.8%)', created_at: iso(36) },
  { id: 'rec_5540', provider: 'mycover', break_type: 'premium', policy_id: null, paymax_amount_kobo: 0, provider_amount_kobo: 120_000, delta_kobo: 120_000, status: 'open', age_hours: 12, sla_breached: false, detail: 'Provider statement line with no matching Paymax debit', created_at: iso(12) },
  { id: 'rec_5500', provider: 'mycover', break_type: 'claim_payout', policy_id: 'pol_10231', paymax_amount_kobo: 185_000_00, provider_amount_kobo: 185_000_00, delta_kobo: 0, status: 'resolved', age_hours: 200, sla_breached: false, detail: 'Resolved — timing difference cleared on next statement', created_at: iso(200) },
];
export async function listReconciliation(opts?: { status?: string; provider?: string; break_type?: string }): Promise<ReconciliationBreak[]> {
  if (USE_MOCK) {
    await delay();
    let r = BREAKS.map((b) => ({ ...b }));
    if (opts?.status) r = r.filter((b) => b.status === opts.status);
    if (opts?.provider) r = r.filter((b) => b.provider === opts.provider);
    if (opts?.break_type) r = r.filter((b) => b.break_type === opts.break_type);
    return r;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.provider) qs.set('provider', opts.provider);
  if (opts?.break_type) qs.set('break_type', opts.break_type);
  const s = qs.toString();
  return getJson<ReconciliationBreak[]>(`/reconciliation${s ? `?${s}` : ''}`);
}
export async function resolveBreak(id: string, payload: { resolution: string; status: BreakStatus; note?: string }): Promise<BreakResolution> {
  if (USE_MOCK) { await delay(); return { id, status: payload.status, resolved_at: new Date().toISOString() }; }
  return sendJson<BreakResolution>('POST', `/reconciliation/${encodeURIComponent(id)}/resolve`, payload);
}

const REFUNDS: RefundRequest[] = [
  { id: 'ref_3301', reference: 'RFD-3301', policy_id: 'pol_10240', provider: 'mycover', reason: 'bind_failed', amount_kobo: 50_000, status: 'paid', policyholder_masked: 'Tunde A••••', requested_at: iso(3) },
  { id: 'ref_3302', reference: 'RFD-3302', policy_id: 'pol_10300', provider: 'octamile', reason: 'cooling_off', amount_kobo: 4_500_000, status: 'pending', policyholder_masked: 'Zara M••••', requested_at: iso(5) },
  { id: 'ref_3303', reference: 'RFD-3303', policy_id: 'pol_10355', provider: 'mycover', reason: 'cancellation', amount_kobo: 175_000, status: 'pending', policyholder_masked: 'Chidi N••••', requested_at: iso(20) },
  { id: 'ref_3304', reference: 'RFD-3304', policy_id: 'pol_10380', provider: 'octamile', reason: 'duplicate', amount_kobo: 5_000, status: 'rejected', policyholder_masked: 'Fave K••••', requested_at: iso(60) },
];
export async function listRefunds(opts?: { status?: string; provider?: string }): Promise<RefundRequest[]> {
  if (USE_MOCK) {
    await delay();
    let r = REFUNDS.map((x) => ({ ...x }));
    if (opts?.status) r = r.filter((x) => x.status === opts.status);
    if (opts?.provider) r = r.filter((x) => x.provider === opts.provider);
    return r;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.provider) qs.set('provider', opts.provider);
  const s = qs.toString();
  return getJson<RefundRequest[]>(`/refunds${s ? `?${s}` : ''}`);
}
export async function decideRefund(id: string, payload: { decision: RefundStatus; note?: string }): Promise<RefundDecision> {
  if (USE_MOCK) { await delay(); return { id, status: payload.decision, decided_at: new Date().toISOString() }; }
  return sendJson<RefundDecision>('POST', `/refunds/${encodeURIComponent(id)}/decide`, payload);
}

// ════════════════════════════════════════════════════════════════════════════
// Providers
// ════════════════════════════════════════════════════════════════════════════
const PROVIDERS: ProviderConfig[] = [
  {
    provider: 'mycover', display_name: 'MyCover.ai', underwriters: [UW_MYCOVER, UW_MYCOVER_HEALTH],
    base_url: 'https://api.mycover.ai/v1', api_key_masked: 'mc_live_••••••••4f2a', webhook_secret_masked: 'whsec_••••••a91c',
    webhook_url: 'https://api.paymax.ng/api/insurance/webhooks/mycover', signature_verified: true, sandbox: false,
    sla_quote_p95_ms: 3000, sla_claim_settle_minutes: 1440, status: 'healthy',
    product_lines: ['wallet_protection', 'health', 'personal_accident', 'credit_life', 'device', 'sme', 'spotlight_event'], updated_at: iso(400),
  },
  {
    provider: 'octamile', display_name: 'Octamile', underwriters: [UW_OCTAMILE, UW_OCTAMILE_MOTOR],
    base_url: 'https://api.octamile.com/v2', api_key_masked: 'oct_live_••••••••8b13', webhook_secret_masked: 'whsec_••••••2d77',
    webhook_url: 'https://api.paymax.ng/api/insurance/webhooks/octamile', signature_verified: true, sandbox: false,
    sla_quote_p95_ms: 3000, sla_claim_settle_minutes: 60, status: 'degraded',
    product_lines: ['ride_hailing', 'logistics', 'parcel', 'bus', 'motor', 'git', 'driver_protection', 'passenger_protection'], updated_at: iso(300),
  },
];
export async function getProviders(): Promise<ProviderConfig[]> {
  if (USE_MOCK) { await delay(); return PROVIDERS.map((p) => ({ ...p, underwriters: [...p.underwriters], product_lines: [...p.product_lines] })); }
  return getJson<ProviderConfig[]>('/providers');
}

const PROVIDER_EVENTS: ProviderEvent[] = [
  { id: 'pe_1', provider: 'octamile', event_type: 'claim.settled', external_event_id: 'oct-evt-99120', signature_verified: true, processed: true, duplicate: false, payload_ref: 'vault://pe/pe_1', received_at: iso(27), processed_at: iso(27) },
  { id: 'pe_2', provider: 'mycover', event_type: 'policy.bound', external_event_id: 'mc-evt-44012', signature_verified: true, processed: true, duplicate: false, payload_ref: 'vault://pe/pe_2', received_at: iso(48), processed_at: iso(48) },
  { id: 'pe_3', provider: 'mycover', event_type: 'policy.bound', external_event_id: 'mc-evt-44012', signature_verified: true, processed: false, duplicate: true, payload_ref: 'vault://pe/pe_3', received_at: iso(47.9), processed_at: null },
  { id: 'pe_4', provider: 'octamile', event_type: 'claim.status_changed', external_event_id: 'oct-evt-99210', signature_verified: false, processed: false, duplicate: false, payload_ref: 'vault://pe/pe_4', received_at: iso(2), processed_at: null },
  { id: 'pe_5', provider: 'mycover', event_type: 'premium.failed', external_event_id: 'mc-evt-44120', signature_verified: true, processed: true, duplicate: false, payload_ref: 'vault://pe/pe_5', received_at: iso(3), processed_at: iso(3) },
];
export async function listProviderEvents(opts?: { provider?: string; event_type?: string; duplicate?: boolean }): Promise<ProviderEvent[]> {
  if (USE_MOCK) {
    await delay();
    let r = PROVIDER_EVENTS.map((e) => ({ ...e }));
    if (opts?.provider) r = r.filter((e) => e.provider === opts.provider);
    if (opts?.event_type) r = r.filter((e) => e.event_type === opts.event_type);
    if (opts?.duplicate !== undefined) r = r.filter((e) => e.duplicate === opts.duplicate);
    return r;
  }
  const qs = new URLSearchParams();
  if (opts?.provider) qs.set('provider', opts.provider);
  if (opts?.event_type) qs.set('event_type', opts.event_type);
  if (opts?.duplicate !== undefined) qs.set('duplicate', String(opts.duplicate));
  const s = qs.toString();
  return getJson<ProviderEvent[]>(`/provider-events${s ? `?${s}` : ''}`);
}

const WEBHOOKS: WebhookDelivery[] = [
  { id: 'wh_1', provider: 'octamile', event_type: 'claim.status_changed', external_event_id: 'oct-evt-99210', status: 'failed', attempts: 3, last_attempt_at: iso(2), replayable: true },
  { id: 'wh_2', provider: 'mycover', event_type: 'policy.bound', external_event_id: 'mc-evt-44012', status: 'delivered', attempts: 1, last_attempt_at: iso(48), replayable: false },
  { id: 'wh_3', provider: 'octamile', event_type: 'premium.remitted', external_event_id: 'oct-evt-99300', status: 'pending', attempts: 2, last_attempt_at: iso(1), replayable: true },
  { id: 'wh_4', provider: 'mycover', event_type: 'premium.failed', external_event_id: 'mc-evt-44120', status: 'delivered', attempts: 1, last_attempt_at: iso(3), replayable: false },
];
export async function listWebhooks(opts?: { provider?: string; status?: string }): Promise<WebhookDelivery[]> {
  if (USE_MOCK) {
    await delay();
    let r = WEBHOOKS.map((w) => ({ ...w }));
    if (opts?.provider) r = r.filter((w) => w.provider === opts.provider);
    if (opts?.status) r = r.filter((w) => w.status === opts.status);
    return r;
  }
  const qs = new URLSearchParams();
  if (opts?.provider) qs.set('provider', opts.provider);
  if (opts?.status) qs.set('status', opts.status);
  const s = qs.toString();
  return getJson<WebhookDelivery[]>(`/webhooks${s ? `?${s}` : ''}`);
}
export async function replayWebhook(id: string): Promise<WebhookReplayResult> {
  if (USE_MOCK) { await delay(); return { id, status: 'queued', queued_at: new Date().toISOString() }; }
  return sendJson<WebhookReplayResult>('POST', `/webhooks/${encodeURIComponent(id)}/replay`, {});
}

// ════════════════════════════════════════════════════════════════════════════
// Ops — consent/audit · sweeps · reports
// ════════════════════════════════════════════════════════════════════════════
const CONSENT_AUDIT: ConsentAuditEntry[] = [
  { id: 'ca_1', policy_id: 'pol_10231', user_masked: 'Ada O••••', consent_version: 'NDPA-v2', scope: 'device_imei, device_value', provider: 'mycover', action: 'granted', actor: 'usr_a', created_at: iso(48) },
  { id: 'ca_2', policy_id: 'pol_10231', user_masked: 'Ada O••••', consent_version: 'NDPA-v2', scope: 'device_imei, device_value', provider: 'mycover', action: 'data_shared', actor: 'system', created_at: iso(48) },
  { id: 'ca_3', policy_id: 'pol_10300', user_masked: 'Zara M••••', consent_version: 'NDPA-v2', scope: 'vehicle_reg, chassis_no, nin', provider: 'octamile', action: 'granted', actor: 'usr_c', created_at: iso(720) },
  { id: 'ca_4', policy_id: null, user_masked: 'Chidi N••••', consent_version: 'NDPA-v2', scope: 'all', provider: 'mycover', action: 'erasure_requested', actor: 'usr_d', created_at: iso(100) },
  { id: 'ca_5', policy_id: 'pol_10355', user_masked: 'Chidi N••••', consent_version: 'NDPA-v1', scope: 'full_name, dob, nin', provider: 'mycover', action: 'withdrawn', actor: 'usr_d', created_at: iso(120) },
];
export async function getConsentAudit(opts?: { provider?: string; action?: string }): Promise<ConsentAuditEntry[]> {
  if (USE_MOCK) {
    await delay();
    let r = CONSENT_AUDIT.map((c) => ({ ...c }));
    if (opts?.provider) r = r.filter((c) => c.provider === opts.provider);
    if (opts?.action) r = r.filter((c) => c.action === opts.action);
    return r;
  }
  const qs = new URLSearchParams();
  if (opts?.provider) qs.set('provider', opts.provider);
  if (opts?.action) qs.set('action', opts.action);
  const s = qs.toString();
  return getJson<ConsentAuditEntry[]>(`/consent-audit${s ? `?${s}` : ''}`);
}

const SWEEPS: SweepsMonitor = {
  renewals_due_7d: 389,
  renewals_due_30d: 1_842,
  lapses_pending: 56,
  next_run_at: iso(-6),
  recent_runs: [
    { id: 'sw_1', kind: 'renewal', status: 'completed', scanned: 41_882, affected: 389, notified: 389, errors: 0, window: '7d ahead', ran_at: iso(6) },
    { id: 'sw_2', kind: 'lapse', status: 'completed', scanned: 41_882, affected: 56, notified: 56, errors: 2, window: 'grace expired', ran_at: iso(30) },
    { id: 'sw_3', kind: 'renewal', status: 'failed', scanned: 12_004, affected: 0, notified: 0, errors: 1, window: '7d ahead', ran_at: iso(54), },
    { id: 'sw_4', kind: 'lapse', status: 'completed', scanned: 41_500, affected: 48, notified: 48, errors: 0, window: 'grace expired', ran_at: iso(78) },
  ],
};
export async function getSweeps(): Promise<SweepsMonitor> {
  if (USE_MOCK) { await delay(); return { ...SWEEPS, recent_runs: SWEEPS.recent_runs.map((r) => ({ ...r })) }; }
  return getJson<SweepsMonitor>('/sweeps');
}

const REPORTS: ReportDefinition[] = [
  { id: 'rpt_gwp', name: 'GWP & attach-rate report', description: 'Gross written premium and embedded attach rate by product line.', category: 'finance', formats: ['csv', 'xlsx'], last_generated_at: iso(20) },
  { id: 'rpt_commission', name: 'Commission ledger export', description: 'Paymax commission revenue, per provider, reconciled flag.', category: 'finance', formats: ['csv', 'xlsx'], last_generated_at: iso(20) },
  { id: 'rpt_claims', name: 'Claims ratio & SLA report', description: 'Claims incurred vs earned premium; settlement SLA adherence.', category: 'operations', formats: ['csv', 'xlsx', 'pdf'], last_generated_at: iso(44) },
  { id: 'rpt_naicom', name: 'NAICOM regulator pack', description: 'Immutable audit export for regulator review (state changes, disclosures).', category: 'compliance', formats: ['pdf'], last_generated_at: iso(720) },
  { id: 'rpt_consent', name: 'NDPA consent register', description: 'Versioned consent records and data-share events per provider.', category: 'compliance', formats: ['csv'], last_generated_at: null },
  { id: 'rpt_recon', name: 'Reconciliation breaks summary', description: 'Open/resolved breaks, value, SLA breaches by provider.', category: 'finance', formats: ['csv', 'xlsx'], last_generated_at: iso(2) },
];
export async function getReports(): Promise<ReportDefinition[]> {
  if (USE_MOCK) { await delay(); return REPORTS.map((r) => ({ ...r, formats: [...r.formats] })); }
  return getJson<ReportDefinition[]>('/reports');
}
