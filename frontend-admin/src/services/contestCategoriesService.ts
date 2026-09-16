/**
 * Competition categories admin data.
 *
 * Same PATH A shape as contestsAdminService: contests live in frontend-web, so
 * this goes through /api/web-proxy with the admin bearer token. The routes are
 * /api/admin/contest-categories[/:slug], guarded by 'programs:manage' — the same
 * permission as creating a contest, since adding a category is part of that job.
 */
import { webProxyBase } from '@/config/env';

export type ContestCategoryRow = {
  slug: string;
  label: string;
  description: string | null;
  active: boolean;
  sortOrder: number;
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

/** Surfaces the server's own message when there is one — 409s explain themselves. */
async function readError(res: Response, fallback: string): Promise<string> {
  if (res.status === 401) return `${fallback}: 401 — sign in again.`;
  if (res.status === 403) return `${fallback}: 403 — this account is not an admin.`;
  try {
    const body = await res.json();
    const msg = typeof body?.error === 'string' ? body.error : typeof body?.message === 'string' ? body.message : '';
    if (msg) return msg;
  } catch {
    /* fall through to the status line */
  }
  return `${fallback}: ${res.status}`;
}

export async function listContestCategories(): Promise<ContestCategoryRow[]> {
  const res = await fetch(`${webBase()}/api/admin/contest-categories`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res, 'Categories failed'));
  return (await res.json()).categories ?? [];
}

export async function createContestCategory(input: {
  label: string;
  slug?: string;
  description?: string | null;
  sortOrder?: number;
}): Promise<ContestCategoryRow> {
  const res = await fetch(`${webBase()}/api/admin/contest-categories`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res, 'Create category failed'));
  return (await res.json()).category;
}

export async function updateContestCategory(
  slug: string,
  patch: { label?: string; description?: string | null; active?: boolean; sortOrder?: number },
): Promise<ContestCategoryRow> {
  const res = await fetch(`${webBase()}/api/admin/contest-categories/${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await readError(res, 'Update category failed'));
  return (await res.json()).category;
}

/**
 * Hard delete. The server refuses with 409 when contests are filed under the
 * category and tells you to deactivate instead; that message is surfaced as-is.
 */
export async function deleteContestCategory(slug: string): Promise<void> {
  const res = await fetch(`${webBase()}/api/admin/contest-categories/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res, 'Delete category failed'));
}
