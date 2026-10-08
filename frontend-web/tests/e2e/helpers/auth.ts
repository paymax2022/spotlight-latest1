/**
 * Real-auth helpers for the Playwright E2E suite.
 *
 * Two login paths are provided, both real (no mocking):
 *
 *   loginViaUi   — drives app/login/page.tsx exactly as a user would: fills
 *                  the email/password form, submits to /api/auth/login
 *                  (which proxies to the Go backend), lets the page adopt the
 *                  returned session via supabase.auth.setSession, and waits
 *                  for the authenticated redirect.
 *
 *   loginViaApi  — fast path for specs that need an authenticated browser
 *                  context but are not themselves testing login. Calls
 *                  POST /api/auth/login through Playwright's request fixture,
 *                  then writes the session into the context's cookie jar in
 *                  exactly the format @supabase/ssr's browser client uses
 *                  (base64url JSON, chunked at 3180 encoded chars under
 *                  `sb-<ref>-auth-token`), so src/middleware.ts's getUser()
 *                  gate accepts it.
 *
 * Fixture user (provisioned by scripts/dev/ensure-dev-login.sh):
 *   qa-claude-test@spotlight.internal / LocalDevAdmin123!
 * Override with E2E_USER_EMAIL / E2E_USER_PASSWORD.
 */

import { expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const AUTH_STATE_DIR = path.join(__dirname, '..', '.auth');
export const AUTH_STATE_PATH = path.join(AUTH_STATE_DIR, 'user.json');

export const TEST_USER = {
  email: process.env.E2E_USER_EMAIL || 'qa-claude-test@spotlight.internal',
  password: process.env.E2E_USER_PASSWORD || 'LocalDevAdmin123!',
};

export const LOGIN_ROUTE = '/login';
/** Any route matched by PROTECTED_PATTERNS in src/middleware.ts. */
export const PROTECTED_ROUTE = '/user-dashboard';

/** Mailpit (local mail capture) API base — used for the OTP-login MFA path. */
const MAILPIT_URL = process.env.E2E_MAILPIT_URL || 'http://localhost:54324';

// ── selectors — from app/login/page.tsx ──────────────────────────────────────
const EMAIL_INPUT = 'input[type="email"]';
const PASSWORD_INPUT = 'input[type="password"]';
const SUBMIT_BUTTON = 'form button[type="submit"]';
/** Rendered verbatim by toReadableAuthError for a wrong password. */
export const BAD_CREDENTIALS_TEXT = /invalid email or password/i;
/** MFA step-up panel (FEATURE_OTP_LOGIN_MFA_ENABLED; off by default locally). */
const OTP_INPUT = 'input[autocomplete="one-time-code"]';

function sessionCookieName(supabaseUrl: string): string {
  // Matches @supabase/supabase-js: `sb-${hostname.split('.')[0]}-auth-token`.
  const host = new URL(supabaseUrl).hostname.split('.')[0];
  return `sb-${host}-auth-token`;
}

function base64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

/**
 * Serialize a GoTrue session into the cookie shape written by @supabase/ssr's
 * browser client: `'base64-' + base64url(JSON.stringify(session))`, chunked
 * into `name.0`, `name.1`, … when the encoded value exceeds 3180 chars
 * (utils/chunker MAX_CHUNK_SIZE). The encoded value here is pure ASCII, so the
 * escape-boundary handling in createChunks is a straight slice.
 */
function sessionCookies(baseUrl: string, session: unknown): Array<{ name: string; value: string; domain: string; path: string }> {
  const supabaseUrl = process.env.E2E_SUPABASE_URL || 'http://127.0.0.1:54321';
  const name = sessionCookieName(supabaseUrl);
  const encoded = `base64-${base64url(JSON.stringify(session))}`;
  const domain = new URL(baseUrl).hostname;
  const MAX = 3180;

  const cookies: Array<{ name: string; value: string; domain: string; path: string }> = [];
  if (encoded.length <= MAX) {
    cookies.push({ name, value: encoded, domain, path: '/' });
  } else {
    for (let i = 0, off = 0; off < encoded.length; i += 1, off += MAX) {
      cookies.push({ name: `${name}.${i}`, value: encoded.slice(off, off + MAX), domain, path: '/' });
    }
  }
  return cookies;
}

/**
 * API-login fast path. Returns the signed-in user payload.
 * Throws if the app doesn't return a session (e.g. MFA required).
 */
export async function loginViaApi(
  context: BrowserContext,
  request: APIRequestContext,
  user = TEST_USER,
): Promise<{ accessToken: string }> {
  const res = await request.post('/api/auth/login', {
    data: { identifier: user.email, password: user.password },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`API login failed (${res.status}): ${body?.error ?? 'unknown error'}`);
  }
  if (body?.mfaRequired) {
    throw new Error('API login hit the OTP-MFA step — use loginViaUi (it redeems the code via Mailpit).');
  }
  const session = body?.session;
  if (!session?.access_token || !session?.refresh_token) {
    throw new Error('API login returned no session tokens.');
  }
  const base = process.env.E2E_BASE_URL || 'http://localhost:3000';
  await context.addCookies(sessionCookies(base, session));
  return { accessToken: session.access_token };
}

/**
 * Pull the newest numeric OTP code mailed to `email` from Mailpit.
 * Returns null when Mailpit is unreachable or no code is found.
 */
async function fetchLatestOtpCode(request: APIRequestContext, email: string): Promise<string | null> {
  try {
    const res = await request.get(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=5`,
    );
    if (!res.ok()) return null;
    const list = (await res.json()) as { messages?: Array<{ ID: string }> };
    for (const head of list.messages ?? []) {
      const msg = await request.get(`${MAILPIT_URL}/api/v1/message/${head.ID}`);
      if (!msg.ok()) continue;
      const body = (await msg.json()) as { Text?: string };
      const match = (body.Text ?? '').match(/\b(\d{6})\b/);
      if (match) return match[1];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Drive the real login UI. Waits for the authenticated landing (default
 * `next` is /user-dashboard). Handles the OTP-login MFA step-up by redeeming
 * the code from Mailpit when the flag is on.
 */
export async function loginViaUi(
  page: Page,
  request: APIRequestContext,
  user = TEST_USER,
  next = PROTECTED_ROUTE,
): Promise<void> {
  await page.goto(LOGIN_ROUTE);
  await expect(page.locator(EMAIL_INPUT)).toBeVisible();

  await page.locator(EMAIL_INPUT).fill(user.email);
  await page.locator(PASSWORD_INPUT).fill(user.password);
  await page.locator(SUBMIT_BUTTON).click();

  // Either we land on `next`, or the MFA code panel appears.
  const landed = page.waitForURL(`**${next}**`, { timeout: 30_000 }).then(() => 'landed' as const);
  const mfa = page.locator(OTP_INPUT).waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'mfa' as const);
  const outcome = await Promise.race([landed, mfa]);

  if (outcome === 'mfa') {
    const code = await fetchLatestOtpCode(request, user.email);
    if (!code) {
      throw new Error(
        `OTP-login MFA is enabled and no code for ${user.email} was found in Mailpit (${MAILPIT_URL}).`,
      );
    }
    await page.locator(OTP_INPUT).fill(code);
    await page.getByRole('button', { name: /verify & sign in/i }).click();
    await page.waitForURL(`**${next}**`, { timeout: 30_000 });
  }

  // Authenticated app content, not just the URL: the dashboard renders this.
  await expect(page.getByText(/welcome back/i)).toBeVisible();
}

/**
 * Sign out through the real UI when possible. The only sign-out control lives
 * in the header offcanvas behind `.sidebar__toggle`, which is `d-xl-block` —
 * hidden below a 1200px viewport. When it isn't reachable (mobile-chrome),
 * clearing the context's cookies ends the session identically as far as the
 * middleware auth gate is concerned.
 */
export async function signOut(page: Page): Promise<void> {
  const toggle = page.locator('.sidebar__toggle').first();
  const toggleVisible = await toggle.isVisible().catch(() => false);

  if (toggleVisible) {
    await toggle.click();
    const signOutButton = page.getByRole('button', { name: /sign out/i });
    await expect(signOutButton).toBeVisible();
    await signOutButton.click();
    // signOut() pushes '/' — wait for navigation away so cookies are cleared
    // before the caller navigates to a protected route.
    await page.waitForURL(/\/$/, { timeout: 15_000 }).catch(() => undefined);
  } else {
    await page.context().clearCookies();
  }
}

/** Persist the context's storage state under tests/e2e/.auth/ (gitignored). */
export async function saveAuthState(context: BrowserContext, filePath = AUTH_STATE_PATH): Promise<void> {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await context.storageState({ path: filePath });
}

/**
 * TEST-013 — provision a throwaway, already-confirmed GoTrue user through the
 * admin API so a spec can own its session lifecycle (e.g. a real logout must
 * NOT revoke the shared qa-claude-test session other workers rely on).
 * Requires SUPABASE_SERVICE_ROLE_KEY (playwright.config loads .env.local).
 */
export async function provisionConfirmedUser(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const supabaseUrl = process.env.E2E_SUPABASE_URL || 'http://127.0.0.1:54321';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY unset — cannot provision a per-spec user');
  }
  const res = await request.post(`${supabaseUrl}/auth/v1/admin/users`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    data: { email, password, email_confirm: true },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok() && !body?.id) {
    throw new Error(`provision user failed (${res.status()}): ${JSON.stringify(body)}`);
  }
  return body.id as string;
}

/** Remove a user provisioned via provisionConfirmedUser (admin API). */
export async function deleteProvisionedUser(request: APIRequestContext, userId: string): Promise<void> {
  const supabaseUrl = process.env.E2E_SUPABASE_URL || 'http://127.0.0.1:54321';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return;
  await request
    .delete(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    })
    .catch(() => undefined);
}
