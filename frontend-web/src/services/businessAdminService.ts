// ── Admin — Business Registry (CAC business-name verify/register) service ──────
// Copies the commissionService.ts / academyAdminService.ts request stack EXACTLY:
//  • businessBase() rewrites env.apiBaseUrl (…/api/v1) → …/api/business
//    (these admin routes live under /api/business/admin/*, NOT /api/finance or
//     /api/academy — mirroring how sibling services target a non-v1 sub-path).
//  • authHeaders() attaches the admin Bearer token from localStorage.
//  • getJson/sendJson unwrap the { data } envelope and throw on non-2xx.
//
// Backend (already built): admin endpoints under /api/business/admin, authed +
// RBAC permission `business.registry.review` (super-admin / system-admin). All
// responses are shaped { data: … }. Money is integer minor units (kobo); the UI
// shows ₦ (feeKobo/100). Mock by default (NEXT_PUBLIC_BUSINESS_USE_MOCK); flip to
// false to hit the live Go backend. Every state-change is audit-logged server-side.

import { env } from '@/config/env';

const USE_MOCK = (process.env.NEXT_PUBLIC_BUSINESS_USE_MOCK ?? 'true').toLowerCase() !== 'false';

// ── Domain types (mirror the backend JSON tags — camelCase) ───────────────────
export type BusinessStatus =
  | 'draft' | 'name_check' | 'name_reserved' | 'registration_submitted'
  | 'under_review' | 'registered' | 'submitted' | 'verified' | 'rejected' | 'failed';

export type BusinessMode = 'verify_existing' | 'register_new';

export type EntityType = string; // free-form on the backend (e.g. business_name, company, ngo)

export const STATUSES: BusinessStatus[] = [
  'draft', 'name_check', 'name_reserved', 'registration_submitted',
  'under_review', 'registered', 'submitted', 'verified', 'rejected', 'failed',
];
export const MODES: BusinessMode[] = ['verify_existing', 'register_new'];

// Statuses that are terminal — no manual approve/reject applies.
export const TERMINAL_STATUSES: BusinessStatus[] = ['registered', 'verified', 'rejected', 'failed'];

export interface Proprietor {
  id?: string;
  name: string;
  role?: string;
  email?: string;
  phone?: string;
  bvn?: string;
  sharePct?: number;
}

export interface Business {
  id: string;
  userId: string;
  entityType: EntityType;
  mode: BusinessMode;
  legalName: string;
  proposedName: string;
  lineOfBusiness: string;
  status: BusinessStatus;
  rcOrBnNumber?: string | null;
  cacReservationRef?: string | null;
  cacRegistrationRef?: string | null;
  verificationSource?: string | null;
  registeredAt?: string | null;
  /** CAC certificate URL — present once registered/verified and CAC has issued it. */
  certificateUrl?: string;
  feeKobo: number;
  feeLedgerRef?: string | null;
  metadata?: Record<string, unknown> | null;
  proprietors: Proprietor[];
  createdAt: string;
  updatedAt: string;
}

export interface ListOpts {
  status?: BusinessStatus | '';
  mode?: BusinessMode | '';
  limit?: number;
}

