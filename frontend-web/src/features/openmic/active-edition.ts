import { getLeaderboard, listContests } from '@/src/server/openmic/persistence';
import type { OpenMicContest, OpenMicSubmission } from '@/src/features/openmic/types';
import { slugifyArtist } from '@/src/features/openmic/workflow';
import { publicBeatUrl } from '@/src/features/openmic/beat-storage';

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

/** Everything the steps block renders, decided server-side so the client only
 *  ever tests for `null`. No Date objects: it crosses the server/client boundary. */
export type OpenMicEditionStepsData = {
  id: string;
  slug: string;
  title: string;
  status: string;
  registrationStartAt: string | null;
  registrationEndAt: string | null;
  submissionStartAt: string | null;
  submissionEndAt: string | null;
  votingStartAt: string | null;
  votingEndAt: string | null;
  registrationFeeNgn: number;
  entryFeeRequired: boolean;
  showLeaderboard: boolean;
  showVoteCounts: boolean;
  beat: {
    title: string;
    producerCredit: string;
    usageRules: string;
    previewUrl: string | null;
    downloadUrl: string | null;
    downloadable: boolean;
    requiresPaidEntry: boolean;
  } | null;
  leaderboard: { rank: number; artistSlug: string; stageName: string; songTitle: string; voteCount: number }[];
  entryCount: number;
  totalVotes: number;
};

function at(value: string | undefined): string | null {
  return value ?? null;
}

/** `board` arrives already ordered by the store (leaderboard_score, then
 *  public_vote_count) — this only projects, truncates and totals. */
export function buildOpenMicEditionStepsData(
  contest: OpenMicContest,
  board: OpenMicSubmission[],
): OpenMicEditionStepsData {
  const beat = contest.beat;
  const previewUrl = beat ? publicBeatUrl(beat.previewUrl) : null;
  const downloadUrl = beat ? publicBeatUrl(beat.downloadUrl) : null;

  return {
    id: contest.id,
    slug: contest.slug,
    title: contest.title,
    status: contest.status,
    registrationStartAt: at(contest.registrationStartAt),
    registrationEndAt: at(contest.registrationEndAt),
    submissionStartAt: at(contest.submissionStartAt),
    submissionEndAt: at(contest.submissionEndAt),
    votingStartAt: at(contest.votingConfig?.votingStartAt),
    votingEndAt: at(contest.votingConfig?.votingEndAt),
    registrationFeeNgn: contest.registrationFeeNgn,
    entryFeeRequired: contest.entryFeeRequired,
    showLeaderboard: contest.votingConfig?.leaderboardVisible !== false,
    showVoteCounts: contest.votingConfig?.voteCountPublic !== false,
    beat: beat
      ? {
          title: beat.beatTitle,
          producerCredit: beat.producerCredit || beat.producerName || '',
          usageRules: beat.usageRules || '',
          previewUrl,
          downloadUrl,
          // A beat is offered for download only when the admin left it active
          // (is_active -> allowDownload) AND the stored path is one the public
          // reader will actually serve.
          downloadable: beat.allowDownload === true && downloadUrl !== null,
          requiresPaidEntry: beat.requiresPaidEntryForDownload === true,
        }
      : null,
    leaderboard: board.slice(0, 5).map((row, index) => ({
      rank: index + 1,
      artistSlug: slugifyArtist(row.stageName),
      stageName: row.stageName,
      songTitle: row.songTitle,
      voteCount: row.voteCount,
    })),
    entryCount: board.length,
    totalVotes: board.reduce((sum, row) => sum + row.voteCount, 0),
  };
}

/**
 * One server read for the programme page. A leaderboard failure must not take
 * the page down: getLeaderboard already returns [] when the DB is unconfigured,
 * and this keeps that promise for the throwing case too.
 */
export async function loadOpenMicEditionSteps(): Promise<OpenMicEditionStepsData | null> {
  const contest = await getActiveOpenMicEdition();
  if (!contest) return null;
  let board: OpenMicSubmission[] = [];
  try {
    board = await getLeaderboard(contest.id);
  } catch {
    board = [];
  }
  return buildOpenMicEditionStepsData(contest, board);
}
