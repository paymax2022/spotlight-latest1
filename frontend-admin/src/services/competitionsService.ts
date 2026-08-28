import { apiV1, apiRoot } from '@/config/env';
import type { CompetitionOverview, OpenMicCompetition, VotingContest, ContestRosterEntry, StageEvictionResult, StageContestant, StageEvictionInfo } from '@/types/competitions';

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function getCompetitionOverview(): Promise<CompetitionOverview | null> {
  const headers: Record<string, string> = {};

  try {
    const res = await fetch(`${apiV1()}/admin/competitions/overview`, {
      cache: 'no-store',
      credentials: 'include',
      headers,
    });

    if (!res.ok) {
      console.error(`Competition overview fetch failed: ${res.status} ${res.statusText}`);
      return null;
    }

    const payload = await res.json();
    if (!payload?.success) {
      console.error('Competition overview returned success: false', payload?.error);
      return null;
    }

    // Return overview data or null if empty
    return payload.overview as CompetitionOverview;
  } catch (error) {
    console.error('Failed to fetch competition overview:', error);
    // Check if backend is accessible
    if (error instanceof TypeError && error.message === 'Failed to fetch') {
      console.error(`Cannot reach backend at ${apiV1()}. Is the Go backend running on port 8091?`);
    }
    return null;
  }
}

export async function listOpenMicCompetitions(limit = 100): Promise<OpenMicCompetition[]> {
  const headers: Record<string, string> = {};

  const url = new URL(`${apiV1()}/admin/competitions/open-mic`);
  url.searchParams.set('limit', String(limit));

  const res = await fetch(url.toString(), {
    cache: 'no-store',
    credentials: 'include',
    headers,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !Array.isArray(payload?.competitions)) return [];
  return payload.competitions as OpenMicCompetition[];
}

export async function createOpenMicCompetition(input: {
  name: string;
  slug?: string;
  description?: string;
  status?: string;
  category?: string;
  start_date?: string;
  end_date?: string;
  is_featured?: boolean;
  entry_fee_ngn?: number;
  vote_price_ngn?: number;
  rules_text?: string;
  eligibility_text?: string;
}): Promise<OpenMicCompetition | null> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  const res = await fetch(`${apiV1()}/admin/competitions/open-mic`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(input),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.success || !payload?.competition) return null;
  return payload.competition as OpenMicCompetition;
}

/**
 * Real contests as seen by the mobile app — GET /api/v1/connect/contests
 * (backend/internal/connect/voting), the SAME endpoint the mobile client's
 * getContests() calls (mobile-app/reactnative/src/features/voting/api/
 * voting.api.ts). Member-authenticated only (any signed-in user, no special
 * permission) — an admin session's Bearer token satisfies it as-is.
 *
 * There is no prize-pool / awards / benefits concept anywhere in this data —
 * connect_contests tracks paid_vote_kobo, free_votes_per_user and vote
 * counts, nothing else. A UI that shows prize pools here would be inventing
 * data, not displaying it.
 */
export async function listVotingContests(): Promise<VotingContest[]> {
  const res = await fetch(`${apiV1()}/connect/contests`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error || `Failed to load contests: ${res.status}`);
  return (payload?.data as VotingContest[]) ?? [];
}

/**
 * Real per-contest leaderboard — GET /api/v1/connect/contests/:id/contestants
 * (ListRoster), already server-ranked by total votes. This IS the real
 * "results" data; there is no separate prize-claim/distribution feature in
 * the backend to show alongside it.
 */
export async function getContestRoster(contestId: string): Promise<ContestRosterEntry[]> {
  const res = await fetch(`${apiV1()}/connect/contests/${contestId}/contestants`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error || `Failed to load contestants: ${res.status}`);
  return (payload?.data as ContestRosterEntry[]) ?? [];
}

/**
 * One contestant, real profile + real vote counts — GET
 * /api/v1/connect/contestants/:id. Includes contest_id, which the
 * admin-vote endpoint below needs (it hangs off the CONTEST, not the
 * contestant).
 */
