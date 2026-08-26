import type { Session, User as SupabaseUser } from '@supabase/supabase-js';
import { api } from '@/api/client';
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

/**
 * Sign in with an email OR a phone number.
 *
 * This goes through the BACKEND login proxy rather than calling Supabase directly,
 * and that indirection is the point: the phone→account lookup happens server-side and
 * the account email is never returned. A client-side "resolve my phone to an email"
 * call would be an enumeration oracle — anyone could walk a range of numbers and
 * harvest the address behind each. Here an unknown phone is indistinguishable from a
 * wrong password.
 *
 * The proxy returns a real Supabase session, which is handed to the client so every
 * other screen (all of which read the Supabase session) keeps working unchanged.
 */
export async function login(payload: { identifier: string; password: string }): Promise<AuthResult> {
  const identifier = payload.identifier.trim();
  const res = await api.post('/api/auth/login', { identifier, password: payload.password });

  const session = (res?.data as { session?: Record<string, unknown> })?.session;
  const accessToken = typeof session?.access_token === 'string' ? session.access_token : '';
  const refreshToken = typeof session?.refresh_token === 'string' ? session.refresh_token : '';
  if (!accessToken || !refreshToken) {
    throw new Error('Sign in failed. Please try again.');
  }

  // Adopt the session into the Supabase client so the rest of the app — which reads
  // the session for its bearer token — is unaffected by where sign-in happened.
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) throw readableAuthError(error, 'Sign in failed. Please try again.');
  return mapSession(data.session, data.user);
}

/**
 * Registration goes through the gateway, exactly as login does.
 *
 * This used to call supabase.auth.signUp straight from the CLIENT, which made it
 * a third registration implementation alongside the web route and Go. Only the
 * web one attributed referrals and only Go wrote an audit event, so what a new
 * account ended up with depended on where it was created.
 *
 * Go now owns registration: it sets the metadata the profile trigger reads,
 * writes the phone the trigger does not copy, attributes the referral, and
 * records the audit event.
 */
export async function register(payload: {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  referralCode?: string;
}): Promise<AuthResult> {
  const email = payload.email.trim().toLowerCase();
  const res = await api.post('/api/auth/register', {
    fullName: payload.fullName.trim(),
    email,
    phone: payload.phone.trim(),
    password: payload.password,
    referralCode: payload.referralCode ?? '',
  });

  const data = res?.data as {
    user?: { id?: string; email?: string; fullName?: string };
    tokens?: { accessToken?: string; refreshToken?: string };
    needsVerification?: boolean;
  };

  const accessToken = data?.tokens?.accessToken ?? '';
  const refreshToken = data?.tokens?.refreshToken ?? '';

  // No session means a code is pending. Return a result whose accessToken is
  // empty, because authStore derives needsOtp from exactly that.
  if (!accessToken || !refreshToken) {
    return {
      user: {
        id: data?.user?.id ?? '',
        email: data?.user?.email ?? email,
        fullName: data?.user?.fullName ?? payload.fullName.trim(),
      } as AuthResult['user'],
      tokens: { accessToken: '', refreshToken: undefined },
    };
  }

  // Adopt the session so the rest of the app — which reads it for its bearer
  // token — is unaffected by where registration happened. Same as login.
  const supabase = createSupabaseClient();
  const { data: adopted, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) throw readableAuthError(error, 'Sign up failed. Please try again.');
  return mapSession(adopted.session, adopted.user);
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
