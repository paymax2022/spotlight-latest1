// ── Admin — Property role verification queue ─────────────────────────────────
// Live only: there is no mock path. A failed read rejects (never an empty list)
// and a failed write rejects (never a faked success), so the operator is never
// told something was approved/rejected/suspended when it was not.
//
// Routes: backend /api/property/admin/roles (gated by property.roles.review).
// Same transport as realtorAdminService: apiRoot() + bearer token from
// localStorage via adminAuthHeaders().

import { apiRoot, adminAuthHeaders } from '@/config/env';

export type RoleDocument = {
  id: string;
  kind: string;
  storageKey: string;
  createdAt: string;
};

export type RoleProfile = {
  id: string;
  userId: string;
  role: string;
  status: string;
  verificationStatus: string;
  displayName?: string | null;
  details?: Record<string, unknown> | null;
  rejectionReason?: string | null;
  verifiedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  documents?: RoleDocument[] | null;
};

function base(): string {
  return `${apiRoot()}/api/property/admin/roles`;
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: adminAuthHeaders({ 'Content-Type': 'application/json' }),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const b = body as { error?: unknown; message?: unknown } | null;
    const msg =
      (typeof b?.error === 'string' && b.error) ||
      (typeof b?.message === 'string' && b.message) ||
      `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return body as T;
}

export async function listRoles(status = 'pending'): Promise<RoleProfile[]> {
  const j = await request<{ items?: RoleProfile[] }>(
    `${base()}?status=${encodeURIComponent(status)}`,
    { method: 'GET', cache: 'no-store' },
  );
  if (!Array.isArray(j?.items)) throw new Error('Unexpected response from the property roles API');
  return j.items;
}

export function approveRole(id: string): Promise<RoleProfile> {
  return request<RoleProfile>(`${base()}/${encodeURIComponent(id)}/approve`, { method: 'POST' });
}

export async function rejectRole(id: string, reason: string): Promise<RoleProfile> {
  const r = reason.trim();
  if (!r) throw new Error('A reason is required to reject a role profile');
  return request<RoleProfile>(`${base()}/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason: r }),
  });
}

export function suspendRole(id: string, reason?: string): Promise<RoleProfile> {
  const r = reason?.trim();
  return request<RoleProfile>(`${base()}/${encodeURIComponent(id)}/suspend`, {
    method: 'POST',
    body: JSON.stringify(r ? { reason: r } : {}),
  });
}