// ── Request stack ─────────────────────────────────────────────────────────────
function businessBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/business');
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}
const delay = (ms = 220) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${businessBase()}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}
async function sendJson<T>(method: 'POST' | 'PATCH' | 'PUT', path: string, body: unknown): Promise<T> {
  const res = await fetch(`${businessBase()}${path}`, { method, headers: authHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}

// ── Money helper (integer-safe; ₦ = kobo/100) ─────────────────────────────────
export function formatNaira(kobo: number): string {
  return `₦${((Number(kobo) || 0) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Mock fixtures ─────────────────────────────────────────────────────────────
const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();

const MOCK_BUSINESSES: Business[] = [
  {
    id: 'biz_001', userId: 'usr_aa01', entityType: 'business_name', mode: 'register_new',
    legalName: '', proposedName: 'Bright Futures Logistics', lineOfBusiness: 'Haulage & courier services',
    status: 'under_review', rcOrBnNumber: null, cacReservationRef: 'RSV-2026-0091', cacRegistrationRef: null,
    verificationSource: null, registeredAt: null, feeKobo: 2_000_000, feeLedgerRef: 'led_biz_aa01',
    metadata: { state: 'Lagos', channel: 'mobile' },
    proprietors: [
      { id: 'p1', name: 'Ada Okafor', role: 'Proprietor', email: 'ada@example.com', phone: '+2348030000001', bvn: '22200000001', sharePct: 100 },
    ],
    createdAt: iso(30), updatedAt: iso(2),
  },
  {
    id: 'biz_002', userId: 'usr_bb02', entityType: 'company', mode: 'register_new',
    legalName: '', proposedName: 'GreenLeaf Agro Limited', lineOfBusiness: 'Agro-processing',
    status: 'registration_submitted', rcOrBnNumber: null, cacReservationRef: 'RSV-2026-0104', cacRegistrationRef: null,
    verificationSource: null, registeredAt: null, feeKobo: 3_500_000, feeLedgerRef: 'led_biz_bb02',
    metadata: { state: 'Oyo' },
    proprietors: [
      { id: 'p1', name: 'Bola Adeyemi', role: 'Director', email: 'bola@example.com', phone: '+2348030000002', bvn: '22200000002', sharePct: 60 },
      { id: 'p2', name: 'Chidi Nwankwo', role: 'Director', email: 'chidi@example.com', phone: '+2348030000003', bvn: '22200000003', sharePct: 40 },
    ],
    createdAt: iso(72), updatedAt: iso(10),
  },
  {
    id: 'biz_003', userId: 'usr_cc03', entityType: 'business_name', mode: 'verify_existing',
    legalName: 'Sunrise Fabrics Enterprises', proposedName: '', lineOfBusiness: 'Textile retail',
    status: 'submitted', rcOrBnNumber: 'BN-3391882', cacReservationRef: null, cacRegistrationRef: null,
    verificationSource: 'cac_search', registeredAt: null, feeKobo: 500_000, feeLedgerRef: 'led_biz_cc03',
    metadata: null,
    proprietors: [
      { id: 'p1', name: 'Ngozi Eze', role: 'Owner', email: 'ngozi@example.com', phone: '+2348030000004' },
    ],
    createdAt: iso(6), updatedAt: iso(1),
  },
  {
    id: 'biz_004', userId: 'usr_dd04', entityType: 'company', mode: 'verify_existing',
    legalName: 'Kano Steel Works Ltd', proposedName: '', lineOfBusiness: 'Metal fabrication',
    status: 'verified', rcOrBnNumber: 'RC-1188221', cacReservationRef: null, cacRegistrationRef: null,
    verificationSource: 'cac_api', registeredAt: null, feeKobo: 500_000, feeLedgerRef: 'led_biz_dd04',
    certificateUrl: 'https://cac.example.gov.ng/certificates/RC-1188221.pdf',
    metadata: { verifiedBy: 'auto' },
    proprietors: [
      { id: 'p1', name: 'Musa Sani', role: 'Director', email: 'musa@example.com', phone: '+2348030000005', sharePct: 100 },
    ],
    createdAt: iso(240), updatedAt: iso(200),
  },
  {
    id: 'biz_005', userId: 'usr_ee05', entityType: 'business_name', mode: 'register_new',
    legalName: 'Coastline Foods', proposedName: 'Coastline Foods', lineOfBusiness: 'Restaurant',
    status: 'registered', rcOrBnNumber: 'BN-4402991', cacReservationRef: 'RSV-2025-8812', cacRegistrationRef: 'REG-2026-1120',
    verificationSource: 'cac_api', registeredAt: iso(48), feeKobo: 1_500_000, feeLedgerRef: 'led_biz_ee05',
    certificateUrl: 'https://cac.example.gov.ng/certificates/BN-4402991.pdf',
    metadata: { state: 'Rivers' },
    proprietors: [
      { id: 'p1', name: 'Tari Wodu', role: 'Proprietor', email: 'tari@example.com', phone: '+2348030000006', sharePct: 100 },
    ],
    createdAt: iso(400), updatedAt: iso(48),
  },
  {
    id: 'biz_006', userId: 'usr_ff06', entityType: 'business_name', mode: 'register_new',
    legalName: '', proposedName: 'Zenith Peak Consulting', lineOfBusiness: 'Management consulting',
    status: 'name_check', rcOrBnNumber: null, cacReservationRef: null, cacRegistrationRef: null,
    verificationSource: null, registeredAt: null, feeKobo: 2_000_000, feeLedgerRef: null,
    metadata: null,
    proprietors: [
      { id: 'p1', name: 'Emeka Obi', role: 'Proprietor', email: 'emeka@example.com', phone: '+2348030000007' },
    ],
    createdAt: iso(4), updatedAt: iso(3),
  },
  {
    id: 'biz_007', userId: 'usr_gg07', entityType: 'company', mode: 'register_new',
    legalName: '', proposedName: 'Duplicate Name Ventures', lineOfBusiness: 'General trade',
    status: 'rejected', rcOrBnNumber: null, cacReservationRef: null, cacRegistrationRef: null,
    verificationSource: null, registeredAt: null, feeKobo: 3_500_000, feeLedgerRef: 'led_biz_gg07',
    metadata: { rejectReason: 'Proposed name conflicts with an existing registration' },
    proprietors: [
      { id: 'p1', name: 'Grace Udo', role: 'Director', email: 'grace@example.com', phone: '+2348030000008', sharePct: 100 },
    ],
    createdAt: iso(120), updatedAt: iso(90),
  },
];

function displayName(b: Business): string {
  return b.legalName?.trim() || b.proposedName?.trim() || '(unnamed)';
}

// ── API ───────────────────────────────────────────────────────────────────────
// GET /api/business/admin?status=&mode=&limit= → { data: business[] }
export async function list(opts?: ListOpts): Promise<Business[]> {
  if (USE_MOCK) {
    await delay();
    let rows = MOCK_BUSINESSES.map((b) => ({ ...b, proprietors: b.proprietors.map((p) => ({ ...p })) }));
    if (opts?.status) rows = rows.filter((b) => b.status === opts.status);
    if (opts?.mode) rows = rows.filter((b) => b.mode === opts.mode);
    if (opts?.limit) rows = rows.slice(0, opts.limit);
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.mode) qs.set('mode', opts.mode);
  if (opts?.limit) qs.set('limit', String(opts.limit));
  const q = qs.toString();
  return getJson<Business[]>(`/admin${q ? `?${q}` : ''}`);
}

// GET /api/business/admin/:id → { data: business }
export async function get(id: string): Promise<Business> {
  if (USE_MOCK) {
    await delay();
    const base = MOCK_BUSINESSES.find((b) => b.id === id) ?? MOCK_BUSINESSES[0];
    return { ...base, proprietors: base.proprietors.map((p) => ({ ...p })) };
  }
  return getJson<Business>(`/admin/${encodeURIComponent(id)}`);
}

// POST /api/business/admin/:id/approve → { data: business } (manual override → success terminal)
export async function approve(id: string): Promise<Business> {
  if (USE_MOCK) {
    await delay();
    const base = MOCK_BUSINESSES.find((b) => b.id === id) ?? MOCK_BUSINESSES[0];
    const terminal: BusinessStatus = base.mode === 'verify_existing' ? 'verified' : 'registered';
    return { ...base, status: terminal, registeredAt: terminal === 'registered' ? new Date().toISOString() : base.registeredAt, updatedAt: new Date().toISOString() };
  }
  return sendJson<Business>('POST', `/admin/${encodeURIComponent(id)}/approve`, {});
}

// POST /api/business/admin/:id/reject { reason } → { data: business }
export async function reject(id: string, reason: string): Promise<Business> {
  if (USE_MOCK) {
    await delay();
    const base = MOCK_BUSINESSES.find((b) => b.id === id) ?? MOCK_BUSINESSES[0];
    return { ...base, status: 'rejected', metadata: { ...(base.metadata ?? {}), rejectReason: reason }, updatedAt: new Date().toISOString() };
  }
  return sendJson<Business>('POST', `/admin/${encodeURIComponent(id)}/reject`, { reason });
}

export { displayName };
