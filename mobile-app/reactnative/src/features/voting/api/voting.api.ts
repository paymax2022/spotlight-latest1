import { api } from '@/api/client';
import type {
  Contest,
  Contestant,
  VotePackage,
  VoteTransaction,
  FreeVoteAllocation,
  LeaderboardEntry,
  VoteFreePayload,
  VotePaidInitiatePayload,
  VotePaidInitiateResult,
  VotePaidVerifyResult,
  RankChange,
  LeaderboardState,
} from '../types/voting.types';
import {
  mapContest,
  mapContestant,
  mapLeaderboardEntry,
  type BackendContest,
  type BackendRosterEntry,
} from './connectVoting.mapper';
import {
  MOCK_CONTESTS,
  MOCK_CONTESTANTS,
  MOCK_VOTE_PACKAGES,
  MOCK_VOTE_TRANSACTIONS,
  MOCK_LEADERBOARD,
  MOCK_VOTING_NOTIFICATIONS,
} from './voting.mock';

// ─── Feature flag: flip to false once real endpoints are ready ─────────────────
// Mock by default; set EXPO_PUBLIC_VOTING_USE_MOCK=false to hit the live backend.
const USE_MOCK = (process.env.EXPO_PUBLIC_VOTING_USE_MOCK ?? 'true').toLowerCase() !== 'false';

// Live voting is served by the Go backend's Connect module. Contests,
// contestants and free votes all come from here; the roster is the same ranked
// list the admin console publishes to, so approving an entry there makes it
// votable here.
const CONNECT_VOTING_BASE = '/api/v1/connect';

// ─── Contests ─────────────────────────────────────────────────────────────────

/**
 * Map a raw contest-detail response into our Contest shape, honouring the
 * admin visibility flags. Each flag DEFAULTS TO TRUE when the backend omits it
 * so existing contests (which never send these fields) are unaffected. When
 * `showVoteCount` is false, `totalVotes` is coerced to `null` so no numeric
 * count leaks through.
 */
function normalizeContest(raw: Record<string, unknown>): Contest {
  const c = raw as unknown as Contest;
  const showVoteCount   = (raw.showVoteCount   ?? raw.show_vote_count)   !== false;
  const showLeaderboard = (raw.showLeaderboard ?? raw.show_leaderboard) !== false;
  const showRank        = (raw.showRank        ?? raw.show_rank)        !== false;
  const activePhaseLabel =
    (raw.activePhaseLabel ?? raw.active_phase_label ?? null) as string | null;
  return {
    ...c,
    showVoteCount,
    showLeaderboard,
    showRank,
    activePhaseLabel,
    totalVotes: showVoteCount ? (c.totalVotes ?? null) : null,
  };
}

export async function getContests(params?: {
  category?: string;
  status?: string;
  page?: number;
  limit?: number;
}): Promise<Contest[]> {
  if (USE_MOCK) {
    let list = [...MOCK_CONTESTS];
    if (params?.category) list = list.filter((c) => c.category === params.category);
    if (params?.status)   list = list.filter((c) => c.status === params.status);
    return list;
  }
  const res = await api.get(`${CONNECT_VOTING_BASE}/contests`, { params });
  const list = (res.data?.data ?? res.data ?? []) as BackendContest[];
  return list.map((c) => normalizeContest(mapContest(c) as unknown as Record<string, unknown>));
}

export async function getContest(contestId: string): Promise<Contest> {
  if (USE_MOCK) {
    const found = MOCK_CONTESTS.find((c) => c.id === contestId);
    if (!found) throw new Error('Contest not found');
    return found;
  }
  const res = await api.get(`${CONNECT_VOTING_BASE}/contests/${contestId}`);
  const raw = (res.data?.data ?? res.data ?? {}) as BackendContest;
  // The detail endpoint returns no summary columns, so derive the count from
  // the roster — the authoritative list of who is actually votable.
  let count = raw.contestant_count ?? 0;
  let votes: number | null = raw.total_votes ?? null;
  try {
    const roster = await api.get(`${CONNECT_VOTING_BASE}/contests/${contestId}/contestants`);
    const rows = (roster.data?.data ?? []) as BackendRosterEntry[];
    count = rows.length;
    votes = rows.reduce((sum, r) => sum + (r.total_votes ?? 0), 0);
  } catch {
    /* roster unavailable — show the contest without a count rather than failing */
  }
  return normalizeContest(mapContest(raw, count, votes) as unknown as Record<string, unknown>);
}

// ─── Contestants ──────────────────────────────────────────────────────────────

