/**
 * Film Academy admin data — PATH A (web proxy).
 *
 * Film Academy has no Go module: its tables (academy_batches,
 * academy_applications, academy_installment_plans, academy_settings,
 * academy_interest_areas and the TMFA film_* tables) live in frontend-web and
 * are served by /api/admin/academy/*. So this goes through /api/web-proxy,
 * exactly like contests / scoring / open-mic (ADR-047).
 *
 * WHY THIS FILE EXISTS: the console page at /admin/academy/film used to be a
 * BRIDGE — four links to /admin/film-academy on the web app. Those pages were
 * removed when the admin portal was consolidated into this console, so every
 * link led to a login redirect and then nothing. The API they used to drive was
 * never removed, so the console can own the screens directly.
 *
 * These endpoints are the SAME data plane the mobile app reads through
 * /api/academy/* (mobile-app/reactnative/src/features/filmAcademy/api.ts):
 *
 *   admin writes here              →  mobile reads there
 *   ─────────────────────────────────────────────────────────────
 *   batches, interest areas,       →  /api/academy/apply        (hub + apply)
 *     settings
 *   application decision           →  /api/academy/application  (status)
 *   installment plans              →  /api/academy/installments (tuition)
 *   topics, media, holds, mastery  →  /api/academy/topics*      (course path)
 *   practicals and certificates    →  /api/academy/topics/:id/practical,
 *                                     /api/academy/certificate  (course path)
 *
 * The legacy programmes/modules/lessons course is retired: its learner screens
 * are gone, and the console no longer manages it. Historical academy_programs/
 * lessons/submission rows are preserved server-side; the backend routes remain
 * for that data, but nothing in this console or the app reads them.
 *
 * MONEY: academy tables store NAIRA, not kobo — training_fee_ngn, fee_ngn,
 * application_fee, tuition_fee, total_amount_ngn are all whole naira. They
 * predate the kobo convention used across finance. Never multiply by 100 here.
 */
import { webProxyBase } from '@/config/env';

export type AcademyBatch = {
  id: string;
  batch_name: string;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  application_deadline: string | null;
  max_students: number | null;
  training_schedule: string | null;
  duration_weeks: number | null;
  training_fee_ngn: number | null;
  installments_count: number | null;
  fee_frequency: string | null;
  one_off_discount_pct: number | null;
  fee_start_offset_days: number | null;
  interest_area_slugs?: string[];
  academy_applications?: Array<{ count: number }>;
};

export type AcademyApplication = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  payment_status: string | null;
  /** NUMERIC in the DB, not a boolean — it is the amount paid, in naira. */
  application_fee_paid: number | string | null;
  created_at: string | null;
  batch_id: string | null;
  areas_of_interest: string[] | null;
  academy_batches?: { batch_name?: string } | null;
};

export type AcademyInstallmentPayment = {
  id: string;
  plan_id?: string;
  sequence?: number | null;
  amount_ngn: number | null;
  due_date: string | null;
  status: string | null;
  paid_at: string | null;
};

export type AcademyInstallmentPlan = {
  id: string;
  application_id: string | null;
  batch_id: string | null;
  total_amount_ngn: number | null;
  installments_count: number | null;
  status: string | null;
  academy_installment_payments?: AcademyInstallmentPayment[];
  academy_applications?: { full_name?: string; email?: string; batch_id?: string } | null;
  compliance?: Record<string, unknown>;
};

export type AcademySettings = {
  id: string | null;
  registration_type: string;
  application_fee: number;
  application_fee_refundable: boolean;
  tuition_fee: number;
  is_active: boolean;
};

export type AcademyPricingKey =
  | 'weekend_day'
  | 'weekend_boarding'
  | 'weekday_day'
  | 'weekday_boarding'
  | 'full_time_boarding';

/** One composite tuition item: a training format priced for one area (NAIRA). */
export type AcademyPricingOption = {
  key: AcademyPricingKey;
  label: string;
  note: string | null;
  price_ngn: number;
  sort_order: number;
};

export type AcademyInterestArea = {
  id: string;
  slug: string;
  label: string;
  description: string | null;
  /** Legacy single fee — retired as what applicants are priced on. */
  fee_ngn: number | null;
  is_active: boolean | null;
  sort_order: number | null;
  /** The five-format tuition structure. Served by GET since the composite pricing change. */
  pricing_options?: AcademyPricingOption[];
};

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return { 'Content-Type': 'application/json' };
  return { 'Content-Type': 'application/json' };
}

