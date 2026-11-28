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
  /**
   * Slot art (P2 migration 20272200000000). `null` means "this slot has no
   * image", which is a different fact from "nobody said" — and the difference is
   * load-bearing, because `PUT …/slots` is a replace and the web route refuses a
   * body that leaves the question unanswered (400 `slot_art_would_be_dropped`).
   */
  imageUrl: string | null;
  anchor: TemplateSlotAnchor;
  bleed: boolean;
  faceProtect: boolean;
};

/** `SLOT_ANCHORS` in frontend-web/src/server/template-studio/authoring.ts. */
export type TemplateSlotAnchor = 'auto' | 'top' | 'centre' | 'bottom';

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
  /** Studio columns (P3 migration 20272300000000), writable on a `draft` row only (D6). */
  photoMode: string;
  blendPreset: string;
  blendSettings: Record<string, unknown>;
  /** Also the console's "why is this read-only?" clue: a published row has one. */
  publishedAt: string | null;
  // Not yet modeled client-side (numeric slot editor only, per scope) but kept
  // so the raw payload round-trips instead of being silently dropped.
  textOverlays: unknown[];
};

/** One entry of `GET …/versions` — the RPC's chain, newest version first. */
export type TemplateVersion = {
  id: string;
  name: string;
  version: number;
  status: TemplateStatus;
  publishedAt: string | null;
  createdAt: string | null;
};

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const base = extra ?? {};
  if (typeof window === 'undefined') return base;
  return base;
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
    // The four art fields, stated even when the row has none. `imageUrl` is the
    // one that must never come back `undefined`: a draft that round-trips through
    // `replaceTemplateSlots` would otherwise look like an art-unaware client and
    // get refused, or — if this file invented a default — read as "clear it".
    imageUrl: typeof row.imageUrl === 'string' && row.imageUrl.trim() !== '' ? row.imageUrl : null,
    anchor: (row.anchor as TemplateSlotAnchor) ?? 'auto',
    bleed: row.bleed === true,
    faceProtect: row.faceProtect !== false,
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
    photoMode: String(row.photoMode ?? 'auto'),
    blendPreset: String(row.blendPreset ?? 'natural'),
    blendSettings: (row.blendSettings && typeof row.blendSettings === 'object'
      ? row.blendSettings
      : {}) as Record<string, unknown>,
    publishedAt: (row.publishedAt as string | null) ?? null,
    slots: ((row.slots ?? []) as Array<Record<string, unknown>>).map(toSlot),
    textOverlays: (row.textOverlays as unknown[]) ?? [],
  };
}

const BASE = '/api/admin/voting/contest-templates';

/**
 * What the upload form accepts, so a file that cannot work is refused at pick
 * time instead of after a 50 MB round trip.
 *
 * These mirror the two authorities on the web side, and
 * tests/admin/contest-template-upload-gate.spec.ts fails if they drift:
 *   · the bucket's `allowed_mime_types` / `file_size_limit`
 *     (supabase/migrations/20260405700000_contest_image_templates.sql), and
 *   · frontend-web/app/api/admin/voting/contest-templates/route.ts, which answers
 *     400/413 for anything outside them.
 *
 * `image/jpg` is listed because the bucket lists it. Storage matches on the
 * declared Content-Type, and browsers send `image/jpeg` for a .jpg — the extra
 * entry costs nothing and covers a hand-built form.
 */
export const TEMPLATE_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/svg+xml',
] as const;

export const TEMPLATE_IMAGE_ACCEPT = TEMPLATE_IMAGE_TYPES.join(',');

/** Equals the bucket's `file_size_limit` (52 428 800 bytes). */
export const TEMPLATE_MAX_MB = 50;
export const TEMPLATE_MAX_BYTES = TEMPLATE_MAX_MB * 1024 * 1024;

/** Human-readable format list, for the hint under the file input. */
export const TEMPLATE_FORMATS_LABEL = 'PNG, JPEG, WebP or SVG';

/**
 * Returns the reason this file cannot become a template, or null when it can.
 *
 * Deliberately the same complaints the server makes, in the same words: an admin
 * who reads "must be PNG, JPEG, WebP or SVG" in the console banner and then
 * uploads a WebP should not get a different sentence from the API.
 */
export function checkTemplateImage(file: File | null | undefined): string | null {
  if (!file) return null;
  if (!TEMPLATE_IMAGE_TYPES.includes(file.type as (typeof TEMPLATE_IMAGE_TYPES)[number])) {
    return `Unsupported file type: ${file.type || 'unknown'}. Template images must be ${TEMPLATE_FORMATS_LABEL}.`;
  }
  if (file.size > TEMPLATE_MAX_BYTES) {
    return `Image is larger than the ${TEMPLATE_MAX_MB}MB limit for template images.`;
  }
  return null;
}

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
  // The three studio fields. On a non-draft row the route answers 409
  // `template_is_published` with the sentence that says why (D6).
  photoMode: string;
  blendPreset: string;
  blendSettings: Record<string, unknown>;
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

