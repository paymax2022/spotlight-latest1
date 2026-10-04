/**
 * Shared helpers for the PROVIDER-module E2E validation specs.
 *
 * The web product has no provider-owner UI (the restaurant owner console lives
 * in the mobile app), so the provider journeys are exercised at the real API
 * surface — the same BFF routes the mobile owner console consumes — with the
 * consumer UI used for the cross-actor checks.
 *
 * Admin side: POST :8080/api/restaurant/admin/* is gated by RequireAuthContext
 * + per-route RBAC (NOT x-admin-api-key — the /api/restaurant/admin group only
 * mounts mapsAuth()). An admin Bearer from GoTrue (admin@spotlight.internal,
 * super-admin role) is therefore sufficient. The admin CONSOLE path
 * (:3001 /api/admin-proxy + /admin/restaurant/onboarding page) is exercised in
 * provider-002 to prove the real UI also works.
 *
 * Fixture funding: a wallet top-up through the real Paystack rail cannot
 * complete locally (placeholder PAYSTACK_* keys, no reachable PSP), so specs
 * post the SAME balanced journal pair the top-up webhook posts
 * (DR provider_clearing / CR user_wallet) directly in Postgres — fixture setup
 * only, identical to how provisionVerifiedUser confirms emails in DB.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { APIRequestContext } from '@playwright/test';

import { GO_BACKEND_URL, psql } from '../auth/helpers';

export const ADMIN_WEB_URL = process.env.E2E_ADMIN_WEB_URL || 'http://localhost:3001';
export const ADMIN_USER = {
  email: process.env.E2E_ADMIN_EMAIL || 'admin@spotlight.internal',
  password: process.env.E2E_ADMIN_PASSWORD || 'LocalDevAdmin123!',
};
export { GO_BACKEND_URL, psql };

function readEnvFileValue(key: string, file: string): string {
  try {
    const line = readFileSync(file, 'utf8')
      .split('\n')
      .find((l) => l.startsWith(`${key}=`));
    return line?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '') ?? '';
  } catch {
    return '';
  }
}

const SUPABASE_URL = process.env.E2E_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY =
  process.env.E2E_SUPABASE_ANON_KEY ||
  readEnvFileValue('NEXT_PUBLIC_SUPABASE_ANON_KEY', resolve(__dirname, '../../../.env.local'));

/** Password-grant a user against GoTrue; returns the access token. */
export async function goTrueToken(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const res = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    data: { email, password },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok() || !body?.access_token) {
    throw new Error(`GoTrue token failed (${res.status()}): ${JSON.stringify(body)}`);
  }
  return body.access_token as string;
}

/** Admin Bearer for :8080/api/restaurant/admin/* (RequireAuthContext + RBAC). */
export async function adminToken(request: APIRequestContext): Promise<string> {
  return goTrueToken(request, ADMIN_USER.email, ADMIN_USER.password);
}

export interface CreatedRestaurant {
  id: string;
  name: string;
}

/** POST /api/v1/restaurant through the web BFF (the mobile owner-console route). */
export async function createRestaurant(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<{ status: number; body: CreatedRestaurant }> {
  const res = await request.post('/api/v1/restaurant', {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, address: '12 E2E Provider Close, Lagos', cuisine: 'Nigerian' },
  });
  return { status: res.status(), body: await res.json().catch(() => ({})) };
}

/** Direct Go call for routes with no BFF proxy (KYB, admin). Accepts
 * arbitrary headers — Idempotency-Key etc. (silently dropping them made
 * money-path replay probes vacuous: the request succeeded WITHOUT the key,
 * so a "replay" proved nothing). */
export async function goFetch(
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

/** Fund a wallet by posting the balanced journal the top-up webhook posts. */
export function fundWallet(userId: string, amountKobo: number, tag: string): void {
  // Single-line statements only: newlines arrive as literal "\n" through the
  // JSON.stringify shell quoting, and $$ expands as the shell PID.
  psql(
    `insert into ledger_accounts(id,user_id,type,currency) ` +
      `values (gen_random_uuid(),'${userId}','user_wallet','NGN') ` +
      `on conflict (user_id,type) do nothing;` +
      `insert into ledger_accounts(id,user_id,type,currency) ` +
      `select gen_random_uuid(),null,'provider_clearing','NGN' ` +
      `where not exists (select 1 from ledger_accounts ` +
      `where user_id is null and group_id is null and type='provider_clearing');` +
      `insert into ledger_entries(account_id,type,amount_kobo,reference,idempotency_key,description) ` +
      `select la.id,'CREDIT',${amountKobo},'e2e-${tag}','e2e-topup-${tag}','E2E fixture wallet funding' ` +
      `from ledger_accounts la where la.user_id='${userId}' and la.type='user_wallet' ` +
      `union all ` +
      `select la.id,'DEBIT',${amountKobo},'e2e-${tag}','e2e-topup-${tag}:counter','E2E fixture wallet funding' ` +
      `from ledger_accounts la where la.user_id is null and la.group_id is null ` +
      `and la.type='provider_clearing';`,
  );
}

export function walletBalance(userId: string): string {
  return psql(
    `select coalesce(available_kobo,0) from wallet_balance wb ` +
      `join ledger_accounts la on la.id = wb.account_id ` +
      `where la.user_id='${userId}' and la.type='user_wallet';`,
  );
}
