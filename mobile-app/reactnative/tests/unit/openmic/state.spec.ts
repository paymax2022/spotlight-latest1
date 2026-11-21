// The stage machine. This is the one place the phone decides what the artist
// sees, and every branch here exists because the server can honestly answer in
// that shape — approval, beat publication and the hand-in window move
// independently, so the order these are checked in is load-bearing.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  beatDurationLabel,
  canDownloadBeat,
  canPreviewBeat,
  canSubmitSong,
  describeStage,
  deriveStage,
  formatStamp,
  playableSongUrl,
  resumableObjectKey,
  type OpenMicStage,
} from '@/features/openmic/state';
import type { OpenMicBeat, OpenMicEligibility, OpenMicSubmissionSummary, OpenMicWindow } from '@/features/openmic/types';

const BEAT: OpenMicBeat = {
  id: 'b1',
  title: 'Official Beat',
  genre: 'Afrobeats',
  durationSeconds: 155,
  producerCredit: 'Prod. by Olu',
  usageRules: 'Rules.',
  requiresPaidEntry: false,
  previewUrl: '/api/open-mic/beats/abc',
  downloadUrl: '/api/open-mic/beats/abc?download=1',
};

const OPEN_WINDOW: OpenMicWindow = {
  open: true,
  reason: 'open',
  startsAt: '2026-11-01T00:00:00Z',
  endsAt: '2026-11-30T23:59:59Z',
};

const CLOSED_WINDOW: OpenMicWindow = {
  open: false,
  reason: 'after_end',
  startsAt: '2026-10-01T00:00:00Z',
  endsAt: '2026-10-31T23:59:59Z',
};

function draftSong(over: Partial<OpenMicSubmissionSummary> = {}): OpenMicSubmissionSummary {
  return {
    id: 's1',
    status: 'draft',
    songTitle: 'My Answer',
    hasSong: true,
    objectKey: 'openmic/songs/s1.mp3',
    playableUrl: '/api/open-mic/songs/s1',
    submittedAt: null,
    ...over,
  };
}

function eligibility(over: Partial<OpenMicEligibility> = {}): OpenMicEligibility {
  return {
    contestId: 'c1',
    contestSlug: 'open-mic-2026',
    status: 'submission_open',
    canSubmitSong: true,
    reason: 'ok',
    source: 'promoted',
    beat: BEAT,
    window: OPEN_WINDOW,
    submission: null,
    ...over,
  };
}

describe('deriveStage — nothing to branch on yet', () => {
  it('is loading only while a request is in flight', () => {
    assert.equal(deriveStage({ eligibility: null, loading: true }).kind, 'loading');
    assert.equal(deriveStage({ eligibility: null, loading: false }).kind, 'failed');
    assert.equal(deriveStage({ eligibility: null }).kind, 'failed');
  });

  it('names the failure so the screen can offer the right fix', () => {
    assert.equal(deriveStage({ eligibility: null, error: 'auth' }).kind, 'sign_in_required');
    assert.equal(deriveStage({ eligibility: null, error: 'not_found' }).kind, 'unavailable');
    assert.equal(deriveStage({ eligibility: null, error: 'other' }).kind, 'failed');
  });

  it('says a request outranks a spinner', () => {
    // A 401 with loading left true would trap the screen on a spinner forever.
    assert.equal(deriveStage({ eligibility: null, loading: false, error: 'auth' }).kind, 'sign_in_required');
  });

  it('treats the server own no_contest reason as unavailable', () => {
    assert.equal(deriveStage({ eligibility: eligibility({ reason: 'no_contest' }) }).kind, 'unavailable');
  });
});

describe('deriveStage — a song on record wins', () => {
  it('shows needs_submit for a draft row that already holds bytes', () => {
    const stage = deriveStage({
      eligibility: eligibility({ reason: 'not_approved', submission: draftSong() }),
    });
    assert.equal(stage.kind, 'needs_submit');
  });

  it('shows song_live for any publicly playable status', () => {
    for (const status of ['submitted', 'published_for_voting', 'finalist', 'winner', 'live_for_voting']) {
      const stage = deriveStage({ eligibility: eligibility({ submission: draftSong({ status }) }) });
      assert.equal(stage.kind, 'song_live', status);
    }
  });

  it('keeps the entry visible when the window closed after the hand-in', () => {
    // Closing a window must not erase the song an artist already submitted.
    const stage = deriveStage({
      eligibility: eligibility({ reason: 'window_closed', window: CLOSED_WINDOW, submission: draftSong({ status: 'submitted' }) }),
    });
    assert.equal(stage.kind, 'song_live');
  });

  it('survives an unpublished beat by falling back to an empty beat shape', () => {
    const stage = deriveStage({ eligibility: eligibility({ beat: null, submission: draftSong() }) });
    assert.equal(stage.kind, 'needs_submit');
    if (stage.kind === 'needs_submit') assert.equal(stage.beat.id, '');
  });
});

