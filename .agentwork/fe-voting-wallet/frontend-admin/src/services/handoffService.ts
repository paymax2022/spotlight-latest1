import { env } from '@/config/env';
import type { HandoffRow } from '@/types/handoff';

function adminHeaders() {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const adminKey = process.env.NEXT_PUBLIC_ADMIN_API_KEY || '';
  if (adminKey) headers['x-admin-api-key'] = adminKey;
  return headers;
}

export async function listHandoffs(limit = 200, sessionId = '', status = ''): Promise<HandoffRow[]> {
  const url = new URL(`${env.apiBaseUrl}/admin/handoffs`);
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
  const res = await fetch(`${env.apiBaseUrl}/admin/handoffs/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: adminHeaders(),
    body: JSON.stringify({ status }),
  });
  const payload = await res.json().catch(() => ({}));
  return Boolean(res.ok && payload?.success);
}
