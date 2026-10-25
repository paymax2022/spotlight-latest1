// The app and the web app are separate INTERFACES that share an API. These call
// the same /api/academy/* endpoints the web console uses; the screens are native.
// Base URL is the shared axios client (EXPO_PUBLIC_API_BASE_URL → frontend-web),
// which is also what proxies every other module's calls.
// NOTE ON MONEY: academy_batches stores training_fee_ngn in NAIRA, not kobo.
// It predates the kobo convention used across finance. Do not multiply by 100.

import { api } from '@/api/client';
import type {
  FilmAcademyOverview,
  FilmAcademyApplicationInput,
  FilmAcademyApplicationStatus,
  FilmAcademyCurriculum,
  FilmAcademyAssignments,
  FilmAcademyExamList,
  FilmAcademyStartedAttempt,
  FilmAcademyAttemptView,
  FilmAcademyExamResult,
  FilmTopicPath,
  FilmTopicDetail,
  FilmTopicAttemptView,
  FilmTopicQuizReceipt,
  FilmMasteryEventPage,
  FilmCertificateView,
  FilmCertificateIssueResult,
} from './types';

type Envelope = { data?: unknown };

/** The API returns either the object directly or wrapped in { data }. */
function unwrap<T>(res: Envelope): T {
  const body = res.data as Record<string, unknown> | undefined;
  if (body && typeof body === 'object' && 'data' in body && body.data) {
    return body.data as T;
  }
  return body as T;
}

/**
 * Open cohorts, plus which ones this user already applied to.
 * Works signed-out (appliedBatchIds is simply empty), so the hub can render
 * before the user has an account.
 */
export async function getOverview(): Promise<FilmAcademyOverview> {
  const res = await api.get('/api/academy/apply');
  const body = unwrap<Partial<FilmAcademyOverview>>(res);
  return {
    batches: body?.batches ?? [],
    appliedBatchIds: body?.appliedBatchIds ?? [],
    settings: body?.settings ?? {},
    // Empty rather than a hardcoded fallback list: the areas are admin-owned,
    // and inventing client-side ones is exactly how the app came to offer
    // 'Screenwriting' while the database held 'script_writing'.
    interestAreas: body?.interestAreas ?? [],
    // A batch's entry lists exactly the trainings it offers; an empty list
    // means it has none set yet. Only a wholly absent map (an older server)
    // still means "unrestricted".
    batchAreas: body?.batchAreas ?? {},
    // Fall back to 2 only if an older server omits it — the server still enforces.
    maxInterestAreas: body?.maxInterestAreas ?? 2,
    // What the account already knows about the applicant, so the apply form can
    // stop asking for it. Null when signed out, or on an older server.
    applicant: body?.applicant ?? null,
    // Composite tuition structure — empty arrays on an older server, which is
    // how the screens detect they must fall back to the legacy per-area fee.
    pricingStructure: body?.pricingStructure ?? [],
    deliverables: body?.deliverables ?? [],
    feeExclusions: body?.feeExclusions ?? [],
  };
}

/** Submit an application. Requires a signed-in user. */
export async function applyToBatch(input: FilmAcademyApplicationInput): Promise<void> {
  await api.post('/api/academy/apply', input);
}

/** The signed-in user's instalment plan, if the programme issued one. */
export async function getInstallments(): Promise<unknown> {
  const res = await api.get('/api/academy/installments');
  return unwrap(res);
}

/** Shared so the status and tuition screens read and invalidate the same cache. */
export const FILM_ACADEMY_STATUS_KEY = ['film-academy', 'application-status'];

/**
 * The signed-in user's own application: status, timeline, tuition plan, and the
 * actions still outstanding. Returns `application: null` when they have not
 * applied — that is not an error, and the screen renders an empty state.
 */
export async function getApplicationStatus(): Promise<FilmAcademyApplicationStatus> {
  const res = await api.get('/api/academy/application');
  const body = unwrap<Partial<FilmAcademyApplicationStatus>>(res);
  return {
    application: body?.application ?? null,
    timeline: body?.timeline ?? [],
    enrolled: body?.enrolled ?? false,
    plan: body?.plan ?? null,
    payments: body?.payments ?? [],
    actions: body?.actions ?? [],
    // Empty on an older server — the status screen simply hides the section.
    areas: body?.areas ?? [],
    tuitionTotalNgn: Number(body?.tuitionTotalNgn ?? body?.application?.tuition_total_ngn ?? 0),
  };
}

