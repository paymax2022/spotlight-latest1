/**
 * Vote packages admin data — PATH A (frontend-web via /api/web-proxy), same
 * shape as contestsAdminService.
 *
 * WHY THIS EXISTS
 * /api/admin/voting/packages has had full CRUD (gated on `votes:manage`) for a
 * long time, and nothing in the console called it. Packages could only be
 * created by hand-crafting an HTTP request, so in practice contests shipped
 * without any — and a paid contest with no packages cannot be voted in at all,
 * because paid-vote.service.ts prices every purchase from a package (its
 * "custom quantity" path derives the rate from the first active one).
 *
 * ⚠️ UNITS: `amount` here is NAIRA, matching the vote_packages column and the
 * admin API. The mobile endpoint converts to kobo at the edge
 * (/api/v1/contests/[id]/vote-packages does Math.round(amount * 100)). Do not
 * "fix" this to kobo — that would publish every package at 100x its price.
 */
import { webProxyBase } from '@/config/env';

export type VotePackage = {
  id: string;
  contestId: string;
  name: string;
  description: string | null;
  votes: number;
  bonusVotes: number;
  /** NAIRA, not kobo. See the note above. */
  amount: number;
  currency: string;
  isActive: boolean;
  isRecommended: boolean;
  promoLabel: string | null;
  displayOrder: number;
  /** Template this package was cloned from, when it was. NULL if authored directly. */
  templateId: string | null;
};

export type VotePackageInput = {
  contestId: string;
  name: string;
  description?: string | null;
  votes: number;
  bonusVotes?: number;
  amount: number;
  currency?: string;
  isActive?: boolean;
  isRecommended?: boolean;
  displayOrder?: number;
};

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

async function readJsonOrThrow(res: Response, label: string): Promise<Record<string, unknown>> {
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((payload as { error?: string })?.error || `${label} failed: ${res.status}`);
  }
  return payload as Record<string, unknown>;
}

/**
 * The GET route spreads the raw snake_case row AND adds camelCase aliases for
 * some fields (isActive, isRecommended, bonusVotes, promoLabel, displayOrder) —
 * but not for contest_id. So both spellings arrive and neither is complete.
 * Read camelCase first, fall back to snake_case, and the mapping survives the
 * route being tidied either way.
 */
function pick(row: Record<string, unknown>, camel: string, snake: string): unknown {
  return row[camel] !== undefined ? row[camel] : row[snake];
}

function toPackage(row: Record<string, unknown>): VotePackage {
  return {
    id: String(row.id ?? ''),
    contestId: String(pick(row, 'contestId', 'contest_id') ?? ''),
    name: String(row.name ?? ''),
    description: (row.description as string | null) ?? null,
    votes: Number(row.votes ?? 0),
    bonusVotes: Number(pick(row, 'bonusVotes', 'bonus_votes') ?? 0),
    amount: Number(row.amount ?? 0),
    currency: String(row.currency ?? 'NGN'),
    // The route's own alias is `is_active !== false`, i.e. active unless
    // explicitly false. Mirror that rather than Boolean(undefined) === false,
    // which is the bug its comment describes.
    isActive: pick(row, 'isActive', 'is_active') !== false,
    isRecommended: Boolean(pick(row, 'isRecommended', 'is_recommended')),
    promoLabel: (pick(row, 'promoLabel', 'promo_label') as string | null) || null,
    displayOrder: Number(pick(row, 'displayOrder', 'display_order') ?? 0),
    templateId: (pick(row, 'templateId', 'template_id') as string | null) ?? null,
  };
}