/**
 * One request helper so every call reports failures the same way.
 *
 * The status codes are spelled out because they mean different things to the
 * operator and a bare "request failed" sent people to the wrong fix: 401 is a
 * stale console session, 403 is a real permission the account lacks
 * (programs:manage / applications:review), and 404 means the web app is not
 * serving the route — usually WEB_API_BASE_URL pointing at the wrong place.
 */
async function request(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${webProxyBase()}${path}`, {
    cache: 'no-store',
    headers: authHeaders(),
    ...init,
  });
  if (res.status === 401) throw new Error('Film Academy: 401 — the console session expired, sign in again.');
  if (res.status === 403) throw new Error('Film Academy: 403 — this account lacks the required academy permission.');
  if (res.status === 404) throw new Error(`Film Academy: 404 for ${path} — is WEB_API_BASE_URL pointing at the web app?`);
  if (!res.ok) {
    // The routes answer errors as { error: "..." }; surface it rather than the code.
    let detail = '';
    try {
      const body = await res.json();
      detail = typeof body?.error === 'string' ? ` — ${body.error}` : '';
    } catch { /* non-JSON error body */ }
    throw new Error(`Film Academy: ${res.status}${detail}`);
  }
  return res;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  return (await request(path, init)).json() as Promise<T>;
}

const B = '/api/admin/academy';

export async function listBatches(): Promise<AcademyBatch[]> {
  return (await call<{ batches?: AcademyBatch[] }>(`${B}/batches`)).batches ?? [];
}

export async function getBatch(id: string): Promise<AcademyBatch | null> {
  return (await call<{ batch?: AcademyBatch }>(`${B}/batches/${encodeURIComponent(id)}`)).batch ?? null;
}

export type BatchInput = Partial<AcademyBatch> & { batch_name: string; interest_area_slugs?: string[] };

export async function createBatch(input: BatchInput): Promise<AcademyBatch> {
  const r = await call<{ batch: AcademyBatch }>(`${B}/batches`, { method: 'POST', body: JSON.stringify(input) });
  return r.batch;
}

export async function updateBatch(id: string, input: BatchInput): Promise<AcademyBatch> {
  const r = await call<{ batch: AcademyBatch }>(`${B}/batches/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify(input),
  });
  return r.batch;
}

