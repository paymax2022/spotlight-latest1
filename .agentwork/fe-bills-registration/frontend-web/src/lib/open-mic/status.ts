export type OpenMicWindowStage = 'registration' | 'submission' | 'review' | 'voting' | 'final';

export type OpenMicWindow = {
  stage: OpenMicWindowStage | string;
  starts_at: string | null;
  ends_at: string | null;
  is_hard_lock?: boolean;
};

export type OpenMicLifecycleStatus =
  | 'upcoming'
  | 'open_for_submissions'
  | 'under_review'
  | 'voting_live'
  | 'completed';

export type OpenMicStatusMeta = {
  status: OpenMicLifecycleStatus;
  label: string;
  countdown_target: string | null;
};

function withinRange(nowMs: number, startsAt: string | null, endsAt: string | null): boolean {
  if (!startsAt || !endsAt) return false;
  const startMs = new Date(startsAt).getTime();
  const endMs = new Date(endsAt).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
  return startMs <= nowMs && nowMs <= endMs;
}

export function resolveOpenMicStatus(
  windows: OpenMicWindow[],
  now = new Date()
): OpenMicStatusMeta {
  const nowMs = now.getTime();
  const byStage = windows.reduce<Record<string, OpenMicWindow>>((acc, item) => {
    acc[item.stage] = item;
    return acc;
  }, {});

  const registration = byStage.registration;
  const submission = byStage.submission;
  const review = byStage.review;
  const voting = byStage.voting;
  const final = byStage.final;

  if (withinRange(nowMs, submission?.starts_at || null, submission?.ends_at || null)) {
    return {
      status: 'open_for_submissions',
      label: 'Open for submissions',
      countdown_target: submission?.ends_at || null,
    };
  }

  if (withinRange(nowMs, review?.starts_at || null, review?.ends_at || null)) {
    return {
      status: 'under_review',
      label: 'Under review',
      countdown_target: voting?.starts_at || review?.ends_at || null,
    };
  }

  if (withinRange(nowMs, voting?.starts_at || null, voting?.ends_at || null)) {
    return {
      status: 'voting_live',
      label: 'Voting live',
      countdown_target: voting?.ends_at || null,
    };
  }

  const finalEndsMs = final?.ends_at ? new Date(final.ends_at).getTime() : Number.NaN;
  const votingEndsMs = voting?.ends_at ? new Date(voting.ends_at).getTime() : Number.NaN;

  if (
    (Number.isFinite(finalEndsMs) && nowMs > finalEndsMs) ||
    (Number.isFinite(votingEndsMs) && nowMs > votingEndsMs)
  ) {
    return {
      status: 'completed',
      label: 'Completed',
      countdown_target: null,
    };
  }

  const submissionStartsMs = submission?.starts_at
    ? new Date(submission.starts_at).getTime()
    : Number.NaN;
  const registrationStartsMs = registration?.starts_at
    ? new Date(registration.starts_at).getTime()
    : Number.NaN;

  if (Number.isFinite(submissionStartsMs) && nowMs < submissionStartsMs) {
    return {
      status: 'upcoming',
      label: 'Upcoming',
      countdown_target: submission?.starts_at || null,
    };
  }

  if (Number.isFinite(registrationStartsMs) && nowMs < registrationStartsMs) {
    return {
      status: 'upcoming',
      label: 'Upcoming',
      countdown_target: registration?.starts_at || null,
    };
  }

  return {
    status: 'upcoming',
    label: 'Upcoming',
    countdown_target: submission?.starts_at || registration?.starts_at || null,
  };
}