/**
 * Confirm a tuition instalment against a verified Paystack reference.
 * The server re-verifies the reference AND the amount with Paystack, so nothing
 * sent from here is trusted — this only tells the server which instalment the
 * reference belongs to.
 */
export async function payInstalment(input: {
  planId: string;
  paymentId: string;
  reference: string;
}): Promise<void> {
  await api.post('/api/academy/installments/pay', input);
}

/** Shared so the learn and lesson screens read and invalidate the same cache. */
export const FILM_ACADEMY_LEARN_KEY = ['film-academy', 'curriculum'];
/** Shared so submitting an assignment refreshes the list that shows the grade. */
export const FILM_ACADEMY_ASSIGNMENTS_KEY = ['film-academy', 'assignments'];

/**
 * The learner's curriculum. `locked` is not an error: an applicant who has not
 * been approved, or has not paid, gets a reason to render rather than a failure.
 */
export async function getCurriculum(): Promise<FilmAcademyCurriculum> {
  const res = await api.get('/api/academy/learning');
  const body = unwrap<Partial<FilmAcademyCurriculum>>(res);
  return {
    locked: body?.locked ?? true,
    reason: body?.reason,
    modules: body?.modules ?? [],
    totalLessons: body?.totalLessons ?? 0,
    completedLessons: body?.completedLessons ?? 0,
  };
}

/**
 * Mark a lesson complete (or undo it). The enrolment is resolved server-side from
 * the session, so nothing identifying the learner is sent from here.
 */
export async function setLessonProgress(lessonId: string, completed: boolean): Promise<void> {
  await api.post('/api/academy/learning/progress', { lessonId, completed });
}

/**
 * One page of the learner's assignments, each with their submission and grade.
 *
 * Paginated because a cohort's brief list grows all term and the screen used to
 * render every one of them at once. `page` is 1-based.
 */
export async function getAssignments(
  page = 1,
  pageSize = 10,
): Promise<FilmAcademyAssignments> {
  const res = await api.get('/api/academy/assignments', { params: { page, pageSize } });
  const body = unwrap<Partial<FilmAcademyAssignments>>(res);
  const assignments = body?.assignments ?? [];
  return {
    locked: body?.locked ?? true,
    reason: body?.reason,
    assignments,
    page: body?.page ?? page,
    pageSize: body?.pageSize ?? pageSize,
    // An older server sends neither — fall back to "this page is everything"
    // rather than showing a Load-more button that would fetch nothing.
    total: body?.total ?? assignments.length,
    hasMore: body?.hasMore ?? false,
  };
}

/** Submit or resubmit an assignment. A graded one is refused by the server. */
export async function submitAssignment(input: {
  assignmentId: string;
  submissionLink?: string;
  submissionText?: string;
}): Promise<void> {
  await api.post('/api/academy/assignments/submit', input);
}

/**
 * Submit or resubmit ONE PART of a multi-part assignment.
 *
 * A separate endpoint from submitAssignment, not an optional field on it: the
 * two write different rows, and a partId that silently fell through to the
 * whole-assignment path would let a learner's week 2 upload overwrite their
 * week 1. A graded part is refused by the server, same as a graded assignment.
 */
export async function submitAssignmentPart(input: {
  partId: string;
  submissionLink?: string;
  submissionText?: string;
}): Promise<void> {
  await api.post('/api/academy/assignments/parts/submit', input);
}

// ── Exams (PRD BK-10) ────────────────────────────────────────────────────────
// All server-authoritative. The learner sends NO content and NO ids it can be
// trusted for; the exam plane is gated behind FEATURE_FILM_ACADEMY_ASSESSMENT and
// 503s cleanly until an admin has reviewed the bank into exam-eligible questions.

/** Shared so the list + take/result screens invalidate the same cache. */
export const FILM_ACADEMY_EXAMS_KEY = ['film-academy', 'exams'];
/** Per-attempt cache key so autosave/submit refresh only the attempt in play. */
export const filmAcademyAttemptKey = (attemptId: string) => ['film-academy', 'attempt', attemptId];

/** The learner's exams for their programme. `locked` is not an error. */
export async function getExams(): Promise<FilmAcademyExamList> {
  const res = await api.get('/api/academy/exams');
  const body = unwrap<Partial<FilmAcademyExamList>>(res);
  return {
    locked: body?.locked ?? true,
    reason: body?.reason,
    exams: body?.exams ?? [],
  };
}

/**
 * Start (or resume, via the idempotency key) an attempt. The same key on retry
 * returns the SAME attempt rather than drawing fresh, so a double tap cannot
 * spend two of the learner's attempts.
 */
