// ── Admin — Property Management Suite service ───────────────────────────────
// Calls the Go backend's Property Management suite directly (it is NOT an
// /admin-prefixed control plane like realtor/estate — the module owns no admin
// group, only the 4 caller/RBAC-scoped routes registered in
// backend/internal/app/finance_routes.go behind FEATURE_PROPERTY_SUITE_ENABLED).
// Mirrors realtorAdminService's mock/live split and resolveUseMock convention.
// Flip with NEXT_PUBLIC_PROPERTY_ADMIN_USE_MOCK=false to force live (default is
// already live in production per resolveUseMock — this module has a real,
// already-built backend, so it is NOT on scripts/check-mock-flags.mjs's
// MOCK_ALLOWLIST).
// All money is integer minor units (kobo).

import { apiRoot } from '@/config/env';
import { resolveUseMock } from '@/config/useMock';
import type { PropertyContextResponse, RentPassport } from '@/types/propertyAdmin';

const USE_MOCK = resolveUseMock(process.env.NEXT_PUBLIC_PROPERTY_ADMIN_USE_MOCK);

// Confirmed against backend/internal/app/finance_routes.go: propGroup :=
// finance.Group("/property") mounted under the finance router at
// /api/finance/property.
function base(): string {
  return `${apiRoot()}/api/finance/property`;
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}
const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));
async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${base()}${path}`, { headers: authHeaders() });
  if (!res.ok) {
    // The lookup endpoint 403s a caller lacking property.manage — surface the
    // status so the page can render "not authorized" rather than a generic
    // failure, without ever leaking a passport body on the error path.
    throw new Error(`Request failed (${res.status})`);
  }
  const j = await res.json();
  return (j?.data ?? j) as T;
}

// ─── Mock datasets ────────────────────────────────────────────────────────────
const MOCK_CONTEXT: PropertyContextResponse = {
  activeContext: { type: 'estate', id: 'estate_demo_1' },
  contexts: [
    { type: 'estate', id: 'estate_demo_1', name: 'Lekki Gardens Estate', roles: ['resident', 'estate_admin'] },
    { type: 'property', id: 'prop_demo_1', name: 'Flat 3B, Gbagada Phase 2', roles: ['landlord'] },
    { type: 'agency', id: 'agency_demo_1', name: 'Kingsway Realty', roles: ['agency_owner'] },
  ],
};

function mockPassport(userId: string): RentPassport {
  return {
    userId,
    score: 82,
    onTimeRate: 0.9,
    totalPaidKobo: 265_000_00,
    paymentsCount: 6,
    oldestTenancy: new Date(Date.now() - 400 * 86_400_000).toISOString(),
    recentPayments: [
      { source: 'estate', amountKobo: 150_000_00, category: 'service_charge', onTime: true, paidAt: new Date(Date.now() - 20 * 86_400_000).toISOString() },
      { source: 'realtor', amountKobo: 115_000_00, category: 'lease', onTime: true, paidAt: new Date(Date.now() - 50 * 86_400_000).toISOString() },
    ],
  };
}

// ─── API ──────────────────────────────────────────────────────────────────────

/** GET /api/finance/property/context — the logged-in admin's own role context. */
export async function getOwnContext(): Promise<PropertyContextResponse> {
  if (USE_MOCK) { await delay(); return MOCK_CONTEXT; }
  return getJson<PropertyContextResponse>('/context');
}

/**
 * GET /api/finance/property/rent-passport/lookup/:userId — RBAC-gated
 * (`property.manage`) screening view of ANY user's rent passport. IDOR-sensitive:
 * the backend, not this function, is the real authorization boundary.
 */
export async function getRentPassportLookup(userId: string): Promise<RentPassport> {
  if (USE_MOCK) { await delay(320); return mockPassport(userId); }
  return getJson<RentPassport>(`/rent-passport/lookup/${encodeURIComponent(userId)}`);
}
