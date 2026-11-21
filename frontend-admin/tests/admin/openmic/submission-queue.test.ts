// The Submissions tab used to render every hand-in in whatever order the API
// returned them, with songs nobody had looked at yet interleaved with the ones
// already published or rejected, and no way to narrow the list. These cases pin
// the queue rules the panel renders by — what counts as decided, the order, the
// scopes and the search — as pure functions, so a change to the review screen
// cannot silently reorder an operator's backlog.
import { describe, expect, it } from 'vitest';
import {
  QUEUE_SCOPES,
  QUEUE_SCOPE_LABELS,
  isAwaitingDecision,
  isPublished,
  matchesQuery,
  orderQueue,
  queueCounts,
} from '@/features/openmic/submission-queue';
import type { OpenMicSubmissionRow } from '@/services/openMicAdminService';

function row(overrides: Partial<OpenMicSubmissionRow> = {}): OpenMicSubmissionRow {
  return {
    id: 'sub-1',
    stageName: 'Laga Laga',
    songTitle: 'One Shot',
    status: 'submitted',
    voteCount: 0,
    isFinalist: false,
    isWinner: false,
    submittedAt: '2026-11-18T09:00:00.000Z',
    ...overrides,
  } as OpenMicSubmissionRow;
}

function ids(rows: OpenMicSubmissionRow[]): string[] {
  return rows.map((r) => r.id);
}

describe('Open Mic submission queue rules', () => {
  it('treats an approved hand-in as still awaiting a decision', () => {
    // `approved` accepts the file and shows it to nobody, so it is not a
    // finished review: an operator who filtered it out would never publish it.
    expect(isAwaitingDecision('submitted')).toBe(true);
    expect(isAwaitingDecision('approved')).toBe(true);
    expect(isAwaitingDecision('correction_requested')).toBe(true);
    expect(isAwaitingDecision('published_for_voting')).toBe(false);
    expect(isAwaitingDecision('rejected')).toBe(false);
    expect(isAwaitingDecision('disqualified')).toBe(false);
    expect(isAwaitingDecision('winner')).toBe(false);
  });

  it('counts only the published songs as published, not the finalists or winners', () => {
    // `finalist` and `winner` move a standing without touching playback, so
    // counting them here would overstate what voters can hear.
    expect(isPublished('published_for_voting')).toBe(true);
    expect(isPublished('finalist')).toBe(false);
    expect(isPublished('winner')).toBe(false);
    expect(isPublished('approved')).toBe(false);
  });

  it('reports the three numbers the toolbar shows', () => {
    const rows = [
      row({ id: 'a', status: 'submitted' }),
      row({ id: 'b', status: 'approved' }),
      row({ id: 'c', status: 'published_for_voting' }),
      row({ id: 'd', status: 'rejected' }),
    ];
    expect(queueCounts(rows)).toEqual({ total: 4, awaiting: 2, published: 1 });
    expect(queueCounts([])).toEqual({ total: 0, awaiting: 0, published: 0 });
  });

  it('puts the songs that still need a decision first, newest hand-in first', () => {
    const decided = row({ id: 'p', status: 'published_for_voting', submittedAt: '2026-11-20T09:00:00.000Z' });
    const newer = row({ id: 'n', status: 'submitted', submittedAt: '2026-11-19T09:00:00.000Z' });
    const older = row({ id: 'o', status: 'submitted', submittedAt: '2026-11-17T09:00:00.000Z' });
    expect(ids(orderQueue([decided, older, newer], { scope: 'all', query: '' }))).toEqual(['n', 'o', 'p']);
  });

  it('sorts a hand-in with no timestamp last inside its own group', () => {
    const undated = row({ id: 'u', status: 'submitted', submittedAt: undefined });
    const dated = row({ id: 'd', status: 'submitted', submittedAt: '2026-11-01T09:00:00.000Z' });
    expect(ids(orderQueue([undated, dated], { scope: 'all', query: '' }))).toEqual(['d', 'u']);
  });

  it('hides every decided song in the awaiting scope and shows only those in the decided scope', () => {
    const rows = [
      row({ id: 'a', status: 'submitted' }),
      row({ id: 'b', status: 'published_for_voting' }),
      row({ id: 'c', status: 'disqualified' }),
      row({ id: 'd', status: 'approved' }),
    ];
    expect(ids(orderQueue(rows, { scope: 'awaiting', query: '' }))).toEqual(['a', 'd']);
    expect(ids(orderQueue(rows, { scope: 'decided', query: '' }))).toEqual(['b', 'c']);
    expect(ids(orderQueue(rows, { scope: 'all', query: '' }))).toEqual(['a', 'd', 'b', 'c']);
  });

  it('narrows on the artist or the song name, case-insensitively and trimmed', () => {
    expect(matchesQuery(row({ stageName: 'Tunde' }), '  TUNDE ')).toBe(true);
    expect(matchesQuery(row({ songTitle: 'Night Run' }), 'night')).toBe(true);
    expect(matchesQuery(row({ stageName: 'Laga Laga' }), 'zzz')).toBe(false);
    expect(matchesQuery(row(), '   ')).toBe(true);
    expect(matchesQuery(row(), '')).toBe(true);
  });

  it('applies the search on top of the scope', () => {
    const rows = [
      row({ id: 'a', stageName: 'Tunde', status: 'submitted' }),
      row({ id: 'b', stageName: 'Tunde', status: 'rejected' }),
      row({ id: 'c', stageName: 'Bisi', status: 'submitted' }),
    ];
    expect(ids(orderQueue(rows, { scope: 'awaiting', query: 'tunde' }))).toEqual(['a']);
    expect(ids(orderQueue(rows, { scope: 'all', query: 'tunde' }))).toEqual(['a', 'b']);
    expect(orderQueue(rows, { scope: 'awaiting', query: 'zzz' })).toEqual([]);
  });

  it('gives every scope a label an operator can read', () => {
    expect(QUEUE_SCOPES).toEqual(['awaiting', 'decided', 'all']);
    for (const scope of QUEUE_SCOPES) {
      expect(QUEUE_SCOPE_LABELS[scope].length).toBeGreaterThan(3);
    }
  });
});
