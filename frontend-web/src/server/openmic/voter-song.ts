/**
 * The song a voter should hear for one contestant on the shared voting profile.
 *
 * `/vote/<contest>/<contestant>` is the page a shared link opens, and its payload
 * comes from `app/api/vote-page/route.ts` — a protected-legacy file that has
 * carried `audioUrl: null` since it was written. Rather than edit it, the page
 * asks this module's route, so the Open Mic rule stays in the Open Mic plane and
 * the voting engine keeps its own contract.
 *
 * The join is the one the promotion seam already writes: a contestant row carries
 * the `user_id` of the applicant it was promoted from
 * (`promote_registration_to_contestant`), and a song is keyed by that same user
 * plus the edition. Nothing new is stored, so an edition that never had a song
 * uploaded simply resolves to null and the page renders no player.
 */
import { createAdminClient } from '@/lib/supabase/server';
import { isPubliclyPlayableSongStatus, songReaderUrl } from '@/src/features/openmic/song-storage';
import type { OpenMicSubmission } from '@/src/features/openmic/types';
import { getContestBySlug, listSubmissions } from './persistence';

/** Roster ids are uuids. A slug that reaches `.eq('id', …)` bounces back as a
 *  Postgres 22P02, so the shape is checked before the query runs. */
const CONTESTANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type VoterSong = {
  submissionId: string;
  audioUrl: string;
  songTitle: string;
};

/**
 * Newest submission a voter is allowed to hear.
 *
 * `listSubmissions` already sorts `createdAt desc`, so this returns the song the
 * artist last handed in — an artist who re-uploads after a correction request
 * should not keep playing the old take. A row with no bytes behind it (uploaded
 * to storage but never completed, or cleared by review) is skipped rather than
 * turned into a player that errors.
 */
export function pickPlayableSong(submissions: OpenMicSubmission[]): VoterSong | null {
  const song = submissions.find(
    (item) => isPubliclyPlayableSongStatus(item.status) && Boolean(item.songObjectKey || item.songUrl),
  );
  return song ? { submissionId: song.id, audioUrl: songReaderUrl(song.id), songTitle: song.songTitle } : null;
}

export async function getVoterSong(input: {
  contestSlug: string;
  contestantId: string;
}): Promise<VoterSong | null> {
  const contestantId = String(input.contestantId || '').trim();
  const contestSlug = String(input.contestSlug || '').trim();
  if (!contestSlug || !CONTESTANT_ID.test(contestantId)) return null;

  // Not an Open Mic edition (or the row is typed some other way) — no song plane.
  const contest = await getContestBySlug(contestSlug);
  if (!contest) return null;

  const supabase = createAdminClient();
  const { data: rosterRow, error } = await supabase
    .from('contestants')
    .select('id, user_id')
    .eq('id', contestantId)
    .maybeSingle();
  if (error) throw error;

  // Guest registrations promote with a NULL user, and a song can only ever be
  // uploaded by a signed-in artist, so there is nothing to join on here.
  const userId = String((rosterRow as { user_id?: string | null } | null)?.user_id || '').trim();
  if (!userId) return null;

  return pickPlayableSong(await listSubmissions({ contestId: contest.id, userId }));
}