describe('deriveStage — no song yet', () => {
  it('separates waiting on approval from waiting on the producer', () => {
    assert.equal(deriveStage({ eligibility: eligibility({ beat: null, reason: 'not_approved' }) }).kind, 'approval_pending');
    assert.equal(deriveStage({ eligibility: eligibility({ beat: null, reason: 'beat_missing' }) }).kind, 'awaiting_beat');
    assert.equal(
      describeStage(deriveStage({ eligibility: eligibility({ beat: null, reason: 'not_approved' }) })).title,
      'Waiting on approval',
    );
  });

  it('lets an unapproved applicant preview and download, because the server does', () => {
    const stage = deriveStage({ eligibility: eligibility({ reason: 'not_approved', canSubmitSong: false }) });
    assert.equal(stage.kind, 'preview_only');
  });

  it('holds the upload when the window does not cover now', () => {
    const stage = deriveStage({ eligibility: eligibility({ reason: 'window_closed', window: CLOSED_WINDOW, canSubmitSong: false }) });
    assert.equal(stage.kind, 'window_closed');
    if (stage.kind === 'window_closed') assert.equal(stage.window.reason, 'after_end');
  });

  it('is ready_to_upload only when a beat exists, is approved and the window allows', () => {
    assert.equal(deriveStage({ eligibility: eligibility() }).kind, 'ready_to_upload');
  });

  it('has a stage for every reason the API can send', () => {
    // `beat_missing` only reaches the producer-waiting stage when there really
    // is no beat row; a reason that disagrees with the payload is resolved by the
    // payload, because that is what the screen can act on.
    const stages = [
      deriveStage({ eligibility: eligibility({ reason: 'ok' }) }),
      deriveStage({ eligibility: eligibility({ reason: 'no_contest' }) }),
      deriveStage({ eligibility: eligibility({ reason: 'beat_missing', beat: null }) }),
      deriveStage({ eligibility: eligibility({ reason: 'not_approved' }) }),
      deriveStage({ eligibility: eligibility({ reason: 'window_closed', window: CLOSED_WINDOW }) }),
    ];
    assert.deepEqual(stages.map((stage) => stage.kind), [
      'ready_to_upload',
      'unavailable',
      'awaiting_beat',
      'preview_only',
      'window_closed',
    ]);
  });

  it('follows the payload over a reason that no longer matches it', () => {
    const stage = deriveStage({ eligibility: eligibility({ reason: 'beat_missing' }) });
    assert.equal(stage.kind, 'ready_to_upload');
  });
});

describe('server capability is read, never inferred', () => {
  it('mirrors canSubmitSong exactly', () => {
    assert.equal(canSubmitSong(eligibility()), true);
    assert.equal(canSubmitSong(eligibility({ canSubmitSong: false })), false);
    assert.equal(canSubmitSong(null), false);
  });

  it('mirrors the beat URLs the route chose to publish', () => {
    assert.equal(canPreviewBeat(eligibility()), true);
    assert.equal(canDownloadBeat(eligibility()), true);
    assert.equal(canDownloadBeat(eligibility({ beat: { ...BEAT, downloadUrl: null } })), false);
    assert.equal(canPreviewBeat(eligibility({ beat: { ...BEAT, previewUrl: null } })), false);
    assert.equal(canPreviewBeat(null), false);
  });

  it('is not the same question as the stage', () => {
    // A closed window still shows the song the artist handed in: capability and
    // stage are separate on purpose.
    const stage = deriveStage({
      eligibility: eligibility({ reason: 'window_closed', window: CLOSED_WINDOW, canSubmitSong: false, submission: draftSong({ status: 'submitted' }) }),
    });
    assert.equal(canSubmitSong(eligibility({ canSubmitSong: false })), false);
    assert.equal(stage.kind, 'song_live');
  });
});

describe('resumableObjectKey', () => {
  it('returns the stored key only for a draft row', () => {
    const needsSubmit = deriveStage({ eligibility: eligibility({ submission: draftSong() }) });
    assert.equal(resumableObjectKey(needsSubmit), 'openmic/songs/s1.mp3');

    const live = deriveStage({ eligibility: eligibility({ submission: draftSong({ status: 'submitted' }) }) });
    assert.equal(resumableObjectKey(live), null);

    const ready = deriveStage({ eligibility: eligibility() });
    assert.equal(resumableObjectKey(ready), null);
  });

  it('returns null when the server says no bytes are stored', () => {
    const stage = deriveStage({
      eligibility: eligibility({ submission: draftSong({ objectKey: null }) }),
    });
    assert.equal(resumableObjectKey(stage), null);
  });
});

