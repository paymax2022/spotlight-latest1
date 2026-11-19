/**
 * The review decisions an operator can apply to a handed-in song, with the
 * wording this console shows for each.
 *
 * MIRROR, not import: `@/*` resolves inside frontend-admin only, so this app
 * cannot import `OPEN_MIC_REVIEW_STATUSES` from
 * `frontend-web/src/features/openmic/constants.ts`. The list of *wire* values
 * is the contract with `POST /api/admin/open-mic/submissions/:id/review`, which
 * rejects anything not in that list with 400 `Unknown review decision`, so a
 * drift here shows up as a console option the server refuses. The label text is
 * this app's own — only the string values have to match.
 *
 * `satisfies` pins the shape the same way the web side does: a value here that
 * is not one of the recognised decisions fails the type-check instead of
 * shipping a dropdown the server then refuses.
 */
export const OPEN_MIC_REVIEW_DECISIONS = [
  'approved',
  'published_for_voting',
  'correction_requested',
  'clean_version_requested',
  'rejected',
  'disqualified',
  'finalist',
  'winner',
] as const satisfies readonly string[];

export type OpenMicReviewDecision = (typeof OPEN_MIC_REVIEW_DECISIONS)[number];

export const OPEN_MIC_REVIEW_DECISION_LABELS: Record<OpenMicReviewDecision, string> = {
  approved: 'Approve the hand-in',
  published_for_voting: 'Publish for voting',
  correction_requested: 'Ask for a correction',
  clean_version_requested: 'Ask for a clean version',
  rejected: 'Reject',
  disqualified: 'Disqualify',
  finalist: 'Mark as finalist',
  winner: 'Mark as winner',
};

/**
 * What each decision does to the record, in the operator's terms. Two of these
 * are the ones people get wrong: `approved` alone does not put a song in front
 * of voters — `published_for_voting` does — and `finalist`/`winner` move a
 * standing without touching either timestamp.
 */
export const OPEN_MIC_REVIEW_DECISION_HINTS: Record<OpenMicReviewDecision, string> = {
  approved: 'The artist may now upload and you may review again. Voters still cannot play it.',
  published_for_voting: 'The song plays on the artist profile and counts in the leaderboard.',
  correction_requested: 'Sends the artist your note and asks for a new upload.',
  clean_version_requested: 'Sends the artist your note. Radio and finale playback need a clean version.',
  rejected: 'Sends the artist your note as the reason.',
  disqualified: 'Removes the song from playback and voting. The artist is not notified.',
  finalist: 'Adds the artist to the finale lineup. Does not change the playback state.',
  winner: 'Announces the win. Does not change the playback state.',
};

/**
 * The decisions whose note reaches the artist as an in-app notice, mirroring
 * `projectReview` in `frontend-web/src/server/openmic/review-rules.ts` — the
 * other five write the same note into the moderation log and notify nobody.
 * A note left on one of those five is not lost, it just is not sent, which is
 * worth saying next to the field.
 */
const ARTIST_NOTICE_DECISIONS: readonly string[] = ['published_for_voting', 'rejected', 'correction_requested'];

export function decisionCarriesArtistNotice(decision: string): boolean {
  return ARTIST_NOTICE_DECISIONS.includes(decision);
}

/**
 * Is `value` a decision the server accepts? Guard for a select whose state can
 * arrive from anywhere (a restored row, a stale tab): the route 400s on an
 * unknown value, and the console should say so before the request rather than
 * surface a server sentence.
 */
export function isOpenMicReviewDecision(value: string): value is OpenMicReviewDecision {
  return (OPEN_MIC_REVIEW_DECISIONS as readonly string[]).includes(value);
}
