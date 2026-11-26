// Open Mic workflow steps — what an approved artist has actually done.
//
// WHY THIS EXISTS
// The status screen's "Status history" was the review log and nothing else:
// draft, submitted, approved. For an Open Mic applicant approval is the start of
// the real work — download the beat, record, upload the file, hand it in, get a
// decision — and none of that was visible anywhere on the page, so an artist
// whose song was still a `draft` on the server believed they were in the contest.
//
// THE SOURCE OF TRUTH
// These steps are read from rows that already exist, never written by the UI:
//   beat_download_logs.downloaded_at   the beat hand-off (see logBeatDownload)
//   competition_entries                the artist's song row: created_at is the
//                                      upload, submitted_at the hand-in,
//                                      reviewed_at / live_at the decision, and
//                                      the bytes live in lyrical_concept_summary
// Because each step needs its own real timestamp, a step appears only when that
// timestamp exists — no row, no step; no `submitted_at`, no "submitted" step.
import { getRegistrationDraft } from '@/src/server/registration/supabase-store';
import { latestBeatDownloadAt, listSubmissions } from '@/src/server/openmic/persistence';
import { resolveOpenMicEdition } from '@/src/server/openmic/edition-resolution';
import type { OpenMicSubmission } from '@/src/features/openmic/types';

export type WorkflowStepKind =
  | 'beat_downloaded'
  | 'song_uploaded'
  | 'song_submitted'
  | 'song_reviewed';

export interface WorkflowStep {
  id: string;
  kind: WorkflowStepKind;
  label: string;
  /** ISO timestamp, or null when the decision exists but no time was recorded. */
  at: string | null;
  note?: string;
}

/** The artist's song row, reduced to the fields the steps are built from. */
export interface WorkflowSongInput {
  id: string;
  status: string;
  createdAt: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  publishedAt: string | null;
  hasSongBytes: boolean;
  reviewNote: string | null;
  songTitle: string | null;
}

/**
 * The decision an admin recorded, in words an artist can read.
 *
 * `submitted` is deliberately absent: a row that is only submitted carries no
 * decision, and the submission step already says everything there is to say.
 * Anything not listed here (a legacy `pending`, an unknown future status) gets
 * no review step rather than a label this table invented.
 */
const DECISION_LABELS: Record<string, string> = {
  published_for_voting: 'Song approved for voting',
  live_for_voting: 'Song approved for voting',
  approved: 'Song approved for voting',
  correction_requested: 'Correction requested',
  clean_version_requested: 'Clean version requested',
  rejected: 'Song rejected',
  disqualified: 'Song disqualified',
  finalist: 'Selected as a finalist',
  winner: 'Announced as winner',
};

function hasTimestamp(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Date.parse(value));
}

/**
 * Turn the two facts (beat downloaded, song row state) into an ordered list.
 *
 * Pure, so the ordering and the "never invents a timestamp" rule are testable
 * without a database.
 */
export function buildOpenMicWorkflowSteps(input: {
  beatDownloadedAt: string | null;
  song: WorkflowSongInput | null;
}): WorkflowStep[] {
  const steps: WorkflowStep[] = [];

  if (hasTimestamp(input.beatDownloadedAt)) {
    steps.push({
      id: 'beat-downloaded',
      kind: 'beat_downloaded',
      label: 'Beat downloaded',
      at: input.beatDownloadedAt,
    });
  }

  const song = input.song;
  // A row with no file behind it is not an upload: `recordSubmissionUploadComplete`
  // creates the row before the bytes land, and a cleared submission keeps the row.
  if (song && song.hasSongBytes) {
    if (hasTimestamp(song.createdAt)) {
      steps.push({
        id: 'song-uploaded',
        kind: 'song_uploaded',
        label: 'Song uploaded',
        at: song.createdAt,
        ...(song.songTitle ? { note: song.songTitle } : {}),
      });
    }

    if (hasTimestamp(song.submittedAt)) {
      steps.push({
        id: 'song-submitted',
        kind: 'song_submitted',
        // Open Mic hand-ins are auto-approved: `createSubmission` writes
        // submitted_at and live_at in the same statement (persistence.ts
        // `submitted_at: submission.submittedAt, live_at: submission.submittedAt`),
        // so this step and the decision step carry the identical timestamp.
        // "…for review" promised a human gate that no Open Mic edition has, and sat
        // directly above "Song approved for voting" from the same second — the
        // artist read a wait that is not coming. The button they pressed says
        // "Submit your song", so the milestone says "Song submitted".
        label: 'Song submitted',
        at: song.submittedAt,
      });
    }

    const decisionLabel = DECISION_LABELS[String(song.status || '').trim().toLowerCase()];
    if (decisionLabel) {
      const at =
        hasTimestamp(song.reviewedAt) ? song.reviewedAt : hasTimestamp(song.publishedAt) ? song.publishedAt : null;
      const note = song.reviewNote ? song.reviewNote : undefined;
      steps.push({
        id: 'song-reviewed',
        kind: 'song_reviewed',
        label: decisionLabel,
        at,
        ...(note ? { note } : {}),
      });
    }
  }

  // Oldest first; the client decides the display order. Undated steps (a real
  // decision whose timestamp column was never written) sort last rather than
  // pretending to be the newest event.
  return steps.sort((a, b) => {
    if (a.at === null && b.at === null) return 0;
    if (a.at === null) return 1;
    if (b.at === null) return -1;
    return Date.parse(a.at) - Date.parse(b.at);
  });
}

