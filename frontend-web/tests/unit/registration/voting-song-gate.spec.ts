// The rule the applicant sees on their status screen: on an Open Mic edition,
// being approved and on the roster is NOT enough to be votable — until the song
// is handed in there is nothing for a voter to hear, so the vote button must be
// inactive and say why.
//
// Pure decision so the ordering is testable without a database: the caller
// collects the three facts (is this edition Open Mic, who is the artist, is
// there a playable song) and this function decides what they mean.
import { describe, expect, it } from 'vitest';
import { decideOpenMicSongGate } from '@/src/server/registration-v2/registration-voting';

describe('decideOpenMicSongGate', () => {
  it('leaves a non-Open-Mic contest alone', () => {
    // A film-academy or SME-pitch applicant has no song plane at all. Gating
    // their vote would hide a working button behind a rule that does not apply.
    expect(
      decideOpenMicSongGate({ isOpenMicEdition: false, artistUserId: 'user-1', hasPlayableSong: false }),
    ).toEqual({ blocked: false, reason: null });
  });

  it('blocks the vote while an Open Mic artist has no song yet', () => {
    expect(
      decideOpenMicSongGate({ isOpenMicEdition: true, artistUserId: 'user-1', hasPlayableSong: false }),
    ).toEqual({ blocked: true, reason: 'song_not_submitted' });
  });

  it('opens the vote as soon as a playable song exists', () => {
    expect(
      decideOpenMicSongGate({ isOpenMicEdition: true, artistUserId: 'user-1', hasPlayableSong: true }),
    ).toEqual({ blocked: false, reason: null });
  });

  it('blocks a guest roster row, which cannot have handed anything in', () => {
    // promote_registration_to_contestant can promote with user_id NULL; a song
    // is only ever uploaded by a signed-in artist, so there is nothing to find.
    expect(
      decideOpenMicSongGate({ isOpenMicEdition: true, artistUserId: null, hasPlayableSong: false }),
    ).toEqual({ blocked: true, reason: 'song_not_submitted' });
  });

  it('treats a blank artist id as no artist at all', () => {
    // The roster column is nullable and older rows carry '' rather than NULL.
    expect(
      decideOpenMicSongGate({ isOpenMicEdition: true, artistUserId: '', hasPlayableSong: false }),
    ).toEqual({ blocked: true, reason: 'song_not_submitted' });
  });
});
