import { apiV1, adminAuthHeaders } from '@/config/env';
import type { Analytics } from '@/types/analytics';
import { adminApiBase, authHeaders, readOrThrow } from '@/services/usersService';

export async function getAnalyticsSummary(): Promise<Analytics | null> {
  const headers = adminAuthHeaders();

  try {
    const res = await fetch(`${apiV1()}/admin/analytics/summary`, {
      cache: 'no-store',
      credentials: 'include',
      headers,
    });
    const payload = await res.json();
    if (!res.ok || !payload?.success || !payload?.analytics) return null;
    return payload.analytics as Analytics;
  } catch {
    // Network-level failure (backend down/unreachable, CORS, DNS) or a non-JSON
    // of letting the rejected fetch bubble up as an unhandled runtime error that
    // white-screens the whole admin page. Callers already handle null.
    return null;
  }
}

export type NavAnalytics = {
  range: string;
  surface: string;
  topScreens: { route: string; views: number; users: number }[];
  /** Sparse: days with no events are omitted by the server. */
  timeseries: { day: string; mobile: number; web: number; total: number }[];
  surfaceSplit: { mobile: number; web: number; total: number };
};

/** Navigation telemetry aggregate. 404 = feature flag off (not an error). */
export async function getNavigationAnalytics(args: {
  range: string;
  surface: string;
  search: string;
}): Promise<{ enabled: boolean; data: NavAnalytics | null }> {
  const params = new URLSearchParams({ range: args.range, surface: args.surface, search: args.search });
  const res = await fetch(`${adminApiBase()}/admin/analytics/navigation?${params.toString()}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  if (res.status === 404) return { enabled: false, data: null };
  const payload = await readOrThrow(res, 'Loading navigation analytics');
  return { enabled: true, data: payload as unknown as NavAnalytics };
}