export async function listVotePackages(contestId?: string): Promise<VotePackage[]> {
  const qs = contestId ? `?contestId=${encodeURIComponent(contestId)}` : '';
  const res = await fetch(`${webProxyBase()}/api/admin/voting/packages${qs}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  const json = await readJsonOrThrow(res, 'Loading vote packages');
  const rows = (json.packages ?? json.data ?? []) as Array<Record<string, unknown>>;
  return rows.map(toPackage);
}

export async function createVotePackage(input: VotePackageInput): Promise<void> {
  const res = await fetch(`${webProxyBase()}/api/admin/voting/packages`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  await readJsonOrThrow(res, 'Creating vote package');
}

export async function updateVotePackage(
  id: string,
  patch: Partial<Omit<VotePackageInput, 'contestId'>>,
): Promise<void> {
  const res = await fetch(`${webProxyBase()}/api/admin/voting/packages`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ id, ...patch }),
  });
  await readJsonOrThrow(res, 'Updating vote package');
}

/** Deactivates rather than deletes — purchased votes reference the package. */
export async function deactivateVotePackage(id: string): Promise<void> {
  const res = await fetch(`${webProxyBase()}/api/admin/voting/packages?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  await readJsonOrThrow(res, 'Deactivating vote package');
}

// ── Reusable templates ──────────────────────────────────────────────────────
//
// A vote_packages row belongs to exactly one contest (contest_id is NOT NULL),
// so there is no such thing as a reusable package: every contest meant retyping
// the same tiers, and they drifted apart. Templates are the catalog authored
// once; attaching one CLONES it into an ordinary vote_packages row for the
// contest, carrying template_id for provenance.
//
// Cloning rather than referencing is deliberate. A contest that is selling votes
// must not have its prices change underneath it because a template was edited
// later, and must not lose its packages because one was deleted.
//
// ⚠️ Template `amount` is NAIRA too, mirroring vote_packages.amount exactly, so
// the clone is a straight copy with no scaling.

export type VotePackageTemplate = {
  id: string;
  name: string;
  description: string;
  votes: number;
  bonusVotes: number;
  /** NAIRA, not kobo. */
  amount: number;
  currency: string;
  isActive: boolean;
  isRecommended: boolean;
  promoLabel: string;
  displayOrder: number;
  createdAt: string | null;
  updatedAt: string | null;
};

export type VotePackageTemplateInput = {
  name: string;
  description?: string;
  votes: number;
  bonusVotes?: number;
  amount: number;
  currency?: string;
  isActive?: boolean;
  isRecommended?: boolean;
  promoLabel?: string;
  displayOrder?: number;
};

export type ApplyTemplatesResult = {
  applied: number;
  skipped: number;
  missing: string[];
  message?: string;
};

const TEMPLATES = '/api/admin/voting/package-templates';

function toTemplate(r: Record<string, any>): VotePackageTemplate {
  return {
    id: String(r.id ?? ''),
    name: String(r.name ?? ''),
    description: r.description ?? '',
    votes: Number(r.votes ?? 0),
    bonusVotes: Number(pick(r, 'bonusVotes', 'bonus_votes') ?? 0),
    amount: Number(r.amount ?? 0),
    currency: String(r.currency ?? 'NGN'),
    isActive: pick(r, 'isActive', 'is_active') !== false,
    isRecommended: Boolean(pick(r, 'isRecommended', 'is_recommended')),
    promoLabel: (pick(r, 'promoLabel', 'promo_label') as string) ?? '',
    displayOrder: Number(pick(r, 'displayOrder', 'display_order') ?? 0),
    createdAt: (pick(r, 'createdAt', 'created_at') as string | null) ?? null,
    updatedAt: (pick(r, 'updatedAt', 'updated_at') as string | null) ?? null,
  };
}

export async function listVotePackageTemplates(activeOnly = false): Promise<VotePackageTemplate[]> {
  const qs = activeOnly ? '?activeOnly=true' : '';
  const res = await fetch(`${webProxyBase()}${TEMPLATES}${qs}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  const json = await readJsonOrThrow(res, 'Loading package templates');
  return ((json.templates ?? []) as Array<Record<string, any>>).map(toTemplate);
}

export async function createVotePackageTemplate(
  input: VotePackageTemplateInput,
): Promise<VotePackageTemplate> {
  const res = await fetch(`${webProxyBase()}${TEMPLATES}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  const json = await readJsonOrThrow(res, 'Creating package template');
  return toTemplate((json.template ?? {}) as Record<string, any>);
}

export async function updateVotePackageTemplate(
  id: string,
  input: Partial<VotePackageTemplateInput>,
): Promise<VotePackageTemplate> {
  const res = await fetch(`${webProxyBase()}${TEMPLATES}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ id, ...input }),
  });
  const json = await readJsonOrThrow(res, 'Updating package template');
  return toTemplate((json.template ?? {}) as Record<string, any>);
}

/** Removing a template never touches packages already cloned onto a contest. */
export async function deleteVotePackageTemplate(id: string): Promise<void> {
  const res = await fetch(`${webProxyBase()}${TEMPLATES}?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  await readJsonOrThrow(res, 'Deleting package template');
}

/** Clone templates onto a contest. Safe to repeat — already-attached ones are skipped. */
export async function applyTemplatesToContest(
  contestId: string,
  templateIds: string[],
): Promise<ApplyTemplatesResult> {
  const res = await fetch(`${webProxyBase()}${TEMPLATES}/apply`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ contestId, templateIds }),
  });
  const json = await readJsonOrThrow(res, 'Attaching packages to contest') as Record<string, any>;
  return {
    applied: Number(json.applied ?? 0),
    skipped: Number(json.skipped ?? 0),
    missing: (json.missing ?? []) as string[],
    message: json.message as string | undefined,
  };
}

/** Shared naira formatter, so the two halves of this console agree. */
export function formatNaira(amount: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(Number(amount || 0));
}