describe('playableSongUrl', () => {
  it('gives the artist their own root-relative reader path for a live song', () => {
    // The local build serves `/api/open-mic/songs/<id>` with no host, and the
    // screen attaches the device origin. An http-only guard here used to return
    // null on localhost, which meant no player at all.
    const stage = deriveStage({ eligibility: eligibility({ submission: draftSong({ status: 'submitted' }) }) });
    assert.equal(playableSongUrl(stage), '/api/open-mic/songs/s1');
  });

  it('refuses a draft, and refuses any stage that is not song_live', () => {
    const draft = deriveStage({ eligibility: eligibility({ submission: draftSong() }) });
    assert.equal(playableSongUrl(draft), null);
    const ready = deriveStage({ eligibility: eligibility() });
    assert.equal(playableSongUrl(ready), null);
  });

  it('refuses a status the reader would not serve', () => {
    const stage: OpenMicStage = {
      kind: 'song_live',
      beat: BEAT,
      submission: draftSong({ status: 'removed' }),
    };
    assert.equal(playableSongUrl(stage), null);
  });

  it('returns null when the submission has no address', () => {
    const stage = deriveStage({
      eligibility: eligibility({ submission: draftSong({ status: 'submitted', playableUrl: null }) }),
    });
    assert.equal(playableSongUrl(stage), null);
  });
});

describe('describeStage', () => {
  const stages: OpenMicStage[] = [
    { kind: 'loading' },
    { kind: 'sign_in_required' },
    { kind: 'failed' },
    { kind: 'unavailable' },
    { kind: 'approval_pending', beat: null },
    { kind: 'awaiting_beat' },
    { kind: 'preview_only', beat: BEAT },
    { kind: 'window_closed', beat: BEAT, window: CLOSED_WINDOW, submission: null },
    { kind: 'ready_to_upload', beat: BEAT, submission: null },
    { kind: 'needs_submit', beat: BEAT, submission: draftSong() },
    { kind: 'song_live', beat: BEAT, submission: draftSong({ status: 'submitted' }) },
  ];

  it('has copy for every stage, with a non-empty title and body', () => {
    // TypeScript makes the switch exhaustive; this catches a stage whose branch
    // was added but left returning an empty string.
    for (const stage of stages) {
      const copy = describeStage(stage);
      assert.ok(copy.title.trim().length > 0, stage.kind);
      assert.ok(copy.body.trim().length > 0, stage.kind);
    }
  });

  it('names the window date when hand-ins have not opened yet', () => {
    const copy = describeStage({
      kind: 'window_closed',
      beat: BEAT,
      window: { open: false, reason: 'before_start', startsAt: '2027-01-01T00:00:00Z', endsAt: null },
      submission: null,
    });
    assert.match(copy.body, /Hand-ins open/);
    assert.equal(copy.title, 'Hand-ins are closed');
  });

  it('tells an artist to contact the organiser once hand-ins have ended', () => {
    const copy = describeStage({ kind: 'window_closed', beat: BEAT, window: CLOSED_WINDOW, submission: null });
    assert.match(copy.body, /contact the organiser/);
  });

  it('says the organiser has not set a window, rather than blaming the artist', () => {
    const copy = describeStage({
      kind: 'window_closed',
      beat: BEAT,
      window: { open: false, reason: 'no_window_configured', startsAt: null, endsAt: null },
      submission: null,
    });
    assert.match(copy.body, /has not set a hand-in window/);
  });

  it('still calls an open window by its action, not by being closed', () => {
    const copy = describeStage({
      kind: 'window_closed',
      beat: BEAT,
      window: { open: true, reason: 'open', startsAt: null, endsAt: null },
      submission: null,
    });
    assert.equal(copy.title, 'Hand-in time');
  });
});

describe('formatStamp and beatDurationLabel', () => {
  it('renders a parseable stamp and refuses a broken one', () => {
    assert.equal(formatStamp(''), '');
    assert.equal(formatStamp(null), '');
    assert.equal(formatStamp('nonsense'), '');
    const out = formatStamp('2026-11-30T23:59:59Z');
    assert.match(out, /2026/);
  });

  it('labels a declared beat length and stays blank when undeclared', () => {
    assert.equal(beatDurationLabel(155), '2:35');
    assert.equal(beatDurationLabel(undefined), '');
    assert.equal(beatDurationLabel(0), '');
    assert.equal(beatDurationLabel(NaN), '');
  });
});