export async function getContestant(contestantId: string): Promise<ContestRosterEntry> {
  const res = await fetch(`${apiV1()}/connect/contestants/${contestantId}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error || `Failed to load contestant: ${res.status}`);
  return payload?.data as ContestRosterEntry;
}

/**
 * Unlimited admin vote — POST /api/connect/admin/contests/:id/admin-vote
 * (backend/internal/connect/voting/eviction_handlers.go — note the real
 * mount point is /api/connect/admin, NOT /api/v1/connect/admin; the
 * handler's own doc-comment is wrong about this). Requires
 * connect.contests.manage (super-admin bypasses via user_has_permission's
 * hard-coded check — see 20261231000000_connect_contests_admin_rbac.sql)
 * and FEATURE_CONTEST_STAGE_EVICTION_ENABLED on the backend, without which
 * this route is not registered at all (404, not 403).
 */
export async function castAdminVote(contestId: string, contestantId: string, voteQuantity = 1): Promise<void> {
  const res = await fetch(`${apiRoot()}/api/connect/admin/contests/${contestId}/admin-vote`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ contestant_id: contestantId, vote_quantity: voteQuantity }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 404) throw new Error('Admin voting is not enabled on this backend (FEATURE_CONTEST_STAGE_EVICTION_ENABLED is off).');
    throw new Error(payload?.error || `Failed to cast admin vote: ${res.status}`);
  }
}

/**
 * Trigger eviction for a stage — POST /api/connect/admin/contests/:id/stages/
 * :stageNumber/evict (eviction_handlers.go TriggerEvictions). Marks the
 * bottom eviction_percentage% of this stage's contestants (by vote count) as
 * pending eviction, each with a grace period a judge can still save them
 * within (see judges-scores). Survivors are simply everyone not marked —
 * there is no separate "advance" call. Requires connect.contests.manage and
 * FEATURE_CONTEST_STAGE_EVICTION_ENABLED, same as castAdminVote above.
 */
export async function triggerStageEviction(
  contestId: string,
  stageNumber: number,
  options?: { evictionPercentage?: number; gracePeriodHours?: number },
): Promise<StageEvictionResult[]> {
  const res = await fetch(`${apiRoot()}/api/connect/admin/contests/${contestId}/stages/${stageNumber}/evict`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stage_number: stageNumber,
      eviction_percentage: options?.evictionPercentage,
      grace_period_hours: options?.gracePeriodHours,
    }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 404) throw new Error('Stage eviction is not enabled on this backend (FEATURE_CONTEST_STAGE_EVICTION_ENABLED is off).');
    throw new Error(payload?.error || `Failed to trigger eviction: ${res.status}`);
  }
  return (payload?.data as StageEvictionResult[]) ?? [];
}

/**
 * Finalize a stage's pending evictions once the grace period has passed —
 * POST /api/connect/admin/contests/:id/stages/:stageNumber/finalize-evictions
 * (FinalizeEvictions). Turns "pending" eviction records into permanent ones;
 * anyone not saved by a judge in the grace window is out for good.
 */
export async function finalizeStageEvictions(contestId: string, stageNumber: number): Promise<void> {
  const res = await fetch(`${apiRoot()}/api/connect/admin/contests/${contestId}/stages/${stageNumber}/finalize-evictions`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage_number: stageNumber }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 404) throw new Error('Stage eviction is not enabled on this backend (FEATURE_CONTEST_STAGE_EVICTION_ENABLED is off).');
    throw new Error(payload?.error || `Failed to finalize evictions: ${res.status}`);
  }
}

/**
 * Contestants currently in a stage with their eviction status — GET
 * /api/v1/connect/contests/:id/stages/:stageNumber/contestants
 * (GetContestantsByStage). Member-authenticated only, no special permission,
 * same as listVotingContests/getContestRoster above.
 */
export async function getContestantsByStage(contestId: string, stageNumber: number): Promise<StageContestant[]> {
  const res = await fetch(`${apiV1()}/connect/contests/${contestId}/stages/${stageNumber}/contestants`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error || `Failed to load stage contestants: ${res.status}`);
  return (payload?.data as StageContestant[]) ?? [];
}

/**
 * All evictions (pending/saved/finalized) for a contest — GET
 * /api/v1/connect/contests/:id/evictions (GetEvictions, member-authenticated,
 * no special permission). The live server-side source of truth for what a
 * judge can still save, unlike the one-shot TriggerEvictions response which
 * only exists in this page's local state until the next reload.
 */
export async function getContestEvictions(contestId: string): Promise<StageEvictionInfo[]> {
  const res = await fetch(`${apiV1()}/connect/contests/${contestId}/evictions`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error || `Failed to load evictions: ${res.status}`);
  return (payload?.data as StageEvictionInfo[]) ?? [];
}

/**
 * Judge/admin save — POST /api/connect/admin/contests/:id/save
 * (eviction_handlers.go SaveContestant, guard connect.contests.judge).
 * Pulls a pending eviction back from the brink within its grace period.
 * The backend caps this at ONE save per (judge, stage) — a second save
 * attempt in the same stage comes back with success:false and a message
 * saying so, not an error; surfaced to the caller as a thrown Error either
 * way so the UI has one place to show it.
 */
export async function saveContestantFromEviction(
  contestId: string,
  evictionId: string,
  reason?: string,
): Promise<{ success: boolean; message: string; saveRecordId: string | null }> {
  const res = await fetch(`${apiRoot()}/api/connect/admin/contests/${contestId}/save`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ eviction_id: evictionId, reason }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 404) throw new Error('Stage eviction is not enabled on this backend (FEATURE_CONTEST_STAGE_EVICTION_ENABLED is off).');
    throw new Error(payload?.error || `Failed to save contestant: ${res.status}`);
  }
  const result = {
    success: Boolean(payload?.success),
    message: String(payload?.message ?? ''),
    saveRecordId: (payload?.save_record_id as string | null) ?? null,
  };
  if (!result.success) throw new Error(result.message || 'Save was refused.');
  return result;
}

/**
 * Extend a pending eviction's grace period — POST
 * /api/connect/admin/contests/:id/extend-grace-period (ExtendGracePeriod,
 * guard connect.contests.manage — an admin action, not judge-only). Each
 * call ADDS additionalHours to the CURRENT grace_period_ends_at, it doesn't
 * reset it, so calling twice compounds.
 *
 * The Go response never actually carries the new end time (eviction_repo.go
 * scans new_grace_period_ends_at from the RPC and then drops it — SaveResponse
 * has no field for it), so the caller should reload the evictions list after
 * this succeeds rather than trust anything from this call's own payload.
 */
export async function extendGracePeriod(
  contestId: string,
  evictionId: string,
  additionalHours = 24,
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${apiRoot()}/api/connect/admin/contests/${contestId}/extend-grace-period`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ eviction_id: evictionId, additional_hours: additionalHours }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 404) throw new Error('Stage eviction is not enabled on this backend (FEATURE_CONTEST_STAGE_EVICTION_ENABLED is off).');
    throw new Error(payload?.error || `Failed to extend grace period: ${res.status}`);
  }
  const result = { success: Boolean(payload?.success), message: String(payload?.message ?? '') };
  if (!result.success) throw new Error(result.message || 'Extend was refused.');
  return result;
}
