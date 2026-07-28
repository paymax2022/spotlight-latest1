// ── Featured Placement — API wrapper ──────────────────────────────────────────
// Typed data layer the Featured screens code against. Mirrors food/api.ts:
// mock-flagged, shared axios `api` client, Idempotency-Key on money mutations.
// Flip EXPO_PUBLIC_FEATURED_USE_MOCK=false once the Go placement endpoints are
// reachable (Next proxy forwards /api/v1/* → Go).
//
// IRON RULES: all money is integer kobo; submit + pay carry an Idempotency-Key;
// price breakdowns come from the SERVER quote — never computed in the UI.

import { api } from '@/api/client';
import type {
  Zone,
  Campaign,
  CampaignAnalytics,
  CreateDraftRequest,
  EligibleItem,
  LandingResponse,
  PlacementEvent,
  Quote,
} from './types';
import {
  mockListZones,
  mockEligibleItems,
  mockListCampaigns,
  mockGetCampaign,
  mockCreateDraft,
  mockQuote,
  mockSubmit,
  mockPay,
  mockSetState,
  mockAnalytics,
  mockLanding,
} from './mock';

export const USE_MOCK =
  (process.env.EXPO_PUBLIC_FEATURED_USE_MOCK ?? 'true').toLowerCase() !== 'false';

const BASE = '/api/v1/placement';
const LANDING = '/api/v1/landing';
const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const unwrap = <T>(res: { data: { data?: T } & T }): T => (res.data?.data ?? res.data) as T;
const idemHeader = (key: string) => ({ headers: { 'Idempotency-Key': key } });

// ─── Zones & eligible items ──────────────────────────────────────────────────
export async function listZones(): Promise<Zone[]> {
  if (USE_MOCK) {
    await delay();
    return mockListZones();
  }
  return unwrap<Zone[]>(await api.get(`${BASE}/zones`));
}

/** Items the signed-in merchant can promote. Mock-only for now (no endpoint). */
export async function listEligibleItems(): Promise<EligibleItem[]> {
  await delay(200);
  return mockEligibleItems();
}

// ─── Campaigns ───────────────────────────────────────────────────────────────
export async function listCampaigns(): Promise<Campaign[]> {
  if (USE_MOCK) {
    await delay();
    return mockListCampaigns();
  }
  return unwrap<Campaign[]>(await api.get(`${BASE}/campaigns`));
}

export async function getCampaign(id: string): Promise<Campaign> {
  if (USE_MOCK) {
    await delay(220);
    return mockGetCampaign(id);
  }
  return unwrap<Campaign>(await api.get(`${BASE}/campaigns/${encodeURIComponent(id)}`));
}

export async function createDraft(req: CreateDraftRequest): Promise<Campaign> {
  if (USE_MOCK) {
    await delay(420);
    return mockCreateDraft(req);
  }
  return unwrap<Campaign>(await api.post(`${BASE}/campaigns`, req));
}

export async function quoteCampaign(id: string): Promise<Quote> {
  if (USE_MOCK) {
    await delay(420);
    return mockQuote(id);
  }
  return unwrap<Quote>(await api.post(`${BASE}/campaigns/${encodeURIComponent(id)}/quote`, {}));
}

/** Submit for review — Idempotency-Key per attempt. */
export async function submitCampaign(id: string, idempotencyKey: string): Promise<Campaign> {
  if (USE_MOCK) {
    await delay(500);
    return mockSubmit(id);
  }
  return unwrap<Campaign>(
    await api.post(`${BASE}/campaigns/${encodeURIComponent(id)}/submit`, {}, idemHeader(idempotencyKey)),
  );
}

/** Pay — money mutation → Idempotency-Key per attempt. */
export async function payCampaign(id: string, idempotencyKey: string): Promise<Campaign> {
  if (USE_MOCK) {
    await delay(700);
    return mockPay(id);
  }
  return unwrap<Campaign>(
    await api.post(`${BASE}/campaigns/${encodeURIComponent(id)}/pay`, {}, idemHeader(idempotencyKey)),
  );
}

export async function cancelCampaign(id: string): Promise<Campaign> {
  if (USE_MOCK) {
    await delay(400);
    return mockSetState(id, 'CANCELLED');
  }
  return unwrap<Campaign>(await api.post(`${BASE}/campaigns/${encodeURIComponent(id)}/cancel`, {}));
}

export async function pauseCampaign(id: string): Promise<Campaign> {
  if (USE_MOCK) {
    await delay(400);
    return mockSetState(id, 'PAUSED');
  }
  return unwrap<Campaign>(await api.post(`${BASE}/campaigns/${encodeURIComponent(id)}/pause`, {}));
}

export async function resumeCampaign(id: string): Promise<Campaign> {
  if (USE_MOCK) {
    await delay(400);
    return mockSetState(id, 'ACTIVE');
  }
  return unwrap<Campaign>(await api.post(`${BASE}/campaigns/${encodeURIComponent(id)}/resume`, {}));
}

export async function getAnalytics(id: string): Promise<CampaignAnalytics> {
  if (USE_MOCK) {
    await delay(260);
    return mockAnalytics(id);
  }
  return unwrap<CampaignAnalytics>(await api.get(`${BASE}/campaigns/${encodeURIComponent(id)}/analytics`));
}

// ─── Public landing + event reporting ────────────────────────────────────────
export async function getLandingPlacements(): Promise<LandingResponse> {
  if (USE_MOCK) {
    await delay(280);
    return mockLanding();
  }
  return unwrap<LandingResponse>(await api.get(`${LANDING}/placements`));
}

/** Fire-and-forget impression/tap events. Failures are swallowed by callers. */
export async function reportEvents(events: PlacementEvent[]): Promise<void> {
  if (!events.length) return;
  if (USE_MOCK) {
    // No-op in mock; keep the shape so swapping to live needs no caller change.
    return;
  }
  await api.post(`${BASE}/events`, { events });
}
