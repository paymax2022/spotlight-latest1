import { env } from '@/config/env';
import type { AdminMenuCounts } from '@/types/admin';

export async function getAdminMenuCounts(): Promise<AdminMenuCounts | null> {
  try {
    const response = await fetch(`${env.apiBaseUrl}/admin/menu-counts`, {
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
