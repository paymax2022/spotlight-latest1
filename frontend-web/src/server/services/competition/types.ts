export type PaginationInput = {
  page?: number;
  limit?: number;
};

export type PaginatedResult<T> = {
  items: T[];
  page: number;
  limit: number;
};

export type ServiceResult<T> = {
  success: true;
  data: T;
};

export type CompetitionWindowStage =
  | 'registration'
  | 'submission'
  | 'shortlist'
  | 'voting'
  | 'judging'
  | 'finals';

export type CompetitionLifecycleStatus = 'draft' | 'active' | 'upcoming' | 'ended' | 'archived';

export type EntryLifecycleStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'correction_requested'
  | 'shortlisted'
  | 'live_for_voting'
  | 'finalist'
  | 'winner'
  | 'disqualified';

export type VoteSourceType = 'free' | 'paid' | 'bundle' | 'referral' | 'bonus';
