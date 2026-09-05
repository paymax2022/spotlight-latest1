import { env } from '@/config/env';
import type {
  Campaign,
  CampaignState,
  ReviewQueueFilters,
} from '@/types/featuredPlacementAdmin';

// Backend admin placement routes hang off the Go API /api prefix, matching the
// onboarding/mobility admin services: env.apiBaseUrl ends with /api/v1 and the
// admin routes live under /api/placement/admin/...
function adminApiBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api');
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  if (!token) return {};
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// Mock by default; flip with NEXT_PUBLIC_FEATURED_PLACEMENT_ADMIN_USE_MOCK=false
// once the live Go admin endpoints (/api/placement/admin/*) are deployed.
// Matches the onboarding/fx/mobility/realtor admin-service convention.
const USE_FIXTURES =
  (process.env.NEXT_PUBLIC_FEATURED_PLACEMENT_ADMIN_USE_MOCK ?? 'true').toLowerCase() !== 'false';

// ── Fixtures ────────────────────────────────────────────────────────────────

function daysFromNow(d: number): string {
  return new Date(Date.now() + d * 86_400_000).toISOString();
}

const fixtureCampaigns: Campaign[] = [
  {
    id: 'cmp_01HXREVIEW1',
    merchant_id: 'mrc_lagos_eats',
    subject_type: 'restaurant',
    subject_id: 'rst_889',
    zone_code: 'LAGOS_ISLAND',
    window_start: daysFromNow(2),
    window_end: daysFromNow(9),
    duration_days: 7,
    creative: {
      headline: 'Jollof Friday — 20% off all combos',
      image_ref: 'r2://example-bucket/placement/lagos_eats_jollof.jpg',
      cta: 'Order now',
      deep_link: 'spotlight://restaurant/rst_889',
    },
    quoted_price_kobo: 4_500_000,
    rate_version: 'v3',
    state: 'UNDER_REVIEW',
    review_reason: null,
    created_at: daysFromNow(-1),
    updated_at: daysFromNow(-1),
    merchant_name: 'Lagos Eats Ltd',
    merchant_standing: 'good',
    merchant_active_campaigns: 1,
  },
  {
    id: 'cmp_01HXREVIEW2',
    merchant_id: 'mrc_glam_rides',
    subject_type: 'transport_operator',
    subject_id: 'opr_204',
    zone_code: 'ABUJA_CENTRAL',
    window_start: daysFromNow(3),
    window_end: daysFromNow(17),
    duration_days: 14,
    creative: {
      headline: 'Airport runs from ₦8,000 — book in 30s',
      image_ref: 'r2://example-bucket/placement/glam_rides_airport.jpg',
      cta: 'Book a ride',
      deep_link: 'spotlight://mobility/operator/opr_204',
    },
    quoted_price_kobo: 9_000_000,
    rate_version: 'v3',
    state: 'UNDER_REVIEW',
    review_reason: null,
    created_at: daysFromNow(-2),
    updated_at: daysFromNow(-2),
    merchant_name: 'Glam Rides',
    merchant_standing: 'review',
    merchant_active_campaigns: 0,
  },
  {
    id: 'cmp_01HXSUBMIT3',
    merchant_id: 'mrc_med_plus',
    subject_type: 'health_provider',
    subject_id: 'hp_551',
    zone_code: 'PORT_HARCOURT',
    window_start: daysFromNow(5),
    window_end: daysFromNow(12),
    duration_days: 7,
    creative: {
      headline: 'Free first telemedicine consult this week',
      image_ref: 'r2://example-bucket/placement/med_plus_consult.jpg',
      cta: 'Start consult',
      deep_link: 'spotlight://telemedicine/provider/hp_551',
    },
    quoted_price_kobo: 3_200_000,
    rate_version: 'v3',
    state: 'SUBMITTED',
    review_reason: null,
    created_at: daysFromNow(-1),
    updated_at: daysFromNow(-1),
    merchant_name: 'MedPlus Telehealth',
    merchant_standing: 'good',
    merchant_active_campaigns: 0,
  },
  {
    id: 'cmp_01HXACTIVE4',
    merchant_id: 'mrc_estate_pro',
    subject_type: 'estate',
    subject_id: 'est_119',
    zone_code: 'LEKKI',
    window_start: daysFromNow(-3),
    window_end: daysFromNow(11),
    duration_days: 14,
    creative: {
      headline: 'Lekki Gardens — last 4 units, move-in ready',
      image_ref: 'r2://example-bucket/placement/estate_pro_lekki.jpg',
      cta: 'View listing',
      deep_link: 'spotlight://estate/est_119',
    },
    quoted_price_kobo: 12_500_000,
    rate_version: 'v2',
    state: 'ACTIVE',
    review_reason: null,
    created_at: daysFromNow(-6),
    updated_at: daysFromNow(-3),
    merchant_name: 'EstatePro Realty',
    merchant_standing: 'good',
    merchant_active_campaigns: 2,
  },
];

