// Wave 7 admin config surfaces for the Food module: commission split, refund tiers,
// payout dual-approval, delivery zones, consent audit, permit expiry. Kept apart from
// restaurantAdminService.ts (other change sets edit it) and always LIVE — these are
// config/money-adjacent writes, so there is deliberately no fixture mode that could
// report a write it did not perform.

import { apiRoot } from '@/config/env';

const adminBase = () => `${apiRoot()}/api/restaurant/admin`;

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body as T;
}

// RBAC slugs the pages gate on (the server stays authoritative).
export const CONFIG_PERMS = {
  commission: ['restaurant.admin.commission'],
  refundTiers: ['restaurant.admin.disputes', 'restaurant.admin.refund_large'],
  refundTierWrite: ['restaurant.admin.refund_large'],
  payoutView: ['restaurant.admin.payouts'],
  payoutApprove: ['restaurant.admin.payout_approve'],
  onboarding: ['restaurant.admin.onboarding', 'restaurant.manage'],
};

// ── Commission ───────────────────────────────────────────────────────────────
export interface CommissionRow {
  restaurant_id: string | null;
  provider_split_bps: number;
  rider_split_bps: number;
  platform_split_bps: number;
  effective_from: string;
  created_by: string | null;
  created_at: string;
}
export const listCommission = () => req<{ commission: CommissionRow[] }>('/commission').then((r) => r.commission ?? []);
export const putCommission = (b: { restaurant_id?: string; provider_split_bps: number; rider_split_bps: number; platform_split_bps: number }) =>
  req<{ updated: boolean }>('/commission', { method: 'PUT', body: JSON.stringify(b) });
export const deleteCommission = (restaurantId: string) =>
  req<{ removed: boolean }>(`/commission/${encodeURIComponent(restaurantId)}`, { method: 'DELETE' });

// ── Refund tiers ─────────────────────────────────────────────────────────────
export interface RefundTier { id: string; threshold_kobo: number; effective_from: string; created_by?: string | null; created_at: string }
export const listRefundTiers = () => req<{ tiers: RefundTier[]; current_threshold_kobo: number }>('/refund-tiers');
export const setRefundTier = (threshold_kobo: number) =>
  req<{ updated: boolean }>('/refund-tiers', { method: 'PUT', body: JSON.stringify({ threshold_kobo }) });

// ── Payout dual approval ─────────────────────────────────────────────────────
export interface PayoutApproval { step: 'requested' | 'endorsed' | 'approved'; actor_user_id: string; note?: string; created_at: string }
export const payoutApprovals = (runId: string) =>
  req<{ approvals: PayoutApproval[] }>(`/payouts/${encodeURIComponent(runId)}/approvals`).then((r) => r.approvals ?? []);
export const payoutStep = (runId: string, step: 'request' | 'endorse' | 'approve', note?: string) =>
  req<{ approvals: PayoutApproval[] }>(`/payouts/${encodeURIComponent(runId)}/${step}`, { method: 'POST', body: JSON.stringify({ note: note ?? '' }) })
    .then((r) => r.approvals ?? []);

// ── Delivery zones ───────────────────────────────────────────────────────────
export interface DeliveryZone { id: string; restaurant_id: string; kind: string; radius_km_bps?: number; created_at: string }
export const listZones = (restaurantId: string) =>
  req<{ zones: DeliveryZone[] }>(`/${encodeURIComponent(restaurantId)}/zones`).then((r) => r.zones ?? []);
export const createRadiusZone = (restaurantId: string, radius_km_bps: number) =>
  req<DeliveryZone>(`/${encodeURIComponent(restaurantId)}/zones`, { method: 'POST', body: JSON.stringify({ kind: 'radius_km', radius_km_bps }) });
export const deleteZone = (restaurantId: string, zoneId: string) =>
  req<{ deleted?: boolean }>(`/${encodeURIComponent(restaurantId)}/zones/${encodeURIComponent(zoneId)}`, { method: 'DELETE' });

// ── Consent audit ────────────────────────────────────────────────────────────
export interface ConsentRow { id: string; user_id: string; kind: string; status: 'granted' | 'withdrawn'; source?: string | null; created_at: string }
export const listConsents = (p: { kind?: string; user_id?: string; limit?: number; offset?: number } = {}) => {
  const qs = new URLSearchParams();
  Object.entries(p).forEach(([k, v]) => { if (v !== undefined && v !== '') qs.set(k, String(v)); });
  return req<{ consents: ConsentRow[] }>(`/consents?${qs}`).then((r) => r.consents ?? []);
};

// ── Permits ──────────────────────────────────────────────────────────────────
export interface PermitRow { restaurant_id: string; name: string; is_open: boolean; permit_expires_at?: string | null; compliance_hold_reason?: string | null }
export type PermitFilter = 'all' | 'missing' | 'expired' | 'expiring';
export const listPermits = (filter: PermitFilter) =>
  req<{ permits: PermitRow[] }>(`/permits?filter=${filter}&limit=200`).then((r) => r.permits ?? []);
export const setPermit = (restaurantId: string, expires_at: string, document_url?: string) =>
  req<{ permit_expires_at: string }>(`/restaurants/${encodeURIComponent(restaurantId)}/permit`, { method: 'PUT', body: JSON.stringify({ expires_at, document_url: document_url ?? '' }) });
export const backfillNullPermits = (defaultExpiresAt: string) =>
  req<{ updated: number; truncated: boolean; ceiling: number }>(`/permits/backfill-null?default_expires_at=${encodeURIComponent(defaultExpiresAt)}`, { method: 'POST' });
