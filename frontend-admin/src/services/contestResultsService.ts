/**
 * Voting rounds + results publish/lock admin data — PATH A (frontend-web via
 * /api/web-proxy), same shape/conventions as contestPrizesService.ts.
 *
 * WHY THIS EXISTS
 * GET/POST /api/admin/voting/rounds (round listing) already exists server-side
 * and is used nowhere in this console — there is no admin screen that lists a
 * contest's rounds at all. Results publish/lock
 * (/api/admin/voting/rounds/[roundId]/results,
 * /api/admin/voting/rounds/[roundId]/publish-results) is net-new alongside this
 * batch. This file adds a thin client for both so the results screen can pick
 * a round and then compute/publish/view its locked results.
 *
 * Publish is a ONE-TIME, IRREVERSIBLE action server-side — there is no
 * unpublish/undo endpoint, so this client deliberately has no such call.
 */
import { webProxyBase } from '@/config/env';

export type VotingRoundStatus = 'upcoming' | 'active' | 'ended' | 'results_published' | string;

/** Minimal projection of the `voting_rounds` row — only what the results screen needs. */
export type VotingRound = {
  id: string;
  contestId: string;
  name: string;
  roundNumber: number;
  status: VotingRoundStatus;
  startsAt: string | null;
  endsAt: string | null;
};

export type ContestResultRow = {
  contestantId: string;
  contestantName: string | null;
  rank: number;
  totalConfirmedVotes: number;
  paidVotes: number;
  prizeId: string | null;
  prizeDescription: string | null;
};

export type RoundResults = {
  published: boolean;
  results: ContestResultRow[];
  /** Fixed, non-configurable server rule — display only, never editable. */
  tieBreakRule: string | null;
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

function pick(row: Record<string, unknown>, camel: string, snake: string): unknown {
  return row[camel] !== undefined ? row[camel] : row[snake];
}

function toRound(row: Record<string, unknown>): VotingRound {
  return {
    id: String(row.id ?? ''),
    contestId: String(pick(row, 'contestId', 'contest_id') ?? ''),
    name: String(row.name ?? ''),
    roundNumber: Number(pick(row, 'roundNumber', 'round_number') ?? 0),
    status: String(row.status ?? 'upcoming'),
    startsAt: (pick(row, 'startsAt', 'starts_at') as string | null) ?? null,
    endsAt: (pick(row, 'endsAt', 'ends_at') as string | null) ?? null,
  };
}

/** Ordered by round_number ascending, per the existing GET /rounds route. */
export async function listVotingRounds(contestId: string): Promise<VotingRound[]> {
  const qs = `?contestId=${encodeURIComponent(contestId)}`;
  const res = await fetch(`${webProxyBase()}/api/admin/voting/rounds${qs}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  const json = await readJsonOrThrow(res, 'Loading voting rounds');
  const rows = (json.rounds ?? []) as Array<Record<string, unknown>>;
  return rows.map(toRound);
}

function toResultRow(row: Record<string, unknown>): ContestResultRow {
  return {
    contestantId: String(pick(row, 'contestantId', 'contestant_id') ?? ''),
    contestantName: (pick(row, 'contestantName', 'contestant_name') as string | null) ?? null,
    rank: Number(row.rank ?? 0),
    totalConfirmedVotes: Number(pick(row, 'totalConfirmedVotes', 'total_confirmed_votes') ?? 0),
    paidVotes: Number(pick(row, 'paidVotes', 'paid_votes') ?? 0),
    prizeId: (pick(row, 'prizeId', 'prize_id') as string | null) ?? null,
    prizeDescription: (pick(row, 'prizeDescription', 'prize_description') as string | null) ?? null,
  };
}

function toRoundResults(json: Record<string, unknown>): RoundResults {
  const rows = (json.results ?? []) as Array<Record<string, unknown>>;
  return {
    published: Boolean(json.published),
    results: rows.map(toResultRow),
    tieBreakRule: (json.tieBreakRule as string | null) ?? null,
  };
}

export async function getRoundResults(roundId: string): Promise<RoundResults> {
  const res = await fetch(`${webProxyBase()}/api/admin/voting/rounds/${encodeURIComponent(roundId)}/results`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  const json = await readJsonOrThrow(res, 'Loading results');
  return toRoundResults(json);
}

/**
 * Result of proposing (not executing) a results publish — the endpoint now
 * returns HTTP 202 with this shape instead of executing immediately (SEC-005/
 * G-MC maker-checker). A second approver must act on it via
 * contestApprovalsService before the round's status actually flips to
 * results_published; poll getRoundResults() for the real state.
 */
export type PublishProposedResult = {
  proposed: true;
  approvalId: string;
  message: string;
};

/**
 * Proposes computing final ranks with the fixed tie-break, assigning prizes
 * by rank<->position, and locking the round — this no longer executes in
 * the same request. The server returns 202 with an approvalId; a second
 * approver (super_admin, via /admin/voting/approvals) must approve it
 * before the round's status actually flips to results_published and an
 * immutable snapshot is inserted. ONE-TIME once executed — a second publish
 * attempt on an already-published round throws with the server's 409
 * message ("Results already published and locked for this round").
 */
export async function publishRoundResults(roundId: string): Promise<PublishProposedResult> {
  const res = await fetch(`${webProxyBase()}/api/admin/voting/rounds/${encodeURIComponent(roundId)}/publish-results`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
  });
  const json = await readJsonOrThrow(res, 'Publishing results');
  return {
    proposed: true,
    approvalId: String(json.approvalId ?? ''),
    message: String(json.message ?? 'Proposed — awaiting a second approver.'),
  };
}
