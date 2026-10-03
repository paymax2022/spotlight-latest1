'use client';

import { authFetch, isUnauthorized, redirectToLogin } from '@/src/lib/auth/flow';

export function formatNaira(kobo: number | null | undefined, opts?: { decimals?: boolean }): string {
  if (kobo == null) return '—';
  const value = kobo / 100;
  const fractionDigits = opts?.decimals ? 2 : 0;
  return (
    '₦' +
    value.toLocaleString('en-NG', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    })
  );
}

export function formatRate(rate: number | null | undefined): string {
  if (rate == null) return '—';
  return `${Math.round(rate * 100)}%`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function tierLabel(tier: string): string {
  const map: Record<string, string> = {
    STARTER: 'Starter',
    GROWTH: 'Growth',
    PRO: 'Pro',
    ELITE: 'Elite',
  };
  return map[tier] ?? tier;
}

export function shareMessage(code: string, link: string): string {
  return (
    `Join me on Spotlight — Nigeria's super app for payments, events, shopping and more. ` +
    `Use my code ${code} when you sign up: ${link}`
  );
}

// Wired LIVE to the Go engine via the same-origin proxy:
//   /api/v1/referrals/<...>  →  Go /v1/referrals/<...>
// The proxy forwards the Supabase JWT + Idempotency-Key. Responses are bare
// snake_case JSON (no envelope). All money fields are integer kobo (minor units).
// This module has NO mock path — it relies entirely on the backend.


const BASE = '/api/v1/referrals';

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
  current_rate: number;
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

/** Generate or fetch the caller's referral code/link. Safe to retry. */
export async function getOrCreateLink(): Promise<ReferralLink> {
  const res = await authFetch(
    `${BASE}/link`,
    { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() }, body: '{}' },
    { json: true }
  );
  return readJson<ReferralLink>(res);
}

/**
 * Apply a referral code (referred-user side; signup or late claim). Idempotent
 * per user. `attributed` is true only when the submitted code is the
 * attribution now in effect — false when a different real referrer already won
 * or the default house placeholder is no longer claimable — and `referrer_id`
 * is the caller's ACTUAL current referrer (empty when still house-attributed).
 */
export async function attribute(
  code: string
): Promise<{ referrer_id: string; referred_user_id: string; attributed: boolean }> {
  const res = await authFetch(
    `${BASE}/attribute`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey() },
      body: JSON.stringify({ code: code.trim() }),
    },
    { json: true }
  );
  return readJson<{ referrer_id: string; referred_user_id: string; attributed: boolean }>(res);
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