export async function getContestants(
  contestId: string,
  params?: { search?: string; category?: string; state?: string; sort?: string },
): Promise<Contestant[]> {
  if (USE_MOCK) {
    let list = MOCK_CONTESTANTS.filter((c) => c.contestId === contestId);
    if (params?.search) {
      const q = params.search.toLowerCase();
      list = list.filter(
        (c) => c.name.toLowerCase().includes(q) || (c.stageName ?? '').toLowerCase().includes(q),
      );
    }
    if (params?.category) list = list.filter((c) => c.category === params.category);
    if (params?.state)    list = list.filter((c) => c.state === params.state);
    return list;
  }
  const res = await api.get(`${CONNECT_VOTING_BASE}/contests/${contestId}/contestants`, { params });
  const list = (res.data?.data ?? res.data ?? []) as BackendRosterEntry[];
  return list.map((r) =>
    normalizeContestantTrend(mapContestant(r, contestId) as unknown as Record<string, unknown>),
  );
}

/**
 * Ensure a contestant carries an uppercase `movement` derived from the
 * backend's lowercase `rankChange` when present, so the trend badges render
 * regardless of which field the API populates.
 */
function normalizeContestantTrend(raw: Record<string, unknown>): Contestant {
  const c = raw as unknown as Contestant;
  const rankChange = (raw.rankChange ?? raw.rank_change) as RankChange | undefined;
  return { ...c, movement: movementFromTrend(rankChange, c.movement) };
}

