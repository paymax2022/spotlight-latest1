// The contests list dropdown: Active contests (default) or Closed contests.
// Dependency-free so it can be unit-tested under node:test.
import type { Contest } from '../types/voting.types';

export type ContestFilter = 'active' | 'closed';

export const DEFAULT_CONTEST_FILTER: ContestFilter = 'active';

const LABELS: Record<ContestFilter, string> = {
  active: 'Active contests',
  closed: 'Closed contests',
};

export const CONTEST_FILTER_OPTIONS: string[] = [LABELS.active, LABELS.closed];

export function contestFilterLabel(filter: ContestFilter): string {
  return LABELS[filter];
}

export function contestFilterFromLabel(label: string): ContestFilter {
  return label === LABELS.closed ? 'closed' : DEFAULT_CONTEST_FILTER;
}

/** Value for the Go `?status=` param (allowlisted server-side). */
export function contestFilterApiStatus(filter: ContestFilter): string {
  return filter;
}

/**
 * Applied client-side too, so the list is right even against a backend that
 * ignores `?status=` and returns every contest. Upcoming/draft are in neither.
 */
export function filterContestsByStatus(contests: Contest[], filter: ContestFilter): Contest[] {
  const want = filter === 'active' ? 'LIVE' : 'CLOSED';
  return contests.filter((c) => c.status === want);
}