function toWorkflowSongInput(submission: OpenMicSubmission | undefined): WorkflowSongInput | null {
  if (!submission) return null;
  return {
    id: String(submission.id),
    status: String(submission.status ?? '').toLowerCase(),
    createdAt: submission.createdAt ?? null,
    submittedAt: submission.submittedAt ?? null,
    // `approvedAt` is the mapping's name for competition_entries.reviewed_at.
    reviewedAt: submission.approvedAt ?? null,
    publishedAt: submission.publishedAt ?? null,
    hasSongBytes: Boolean(submission.songObjectKey || submission.songUrl),
    reviewNote: submission.reviewNote ?? null,
    songTitle: submission.songTitle ? String(submission.songTitle) : null,
  };
}

export interface ApplicationWorkflowEdition {
  id: string;
  slug: string;
  title: string;
  description: string;
  status: string;
}

export interface ApplicationWorkflow {
  /** False for every contest that is not an Open Mic edition: no banner, no steps. */
  isOpenMic: boolean;
  edition: ApplicationWorkflowEdition | null;
  steps: WorkflowStep[];
}

/**
 * Read the workflow for one registration.
 *
 * Returns null only when the registration does not exist (the route turns that
 * into a 404). A non-Open-Mic application is `isOpenMic: false` with no steps —
 * the caller shows nothing extra rather than an empty "Open Mic progress" block.
 * Ownership is enforced by the route, not here.
 */
export async function getApplicationWorkflow(
  registrationId: string,
): Promise<ApplicationWorkflow | null> {
  if (!registrationId || typeof registrationId !== 'string') {
    throw new Error('Invalid registration id');
  }

  const draft = await getRegistrationDraft(registrationId);
  if (!draft) return null;

  const slug = String(draft.contestSlug ?? '').trim();
  // The draft stores the CATALOG slug (`open-mic-competition`) while the edition
  // the admin published has its own, so an exact lookup alone found no edition and
  // this reader answered `isOpenMic: false` for an approved Open Mic artist — no
  // beat download, no song upload, on either plane. The identity the registration
  // plane locked onto form_data is what says "this application IS Open Mic", and
  // `resolveOpenMicEdition` is the one rule that turns that into an edition.
  const form = (draft.formData ?? {}) as Record<string, unknown>;
  const locked = (key: string): string | null =>
    typeof form[key] === 'string' ? (form[key] as string) : null;
  const edition = await resolveOpenMicEdition(slug, {
    slug,
    contestType: locked('contest.type'),
    contestCategory: locked('contest.category'),
  });
  if (!edition) {
    return { isOpenMic: false, edition: null, steps: [] };
  }

  const artistUserId = String(draft.userId ?? '').trim() || null;
  const [beatDownloadedAt, submissions] = await Promise.all([
    latestBeatDownloadAt({ contestId: edition.id, userId: artistUserId }),
    // No artist account, no submission to look for — the beat step (if any)
    // still shows, and the panel explains the rest.
    artistUserId ? listSubmissions({ contestId: edition.id, userId: artistUserId }) : Promise.resolve([]),
  ]);

  return {
    isOpenMic: true,
    edition: {
      id: String(edition.id),
      slug: String(edition.slug ?? slug),
      title: String(edition.title ?? ''),
      description: String(edition.description ?? ''),
      status: String(edition.status ?? ''),
    },
    // `listSubmissions` is newest-first, so [0] is the row the artist is working
    // on right now, including a re-upload after a correction request.
    steps: buildOpenMicWorkflowSteps({
      beatDownloadedAt,
      song: toWorkflowSongInput(submissions[0]),
    }),
  };
}
