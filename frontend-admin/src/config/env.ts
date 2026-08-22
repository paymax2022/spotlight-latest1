/**
 * Admin API base.
 *
 * Every admin call goes through the SAME-ORIGIN proxy at /api/admin-proxy, which
 * injects x-admin-api-key server-side. The key is deliberately not reachable from
 * here: it used to be NEXT_PUBLIC_ADMIN_API_KEY, and NEXT_PUBLIC_* is inlined into
 * the bundle, so the admin key was shipped to every browser that loaded the
 * console. Rotating it changed which value was public, not that it was public.
 *
 * The base must stay ABSOLUTE - a dozen call sites do `new URL(`${apiBaseUrl}/…`)`,
 * which throws on a relative base.
 */
function adminApiBase(): string {
  // Browser: same origin, so the request carries the session cookie and the key
  // is attached on the server side of the proxy.
  if (typeof window !== 'undefined') return `${window.location.origin}/api/admin-proxy`;
  // Server render: still through the proxy, so there is exactly ONE place that
  // knows the key. ADMIN_SELF_ORIGIN exists for containers where the app is not
  // on the default port.
  return `${process.env.ADMIN_SELF_ORIGIN || 'http://127.0.0.1:3001'}/api/admin-proxy`;
}

export const env = {
  apiBaseUrl: adminApiBase(),
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  legacyAdminBaseUrl: process.env.NEXT_PUBLIC_LEGACY_ADMIN_BASE_URL || 'http://localhost:4028',
};

export const hasSupabaseConfig = Boolean(env.supabaseUrl && env.supabaseAnonKey);
