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

/** Which side of a window the clock is on. A plain string union because this
 *  crosses the server/client boundary: the alternative was a client working it
 *  out during render, which pre-renders one answer and hydrates another. */
export type WindowState = 'open' | 'not-started' | 'closed' | 'unknown';

export function windowState(start: string | null, end: string | null, now: number): WindowState {
  const from = start ? Date.parse(start) : Number.NaN;
  const to = end ? Date.parse(end) : Number.NaN;
  if (!Number.isFinite(from) && !Number.isFinite(to)) return 'unknown';
  if (Number.isFinite(from) && now < from) return 'not-started';
  if (Number.isFinite(to) && now > to) return 'closed';
  return 'open';
}

/** Everything the steps block renders. Availability, the display switches,
 *  the board's numbers and which side of each window the clock is on are all
 *  decided here, against the server clock, so the browser recomputes nothing
 *  during render. No Date objects: this crosses the server/client boundary. */
export type OpenMicEditionStepsData = {
  id: string;
  slug: string;
  title: string;
  status: OpenMicContest['status'];
  registrationStartAt: string | null;
  registrationEndAt: string | null;
  registrationState: WindowState;
  submissionStartAt: string | null;
  submissionEndAt: string | null;
  submissionState: WindowState;
  votingStartAt: string | null;
  votingEndAt: string | null;
  votingState: WindowState;
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
  /** `null` means the board could not be read — which is not the same fact as
   *  "0 entries", and the page must never render a number for it. */
  board: {
    rows: {
      rank: number; artistSlug: string; stageName: string; songTitle: string;
      /** `null` when the admin hid the counts. The number stays out of the
       *  payload rather than being shipped for the client to hide. */
      voteCount: number | null;
    }[];
    entryCount: number;
    totalVotes: number | null;
  } | null;
};

function at(value: string | undefined): string | null {
  return value ?? null;
}

/** `board` arrives already ordered by the store (leaderboard_score, then
 *  public_vote_count) — this only projects, truncates and totals. Pass `null`
 *  for "the board could not be read"; `[]` means it was read and is empty. */
export function buildOpenMicEditionStepsData(
  contest: OpenMicContest,
  board: OpenMicSubmission[] | null,
): OpenMicEditionStepsData {
  const beat = contest.beat;
  const previewUrl = beat ? publicBeatUrl(beat.previewUrl) : null;
  const downloadUrl = beat ? publicBeatUrl(beat.downloadUrl) : null;
  // A beat is offered for download only when the admin left it active
  // (is_active -> allowDownload) AND the stored path is one the public reader
  // will actually serve.
  const downloadable = beat ? beat.allowDownload === true && downloadUrl !== null : false;

  const registrationStartAt = at(contest.registrationStartAt);
  const registrationEndAt = at(contest.registrationEndAt);
  const submissionStartAt = at(contest.submissionStartAt);
  const submissionEndAt = at(contest.submissionEndAt);
  const votingStartAt = at(contest.votingConfig?.votingStartAt);
  const votingEndAt = at(contest.votingConfig?.votingEndAt);
  // One instant for all three windows: two `Date.now()` calls could straddle a
  // boundary and report the same window twice.
  const now = Date.now();

  const showLeaderboard = contest.votingConfig?.leaderboardVisible !== false;
  const showVoteCounts = contest.votingConfig?.voteCountPublic !== false;

  return {
    id: contest.id,
    slug: contest.slug,
    title: contest.title,
    status: contest.status,
    registrationStartAt,
    registrationEndAt,
    registrationState: windowState(registrationStartAt, registrationEndAt, now),
    submissionStartAt,
    submissionEndAt,
    submissionState: windowState(submissionStartAt, submissionEndAt, now),
    votingStartAt,
    votingEndAt,
    votingState: windowState(votingStartAt, votingEndAt, now),
    registrationFeeNgn: contest.registrationFeeNgn,
    entryFeeRequired: contest.entryFeeRequired,
    showLeaderboard,
    showVoteCounts,
    beat: beat
      ? {
          title: beat.beatTitle,
          producerCredit: beat.producerCredit || beat.producerName || '',
          usageRules: beat.usageRules || '',
          previewUrl,
          downloadUrl,
          downloadable,
          // One rule, not two: a lock on a download this object has already
          // decided not to offer would tell an artist to pay for nothing.
          requiresPaidEntry: beat.requiresPaidEntryForDownload === true && downloadable,
        }
      : null,
    board: board === null
      ? null
      : {
          rows: board.slice(0, 5).map((row, index) => ({
            rank: index + 1,
            artistSlug: slugifyArtist(row.stageName),
            stageName: row.stageName,
            songTitle: row.songTitle,
            voteCount: showVoteCounts ? row.voteCount : null,
          })),
          // Totals are of the whole board, not the five rows shown.
          entryCount: board.length,
          totalVotes: showVoteCounts ? board.reduce((sum, row) => sum + row.voteCount, 0) : null,
        },
  };
}

/**
 * One server read for the programme page. A failed leaderboard read does not
 * take the page down and does not invent a number either: getLeaderboard
 * already returns [] when the DB is unconfigured and for a genuinely empty
 * contest, so only a thrown error reaches `null`.
 */
export async function loadOpenMicEditionSteps(): Promise<OpenMicEditionStepsData | null> {
  const contest = await getActiveOpenMicEdition();
  if (!contest) return null;
  let board: OpenMicSubmission[] | null = [];
  try {
    board = await getLeaderboard(contest.id);
  } catch {
    // A read that failed is not a contest with no entries: `null` is the only
    // value that stops the page printing "0 entries".
    board = null;
  }
  return buildOpenMicEditionStepsData(contest, board);
}
