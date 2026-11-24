// One artist, one live entry: decide what a hand-in does to the artist's OWN
// earlier rows, and what it must never touch.
//
// WHY THIS EXISTS
// `presign` mints a fresh `submissionId` for every attempt and `complete` books a
// `draft` row under it, so a second hand-in — a better verse, a re-record after
// `correction_requested`, the same artist replacing their song — arrives as a NEW
// row id. The duplicate scan in `createSubmission` (and its twin in `store.ts`)
// compared only `row.id === submissionId` against the identity fields, so the
// artist's own already-live entry matched by e-mail and the hand-in was refused
// with `duplicateApplication` — a 400 that no artist can act on and no admin can
// clear. Worse, the abandoned `draft` row from that failed attempt is the NEWEST
// row, so `/me/eligibility` started pointing the artist's own screen at it: the
// page regressed from "Your song is live" to "Uploaded — one step left", and
// pressing submit hit the same wall again.
//
// THE RULE
// Identity match is necessary but not sufficient — ownership decides the action:
//   • a row belonging to a DIFFERENT account is a real collision and is refused,
//     exactly as before. Replacing someone else's entry from a hand-in form would
//     be an account takeover, so this branch stays loud.
//   • a row that is provably the SAME artist is superseded: the new hand-in
//     publishes and the old row leaves the active set.
//   • a row with no `user_id` (it predates the column) is only ever treated as
//     the artist's own when the E-MAIL matches, never on a stage name alone —
//     the same precedence `createSubmission` already uses for approvals.
//
// Pure and shared by both planes (`persistence.ts` for Postgres, `store.ts` for
// the in-memory fallback) because two copies of this rule is how the first copy
// got it wrong: localhost ran the DB plane while CI and memory mode ran the other.
import type { OpenMicEntryStatus } from '@/src/features/openmic/types';

/** Statuses that no longer occupy the artist's one entry slot. */
const INACTIVE_STATUSES: readonly string[] = ['rejected', 'disqualified'];

export interface ReplacementRow {
  id: string;
  /** `competition_entries.user_id` — empty/absent for a row that predates it. */
  userId?: string | null;
  status?: string | null;
  email?: string | null;
  stageName?: string | null;
}

export interface ReplacementPlan {
  /** True when a matching row belongs to another account: refuse the hand-in. */
  conflict: boolean;
  /** The artist's own earlier rows this hand-in replaces, oldest of the set first. */
  supersede: string[];
}

function key(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function planSubmissionReplacement(input: {
  /** The row this hand-in writes; it is never a duplicate of itself. */
  submissionId: string;
  /** The signed-in account, from the bearer token. */
  artistUserId?: string | null;
  email?: string | null;
  stageName?: string | null;
  rows: ReplacementRow[];
}): ReplacementPlan {
  const artistUserId = String(input.artistUserId ?? '').trim();
  const emailKey = key(input.email);
  const stageNameKey = key(input.stageName);
  const conflict: string[] = [];
  const supersede: string[] = [];

  for (const row of input.rows) {
    if (!row || String(row.id) === input.submissionId) continue;
    if (INACTIVE_STATUSES.includes(key(row.status))) continue;
    const rowEmail = key(row.email);
    const rowStage = key(row.stageName);
    const sameEmail = emailKey.length > 0 && rowEmail === emailKey;
    const sameStage = stageNameKey.length > 0 && rowStage === stageNameKey;
    if (!sameEmail && !sameStage) continue;

    const rowUserId = String(row.userId ?? '').trim();
    const mine = rowUserId ? rowUserId === artistUserId : sameEmail;
    if (mine) supersede.push(String(row.id));
    else conflict.push(String(row.id));
  }

  // Safety first: one row this form cannot prove is ours stops the whole hand-in,
  // even when other rows are ours to replace.
  return { conflict: conflict.length > 0, supersede: conflict.length > 0 ? [] : supersede };
}

/**
 * The status a superseded row is filed under, and why it is that value.
 *
 * `draft` — the artist's own song, no longer handed in. It is the only status in
 * `OpenMicEntryStatus` that reads that way without judging the artist: `rejected`
 * and `disqualified` are decisions the applicant did not make, and a new word
 * here would have to be taught to the leaderboard, the review console, the Go
 * attention counters and every reader that keys off this column.
 */
export const SUPERSEDED_STATUS: OpenMicEntryStatus = 'draft';
