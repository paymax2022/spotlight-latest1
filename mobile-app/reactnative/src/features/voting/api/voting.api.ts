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
} from '../types/voting.types';
import {
  MOCK_CONTESTS,
  MOCK_CONTESTANTS,
  MOCK_VOTE_PACKAGES,
  MOCK_VOTE_TRANSACTIONS,
  MOCK_FREE_VOTE_ALLOCATION,
  MOCK_LEADERBOARD,
  MOCK_VOTING_NOTIFICATIONS,
} from './voting.mock';

// ─── Feature flag: flip to false once real endpoints are ready ─────────────────
const USE_MOCK = true;

// ─── Contests ─────────────────────────────────────────────────────────────────

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
  const res = await api.get('/voting/contests', { params });
  return (res.data?.data ?? res.data) as Contest[];
}

export async function getContest(contestId: string): Promise<Contest> {
  if (USE_MOCK) {
    const found = MOCK_CONTESTS.find((c) => c.id === contestId);
    if (!found) throw new Error('Contest not found');
    return found;
  }
  const res = await api.get(`/voting/contests/${contestId}`);
  return (res.data?.data ?? res.data) as Contest;
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
  const res = await api.get(`/voting/contests/${contestId}/contestants`, { params });
  return (res.data?.data ?? res.data) as Contestant[];
}

export async function getContestant(contestantId: string): Promise<Contestant> {
  if (USE_MOCK) {
    const found = MOCK_CONTESTANTS.find((c) => c.id === contestantId);
    if (!found) throw new Error('Contestant not found');
    return found;
  }
  const res = await api.get(`/voting/contestants/${contestantId}`);
  return (res.data?.data ?? res.data) as Contestant;
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

export async function getLeaderboard(contestId: string): Promise<LeaderboardEntry[]> {
  if (USE_MOCK) return MOCK_LEADERBOARD.filter((e) => e.contestant.contestId === contestId);
  const res = await api.get(`/voting/contests/${contestId}/leaderboard`);
  return (res.data?.data ?? res.data) as LeaderboardEntry[];
}

// ─── Vote Packages ─────────────────────────────────────────────────────────────

export async function getVotePackages(contestId?: string): Promise<VotePackage[]> {
  if (USE_MOCK) return MOCK_VOTE_PACKAGES;
  const res = await api.get('/voting/packages', { params: { contestId } });
  return (res.data?.data ?? res.data) as VotePackage[];
}

// ─── Free Vote Allocation ──────────────────────────────────────────────────────

export async function getFreeVoteAllocation(contestId: string): Promise<FreeVoteAllocation> {
  if (USE_MOCK) return MOCK_FREE_VOTE_ALLOCATION;
  const res = await api.get(`/voting/free-votes/${contestId}`);
  return (res.data?.data ?? res.data) as FreeVoteAllocation;
}

// ─── Cast Free Votes ──────────────────────────────────────────────────────────

export async function castFreeVotes(payload: VoteFreePayload): Promise<{ success: boolean; remainingFreeVotes: number }> {
  if (USE_MOCK) {
    return { success: true, remainingFreeVotes: Math.max(0, MOCK_FREE_VOTE_ALLOCATION.remaining - payload.votes) };
  }
  const res = await api.post(
    '/voting/vote/free',
    payload,
    { headers: { 'Idempotency-Key': payload.idempotencyKey } },
  );
  return res.data?.data ?? res.data;
}

// ─── Paid Vote Initiate ────────────────────────────────────────────────────────

export async function initiatePaidVote(payload: VotePaidInitiatePayload): Promise<VotePaidInitiateResult> {
  if (USE_MOCK) {
    return {
      reference: `SPL-VT-${Date.now()}`,
      status: 'PROCESSING',
    };
  }
  const res = await api.post(
    '/voting/vote/paid/initiate',
    payload,
    { headers: { 'Idempotency-Key': payload.idempotencyKey } },
  );
  return res.data?.data ?? res.data;
}

export async function verifyPaidVote(reference: string): Promise<{ status: string; votes?: number }> {
  if (USE_MOCK) {
    return { status: 'SUCCESSFUL', votes: 50 };
  }
  const res = await api.post('/voting/vote/paid/verify', { reference });
  return res.data?.data ?? res.data;
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
