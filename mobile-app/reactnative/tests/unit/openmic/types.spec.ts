// Parsing the eligibility wire shape. The screen branches on the parsed result,
// so a parser that throws on a null or guesses a reason turns one unusual server
// answer into a blank screen. Every case here is a body the route can really
// return.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseEligibility } from '@/features/openmic/types';

const FULL = {
  success: true,
  eligibility: {
    contestId: 'c1',
    contestSlug: 'open-mic-2026',
    status: 'submission_open',
    canSubmitSong: true,
    reason: 'ok',
    source: 'promoted',
    beat: {
      id: 'b1',
      title: 'Spotlight 2026 Official Beat',
      genre: 'Afrobeats',
      durationSeconds: 155,
      producerCredit: 'Prod. by Olu',
      usageRules: 'Do not distribute the instrumental.',
      requiresPaidEntry: false,
      previewUrl: '/api/open-mic/beats/abc',
      downloadUrl: '/api/open-mic/beats/abc?download=1',
    },
    window: { open: true, reason: 'open', startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-30T23:59:59Z' },
    submission: {
      id: 's1',
      status: 'DRAFT',
      songTitle: 'My Answer',
      hasSong: true,
      songObjectKey: 'openmic/songs/s1.mp3',
      playableUrl: '/api/open-mic/songs/s1',
      submittedAt: null,
    },
  },
};

describe('parseEligibility', () => {
  it('parses a complete answer into typed fields', () => {
    const out = parseEligibility(FULL);
    assert.ok(out);
    assert.equal(out.contestSlug, 'open-mic-2026');
    assert.equal(out.canSubmitSong, true);
    assert.equal(out.reason, 'ok');
    assert.equal(out.source, 'promoted');
    assert.equal(out.beat?.durationSeconds, 155);
    assert.equal(out.beat?.previewUrl, '/api/open-mic/beats/abc');
    assert.equal(out.window.open, true);
    assert.equal(out.submission?.objectKey, 'openmic/songs/s1.mp3');
  });

  it('lowercases a status the server sent in upper case', () => {
    // The stage machine compares against `draft`, `submitted`, … and the DB
    // column has been written both ways by different planes.
    const out = parseEligibility(FULL);
    assert.equal(out?.submission?.status, 'draft');
  });

  it('reads the alternative field names the older builds used', () => {
    const out = parseEligibility({
      eligibility: {
        ...FULL.eligibility,
        beat: { ...FULL.eligibility.beat, requiresPaidEntryForDownload: true },
        submission: { id: 's1', status: 'draft', hasSong: true, objectKey: 'k' },
      },
    });
    assert.equal(out?.beat?.requiresPaidEntry, true);
    assert.equal(out?.submission?.objectKey, 'k');
  });

  it('returns null for anything that is not a verdict body', () => {
    assert.equal(parseEligibility(null), null);
    assert.equal(parseEligibility(undefined), null);
    assert.equal(parseEligibility('nope'), null);
    assert.equal(parseEligibility(42), null);
    // An envelope with no `eligibility` object is a server that answered
    // something else entirely, not a partial success.
    assert.equal(parseEligibility({ success: true, data: {} }), null);
  });

  it('accepts a bare eligibility object as well as the envelope', () => {
    const out = parseEligibility(FULL.eligibility);
    assert.equal(out?.contestId, 'c1');
  });

  it('treats a missing beat as null, and a non-object beat as null', () => {
    const out = parseEligibility({ eligibility: { ...FULL.eligibility, beat: null } });
    assert.equal(out?.beat, null);
    const bad = parseEligibility({ eligibility: { ...FULL.eligibility, beat: 'oops' } });
    assert.equal(bad?.beat, null);
  });

  it('treats a missing submission as null', () => {
    const out = parseEligibility({ eligibility: { ...FULL.eligibility, submission: null } });
    assert.equal(out?.submission, null);
  });

  it('defaults an unknown reason and window reason instead of inventing a stage', () => {
    const out = parseEligibility({
      eligibility: {
        ...FULL.eligibility,
        reason: 'admin_is_hungry',
        window: { open: false, reason: 'sometimes', startsAt: null, endsAt: null },
      },
    });
    assert.equal(out?.reason, 'no_contest');
    assert.equal(out?.window.reason, 'no_window_configured');
  });

  it('keeps blank strings blank and turns absent numbers into undefined', () => {
    const out = parseEligibility({
      eligibility: {
        ...FULL.eligibility,
        beat: { ...FULL.eligibility.beat, durationSeconds: null, title: '  ' },
      },
    });
    assert.equal(out?.beat?.durationSeconds, undefined);
    // A beat with no title still needs a label the card can render.
    assert.equal(out?.beat?.title, 'Official beat');
  });

  it('reads truthy flags in every shape the API has used', () => {
    for (const value of [true, 'true', 1]) {
      const out = parseEligibility({ eligibility: { ...FULL.eligibility, canSubmitSong: value } });
      assert.equal(out?.canSubmitSong, true, String(value));
    }
    for (const value of [false, 'false', 0, null, undefined, 'yes']) {
      const out = parseEligibility({ eligibility: { ...FULL.eligibility, canSubmitSong: value } });
      assert.equal(out?.canSubmitSong, false, String(value));
    }
  });

  it('preserves a null media URL as null rather than an empty path', () => {
    const out = parseEligibility({
      eligibility: {
        ...FULL.eligibility,
        beat: { ...FULL.eligibility.beat, previewUrl: null, downloadUrl: '  ' },
      },
    });
    assert.equal(out?.beat?.previewUrl, null);
    assert.equal(out?.beat?.downloadUrl, null);
  });
});