/**
 * The one place this console decides what a slot body looks like.
 *
 * Two rules live here, and both exist because `PUT …/slots` deletes every row
 * before inserting these:
 *
 * - A slot must **state** `imageUrl`. `null` (clear it) and "the caller never
 *   said" are different requests, and only the first one is this client's to
 *   make. The web route enforces the same distinction with 400
 *   `slot_art_would_be_dropped`; raising here instead means the admin learns
 *   which slot was the problem before a request that cannot succeed is sent.
 * - The client-only `id`/`_key` a draft carries never goes on the wire.
 */
function toWireSlot(slot: TemplateSlotInput, index: number): Record<string, unknown> {
  if (!('imageUrl' in slot) || slot.imageUrl === undefined) {
    throw new Error(
      `Slot ${index + 1}${slot.slotName ? ` ("${slot.slotName}")` : ''} does not state an imageUrl. ` +
        'Saving slots replaces every row, so a slot that says nothing about its art would either be ' +
        'refused by the server or clear an image nobody asked to remove. Load the template in the ' +
        'studio, or set the art to null to remove it on purpose.',
    );
  }
  const { id: _id, _key: _k, ...rest } = slot as Record<string, unknown>;
  return {
    ...rest,
    slotName: String(rest.slotName ?? '').trim(),
    imageUrl: slot.imageUrl,
    anchor: slot.anchor ?? 'auto',
    bleed: slot.bleed === true,
    faceProtect: slot.faceProtect !== false,
  };
}

/** Replaces the full slot list for a template in one call. */
export async function replaceTemplateSlots(id: string, slots: TemplateSlotInput[]): Promise<TemplateSlot[]> {
  const res = await fetch(`${webProxyBase()}${BASE}/${encodeURIComponent(id)}/slots`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ slots: slots.map(toWireSlot) }),
  });
  const json = await readJsonOrThrow(res, 'Saving slots');
  const rows = (json.slots ?? []) as Array<Record<string, unknown>>;
  return rows.map(toSlot);
}

/**
 * POST …/duplicate — the only way to edit a published template (D1/D6).
 * The route answers 201 with the new draft row *and* the slots it copied, so the
 * studio can open the copy without a second round trip.
 */
export async function duplicateContestTemplate(
  id: string,
): Promise<{ template: ContestTemplate; slots: TemplateSlot[]; version: number }> {
  const res = await fetch(`${webProxyBase()}${BASE}/${encodeURIComponent(id)}/duplicate`, { method: 'POST', headers: authHeaders() });
  const json = await readJsonOrThrow(res, 'Duplicating template');
  return {
    template: toTemplate((json.template ?? {}) as Record<string, unknown>),
    slots: ((json.slots ?? []) as Array<Record<string, unknown>>).map(toSlot),
    version: Number(json.version ?? 0),
  };
}

/** POST …/publish — single-active is the RPC's job (D2); `archivedIds` is what makes the swap reviewable. */
export async function publishContestTemplate(id: string): Promise<{ template: ContestTemplate; archivedIds: string[] }> {
  const res = await fetch(`${webProxyBase()}${BASE}/${encodeURIComponent(id)}/publish`, { method: 'POST', headers: authHeaders() });
  const json = await readJsonOrThrow(res, 'Publishing template');
  return {
    template: toTemplate((json.template ?? {}) as Record<string, unknown>),
    archivedIds: Array.isArray(json.archivedIds) ? (json.archivedIds as string[]) : [],
  };
}

/** POST …/archive. `changed` is the function's verdict, so a second press says so. */
export async function archiveContestTemplate(id: string): Promise<{ template: ContestTemplate; changed: boolean }> {
  const res = await fetch(`${webProxyBase()}${BASE}/${encodeURIComponent(id)}/archive`, { method: 'POST', headers: authHeaders() });
  const json = await readJsonOrThrow(res, 'Archiving template');
  return {
    template: toTemplate((json.template ?? {}) as Record<string, unknown>),
    changed: json.changed === true,
  };
}

/** GET …/versions — newest first, as the RPC ordered it. An unknown id answers `[]`. */
export async function listContestTemplateVersions(id: string): Promise<TemplateVersion[]> {
  const res = await fetch(`${webProxyBase()}${BASE}/${encodeURIComponent(id)}/versions`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  const json = await readJsonOrThrow(res, 'Loading template history');
  return ((json.versions ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    version: Number(row.version ?? 0),
    status: (row.status as TemplateStatus) ?? 'draft',
    publishedAt: (row.publishedAt as string | null) ?? null,
    createdAt: (row.createdAt as string | null) ?? null,
  }));
}

