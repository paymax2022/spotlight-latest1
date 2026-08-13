// ── Admin — MapService v2 cost/coverage + OSM contribution review ───────────────
// Mirrors healthVetVerificationService.ts exactly for request building / auth / errors:
//  • adminBase() rewrites env.apiBaseUrl (…/api/v1) → …/api/maps/admin
//  • authHeaders() attaches the admin Bearer token from localStorage
//  • getJson/sendJson unwrap { data } and throw on non-2xx
// These endpoints live under …/api/maps/admin and require RBAC permission
// `map.admin.review` (carried by the admin session token).
// Mock by default (NEXT_PUBLIC_MAPS_USE_MOCK); flip to false to hit the live Go backend.

import { env } from '@/config/env';
import type {
  MapDashboard,
  ResolutionEvent,
  ProviderHealth,
  ContributionCandidate,
  ContributionReviewInput,
  ContributionStatus,
} from '@/types/mapServiceAdmin';

const USE_MOCK = (process.env.NEXT_PUBLIC_MAPS_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function adminBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/maps/admin');
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

// ── Mock fixtures (parallel to the existing health vet admin service) ───────────
const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
const dayStr = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

const MOCK_PROVIDERS: ProviderHealth[] = [
  {
    name: 'google', up: true, p95_latency_ms: 184, error_rate: 0.004,
    budget_used: 12_400, budget_cap: 40_000, budget_day: dayStr(0),
    circuit_state: 'closed', updated_at: iso(0.2),
  },
  {
    name: 'here', up: true, p95_latency_ms: 221, error_rate: 0.031,
    budget_used: 6_900, budget_cap: 20_000, budget_day: dayStr(0),
    circuit_state: 'half_open', opened_at: iso(1.5), updated_at: iso(0.1),
  },
  {
    name: 'osm', up: false, p95_latency_ms: 540, error_rate: 0.18,
    budget_used: 0, budget_cap: 0, budget_day: dayStr(0),
    circuit_state: 'open', opened_at: iso(0.5), updated_at: iso(0.05),
  },
];

function mockDashboard(days: number): MapDashboard {
  // Scale loosely with the lookback window so the filter visibly changes numbers.
  const k = Math.max(1, Math.round(days / 7));
  const by_source: Record<string, number> = {
    gazetteer: 4200 * k,
    cache: 3100 * k,
    prediction: 1500 * k,
    osm: 620 * k,
    google: 880 * k,
    here: 240 * k,
    needs_pin: 310 * k,
  };
  const paid = by_source.google + by_source.here;
  const deflected = by_source.gazetteer + by_source.cache + by_source.prediction + by_source.osm;
  return {
    deflection: {
      paid,
      deflected,
      by_coverage_tier: {
        GOOD: { paid: Math.round(paid * 0.18), deflected: Math.round(deflected * 0.62) },
        FAIR: { paid: Math.round(paid * 0.46), deflected: Math.round(deflected * 0.28) },
        LOW: { paid: Math.round(paid * 0.36), deflected: Math.round(deflected * 0.1) },
      },
      by_source,
    },
    deflection_rate: deflected / (deflected + paid),
    providers: MOCK_PROVIDERS,
  };
}

const MOCK_EVENTS: ResolutionEvent[] = [
  { id: 'rev_001', request_type: 'geocode', surface: 'checkout', h3_cell: '8a4e64992d4ffff', tier: 'GOOD', chosen_source: 'gazetteer', provider: 'internal', confidence: 0.96, escalated: false, cost_unit: 0, outcome_pin: false, user_id: 'usr_1001', ts: iso(0.5) },
  { id: 'rev_002', request_type: 'reverse', surface: 'mobility', h3_cell: '8a4e6499151ffff', tier: 'FAIR', chosen_source: 'cache', provider: 'internal', confidence: 0.88, escalated: false, cost_unit: 0, outcome_pin: false, user_id: 'usr_1002', ts: iso(0.8) },
  { id: 'rev_003', request_type: 'geocode', surface: 'stays', h3_cell: '8a4e6498a64ffff', tier: 'LOW', chosen_source: 'google', provider: 'google', confidence: 0.74, escalated: true, cost_unit: 1, outcome_pin: true, user_id: 'usr_1003', ts: iso(1.1) },
  { id: 'rev_004', request_type: 'autocomplete', surface: 'checkout', h3_cell: '8a4e64992d0ffff', tier: 'FAIR', chosen_source: 'prediction', provider: 'internal', confidence: 0.81, escalated: false, cost_unit: 0, outcome_pin: false, user_id: 'usr_1004', ts: iso(1.4) },
  { id: 'rev_005', request_type: 'geocode', surface: 'restaurant', h3_cell: '8a4e6498b2bffff', tier: 'LOW', chosen_source: 'here', provider: 'here', confidence: 0.69, escalated: true, cost_unit: 1, outcome_pin: false, user_id: 'usr_1005', ts: iso(2.0) },
  { id: 'rev_006', request_type: 'reverse', surface: 'mobility', h3_cell: '8a4e6499000ffff', tier: 'LOW', chosen_source: 'needs_pin', provider: 'none', confidence: 0.41, escalated: true, cost_unit: 0, outcome_pin: true, user_id: 'usr_1006', ts: iso(2.6) },
  { id: 'rev_007', request_type: 'geocode', surface: 'stays', h3_cell: '8a4e6498a40ffff', tier: 'GOOD', chosen_source: 'osm', provider: 'osm', confidence: 0.85, escalated: false, cost_unit: 0, outcome_pin: false, user_id: 'usr_1007', ts: iso(3.2) },
];

const MOCK_CONTRIBUTIONS: ContributionCandidate[] = [
  { id: 'mcc_001', h3_cell: '8a4e64992d4ffff', type: 'address_point', geometry: '{"type":"Point","coordinates":[3.3792,6.5244]}', pii_stripped: true, status: 'pending', reviewer_id: '', created_at: iso(5) },
  { id: 'mcc_002', h3_cell: '8a4e6498a64ffff', type: 'building', geometry: '{"type":"Polygon","coordinates":[[[3.3801,6.5251],[3.3805,6.5251],[3.3805,6.5255],[3.3801,6.5255],[3.3801,6.5251]]]}', pii_stripped: true, status: 'pending', reviewer_id: '', created_at: iso(11) },
  { id: 'mcc_003', h3_cell: '8a4e6499151ffff', type: 'road_segment', geometry: '{"type":"LineString","coordinates":[[3.3760,6.5220],[3.3775,6.5232]]}', pii_stripped: false, status: 'pending', reviewer_id: '', created_at: iso(26) },
];

export async function getDashboard(days: number): Promise<MapDashboard> {
  if (USE_MOCK) { await delay(); return mockDashboard(days); }
  return getJson<MapDashboard>(`/dashboard?days=${encodeURIComponent(days)}`);
}

export async function getEvents(limit = 100): Promise<ResolutionEvent[]> {
  if (USE_MOCK) { await delay(); return MOCK_EVENTS.slice(0, limit).map((e) => ({ ...e })); }
  const res = await getJson<{ events: ResolutionEvent[] }>(`/events?limit=${encodeURIComponent(limit)}`);
  return res.events;
}

export async function getProviders(): Promise<ProviderHealth[]> {
  if (USE_MOCK) { await delay(); return MOCK_PROVIDERS.map((p) => ({ ...p })); }
  const res = await getJson<{ providers: ProviderHealth[] }>('/providers');
  return res.providers;
}

export async function listContributions(status: ContributionStatus = 'pending'): Promise<ContributionCandidate[]> {
  if (USE_MOCK) { await delay(); return MOCK_CONTRIBUTIONS.filter((c) => c.status === status).map((c) => ({ ...c })); }
  const res = await getJson<{ candidates: ContributionCandidate[] }>(`/contributions?status=${encodeURIComponent(status)}`);
  return res.candidates;
}

export async function reviewContribution(id: string, input: ContributionReviewInput): Promise<ContributionCandidate> {
  if (USE_MOCK) {
    await delay();
    const base = MOCK_CONTRIBUTIONS.find((c) => c.id === id) ?? MOCK_CONTRIBUTIONS[0];
    return {
      ...base,
      status: input.action === 'approve' ? 'approved' : 'rejected',
      reviewer_id: 'ops_admin_1',
    };
  }
  return sendJson<ContributionCandidate>('POST', `/contributions/${id}/review`, input);
}
