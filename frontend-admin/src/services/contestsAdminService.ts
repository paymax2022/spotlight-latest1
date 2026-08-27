/**
 * Contests admin data — the first console served over PATH A.
 *
 * Everything else in this directory reaches the Go backend through
 * /api/admin-proxy. Contests has no Go module: its data lives in frontend-web,
 * so it goes through /api/web-proxy instead. The two proxies are the only
 * difference — the service shape, the envelope and the auth header are identical,
 * so a module can later be moved from web to Go by changing one base.
 */
import { webProxyBase } from '@/config/env';

export type AdminContest = {
  id: string;
  name: string;
  contest_type: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
};

function webBase(): string {
  return webProxyBase();
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

export async function listAdminContests(type?: string): Promise<AdminContest[]> {
  const qs = type ? `?type=${encodeURIComponent(type)}` : '';
  const res = await fetch(`${webBase()}/api/v1/admin/contests${qs}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  if (res.status === 401) throw new Error('Contests failed: 401 — sign in again.');
  if (res.status === 403) throw new Error('Contests failed: 403 — this account is not an admin.');
  if (!res.ok) throw new Error(`Contests failed: ${res.status}`);
  return (await res.json()).contests ?? [];
}
