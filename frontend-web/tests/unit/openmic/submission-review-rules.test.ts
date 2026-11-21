// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { applyReview, projectReview } from '@/src/server/openmic/review-rules';

/**
 * The rules both Open Mic storage paths apply to a review decision, pinned on
 * their own. persistence.ts and store.ts now share this one implementation, so
 * what could still go wrong is a rule itself — a decision that quietly clears an
 * earlier stamp, or that tells the artist something they should not be told —
 * and those are exactly the things a caller-level test cannot see, because the
 * caller only ever looks at the column it wants.
 */

function submission(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    contestId: 'contest-1',
    stageName: 'Lady Dee',
    songTitle: 'Third Floor Freestyle',
    status: 'submitted',
    isFinalist: false,
    isWinner: false,
    ...overrides,
  } as any;
}

function notice(status: string, note?: string) {
  return projectReview(submission(), { status, note } as any, '2026-11-19T12:00:00.000Z').notification;
}

describe('projectReview', () => {
  it('stamps approval, and only approval, as reviewed', () => {
    const approved = projectReview(submission(), { status: 'approved' }, '2026-11-19T12:00:00.000Z').patch;
    expect(approved.approvedAt).toBe('2026-11-19T12:00:00.000Z');
    expect(approved.publishedAt).toBeUndefined();

    const later = projectReview(
      submission({ approvedAt: '2026-11-18T09:00:00.000Z' }),
      { status: 'finalist' },
      '2026-11-19T12:00:00.000Z',
    ).patch;
    expect(later.approvedAt).toBe('2026-11-18T09:00:00.000Z');
  });

  it('stamps going live, and only that, as published', () => {
    const published = projectReview(submission(), { status: 'published_for_voting' }, '2026-11-19T12:00:00.000Z').patch;
    expect(published.publishedAt).toBe('2026-11-19T12:00:00.000Z');
    expect(published.approvedAt).toBeUndefined();
  });

  it('moves standings without moving the clock back', () => {
    const winner = projectReview(
      submission({ approvedAt: '2026-11-18T09:00:00.000Z', publishedAt: '2026-11-18T10:00:00.000Z' }),
      { status: 'winner' },
      '2026-11-19T12:00:00.000Z',
    ).patch;
    expect(winner).toMatchObject({
      status: 'winner',
      isFinalist: false,
      isWinner: true,
      approvedAt: '2026-11-18T09:00:00.000Z',
      publishedAt: '2026-11-18T10:00:00.000Z',
      updatedAt: '2026-11-19T12:00:00.000Z',
    });
    expect(projectReview(submission(), { status: 'finalist' }, '2026-11-19T12:00:00.000Z').patch.isFinalist).toBe(true);
  });

  it('tells the artist about the three decisions that are about their song', () => {
    expect(notice('published_for_voting')).toMatchObject({
      eventKey: 'song_approved_for_voting',
      title: 'Song Approved for Voting',
    });
    expect(notice('rejected', 'Second verse is off the beat.')).toMatchObject({
      eventKey: 'song_rejected',
      message: 'Second verse is off the beat.',
    });
    expect(notice('correction_requested', 'Add a clean version.')).toMatchObject({
      eventKey: 'song_correction_requested',
      message: 'Add a clean version.',
    });
  });

  it('never sends the artist an empty message', () => {
    for (const status of ['rejected', 'correction_requested']) {
      const value = notice(status);
      expect(typeof value?.message).toBe('string');
      expect(String(value?.message).trim()).not.toBe('');
      expect(String(value?.message).trim()).not.toBe('undefined');
    }
    expect(String(notice('rejected', '   ')?.message).trim()).not.toBe('');
  });

  it('names the song when it says the song is live', () => {
    expect(String(notice('published_for_voting')?.message)).toContain('Third Floor Freestyle');
  });

  it('keeps standings moves off the artist notice board', () => {
    for (const status of ['approved', 'clean_version_requested', 'disqualified', 'finalist', 'winner']) {
      expect(notice(status)).toBeNull();
    }
  });

  it('leaves every field the decision does not speak about alone', () => {
    const before = submission({ isFinalist: true, approvedAt: '2026-11-01T00:00:00.000Z', songTitle: 'Keep Me' });
    const after = applyReview(before, { status: 'rejected', note: 'No' }, '2026-11-19T12:00:00.000Z');
    expect(after.songTitle).toBe('Keep Me');
    expect(after.isFinalist).toBe(true);
    expect(after.approvedAt).toBe('2026-11-01T00:00:00.000Z');
    expect(after.status).toBe('rejected');
    expect(after.reviewNote).toBe('No');
  });
});
