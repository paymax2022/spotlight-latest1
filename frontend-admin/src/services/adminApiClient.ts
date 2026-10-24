import { apiV1, adminAuthHeaders } from '@/config/env';
import type { AdminMenuCounts } from '@/types/admin';
import type { AdminOverview } from '@/types/adminOverview';

export async function getAdminMenuCounts(): Promise<AdminMenuCounts | null> {
  try {
    const response = await fetch(`${apiV1()}/admin/menu-counts`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: adminAuthHeaders(),
    });

    const payload = await response.json();
    if (!response.ok || !payload?.success || !payload?.counts) return null;
    return payload.counts as AdminMenuCounts;
  } catch {
    return null;
  }
}

/**
 * Outcome of reading the overview. The three cases are three different
 * instructions to the operator, so they must stay distinguishable:
 *  - ok:           render it (a PARTIAL answer — some modules `value: null` —
 *                  is still ok; one unavailable module must not blank the console)
 *  - unauthorized: the backend ANSWERED and rejected the session (401/403).
 *                  GoTrue no longer recognises the token — revoked by a password
 *                  reset or a sign-out elsewhere — even though it has not expired.
 *                  The remedy is to sign in again, not to go looking for a
 *                  backend outage.
 *  - unavailable:  no usable answer — network failure, 5xx, or the proxy's 504.
 */
export type OverviewResult =
  | { status: 'ok'; overview: AdminOverview }
  | { status: 'unauthorized' }
  | { status: 'unavailable' };

export async function loadAdminOverview(): Promise<OverviewResult> {
  try {
    const response = await fetch(`${apiV1()}/admin/overview`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: adminAuthHeaders(),
    });
    if (response.status === 401 || response.status === 403) return { status: 'unauthorized' };
    const payload = await response.json();
    if (!response.ok || !payload?.success || !Array.isArray(payload?.modules)) return { status: 'unavailable' };
    return {
      status: 'ok',
      overview: { generated_at: payload.generated_at, modules: payload.modules } as AdminOverview,
    };
  } catch {
    return { status: 'unavailable' };
  }
}

/**
 * Cross-module operations overview.
 *
 * Returns null only when the call itself fails or the session was rejected;
 * callers that need to tell those apart use loadAdminOverview().
 */
export async function getAdminOverview(): Promise<AdminOverview | null> {
  const result = await loadAdminOverview();
  return result.status === 'ok' ? result.overview : null;
}
