/**
 * Contests admin data — the first console served over PATH A.
 *
 * Everything else in this directory reaches the Go backend through
 * /api/admin-proxy. Contests has no Go module: its data lives in frontend-web,
 * so it goes through /api/web-proxy instead. The two proxies are the only
 * difference — the service shape, the envelope and the auth header are identical,
 * so a module can later be moved from web to Go by changing one base.
 */
import { webProxyBase } from '@/config/env';

export type AdminContest = {
  id: string;
  slug: string;
  name: string;
  contest_type: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
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

export async function listAdminContests(type?: string): Promise<AdminContest[]> {
  const qs = type ? `?type=${encodeURIComponent(type)}` : '';
  const res = await fetch(`${webBase()}/api/v1/admin/contests${qs}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  if (res.status === 401) throw new Error('Contests failed: 401 — sign in again.');
  if (res.status === 403) throw new Error('Contests failed: 403 — this account is not an admin.');
  if (!res.ok) throw new Error(`Contests failed: ${res.status}`);
  return (await res.json()).contests ?? [];
}

// ── Generic contest create/edit/delete ──────────────────────────────────────
// Reaches the SAME /api/admin/contests[/[slug]] routes SmePitchAdminService
// uses for sme_pitch specifically — this is the generic version, any
// category/type. Real writes to Postgres (registration-v2/contest-store.ts).
// Any contest with supportsVoting:true auto-publishes to connect_contests
// (src/server/registration-v2/publish-to-voting.ts), which is what makes it
// show up on the mobile app — this is no longer restricted by contestType,
// since the contests -> connect_contests DB trigger mirrors every contest
// unconditionally regardless of type.

export type ContestCategory =
  | 'music' | 'acting' | 'comedy_content' | 'dance' | 'film_production'
  | 'stem_innovation' | 'sme_pitch' | 'school_campus' | 'open_mic'
  | 'general_reality_show' | 'other';

export type ContestType =
  | 'online_contest' | 'physical_audition' | 'hybrid_contest'
  | 'public_voting_contest' | 'bootcamp_reality_show' | 'housemate_reality_show'
  | 'pitch_competition' | 'school_vs_school_contest' | 'regional_contest'
  | 'national_contest' | 'international_entry';

export type RegionScope = 'state' | 'regional' | 'national' | 'international';

export interface FullContest {
  id?: string;
  slug: string;
  title: string;
  contestCategory: ContestCategory;
  contestType: ContestType;
  seasonOrEdition: string;
  regionScope: RegionScope;
  isPaid: boolean;
  registrationFeeNgn: number;
  legalAdultAge: number;
  supportsVoting: boolean;
  supportsAuditionScheduling: boolean;
  supportsGroupEntry: boolean;
  supportsSchoolEntry: boolean;
  requiresGuardianConsentForMinors: boolean;
  requiresMedical: boolean;
  requiresBootcampReadiness: boolean;
  auditionStates: string[];
  applicantCategories: string[];
  status?: string;
  /** URL of the banner image shown on the mobile contest list/detail screens. */
  bannerImageUrl?: string;
}

async function readJsonOrThrow(res: Response, label: string): Promise<Record<string, unknown>> {
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401) throw new Error(`${label} failed: 401 — sign in again.`);
  if (res.status === 403) throw new Error(`${label} failed: 403 — this account cannot manage contests.`);
  if (!res.ok) throw new Error(`${label} failed: ${(json.error as string) || res.status}`);
  return json;
}

export async function getFullContest(slug: string): Promise<FullContest> {
  const res = await fetch(`${webBase()}/api/admin/contests/${slug}`, { cache: 'no-store', headers: authHeaders() });
  const json = await readJsonOrThrow(res, 'Loading contest');
  return json.contest as FullContest;
}

export async function createFullContest(input: Omit<FullContest, 'id' | 'status'>): Promise<FullContest> {
  const res = await fetch(`${webBase()}/api/admin/contests`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  const json = await readJsonOrThrow(res, 'Creating contest');
  return json.contest as FullContest;
}

export async function updateFullContest(slug: string, input: Omit<FullContest, 'id' | 'status'>): Promise<FullContest> {
  const res = await fetch(`${webBase()}/api/admin/contests/${slug}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  const json = await readJsonOrThrow(res, 'Updating contest');
  return json.contest as FullContest;
}

export async function deleteFullContest(slug: string): Promise<void> {
  const res = await fetch(`${webBase()}/api/admin/contests/${slug}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  await readJsonOrThrow(res, 'Deleting contest');
}

export type ContestPublishStatus = 'draft' | 'upcoming' | 'active' | 'ended';

/**
 * Publish/unpublish a contest — PATCH /api/admin/contests/:slug/status.
 * A contest starts 'upcoming' (visible on web, hidden on mobile); setting it
 * to 'active' is what actually makes it live and votable on the phone — the
 * contests -> connect_contests trigger maps active -> open on the same write.
 */
export async function setContestStatus(slug: string, status: ContestPublishStatus): Promise<{ mobileStatus: string | null }> {
  const res = await fetch(`${webBase()}/api/admin/contests/${slug}/status`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ status }),
  });
  const json = await readJsonOrThrow(res, 'Publishing contest');
  return { mobileStatus: (json.mobileStatus as string | null) ?? null };
}

// ── Contest stages ───────────────────────────────────────────────────────────
// /api/admin/contests/:slug/stages[/:stageId] — CRUD over public.contest_stages,
// the same table Go's connect/voting module reads for the mobile eviction flow
// (GetStages, GetContestantsByStage). A stage groups a start/end voting window
// with a promotion_criteria note describing how contestants advance.

export type ContestStage = {
  id: string;
  contestId: string;
  stageNumber: number;
  stageName: string;
  stageDescription: string | null;
  promotionCriteria: string | null;
  evictionPercentage: number;
  minContestantsToEvict: number;
  votingStartsAt: string | null;
  votingEndsAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ContestStageInput = {
  stageNumber?: number;
  stageName: string;
  stageDescription?: string;
  promotionCriteria?: string;
  votingStartsAt?: string | null;
  votingEndsAt?: string | null;
  /** Bottom % of this stage's contestants evicted when eviction is triggered (1-99, default 20). */
  evictionPercentage?: number;
};

export async function listContestStages(slug: string): Promise<ContestStage[]> {
  const res = await fetch(`${webBase()}/api/admin/contests/${slug}/stages`, { cache: 'no-store', headers: authHeaders() });
  const json = await readJsonOrThrow(res, 'Loading contest stages');
  return (json.stages as ContestStage[]) ?? [];
}

export async function createContestStage(slug: string, input: ContestStageInput): Promise<ContestStage> {
  const res = await fetch(`${webBase()}/api/admin/contests/${slug}/stages`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  const json = await readJsonOrThrow(res, 'Creating contest stage');
  return json.stage as ContestStage;
}

export async function updateContestStage(slug: string, stageId: string, input: Partial<ContestStageInput>): Promise<ContestStage> {
  const res = await fetch(`${webBase()}/api/admin/contests/${slug}/stages/${stageId}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  const json = await readJsonOrThrow(res, 'Updating contest stage');
  return json.stage as ContestStage;
}

export async function deleteContestStage(slug: string, stageId: string): Promise<void> {
  const res = await fetch(`${webBase()}/api/admin/contests/${slug}/stages/${stageId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  await readJsonOrThrow(res, 'Deleting contest stage');
}

/** Bulk stage counts for a list of contest ids — one request per page load, not one per row. */
export async function getContestStageCounts(contestIds: string[]): Promise<Record<string, number>> {
  if (contestIds.length === 0) return {};
  const res = await fetch(`${webBase()}/api/admin/contests/stage-counts?ids=${contestIds.map(encodeURIComponent).join(',')}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  const json = await readJsonOrThrow(res, 'Loading contest stage counts');
  return (json.counts as Record<string, number>) ?? {};
}

export type AdvanceStageResult = {
  advancedCount: number;
  nextStageNumber: number | null;
  blockedReason: string | null;
};

/**
 * Moves a stage's survivors into stage_number + 1 — POST
 * /api/admin/contests/:slug/stage-advance. Refuses (blockedReason set) when
 * there's no next stage, or when the stage still has pending evictions.
 */
export async function advanceStageSurvivors(slug: string, stageNumber: number): Promise<AdvanceStageResult> {
  const res = await fetch(`${webBase()}/api/admin/contests/${slug}/stage-advance`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ stageNumber }),
  });
  const json = await readJsonOrThrow(res, 'Advancing stage survivors');
  return json.result as AdvanceStageResult;
}
