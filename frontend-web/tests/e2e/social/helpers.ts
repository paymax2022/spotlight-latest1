/**
 * Shared helpers for the CONNECT / SOCIAL-cluster E2E validation specs.
 *
 * This cluster has NO web UI pages (see SOC-001 — /connect, /social, /groups,
 * /creators, /marketplace are all Next 404s). The real product surface is the
 * API plane, reached two ways:
 *
 *   - BFF proxies on :3000 — app/api/v1/{connect,social,creators,marketplace,
 *     p2p,spray,stays,events}/... Each forwards the Bearer to Go :8080 after
 *     requireRequestUser. These are the same routes the mobile app drives.
 *   - Go :8080 directly — for surfaces the BFF does not proxy (promotions
 *     banners) or where the BFF is flag-blocked (groups: FEATURE_GROUPS_ENABLED
 *     is unset in frontend-web/.env.local) or dead-ended (adminGroupTop5 admin
 *     gates that 401 for every caller).
 *
 * Member calls only need a Supabase Bearer. Go admin calls additionally need
 * x-admin-api-key (same two-gate chain the admin console uses).
 */

import type { APIRequestContext } from '@playwright/test';
import {
  ADMIN_API_KEY,
  GO_BACKEND_URL,
  provisionVerifiedUser,
  psql,
} from '../auth/helpers';

export { ADMIN_API_KEY, GO_BACKEND_URL, provisionVerifiedUser, psql };

/** Console-admin fixture — super-admin bearer, minted via the real login. */
export const ADMIN_USER = {
  email: process.env.E2E_ADMIN_EMAIL || 'admin@spotlight.internal',
  password: process.env.E2E_ADMIN_PASSWORD || 'LocalDevAdmin123!',
};

export function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** Mint an access token for an already-verified user via the real BFF login. */
export async function tokenFor(
  request: APIRequestContext,
  email: string,
  password = 'E2eLocalPass123!',
): Promise<string> {
  const res = await request.post('/api/auth/login', {
    data: { identifier: email, password },
  });
  const body = (await res.json().catch(() => null)) as {
    session?: { access_token?: string };
  } | null;
  if (!res.ok() || !body?.session?.access_token) {
    throw new Error(`login for ${email} failed (${res.status()}): ${JSON.stringify(body)}`);
  }
  return body.session.access_token;
}

/** Provision + verify a throwaway user and return it with a live token. */
export async function provisionedSession(
  request: APIRequestContext,
  tag: string,
): Promise<{ email: string; userId: string; token: string }> {
  const user = await provisionVerifiedUser(request, tag);
  const token = await tokenFor(request, user.email, user.password);
  return { email: user.email, userId: user.userId, token };
}

/** Call a Go :8080 path directly (member bearer). */
export function goFetch(
  request: APIRequestContext,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  token: string,
  data?: unknown,
) {
  return request.fetch(`${GO_BACKEND_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data,
  });
}

/** Call a Go :8080 ADMIN path (super-admin bearer + x-admin-api-key). */
export function goAdminFetch(
  request: APIRequestContext,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  adminToken: string,
  data?: unknown,
) {
  return request.fetch(`${GO_BACKEND_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'x-admin-api-key': ADMIN_API_KEY,
      'Content-Type': 'application/json',
    },
    data,
  });
}
