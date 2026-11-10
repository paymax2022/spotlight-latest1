import { listContests } from '@/src/server/openmic/persistence';
import type { OpenMicContest } from '@/src/features/openmic/types';

/**
 * An edition is current from the moment it is published until its result is
 * announced. The finale (`grand_finale_scheduled`, `grand_finale_live`) is
 * inside that window — it is the step the edition is on, and an artist who
 * opens `/apply` during it still has a live edition to apply to. Everything
 * outside either never started (`draft`, `scheduled`), finished
 * (`winner_announced`, `completed`, `archived`) or was called off (`suspended`,
 * `cancelled`) — none of which has a live step to show.
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
  'grand_finale_scheduled',
  'grand_finale_live',
] as const satisfies readonly OpenMicContest['status'][];

/**
 * The one current edition, or null. listContests() already restricts rows to
 * contest_type = 'one_beat_one_verse', drops hidden ones, returns [] when
 * Supabase reads are unconfigured and orders `created_at desc`, so "first live
 * row" is "the newest live edition" and nothing here re-filters — and nothing
 * here falls back to "the newest row whatever it is", which is how the apply
 * page used to redirect artists into an ended edition.
 */
export async function getActiveOpenMicEdition(): Promise<OpenMicContest | null> {
  const contests = await listContests();
  const live = new Set<string>(CURRENT_OPEN_MIC_STATUSES);
  return contests.find((row) => live.has(row.status)) ?? null;
}
