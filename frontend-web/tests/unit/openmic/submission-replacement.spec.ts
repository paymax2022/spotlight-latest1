// @vitest-environment node
/**
 * The replacement rule on its own terms.
 *
 * `song-rehandin-replaces-own-entry.spec.ts` drives this through
 * `createSubmission` against a fake Postgres, which is where the bug lived. This
 * file pins the two decisions that spec cannot see from outside: what counts as
 * the artist's own row when the row has no owner, and why one unprovable row
 * stops the whole hand-in instead of being skipped past.
 */
import { describe, expect, it } from 'vitest';

const { planSubmissionReplacement } = await import('@/src/server/openmic/submission-replacement');

const MINE = 'user-mine';
const THEIRS = 'user-theirs';
const NEW = 'entry-new';

function row(overrides: Record<string, any>) {
  return { id: 'row', userId: MINE, status: 'published_for_voting', stageName: 'Test Sd', email: 'a@b.test', ...overrides };
}

function plan(rows: Array<Record<string, any>>, overrides: Record<string, any> = {}) {
  return planSubmissionReplacement({
    submissionId: NEW,
    artistUserId: MINE,
    stageName: 'Test Sd',
    email: 'a@b.test',
    rows: rows.map((r) => row(r)),
    ...overrides,
  });
}

describe('the artist’s own earlier takes', () => {
  it('are the ones with our account on the row', () => {
    expect(plan([{ id: 'old' }])).toEqual({ conflict: false, supersede: ['old'] });
  });

  it('match on stage name or e-mail, and case does not matter', () => {
    const byStage = plan([{ id: 'old', email: 'someone-else@b.test' }], { stageName: ' TEST SD ' });
    expect(byStage).toEqual({ conflict: false, supersede: ['old'] });
    const byEmail = plan([{ id: 'old', stageName: 'Other Name' }], { email: 'A@B.TEST' });
    expect(byEmail).toEqual({ conflict: false, supersede: ['old'] });
  });

  it('never include the row this hand-in is writing', () => {
    expect(plan([{ id: NEW }])).toEqual({ conflict: false, supersede: [] });
  });

  it('skip a row a reviewer already decided about', () => {
    expect(plan([{ id: 'a', status: 'Rejected' }, { id: 'b', status: 'disqualified' }])).toEqual({
      conflict: false,
      supersede: [],
    });
  });

  it('keep every earlier take when there was more than one', () => {
    expect(plan([{ id: 'first' }, { id: 'second' }, { id: 'unrelated', stageName: 'Other', email: 'o@b.test' }])).toEqual({
      conflict: false,
      supersede: ['first', 'second'],
    });
  });

  it('treat an unowned legacy row as ours only when the e-mail matches', () => {
    // E-mail is an account fact; a stage name is free text typed into a form, so
    // it cannot on its own prove that an ownerless row belongs to this signer.
    expect(plan([{ id: 'legacy', userId: null }])).toEqual({ conflict: false, supersede: ['legacy'] });
    expect(plan([{ id: 'legacy', userId: null, email: 'someone-else@b.test' }])).toEqual({
      conflict: true,
      supersede: [],
    });
  });
});

describe('another artist’s entry', () => {
  it('refuses the hand-in', () => {
    expect(plan([{ id: 'theirs', userId: THEIRS, email: 'they@b.test' }])).toEqual({ conflict: true, supersede: [] });
  });

  it('refuses even when other rows are ours to replace, and names none of them', () => {
    const result = plan([{ id: 'mine' }, { id: 'theirs', userId: THEIRS, email: 'they@b.test' }]);
    expect(result.conflict).toBe(true);
    // The caller must not retire anything on a refused hand-in: a partial replace
    // would leave the artist with no live entry at all.
    expect(result.supersede).toEqual([]);
  });

  it('is not collided with when nothing identifies the row', () => {
    expect(plan([{ id: 'quiet', stageName: 'Different', email: 'different@b.test' }])).toEqual({
      conflict: false,
      supersede: [],
    });
  });

  it('ignores a hand-in that carries no identity at all', () => {
    expect(plan([{ id: 'row' }], { stageName: '', email: '' })).toEqual({ conflict: false, supersede: [] });
  });
});
