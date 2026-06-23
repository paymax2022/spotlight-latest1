import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { requireKycTier } from '@/src/server/kyc/gate';
import { errorResponse } from '@/src/lib/api/responses';
import { checkRateLimit } from '@/src/lib/voting/rate-limit';
import type { UtilityCategory } from '@/src/server/utility/types';

export function utilityUnavailableResponse() {
  return featureFlags.utilityPayments() ? null : errorResponse('Utility payments feature is not available.', 503);
}

export async function requireUtilityUser(request: Request) {
  const user = await requireRequestUser(request);
  await requireKycTier(user.id, 1);
  return user;
}

export function utilityRateLimit(request: Request, scope: string, actorId: string, limit = 30, windowMs = 60_000) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || '0.0.0.0';
  const result = checkRateLimit(`utility:${scope}:${actorId}:${ip}`, limit, windowMs);
  return result.allowed ? null : errorResponse('Too many utility requests. Please slow down.', 429);
}

export function parseUtilityCategory(value: string | null): UtilityCategory | undefined {
  if (value === 'airtime' || value === 'data' || value === 'electricity' || value === 'cable_tv' || value === 'internet') {
    return value;
  }
  return undefined;
}

export function pagination(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 100);
  const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);
  return { limit, offset };
}
