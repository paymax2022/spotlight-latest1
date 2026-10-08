/**
 * Shared helpers for the ADMIN-module E2E validation specs.
 *
 * The admin console is a SEPARATE Next app on :3001 (frontend-admin), so every
 * navigation here uses absolute URLs built on ADMIN_WEB_URL — Playwright's
 * baseURL still points at the public web app (:3000), which is also where
 * loginViaApi posts /api/auth/login (it proxies to the Go backend on :8080).
 *
 * Two admin identities matter:
 *   - UI session: signInAdmin() writes the Supabase access token into the
 *     HttpOnly `sb-admin-token` cookie (:3001) plus the operator record in
 *     localStorage (`spotlight_admin_user`). Middleware + admin-proxy both
 *     verify the cookie; AdminRouteGuard additionally wants the localStorage
 *     record, so only a REAL UI login (or a full reproduction of both stores)
 *     gets the console to render.
 *   - API bearer: loginViaApi() on the web app returns a Supabase access token
 *     usable directly against :8080 with the x-admin-api-key header — the same
 *     credential pair the admin-proxy attaches server-side.
 */

import { expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { ADMIN_API_KEY, ADMIN_WEB_URL, GO_BACKEND_URL } from '../auth/helpers';
import { loginViaApi } from '../helpers/auth';

export { ADMIN_API_KEY, ADMIN_WEB_URL, GO_BACKEND_URL };

/** Console-admin fixture (super-admin in public.user_roles). Read/login only — never mutated. */
export const ADMIN_USER = {
  email: process.env.E2E_ADMIN_EMAIL || 'admin@spotlight.internal',
  password: process.env.E2E_ADMIN_PASSWORD || 'LocalDevAdmin123!',
};

/**
 * Drive the real /admin/login form on :3001 exactly as an operator would.
 * Resolves once the console has landed on an authenticated /admin/* route with
 * the shell (sidebar) rendered. Throws if the login is denied.
 */
export async function adminLoginViaUi(page: Page, user = ADMIN_USER): Promise<void> {
  await page.goto(`${ADMIN_WEB_URL}/admin/login`);
  const userInput = page.locator('input').first();
  const passInput = page.locator('input[type="password"]');
  await expect(userInput).toBeVisible({ timeout: 30_000 });
  await userInput.fill(user.email);
  await passInput.fill(user.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();

  await page.waitForURL(
    (url) => {
      const p = url.pathname;
      return p === '/admin' || (p.startsWith('/admin/') && !p.startsWith('/admin/login'));
    },
    { timeout: 45_000 },
  );
  // The shell renders only after AdminRouteGuard's session sync; the operator
  // email in the sidebar is the honest "console is live" marker.
  await expect(page.getByText(user.email)).toBeVisible({ timeout: 30_000 });
}

/**
 * Mint an admin bearer token via the web app's /api/auth/login (Go backend),
 * the same token admin-proxy would attach upstream.
 */
export async function adminAccessToken(
  context: BrowserContext,
  request: APIRequestContext,
): Promise<string> {
  const { accessToken } = await loginViaApi(context, request, ADMIN_USER);
  return accessToken;
}

/** GET a Go-backend admin API path directly with admin bearer + api key. */
export async function adminApiGet(request: APIRequestContext, path: string, token: string) {
  return request.get(`${GO_BACKEND_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'x-admin-api-key': ADMIN_API_KEY },
  });
}

/** Same, for callers holding a non-admin user token (RBAC probes). */
export async function apiGetAs(request: APIRequestContext, path: string, token: string) {
  return request.get(`${GO_BACKEND_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'x-admin-api-key': ADMIN_API_KEY },
  });
}

export async function adminApiSend(
  request: APIRequestContext,
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  token: string,
  data?: unknown,
) {
  return request.fetch(`${GO_BACKEND_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'x-admin-api-key': ADMIN_API_KEY,
      'Content-Type': 'application/json',
    },
    data,
  });
}

/** Collect every /api/admin-proxy response while `fn` runs (UI traffic capture). */
export interface ProxyHit {
  url: string;
  status: number;
}

export function watchAdminProxy(page: Page): { hits: ProxyHit[]; stop: () => void } {
  const hits: ProxyHit[] = [];
  const listener = (res: import('@playwright/test').Response) => {
    const u = res.url();
    // Both same-origin data paths: admin-proxy → Go :8080, web-proxy → the
    // public web app's BFF (:3000) for the Path-A modules (contests etc.).
    if (u.includes('/api/admin-proxy/') || u.includes('/api/web-proxy/')) {
      hits.push({ url: u, status: res.status() });
    }
  };
  page.on('response', listener);
  return { hits, stop: () => page.off('response', listener) };
}

/** Upstream path part of a proxy URL (e.g. /api/v1/admin/menu-counts). */
export function upstreamOf(hit: ProxyHit): string {
  const admin = hit.url.split('/api/admin-proxy/')[1];
  if (admin && admin !== hit.url) return `go:${admin}`;
  const web = hit.url.split('/api/web-proxy/')[1];
  if (web && web !== hit.url) return `web:${web}`;
  return hit.url;
}

/** Heuristics for a broken page render — Next error overlay / error boundary. */
export async function pageLooksBroken(page: Page): Promise<string | null> {
  const markers = [
    /application error/i,
    /something went wrong/i,
    /unhandled runtime error/i,
    /Internal Server Error/i,
  ];
  const body = (await page.locator('body').innerText().catch(() => '')) || '';
  for (const m of markers) {
    const hit = body.match(m);
    if (hit) return hit[0];
  }
  return null;
}