export async function getContestant(contestantId: string): Promise<Contestant> {
  if (USE_MOCK) {
    const found = MOCK_CONTESTANTS.find((c) => c.id === contestantId);
    if (!found) throw new Error('Contestant not found');
    return found;
  }
  const res = await api.get(`${CONNECT_VOTING_BASE}/contestants/${contestantId}`);
  const raw = (res.data?.data ?? res.data ?? {}) as BackendRosterEntry & { contest_id?: string };
  return normalizeContestantTrend(
    mapContestant(raw, raw.contest_id ?? '') as unknown as Record<string, unknown>,
  );
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

function normalizeLeaderboardEntries(
  list: Array<Record<string, unknown>>,
): LeaderboardEntry[] {
  // The backend may report trend as lowercase `rankChange` ('up'|'down'|'same')
  // or legacy uppercase `movement`. Normalise so both the entry and its nested
  // contestant carry a usable `movement`, while keeping `rankChange` for the
  // trend components that prefer it.
  return list.map((raw) => {
    const entry = raw as unknown as LeaderboardEntry;
    const rankChange = (raw.rankChange ?? raw.rank_change) as RankChange | undefined;
    const movement = movementFromTrend(rankChange, entry.movement);
    return {
      ...entry,
      rankChange: rankChange ?? entry.rankChange,
      movement,
      contestant: entry.contestant
        ? { ...entry.contestant, movement: entry.contestant.movement ?? movement }
        : entry.contestant,
    };
  });
}

/**
 * Fetch the leaderboard along with its hidden state. When the admin disables
 * the leaderboard, the endpoint returns `{ hidden: true, reason, entries: [] }`,
 * which we surface so the UI can show a clean hidden state instead of an empty
 * list that looks like "no data yet".
 */
export async function getLeaderboardState(contestId: string): Promise<LeaderboardState> {
  if (USE_MOCK) {
    const contest = MOCK_CONTESTS.find((c) => c.id === contestId);
    if (contest?.showLeaderboard === false) {
      return {
        hidden: true,
        reason: contest.activePhaseLabel
          ? `The leaderboard is hidden during ${contest.activePhaseLabel}.`
          : null,
        entries: [],
      };
    }
    return {
      hidden: false,
      entries: MOCK_LEADERBOARD.filter((e) => e.contestant.contestId === contestId),
    };
  }
  // The leaderboard IS the ranked roster — same endpoint, same ordering — so a
  // vote moves the contestant list and the leaderboard consistently instead of
  // letting two separately-tallied views disagree.
  const res = await api.get(`${CONNECT_VOTING_BASE}/contests/${contestId}/contestants`);
  const rows = (res.data?.data ?? res.data ?? []) as BackendRosterEntry[];
  const body = rows.map((r) => mapLeaderboardEntry(r, contestId) as unknown as Record<string, unknown>) as
    | Array<Record<string, unknown>>
    | { hidden?: boolean; reason?: string | null; entries?: Array<Record<string, unknown>> };

  // Hidden shape: { hidden: true, reason, entries: [] }
  if (!Array.isArray(body) && body?.hidden) {
    return {
      hidden: true,
      reason: body.reason ?? null,
      entries: [],
    };
  }

  const rawEntries = Array.isArray(body) ? body : (body?.entries ?? []);
  return { hidden: false, entries: normalizeLeaderboardEntries(rawEntries) };
}

/**
 * Convenience wrapper returning just the entries (empty when hidden). Existing
 * callers that only need the list keep working unchanged.
 */
export async function getLeaderboard(contestId: string): Promise<LeaderboardEntry[]> {
  const state = await getLeaderboardState(contestId);
  return state.entries;
}

/**
 * Normalise a backend trend signal into the uppercase `movement` the contestant
 * cards/badges consume. Prefers lowercase `rankChange` ('up'|'down'|'same'),
 * falls back to an existing `movement`, then leaves it undefined.
 */
function movementFromTrend(
  rankChange?: string | null,
  movement?: 'UP' | 'DOWN' | 'SAME',
): 'UP' | 'DOWN' | 'SAME' | undefined {
  switch (String(rankChange ?? '').toLowerCase()) {
    case 'up':   return 'UP';
    case 'down': return 'DOWN';
    case 'same': return 'SAME';
    default:     return movement;
  }
}

// ─── Vote Packages ─────────────────────────────────────────────────────────────

export async function getVotePackages(contestId?: string): Promise<VotePackage[]> {
  if (USE_MOCK) return MOCK_VOTE_PACKAGES;
  const res = await api.get('/voting/packages', { params: { contestId } });
  return (res.data?.data ?? res.data) as VotePackage[];
}

// ─── Free Vote Allocation (PER CONTESTANT) ──────────────────────────────────────
// Each voter gets 1 free vote per day for EACH contestant (admin-configurable).
// Once that vote is cast, free voting for that contestant freezes until the 24h
// reset. `resetsAt` drives the visible reset countdown. The live backend drives
// this from the admin-set `freeVotesPerDay`; the mock mirrors the default of 1.

const FREE_VOTE_CAP = 1;

// The per-contestant daily cap is an admin setting carried on the contest
// (`freeVotesPerDay`). Default to 1 when a contest omits/misconfigures it so the
// rule — one free vote per contestant per day — always holds.
function capForContest(contestId: string): number {
  const n = Number(MOCK_CONTESTS.find((c) => c.id === contestId)?.freeVotesPerDay);
  return Number.isFinite(n) && n > 0 ? n : FREE_VOTE_CAP;
}

function nextLocalMidnightISO(): string {
  const d = new Date();
  d.setHours(24, 0, 0, 0); // start of tomorrow, local time
  return d.toISOString();
}

// Mock usage, tracked PER contestant so each resets independently.
const mockFreeUsed: Record<string, number> = {};
const mockKey = (contestId: string, contestantId?: string) => `${contestId}:${contestantId ?? 'contest'}`;

export async function getFreeVoteAllocation(
  contestId: string,
  contestantId?: string,
): Promise<FreeVoteAllocation> {
  if (USE_MOCK) {
    const cap = capForContest(contestId);
    const used = mockFreeUsed[mockKey(contestId, contestantId)] ?? 0;
    return {
      total: cap,
      used,
      remaining: Math.max(0, cap - used),
      resetsAt: nextLocalMidnightISO(),
    };
  }
  // Live: the Connect backend computes the allowance from the contest's
  // per-user cap and the votes actually recorded, so this cannot disagree with
  // what the vote endpoint enforces.
  const res = await api.get(`${CONNECT_VOTING_BASE}/contests/${contestId}/free-vote-allowance`);
  const d = (res.data?.data ?? res.data) as Record<string, unknown>;
  return {
    total: Number(d.total ?? d.freeVotesPerDay ?? d.free_votes_per_day ?? FREE_VOTE_CAP),
    used: Number(d.used ?? d.freeVotesUsed ?? d.free_votes_used ?? 0),
    remaining: Number(d.remaining ?? d.freeVotesRemaining ?? d.free_votes_remaining ?? 0),
    resetsAt: String(d.resetAt ?? d.reset_at ?? nextLocalMidnightISO()),
  };
}

// ─── Cast Free Votes ──────────────────────────────────────────────────────────

export async function castFreeVotes(
  payload: VoteFreePayload,
): Promise<{ success: boolean; remainingFreeVotes: number; resetsAt?: string }> {
  if (USE_MOCK) {
    const cap = capForContest(payload.contestId);
    const key = mockKey(payload.contestId, payload.contestantId);
    const used = mockFreeUsed[key] ?? 0;
    if (used >= cap) {
      const msg =
        cap === 1
          ? 'You have used your free vote for this contestant today. Free votes reset in 24h.'
          : `You have used all ${cap} free votes for this contestant today. Free votes reset in 24h.`;
      const err = new Error(msg) as Error & { response?: { data?: { error?: string } } };
      err.response = { data: { error: msg } };
      throw err;
    }
    const add = Math.min(payload.votes, cap - used);
    mockFreeUsed[key] = used + add;
    return { success: true, remainingFreeVotes: Math.max(0, cap - used - add), resetsAt: nextLocalMidnightISO() };
  }
  // The Connect free-vote endpoint takes the contestant id as optionRef and
  // enforces the per-contest allowance, the velocity guard and roster
  // membership server-side; the client cannot override any of them.
  const res = await api.post(
    `${CONNECT_VOTING_BASE}/contests/${payload.contestId}/vote`,
    { optionRef: payload.contestantId },
    { headers: { 'Idempotency-Key': payload.idempotencyKey } },
  );
  // The server returns the post-vote allowance; trust it over any local count.
  const allowance = (res.data?.allowance ?? {}) as { remaining?: number };
  return {
    success: true,
    remainingFreeVotes: Number(allowance.remaining ?? 0),
    resetsAt: nextLocalMidnightISO(),
  };
}

// ─── Paid Vote Initiate ────────────────────────────────────────────────────────

export async function initiatePaidVote(payload: VotePaidInitiatePayload): Promise<VotePaidInitiateResult> {
  if (USE_MOCK) {
    return {
      transactionId: `txn-${Date.now()}`,
      reference: `SPL-VT-${Date.now()}`,
      votesToCredit: payload.votes,
      amountExpected: payload.amount,
      status: 'PROCESSING',
    };
  }
  // Backend: POST /api/votes/paid/initiate (no /voting prefix, no /v2).
  // Requires voterEmail + voterName; vote count goes in `customVoteQuantity`
  // unless a preset `packageId` is supplied.
  const res = await api.post(
    '/api/votes/paid/initiate',
    {
      contestId:          payload.contestId,
      contestantId:       payload.contestantId,
      packageId:          payload.packageId || undefined,
      customVoteQuantity: payload.packageId ? undefined : payload.votes,
      voterEmail:         payload.voterEmail,
      voterName:          payload.voterName,
    },
    { headers: { 'Idempotency-Key': payload.idempotencyKey } },
  );
  const data = (res.data?.data ?? res.data) as Record<string, unknown>;
  return {
    transactionId:   String(data.transactionId ?? data.transaction_id ?? ''),
    reference:       String(data.paymentReference ?? data.payment_reference ?? ''),
    authorizationUrl: data.authorizationUrl != null ? String(data.authorizationUrl) : undefined,
    amountExpected:  data.amountExpected != null ? Number(data.amountExpected) : undefined,
    votesToCredit:   data.votesToCredit != null ? Number(data.votesToCredit) : undefined,
    bonusVotes:      data.bonusVotes != null ? Number(data.bonusVotes) : undefined,
    status:          'PROCESSING',
  };
}

export async function verifyPaidVote(args: {
  transactionId: string;
  reference: string;
}): Promise<VotePaidVerifyResult> {
  if (USE_MOCK) {
    return { status: 'SUCCESSFUL', votes: 50 };
  }
  // Backend: POST /api/votes/paid/verify expects { transactionId, paymentReference }.
  const res = await api.post('/api/votes/paid/verify', {
    transactionId:    args.transactionId,
    paymentReference: args.reference,
  });
  const data = (res.data?.data ?? res.data) as Record<string, unknown>;
  return {
    status:        data.success ? 'SUCCESSFUL' : 'FAILED',
    votes:         data.votesCredited != null ? Number(data.votesCredited) : undefined,
    newTotalVotes: data.newTotalVotes != null ? Number(data.newTotalVotes) : undefined,
    receiptNumber: data.receiptNumber != null ? String(data.receiptNumber) : null,
  };
}

// ─── My Votes ─────────────────────────────────────────────────────────────────

export async function getMyVotes(params?: {
  contestId?: string;
  voteType?: string;
  status?: string;
}): Promise<VoteTransaction[]> {
  if (USE_MOCK) {
    let list = [...MOCK_VOTE_TRANSACTIONS];
    if (params?.contestId) list = list.filter((t) => t.contestId === params.contestId);
    if (params?.voteType)  list = list.filter((t) => t.voteType === params.voteType);
    if (params?.status)    list = list.filter((t) => t.status === params.status);
    return list;
  }
  const res = await api.get('/voting/my-votes', { params });
  return (res.data?.data ?? res.data) as VoteTransaction[];
}

export async function getVoteReceipt(transactionId: string): Promise<VoteTransaction> {
  if (USE_MOCK) {
    const found = MOCK_VOTE_TRANSACTIONS.find((t) => t.id === transactionId);
    if (!found) throw new Error('Transaction not found');
    return found;
  }
  const res = await api.get(`/voting/transactions/${transactionId}/receipt`);
  return (res.data?.data ?? res.data) as VoteTransaction;
}

// ─── Notifications ────────────────────────────────────────────────────────────

export async function getVotingNotifications() {
  if (USE_MOCK) return MOCK_VOTING_NOTIFICATIONS;
  const res = await api.get('/voting/notifications');
  return res.data?.data ?? res.data;
}
