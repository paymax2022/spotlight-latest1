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
    if (accessToken) localStorage.setItem(ADMIN_TOKEN_KEY, accessToken);
    localStorage.setItem(
      ADMIN_USER_KEY,
      JSON.stringify({
        id: data.user.id,
        email: data.user.email,
        roles: [role],
        permissions,
      }),
    );

    // Mirror the session into an HttpOnly cookie so the server-side middleware can
    // gate /admin/* (see middleware.ts + app/api/admin/session). Additive — the
    // localStorage copy still powers the service-layer Bearer calls. Best-effort:
    // a failure here must never block a successful sign-in.
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
        /* non-fatal — middleware is off by default and localStorage still works */
      }
    }
  }

  return data.user;
}

/**
 * Clears the admin session — both the localStorage copy and the server-side
 * HttpOnly cookie the middleware reads. Wire this into the sign-out control.
 */
export async function clearAdminSession(): Promise<void> {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  localStorage.removeItem(ADMIN_USER_KEY);
  try {
    await fetch('/api/admin/session', { method: 'DELETE' });
  } catch {
    /* non-fatal */
  }
}

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
    // The user record goes too. It was left behind, and roughly two dozen
    // screens plus the sidebar read it directly from localStorage — so an
    // expired session kept publishing an identity and a permission set that
    // nothing could honour any more. Only an explicit Log out click cleared it.
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    localStorage.removeItem(ADMIN_USER_KEY);
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
