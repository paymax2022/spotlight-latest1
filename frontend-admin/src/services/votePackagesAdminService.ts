/**
 * Voting-package templates — reusable package definitions, and attaching them to
 * contests.
 *
 * Served over PATH A (/api/web-proxy) like contests, because vote packages live
 * in frontend-web's Supabase schema and have no Go module.
 *
 * ⚠️ MONEY UNITS: `amount` is NAIRA (major units), not kobo. That is unusual for
 * this codebase, but public.vote_packages.amount is NUMERIC(12,2) naira and the
 * legacy paid-vote service prices against it, so templates mirror it exactly and
 * attaching is a straight copy. Never scale this value by 100 anywhere.
 *
 * There is no mock mode here on purpose: a console that invents packages an
 * operator then prices real votes against is worse than one that shows an error.
 */
import { webProxyBase } from '@/config/env';

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

function webBase(): string {
  return webProxyBase();
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

async function readJsonOrThrow(res: Response, what: string): Promise<any> {
  if (res.status === 401) throw new Error(`${what} failed: 401 — sign in again.`);
  if (res.status === 403) throw new Error(`${what} failed: 403 — this account lacks votes:manage.`);
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* fall through to the status-only error below */
  }
  if (!res.ok) {
    throw new Error(json?.error || json?.message || `${what} failed: ${res.status}`);
  }
  return json ?? {};
}

const BASE = '/api/admin/voting/package-templates';

export async function listVotePackageTemplates(activeOnly = false): Promise<VotePackageTemplate[]> {
  const qs = activeOnly ? '?activeOnly=true' : '';
  const res = await fetch(`${webBase()}${BASE}${qs}`, { cache: 'no-store', headers: authHeaders() });
  const json = await readJsonOrThrow(res, 'Loading package templates');
  return (json.templates ?? []) as VotePackageTemplate[];
}

export async function createVotePackageTemplate(input: VotePackageTemplateInput): Promise<VotePackageTemplate> {
  const res = await fetch(`${webBase()}${BASE}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  const json = await readJsonOrThrow(res, 'Creating package template');
  return json.template as VotePackageTemplate;
}

export async function updateVotePackageTemplate(
  id: string,
  input: Partial<VotePackageTemplateInput>,
): Promise<VotePackageTemplate> {
  const res = await fetch(`${webBase()}${BASE}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ id, ...input }),
  });
  const json = await readJsonOrThrow(res, 'Updating package template');
  return json.template as VotePackageTemplate;
}

export async function deleteVotePackageTemplate(id: string): Promise<void> {
  const res = await fetch(`${webBase()}${BASE}?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  await readJsonOrThrow(res, 'Deleting package template');
}

/**
 * Clone the given templates onto a contest as real vote_packages rows.
 * Safe to call twice — templates already on the contest are skipped, not duplicated.
 */
export async function applyTemplatesToContest(
  contestId: string,
  templateIds: string[],
): Promise<ApplyTemplatesResult> {
  const res = await fetch(`${webBase()}${BASE}/apply`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ contestId, templateIds }),
  });
  const json = await readJsonOrThrow(res, 'Attaching packages to contest');
  return {
    applied: Number(json.applied ?? 0),
    skipped: Number(json.skipped ?? 0),
    missing: json.missing ?? [],
    message: json.message,
  };
}

/** Packages currently attached to a contest (the real vote_packages rows). */
export async function listContestPackages(contestId: string): Promise<
  Array<{ id: string; name: string; votes: number; bonusVotes: number; amount: number; isActive: boolean; templateId: string | null }>
> {
  const res = await fetch(
    `${webBase()}/api/admin/voting/packages?contestId=${encodeURIComponent(contestId)}`,
    { cache: 'no-store', headers: authHeaders() },
  );
  const json = await readJsonOrThrow(res, 'Loading contest packages');
  return (json.packages ?? []).map((p: any) => ({
    id: p.id,
    name: p.name,
    votes: Number(p.votes ?? 0),
    bonusVotes: Number(p.bonusVotes ?? p.bonus_votes ?? 0),
    amount: Number(p.amount ?? 0),
    isActive: p.isActive !== false,
    templateId: p.template_id ?? p.templateId ?? null,
  }));
}

/** ₦ formatting for naira-denominated package amounts. */
export function formatNaira(amount: number): string {
  return `₦${Number(amount || 0).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
}