export async function deleteBatch(id: string): Promise<void> {
  await call(`${B}/batches/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function listApplications(filter?: { batchId?: string; status?: string }): Promise<AcademyApplication[]> {
  const qs = new URLSearchParams();
  if (filter?.batchId) qs.set('batchId', filter.batchId);
  if (filter?.status) qs.set('status', filter.status);
  const suffix = qs.toString() ? `?${qs}` : '';
  return (await call<{ applications?: AcademyApplication[] }>(`${B}/applications${suffix}`)).applications ?? [];
}

/**
 * Decide an application.
 *
 * Approving is not just a label: the route auto-creates the instalment plan and
 * calls ensureEnrollment, which is what unlocks /film-academy/tuition and
 * /film-academy/path on the phone. A batch with no tuition enrols on approval
 * alone; where tuition IS due, enrolment waits for the FIRST instalment.
 */
export async function decideApplication(
  id: string,
  input: { status: string; review_notes?: string; score?: number },
): Promise<void> {
  await call(`${B}/applications/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export async function listInstallmentPlans(filter?: { batchId?: string; applicationId?: string }): Promise<AcademyInstallmentPlan[]> {
  const qs = new URLSearchParams();
  if (filter?.batchId) qs.set('batchId', filter.batchId);
  if (filter?.applicationId) qs.set('applicationId', filter.applicationId);
  const suffix = qs.toString() ? `?${qs}` : '';
  return (await call<{ plans?: AcademyInstallmentPlan[] }>(`${B}/installments${suffix}`)).plans ?? [];
}

export async function remindInstallmentPlan(planId: string): Promise<void> {
  await call(`${B}/installments/${encodeURIComponent(planId)}/remind`, { method: 'POST', body: '{}' });
}

export async function getSettings(): Promise<AcademySettings> {
  return (await call<{ settings: AcademySettings }>(`${B}/settings`)).settings;
}

export async function updateSettings(input: Partial<AcademySettings>): Promise<AcademySettings> {
  return (await call<{ settings: AcademySettings }>(`${B}/settings`, {
    method: 'PUT', body: JSON.stringify(input),
  })).settings;
}

export async function listInterestAreas(): Promise<AcademyInterestArea[]> {
  return (await call<{ areas?: AcademyInterestArea[] }>(`${B}/interest-areas`)).areas ?? [];
}

export async function createInterestArea(input: Partial<AcademyInterestArea>): Promise<AcademyInterestArea> {
  return (await call<{ area: AcademyInterestArea }>(`${B}/interest-areas`, {
    method: 'POST', body: JSON.stringify(input),
  })).area;
}

export async function updateInterestArea(
  input: Partial<AcademyInterestArea> & {
    id: string;
    /** Composite tuition repricing; the BFF upserts one row per format. */
    pricing?: Array<{ key: AcademyPricingKey; price_ngn: number }>;
  },
): Promise<AcademyInterestArea> {
  return (await call<{ area: AcademyInterestArea }>(`${B}/interest-areas`, {
    method: 'PUT', body: JSON.stringify(input),
  })).area;
}

// ────────────────────────────────────────────────────────────────────────────
// TOPIC MASTERY PATH (TMFA curriculum pack) — /api/admin/academy/topics*,
// /media*, /holds* and /mastery*.
//
// The import NEVER approves or publishes: every topic lands as a draft, every
// question as a draft. Publication is a separate, server-evaluated gate (approved
// article + reviewed media + >=20 approved questions); the server returns the
// blockers, so the console can never show a Publish button it would refuse.
// Holds and candidate mastery require scores:manage; authoring/import/media
// require programs:manage.
// ────────────────────────────────────────────────────────────────────────────

export type AdminTopicQuestionCounts = {
  draft: number; review: number; approved: number; retired: number; total: number;
};

export type AdminTopicMediaCounts = {
  total: number; required: number; published: number; missingFile: number;
};

export type AdminTopicArticleDepth = {
  words: number; sections: number; hasPractical: boolean; hasSelfCheck: boolean;
  meetsDepthStandard: boolean;
};

export type AdminTopicRow = {
  topicId: string;
  courseId: string;
  courseTitle: string;
  stage: string;
  stageLabel: string;
  title: string;
  contentStatus: string;
  published: boolean;
  quizMinimumPercent: number;
  drawCount: number;
  timeLimitMinutes: number;
  approvedQuestions: number;
  questionCounts: AdminTopicQuestionCounts;
  media: AdminTopicMediaCounts;
  article: AdminTopicArticleDepth;
  waiverSigned: boolean;
  ready: boolean;
  blockers: Array<{ code: string; message: string }>;
  updatedAt: string;
};

export type AdminTopicSummary = {
  total: number; ready: number; blocked: number; published: number; approved: number; inReview: number;
  articlesAtDepth: number;
  approvedQuestionTotal: number; requiredQuestionTotal: number;
  publishedMediaTotal: number; requiredMediaTotal: number;
  waivedTopics: number;
};

export type AdminTopicList = {
  topics: AdminTopicRow[]; summary: AdminTopicSummary; total: number;
  page: number; pageSize: number; hasMore: boolean;
};

export type AdminTopicMediaRow = {
  asset_id: string;
  topic_id: string;
  course_id: string;
  media_type: string;
  required: boolean;
  language: string;
  production_state: string;
  rights_status: string;
  accessibility_status: string;
  instructions: string;
  owner: string;
  media_url: string;
  thumbnail_url: string;
  captions_url: string;
  transcript: string;
  alt_text: string;
  published: boolean;
  blockers: string[];
};

export type AdminTopicHold = {
  id: string; holdType: string; reason: string; status: string;
  createdAt: string; clearedAt: string | null; clearanceNote: string;
};

export type AdminTopicDetail = {
  topic: AdminTopicRow;
  article: string;
  outcomes: Array<{ objective_id: string; description: string }>;
  requiredMedia: string[];
  prerequisites: string[];
  media: AdminTopicMediaRow[];
  accessibleEquivalent: { approved: boolean; note: string };
  holds: AdminTopicHold[];
  mastery: { passed: number; mastered: number; remediation: number; total: number };
  attempts: { total: number; scored: number; inProgress: number };
  audit: Array<{ action: string; actorRole: string; reason: string; createdAt: string }>;
};

export type AdminTopicAction =
  | 'save' | 'submit_review' | 'approve' | 'publish' | 'unpublish' | 'set_accessible_equivalent';

export type AdminTopicMutation = {
  ok: true;
  action: AdminTopicAction;
  published: boolean;
  contentStatus: string;
  returnedToReview: boolean;
  message: string;
};

export async function listAdminTopics(filter?: {
  courseId?: string; status?: string; published?: boolean; ready?: boolean;
  q?: string; page?: number; pageSize?: number;
}): Promise<AdminTopicList> {
  const qs = new URLSearchParams();
  if (filter?.courseId) qs.set('courseId', filter.courseId);
  if (filter?.status) qs.set('status', filter.status);
  if (filter?.published !== undefined) qs.set('published', String(filter.published));
  if (filter?.ready !== undefined) qs.set('ready', String(filter.ready));
  if (filter?.q) qs.set('q', filter.q);
  if (filter?.page) qs.set('page', String(filter.page));
  if (filter?.pageSize) qs.set('pageSize', String(filter.pageSize));
  const suffix = qs.toString() ? `?${qs}` : '';
  const r = await call<Partial<AdminTopicList>>(`${B}/topics${suffix}`);
  return {
    topics: r.topics ?? [],
    summary: r.summary ?? {
      total: 0, ready: 0, blocked: 0, published: 0, approved: 0, inReview: 0,
      articlesAtDepth: 0, approvedQuestionTotal: 0, requiredQuestionTotal: 0,
      publishedMediaTotal: 0, requiredMediaTotal: 0, waivedTopics: 0,
    },
    total: r.total ?? 0,
    page: r.page ?? 1,
    pageSize: r.pageSize ?? 25,
    hasMore: r.hasMore ?? false,
  };
}

export async function getAdminTopic(topicId: string): Promise<AdminTopicDetail> {
  const r = await call<{ topic?: AdminTopicDetail }>(`${B}/topics/${encodeURIComponent(topicId)}`);
  if (!r.topic) throw new Error('Film Academy: the topic detail was empty.');
  return r.topic;
}

export async function mutateAdminTopic(
  topicId: string,
  input: { action: AdminTopicAction; [key: string]: unknown },
): Promise<AdminTopicMutation> {
  const r = await call<{ result?: AdminTopicMutation }>(`${B}/topics/${encodeURIComponent(topicId)}`, {
    method: 'PATCH', body: JSON.stringify(input),
  });
  if (!r.result) throw new Error('Film Academy: the topic action returned no result.');
  return r.result;
}

// ── Bundled TMFA curriculum pack import ─────────────────────────────────────

export type CurriculumImportPreview = {
  version: string;
  sourceHash: string;
  courseCount: number;
  topicCount: number;
  mediaCount: number;
  questionCount: number;
  rejectedQuestionCount: number;
  rejectedQuestions: Array<{ row: number; code: string; message: string }>;
  warnings: string[];
  courses: Array<{ courseId: string; title: string; kind: string; stageLabel: string; topicCount: number }>;
};

export type CurriculumImportResult = {
  version: string;
  courses: { inserted: number; updated: number };
  topics: { inserted: number; updated: number; unchanged: number; returnedToReview: number };
  media: { inserted: number; refreshed: number };
  questions: { inserted: number; updated: number; unchanged: number; locked: number; rejected: number };
  warnings: string[];
  rejectedQuestions: Array<{ row: number; code: string; message: string }>;
};

export async function previewCurriculumPack(): Promise<CurriculumImportPreview> {
  const r = await call<{ preview?: CurriculumImportPreview }>(`${B}/topics/import`);
  if (!r.preview) throw new Error('Film Academy: the import preview was empty.');
  return r.preview;
}

export async function importCurriculumPack(): Promise<CurriculumImportResult> {
  const r = await call<{ result?: CurriculumImportResult }>(`${B}/topics/import`, {
    method: 'POST', body: '{}',
  });
  if (!r.result) throw new Error('Film Academy: the import returned no result.');
  return r.result;
}

// ── Topic question authoring (drafts only) ─────────────────────────────────

export type TopicQuestionPoolRow = {
  topicId: string;
  courseId: string;
  stage: string;
  title: string;
  contentStatus: string;
  published: boolean;
  required: number;
  approved: number;
  draft: number;
  review: number;
  retired: number;
  submitted: number;
  draftAfter: number;
  shortfall: number;
};

export type TopicQuestionProblem = {
  row: number;
  externalCode?: string;
  code: string;
  message: string;
};

export type TopicQuestionPreview = {
  headers: string[];
  sourceHash: string;
  totals: {
    rows: number;
    accepted: number;
    rejected: number;
    wouldInsert: number;
    wouldUpdate: number;
    unchanged: number;
    locked: number;
  };
  topics: TopicQuestionPoolRow[];
  rejected: TopicQuestionProblem[];
  blocked: TopicQuestionProblem[];
  warnings: string[];
};

export type TopicQuestionCommitResult = {
  batchId: string;
  inserted: number;
  updated: number;
  unchanged: number;
  locked: number;
  rejected: TopicQuestionProblem[];
  blocked: TopicQuestionProblem[];
  warnings: string[];
  topics: TopicQuestionPoolRow[];
};

export type TopicQuestionAuthoringContext = {
  headers: string[];
  templateFilename: string;
  topics: TopicQuestionPoolRow[];
};

export async function getTopicQuestionAuthoringContext(): Promise<TopicQuestionAuthoringContext> {
  const r = await call<{ context?: TopicQuestionAuthoringContext }>(
    `${B}/topics/questions/import-preview`,
  );
  if (!r.context) throw new Error('Film Academy: the question authoring context was empty.');
  return r.context;
}

export async function previewTopicQuestionImport(csv: string): Promise<TopicQuestionPreview> {
  const r = await call<{ preview?: TopicQuestionPreview }>(
    `${B}/topics/questions/import-preview`,
    { method: 'POST', body: JSON.stringify({ csv }) },
  );
  if (!r.preview) throw new Error('Film Academy: the question import preview was empty.');
  return r.preview;
}

export async function commitTopicQuestionImport(
  filename: string,
  csv: string,
): Promise<TopicQuestionCommitResult> {
  const r = await call<{ result?: TopicQuestionCommitResult }>(
    `${B}/topics/questions/import-commit`,
    { method: 'POST', body: JSON.stringify({ filename, csv }) },
  );
  if (!r.result) throw new Error('Film Academy: the question import returned no result.');
  return r.result;
}

export async function exportTopicReadiness(): Promise<{ filename: string; csv: string }> {
  const res = await request(`${B}/topics/readiness`);
  return { filename: 'tmfa-topic-readiness.csv', csv: await res.text() };
}

// ── Media production queue ──────────────────────────────────────────────────

export type AdminMediaRow = {
  asset_id: string;
  topic_id: string;
  course_id: string;
  topicTitle: string;
  courseTitle: string;
  media_type: string;
  required: boolean;
  language: string;
  production_state: string;
  rights_status: string;
  accessibility_status: string;
  instructions: string;
  owner: string;
  media_url: string;
  thumbnail_url: string;
  captions_url: string;
  transcript: string;
  alt_text: string;
  blockers: string[];
};

export type AdminMediaList = {
  media: AdminMediaRow[]; summary: Record<string, number>; total: number;
  page: number; pageSize: number; hasMore: boolean;
};

export async function listAdminMedia(filter?: {
  courseId?: string; topicId?: string; productionState?: string; rightsStatus?: string;
  accessibilityStatus?: string; q?: string; page?: number; pageSize?: number;
}): Promise<AdminMediaList> {
  const qs = new URLSearchParams();
  if (filter?.courseId) qs.set('courseId', filter.courseId);
  if (filter?.topicId) qs.set('topicId', filter.topicId);
  if (filter?.productionState) qs.set('productionState', filter.productionState);
  if (filter?.rightsStatus) qs.set('rightsStatus', filter.rightsStatus);
  if (filter?.accessibilityStatus) qs.set('accessibilityStatus', filter.accessibilityStatus);
  if (filter?.q) qs.set('q', filter.q);
  if (filter?.page) qs.set('page', String(filter.page));
  if (filter?.pageSize) qs.set('pageSize', String(filter.pageSize));
  const suffix = qs.toString() ? `?${qs}` : '';
  const r = await call<Partial<AdminMediaList>>(`${B}/media${suffix}`);
  return {
    media: r.media ?? [], summary: r.summary ?? { total: 0 }, total: r.total ?? 0,
    page: r.page ?? 1, pageSize: r.pageSize ?? 50, hasMore: r.hasMore ?? false,
  };
}

export async function updateAdminMedia(
  assetId: string,
  input: {
    productionState?: string; rightsStatus?: string; accessibilityStatus?: string;
    instructions?: string; owner?: string; mediaUrl?: string; thumbnailUrl?: string;
    captionsUrl?: string; transcript?: string; altText?: string;
    expiresAt?: string | null; replacementAssetId?: string | null;
    language?: string; required?: boolean;
  },
): Promise<{ assetId: string; published: boolean; topicUnpublished: boolean; blockers: string[] }> {
  return await call(`${B}/media/${encodeURIComponent(assetId)}`, {
    method: 'PATCH', body: JSON.stringify(input),
  });
}

// ── Academic holds and candidate mastery ────────────────────────────────────

export type AdminHoldRow = {
  id: string;
  enrollmentId: string;
  topicId: string;
  topicTitle: string;
  holdType: string;
  reason: string;
  status: string;
  createdAt: string;
  clearedAt: string | null;
  clearanceNote: string;
  learnerName: string;
  learnerEmail: string;
};

export async function listAdminHolds(filter?: {
  status?: string; topicId?: string; enrollmentId?: string; page?: number; pageSize?: number;
}): Promise<{ holds: AdminHoldRow[]; open: number; total: number; page: number; pageSize: number; hasMore: boolean }> {
  const qs = new URLSearchParams();
  if (filter?.status) qs.set('status', filter.status);
  if (filter?.topicId) qs.set('topicId', filter.topicId);
  if (filter?.enrollmentId) qs.set('enrollmentId', filter.enrollmentId);
  if (filter?.page) qs.set('page', String(filter.page));
  if (filter?.pageSize) qs.set('pageSize', String(filter.pageSize));
  const suffix = qs.toString() ? `?${qs}` : '';
  const r = await call<{ holds?: AdminHoldRow[]; open?: number; total?: number; page?: number; pageSize?: number; hasMore?: boolean }>(
    `${B}/holds${suffix}`,
  );
  return {
    holds: r.holds ?? [], open: r.open ?? 0, total: r.total ?? 0,
    page: r.page ?? 1, pageSize: r.pageSize ?? 25, hasMore: r.hasMore ?? false,
  };
}

export async function createAdminHold(input: {
  enrollmentId: string; topicId: string; holdType: string; reason: string;
}): Promise<{ holdId?: string; masteryState?: string }> {
  const r = await call<{ result?: { holdId?: string; masteryState?: string } }>(`${B}/holds`, {
    method: 'POST', body: JSON.stringify(input),
  });
  return r.result ?? {};
}

export async function clearAdminHold(holdId: string, note = ''): Promise<{ cleared: boolean; masteryState: string }> {
  const r = await call<{ result?: { cleared?: boolean; masteryState?: string } }>(
    `${B}/holds/${encodeURIComponent(holdId)}`,
    { method: 'PATCH', body: JSON.stringify({ note }) },
  );
  return { cleared: r.result?.cleared ?? false, masteryState: r.result?.masteryState ?? '' };
}

export type CandidateMasteryRow = {
  enrollmentId: string;
  userId: string;
  learnerName: string;
  learnerEmail: string;
  batchName: string;
  currentStage: string;
  topicsTouched: number;
  topicsRequired: number;
  topicsPublished: number;
  mastered: number;
  passedWithHold: number;
  remediation: number;
  openHolds: number;
  certificate: {
    id: string;
    certificateNumber: string;
    status: string;
    revokedAt: string | null;
  } | null;
};

export async function listCandidateMastery(filter?: {
  q?: string; page?: number; pageSize?: number;
}): Promise<{ candidates: CandidateMasteryRow[]; total: number; page: number; pageSize: number; hasMore: boolean }> {
  const qs = new URLSearchParams();
  if (filter?.q) qs.set('q', filter.q);
  if (filter?.page) qs.set('page', String(filter.page));
  if (filter?.pageSize) qs.set('pageSize', String(filter.pageSize));
  const suffix = qs.toString() ? `?${qs}` : '';
  const r = await call<{ candidates?: CandidateMasteryRow[]; total?: number; page?: number; pageSize?: number; hasMore?: boolean }>(
    `${B}/mastery${suffix}`,
  );
  return {
    candidates: r.candidates ?? [], total: r.total ?? 0,
    page: r.page ?? 1, pageSize: r.pageSize ?? 25, hasMore: r.hasMore ?? false,
  };
}

// ── Credentials ─────────────────────────────────────────────────────────────
// Issuance is server-recomputed, never a manual override: the route refuses a
// certificate unless every curriculum topic is published, mastered and hold-free.
// A revoked credential stays in the public registry so a verifier sees the
// revocation rather than a dead code.

export type AdminCertificate = {
  id: string;
  certificateNumber: string;
  studentName: string;
  programName: string;
  batchName: string;
  completionDate: string | null;
  status: string;
  verificationCode: string;
  issuedAt: string | null;
  revokedAt: string | null;
  revocationReason: string;
  topicsRequired: number | null;
  topicsMastered: number | null;
};

export async function mutateCertificate(input:
  | { action: 'issue'; enrollmentId: string }
  | { action: 'revoke'; certificateId: string; reason: string }
): Promise<{ certificate: AdminCertificate; created?: boolean }> {
  return call<{ certificate: AdminCertificate; created?: boolean }>(`${B}/certificates`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ── Practical assessments ───────────────────────────────────────────────────
// One assessment per topic. Opening it backfills PRACTICAL_PENDING holds for
// learners who already passed the quiz; grading uses the rubric snapshot frozen
// at submit. The console can never send a percentage — it scores criteria and
// the server applies the exact pass gate.

export type AdminPracticalRubricCriterion = {
  id: string;
  label: string;
  description: string;
  maxPoints: number;
};

export type AdminPracticalAssessment = {
  id: string;
  topicId: string;
  title: string;
  briefMarkdown: string;
  submissionInstructions: string;
  rubric: AdminPracticalRubricCriterion[];
  passPercent: number;
  maxAttempts: number;
  active: boolean;
  topicTitle: string;
  topicPublished: boolean;
  updatedAt: string | null;
  counts: { draft: number; submitted: number; graded: number; passed: number };
};

export type AdminPracticalAssessmentInput = {
  title: string;
  briefMarkdown: string;
  submissionInstructions: string;
  rubric: AdminPracticalRubricCriterion[];
  passPercent: number;
  maxAttempts: number;
  active: boolean;
};

export type AdminPracticalSaveResult = {
  created: boolean;
  assessment: AdminPracticalAssessment;
  gateChanged: 'activated' | 'deactivated' | 'unchanged';
  holdsOpened: number;
  holdsCleared: number;
};

export async function listPracticalAssessments(): Promise<{
  assessments: AdminPracticalAssessment[];
  totals: { draft: number; submitted: number; graded: number; passed: number };
}> {
  const r = await call<{
    assessments?: AdminPracticalAssessment[];
    totals?: { draft: number; submitted: number; graded: number; passed: number };
  }>(`${B}/practical`);
  return {
    assessments: r.assessments ?? [],
    totals: r.totals ?? { draft: 0, submitted: 0, graded: 0, passed: 0 },
  };
}

export async function getPracticalAssessment(topicId: string): Promise<{
  topic: { topicId: string; title: string; published: boolean; prerequisites: string[] };
  assessment: AdminPracticalAssessment | null;
}> {
  return call<{
    topic: { topicId: string; title: string; published: boolean; prerequisites: string[] };
    assessment: AdminPracticalAssessment | null;
  }>(`${B}/practical/${encodeURIComponent(topicId)}`);
}

export async function savePracticalAssessment(
  topicId: string,
  input: AdminPracticalAssessmentInput,
): Promise<AdminPracticalSaveResult> {
  const r = await call<{ result?: AdminPracticalSaveResult }>(
    `${B}/practical/${encodeURIComponent(topicId)}`,
    { method: 'PUT', body: JSON.stringify(input) },
  );
  if (!r.result) throw new Error('Film Academy: the assessment was saved but no result came back.');
  return r.result;
}

export type AdminPracticalQueueRow = {
  id: string;
  submissionId: string;
  topicId: string;
  topicTitle: string;
  enrollmentId: string;
  learnerName: string;
  learnerEmail: string;
  assessmentId: string;
  assessmentTitle: string;
  attemptNumber: number;
  status: string;
  submittedAt: string | null;
  gradedAt: string | null;
  percentage: number | null;
  passed: boolean | null;
  hasText: boolean;
  hasMediaUrl: boolean;
};

export async function listPracticalQueue(filter?: {
  status?: string; topicId?: string; page?: number; pageSize?: number;
}): Promise<{
  submissions: AdminPracticalQueueRow[];
  pending: number;
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}> {
  const qs = new URLSearchParams();
  if (filter?.status) qs.set('status', filter.status);
  if (filter?.topicId) qs.set('topicId', filter.topicId);
  if (filter?.page) qs.set('page', String(filter.page));
  if (filter?.pageSize) qs.set('pageSize', String(filter.pageSize));
  const suffix = qs.toString() ? `?${qs}` : '';
  const r = await call<{
    submissions?: AdminPracticalQueueRow[];
    pending?: number;
    total?: number;
    page?: number;
    pageSize?: number;
    hasMore?: boolean;
  }>(`${B}/practical/queue${suffix}`);
  return {
    submissions: r.submissions ?? [],
    pending: r.pending ?? 0,
    total: r.total ?? 0,
    page: r.page ?? 1,
    pageSize: r.pageSize ?? 25,
    hasMore: r.hasMore ?? false,
  };
}

export type AdminPracticalSubmission = {
  id: string;
  attemptNumber: number;
  status: string;
  submissionText: string;
  mediaUrl: string;
  mediaNote: string;
  submittedAt: string | null;
  gradedAt: string | null;
  earnedPoints: number | null;
  possiblePoints: number | null;
  percentage: number | null;
  passed: boolean | null;
  feedback: string;
  rubricScores: Array<{ criterionId: string; points: number; comment: string }>;
  rubricSnapshot: AdminPracticalRubricCriterion[];
  topicId: string;
  topicTitle: string;
  enrollmentId: string;
  learnerName: string;
  learnerEmail: string;
  assessmentId: string;
  assessmentTitle: string;
  assessmentActive: boolean;
  passThreshold: number;
  gradedBy: string | null;
};

export async function getPracticalSubmission(submissionId: string): Promise<AdminPracticalSubmission> {
  const r = await call<{ submission?: AdminPracticalSubmission }>(
    `${B}/practical/submissions/${encodeURIComponent(submissionId)}`,
  );
  if (!r.submission) throw new Error('Film Academy: the practical submission was not found.');
  return r.submission;
}

export type AdminPracticalGradeResult = {
  reconciled: boolean;
  submission: AdminPracticalSubmission;
  masteryState: string | null;
  holdEffect: 'applied' | 'skipped_inactive';
};

export async function gradePracticalSubmission(
  submissionId: string,
  input: { scores: Array<{ criterionId: string; points: number; comment: string }>; feedback: string },
): Promise<AdminPracticalGradeResult> {
  const r = await call<{ result?: AdminPracticalGradeResult }>(
    `${B}/practical/submissions/${encodeURIComponent(submissionId)}/grade`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  if (!r.result) throw new Error('Film Academy: the grade was saved but no result came back.');
  return r.result;
}

// ── PILOT DELIVERY ───────────────────────────────────────────────────────────
// An audited, non-production exception that lets one course be taught while its
// content is still unreviewed. It does not approve or publish anything, and the
// server refuses it entirely under NODE_ENV=production.

export type PilotCourseState = {
  courseId: string;
  title: string;
  topicCount: number;
  publishedCount: number;
  entryTopicIds: string[];
  active: boolean;
  note: string | null;
  enabledAt: string | null;
};

export type PilotConsoleState = {
  available: boolean;
  production: boolean;
  courses: PilotCourseState[];
};

export type PilotActionResult = {
  courseId: string;
  active: boolean;
  note: string;
  topicCount: number;
  entryTopicIds: string[];
};

export async function getPilotState(): Promise<PilotConsoleState> {
  const r = await call<{ pilot?: PilotConsoleState }>(`${B}/pilot`);
  return r.pilot ?? { available: false, production: false, courses: [] };
}

export async function setCoursePilot(
  courseId: string,
  action: 'enable' | 'revoke',
  note: string,
): Promise<PilotActionResult> {
  const r = await call<{ pilot?: PilotActionResult }>(`${B}/pilot/${encodeURIComponent(courseId)}`, {
    method: 'POST',
    body: JSON.stringify({ action, note }),
  });
  if (!r.pilot) throw new Error('Film Academy: the pilot change was recorded but no state came back.');
  return r.pilot;
}
