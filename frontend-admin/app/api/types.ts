/**
 * Shared type definitions for Contest/Voting System
 * Used across Admin Portal, Mobile App, and Frontend Web
 */

export interface Contest {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'pending' | 'completed' | 'paused';
  startDate: string;
  endDate: string;
  participantCount: number;
  totalVotes: number;
}

export interface Contestant {
  id: string;
  name: string;
  email: string;
  phone: string;
  gender: 'Male' | 'Female' | 'Other';
  competition: string;
  competitionId: string;
  status: 'pending' | 'qualified' | 'disqualified' | 'withdrawn';
  submissionDate: string;
  registrationDate: string;
  contestantNumber: string;
  bio: string;
  score?: number;
  freeVotes: number;
  paidVotes: number;
  adminVotes: number;
  totalVotes: number;
}

export interface VoteRecord {
  id: string;
  contestant_id: string;
  vote_amount: number;
  admin_id: string;
  admin_name?: string;
  created_at: string;
  action: 'vote_added';
}

export interface VoteStats {
  id?: string;
  contestant_id: string;
  contestant_name?: string;
  competition_id?: string;
  free_votes: number;
  paid_votes: number;
  admin_votes: number;
  total_votes: number;
  rank?: number;
  created_at?: string;
  updated_at?: string;
}

export interface AdminVote {
  id: string;
  contestant_id: string;
  vote_count: number;
  admin_id: string;
  admin_name: string;
  competition_id: string;
  created_at: string;
  updated_at: string;
}

export interface LeaderboardEntry {
  rank: number;
  contestantId: string;
  name: string;
  competition: string;
  totalVotes: number;
  freeVotes: number;
  paidVotes: number;
  adminVotes: number;
  status: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  count?: number;
  total?: number;
  error?: string;
}

export interface VotingResponse {
  success: boolean;
  totalVotes: number;
  timestamp: string;
}

export interface ContestantVotingData {
  adminVotes: number;
  auditLog: VoteRecord[];
  voteStats: VoteStats;
}
