'use client';

import { getSupabaseClient } from '@/services/supabaseClient';

/**
 * Keeps the console's Bearer token alive.
 *
 * WHY THIS EXISTS: signInAdmin wrote the Supabase access token into
 * localStorage ONCE, and ~30 services read that copy synchronously for their
 * Authorization header. Supabase access tokens live 3600s, and nothing ever
 * rewrote the copy — so exactly one hour after signing in, every live console
 * page started answering 401 while AdminRouteGuard (which only checked that the
 * key was PRESENT) still considered the operator signed in. The console looked
 * logged in and worked for nothing; the only recovery was signing out and back
 * in, which nobody could guess from a page reading "Withdrawals failed: 401".
 *
 * The supabase-js client refreshes its own persisted session, but only while an
 * instance is alive — and outside the login page nothing ever constructed one.
 * So this module does both halves: it instantiates the client (which starts the
 * auto-refresh timer and rehydrates the persisted session) and mirrors every
 * token it produces back onto the legacy key the services read.
 */

export const ADMIN_TOKEN_KEY = 'spotlight_admin_access_token';
export const ADMIN_USER_KEY = 'spotlight_admin_user';

/**
 * Treat a token with less than this left as already dead. A token that passes
 * the guard with 3s of life expires mid-flight and produces the same 401 this
 * module exists to remove.
 */
const SKEW_SECONDS = 60;

function expiryOf(token: string): number | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp : null;
  } catch {
    return null;
  }
}

/** False when the token is missing or (nearly) expired. */
export function isTokenUsable(token: string | null | undefined): boolean {
  if (!token) return false;
  const exp = expiryOf(token);
  // Unparseable: let the backend be the judge rather than locking the operator
  // out of a console that might be perfectly reachable.
  if (exp === null) return true;
  return exp - SKEW_SECONDS > Date.now() / 1000;
}

/** The token the service layer will send on its next call. */
export function currentAdminToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

/**
 * Mirrors the session into the HttpOnly cookie middleware.ts reads. Best-effort,
 * exactly as in signInAdmin: a failure here must never break a working session.
 */
async function mirrorCookie(token: string, expiresAt?: number | null): Promise<void> {
  const maxAge = expiresAt ? Math.max(60, Math.floor(expiresAt - Date.now() / 1000)) : 3600;
  try {
    await fetch('/api/admin/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, maxAge }),
    });
  } catch {
    /* non-fatal */
  }
}

function writeToken(token: string, expiresAt?: number | null): void {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
  void mirrorCookie(token, expiresAt);
}

/**
 * Pulls the current Supabase session (refreshing it if the access token has
 * expired but the refresh token is still good) and republishes it onto the
 * legacy key.
 *
 * Resolves true when a usable Bearer token is in place afterwards — i.e. when it
 * is safe to render pages that will immediately call the API. False means the
 * session is genuinely gone and the caller should send the operator to /login.
 */
export async function syncAdminSession(): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  const supabase = getSupabaseClient();
  if (!supabase) {
    // Supabase not configured for this deployment — fall back to whatever is
    // stored so a non-Supabase auth setup is not broken by this module.
    return isTokenUsable(currentAdminToken());
  }

  // getSession() performs the refresh itself when the access token has expired.
  const { data, error } = await supabase.auth.getSession();
  const session = data?.session ?? null;

  if (error || !session?.access_token) {
    // No recoverable session. Drop the stale copy so the guard cannot wave the
    // operator through into a console that answers 401 on every request.
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    return false;
  }

  writeToken(session.access_token, session.expires_at);
  return true;
}

/**
 * Starts mirroring every subsequent token the client mints (hourly refreshes,
 * sign-in, sign-out) onto the legacy key. Returns an unsubscribe function.
 */
export function startAdminSessionSync(): () => void {
  const supabase = getSupabaseClient();
  if (!supabase) return () => {};

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session?.access_token) {
      if (event === 'SIGNED_OUT') localStorage.removeItem(ADMIN_TOKEN_KEY);
      return;
    }
    writeToken(session.access_token, session.expires_at);
  });

  return () => data.subscription.unsubscribe();
}
