'use client';

import { getSupabaseClient } from '@/services/supabaseClient';

export async function signInAdmin(username: string, password: string) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase is not configured for admin app.');

  const email = username.trim() === 'admin' ? 'admin@spotlight.internal' : username.trim();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error('Invalid credentials. Please try again.');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', data.user.id)
    .maybeSingle();

  const profileRole =
    profile && typeof (profile as { role?: unknown }).role === 'string'
      ? ((profile as { role?: string }).role ?? null)
      : null;

  const role =
    profileRole ||
    (typeof data.user.user_metadata?.role === 'string' ? data.user.user_metadata.role : null) ||
    (typeof data.user.app_metadata?.role === 'string' ? data.user.app_metadata.role : null) ||
    '';

  // Block 9 (Payments & Finance): finance_admin/finance_maker/finance_checker/
  // finance_viewer are real roles frontend-web's rbac.ts defines permissions
  // simply never allowed past THIS gate, so nobody holding them could ever
  // reach the console, regardless of what they were permissioned to do once
  // there. Mirrored from frontend-web/src/server/admin/rbac.ts's
  // is the source of truth for what the finance:* checks server-side.
  const FINANCE_ROLE_PERMISSIONS: Record<string, string[]> = {
    finance_admin: [
      'dashboard:view', 'finance:view', 'finance:refund',
      'finance:adjust:initiate', 'finance:adjust:approve',
      'utility:manage', 'utility:support', 'reports:export', 'audit:view',
    ],
    finance_maker: ['dashboard:view', 'finance:view', 'finance:adjust:initiate', 'audit:view'],
    finance_checker: ['dashboard:view', 'finance:view', 'finance:adjust:approve', 'audit:view'],
    finance_viewer: ['dashboard:view', 'finance:view', 'audit:view'],
  };

  if (role !== 'admin' && !(role in FINANCE_ROLE_PERMISSIONS)) {
    await supabase.auth.signOut();
    throw new Error('Access denied. Admin privileges required.');
  }

  // Top-level admin roles get a wildcard so the admin console UI is usable.
  // The Go backend independently enforces RBAC per-route, so this gate is UX-only.
  // Finance roles get their REAL scoped permission list instead — a wildcard
  // scoped permissions keep the sidebar/buttons honest about what actually works.
  const TOP_LEVEL_ADMIN_ROLES = ['admin', 'super-admin', 'system-admin'];
  const permissions = TOP_LEVEL_ADMIN_ROLES.includes(role)
    ? ['*']
    : (FINANCE_ROLE_PERMISSIONS[role] ?? []);

  if (typeof window !== 'undefined') {
    const accessToken = data.session?.access_token ?? '';
    // The access token is NEVER written to localStorage (CodeQL
    // js/clear-text-storage-of-sensitive-data). It lives only in the HttpOnly
    // `sb-admin-token` cookie mirrored below; the same-origin proxies
    // (/api/admin-proxy, /api/web-proxy) attach it as the upstream Bearer
    // server-side, so no browser code can read it.
    // lgtm[js/clear-text-storage-of-sensitive-data] admin profile metadata for
    // client-side RBAC rendering only — authorization is enforced server-side.
    localStorage.setItem(
      ADMIN_USER_KEY,
      JSON.stringify({
        id: data.user.id,
        email: data.user.email,
        roles: [role],
        permissions,
      }),
    );

    // Mirror the session into the HttpOnly cookie the middleware + proxies read
    // (see middleware.ts + app/api/admin/session). Best-effort: a failure here
    // must never block a successful sign-in.
    if (accessToken) {
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
