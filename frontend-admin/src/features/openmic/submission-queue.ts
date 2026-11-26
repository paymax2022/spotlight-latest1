/**
 * Which hand-ins still need an operator, and the order to work through them.
 *
 * Pure on purpose. The Submissions tab used to render rows in whatever order
 * the API returned them, so a backlog of forty songs put the ones nobody had
 * looked at next to the ones published a week ago, with nothing to narrow the
 * list. A queue that quietly reorders itself is the kind of defect nobody can
 * point at, so the rules live here where a unit test can hold them still and
 * the panel is only a renderer.
 */
import type { OpenMicSubmissionRow } from '@/services/openMicAdminService';

/**
 * The statuses that end a review.
 *
 * `approved` is deliberately NOT one of them: it accepts the file and shows it
 * to nobody, so a song sitting on `approved` is still an open task. Treating it
 * as decided is how a track gets accepted and never reaches the voters.
 */
const DECIDED_STATUSES: readonly string[] = ['published_for_voting', 'rejected', 'disqualified', 'winner'];

export function isAwaitingDecision(status: string): boolean {
  return !DECIDED_STATUSES.includes(status);
}

/**
 * Has an artist already handed in a newer take over this row?
 *
 * When a contestant re-uploads, the server publishes the new entry and retires
 * the one it replaces to `draft`, stamping `replacedByEntryId` on the retired row
 * (`submission-replacement.ts`). `draft` is not a decided status, so without this
 * the queue would grow a phantom "Awaiting a decision" task for every retry and
 * the "next row needing work" focus would land the operator on a song that no
 * longer stands. Only a non-blank value counts: a never-replaced draft keeps its
 * real open task.
 */
export function isSuperseded(row: Pick<OpenMicSubmissionRow, 'replacedByEntryId'>): boolean {
  return typeof row.replacedByEntryId === 'string' && row.replacedByEntryId.trim() !== '';
}

/**
 * The single question the queue is built on: does an operator still owe this row
 * a decision? A closed status closes it, and so does a take the artist replaced.
 */
export function needsOperator(row: OpenMicSubmissionRow): boolean {
  if (!isAwaitingDecision(row.status)) return false;
  return !isSuperseded(row);
}

/**
 * Can voters hear it? `finalist` and `winner` move a standing without touching
 * playback, so counting either here would overstate what is on the leaderboard.
 */
export function isPublished(status: string): boolean {
  return status === 'published_for_voting';
}

export const QUEUE_SCOPES = ['awaiting', 'decided', 'all'] as const;

export type QueueScope = (typeof QUEUE_SCOPES)[number];

export const QUEUE_SCOPE_LABELS: Record<QueueScope, string> = {
  awaiting: 'Awaiting a decision',
  decided: 'Already decided',
  all: 'Everything',
};

/**
 * Does a row belong in this scope? The two named scopes stay a partition of the
 * list — every row is in exactly one of `awaiting` or `decided` — so a replaced
 * take shows up under "Already decided" rather than disappearing from both.
 */
export function scopeMatches(row: OpenMicSubmissionRow, scope: QueueScope): boolean {
  if (scope === 'all') return true;
  const awaiting = needsOperator(row);
  return scope === 'awaiting' ? awaiting : !awaiting;
}

/** The three numbers the toolbar reports, over the whole list rather than the filtered one. */
export function queueCounts(rows: OpenMicSubmissionRow[]): { total: number; awaiting: number; published: number } {
  return {
    total: rows.length,
    awaiting: rows.filter((row) => needsOperator(row)).length,
    published: rows.filter((row) => isPublished(row.status)).length,
  };
}

export function matchesQuery(row: OpenMicSubmissionRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [row.stageName, row.songTitle, row.genre]
    .some((value) => (value ?? '').toLowerCase().includes(needle));
}

/** Newest hand-in first; a row with no usable timestamp sorts last in its group. */
function handInTime(row: OpenMicSubmissionRow): number {
  if (!row.submittedAt) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(row.submittedAt);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * The queue the panel renders: filtered by scope and search, then undecided
 * rows first and newest hand-in first inside each group. `filter` returns a
 * fresh array, so sorting it never reorders the caller's list.
 */
export function orderQueue(
  rows: OpenMicSubmissionRow[],
  options: { scope: QueueScope; query: string },
): OpenMicSubmissionRow[] {
  return rows
    .filter((row) => scopeMatches(row, options.scope) && matchesQuery(row, options.query))
    .sort((a, b) => {
      const group = Number(needsOperator(b)) - Number(needsOperator(a));
      if (group !== 0) return group;
      return handInTime(b) - handInTime(a);
    });
}
