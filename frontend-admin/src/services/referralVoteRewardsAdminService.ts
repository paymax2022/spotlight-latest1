/**
 * REF-007 — admin data access for System C, the flat ₦500 vote-triggered
 * referral reward (frontend-web/src/server/referrals/{service,attribution}.ts,
 * audited via `referral_events`). Read-only: System C's crediting is fully
 * automatic and already idempotent, so there is no approve/reject action to
 * expose here (unlike System A's frontend-admin/app/admin/referral console
 * or System B's frontend-admin/app/admin/referral-rewards console, which do
 * have maker-checker style actions).
 *
 * Path A console (see docs/adr/ADR-047-admin-console-consolidation-path-a.md):
 * data lives in frontend-web (referral_events, via Supabase), reached
 * through the same /api/web-proxy this app already uses for the Payments &
 * Finance console — mirrors paymentsFinanceAdminService.ts's fetch/auth
 * pattern exactly.
 *
 * Gated on 'finance:view' server-side (frontend-web's
 * app/api/admin/referrals/vote-rewards/route.ts calls
 * assertAdminPermission(request, 'finance:view') — same permission the
 * Payments & Finance console read path uses).
 */
import { webProxyBase } from '@/config/env';

export interface VoteRewardEvent {
  id: string;
  referrerId: string;
  referrerName: string;
  referrerEmail: string | null;
  referredId: string;
  referredName: string;
  referredEmail: string | null;
  amountKobo: number;
  ledgerEntryId: string | null;
  rewardedAt: string;
  idempotencyKey: string;
}

export interface VoteRewardsConsole {
  events: VoteRewardEvent[];
  meta: { total: number; limit: number; offset: number };
  stats: {
    totalRewardsKobo: number;
    distinctReferrersRewarded: number;
    eventCount: number;
    error?: string | null;
  };
}

export interface VoteRewardsFilter {
  from?: string;
  to?: string;
  referrerId?: string;
  limit?: number;
  offset?: number;
}

function webBase(): string {
  return webProxyBase();
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readJsonOrThrow(res: Response, label: string): Promise<Record<string, unknown>> {
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401) throw new Error(`${label} failed: 401 — sign in again.`);
  if (res.status === 403) throw new Error(`${label} failed: 403 — this account cannot view finance reports. Needs the finance:view permission.`);
  if (!res.ok) throw new Error(`${label} failed: ${(json.error as string) || res.status}`);
  return json;
}

export function formatNaira(kobo: number | null | undefined): string {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format((kobo ?? 0) / 100);
}

export async function getVoteRewardsConsole(filter: VoteRewardsFilter = {}): Promise<VoteRewardsConsole> {
  const params = new URLSearchParams();
  if (filter.from) params.set('from', filter.from);
  if (filter.to) params.set('to', filter.to);
  if (filter.referrerId) params.set('referrerId', filter.referrerId);
  if (filter.limit) params.set('limit', String(filter.limit));
  if (filter.offset) params.set('offset', String(filter.offset));

  const qs = params.toString();
  const res = await fetch(`${webBase()}/api/admin/referrals/vote-rewards${qs ? `?${qs}` : ''}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  const json = await readJsonOrThrow(res, 'Loading vote-triggered referral rewards');
  return json as unknown as VoteRewardsConsole;
}
