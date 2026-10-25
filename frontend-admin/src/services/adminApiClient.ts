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
 * Cross-module operations overview.
 *
 * Returns null only when the call itself fails. A PARTIAL answer — some modules
 * reporting `value: null` — is a success and must be rendered, because the whole
 * point is that one unavailable module does not blank the console.
 */
export type OverviewFailure = 'unauthorized' | 'forbidden' | 'unreachable';

export type OverviewResult =
  | { ok: true; overview: AdminOverview }
  | { ok: false; reason: OverviewFailure };

/**
 * Same call as getAdminOverview(), but says WHY it failed. The proxy answers 401
 * for a missing/expired admin session and 403 for a signed-in account without
 * access; both mean the backend is up, so telling the admin to "check the backend
 * is running" sends them the wrong way. Everything else (network error, 5xx/504
 * from the proxy, a non-JSON or malformed body) stays 'unreachable'.
 */
export async function getAdminOverviewResult(): Promise<OverviewResult> {
  try {
    const response = await fetch(`${apiV1()}/admin/overview`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: adminAuthHeaders(),
    });
    if (response.status === 401) return { ok: false, reason: 'unauthorized' };
    if (response.status === 403) return { ok: false, reason: 'forbidden' };
    const payload = await response.json();
    if (!response.ok || !payload?.success || !Array.isArray(payload?.modules)) {
      return { ok: false, reason: 'unreachable' };
    }
    return { ok: true, overview: { generated_at: payload.generated_at, modules: payload.modules } as AdminOverview };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}

export async function getAdminOverview(): Promise<AdminOverview | null> {
  const result = await getAdminOverviewResult();
  return result.ok ? result.overview : null;
}
