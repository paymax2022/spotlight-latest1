import { apiV1 } from '@/config/env';
import type { AdminMenuCounts } from '@/types/admin';
import type { AdminOverview } from '@/types/adminOverview';

export async function getAdminMenuCounts(): Promise<AdminMenuCounts | null> {
  try {
    const response = await fetch(`${apiV1()}/admin/menu-counts`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
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
export async function getAdminOverview(): Promise<AdminOverview | null> {
  try {
    const response = await fetch(`${apiV1()}/admin/overview`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });
    const payload = await response.json();
    if (!response.ok || !payload?.success || !Array.isArray(payload?.modules)) return null;
    return { generated_at: payload.generated_at, modules: payload.modules } as AdminOverview;
  } catch {
    return null;
  }
}
