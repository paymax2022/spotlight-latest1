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
  // for (finance:adjust:initiate, finance:adjust:approve, ...) — they were
  // simply never allowed past THIS gate, so nobody holding them could ever
  // reach the console, regardless of what they were permissioned to do once
  // there. Mirrored from frontend-web/src/server/admin/rbac.ts's
  // rolePermissions map — keep the two in sync if either changes; that file
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
  // here would let e.g. finance_viewer see every write action's button even
  // though the server-side finance:adjust:initiate check would then 403 it;
  // scoped permissions keep the sidebar/buttons honest about what actually works.
  const TOP_LEVEL_ADMIN_ROLES = ['admin', 'super-admin', 'system-admin'];
  const permissions = TOP_LEVEL_ADMIN_ROLES.includes(role)
    ? ['*']
    : (FINANCE_ROLE_PERMISSIONS[role] ?? []);

  if (typeof window !== 'undefined') {
    const accessToken = data.session?.access_token ?? '';
    if (accessToken) localStorage.setItem('spotlight_admin_access_token', accessToken);
    localStorage.setItem(
      'spotlight_admin_user',
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
  localStorage.removeItem('spotlight_admin_access_token');
  localStorage.removeItem('spotlight_admin_user');
  try {
    await fetch('/api/admin/session', { method: 'DELETE' });
  } catch {
    /* non-fatal */
  }
}
