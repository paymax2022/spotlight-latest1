/**
 * SME Pitch admin data — a Path A console (admin consolidation; see
 * docs/adr/ADR-047-admin-console-consolidation-path-a.md).
 *
 * Surfaced while auditing frontend-web/app/admin before its deletion: SME
 * Pitch was a fifth orphaned module ADR-047 never accounted for. Its own
 * page read frontend-web's registration/store (in-memory, nothing real ever
 * writes to) directly — the same dead-store bug slice 5 fixed for the main
 * registration/dashboard/reports routes, just never caught here.
 *
 * Contest listing + applications come from the new
 * GET /api/admin/sme-pitch route (registration/supabase-store, filtered to
 * contestCategory 'sme_pitch'). Contest create/edit/delete reuse the
 * EXISTING /api/admin/contests routes — already real (Postgres via
 * registration-v2/contest-store.ts) and already auth-gated with
 * 'programs:manage'; SME Pitch is just one contestCategory value among the
 * ones that route already accepts.
 */
import { webProxyBase } from '@/config/env';

export type RegionScope = 'state' | 'regional' | 'national' | 'international';

export interface SmePitchContest {
  id?: string;
  slug: string;
  title: string;
  contestCategory: string;
  contestType: string;
  seasonOrEdition: string;
  regionScope: RegionScope;
  isPaid: boolean;
  registrationFeeNgn: number;
  legalAdultAge: number;
  supportsVoting: boolean;
  supportsAuditionScheduling: boolean;
  supportsGroupEntry: boolean;
  requiresGuardianConsentForMinors: boolean;
  requiresMedical: boolean;
  requiresBootcampReadiness: boolean;
  auditionStates: string[];
  applicantCategories: string[];
  status?: string;
}

export interface SmePitchApplication {
  id: string;
  reference: string;
  contestSlug: string;
  status: string;
  fullName: string;
  email: string;
  paymentStatus: string;
  knownContest: boolean;
  contestTitle: string;
  createdAt: string;
  updatedAt: string;
}

export interface SmePitchConsoleData {
  contests: SmePitchContest[];
  applications: SmePitchApplication[];
  stats: { contests: number; applications: number; submitted: number; shortlisted: number };
}

function webBase(): string {
  return webProxyBase();
}

function authHeaders(json = false): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  const headers: Record<string, string> = {};
  if (json) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function readJsonOrThrow(res: Response, label: string): Promise<Record<string, unknown>> {
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401) throw new Error(`${label} failed: 401 — sign in again.`);
  if (res.status === 403) throw new Error(`${label} failed: 403 — this account cannot manage contests.`);
  if (!res.ok) throw new Error(`${label} failed: ${(json.error as string) || res.status}`);
  return json;
}

export async function getSmePitchConsole(): Promise<SmePitchConsoleData> {
  const res = await fetch(`${webBase()}/api/admin/sme-pitch`, { cache: 'no-store', headers: authHeaders() });
  const json = await readJsonOrThrow(res, 'Loading SME Pitch console');
  return {
    contests: (json.contests as SmePitchContest[]) ?? [],
    applications: (json.applications as SmePitchApplication[]) ?? [],
    stats: (json.stats as SmePitchConsoleData['stats']) ?? { contests: 0, applications: 0, submitted: 0, shortlisted: 0 },
  };
}

export async function getSmePitchContest(slug: string): Promise<SmePitchContest> {
  const res = await fetch(`${webBase()}/api/admin/contests/${slug}`, { cache: 'no-store', headers: authHeaders() });
  const json = await readJsonOrThrow(res, 'Loading contest');
  return json.contest as SmePitchContest;
}

export async function createSmePitchContest(input: Omit<SmePitchContest, 'id' | 'status' | 'contestCategory' | 'contestType'>): Promise<SmePitchContest> {
  const res = await fetch(`${webBase()}/api/admin/contests`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({ ...input, contestCategory: 'sme_pitch', contestType: 'pitch_competition' }),
  });
  const json = await readJsonOrThrow(res, 'Creating contest');
  return json.contest as SmePitchContest;
}

export async function updateSmePitchContest(
  slug: string,
  input: Omit<SmePitchContest, 'id' | 'status' | 'contestCategory' | 'contestType'>,
): Promise<SmePitchContest> {
  const res = await fetch(`${webBase()}/api/admin/contests/${slug}`, {
    method: 'PATCH',
    headers: authHeaders(true),
    body: JSON.stringify({ ...input, contestCategory: 'sme_pitch', contestType: 'pitch_competition' }),
  });
  const json = await readJsonOrThrow(res, 'Updating contest');
  return json.contest as SmePitchContest;
}

export async function deleteSmePitchContest(slug: string): Promise<void> {
  const res = await fetch(`${webBase()}/api/admin/contests/${slug}`, {
    method: 'DELETE',
    headers: authHeaders(true),
  });
  await readJsonOrThrow(res, 'Deleting contest');
}

export const NIGERIA_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT Abuja', 'Gombe',
  'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos',
  'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto',
  'Taraba', 'Yobe', 'Zamfara',
];
