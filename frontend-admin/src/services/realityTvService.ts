import { apiV1 } from '@/config/env';
import type { RealityTVDashboardMetrics } from '@/types/realityTv';

export async function getRealityTVDashboard(): Promise<RealityTVDashboardMetrics | null> {
  const headers: Record<string, string> = {};

  const res = await fetch(`${apiV1()}/admin/reality-tv/dashboard`, {
    cache: 'no-store',
    credentials: 'include',
    headers,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.metrics) return null;
  return payload.metrics as RealityTVDashboardMetrics;
}
