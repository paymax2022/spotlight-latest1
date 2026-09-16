import { apiV1 } from '@/config/env';
import type { HandoffRow } from '@/types/handoff';

function adminHeaders() {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  return headers;
}

export async function listHandoffs(limit = 200, sessionId = '', status = ''): Promise<HandoffRow[]> {
  const url = new URL(`${apiV1()}/admin/handoffs`);
  url.searchParams.set('limit', String(limit));
  if (sessionId.trim()) url.searchParams.set('sessionId', sessionId.trim());
  if (status.trim()) url.searchParams.set('status', status.trim());

  const res = await fetch(url.toString(), {
    cache: 'no-store',
    credentials: 'include',
    headers: adminHeaders(),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.handoffs)) return [];
  return payload.handoffs as HandoffRow[];
}

export async function updateHandoffStatus(id: string, status: string): Promise<boolean> {
  const res = await fetch(`${apiV1()}/admin/handoffs/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: adminHeaders(),
    body: JSON.stringify({ status }),
  });
  const payload = await res.json().catch(() => ({}));
  return Boolean(res.ok && payload?.success);
}
