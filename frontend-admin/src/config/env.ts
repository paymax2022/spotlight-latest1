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
  /**
   * frontend-web's origin. Distinct from legacyAdminBaseUrl: some consoles
   * (Film Academy) live in the PUBLIC web app rather than the retired legacy
   * admin, so the generic /admin/[...slug] bridge sends people to the wrong
   * host for them. Set NEXT_PUBLIC_WEB_APP_BASE_URL per environment.
   */
  webAppBaseUrl: (process.env.NEXT_PUBLIC_WEB_APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, ''),
};

/**
 * The API root, with any trailing /api/v1 removed.
 *
 * apiBaseUrl is the same-origin proxy (<origin>/api/admin-proxy), whose path is
 * forwarded verbatim to ADMIN_API_BASE_URL. So a caller must spell out the FULL
 * backend path — the backend mounts modules at several roots (/api/finance/...,
 * /api/crowdfunding/..., /api/v1/...), and no single base can cover them all.
 */
export function apiRoot(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '').replace(/\/$/, '');
}

/**
 * The /api/v1 namespace. Use for routes Go mounts under it (the /admin/* consoles).
 *
 * These call sites used to append straight onto apiBaseUrl, which worked only while
 * that value ended in /api/v1. Once it became the proxy origin, they silently
 * dropped the namespace and 404'd. Naming the namespace explicitly means the URL no
 * longer depends on how the base happens to be spelled.
 */
export function apiV1(): string {
  return `${apiRoot()}/api/v1`;
}

export const hasSupabaseConfig = Boolean(env.supabaseUrl && env.supabaseAnonKey);
