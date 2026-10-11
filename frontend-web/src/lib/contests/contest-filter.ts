// Shared, dependency-free types + filter for the public contests list. Kept out
// of src/server/contests/public-contests.ts on purpose: the client component
// imports this, and anything that module imports (the service-role Supabase
// client) must never be pulled into a browser bundle.

export type ContestFilter = 'active' | 'closed';

export type PublicContest = {
  id: string;
  slug: string;
  title: string;
  description: string;
  /** connect_contests open -> active, closed -> closed. Drafts are never listed. */
  status: ContestFilter;
  opensAt: string | null;
  closesAt: string | null;
  /** Admin-uploaded images; '' when none was set. */
  bannerImageUrl: string;
  logoUrl: string;
};

/** Contests for one option of the dropdown. Pure; does not mutate its input. */
export function filterContests(contests: PublicContest[], filter: ContestFilter): PublicContest[] {
  return contests.filter((c) => c.status === filter);
}
