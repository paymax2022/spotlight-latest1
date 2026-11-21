import { describe, expect, it } from 'vitest';
import { describeSubmissionWindow, isSubmissionWindowOpen } from '@/server/openmic/submission-window';

const NOW = Date.parse('2026-11-19T12:00:00.000Z');
const YESTERDAY = '2026-11-18T12:00:00.000Z';
const TOMORROW = '2026-11-20T12:00:00.000Z';

describe('submission window', () => {
  it('treats the explicit submission_open status as open regardless of dates', () => {
    // The admin console's "open submissions" toggle has to win, otherwise the
    // only way to reopen a closed month is to edit its dates.
    expect(isSubmissionWindowOpen({ status: 'submission_open' }, NOW)).toBe(true);
    expect(isSubmissionWindowOpen({ status: 'submission_open', submissionStartAt: TOMORROW }, NOW)).toBe(true);
    expect(isSubmissionWindowOpen({ status: 'submission_open', submissionEndAt: YESTERDAY }, NOW)).toBe(true);
  });

  it('opens only inside a configured range', () => {
    const contest = { status: 'published', submissionStartAt: YESTERDAY, submissionEndAt: TOMORROW };
    expect(isSubmissionWindowOpen(contest, NOW)).toBe(true);
    expect(isSubmissionWindowOpen(contest, Date.parse(YESTERDAY) - 1)).toBe(false);
    expect(isSubmissionWindowOpen(contest, Date.parse(TOMORROW) + 1)).toBe(false);
    // Inclusive at both bounds: a deadline of 23:59:59 means submissions until it.
    expect(isSubmissionWindowOpen(contest, Date.parse(YESTERDAY))).toBe(true);
    expect(isSubmissionWindowOpen(contest, Date.parse(TOMORROW))).toBe(true);
  });

  it('honours a half-open window (deadline only, or start only)', () => {
    expect(isSubmissionWindowOpen({ status: 'published', submissionEndAt: TOMORROW }, NOW)).toBe(true);
    expect(isSubmissionWindowOpen({ status: 'published', submissionEndAt: YESTERDAY }, NOW)).toBe(false);
    expect(isSubmissionWindowOpen({ status: 'published', submissionStartAt: YESTERDAY }, NOW)).toBe(true);
    expect(isSubmissionWindowOpen({ status: 'published', submissionStartAt: TOMORROW }, NOW)).toBe(false);
  });

  it('is CLOSED when no window is configured', () => {
    // The divergence this module exists to settle: persistence.isWithinWindow said
    // open, presign said closed. Closed is right — an edition with no deadline is
    // a misconfiguration, not an open invitation, and a song accepted outside the
    // admin's schedule is one nobody reviewed.
    expect(isSubmissionWindowOpen({ status: 'published' }, NOW)).toBe(false);
    expect(isSubmissionWindowOpen({ status: 'registration_open' }, NOW)).toBe(false);
    expect(isSubmissionWindowOpen(null, NOW)).toBe(false);
    expect(isSubmissionWindowOpen(undefined, NOW)).toBe(false);
  });

  it('treats an unparseable bound as absent, not as epoch zero', () => {
    // A date-string of '' parsed to NaN; a naive `new Date(x).getTime()` comparison
    // would make every contest look permanently open.
    const verdict = describeSubmissionWindow({ status: 'published', submissionStartAt: 'not-a-date', submissionEndAt: '' }, NOW);
    expect(verdict.open).toBe(false);
    expect(verdict.reason).toBe('no_window_configured');
  });

  it('reports why, so a screen can name the date it is waiting for', () => {
    expect(describeSubmissionWindow({ status: 'published' }, NOW).reason).toBe('no_window_configured');
    const early = describeSubmissionWindow({ status: 'published', submissionStartAt: TOMORROW, submissionEndAt: '2026-12-01T00:00:00.000Z' }, NOW);
    expect(early).toMatchObject({ open: false, reason: 'before_start', startsAt: TOMORROW });
    const late = describeSubmissionWindow({ status: 'published', submissionStartAt: YESTERDAY, submissionEndAt: TOMORROW }, Date.parse('2026-12-01T00:00:00.000Z'));
    expect(late).toMatchObject({ open: false, reason: 'after_end', endsAt: TOMORROW });
    expect(describeSubmissionWindow({ status: 'submission_open' }, NOW)).toMatchObject({ open: true, reason: 'open' });
  });

  it('is case-tolerant on the status, which the DB lowercases on read', () => {
    expect(isSubmissionWindowOpen({ status: 'SUBMISSION_OPEN' }, NOW)).toBe(true);
  });
});
