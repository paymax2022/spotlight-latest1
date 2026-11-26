// CONTEST-LOCK — the applicant's own "get votes" CTA.
//
// `votable` answers a question about the VOTER: can a vote be cast for this
// contestant right now? It is false while the contest is closed, and the status
// screen used that same flag to decide whether to show the applicant anything at
// all — so an artist whose song was approved the day before voting opened saw no
// way to start working. Reaching out to contacts, posting the link, building up
// people who intend to vote: none of that has to wait for `opens_at`.
//
// So the projection carries a second, weaker answer. `shareable` means "this
// entry is on the roster with a playable song, go and get votes" and ignores the
// contest window. `votable` still decides the Vote button. A contestant who is
// off the roster, inactive, has no contest, or has no playable song is not
// shareable either — sharing those would send people to a page that cannot take
// a vote, which is exactly the defect the song gate exists to prevent.
//
// Pure decision, so the precedence is testable without a database.
import { describe, expect, it } from 'vitest';
import { decideVotingAccess } from '@/src/server/registration-v2/registration-voting';

const APPROVED = {
  applicationStatus: 'approved',
  promoted: true,
  hasContest: true,
  contestantActive: true,
  contestOpen: true,
  songBlocked: false,
};

describe('decideVotingAccess', () => {
  it('says nothing at all before the application is approved', () => {
    expect(decideVotingAccess({ ...APPROVED, applicationStatus: 'submitted' })).toEqual({
      votable: false,
      shareable: false,
      reason: 'not_approved',
    });
  });

  it('will not advertise a contestant who was never promoted to the roster', () => {
    expect(decideVotingAccess({ ...APPROVED, promoted: false })).toEqual({
      votable: false,
      shareable: false,
      reason: 'not_promoted',
    });
  });

  it('needs a contest to link to', () => {
    expect(decideVotingAccess({ ...APPROVED, hasContest: false })).toEqual({
      votable: false,
      shareable: false,
      reason: 'no_contest',
    });
  });

  it('keeps an off-roster contestant out of both the ballot and the share', () => {
    expect(decideVotingAccess({ ...APPROVED, contestantActive: false })).toEqual({
      votable: false,
      shareable: false,
      reason: 'contestant_inactive',
    });
  });

  it('opens the vote when everything is in place', () => {
    expect(decideVotingAccess(APPROVED)).toEqual({
      votable: true,
      shareable: true,
      reason: null,
    });
  });

  it('blocks a song that is not playable yet, even inside the window', () => {
    expect(decideVotingAccess({ ...APPROVED, songBlocked: true })).toEqual({
      votable: false,
      shareable: false,
      reason: 'song_not_submitted',
    });
  });

  it('still says the vote cannot be cast while the contest is closed', () => {
    const result = decideVotingAccess({ ...APPROVED, contestOpen: false });
    expect(result.votable).toBe(false);
    expect(result.reason).toBe('contest_not_open');
  });

  it('lets an approved artist campaign for votes before the window opens', () => {
    // The whole point: the CTA appears at approval, not at `opens_at`.
    expect(decideVotingAccess({ ...APPROVED, contestOpen: false })).toEqual({
      votable: false,
      shareable: true,
      reason: 'contest_not_open',
    });
  });

  it('does not share a closed contest whose song is missing', () => {
    // `contest_not_open` outranks the song reason in the message — that ordering
    // predates this change — but the song rule still decides shareability.
    const result = decideVotingAccess({ ...APPROVED, contestOpen: false, songBlocked: true });
    expect(result.shareable).toBe(false);
    expect(result.reason).toBe('contest_not_open');
  });

  it('treats every roster-approving status alike', () => {
    for (const status of ['approved', 'selected_for_public_voting', 'selected_for_bootcamp']) {
      expect(decideVotingAccess({ ...APPROVED, applicationStatus: status }).shareable).toBe(true);
    }
  });
});
