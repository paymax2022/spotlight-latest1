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
    (typeof data.user.app_metadata?.role === 'string' ? data.user.app_metadata.role : null);

  if (role !== 'admin') {
    await supabase.auth.signOut();
    throw new Error('Access denied. Admin privileges required.');
  }

  // Top-level admin roles get a wildcard so the admin console UI is usable.
  // The Go backend independently enforces RBAC per-route, so this gate is UX-only.
  const TOP_LEVEL_ADMIN_ROLES = ['admin', 'super-admin', 'system-admin'];
  const permissions = TOP_LEVEL_ADMIN_ROLES.includes(role) ? ['*'] : [];

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
  }

  return data.user;
}