function fixtureCampaign(id: string): Campaign {
  const found = fixtureCampaigns.find((c) => c.id === id);
  if (found) return { ...found, creative: { ...found.creative } };
  // Fall back to a synthetic record so deep links always resolve in mock mode.
  return { ...fixtureCampaigns[0], id, creative: { ...fixtureCampaigns[0].creative } };
}

// ── API ───────────────────────────────────────────────────────────────────

// GET /placement/admin/review-queue?state=
export async function listReviewQueue(
  filters: ReviewQueueFilters,
): Promise<Campaign[]> {
  if (USE_FIXTURES) {
    const state = (filters.state || '').trim();
    return fixtureCampaigns
      .filter((c) => (state ? c.state === state : true))
      .map((c) => ({ ...c, creative: { ...c.creative } }));
  }
  const params = new URLSearchParams();
  if (filters.state) params.set('state', filters.state);
  const qs = params.toString();
  const res = await fetch(
    `${adminApiBase()}/placement/admin/review-queue${qs ? `?${qs}` : ''}`,
    { cache: 'no-store', headers: authHeaders() },
  );
  if (!res.ok) throw new Error(`Review queue list failed: ${res.status}`);
  const data = await res.json().catch(() => ({}));
  if (Array.isArray(data)) return data as Campaign[];
  return (data.campaigns ?? data.data ?? []) as Campaign[];
}

// GET /placement/admin/campaigns/:id
export async function getCampaign(id: string): Promise<Campaign> {
  if (USE_FIXTURES) {
    return fixtureCampaign(id);
  }
  const res = await fetch(
    `${adminApiBase()}/placement/admin/campaigns/${encodeURIComponent(id)}`,
    { cache: 'no-store', headers: authHeaders() },
  );
  if (!res.ok) throw new Error(`Campaign fetch failed: ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return (data.campaign ?? data) as Campaign;
}

// All four actions have real, verified live endpoints (POST /placement/admin/
// campaigns/:id/{approve,reject,request-info,suspend}), so fixture mode
// refuses loudly instead of reporting a decision it did not perform. See
// docs/audit/ADMIN_SIMULATED_WRITES.md.
async function postAction(
  id: string,
  action: 'approve' | 'reject' | 'request-info' | 'suspend',
  body: Record<string, unknown> = {},
): Promise<Campaign> {
  if (USE_FIXTURES) {
    throw new Error(
      `Placement ${action} is unavailable in fixture mode: this console will not report a write it did not perform. ` +
      'Set NEXT_PUBLIC_FEATURED_PLACEMENT_ADMIN_USE_MOCK=false to make this change against the live backend.',
    );
  }
  const res = await fetch(
    `${adminApiBase()}/placement/admin/campaigns/${encodeURIComponent(id)}/${action}`,
    { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) },
  );
  if (!res.ok) throw new Error(`Placement ${action} failed: ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return (data.campaign ?? data) as Campaign;
}

// POST /placement/admin/campaigns/:id/approve
export function approve(id: string): Promise<Campaign> {
  return postAction(id, 'approve');
}

// POST /placement/admin/campaigns/:id/reject {reason}
export function reject(id: string, reason: string): Promise<Campaign> {
  return postAction(id, 'reject', { reason });
}

// POST /placement/admin/campaigns/:id/request-info {reason}
export function requestInfo(id: string, reason: string): Promise<Campaign> {
  return postAction(id, 'request-info', { reason });
}

// POST /placement/admin/campaigns/:id/suspend {reason}
export function suspend(id: string, reason: string): Promise<Campaign> {
  return postAction(id, 'suspend', { reason });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// Money: integer kobo → naira display.
export function naira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatWindow(startIso: string, endIso: string): string {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
  };
  return `${fmt(startIso)} → ${fmt(endIso)}`;
}
