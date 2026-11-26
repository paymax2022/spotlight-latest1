// Which applications are Open Mic applications — decided from the same three
// signals the server uses (`src/server/openmic/edition-identity.ts`), because a
// slug list alone silently hides a real edition.
//
// The live local edition proves the point: it is registered as `open-mic-dev`
// with `contest.type = one_beat_one_verse`, which no slug list contained, so the
// status screen treated an approved Open Mic artist as an ordinary applicant and
// showed neither the beat nor the hand-in.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isOpenMicApplication } from '@/features/openmic/edition';

describe('Open Mic application identity', () => {
  it('recognises the dev edition by the type the contest row carries', () => {
    assert.equal(
      isOpenMicApplication({
        contestSlug: 'open-mic-dev',
        formData: {
          'contest.type': 'one_beat_one_verse',
          'contest.category': 'other',
          'contest.title': 'Spotlight Open Mic (dev edition)',
        },
      }),
      true,
    );
  });

  it('recognises the catalogue edition by the category the registration plane writes', () => {
    assert.equal(
      isOpenMicApplication({
        contestSlug: 'open-mic-competition',
        formData: { 'contest.type': 'public_voting_contest', 'contest.category': 'open_mic' },
      }),
      true,
    );
  });

  it('recognises an edition whose answers were never stored, from the slug alone', () => {
    assert.equal(isOpenMicApplication({ contestSlug: 'open-mic-2026', formData: {} }), true);
    assert.equal(
      isOpenMicApplication({ contestSlug: 'spotlight-open-mic-2026-11', formData: null }),
      true,
    );
  });

  it('recognises Open Mic from the application workflow when draft metadata is incomplete', () => {
    assert.equal(
      isOpenMicApplication({
        contestSlug: 'open-mic-dev',
        formData: {},
        workflowIsOpenMic: true,
      }),
      true,
    );
  });

  it('is not case-sensitive about the stored type or category', () => {
    assert.equal(
      isOpenMicApplication({
        contestSlug: 'whatever',
        formData: { 'contest.type': 'ONE_BEAT_ONE_VERSE' },
      }),
      true,
    );
    assert.equal(
      isOpenMicApplication({ contestSlug: 'whatever', formData: { 'contest.category': ' Open_Mic ' } }),
      true,
    );
  });

  it('leaves every other contest alone', () => {
    // An SME pitch and a reality-show entry have no beat and no song hand-in;
    // claiming them would put an Open Mic panel on screens that cannot use it.
    assert.equal(
      isOpenMicApplication({
        contestSlug: 'sme-pitch-contest',
        formData: { 'contest.type': 'pitch_competition', 'contest.category': 'sme_pitch' },
      }),
      false,
    );
    assert.equal(
      isOpenMicApplication({
        contestSlug: 'reality-tv-show',
        formData: {
          'contest.type': 'housemate_reality_show',
          'contest.category': 'general_reality_show',
        },
      }),
      false,
    );
    assert.equal(isOpenMicApplication({ contestSlug: 'arena', formData: {} }), false);
    assert.equal(isOpenMicApplication({ contestSlug: '', formData: undefined }), false);
    assert.equal(isOpenMicApplication(undefined), false);
  });

  it('does not read an unrelated field that happens to mention a beat', () => {
    assert.equal(
      isOpenMicApplication({
        contestSlug: 'music-video-contest',
        formData: { 'talent.strengths': 'one beat one verse' },
      }),
      false,
    );
  });
});
