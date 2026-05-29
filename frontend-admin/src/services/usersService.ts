import { env } from '@/config/env';
import type { AdminUser, AdminUserFilters } from '@/types/users';

function adminApiBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api');
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  if (!token) return {};
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function toQuery(filters: AdminUserFilters): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters || {})) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (!s) continue;
    params.set(k, s);
  }
  return params.toString();
}

async function statusAction(id: string, action: 'suspend' | 'unsuspend' | 'lock' | 'unlock'): Promise<boolean> {
  const res = await fetch(`${adminApiBase()}/admin/users/${encodeURIComponent(id)}/${action}`, {
    method: 'PATCH',
    headers: authHeaders(),
  });
  const payload = await res.json().catch(() => ({}));
  return Boolean(res.ok && payload?.success);
}

export async function listAdminUsers(filters: AdminUserFilters): Promise<AdminUser[]> {
  const qs = toQuery(filters);
  const res = await fetch(`${adminApiBase()}/admin/users${qs ? `?${qs}` : ''}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.users)) return [];
  return payload.users as AdminUser[];
}

export async function getAdminUser(id: string): Promise<AdminUser | null> {
  const res = await fetch(`${adminApiBase()}/admin/users/${encodeURIComponent(id)}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.user) return null;
  return payload.user as AdminUser;
}

export async function updateAdminUser(id: string, patch: Record<string, unknown>): Promise<AdminUser | null> {
  const res = await fetch(`${adminApiBase()}/admin/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify(patch),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.user) return null;
  return payload.user as AdminUser;
}

export async function suspendAdminUser(id: string): Promise<boolean> { return statusAction(id, 'suspend'); }
export async function unsuspendAdminUser(id: string): Promise<boolean> { return statusAction(id, 'unsuspend'); }
export async function lockAdminUser(id: string): Promise<boolean> { return statusAction(id, 'lock'); }
export async function unlockAdminUser(id: string): Promise<boolean> { return statusAction(id, 'unlock'); }
