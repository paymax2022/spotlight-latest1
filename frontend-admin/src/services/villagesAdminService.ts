/**
 * Village curation — the write side of the locality cascade.
 *
 * Same PATH A shape as contestsAdminService and localityAdminService: contests and
 * reference geography live in frontend-web, so every call goes through /api/web-proxy.
 * The routes are /api/admin/villages[/:id], guarded by 'programs:manage' — the same
 * permission as creating a contest, because deciding which quarters a local contest
 * covers is part of that job.
 *
 * Two things this service is deliberately NOT:
 *   * not the picker read. localityAdminService.listVillages answers applicants' shape
 *     ({mode, villages[]}) and hides retired rows; these rows are the admin's view — whole
 *     rows, retired included, so `is_active=false` stays reversible;
 *   * not a place to soften the server's message. readError returns the route's own
 *     sentence whenever there is one, and only the two auth statuses get an app-written
 *     line. That matters here: /api/admin/villages answers 503 with the exact feature name
 *     when FEATURE_LOCALITY_VILLAGES_ENABLED is unset, and an admin who reads "failed to
 *     load villages" goes looking in the database instead of the environment.
 */
import { webProxyBase } from '@/config/env';

export interface VillageAdminRow {
  id: string;
  state: string;
  lga: string;
  name: string;
  notes: string;
  is_active: boolean;
}

export interface PublishOutcome {
  created: VillageAdminRow[];
  skipped: { name: string; reason: string }[];
}

function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json' };
}

/** The server's own reason when it has one; a status line only when it does not. */
async function readError(res: Response, fallback: string): Promise<string> {
  if (res.status === 401) return `${fallback}: 401 — sign in again.`;
  if (res.status === 403) return `${fallback}: 403 — this account is not an admin.`;
  try {
    const body = await res.json();
    const msg = typeof body?.error === 'string' ? body.error : '';
    if (msg) return msg;
  } catch {
    /* fall through to the status line */
  }
  return `${fallback}: ${res.status}`;
}

export async function listManagedVillages(state: string, lga: string): Promise<VillageAdminRow[]> {
  const qs = `state=${encodeURIComponent(state)}&lga=${encodeURIComponent(lga)}`;
  const res = await fetch(`${webProxyBase()}/api/admin/villages?${qs}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res, 'Villages failed'));
  const json = (await res.json()) as { villages?: unknown };
  return Array.isArray(json.villages) ? (json.villages as VillageAdminRow[]) : [];
}

/**
 * Publish a batch. One POST carries the whole list because the route answers per name
 * (`created` / `skipped`), which is the only way an admin learns that 2 of 15 quarters were
 * already there.
 */
export async function publishVillages(input: {
  state: string;
  lga: string;
  names: string[];
}): Promise<PublishOutcome> {
  const res = await fetch(`${webProxyBase()}/api/admin/villages`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res, 'Publish failed'));
  const json = (await res.json()) as { created?: unknown; skipped?: unknown };
  return {
    created: Array.isArray(json.created) ? (json.created as VillageAdminRow[]) : [],
    skipped: Array.isArray(json.skipped) ? (json.skipped as PublishOutcome['skipped']) : [],
  };
}

export async function updateManagedVillage(
  id: string,
  patch: { name?: string; notes?: string; active?: boolean },
): Promise<VillageAdminRow> {
  const res = await fetch(`${webProxyBase()}/api/admin/villages/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await readError(res, 'Update failed'));
  return (await res.json()).village as VillageAdminRow;
}

/** Permanent. Retiring is the everyday move; this is for a row that was never real. */
export async function deleteManagedVillage(id: string): Promise<void> {
  const res = await fetch(`${webProxyBase()}/api/admin/villages/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res, 'Delete failed'));
}
