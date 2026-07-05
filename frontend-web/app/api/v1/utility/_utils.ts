import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { errorResponse } from '@/src/lib/api/responses';
import { checkRateLimit } from '@/src/lib/voting/rate-limit';
import type { UtilityCategory } from '@/src/server/utility/types';

export function utilityUnavailableResponse() {
  return featureFlags.utilityPayments() ? null : errorResponse('Utility payments feature is not available.', 503);
}

// Bills/utility module is auth-only — KYC Tier-1 is intentionally NOT enforced
// anywhere in this module (incl. pay + paystack-initiate), per product decision.
// Wallet debits still go through the wallet service's own balance/limit checks.
// To reinstate a tier gate, re-add `requireKycTier(user.id, 1)` here.
export async function requireUtilityUser(request: Request) {
  return requireRequestUser(request);
}

// Alias kept for read-only lookups (validation/browse). Same auth-only behaviour.
export async function requireUtilityReader(request: Request) {
  return requireRequestUser(request);
}

export function utilityRateLimit(request: Request, scope: string, actorId: string, limit = 30, windowMs = 60_000) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || '0.0.0.0';
  const result = checkRateLimit(`utility:${scope}:${actorId}:${ip}`, limit, windowMs);
  return result.allowed ? null : errorResponse('Too many utility requests. Please slow down.', 429);
}

export function parseUtilityCategory(value: string | null): UtilityCategory | undefined {
  // Case-insensitive: the billing client sends UPPERCASE (AIRTIME/DATA/ELECTRICITY/
  // CABLE_TV), while the canonical category values are lowercase. Normalise before
  // matching so either case is accepted (was previously rejecting uppercase as 400).
  const normalized = (value ?? '').trim().toLowerCase();
  if (
    normalized === 'airtime' ||
    normalized === 'data' ||
    normalized === 'electricity' ||
    normalized === 'cable_tv' ||
    normalized === 'internet' ||
    normalized === 'education'
  ) {
    return normalized as UtilityCategory;
  }
  return undefined;
}

export function pagination(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 100);
  const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);
  return { limit, offset };
}
