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

  return data.user;
}
