// The applicant's side of the approval line, as one decision both screens read.
//
// Two things were missing once an admin approved a song for voting:
//
// 1. Nothing told the contestant their answers had become binding. The wizard
//    was unreachable, so the form simply stopped being there — which reads as a
//    bug to the person whose entry a judge is now standing on. The status screen
//    has to say it.
// 2. The "reach out for votes" card waited for the CONTEST to open rather than
//    for the ARTIST to be approved, so the days between approval and `opens_at`
//    — the only time canvassing actually helps — showed nothing at all.
//
// The lock list lives here rather than in the components because the same three
// statuses decide four things: whether the edit affordance shows, what the
// binding notice says, and (mirrored server-side in
// `frontend-web/src/features/registration/lock.ts` and
// `backend/internal/handlers/registration_store.go`) whether a write is refused.
// `more_information_requested` is deliberately NOT binding — that status is the
// admin asking the contestant to change something.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BINDING_APPLICATION_STATUSES,
  isSubmissionBinding,
  submissionBindingNotice,
} from '@/features/registration/utils/submission-lock';
import { votingCta } from '@/features/registration/utils/voting-cta';
import type { RegistrationVoting } from '@/features/registration/types/registration.types';

function voting(overrides: Partial<RegistrationVoting> = {}): RegistrationVoting {
  return {
    votable: true,
    shareable: true,
    reason: null,
    applicationStatus: 'approved',
    contest: {
      id: 'contest-1',
      slug: 'open-mic-competition',
      title: 'Open Mic',
      description: null,
      status: 'open',
      freeVotesPerUser: 3,
      paidVoteKobo: 10000,
      bannerImageUrl: null,
      rulesText: null,
      opensAt: null,
      closesAt: null,
    },
    contestant: {
      id: 'roster-1',
      name: 'Ada',
      stageName: 'AdaLive',
      photoUrl: null,
      category: null,
      state: null,
      totalVotes: 0,
      ranking: null,
      isActive: true,
      isVerified: false,
      status: null,
    },
    sharePath: '/voting/contestant-profile?contestantId=roster-1&contestId=contest-1',
    shareText: 'Vote for AdaLive in Open Mic on Spotlight! 🎤',
    ...overrides,
  };
}

describe('isSubmissionBinding', () => {
  it('locks exactly the statuses the roster approves onto', () => {
    assert.deepEqual([...BINDING_APPLICATION_STATUSES].sort(), [
      'approved',
      'selected_for_bootcamp',
      'selected_for_public_voting',
    ]);
  });

  it('binds the three approved statuses', () => {
    // The list is spelled out here rather than read off the constant, so an
    // empty constant cannot make this pass by asserting nothing.
    for (const status of ['approved', 'selected_for_public_voting', 'selected_for_bootcamp'] as const) {
      assert.equal(isSubmissionBinding(status), true, `${status} should be binding`);
    }
  });

  it('leaves a draft and a request-for-information editable', () => {
    assert.equal(isSubmissionBinding('draft'), false);
    assert.equal(isSubmissionBinding('more_information_requested'), false);
  });

  it('leaves the states a contestant still has to act on unlocked', () => {
    // Rejected, withdrawn and disqualified entries are not "approved data"; the
    // applicant may still need to do something with them, and this change must
    // not quietly take that away.
    for (const status of ['rejected', 'withdrawn', 'disqualified', 'eliminated', 'winner'] as const) {
      assert.equal(isSubmissionBinding(status), false, `${status} should not be binding`);
    }
  });

  it('explains itself only when the submission is binding', () => {
    const notice = submissionBindingNotice('approved');
    assert.match(notice ?? '', /binding/i);
    assert.equal(submissionBindingNotice('draft'), null);
  });
});

describe('votingCta', () => {
  it('offers voting and sharing while the contest is open', () => {
    const cta = votingCta(voting());
    assert.equal(cta.showVoteButton, true);
    assert.equal(cta.showShareButton, true);
    assert.equal(cta.caption, null);
  });

  it('offers sharing before the window opens, without the vote button', () => {
    // The reason stays `contest_not_open`: a vote still cannot be cast. Only the
    // canvassing CTA moves earlier, which is what the artist can act on today.
    const cta = votingCta(
      voting({ votable: false, shareable: true, reason: 'contest_not_open' }),
    );
    assert.equal(cta.showVoteButton, false);
    assert.equal(cta.showShareButton, true);
  });

  it('names the opening date when the contest publishes one', () => {
    const cta = votingCta(
      voting({
        votable: false,
        shareable: true,
        reason: 'contest_not_open',
        contest: { ...voting().contest!, status: 'draft', opensAt: '2026-12-05T09:00:00Z' },
      }),
    );
    assert.equal(cta.caption, 'Voting opens 5 December 2026');
  });

  it('still campaigns without a published date rather than showing nothing', () => {
    const cta = votingCta(
      voting({ votable: false, shareable: true, reason: 'contest_not_open' }),
    );
    assert.equal(cta.caption, 'Voting opens soon');
  });

  it('ignores a campaign flag that has no link behind it', () => {
    // shareable without sharePath would mean a button that shares nothing; the
    // server builds both together, so this is the guard, not the design.
    const cta = votingCta(
      voting({ votable: false, shareable: true, reason: 'contest_not_open', sharePath: null }),
    );
    assert.equal(cta.showShareButton, false);
  });

  it('shows nothing for an entry that is not shareable', () => {
    for (const reason of ['not_approved', 'not_promoted', 'no_contest', 'contestant_inactive', 'song_not_submitted'] as const) {
      const cta = votingCta(voting({ votable: false, shareable: false, reason }));
      assert.equal(cta.showVoteButton, false, `${reason} must not offer a vote`);
      assert.equal(cta.showShareButton, false, `${reason} must not offer sharing`);
    }
  });

  it('treats a payload without the new flag as not shareable', () => {
    // An older BFF response has no `shareable` key at all. The vote button must
    // keep working exactly as before, and the new CTA must simply stay hidden.
    const legacy = { ...voting(), votable: false, reason: 'contest_not_open' } as Record<
      string,
      unknown
    >;
    delete legacy.shareable;
    const cta = votingCta(legacy as unknown as RegistrationVoting);
    assert.equal(cta.showShareButton, false);
    assert.equal(votingCta({ ...voting(), shareable: undefined } as unknown as RegistrationVoting).showVoteButton, true);
  });
});
