/**
 * Voting API client — maps to /api/v2/votes/* and contest/contestant endpoints.
 * All amounts are in kobo (integer). No floats.
 */
import { api } from './client';
import type { Contest } from '@/components/voting/ContestCard';
import type { Contestant } from '@/components/voting/ContestantCard';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContestCategory {
  id: string;
  name: string;
  iconUrl?: string;
  activeContestCount: number;
}

export interface ContestDetail extends Contest {
  description: string;
  rules?: string;
  prizePool?: string;
  votingEnabled: boolean;
  freeVotesRemaining: number;
  userVoteCount: number;
}

export interface ContestantDetail extends Contestant {
  bio?: string;
  socialLinks?: { platform: string; url: string }[];
  recentVotes: number;
  highlights?: string[];
}

export interface LeaderboardEntry {
  rank: number;
  contestant: Contestant;
  previousRank?: number;
  rankChange: 'up' | 'down' | 'same';
}

export interface VotePackage {
  id: string;
  votes: number;
  priceKobo: number;
  bonusVotes: number;
  label?: string;
  popular?: boolean;
}

export interface FreeVoteResult {
  success: boolean;
  votesAdded: number;
  freeVotesRemaining: number;
  newTotalVotes: number;
}

export interface RemainingFreeVotes {
  contestId: string;
  freeVotesPerDay: number;
  freeVotesUsed: number;
  freeVotesRemaining: number;
  resetAt: string;
  nextResetHours: number;
}

export interface PaidVoteInitResult {
  transactionId: string;
  paymentReference: string;
  authorizationUrl: string;
  amountKobo: number;
  votesToCredit: number;
}

export interface WalletVoteResult {
  success: boolean;
  transactionId: string;
  paymentReference: string;
  votesCredited: number;
  amountKobo: number;
}

// ---------------------------------------------------------------------------
// Contests
// ---------------------------------------------------------------------------

export async function fetchCategories(): Promise<ContestCategory[]> {
  const { data } = await api.get<ContestCategory[]>('/api/v1/contests/categories');
  return data;
}

export async function fetchContests(params?: {
  category?: string;
  search?: string;
  page?: number;
}): Promise<Contest[]> {
  const { data } = await api.get<Contest[]>('/api/v1/contests', { params });
  return data;
}

export async function fetchContestDetail(contestId: string): Promise<ContestDetail> {
  const { data } = await api.get<ContestDetail>(`/api/v1/contests/${contestId}`);
  return data;
}

// ---------------------------------------------------------------------------
// Contestants
// ---------------------------------------------------------------------------

export async function fetchContestants(
  contestId: string,
  params?: { page?: number; search?: string },
): Promise<Contestant[]> {
  const { data } = await api.get<Contestant[]>(`/api/v1/contests/${contestId}/contestants`, { params });
  return data;
}

export async function fetchContestantDetail(contestantId: string): Promise<ContestantDetail> {
  const { data } = await api.get<ContestantDetail>(`/api/v1/contestants/${contestantId}`);
  return data;
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export async function fetchLeaderboard(contestId: string): Promise<LeaderboardEntry[]> {
  const { data } = await api.get<LeaderboardEntry[]>(`/api/v1/contests/${contestId}/leaderboard`);
  return data;
}

// ---------------------------------------------------------------------------
// Voting
// ---------------------------------------------------------------------------

export async function fetchRemainingFreeVotes(contestId: string): Promise<RemainingFreeVotes> {
  const { data } = await api.get<RemainingFreeVotes>('/api/votes/remaining', { params: { contestId } });
  return data;
}

export async function castFreeVote(params: {
  contestantId: string;
  contestId: string;
  idempotencyKey: string;
}): Promise<FreeVoteResult> {
  const { data } = await api.post<FreeVoteResult>('/api/v2/votes/free', params, {
    headers: { 'X-Idempotency-Key': params.idempotencyKey },
  });
  return data;
}

export async function fetchVotePackages(contestId: string): Promise<VotePackage[]> {
  const { data } = await api.get<VotePackage[]>(`/api/v1/contests/${contestId}/vote-packages`);
  return data;
}

export async function initiatePaidVote(params: {
  contestantId: string;
  contestId: string;
  packageId: string;
  paymentMethod: 'wallet' | 'paystack';
  idempotencyKey: string;
  voterEmail: string;
  voterName: string;
}): Promise<PaidVoteInitResult> {
  const { data } = await api.post<PaidVoteInitResult>('/api/votes/paid/initiate', params, {
    headers: { 'X-Idempotency-Key': params.idempotencyKey },
  });
  return data;
}

export async function walletPaidVote(params: {
  contestantId: string;
  contestId: string;
  packageId: string;
  idempotencyKey: string;
  voterEmail: string;
  voterName: string;
}): Promise<WalletVoteResult> {
  const { data } = await api.post<WalletVoteResult>('/api/votes/paid/wallet', params, {
    headers: { 'Idempotency-Key': params.idempotencyKey },
  });
  return data;
}

export async function verifyPaidVote(params: {
  transactionId: string;
  paymentReference: string;
  idempotencyKey: string;
}): Promise<{ success: boolean; votesCredited: number }> {
  const { data } = await api.post('/api/votes/paid/verify', params, {
    headers: { 'X-Idempotency-Key': params.idempotencyKey },
  });
  return data;
}
