/**
 * Contest prizes admin data — PATH A (frontend-web via /api/web-proxy), same
 * shape/conventions as contestTemplatesService.ts and votePackagesService.ts.
 *
 * WHY THIS EXISTS
 * Organizers had no way to configure what a contest position actually wins —
 * /api/admin/voting/contest-prizes exists server-side but nothing in the
 * console called it. Without this, the results publish flow has nothing to
 * assign by rank, and "1st place wins ₦X" was never anywhere but a caption.
 *
 * ⚠️ UNITS: prizeValueKobo travels in KOBO over the wire (unlike vote
 * packages / registrationFeeNgn, which are naira). The UI here takes naira
 * input and multiplies by 100 before sending, mirroring the kobo helpers in
 * businessAdminService.ts / academyFeesService.ts — do not send naira
 * directly, that would under-price every prize by 100x.
 */
import { webProxyBase } from '@/config/env';

export type ContestPrize = {
  id: string;
  connectContestId: string;
  position: number;
  prizeDescription: string;
  /** Integer minor units (kobo). Null/0 when no monetary value was set. */
  prizeValueKobo: number;
  createdAt: string | null;
};

export type ContestPrizeInput = {
  connectContestId: string;
  position: number;
  prizeDescription: string;
  prizeValueKobo?: number;
};

export type ContestPrizePatch = Partial<{
  prizeDescription: string;
  prizeValueKobo: number;
}>;

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

function pick(row: Record<string, unknown>, camel: string, snake: string): unknown {
  return row[camel] !== undefined ? row[camel] : row[snake];
}

function toPrize(row: Record<string, unknown>): ContestPrize {
  return {
    id: String(row.id ?? ''),
    connectContestId: String(pick(row, 'connectContestId', 'connect_contest_id') ?? ''),
    position: Number(row.position ?? 0),
    prizeDescription: String(pick(row, 'prizeDescription', 'prize_description') ?? ''),
    prizeValueKobo: Number(pick(row, 'prizeValueKobo', 'prize_value_kobo') ?? 0),
    createdAt: (pick(row, 'createdAt', 'created_at') as string | null) ?? null,
  };
}

const BASE = '/api/admin/voting/contest-prizes';

/** Ordered by position ascending, per the API contract. */
export async function listContestPrizes(connectContestId: string): Promise<ContestPrize[]> {
  const qs = `?connectContestId=${encodeURIComponent(connectContestId)}`;
  const res = await fetch(`${webProxyBase()}${BASE}${qs}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  const json = await readJsonOrThrow(res, 'Loading contest prizes');
  const rows = (json.prizes ?? []) as Array<Record<string, unknown>>;
  return rows.map(toPrize);
}

/** Throws with the server's message verbatim on 409 (position already taken). */
export async function createContestPrize(input: ContestPrizeInput): Promise<ContestPrize> {
  const res = await fetch(`${webProxyBase()}${BASE}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(input),
  });
  const json = await readJsonOrThrow(res, 'Creating prize');
  return toPrize((json.prize ?? json) as Record<string, unknown>);
}

/** position is immutable after creation — not accepted here; delete + recreate to move it. */
export async function updateContestPrize(id: string, patch: ContestPrizePatch): Promise<ContestPrize> {
  const res = await fetch(`${webProxyBase()}${BASE}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(patch),
  });
  const json = await readJsonOrThrow(res, 'Updating prize');
  return toPrize((json.prize ?? json) as Record<string, unknown>);
}

export async function deleteContestPrize(id: string): Promise<void> {
  const res = await fetch(`${webProxyBase()}${BASE}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  await readJsonOrThrow(res, 'Deleting prize');
}

/** Naira → kobo, matching the convention in businessAdminService.ts/academyFeesService.ts. */
export function nairaToKobo(naira: number): number {
  return Math.round((Number(naira) || 0) * 100);
}

/** Kobo → naira for display in an input field. */
export function koboToNaira(kobo: number): number {
  return (Number(kobo) || 0) / 100;
}

/** Shared naira formatter for display (₦ text, not an input value). */
export function formatNaira(kobo: number): string {
  return `₦${koboToNaira(kobo).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
