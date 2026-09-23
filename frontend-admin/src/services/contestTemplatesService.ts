/**
 * Contest templates admin data — PATH A (frontend-web via /api/web-proxy), same
 * shape/conventions as votePackagesService.ts.
 *
 * WHY THIS EXISTS
 * The image-compositing pipeline (template + contestant cutout -> final image)
 * exists and is tested server-side, but there was no admin UI to configure a
 * template against, so the pipeline was never actually reachable. This is the
 * client for /api/admin/voting/contest-templates, gated on `votes:manage`.
 */
import { webProxyBase } from '@/config/env';

export type TemplateSlotType = 'contestant' | 'runner_up' | 'badge' | 'logo' | 'custom';
export type TemplateCropMode = 'cover' | 'contain' | 'fill' | 'none';
export type TemplateStatus = 'draft' | 'active' | 'archived';

export type TemplateSlot = {
  id: string;
  slotName: string;
  slotType: TemplateSlotType;
  slotOrder: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  scale: number;
  cropMode: TemplateCropMode;
  borderRadius: number;
  opacity: number;
};

/** Input shape for PUT .../slots — same fields as TemplateSlot minus the server-assigned id. */
export type TemplateSlotInput = Omit<TemplateSlot, 'id'>;

export type ContestTemplate = {
  id: string;
  name: string;
  connectContestId: string;
  templateUrl: string;
  thumbnailUrl: string | null;
  width: number;
  height: number;
  aspectRatio: string | null;
  status: TemplateStatus;
  version: number;
  createdAt: string | null;
  slots: TemplateSlot[];
  // Not yet modeled client-side (numeric slot editor only, per scope) but kept
  // so the raw payload round-trips instead of being silently dropped.
  textOverlays: unknown[];
};

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const base = extra ?? {};
  if (typeof window === 'undefined') return base;
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token ? { ...base, Authorization: `Bearer ${token}` } : base;
}

async function readJsonOrThrow(res: Response, label: string): Promise<Record<string, unknown>> {
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((payload as { error?: string })?.error || `${label} failed: ${res.status}`);
  }
  return payload as Record<string, unknown>;
}

function toSlot(row: Record<string, unknown>): TemplateSlot {
  return {
    id: String(row.id ?? ''),
    slotName: String(row.slotName ?? ''),
    slotType: (row.slotType as TemplateSlotType) ?? 'custom',
    slotOrder: Number(row.slotOrder ?? 0),
    x: Number(row.x ?? 0),
    y: Number(row.y ?? 0),
    width: Number(row.width ?? 0),
    height: Number(row.height ?? 0),
    rotation: Number(row.rotation ?? 0),
    zIndex: Number(row.zIndex ?? 0),
    scale: Number(row.scale ?? 1),
    cropMode: (row.cropMode as TemplateCropMode) ?? 'cover',
    borderRadius: Number(row.borderRadius ?? 0),
    opacity: Number(row.opacity ?? 1),
  };
}

function toTemplate(row: Record<string, unknown>): ContestTemplate {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    connectContestId: String(row.connectContestId ?? ''),
    templateUrl: String(row.templateUrl ?? ''),
    thumbnailUrl: (row.thumbnailUrl as string | null) ?? null,
    width: Number(row.width ?? 0),
    height: Number(row.height ?? 0),
    aspectRatio: (row.aspectRatio as string | null) ?? null,
    status: (row.status as TemplateStatus) ?? 'draft',
    version: Number(row.version ?? 1),
    createdAt: (row.createdAt as string | null) ?? null,
    slots: ((row.slots ?? []) as Array<Record<string, unknown>>).map(toSlot),
    textOverlays: (row.textOverlays as unknown[]) ?? [],
  };
}

const BASE = '/api/admin/voting/contest-templates';

export async function listContestTemplates(connectContestId?: string): Promise<ContestTemplate[]> {
  const qs = connectContestId ? `?connectContestId=${encodeURIComponent(connectContestId)}` : '';
  const res = await fetch(`${webProxyBase()}${BASE}${qs}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  const json = await readJsonOrThrow(res, 'Loading contest templates');
  const rows = (json.templates ?? []) as Array<Record<string, unknown>>;
  return rows.map(toTemplate);
}

export async function createContestTemplate(formData: FormData): Promise<ContestTemplate> {
  const res = await fetch(`${webProxyBase()}${BASE}`, {
    method: 'POST',
    // No Content-Type here — the browser sets the multipart boundary itself.
    headers: authHeaders(),
    body: formData,
  });
  const json = await readJsonOrThrow(res, 'Uploading template');
  return toTemplate((json.template ?? json) as Record<string, unknown>);
}

export async function getContestTemplate(id: string): Promise<ContestTemplate> {
  const res = await fetch(`${webProxyBase()}${BASE}/${encodeURIComponent(id)}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  const json = await readJsonOrThrow(res, 'Loading template');
  return toTemplate((json.template ?? json) as Record<string, unknown>);
}

export type ContestTemplatePatch = Partial<{
  name: string;
  status: TemplateStatus;
  width: number;
  height: number;
  aspectRatio: string;
}>;

export async function updateContestTemplate(id: string, patch: ContestTemplatePatch): Promise<ContestTemplate> {
  const res = await fetch(`${webProxyBase()}${BASE}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(patch),
  });
  const json = await readJsonOrThrow(res, 'Updating template');
  return toTemplate((json.template ?? json) as Record<string, unknown>);
}

/** Fails with 409 if the template is `active` — must be archived first. */
export async function deleteContestTemplate(id: string): Promise<void> {
  const res = await fetch(`${webProxyBase()}${BASE}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  await readJsonOrThrow(res, 'Deleting template');
}

/** Replaces the full slot list for a template in one call. */
export async function replaceTemplateSlots(id: string, slots: TemplateSlotInput[]): Promise<TemplateSlot[]> {
  const res = await fetch(`${webProxyBase()}${BASE}/${encodeURIComponent(id)}/slots`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ slots }),
  });
  const json = await readJsonOrThrow(res, 'Saving slots');
  const rows = (json.slots ?? []) as Array<Record<string, unknown>>;
  return rows.map(toSlot);
}
