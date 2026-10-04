'use client';

import { getSupabaseClient } from '@/services/supabaseClient';
import { apiV1 } from '@/config/env';

export async function signInAdmin(username: string, password: string) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase is not configured for admin app.');

  const email = username.trim() === 'admin' ? 'admin@spotlight.internal' : username.trim();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error('Invalid credentials. Please try again.');

  const accessToken = data.session?.access_token ?? '';

  // Mirror the session into the HttpOnly cookie the middleware + proxies read
  // (see middleware.ts + app/api/admin/session) BEFORE the admin check below:
  // the probe goes through /api/admin-proxy, which attaches the bearer token
  // server-side from that cookie — and refuses cookieless calls outright when
  // ADMIN_MIDDLEWARE_ENFORCE is on. Best-effort as before; the Authorization
  // fallback on the probe covers a missed write in the non-enforce setup.
  if (typeof window !== 'undefined' && accessToken) {
    const expSec = data.session?.expires_at
      ? Math.max(60, Math.floor(data.session.expires_at - Date.now() / 1000))
      : 3600;
    try {
      await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: accessToken, maxAge: expSec }),
      });
    } catch {
      /* non-fatal — the next syncAdminSession() re-mirrors it */
    }
  }

  // E2E-AUTH-008 (AUTH-005 F3): the admission decision is the BACKEND's verdict,
  // not user_profiles.role. The two role stores disagree and every admin API
  // enforces public.user_roles/RBAC — trusting the profile store admitted
  // operators the backend refuses on every route. menu-counts sits behind
  // RequireAdminConsoleRole — the same middleware guarding the console surface
  // — so its answer IS the answer the console will get. Anything but a 2xx
  // (403 non-admin, 401 bad session, 504 unreachable upstream) means the
  // backend did not admit this identity: refuse, fail-closed, rather than
  // guessing yes from a store the enforcement layer ignores.
  let backendAdmits = false;
  try {
    const probe = await fetch(`${apiV1()}/admin/menu-counts`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    });
    backendAdmits = probe.ok;
  } catch {
    backendAdmits = false;
  }

  if (!backendAdmits) {
    await supabase.auth.signOut();
    if (typeof window !== 'undefined') {
      try {
        await fetch('/api/admin/session', { method: 'DELETE' });
      } catch {
        /* non-fatal */
      }
    }
    throw new Error('Access denied. Admin privileges required.');
  }

  if (typeof window !== 'undefined') {
    // The access token is NEVER written to localStorage (CodeQL
    // js/clear-text-storage-of-sensitive-data). It lives only in the HttpOnly
    // `sb-admin-token` cookie mirrored above; the same-origin proxies
    // (/api/admin-proxy, /api/web-proxy) attach it as the upstream Bearer
    // server-side, so no browser code can read it.
    // lgtm[js/clear-text-storage-of-sensitive-data] admin profile metadata for
    // client-side RBAC rendering only — authorization is enforced server-side.
    //
    // Reaching here means the backend itself established the operator holds a
    // console-admin role (super-admin/system-admin — the only roles
    // RequireAdminConsoleRole admits), so wildcard permissions are the honest
    // display for the sidebar/routeGuard, exactly as the old 'admin' branch was.
    localStorage.setItem(
      ADMIN_USER_KEY,
      JSON.stringify({
        id: data.user.id,
        email: data.user.email,
        roles: ['admin'],
        permissions: ['*'],
      }),
    );
  }

  return data.user;
}

/**
 * Clears the admin session — the operator metadata and the HttpOnly cookie the
 * middleware + proxies read — and signs the supabase-js client out too. Wire
 * this into the sign-out control.
 *
 * The supabase signOut matters: without it the client's persisted session keeps
 * its refresh token alive, and the next syncAdminSession() would mint a fresh
 * access token and silently re-mirror it into the cookie — resurrecting the
 * session the operator just ended.
 */
export async function clearAdminSession(): Promise<void> {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(ADMIN_USER_KEY);
  try {
    await fetch('/api/admin/session', { method: 'DELETE' });
  } catch {
    /* non-fatal */
  }
  try {
    const supabase = getSupabaseClient();
    await supabase?.auth.signOut();
  } catch {
    /* non-fatal */
  }
}

/**
 * Keeps the console's session cookie fresh.
 *
 * WHY THIS EXISTS: the Supabase access token the console sends (now via the
 * HttpOnly cookie the proxies read, never via JS-readable storage) lives only
 * 3600s. Supabase-js refreshes its own persisted session, but only while an
 * instance is alive — and outside the login page nothing else constructed one.
 * Without this module a console left open past the hour still had the
 * `spotlight_admin_user` record and looked signed in while every proxied call
 * answered 401. So this module instantiates the client (starting its
 * auto-refresh timer) and mirrors every token it produces into the session
 * cookie the middleware and proxies read.
 */

export const ADMIN_USER_KEY = 'spotlight_admin_user';

/**
 * Mirrors the session into the HttpOnly cookie middleware.ts and the proxy
 * route handlers read. Best-effort: a failure here must never break a working
 * session — the next refresh or guard pass retries it.
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

/** Clears the server-side session cookie. Best-effort. */
async function dropCookie(): Promise<void> {
  try {
    await fetch('/api/admin/session', { method: 'DELETE' });
  } catch {
    /* non-fatal */
  }
}

/**
 * Pulls the current Supabase session (refreshing it if the access token has
 * expired but the refresh token is still good) and re-mirrors it into the
 * session cookie.
 *
 * Resolves true when a live session exists — i.e. when it is safe to render
 * pages that will immediately call the API. False means the session is
 * genuinely gone and the caller should send the operator to /login.
 */
export async function syncAdminSession(): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  const supabase = getSupabaseClient();
  if (!supabase) {
    // No Supabase client means there is no session source at all — nothing was
    // ever mirrored into the cookie, so there is no session to honour.
    return false;
  }

  // getSession() performs the refresh itself when the access token has expired.
  const { data, error } = await supabase.auth.getSession();
  const session = data?.session ?? null;

  if (error || !session?.access_token) {
    // No recoverable session. Drop the operator record and the stale cookie so
    // the guard cannot wave the operator through into a console that answers
    // 401 on every request.
    localStorage.removeItem(ADMIN_USER_KEY);
    void dropCookie();
    return false;
  }

  await mirrorCookie(session.access_token, session.expires_at);
  return true;
}

/**
 * Starts mirroring every subsequent token the client mints (hourly refreshes,
 * sign-in, sign-out) into the session cookie. Returns an unsubscribe function.
 */
export function startAdminSessionSync(): () => void {
  const supabase = getSupabaseClient();
  if (!supabase) return () => {};

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      localStorage.removeItem(ADMIN_USER_KEY);
      void dropCookie();
      return;
    }
    if (!session?.access_token) return;
    void mirrorCookie(session.access_token, session.expires_at);
  });

  return () => data.subscription.unsubscribe();
}
