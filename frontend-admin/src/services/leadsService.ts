import { apiV1 } from '@/config/env';
import type { Lead } from '@/types/leads';

export async function listLeads(limit = 200, sessionId = ''): Promise<Lead[]> {
  const url = new URL(`${apiV1()}/admin/leads`);
  url.searchParams.set('limit', String(limit));
  if (sessionId.trim()) url.searchParams.set('sessionId', sessionId.trim());

  const headers: Record<string, string> = {};

  const res = await fetch(url.toString(), { cache: 'no-store', credentials: 'include', headers });
  const payload = await res.json();
  if (!res.ok || !payload?.success || !Array.isArray(payload?.leads)) return [];
  return payload.leads as Lead[];
}

export async function updateLeadStatus(id: string, status: string): Promise<boolean> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  const res = await fetch(`${apiV1()}/admin/leads/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers,
    body: JSON.stringify({ status }),
  });
  const payload = await res.json().catch(() => ({}));
  return Boolean(res.ok && payload?.success);
}
