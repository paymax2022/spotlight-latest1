import { NextResponse } from 'next/server';
import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { errorResponse } from '@/src/lib/api/responses';
import { checkRateLimit } from '@/src/lib/voting/rate-limit';
import { proxyToGoBackend } from '@/src/lib/go-backend';
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

// ── Go backend cutover (migration Phase 2) ──────────────────────────────────
//
// Gated by featureFlags.utilityBillsGoProxy() (off by default). Only pay/
// validate are cut over — both have a real Go-native equivalent from Phase 1
// (backend/internal/utilitybills). paystack/initiate and logos have none: the
// former never touches the wallet/ledger (it only creates a Paystack checkout
// intent — settlement happens later in paystack/callback, out of this phase's
// scope), and the latter is a read-only VTPass logo cache. Neither carries the
// split-brain risk this migration exists to close, so both keep calling
// src/server/utility/ unconditionally.

export function utilityGoProxyEnabled(): boolean {
  return featureFlags.utilityBillsGoProxy();
}

type GoProxyResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; response: Response };

// Calls a Go utilitybills endpoint and returns its parsed JSON body, or a
// ready-to-return error Response reshaped into this module's own
// `{ success: false, error }` convention (never the Go backend's raw shape,
// which callers of this module have never seen).
export async function callUtilityBillsGo(
  request: Request,
  goPath: string,
  body: Record<string, unknown>,
): Promise<GoProxyResult> {
  const upstream = await proxyToGoBackend(request, goPath, { method: 'POST', body });
  const text = await upstream.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = {};
  }

  if (upstream.status >= 400) {
    const message = typeof data.error === 'string' ? data.error : 'Utility bills service returned an error.';
    const errBody: Record<string, unknown> = { success: false, error: message };
    if (typeof data.code === 'string') errBody.code = data.code;
    return { ok: false, response: NextResponse.json(errBody, { status: upstream.status }) };
  }
  return { ok: true, data };
}
