/**
 * "May this user hand in a song for this contest right now?"
 *
 * Before this module the answer was computed in two partial places and both were
 * wrong in opposite directions. `createSubmission` only enforced approval when it
 * happened to find a `competition_enrollments` row by stage name or email, so an
 * applicant who registered through the registration plane — which is the plane the
 * mobile app and `/apply` actually use — had no enrollment, got `null`, and walked
 * straight past the gate. The upload routes checked approval not at all: a signed-up
 * user could presign, store a song and complete it while still `pending`.
 *
 * The classifier is pure so the ordering is testable without a database; the
 * collector below is the only part that talks to Supabase.
 */
import { createAdminClient } from '@/lib/supabase/server';
import { OPEN_MIC_CONTEST_SLUGS } from '@/src/features/openmic/constants';
import { describeSubmissionWindow, type SubmissionWindowVerdict } from './submission-window';

export type EligibilitySource = 'promoted' | 'enrollment' | 'registration' | 'none';

export type EligibilityReason =
  | 'ok'
  /** No such Open Mic edition. */
  | 'no_contest'
  /** Approved and on time, but the admin has not published a beat yet. */
  | 'beat_missing'
  /** The applicant is signed in but not approved for this edition. */
  | 'not_approved'
  /** Approved, but the submission window does not cover now. */
  | 'window_closed';

export type EligibilityVerdict = {
  eligible: boolean;
  source: EligibilitySource;
  reason: EligibilityReason;
  /** Why the window is closed, when it is — so a screen can name the date. */
  window: SubmissionWindowVerdict;
};

export type EligibilityContestInput = {
  id: string;
  slug?: string | null;
  status?: string | null;
  submissionStartAt?: string | null;
  submissionEndAt?: string | null;
  beat?: unknown;
};

/** `registrations.status` values that mean the applicant was accepted. */
const APPROVED_REGISTRATION_STATUSES = ['approved', 'selected_for_public_voting', 'selected_for_bootcamp'];

/** `competition_enrollments.status` values that mean the applicant was accepted. */
const APPROVED_ENROLLMENT_STATUSES = ['approved'];

/**
 * Slugs a registration may carry for Open Mic.
 *
 * A registration stores the catalog slug (`open-mic-competition`), while an
 * edition the admin created has its own. Unifying the two is task 6 of the plan,
 * but rows created before that flip keep the catalog slug, and reading either as
 * Open Mic approval is what lets an already-approved applicant upload a song
 * against the edition that carries the beat.
 */
const OPEN_MIC_REGISTRATION_SLUGS = OPEN_MIC_CONTEST_SLUGS;

/**
 * Pure decision. Sources are tried in the order a reviewer would recognise:
 * an approved registration that already became a roster row beats a bare
 * approved enrollment, which beats an approved registration whose promotion has
 * not run yet.
 */
export function classifyEligibility(input: {
  contest: EligibilityContestInput | null | undefined;
  userId?: string | null;
  promoted: boolean;
  enrollment: boolean;
  registration: boolean;
  nowMs?: number;
}): EligibilityVerdict {
  const { contest } = input;
  const window = describeSubmissionWindow(contest ?? undefined, input.nowMs ?? Date.now());

  if (!contest) {
    return { eligible: false, source: 'none', reason: 'no_contest', window };
  }

  const source: EligibilitySource = input.promoted
    ? 'promoted'
    : input.enrollment
      ? 'enrollment'
      : input.registration
        ? 'registration'
        : 'none';

  if (source === 'none' || !input.userId) {
    return { eligible: false, source: 'none', reason: 'not_approved', window };
  }
  // Beat first: an approved artist with nothing to rap over is blocked on the
  // admin, and telling them "submissions closed" would send them to the wrong
  // person.
  if (!contest.beat) {
    return { eligible: false, source, reason: 'beat_missing', window };
  }
  if (!window.open) {
    return { eligible: false, source, reason: 'window_closed', window };
  }
  return { eligible: true, source, reason: 'ok', window };
}

function anyRows(data: unknown): boolean {
  return Array.isArray(data) && data.length > 0;
}

/**
 * Collect the three facts and classify them.
 *
 * Each lookup is independent and cheap (an indexed existence probe); they run
 * sequentially rather than in parallel so one failing table cannot strand the
 * other two as unhandled rejections, and so the error surfaces with the query
 * that actually caused it.
 */
export async function getSongSubmissionEligibility(
  contest: EligibilityContestInput | null | undefined,
  userId?: string | null,
  nowMs: number = Date.now(),
): Promise<EligibilityVerdict> {
  if (!contest) {
    return classifyEligibility({ contest: null, userId, promoted: false, enrollment: false, registration: false, nowMs });
  }
  if (!userId) {
    return classifyEligibility({ contest, userId: null, promoted: false, enrollment: false, registration: false, nowMs });
  }

  const supabase = createAdminClient();

  // The roster row only exists because approval created it, so it is the
  // strongest signal. `contests` and `connect_contests` are mirrored twins, and
  // the seam writes both columns — match either so a promotion recorded under
  // the other plane's key still counts.
  const { data: promotedRows, error: promotedErr } = await supabase
    .from('contestants')
    .select('id')
    .eq('user_id', userId)
    .or(`contest_id.eq.${contest.id},connect_contest_id.eq.${contest.id}`)
    .limit(1);
  if (promotedErr) throw promotedErr;
  const promoted = anyRows(promotedRows);

  let enrollment = false;
  if (!promoted) {
    const { data: enrollmentRows, error: enrollmentErr } = await supabase
      .from('competition_enrollments')
      .select('id')
      .eq('competition_id', contest.id)
      .eq('user_id', userId)
      .in('status', APPROVED_ENROLLMENT_STATUSES)
      .limit(1);
    if (enrollmentErr) throw enrollmentErr;
    enrollment = anyRows(enrollmentRows);
  }

  let registration = false;
  if (!promoted && !enrollment) {
    const slugs = Array.from(new Set([contest.slug, ...OPEN_MIC_REGISTRATION_SLUGS].filter(Boolean) as string[]));
    if (slugs.length > 0) {
      const { data: registrationRows, error: registrationErr } = await supabase
        .from('registrations')
        .select('id')
        .eq('user_id', userId)
        .in('contest_slug', slugs)
        .in('status', APPROVED_REGISTRATION_STATUSES)
        .limit(1);
      if (registrationErr) throw registrationErr;
      registration = anyRows(registrationRows);
    }
  }

  return classifyEligibility({ contest, userId, promoted, enrollment, registration, nowMs });
}

/** 403 body shared by presign / direct upload / complete so clients switch on one shape. */
export function eligibilityForbiddenBody(verdict: EligibilityVerdict) {
  return {
    message:
      verdict.reason === 'not_approved'
        ? 'Your application has not been approved for this contest yet.'
        : verdict.reason === 'beat_missing'
          ? 'The official beat has not been published for this contest yet.'
          : 'Song submission is currently closed for this contest.',
    reason: verdict.reason,
    source: verdict.source,
    submissionOpensAt: verdict.window.startsAt,
    submissionDeadline: verdict.window.endsAt,
  };
}
