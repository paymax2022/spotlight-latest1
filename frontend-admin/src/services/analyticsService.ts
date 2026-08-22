import { env } from '@/config/env';
import type { Analytics } from '@/types/analytics';

export async function getAnalyticsSummary(): Promise<Analytics | null> {
  const headers: Record<string, string> = {};

  try {
    const res = await fetch(`${env.apiBaseUrl}/admin/analytics/summary`, {
      cache: 'no-store',
      credentials: 'include',
      headers,
    });
    const payload = await res.json();
    if (!res.ok || !payload?.success || !payload?.analytics) return null;
    return payload.analytics as Analytics;
  } catch {
    // Network-level failure (backend down/unreachable, CORS, DNS) or a non-JSON
    // body. Degrade to "no data" (the function's documented null result) instead
    // of letting the rejected fetch bubble up as an unhandled runtime error that
    // white-screens the whole admin page. Callers already handle null.
    return null;
  }
}
