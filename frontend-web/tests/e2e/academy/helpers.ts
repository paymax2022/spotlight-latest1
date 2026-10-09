/**
 * Shared helpers for the ACADEMY-module E2E validation specs.
 *
 * The whole academy module is mounted only when FEATURE_ACADEMY_ENABLED=true.
 * The campaign API container (:8080) does NOT set that flag, so these specs run
 * against a parallel boot of the same backend on :8095 (same Supabase DB/Redis,
 * same GoTrue — only the env differs). Point them there with:
 *   E2E_GO_BACKEND_URL=http://127.0.0.1:8095 npx playwright test tests/e2e/academy
 * Runtime phase flags resolve from public.academy_feature_flags:
 *   ON  → academy.exam, academy.spine, academy.fees (+ always-on core)
 *   OFF → academy.edupay, academy.credentials, academy.live, academy.schools,
 *         academy.tutor (flag-gated — routes 404 by design).
 *
 * Money-path fixtures follow the campaign doctrine: wallet funding posts the
 * SAME balanced journal the top-up webhook posts (fundWallet) and kyc_tier is
 * seeded because the strict debit gate refuses Tier-0 wallets. Rail webhooks
 * are signed with HMAC-SHA256 (dev-fake-secret) exactly like tools/fakes.
 */

import { createHmac } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';

export {
  ADMIN_API_KEY,
  ADMIN_USER,
  ADMIN_WEB_URL,
  GO_BACKEND_URL,
  adminBearer,
  adminGo,
  adminGoAs,
  fundWallet,
  goFetch,
  goTrueToken,
  ledgerSums,
  provisionVerifiedUser,
  psql,
  setKycTier,
  setProfilePhone,
  uniqueEmail,
  walletBalance,
  type LedgerLeg,
  type ProvisionedUser,
} from '../cross/helpers';

export { idemKey, uniquePhone, assertKoboIntegers } from '../finance/helpers';

import { GO_BACKEND_URL } from '../cross/helpers';

/**
 * goFetch re-exported through cross/helpers → provider/helpers silently DROPS
 * opts.headers (that variant has no headers param), which made every
 * Idempotency-Key mutation fail 400 idempotency_key_required. Shared helpers
 * must not be edited, so academy specs use this header-capable twin for any
 * call that sends custom headers.
 */
export async function goFetchH(
  request: APIRequestContext,
  path: string,
  opts: { method?: string; token?: string; data?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: any }> {
  const res = await request.fetch(`${GO_BACKEND_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.headers ?? {}),
    },
    ...(opts.data !== undefined ? { data: opts.data } : {}),
  });
  return { status: res.status(), body: await res.json().catch(() => null) };
}

let counter = 0;
export function acadKey(tag: string): string {
  counter += 1;
  return `e2e-acad-${tag}-${Date.now()}-${counter}`;
}

/** Webhook signature secret shared with tools/fakes (FAKE_WEBHOOK_SECRET). */
export const RAIL_WEBHOOK_SECRET = 'dev-fake-secret';

/** Sign a rail webhook body exactly like tools/fakes (HMAC-SHA256 hex). */
export function signRailWebhook(rawBody: string, secret = RAIL_WEBHOOK_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

export interface RailWebhookEvent {
  rail: string;
  event: string; // bnpl:"approved" | payout/disburse/billing:"settled"
  ref: string;
  reference: string;
  idempotency_key: string;
  amount_minor: number;
  status?: string;
  occurred_at?: string;
}

/** POST a signed rail webhook to /internal/webhooks/academy/:rail (unauthenticated). */
export async function postRailWebhook(
  request: APIRequestContext,
  evt: RailWebhookEvent,
  opts: { secret?: string; rawOverride?: string } = {},
): Promise<{ status: number; body: any }> {
  const payload = {
    rail: evt.rail,
    event: evt.event,
    ref: evt.ref,
    reference: evt.reference,
    idempotency_key: evt.idempotency_key,
    amount_minor: evt.amount_minor,
    status: evt.status ?? 'success',
    occurred_at: evt.occurred_at ?? new Date().toISOString(),
  };
  const raw = opts.rawOverride ?? JSON.stringify(payload);
  const res = await request.fetch(`${GO_BACKEND_URL}/internal/webhooks/academy/${evt.rail}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Fake-Signature': signRailWebhook(raw, opts.secret ?? RAIL_WEBHOOK_SECRET),
    },
    data: raw,
  });
  return { status: res.status(), body: await res.json().catch(() => null) };
}

/** Call an INTERNAL service-token route (RequireServiceToken). */
export async function internalFetch(
  request: APIRequestContext,
  path: string,
  opts: { method?: string; token?: string; data?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: any }> {
  const res = await request.fetch(`${GO_BACKEND_URL}${path}`, {
    method: opts.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.headers ?? {}),
    },
    ...(opts.data !== undefined ? { data: opts.data } : {}),
  });
  return { status: res.status(), body: await res.json().catch(() => null) };
}

/** The internal service token the :8095 academy instance was booted with. */
export const SERVICE_TOKEN = process.env.E2E_SERVICE_TOKEN || 'dev-service-token';

/** Poll a fn until it returns truthy or the budget runs out (async webhooks). */
export async function until<T>(fn: () => Promise<T | null>, ms = 8000, step = 400): Promise<T | null> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, step));
  }
  return null;
}
