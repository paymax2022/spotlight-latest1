// ── Film Academy — data layer ────────────────────────────────────────────────
// The app and the web app are separate INTERFACES that share an API. These call
// the same /api/academy/* endpoints the web console uses; the screens are native.
//
// Base URL is the shared axios client (EXPO_PUBLIC_API_BASE_URL → frontend-web),
// which is also what proxies every other module's calls.
//
// NOTE ON MONEY: academy_batches stores training_fee_ngn in NAIRA, not kobo.
// It predates the kobo convention used across finance. Do not multiply by 100.

import { api } from '@/api/client';
import type {
  FilmAcademyOverview,
  FilmAcademyApplicationInput,
  FilmAcademyApplicationStatus,
  FilmAcademyCurriculum,
  FilmAcademyAssignments,
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
    // Absent = every batch unrestricted, which is the pre-feature behaviour.
    batchAreas: body?.batchAreas ?? {},
    // Fall back to 2 only if an older server omits it — the server still enforces.
    maxInterestAreas: body?.maxInterestAreas ?? 2,
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

/** The learner's assignments, each with their own submission and grade if any. */
export async function getAssignments(): Promise<FilmAcademyAssignments> {
  const res = await api.get('/api/academy/assignments');
  const body = unwrap<Partial<FilmAcademyAssignments>>(res);
  return {
    locked: body?.locked ?? true,
    reason: body?.reason,
    assignments: body?.assignments ?? [],
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
