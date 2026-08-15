import { env } from '@/config/env';
import type { Permission, PermissionMatrix, Role } from '@/types/rbac';

function adminApiBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api');
}

function authHeaders(json = false): Record<string, string> {
  if (typeof window === 'undefined') return json ? { 'Content-Type': 'application/json' } : {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

export async function listRoles(): Promise<Role[]> {
  const res = await fetch(`${adminApiBase()}/admin/roles`, { cache: 'no-store', headers: authHeaders() });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.roles)) return [];
  return payload.roles as Role[];
}

export async function createRole(input: Partial<Role>): Promise<Role | null> {
  const res = await fetch(`${adminApiBase()}/admin/roles`, { method: 'POST', headers: authHeaders(true), body: JSON.stringify(input) });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.role) return null;
  return payload.role as Role;
}

export async function updateRole(id: string, input: Partial<Role>): Promise<Role | null> {
  const res = await fetch(`${adminApiBase()}/admin/roles/${encodeURIComponent(id)}`, { method: 'PATCH', headers: authHeaders(true), body: JSON.stringify(input) });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.role) return null;
  return payload.role as Role;
}

export async function cloneRole(id: string, name: string, slug: string): Promise<Role | null> {
  const res = await fetch(`${adminApiBase()}/admin/roles/${encodeURIComponent(id)}/clone`, { method: 'POST', headers: authHeaders(true), body: JSON.stringify({ name, slug }) });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.role) return null;
  return payload.role as Role;
}

export async function deleteRole(id: string): Promise<boolean> {
  const res = await fetch(`${adminApiBase()}/admin/roles/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() });
  const payload = await res.json().catch(() => ({}));
  return Boolean(res.ok && payload?.success);
}

export async function listPermissions(): Promise<Permission[]> {
  const res = await fetch(`${adminApiBase()}/admin/permissions`, { cache: 'no-store', headers: authHeaders() });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.permissions)) return [];
  return payload.permissions as Permission[];
}

export async function createPermission(input: Partial<Permission>): Promise<Permission | null> {
	const res = await fetch(`${adminApiBase()}/admin/permissions`, {
		method: 'POST', headers: authHeaders(true), body: JSON.stringify(input)
	});
	const payload = await res.json().catch(() => ({}));
	if (!res.ok || !payload?.success || !payload?.permission) return null;
	return payload.permission as Permission;
}

export async function updatePermission(id: string, input: Partial<Permission>): Promise<Permission | null> {
	const res = await fetch(`${adminApiBase()}/admin/permissions/${encodeURIComponent(id)}`, {
		method: 'PATCH', headers: authHeaders(true), body: JSON.stringify(input)
	});
	const payload = await res.json().catch(() => ({}));
	if (!res.ok || !payload?.success || !payload?.permission) return null;
	return payload.permission as Permission;
}

export async function deletePermission(id: string): Promise<boolean> {
	const res = await fetch(`${adminApiBase()}/admin/permissions/${encodeURIComponent(id)}`, {
		method: 'DELETE', headers: authHeaders()
	});
	const payload = await res.json().catch(() => ({}));
	return Boolean(res.ok && payload?.success);
}

export async function getPermissionMatrix(): Promise<PermissionMatrix | null> {
  const res = await fetch(`${adminApiBase()}/admin/permissions/matrix`, { cache: 'no-store', headers: authHeaders() });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.matrix) return null;
  return payload.matrix as PermissionMatrix;
}

export async function assignPermissionToRole(roleId: string, permissionId: string): Promise<boolean> {
  const res = await fetch(`${adminApiBase()}/admin/roles/${encodeURIComponent(roleId)}/permissions`, {
    method: 'POST', headers: authHeaders(true), body: JSON.stringify({ permissionId })
  });
  const payload = await res.json().catch(() => ({}));
  return Boolean(res.ok && payload?.success);
}

export async function removePermissionFromRole(roleId: string, permissionId: string): Promise<boolean> {
  const res = await fetch(`${adminApiBase()}/admin/roles/${encodeURIComponent(roleId)}/permissions/${encodeURIComponent(permissionId)}`, {
    method: 'DELETE', headers: authHeaders()
  });
  const payload = await res.json().catch(() => ({}));
  return Boolean(res.ok && payload?.success);
}
