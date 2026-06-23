import { createClient } from '@supabase/supabase-js';

/** Anon-key client — use for user-facing signIn/signUp/OTP operations */
export function createAnonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** Service-role client — use for admin operations and token validation */
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** Extract Bearer token from Authorization header */
export function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get('authorization') ?? '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return null;
}

/** Shape the user response the mobile mapUserFromApi expects */
export function formatUser(authUser: any, profile: any) {
  return {
    id: authUser.id,
    fullName: profile?.full_name || authUser.user_metadata?.full_name || '',
    email: authUser.email ?? '',
    phone: profile?.phone || authUser.user_metadata?.phone || undefined,
    walletBalance: 0, // fetched separately by the wallet screen
    kycStatus: profile?.kyc_status || undefined,
  };
}
