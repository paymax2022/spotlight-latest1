import type { OpenMicSubmission, OpenMicSubmissionReviewInput } from '@/features/openmic/types';

/**
 * What a review decision does to a submission, in one place.
 *
 * Both Open Mic storage paths need these rules and must not disagree:
 * `store.reviewSubmission` (in-memory, used when no database is configured) and
 * `persistence.reviewSubmission` (the real one). The bug this module exists to
 * prevent is the shape `persistence` used to have — it called the in-memory
 * store as its *projector*, and that store starts with
 * `if (!current) throw new Error('Submission not found.')` against a map that is
 * deliberately empty in DB mode. So every review of a real hand-in threw: the
 * rules were fine, the way they were reached was not.
 *
 * The rules themselves are the product decision: which decision stamps which
 * time, which ones change the artist's standing, and which ones send the
 * artist a message they can act on.
 */

/** The fields the rules actually read. Everything else on the submission is carried through untouched. */
export type ReviewInputSubmission = Pick<
  OpenMicSubmission,
  'approvedAt' | 'publishedAt' | 'isFinalist' | 'isWinner' | 'songTitle'
>;

export type ReviewNotification = {
  eventKey: string;
  title: string;
  message: string;
};

export type ReviewPatch = {
  /** Columns the DB path writes, and the fields the memory path stores. */
  status: OpenMicSubmission['status'];
  reviewNote?: string;
  /** Set only by `approved`; any other decision keeps the earlier stamp. */
  approvedAt?: string;
  /** Set only by `published_for_voting`. */
  publishedAt?: string;
  isFinalist: boolean;
  isWinner: boolean;
  updatedAt: string;
};

export type ReviewProjection = {
  patch: ReviewPatch;
  /**
   * The in-app notice for the artist, or null. Approval, rejection and
   * correction are decisions about the song, so the artist hears about them;
   * `finalist`, `winner`, `disqualified` and the rest are standings moves the
   * leaderboard and the finale tabs show.
   */
  notification: ReviewNotification | null;
};

const ARTIST_FEEDBACK_FALLBACK = 'Please review admin feedback on your submission.';

export function projectReview(
  current: ReviewInputSubmission,
  review: OpenMicSubmissionReviewInput,
  nowIso: string,
): ReviewProjection {
  const note = review.note;

  let notification: ReviewNotification | null = null;
  if (review.status === 'published_for_voting') {
    notification = {
      eventKey: 'song_approved_for_voting',
      title: 'Song Approved for Voting',
      message: `Your song "${current.songTitle}" is now live for public voting.`,
    };
  }
  if (review.status === 'rejected' || review.status === 'correction_requested') {
    const rejected = review.status === 'rejected';
    notification = {
      eventKey: rejected ? 'song_rejected' : 'song_correction_requested',
      title: rejected ? 'Song Rejected' : 'Song Correction Required',
      // The note IS the product here: an artist who is told "rejected" without
      // the reason cannot fix anything, so the decision falls back to a sentence
      // that at least points at the feedback rather than sending an empty string.
      message: note && note.trim() ? note : ARTIST_FEEDBACK_FALLBACK,
    };
  }

  return {
    patch: {
      status: review.status,
      reviewNote: note,
      approvedAt: review.status === 'approved' ? nowIso : current.approvedAt,
      publishedAt: review.status === 'published_for_voting' ? nowIso : current.publishedAt,
      isFinalist: review.status === 'finalist' ? true : current.isFinalist,
      isWinner: review.status === 'winner' ? true : current.isWinner,
      updatedAt: nowIso,
    },
    notification,
  };
}

/** The whole updated submission — what the in-memory path stores. */
export function applyReview(
  current: OpenMicSubmission,
  review: OpenMicSubmissionReviewInput,
  nowIso: string,
): OpenMicSubmission {
  return { ...current, ...projectReview(current, review, nowIso).patch };
}
