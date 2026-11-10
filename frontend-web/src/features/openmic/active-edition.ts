import { getLeaderboard, listContests } from '@/src/server/openmic/persistence';
import type { OpenMicContest, OpenMicSubmission } from '@/src/features/openmic/types';

/**
 * An edition is current from the moment it is published until its result is
 * announced. Everything outside that either never started (`draft`,
 * `scheduled`), finished (`winner_announced`, `completed`, `archived`) or was
 * called off (`suspended`, `cancelled`) — none of which has a live step to show.
 *
 * The narrow list this replaces (`registration_open`, `published`,
 * `submission_open`, `voting_live`) dropped an edition the moment its beat was
 * published or its window closed, so the programme page went blank while the
 * admin console still called the edition live.
 */
export const CURRENT_OPEN_MIC_STATUSES = [
  'published',
  'registration_open',
  'beat_available',
  'submission_open',
  'submission_closed',
  'under_review',
  'voting_live',
  'voting_closed',
  'finalists_selected',
] as const satisfies readonly OpenMicContest['status'][];

/**
 * The one current edition, or null. listContests() already restricts rows to
 * contest_type = 'one_beat_one_verse', drops hidden ones and returns [] when
 * Supabase reads are unconfigured, so nothing here re-filters — and nothing
 * here falls back to "the newest row whatever it is", which is how the apply
 * page used to redirect artists into an ended edition.
 */
export async function getActiveOpenMicEdition(): Promise<OpenMicContest | null> {
  const contests = await listContests();
  const live = new Set<string>(CURRENT_OPEN_MIC_STATUSES);
  return contests.find((row) => live.has(row.status)) ?? null;
}
