import { env } from '@/config/env';
import type { RealityTVDashboardMetrics } from '@/types/realityTv';

export async function getRealityTVDashboard(): Promise<RealityTVDashboardMetrics | null> {
  const headers: Record<string, string> = {};
  const adminKey = process.env.NEXT_PUBLIC_ADMIN_API_KEY || '';
  if (adminKey) headers['x-admin-api-key'] = adminKey;

  const res = await fetch(`${env.apiBaseUrl}/admin/reality-tv/dashboard`, {
    cache: 'no-store',
    credentials: 'include',
    headers,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.metrics) return null;
  return payload.metrics as RealityTVDashboardMetrics;
}
