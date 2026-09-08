'use client';

import { getSupabaseClient } from '@/services/supabaseClient';

/**
 * Hotelier sign-up/sign-in for the Stays extranet.
 *
 * Deliberately calls supabase-js directly (signUp/signInWithPassword) rather
 * than going through the Go backend's /api/auth/* proxy that frontend-web
 * uses for its own login. That proxy exists to unify phone-or-email sign-in,
 * referral attribution and lockout bookkeeping — none of which apply to a
 * hotelier signing up with a work email for Stays. Going direct also means
 * the session this produces IS the supabase-js client's own persisted
 * session, so adminSession.ts's existing startAdminSessionSync()
 * (onAuthStateChange) picks it up and keeps it refreshed with zero extra
 * wiring — the whole reason that module exists is to avoid a second,
 * divergent copy of the token.
 *
 * auth.users insert triggers (handle_new_user etc.) still fire on this path
 * exactly as they do for any other GoTrue signUp, so user_profiles/
 * platform_users get created the same way regardless of which door was used.
 */

export class HotelierAuthError extends Error {}

function requireClient() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new HotelierAuthError('Sign-in is not configured for this deployment.');
  }
  return supabase;
}

export interface HotelierSignUpResult {
  /** False when the project requires email confirmation before a session is issued. */
  signedIn: boolean;
}

export async function signUpHotelier(fullName: string, email: string, password: string): Promise<HotelierSignUpResult> {
  const supabase = requireClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  if (error) throw new HotelierAuthError(error.message);
  return { signedIn: Boolean(data.session) };
}

export async function signInHotelier(email: string, password: string): Promise<void> {
  const supabase = requireClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new HotelierAuthError(error.message);
}

export async function currentHotelierEmail(): Promise<string | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.email ?? null;
}
