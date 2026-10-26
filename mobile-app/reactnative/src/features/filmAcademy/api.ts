// The app and the web app are separate INTERFACES that share an API. These call
// the same /api/academy/* endpoints the web console uses; the screens are native.
// Base URL is the shared axios client (EXPO_PUBLIC_API_BASE_URL → frontend-web),
// which is also what proxies every other module's calls.
// NOTE ON MONEY: academy_batches stores training_fee_ngn in NAIRA, not kobo.
// It predates the kobo convention used across finance. Do not multiply by 100.

import { Platform } from 'react-native';
import { api } from '@/api/client';
import { createSupabaseClient } from '@/lib/supabase';
import type {
  FilmAcademyOverview,
  FilmAcademyApplicationInput,
  FilmAcademyApplicationStatus,
  FilmTopicPath,
  FilmTopicDetail,
  FilmTopicAttemptView,
  FilmTopicQuizReceipt,
  FilmPracticalView,
  FilmPracticalSubmission,
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

export const filmAcademyPracticalKey = (topicId: string) =>
  ['film-academy', 'practical', topicId];

/**
 * The practical brief, this learner's own submission history and the server's
 * eligibility decision. `assessment` is null while the academy is drafting it.
 */
export async function getPractical(topicId: string): Promise<FilmPracticalView> {
  const res = await api.get(`/api/academy/topics/${encodeURIComponent(topicId)}/practical`);
  const practical = unwrap<{ practical?: FilmPracticalView }>(res).practical;
  if (!practical) throw new Error('This practical assessment is not available.');
  return practical;
}

/** Create or update the one editable draft. Repeated saves update the same row. */
export async function savePracticalDraft(
  topicId: string,
  input: { submissionText: string; mediaUrl: string; mediaNote: string },
): Promise<FilmPracticalSubmission> {
  const res = await api.put(
    `/api/academy/topics/${encodeURIComponent(topicId)}/practical`,
    input,
  );
  const submission = unwrap<{ submission?: FilmPracticalSubmission }>(res).submission;
  if (!submission) throw new Error('The draft was not saved. Please try again.');
  return submission;
}

/** Hand the draft to a reviewer. The server freezes the rubric and pass mark. */
export async function submitPractical(
  topicId: string,
  submissionId: string,
): Promise<FilmPracticalSubmission> {
  const res = await api.post(
    `/api/academy/topics/${encodeURIComponent(topicId)}/practical/submit`,
    { submissionId },
  );
  const submission = unwrap<{ submission?: FilmPracticalSubmission }>(res).submission;
  if (!submission) throw new Error('The practical was submitted, but no receipt came back.');
  return submission;
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

// ── Certificate delivery ─────────────────────────────────────────────────────
// The print/download surface. Unlike every other academy call this one is not
// JSON: the PDF route streams a file, so the shared axios client cannot carry it
// (it would buffer the body and lose the download). The public verification page
// lives on the marketing site, NOT the API host, so its origin is configured
// separately and falls back to production.

const DEFAULT_PUBLIC_SITE_URL = 'https://www.spotlightng.com';

/** Origin of the public site that hosts /verify/certificate. */
export function resolvePublicSiteUrl(): string {
  const configured = (process.env.EXPO_PUBLIC_SITE_URL ?? '').trim();
  return (configured || DEFAULT_PUBLIC_SITE_URL).replace(/\/+$/, '');
}

/** The human verification page a verifier reaches from the printed QR/code. */
export function certificateVerificationUrl(code: string): string {
  return `${resolvePublicSiteUrl()}/verify/certificate/${encodeURIComponent(code.trim())}`;
}

function certificateFilename(certificateNumber: string): string {
  const safe = certificateNumber
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${safe || 'TMFA-certificate'}.pdf`;
}

async function sessionToken(refresh = false): Promise<string | null> {
  const supabase = createSupabaseClient();
  if (refresh) {
    const { data, error } = await supabase.auth.refreshSession();
    return error ? null : data.session?.access_token ?? null;
  }
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export interface CertificateDownload {
  /** file:// URI on native; null on web, where the browser download has begun. */
  uri: string | null;
  filename: string;
}

/**
 * Download the issued PDF. Ownership is resolved by the server from the bearer
 * token — no enrollment or certificate id is sent. A revoked credential 409s
 * with the server's own explanation, which is rethrown verbatim.
 */
export async function downloadCertificatePdf(
  certificateNumber: string,
): Promise<CertificateDownload> {
  const filename = certificateFilename(certificateNumber);
  const endpoint = `${(api.defaults.baseURL ?? '').replace(/\/+$/, '')}/api/academy/certificate/pdf`;
  let token = await sessionToken();
  if (!token) throw new Error('Sign in to download your certificate.');

  if (Platform.OS === 'web') {
    let response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 401) {
      token = await sessionToken(true);
      if (token) {
        response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
      }
    }
    if (response.status === 401) {
      throw new Error('Your session expired. Sign in again to download your certificate.');
    }
    if (!response.ok) {
      let message = 'Could not download your certificate.';
      try {
        const body = (await response.json()) as { error?: unknown };
        if (typeof body.error === 'string' && body.error.trim()) message = body.error;
      } catch { /* keep the generic message */ }
      throw new Error(message);
    }
    const objectUrl = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
    return { uri: null, filename };
  }

  // Lazily required so a web bundle never pulls in the native module.
  const FileSystem = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');
  if (!FileSystem.cacheDirectory) {
    throw new Error('This device cannot store the certificate PDF. Please try again.');
  }
  const target = `${FileSystem.cacheDirectory}${filename}`;
  try {
    await FileSystem.deleteAsync(target, { idempotent: true });
  } catch { /* a stale file must not block the download */ }

  let result = await FileSystem.downloadAsync(endpoint, target, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (result.status === 401) {
    token = await sessionToken(true);
    if (token) {
      result = await FileSystem.downloadAsync(endpoint, target, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  }
  if (result.status === 401) {
    throw new Error('Your session expired. Sign in again to download your certificate.');
  }
  if (result.status !== 200) {
    let message = 'Could not download your certificate.';
    try {
      const raw = await FileSystem.readAsStringAsync(result.uri);
      const body = JSON.parse(raw) as { error?: unknown };
      if (typeof body.error === 'string' && body.error.trim()) message = body.error;
    } catch { /* keep the generic message */ }
    try {
      await FileSystem.deleteAsync(result.uri, { idempotent: true });
    } catch { /* the error body is disposable */ }
    throw new Error(message);
  }

  return { uri: result.uri, filename };
}
