'use client';

// ── Direct Referral Rewards — frontend-web client API ────────────────────────
// Wired LIVE to the Go engine via the same-origin proxy:
//   /api/v1/referrals/<...>  →  Go /v1/referrals/<...>
// The proxy forwards the Supabase JWT + Idempotency-Key. Responses are bare
// snake_case JSON (no envelope). All money fields are integer kobo (minor units).
// This module has NO mock path — it relies entirely on the backend.

import { authFetch, isUnauthorized, redirectToLogin } from '@/src/lib/auth/flow';

const BASE = '/api/v1/referrals';

// ── Types (mirror the Go engine shapes exactly) ──────────────────────────────
export type ReferralTier = 'STARTER' | 'GROWTH' | 'PRO' | 'ELITE';

export interface ReferralLink {
  id: string;
  referrer_id: string;
  code: string;
  created_at: string;
}

export interface NextMilestone {
  threshold: number;
  bonus_kobo: number;
  remaining: number;
}

export interface ReferralDashboard {
  code: string;
  current_tier: ReferralTier;
  current_rate: number; // e.g. 0.05 = 5% of platform margin
  active_referral_count: number;
  this_month_earned_kobo: number;
  lifetime_earned_kobo: number;
  next_milestone?: NextMilestone | null;
}

export interface ReferredUser {
  referred_user_id: string;
  masked_contact: string;
  joined_at: string;
  active: boolean;
  lifetime_earned_kobo: number;
}

export interface RewardEntry {
  id: string;
  referred_user_id: string;
  source_transaction_id: string;
  module: string;
  margin_kobo: number;
  applied_rate: number;
  reward_kobo: number;
  status: string; // PENDING | CREDITED | REVERSED
  config_version: number;
  created_at: string;
  credited_at?: string | null;
  reversed_at?: string | null;
}

export interface Milestone {
  threshold: number;
  bonus_kobo: number;
  status?: string;
  paid_at?: string | null;
}

export interface MilestonesResponse {
  achieved: Milestone[];
  upcoming: Milestone[];
}

export interface PageParams {
  limit?: number;
  offset?: number;
}

// ── Response handling ─────────────────────────────────────────────────────────
export class ReferralApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ReferralApiError';
    this.status = status;
  }
}

async function readJson<T>(res: Response, nextPath = '/earn'): Promise<T> {
  if (isUnauthorized(res)) {
    redirectToLogin(nextPath);
    throw new ReferralApiError('Please sign in to view your rewards.', 401);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    let msg =
      res.status === 503 ? 'Referrals are not available right now.' : `Request failed (${res.status}).`;
    if (body && typeof body === 'object' && 'error' in body) {
      msg = String((body as { error: unknown }).error);
    }
    throw new ReferralApiError(msg, res.status);
  }
  // Engine returns bare objects; tolerate a { data } envelope defensively.
  if (body && typeof body === 'object' && 'data' in body && Object.keys(body as object).length === 1) {
    return (body as { data: T }).data;
  }
  return body as T;
}

function pageQuery(params?: PageParams): string {
  const q = new URLSearchParams();
  if (params?.limit != null) q.set('limit', String(params.limit));
  if (params?.offset != null) q.set('offset', String(params.offset));
  const s = q.toString();
  return s ? `?${s}` : '';
}

function idempotencyKey(): string {
  return `ref-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── Calls ─────────────────────────────────────────────────────────────────────

/** Generate or fetch the caller's referral code/link. Safe to retry. */
export async function getOrCreateLink(): Promise<ReferralLink> {
  const res = await authFetch(
    `${BASE}/link`,
    { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() }, body: '{}' },
    { json: true }
  );
  return readJson<ReferralLink>(res);
}

/** Apply a referral code at signup (referred-user side). Idempotent per user. */
export async function attribute(code: string): Promise<{ referrer_id: string; referred_user_id: string }> {
  const res = await authFetch(
    `${BASE}/attribute`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey() },
      body: JSON.stringify({ code: code.trim() }),
    },
    { json: true }
  );
  return readJson<{ referrer_id: string; referred_user_id: string }>(res);
}

export async function getDashboard(): Promise<ReferralDashboard> {
  const res = await authFetch(`${BASE}/me/dashboard`, { cache: 'no-store' });
  return readJson<ReferralDashboard>(res);
}

export async function listReferrals(params?: PageParams): Promise<ReferredUser[]> {
  const res = await authFetch(`${BASE}/me/referrals${pageQuery(params)}`, { cache: 'no-store' });
  const body = await readJson<{ referrals: ReferredUser[] }>(res);
  return body?.referrals ?? [];
}

export async function listEarnings(params?: PageParams): Promise<RewardEntry[]> {
  const res = await authFetch(`${BASE}/me/earnings${pageQuery(params)}`, { cache: 'no-store' });
  const body = await readJson<{ earnings: RewardEntry[] }>(res);
  return body?.earnings ?? [];
}

export async function getMilestones(): Promise<MilestonesResponse> {
  const res = await authFetch(`${BASE}/me/milestones`, { cache: 'no-store' });
  return readJson<MilestonesResponse>(res);
}
