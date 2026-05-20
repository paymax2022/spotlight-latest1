import { env } from '@/config/env';
import type { Analytics } from '@/types/analytics';

export async function getAnalyticsSummary(): Promise<Analytics | null> {
  const headers: Record<string, string> = {};
  const adminKey = process.env.NEXT_PUBLIC_ADMIN_API_KEY || '';
  if (adminKey) headers['x-admin-api-key'] = adminKey;

  const res = await fetch(`${env.apiBaseUrl}/admin/analytics/summary`, {
    cache: 'no-store',
    credentials: 'include',
    headers,
  });
  const payload = await res.json();
  if (!res.ok || !payload?.success || !payload?.analytics) return null;
  return payload.analytics as Analytics;
}