export async function startExamAttempt(
  examId: string,
  idempotencyKey: string,
): Promise<FilmAcademyStartedAttempt> {
  const res = await api.post(`/api/academy/exams/${encodeURIComponent(examId)}/attempt`, {
    idempotencyKey,
  });
  // The server wraps the started attempt as { success, attempt }; unwrap peels the
  // envelope, so read .attempt off the body, exactly like getExams reads .exams.
  return unwrap<{ attempt: FilmAcademyStartedAttempt }>(res).attempt;
}

/** Load an attempt — its questions + saved answers while in progress, or its result. */
export async function getAttempt(attemptId: string): Promise<FilmAcademyAttemptView> {
  const res = await api.get(`/api/academy/attempts/${encodeURIComponent(attemptId)}`);
  const view = unwrap<{ attempt?: Partial<FilmAcademyAttemptView> }>(res).attempt;
  return {
    attemptId: view?.attemptId ?? attemptId,
    state: view?.state ?? 'in_progress',
    startedAt: view?.startedAt ?? null,
    deadlineAt: view?.deadlineAt ?? null,
    expired: view?.expired ?? false,
    questions: view?.questions ?? [],
    answered: view?.answered ?? {},
    result: view?.result ?? null,
  };
}

/**
 * Autosave one answer. Fire-and-forget from the UI; the server owns the deadline
 * and rejects an expired or finalized attempt with 409, which the take screen
 * surfaces without losing the learner's other saved picks.
 */
export async function saveAttemptAnswer(input: {
  attemptId: string;
  attemptQuestionId: string;
  presentationOptionId: string;
}): Promise<void> {
  await api.post(`/api/academy/attempts/${encodeURIComponent(input.attemptId)}/answer`, {
    attemptQuestionId: input.attemptQuestionId,
    presentationOptionId: input.presentationOptionId,
  });
}

/** Submit + finalize. The score is computed and written server-side; at-most-once. */
export async function submitExamAttempt(attemptId: string): Promise<FilmAcademyExamResult> {
  const res = await api.post(`/api/academy/attempts/${encodeURIComponent(attemptId)}/submit`, {});
  const { result } = unwrap<{ result?: FilmAcademyExamResult }>(res);
  // A submit that 200s without a receipt is a server bug, not a learner state:
  // throw so the mutation's onError fires rather than caching result:null and
  // rendering an empty "scored" screen.
  if (!result) throw new Error('The exam was submitted, but no result came back. Please reload.');
  return result;
}

// ── Topic mastery path (TMFA curriculum pack) ───────────────────────────────
// The whole plane is gated behind FEATURE_FILM_ACADEMY_TOPICS (and the quiz
// routes additionally behind FEATURE_FILM_ACADEMY_ASSESSMENT). An unset flag
// 503s cleanly; nothing here assumes the module is live.
//
// Sequence is server-authoritative: a topic returns canStartQuiz=false with a
// blockerMessage until its article is approved, its media are published, its
// prerequisites are MASTERED and at least 20 reviewed questions exist. This file
// only relays that decision.

/** Shared path cache — invalidated by the mastery event poller after a submit. */
export const FILM_ACADEMY_PATH_KEY = ['film-academy', 'path'];
export const filmAcademyTopicKey = (topicId: string) => ['film-academy', 'topic', topicId];
export const filmAcademyTopicAttemptKey = (attemptId: string) =>
  ['film-academy', 'topic-attempt', attemptId];

const EMPTY_TOPIC_SUMMARY: FilmTopicPath['summary'] = {
  totalTopics: 0,
  publishedTopics: 0,
  masteredTopics: 0,
  inProgressTopics: 0,
  remediationTopics: 0,
  percentMastered: 0,
};

/** The learner's derived topic path, grouped by course. Locked is a state, not an error. */
export async function getTopicPath(): Promise<FilmTopicPath> {
  const res = await api.get('/api/academy/topics');
  const path = unwrap<{ path?: Partial<FilmTopicPath> }>(res).path;
  return {
    courses: path?.courses ?? [],
    summary: path?.summary ?? EMPTY_TOPIC_SUMMARY,
    eventsCursor: path?.eventsCursor ?? 0,
  };
}

/** One topic: the article when published, otherwise the reason it is withheld. */
export async function getTopic(topicId: string): Promise<FilmTopicDetail> {
  const res = await api.get(`/api/academy/topics/${encodeURIComponent(topicId)}`);
  const topic = unwrap<{ topic?: FilmTopicDetail }>(res).topic;
  if (!topic) throw new Error('This topic is not available.');
  return topic;
}

