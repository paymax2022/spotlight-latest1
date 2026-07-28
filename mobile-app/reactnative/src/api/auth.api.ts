import type { Session, User as SupabaseUser } from '@supabase/supabase-js';
import { createSupabaseClient } from '@/lib/supabase';
import { getSecureItem } from '@/lib/secureStorage';
import { AuthResult, User } from '@/types/auth';

type ProfileRow = {
  id?: string | null;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  kyc_status?: string | null;
};

function readableAuthError(error: unknown, fallback: string): Error {
  const message = error instanceof Error ? error.message : '';
  const lowered = message.toLowerCase();

  if (
    lowered.includes('failed to fetch') ||
    lowered.includes('network request failed') ||
    lowered.includes('err_connection_refused')
  ) {
    return new Error('Authentication service is unreachable. Confirm local Supabase is running and try again.');
  }

  if (lowered.includes('invalid login credentials')) {
    return new Error('Invalid email or password.');
  }

  if (lowered.includes('already registered') || lowered.includes('already been registered')) {
    return new Error('This email already has an account. Please sign in instead.');
  }

  return new Error(message || fallback);
}

function userFromSupabase(authUser: SupabaseUser, profile?: ProfileRow | null): User {
  const metadata = authUser.user_metadata ?? {};
  const fullName =
    profile?.full_name ||
    (typeof metadata.full_name === 'string' ? metadata.full_name : '') ||
    (typeof metadata.fullName === 'string' ? metadata.fullName : '') ||
    authUser.email ||
    '';

  const phone =
    profile?.phone ||
    (typeof metadata.phone === 'string' ? metadata.phone : '');

  return {
    id: authUser.id,
    fullName,
    email: profile?.email || authUser.email || '',
    phone,
    walletBalance: 0,
    kycStatus: profile?.kyc_status || undefined,
  };
}

async function profileForUser(userId: string): Promise<ProfileRow | null> {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, full_name, email, phone, kyc_status')
    .eq('id', userId)
    .maybeSingle();

  if (error) return null;
  return data as ProfileRow | null;
}

async function mapSession(session: Session | null, fallbackUser?: SupabaseUser | null): Promise<AuthResult> {
  const authUser = session?.user || fallbackUser;
  if (!authUser) throw new Error('Authentication failed. Please try again.');

  const profile = await profileForUser(authUser.id);
  return {
    user: userFromSupabase(authUser, profile),
    tokens: {
      accessToken: session?.access_token ?? '',
      refreshToken: session?.refresh_token,
    },
  };
}

async function restoreSessionFromStoredTokens() {
  const supabase = createSupabaseClient();
  const accessToken = await getSecureItem('access_token');
  const refreshToken = await getSecureItem('refresh_token');

  if (accessToken && refreshToken) {
    await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
  }
}

export async function login(payload: { email: string; password: string }): Promise<AuthResult> {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: payload.email.trim().toLowerCase(),
    password: payload.password,
  });

  if (error) throw readableAuthError(error, 'Sign in failed. Please try again.');
  return mapSession(data.session, data.user);
}

export async function register(payload: {
  fullName: string;
  email: string;
  phone: string;
  password: string;
}): Promise<AuthResult> {
  const supabase = createSupabaseClient();
  const email = payload.email.trim().toLowerCase();
  const { data, error } = await supabase.auth.signUp({
    email,
    password: payload.password,
    options: {
      data: {
        full_name: payload.fullName.trim(),
        fullName: payload.fullName.trim(),
        phone: payload.phone.trim(),
      },
    },
  });

  if (error) throw readableAuthError(error, 'Sign up failed. Please try again.');

  if (data.user) {
    await supabase.from('user_profiles').upsert({
      id: data.user.id,
      email,
      full_name: payload.fullName.trim(),
      phone: payload.phone.trim(),
    });
  }

  return mapSession(data.session, data.user);
}

export async function verifyOtp(payload: { email: string; otp: string }): Promise<void> {
  const supabase = createSupabaseClient();
  const { error } = await supabase.auth.verifyOtp({
    email: payload.email.trim().toLowerCase(),
    token: payload.otp,
    type: 'signup',
  });

  if (error) throw readableAuthError(error, 'Verification failed. Please try again.');
}

export async function resendOtp(payload: { email: string }): Promise<void> {
  const supabase = createSupabaseClient();
  const { error } = await supabase.auth.resend({
    email: payload.email.trim().toLowerCase(),
    type: 'signup',
  });

  if (error) throw readableAuthError(error, 'Could not resend the verification email. Please try again.');
}

export async function forgotPassword(payload: { email: string }): Promise<void> {
  const supabase = createSupabaseClient();
  const redirectTo = process.env.EXPO_PUBLIC_PASSWORD_RESET_REDIRECT_URL || undefined;
  const { error } = await supabase.auth.resetPasswordForEmail(payload.email.trim().toLowerCase(), {
    redirectTo,
  });

  if (error) throw readableAuthError(error, 'Could not send reset link. Please try again.');
}

export async function resetPassword(payload: { password: string }): Promise<void> {
  const supabase = createSupabaseClient();
  // Session is already established by the deep-link recovery handler before
  // this function is called — just update the password in the active session.
  const { error } = await supabase.auth.updateUser({ password: payload.password });
  if (error) throw readableAuthError(error, 'Could not reset password. Please try again.');
}

export async function getMe(): Promise<User> {
  const supabase = createSupabaseClient();
  await restoreSessionFromStoredTokens();

  const { data, error } = await supabase.auth.getUser();
  if (error) throw readableAuthError(error, 'Could not load your profile. Please sign in again.');
  if (!data.user) throw new Error('Could not load your profile. Please sign in again.');

  const profile = await profileForUser(data.user.id);
  return userFromSupabase(data.user, profile);
}

export async function logout(): Promise<void> {
  const supabase = createSupabaseClient();
  await supabase.auth.signOut();
}