/**
 * POST …/slot-art — uploads one image into the template's own object prefix and
 * returns its URL. It does **not** attach anything: the caller puts the URL in a
 * slot and saves, which is what keeps the trust rule in `imageUrl` in one place.
 */
export async function uploadSlotArt(id: string, file: File): Promise<string> {
  const form = new FormData();
  form.set('file', file);
  const res = await fetch(`${webProxyBase()}${BASE}/${encodeURIComponent(id)}/slot-art`, {
    method: 'POST',
    // No Content-Type here — the browser sets the multipart boundary itself.
    headers: authHeaders(),
    body: form,
  });
  const json = await readJsonOrThrow(res, 'Uploading slot art');
  const url = String(json.imageUrl ?? '');
  if (!url) throw new Error('The upload answered without an image URL.');
  return url;
}

export type PreviewRequest = {
  /** A cut-out, not a contestant photo: the route refuses an opaque sample (D4). */
  sample: File | Blob;
  photoMode?: string;
  blendPreset?: string;
  blendSettings?: Record<string, unknown>;
  xOffset?: number;
  yOffset?: number;
  scale?: number;
};

export type PreviewResult = {
  blob: Blob;
  contentType: string;
  applied: boolean;
  decisions: Record<string, unknown>;
};

/**
 * POST …/preview — renders unsaved edits against the stored frame and writes
 * nothing (D3).
 *
 * The blob, not an object URL, comes back: creating and revoking a URL is the
 * component's business, and a service that leaked one would be a leak nobody
 * could see. Refusals arrive as JSON from a route whose success body is an image,
 * so `readJsonOrThrow` runs on the non-2xx branch and the server's own sentence —
 * "The preview needs a cut-out…", "template_bytes_unreadable: …" — is what the
 * panel shows.
 */
export async function previewContestTemplate(id: string, input: PreviewRequest): Promise<PreviewResult> {
  const form = new FormData();
  form.set('sample', input.sample);
  if (input.photoMode !== undefined) form.set('photoMode', input.photoMode);
  if (input.blendPreset !== undefined) form.set('blendPreset', input.blendPreset);
  if (input.blendSettings !== undefined) form.set('blendSettings', JSON.stringify(input.blendSettings));
  if (input.xOffset !== undefined) form.set('xOffset', String(input.xOffset));
  if (input.yOffset !== undefined) form.set('yOffset', String(input.yOffset));
  if (input.scale !== undefined) form.set('scale', String(input.scale));

  const res = await fetch(`${webProxyBase()}${BASE}/${encodeURIComponent(id)}/preview`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  if (!res.ok) {
    await readJsonOrThrow(res, 'Preview');
  }

  const raw = res.headers.get('x-render-decisions') ?? '';
  let decisions: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as unknown;
    if (parsed && typeof parsed === 'object') decisions = parsed as Record<string, unknown>;
  } catch {
    // A malformed decision header is a lost annotation, not a lost preview: the
    // image bytes are the answer, and the `X-Blend-Applied` verdict still stands.
  }

  return {
    blob: await res.blob(),
    contentType: res.headers.get('content-type') ?? 'image/jpeg',
    applied: res.headers.get('x-blend-applied') === 'true',
    decisions,
  };
}

/** What `/api/admin/photo-config-status` publishes about the renderer (Task 12). */
export type StudioConfig = {
  blend: {
    presets: string[];
    bounds: Record<string, [number, number]>;
    modes: string[];
    anchors: string[];
    shadowModes: string[];
  };
  templates: Record<string, unknown>;
  blockers: string[];
};

/**
 * GET /api/admin/photo-config-status — the sliders, selects and enums come from
 * the renderer's own tables rather than a copy in this package, which is the only
 * reason a console slider cannot offer a value the compositor will clamp away.
 */
export async function getStudioConfig(): Promise<StudioConfig> {
  const res = await fetch(`${webProxyBase()}/api/admin/photo-config-status`, { cache: 'no-store', headers: authHeaders() });
  const json = await readJsonOrThrow(res, 'Loading studio configuration');
  const blend = (json.blend ?? {}) as Partial<StudioConfig['blend']>;
  return {
    blend: {
      presets: blend.presets ?? [],
      bounds: blend.bounds ?? {},
      modes: blend.modes ?? [],
      anchors: blend.anchors ?? [],
      shadowModes: blend.shadowModes ?? [],
    },
    templates: (json.templates ?? {}) as Record<string, unknown>,
    blockers: Array.isArray(json.blockers) ? (json.blockers as string[]) : [],
  };
}
