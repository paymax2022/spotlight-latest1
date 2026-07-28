// Paymax Connect — VOTING types (PRD §6.3, §10.8 VT-*).
// SAFETY: PAID votes = REAL Naira wallet money (kobo) → tier limits + AML.
// Free polls never move money. Results are auditable; integrity note shown.

import type { ConnectTier } from '../types/connect.types';

export type ContestStatus = 'active' | 'upcoming' | 'ended';
export type VoteMode = 'free' | 'paid';

export interface Contest {
  id: string;
  title: string;
  subtitle?: string;
  coverUrl: string;
  status: ContestStatus;
  mode: VoteMode;            // free poll vs paid contest
  // For paid contests: price per vote in kobo. Free polls: 0.
  pricePerVoteKobo: number;
  totalVotes: number;
  endsAtIso: string;
  contestantCount: number;
  // Gambling-adjacency guard (PRD §6.3): paid votes must not pay out to voters.
  hasPrizeForVoters: boolean; // always false in MVP; surfaced for the integrity note
}

export interface Contestant {
  id: string;
  name: string;
  avatar: string;
  tagline?: string;
  votes: number;
  sharePct: number;          // % of total votes (0..100)
  rank: number;
}

export interface ContestDetail extends Contest {
  rules: string[];
  prizeInfo?: string;        // describes prize for CONTESTANTS only, never voters
  contestants: Contestant[];
}

// Result of casting a vote. Paid votes return updated money allowance.
export interface VoteResult {
  ok: boolean;
  contestantId: string;
  votesCast: number;
  amountKobo: number;            // 0 for free votes
  newRemainingKobo: number | null; // updated daily allowance (paid only)
  ledgerRef?: string;            // present for paid votes (audit)
}

// A row in the user's vote history (VT-08).
export interface VoteHistoryEntry {
  id: string;
  contestTitle: string;
  contestantName: string;
  mode: VoteMode;
  votes: number;
  amountKobo: number;        // 0 for free
  castAtIso: string;
}

// Leaderboard entry for a contest's live tally (VT-05).
export interface VoteLeaderboardEntry {
  rank: number;
  contestantId: string;
  name: string;
  avatar: string;
  votes: number;
  sharePct: number;
}

// Tier gate snapshot used by the paid-vote screen (read-only projection).
export interface VoteTierGate {
  tier: ConnectTier;
  label: string;
  dailyLimitKobo: number | null;
  remainingKobo: number | null;
  canPaidVote: boolean;
}
