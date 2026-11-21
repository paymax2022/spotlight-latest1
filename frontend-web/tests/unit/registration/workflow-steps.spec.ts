// The status screen's "Status history" list used to stop at the review verdict,
// so an approved Open Mic artist saw "Approved" and nothing else — not that the
// beat was published for them, not that they had downloaded it, not that their
// song landed on the server, not that it was handed in.
//
// These steps are read from the rows that already exist (`beat_download_logs`
// and the edition's entry), never written by the UI, so a step appears only when
// its timestamp is real. This module turns those facts into the ordered list.
import { describe, expect, it } from 'vitest';
import {
  buildOpenMicWorkflowSteps,
  type WorkflowSongInput,
} from '@/src/server/registration-v2/workflow-steps';

const BEAT_AT = '2026-11-20T20:05:00.000Z';
const UPLOADED_AT = '2026-11-20T20:10:00.000Z';
const SUBMITTED_AT = '2026-11-20T20:12:00.000Z';
const REVIEWED_AT = '2026-11-20T20:20:00.000Z';

function song(overrides: Partial<WorkflowSongInput> = {}): WorkflowSongInput {
  return {
    id: 'entry-1',
    status: 'published_for_voting',
    createdAt: UPLOADED_AT,
    submittedAt: SUBMITTED_AT,
    reviewedAt: REVIEWED_AT,
    publishedAt: null,
    hasSongBytes: true,
    reviewNote: null,
    songTitle: 'Street Light',
    ...overrides,
  };
}

describe('buildOpenMicWorkflowSteps', () => {
  it('returns nothing when the artist has done nothing yet', () => {
    expect(buildOpenMicWorkflowSteps({ beatDownloadedAt: null, song: null })).toEqual([]);
  });

  it('lists the beat download on its own', () => {
    expect(buildOpenMicWorkflowSteps({ beatDownloadedAt: BEAT_AT, song: null })).toEqual([
      { id: 'beat-downloaded', kind: 'beat_downloaded', label: 'Beat downloaded', at: BEAT_AT },
    ]);
  });

  it('names the upload without claiming a submission that has not happened', () => {
    // The `draft` state is exactly the bug this page used to hide: bytes stored,
    // voters hearing nothing, artist believing they were in.
    const steps = buildOpenMicWorkflowSteps({
      beatDownloadedAt: BEAT_AT,
      song: song({ status: 'draft', submittedAt: null, reviewedAt: null }),
    });
    expect(steps.map((step) => step.kind)).toEqual(['beat_downloaded', 'song_uploaded']);
    expect(steps[1]).toEqual({
      id: 'song-uploaded',
      kind: 'song_uploaded',
      label: 'Song uploaded',
      note: 'Street Light',
      at: UPLOADED_AT,
    });
  });

  it('orders upload then submission then the review decision', () => {
    const steps = buildOpenMicWorkflowSteps({ beatDownloadedAt: BEAT_AT, song: song() });
    expect(steps.map((step) => step.kind)).toEqual([
      'beat_downloaded',
      'song_uploaded',
      'song_submitted',
      'song_reviewed',
    ]);
    expect(steps.map((step) => step.at)).toEqual([BEAT_AT, UPLOADED_AT, SUBMITTED_AT, REVIEWED_AT]);
  });

  it('puts the steps in time order even when the beat came last', () => {
    const steps = buildOpenMicWorkflowSteps({
      beatDownloadedAt: '2026-11-21T09:00:00.000Z',
      song: song(),
    });
    expect(steps.at(-1)?.kind).toBe('beat_downloaded');
  });

  it('labels the review step with the decision the admin actually recorded', () => {
    const cases: Array<[string, string]> = [
      ['published_for_voting', 'Song approved for voting'],
      ['live_for_voting', 'Song approved for voting'],
      ['approved', 'Song approved for voting'],
      ['submitted', 'Song submitted for review'],
      ['correction_requested', 'Correction requested'],
      ['clean_version_requested', 'Clean version requested'],
      ['rejected', 'Song rejected'],
      ['disqualified', 'Song disqualified'],
      ['finalist', 'Selected as a finalist'],
      ['winner', 'Announced as winner'],
    ];
    for (const [status, label] of cases) {
      const steps = buildOpenMicWorkflowSteps({
        beatDownloadedAt: null,
        song: song({ status, submittedAt: SUBMITTED_AT, reviewedAt: null }),
      });
      const kinds = steps.map((step) => step.kind);
      if (status === 'submitted') {
        // A submitted row has no decision on it; the submission step says it all.
        expect(kinds).toEqual(['song_uploaded', 'song_submitted']);
      } else {
        expect(kinds).toContain('song_reviewed');
        expect(steps.find((step) => step.kind === 'song_reviewed')?.label).toBe(label);
      }
    }
  });

  it('carries the reviewer note when there is one', () => {
    const steps = buildOpenMicWorkflowSteps({
      beatDownloadedAt: null,
      song: song({ status: 'correction_requested', reviewNote: 'Re-record the second verse.' }),
    });
    expect(steps.find((step) => step.kind === 'song_reviewed')).toMatchObject({
      label: 'Correction requested',
      note: 'Re-record the second verse.',
    });
  });

  it('skips a row with no bytes behind it', () => {
    expect(
      buildOpenMicWorkflowSteps({ beatDownloadedAt: null, song: song({ hasSongBytes: false }) }),
    ).toEqual([]);
  });

  it('never invents a timestamp it was not given', () => {
    // Legacy fixture rows are `published_for_voting` with submitted_at NULL, so
    // they get the upload step and the decision step, and no fake submission.
    const steps = buildOpenMicWorkflowSteps({
      beatDownloadedAt: null,
      song: song({ submittedAt: null }),
    });
    expect(steps.map((step) => step.kind)).toEqual(['song_uploaded', 'song_reviewed']);
  });

  it('uses the review moment, falling back to the publish moment', () => {
    const withReview = buildOpenMicWorkflowSteps({
      beatDownloadedAt: null,
      song: song({ publishedAt: '2026-11-21T00:00:00.000Z' }),
    });
    expect(withReview.find((step) => step.kind === 'song_reviewed')?.at).toBe(REVIEWED_AT);

    const publishOnly = buildOpenMicWorkflowSteps({
      beatDownloadedAt: null,
      song: song({ reviewedAt: null, publishedAt: '2026-11-21T00:00:00.000Z' }),
    });
    expect(publishOnly.find((step) => step.kind === 'song_reviewed')?.at).toBe(
      '2026-11-21T00:00:00.000Z',
    );
  });
});
