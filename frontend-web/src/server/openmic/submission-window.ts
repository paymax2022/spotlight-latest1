/**
 * When a contestant is allowed to hand in a song.
 *
 * Two route files used to own this decision: the presign route had the strict
 * rule (a contest with no dates configured is CLOSED), while `createSubmission`
 * in persistence had the loose one (`isWithinWindow` returns true when both
 * bounds are missing, so an edition with no dates configured would accept
 * uploads at any time). Strict is the correct default — an Open Mic edition that
 * never configured a deadline is a misconfiguration, not an open invitation —
 * and a song accepted outside its window is one the admin did not schedule.
 *
 * Both callers now use this module, and the reason code is returned so a client
 * can say "submissions open on <date>" instead of showing a dead button.
 */

export type SubmissionWindowLike = {
  status?: string | null;
  submissionStartAt?: string | null;
  submissionEndAt?: string | null;
};

export type SubmissionWindowReason = 'open' | 'no_window_configured' | 'before_start' | 'after_end';

export type SubmissionWindowVerdict = {
  open: boolean;
  reason: SubmissionWindowReason;
  /** The configured bounds, so a screen can name the date it is waiting for. */
  startsAt: string | null;
  endsAt: string | null;
};

/** The contest status that force-opens submissions regardless of dates. */
const FORCED_OPEN_STATUS = 'submission_open';

export function describeSubmissionWindow(
  contest: SubmissionWindowLike | null | undefined,
  nowMs: number = Date.now(),
): SubmissionWindowVerdict {
  const startsAt = contest?.submissionStartAt ? String(contest.submissionStartAt) : null;
  const endsAt = contest?.submissionEndAt ? String(contest.submissionEndAt) : null;

  if (!contest) {
    return { open: false, reason: 'no_window_configured', startsAt: null, endsAt: null };
  }
  if (String(contest.status || '').trim().toLowerCase() === FORCED_OPEN_STATUS) {
    return { open: true, reason: 'open', startsAt, endsAt };
  }

  const startMs = startsAt ? Date.parse(startsAt) : Number.NaN;
  const endMs = endsAt ? Date.parse(endsAt) : Number.NaN;

  if (Number.isNaN(startMs) && Number.isNaN(endMs)) {
    return { open: false, reason: 'no_window_configured', startsAt, endsAt };
  }
  if (!Number.isNaN(startMs) && nowMs < startMs) {
    return { open: false, reason: 'before_start', startsAt, endsAt };
  }
  if (!Number.isNaN(endMs) && nowMs > endMs) {
    return { open: false, reason: 'after_end', startsAt, endsAt };
  }
  return { open: true, reason: 'open', startsAt, endsAt };
}

export function isSubmissionWindowOpen(
  contest: SubmissionWindowLike | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  return describeSubmissionWindow(contest, nowMs).open;
}