/**
 * Start — or resume — a topic quiz. The server applies resume precedence before
 * drawing: the same idempotency key, then an already-open attempt, then a fresh
 * draw. A double tap therefore cannot spend two attempts.
 */
export async function startTopicQuiz(
  topicId: string,
  idempotencyKey: string,
): Promise<FilmTopicAttemptView> {
  const res = await api.post(`/api/academy/topics/${encodeURIComponent(topicId)}/quiz`, {
    idempotencyKey,
  });
  const attempt = unwrap<{ attempt?: FilmTopicAttemptView }>(res).attempt;
  if (!attempt) throw new Error('The quiz did not open. Please try again.');
  return attempt;
}

/** Load an attempt: questions + saved picks while in progress, or the receipt. */
export async function getTopicAttempt(attemptId: string): Promise<FilmTopicAttemptView> {
  const res = await api.get(`/api/academy/topic-attempts/${encodeURIComponent(attemptId)}`);
  const view = unwrap<{ attempt?: Partial<FilmTopicAttemptView> }>(res).attempt;
  return {
    attemptId: view?.attemptId ?? attemptId,
    topicId: view?.topicId ?? '',
    attemptNumber: view?.attemptNumber ?? 1,
    state: view?.state ?? 'in_progress',
    startedAt: view?.startedAt ?? '',
    deadlineAt: view?.deadlineAt ?? '',
    expired: view?.expired ?? false,
    questions: view?.questions ?? [],
    answered: view?.answered ?? {},
    result: view?.result ?? null,
  };
}

/** Autosave one pick. The server owns the deadline and refuses a late save with 409. */
export async function saveTopicAnswer(input: {
  attemptId: string;
  attemptQuestionId: string;
  presentationOptionId: string;
}): Promise<void> {
  await api.post(`/api/academy/topic-attempts/${encodeURIComponent(input.attemptId)}/answer`, {
    attemptQuestionId: input.attemptQuestionId,
    presentationOptionId: input.presentationOptionId,
  });
}

/** Submit + finalize at most once. The exact >=85% gate is applied server-side. */
export async function submitTopicAttempt(attemptId: string): Promise<FilmTopicQuizReceipt> {
  const res = await api.post(
    `/api/academy/topic-attempts/${encodeURIComponent(attemptId)}/submit`,
    {},
  );
  const { result } = unwrap<{ result?: FilmTopicQuizReceipt }>(res);
  if (!result) throw new Error('The quiz was submitted, but no result came back. Please reload.');
  return result;
}

/**
 * One page of the append-only mastery event stream, after `since`.
 *
 * This is a NOTIFICATION aid: the mastery ledger read by getTopicPath remains
 * the truth. A failed poll is therefore swallowed by the caller rather than
 * surfaced as a learning error.
 */
export async function getProgressEvents(
  since = 0,
  limit = 50,
): Promise<FilmMasteryEventPage> {
  const res = await api.get('/api/academy/progress/events', { params: { since, limit } });
  const body = unwrap<Partial<FilmMasteryEventPage>>(res);
  return {
    events: body?.events ?? [],
    cursor: body?.cursor ?? since,
  };
}

export const FILM_ACADEMY_CERTIFICATE_KEY = ['film-academy', 'certificate'];

/** The programme credential plus the exact server blockers still in the way. */
export async function getCertificate(): Promise<FilmCertificateView> {
  const res = await api.get('/api/academy/certificate');
  const body = unwrap<Partial<FilmCertificateView>>(res);
  return {
    readiness: body?.readiness ?? {
      topicsRequired: 0,
      topicsPublished: 0,
      topicsMastered: 0,
      openHolds: 0,
      eligible: false,
      blockers: [],
    },
    certificate: body?.certificate ?? null,
  };
}

/**
 * Ask the server to issue the credential. Eligibility is recomputed there; a
 * refusal (409) is shown verbatim because it names the next real requirement.
 */
export async function requestCertificate(): Promise<FilmCertificateIssueResult> {
  const res = await api.post('/api/academy/certificate', {});
  const body = unwrap<Partial<FilmCertificateIssueResult>>(res);
  if (!body?.readiness) {
    throw new Error('The certificate request did not return an eligibility check. Please reload.');
  }
  return {
    readiness: body.readiness,
    certificate: body.certificate ?? null,
    created: body.created ?? false,
  };
}
