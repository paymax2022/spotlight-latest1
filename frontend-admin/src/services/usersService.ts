import { apiRoot } from '@/config/env';
import type { AdminUser, AdminUserFilters } from '@/types/users';

/**
 * Admin user management lives on the rbacAdmin group at
 * r.Group("/api/admin") in backend/internal/app/router.go (GET/PATCH
 * /admin/users, /admin/users/:id, /admin/users/:id/{suspend,unsuspend,lock,
 * unlock}). apiRoot() strips any trailing /api/v1 from the same-origin proxy
 * base and nothing else.
 *
 * This used to be env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api'), which
 * stopped matching once apiBaseUrl became the proxy path itself
 * (<origin>/api/admin-proxy, no /api/v1 suffix) — see
 * insuranceAdminService.ts for the same regression. The replace became a
 * no-op and every request 404'd against <proxy>/admin/users instead of
 * <proxy>/api/admin/users.
 */
export function adminApiBase(): string {
  return `${apiRoot()}/api`;
}

export function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  return { 'Content-Type': 'application/json' };
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

/**
 * Reads must not turn a failure into "no data": an empty list is
 * indistinguishable from a real empty result, so a 401/403/5xx or a network
 * error used to render as "No users" with nothing to act on. Throw instead,
 * carrying the HTTP status and the backend's own message so the caller can say
 * what happened (the page's catch already shows a toast and an error state).
 */
export class AdminUsersRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'AdminUsersRequestError';
  }
}

export async function readOrThrow(res: Response, what: string): Promise<Record<string, unknown>> {
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || payload?.success === false) {
    const detail = typeof payload?.error === 'string' && payload.error ? `: ${payload.error}` : '';
    throw new AdminUsersRequestError(res.status, `${what} failed (HTTP ${res.status})${detail}`);
  }
  return payload;
}

export async function listAdminUsers(filters: AdminUserFilters): Promise<AdminUser[]> {
  const qs = toQuery(filters);
  const res = await fetch(`${adminApiBase()}/admin/users${qs ? `?${qs}` : ''}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  const payload = await readOrThrow(res, 'Loading users');
  if (!Array.isArray(payload.users)) {
    throw new AdminUsersRequestError(res.status, 'Loading users failed: unexpected response shape');
  }
  return payload.users as AdminUser[];
}

export async function getAdminUser(id: string): Promise<AdminUser | null> {
  const res = await fetch(`${adminApiBase()}/admin/users/${encodeURIComponent(id)}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  // A missing user is a normal answer, not a failure.
  if (res.status === 404) return null;
  const payload = await readOrThrow(res, 'Loading user');
  return (payload.user as AdminUser | undefined) ?? null;
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

const enc = encodeURIComponent;

export async function getUserRoles(id: string): Promise<string[]> {
  const res = await fetch(`${adminApiBase()}/admin/users/${enc(id)}/roles`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  const payload = await readOrThrow(res, 'Loading user roles');
  return Array.isArray(payload.roles) ? (payload.roles as string[]) : [];
}

export async function assignUserRole(id: string, roleId: string): Promise<boolean> {
  const res = await fetch(`${adminApiBase()}/admin/users/${enc(id)}/roles`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ roleId }),
  });
  const payload = await res.json().catch(() => ({}));
  return Boolean(res.ok && payload?.success);
}

export async function removeUserRole(id: string, roleId: string): Promise<boolean> {
  const res = await fetch(`${adminApiBase()}/admin/users/${enc(id)}/roles/${enc(roleId)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  const payload = await res.json().catch(() => ({}));
  return Boolean(res.ok && payload?.success);
}

export async function getLoginActivity(id: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${adminApiBase()}/admin/login-activity?actorUser=${enc(id)}&limit=50`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  const payload = await readOrThrow(res, 'Loading login activity');
  return Array.isArray(payload.activity) ? (payload.activity as Record<string, unknown>[]) : [];
}

export async function getSecurityEvents(id: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${adminApiBase()}/admin/security-events?actorUser=${enc(id)}&limit=50`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  const payload = await readOrThrow(res, 'Loading security events');
  return Array.isArray(payload.events) ? (payload.events as Record<string, unknown>[]) : [];
}

export type AdminAuditEntry = {
  id: string;
  actor_user_id: string;
  target_user_id: string;
  action: string;
  module: string;
  severity: string;
  created_at: string;
};

/** Admin actions taken on a user (permission audit.logs.view). */
export async function getAuditLogsForUser(userId: string, limit = 50): Promise<AdminAuditEntry[]> {
  const res = await fetch(`${adminApiBase()}/admin/audit-logs?targetUser=${enc(userId)}&limit=${limit}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  const payload = await readOrThrow(res, 'Loading admin actions');
  return Array.isArray(payload.logs) ? (payload.logs as AdminAuditEntry[]) : [];
}

export type UserSession = {
  id: string;
  device: string;
  ip: string;
  userAgent: string;
  lastSeenAt: string;
  expiresAt: string;
  createdAt: string;
};

/** Active sessions for a user. A 503 means session hardening is disabled. */
export async function getUserSessions(userId: string): Promise<UserSession[]> {
  const res = await fetch(`${adminApiBase()}/admin/users/${enc(userId)}/sessions`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  const payload = await readOrThrow(res, 'Loading sessions');
  return Array.isArray(payload.sessions) ? (payload.sessions as UserSession[]) : [];
}

export type UserModule = {
  key: string;
  label: string;
  group: string;
  href: string;
  status: 'member' | 'none' | 'error';
  count: number;
  since?: string;
};

/** Module memberships for a user. A 404 means the module overview flag is off. */
export async function getUserModules(userId: string): Promise<UserModule[]> {
  const res = await fetch(`${adminApiBase()}/admin/users/${enc(userId)}/modules`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  const payload = await readOrThrow(res, 'Loading modules');
  return Array.isArray(payload.modules) ? (payload.modules as UserModule[]) : [];
}
