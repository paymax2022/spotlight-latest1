// The "Status history" list on the application status screen.
//
// It used to be exactly the review log: draft, submitted, approved — and then
// silence, even though an Open Mic artist's real workflow continues past
// approval (download the beat, upload the song, hand it in, get the decision).
// This merges the two sources into one newest-first list without inventing a
// row for a step that has no timestamp.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeStatusTimeline } from '@/features/registration/utils/timeline';
import type { RegistrationStatusEvent } from '@/features/registration/types/registration.types';
import type { WorkflowStep } from '@/features/registration/types/registration.types';

function statusEvent(
  id: string,
  newStatus: RegistrationStatusEvent['newStatus'],
  createdAt: string,
  note?: string,
): RegistrationStatusEvent {
  return {
    id,
    applicationId: 'app-1',
    oldStatus: 'draft',
    newStatus,
    note,
    createdAt,
    actorRole: 'public_user',
  };
}

function step(
  id: string,
  label: string,
  at: string | null,
  note?: string,
  kind: WorkflowStep['kind'] = 'song_uploaded',
): WorkflowStep {
  return { id, kind, label, at, note };
}

describe('mergeStatusTimeline', () => {
  it('returns nothing when neither source has happened', () => {
    assert.deepEqual(mergeStatusTimeline([], []), []);
    assert.deepEqual(mergeStatusTimeline(undefined, undefined), []);
  });

  it('labels status events the way the chip does and puts the newest first', () => {
    const merged = mergeStatusTimeline(
      [
        statusEvent('e1', 'draft', '2026-11-20T19:56:00.000Z', 'Application draft created'),
        statusEvent('e2', 'submitted', '2026-11-20T20:00:00.000Z', 'Application submitted successfully'),
        statusEvent('e3', 'approved', '2026-11-20T20:01:00.000Z', 'Admin review action'),
      ],
      [],
    );
    assert.deepEqual(
      merged.map((entry) => entry.title),
      ['Approved', 'Submitted', 'Draft'],
    );
    assert.deepEqual(
      merged.map((entry) => entry.key),
      ['status-e3', 'status-e2', 'status-e1'],
    );
    assert.equal(merged[0].note, 'Admin review action');
    assert.equal(merged[0].source, 'status');
  });

  it('keeps an Open Mic step under the label the server chose', () => {
    const merged = mergeStatusTimeline([], [step('beat-downloaded', 'Beat downloaded', '2026-11-20T20:05:00.000Z')]);
    assert.deepEqual(merged, [
      {
        key: 'open-mic-beat-downloaded',
        title: 'Beat downloaded',
        at: '2026-11-20T20:05:00.000Z',
        source: 'open_mic',
      },
    ]);
  });

  it('interleaves the two sources by time', () => {
    const merged = mergeStatusTimeline(
      [
        statusEvent('e1', 'submitted', '2026-11-20T20:00:00.000Z'),
        statusEvent('e2', 'approved', '2026-11-20T20:01:00.000Z'),
      ],
      [
        step('beat-downloaded', 'Beat downloaded', '2026-11-20T20:05:00.000Z'),
        step('song-uploaded', 'Song uploaded', '2026-11-20T20:10:00.000Z', 'Street Light'),
        step('song-submitted', 'Song submitted for review', '2026-11-20T20:12:00.000Z'),
      ],
    );
    assert.deepEqual(
      merged.map((entry) => entry.title),
      [
        'Song submitted for review',
        'Song uploaded',
        'Beat downloaded',
        'Approved',
        'Submitted',
      ],
    );
    assert.equal(merged[1].note, 'Street Light');
  });

  it('shows the review verdict before a step recorded in the same second', () => {
    const merged = mergeStatusTimeline(
      [statusEvent('e9', 'approved', '2026-11-20T20:05:00.000Z')],
      [step('beat-downloaded', 'Beat downloaded', '2026-11-20T20:05:00.000Z')],
    );
    assert.deepEqual(
      merged.map((entry) => entry.source),
      ['status', 'open_mic'],
    );
  });

  it('drops an entry with no usable timestamp rather than printing Invalid Date', () => {
    const merged = mergeStatusTimeline(
      [statusEvent('e1', 'approved', '')],
      [step('song-uploaded', 'Song uploaded', 'not-a-date'), step('song-submitted', 'Song submitted for review', '2026-11-20T20:12:00.000Z')],
    );
    assert.equal(merged.length, 1);
    assert.equal(merged[0].title, 'Song submitted for review');
  });

  it('omits a note rather than rendering an empty line', () => {
    const merged = mergeStatusTimeline([statusEvent('e1', 'submitted', '2026-11-20T20:00:00.000Z')], []);
    assert.equal('note' in merged[0], false);
  });

  it('keeps a decision the server recorded without a timestamp, undated and on top', () => {
    // `song-reviewed` is built from `reviewed_at ?? live_at`, and a row promoted
    // straight to voting can carry the verdict with neither column set. The
    // applicant still needs to see the verdict — the screen just prints no date.
    const merged = mergeStatusTimeline(
      [statusEvent('e1', 'approved', '2026-11-20T20:01:00.000Z')],
      [step('song-reviewed', 'Song approved for voting', null, 'Nice verse')],
    );
    assert.deepEqual(
      merged.map((entry) => [entry.key, entry.at]),
      [['open-mic-song-reviewed', null], ['status-e1', '2026-11-20T20:01:00.000Z']],
    );
    assert.equal(merged[0].note, 'Nice verse');
  });
});
