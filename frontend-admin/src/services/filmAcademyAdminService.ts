/**
 * Film Academy admin data — PATH A (web proxy).
 *
 * Film Academy has no Go module: its tables (academy_batches,
 * academy_applications, academy_installment_plans, academy_programs/modules/
 * lessons, academy_assignment_submissions, academy_settings,
 * academy_interest_areas) live in frontend-web and are served by
 * /api/admin/academy/*. So this goes through /api/web-proxy, exactly like
 * contests / scoring / open-mic (ADR-047).
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
 *   programs/modules/lessons       →  /api/academy/learning     (learn)
 *   submission grading             →  /api/academy/assignments  (assignments)
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

export type AcademyProgram = { id: string; title: string; batch_id: string | null; is_published: boolean | null };
export type AcademyModule  = { id: string; program_id: string; title: string; description: string | null; order_index: number | null; is_published: boolean | null };
export type AcademyLesson  = { id: string; module_id: string; title: string; estimated_minutes: number | null; order_index: number | null; is_published: boolean | null };
export type AcademyAssignment = { id: string; program_id: string | null; batch_id: string | null; title: string; due_date: string | null; max_score: number | null; status: string | null };

export type AcademyCurriculum = {
  programs: AcademyProgram[];
  modules: AcademyModule[];
  lessons: AcademyLesson[];
  assignments: AcademyAssignment[];
  batches: Array<{ id: string; batch_name: string }>;
};

export type AcademySubmission = {
  id: string;
  status: string | null;
  score: number | null;
  grade: string | null;
  feedback: string | null;
  submitted_at: string | null;
  submission_link?: string | null;
  submission_text?: string | null;
  [k: string]: unknown;
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
  return (await (await request(path, init)).json()) as T;
}

/** For the routes that answer a file rather than JSON — the readiness export. */
async function callFile(path: string, fallbackFilename: string): Promise<{ filename: string; text: string }> {
  const res = await request(path);
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const named = /filename="?([^";]+)"?/i.exec(disposition);
  return { filename: named?.[1] ?? fallbackFilename, text: await res.text() };
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
 * /film-academy/learn on the phone. A batch with no tuition enrols on approval
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

export async function getCurriculum(): Promise<AcademyCurriculum> {
  const r = await call<Partial<AcademyCurriculum>>(`${B}/curriculum`);
  return {
    programs: r.programs ?? [], modules: r.modules ?? [], lessons: r.lessons ?? [],
    assignments: r.assignments ?? [], batches: r.batches ?? [],
  };
}

/** Create/update a curriculum entity. The route dispatches on `kind`. */
export async function saveCurriculum(body: Record<string, unknown>): Promise<unknown> {
  return call(`${B}/curriculum`, { method: 'POST', body: JSON.stringify(body) });
}

/** Seed a starter curriculum for a batch, so `learn` has something to show. */
export async function seedCurriculum(batchId: string): Promise<unknown> {
  return call(`${B}/curriculum/seed`, { method: 'POST', body: JSON.stringify({ batchId }) });
}

export async function listSubmissions(status?: string): Promise<AcademySubmission[]> {
  const suffix = status ? `?status=${encodeURIComponent(status)}` : '';
  return (await call<{ submissions?: AcademySubmission[] }>(`${B}/submissions${suffix}`)).submissions ?? [];
}

/** Grade a submission — the grade the learner then sees on their phone. */
export async function gradeSubmission(input: {
  submissionId: string; score?: number; grade?: string; feedback?: string;
}): Promise<void> {
  await call(`${B}/submissions`, { method: 'PATCH', body: JSON.stringify(input) });
}

// A part is one week's deliverable inside a larger brief. Defining parts turns a
// its original whole-submission behaviour on the phone.

export type AcademyAssignmentPart = {
  id: string;
  assignment_id: string;
  part_number: number;
  week_number: number;
  title: string;
  description: string | null;
  due_date: string | null;
  /** null = progress only, not separately scored. */
  max_score: number | null;
  is_required: boolean;
};

export async function listAssignmentParts(assignmentId: string): Promise<AcademyAssignmentPart[]> {
  const r = await call<{ parts?: AcademyAssignmentPart[] }>(
    `${B}/assignment-parts?assignmentId=${encodeURIComponent(assignmentId)}`,
  );
  return r.parts ?? [];
}

export async function createAssignmentPart(input: {
  assignment_id: string; title: string; week_number: number;
  description?: string; due_date?: string | null; max_score?: number | null; is_required?: boolean;
}): Promise<AcademyAssignmentPart> {
  const r = await call<{ part: AcademyAssignmentPart }>(`${B}/assignment-parts`, {
    method: 'POST', body: JSON.stringify(input),
  });
  return r.part;
}

export async function updateAssignmentPart(
  input: Partial<AcademyAssignmentPart> & { id: string },
): Promise<AcademyAssignmentPart> {
  const r = await call<{ part: AcademyAssignmentPart }>(`${B}/assignment-parts`, {
    method: 'PATCH', body: JSON.stringify(input),
  });
  return r.part;
}

/** Deleting a part also removes every learner's submission of it — the count is returned. */
export async function deleteAssignmentPart(id: string): Promise<number> {
  const r = await call<{ deletedSubmissions?: number }>(
    `${B}/assignment-parts?id=${encodeURIComponent(id)}`, { method: 'DELETE' },
  );
  return r.deletedSubmissions ?? 0;
}

/** Grade one learner's submission of one part. */
export async function gradeAssignmentPart(input: {
  partSubmissionId: string; score: number; grade?: string; feedback?: string;
}): Promise<void> {
  await call(`${B}/assignment-parts`, { method: 'PATCH', body: JSON.stringify(input) });
}

export type ProgressPart = {
  partId: string; partNumber: number; weekNumber: number; title: string;
  dueDate: string | null; submitted: boolean; graded: boolean;
  score: number | null; submittedAt: string | null; submissionId: string | null; overdue: boolean;
};

export type ProgressItem = {
  assignmentId: string; title: string; weekNumber: number | null;
  staged: boolean; expected: number; submitted: number; graded: number; overdue: number;
  parts: ProgressPart[];
  submissionId?: string | null; score?: number | null; submittedAt?: string | null;
};

export type ProgressLearner = {
  enrollmentId: string; applicationId: string; name: string | null; email: string | null;
  expected: number; submitted: number; graded: number; overdue: number;
  completionPct: number; items: ProgressItem[];
};

export type ProgressTotals = {
  learners: number; expected: number; submitted: number;
  graded: number; overdue: number; completionPct: number;
};

export type AssignmentProgress = {
  learners: ProgressLearner[];
  assignments: Array<{
    id: string; title: string; weekNumber: number | null; dueDate: string | null;
    parts: Array<{ id: string; partNumber: number; weekNumber: number; title: string; dueDate: string | null; isRequired: boolean }>;
  }>;
  totals: ProgressTotals;
};

/**
 * Who has sent what, across a cohort.
 *
 * Distinct from listSubmissions: a submission list only shows what ARRIVED, so
 * it cannot answer the question a tutor actually has in week 3 — who has not
 * sent part 2. This returns every learner against every required part, missing
 * ones included, sorted furthest-behind first.
 */
export async function getAssignmentProgress(batchId: string): Promise<AssignmentProgress> {
  const r = await call<Partial<AssignmentProgress>>(
    `${B}/progress?batchId=${encodeURIComponent(batchId)}`,
  );
  return {
    learners: r.learners ?? [],
    assignments: r.assignments ?? [],
    totals: r.totals ?? { learners: 0, expected: 0, submitted: 0, graded: 0, overdue: 0, completionPct: 0 },
  };
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
// ASSESSMENT slice (PRD BK-06/07 + BK-10): question bank, SME review, exams.
// These drive /api/admin/academy/questions* and /api/admin/academy/exams*.
// Import commits DRAFTS only; approve (scores:manage) is the sole path that makes
// a question exam-eligible; publish preflights that the approved pool covers the
// exam's draw. Nothing here is reachable without FEATURE_FILM_ACADEMY_ASSESSMENT.
// ────────────────────────────────────────────────────────────────────────────

export type FilmQuestionOption = { id: string; text: string };
export type FilmQuestionAnswer = { correct: string[]; explanation?: string | null };

export type FilmQuestion = {
  id: string;
  external_code: string | null;
  film_stage: string | null;
  film_module_code: string | null;
  film_department: string | null;
  film_learning_outcome: string | null;
  film_cognitive: string | null;
  film_difficulty: string | null;
  film_points: number | string | null;
  source_version: string | null;
  status: string;
  stem: string;
  options: FilmQuestionOption[];
  answer: FilmQuestionAnswer;
};

export type FilmReview = {
  id: string;
  reviewer_id: string | null;
  decision: string;
  note: string;
  from_status: string | null;
  to_status: string | null;
  created_at: string;
};

export type FilmImportRowProblem = { row: number; externalCode?: string; message: string };

export type FilmImportPreview = {
  batchId: string;
  totals: { rows: number; accepted: number; rejected: number; warned: number };
  rejected: FilmImportRowProblem[];
  warned: FilmImportRowProblem[];
};

export type FilmImportCommit = {
  batchId: string;
  committed: { inserted: number; updated: number; unchanged: number; locked: number; batchId: string | null };
  rejected: FilmImportRowProblem[];
};

export async function previewQuestionImport(filename: string, csv: string): Promise<FilmImportPreview> {
  const r = await call<FilmImportPreview>(`${B}/questions/import-preview`, {
    method: 'POST', body: JSON.stringify({ filename, csv }),
  });
  return {
    batchId: r.batchId,
    totals: r.totals ?? { rows: 0, accepted: 0, rejected: 0, warned: 0 },
    rejected: r.rejected ?? [],
    warned: r.warned ?? [],
  };
}

export async function commitQuestionImport(filename: string, csv: string): Promise<FilmImportCommit> {
  const r = await call<FilmImportCommit>(`${B}/questions/import-commit`, {
    method: 'POST', body: JSON.stringify({ filename, csv }),
  });
  return {
    batchId: r.batchId,
    committed: r.committed ?? { inserted: 0, updated: 0, unchanged: 0, locked: 0, batchId: null },
    rejected: r.rejected ?? [],
  };
}

export async function listQuestions(filter?: {
  status?: string; stage?: string; moduleCode?: string; q?: string; page?: number; pageSize?: number;
}): Promise<{ questions: FilmQuestion[]; total: number; page: number; pageSize: number; hasMore: boolean }> {
  const qs = new URLSearchParams();
  if (filter?.status) qs.set('status', filter.status);
  if (filter?.stage) qs.set('stage', filter.stage);
  if (filter?.moduleCode) qs.set('moduleCode', filter.moduleCode);
  if (filter?.q) qs.set('q', filter.q);
  if (filter?.page) qs.set('page', String(filter.page));
  if (filter?.pageSize) qs.set('pageSize', String(filter.pageSize));
  const suffix = qs.toString() ? `?${qs}` : '';
  const r = await call<{ questions?: FilmQuestion[]; total?: number; page?: number; pageSize?: number; hasMore?: boolean }>(
    `${B}/questions${suffix}`,
  );
  return {
    questions: r.questions ?? [], total: r.total ?? 0, page: r.page ?? 1,
    pageSize: r.pageSize ?? 25, hasMore: r.hasMore ?? false,
  };
}

export async function getQuestion(id: string): Promise<{ question: FilmQuestion; reviews: FilmReview[] }> {
  return await call<{ question: FilmQuestion; reviews: FilmReview[] }>(`${B}/questions/${encodeURIComponent(id)}`);
}

export async function editQuestion(input: {
  id: string; stem?: string; options?: FilmQuestionOption[];
  correctOptionIds?: string[]; explanation?: string; points?: number;
  filmStage?: string; filmModuleCode?: string;
}): Promise<void> {
  await call(`${B}/questions`, { method: 'PATCH', body: JSON.stringify(input) });
}

export async function reviewQuestion(id: string, decision: string, note: string): Promise<string | undefined> {
  const r = await call<{ status?: string }>(`${B}/questions/${encodeURIComponent(id)}/review`, {
    method: 'POST', body: JSON.stringify({ decision, note }),
  });
  return r.status;
}

export type FilmExam = {
  id: string;
  program_id: string;
  title: string;
  description: string | null;
  kind: string;
  pass_mark: number;
  time_limit_minutes: number;
  max_attempts: number;
  is_published: boolean;
  /** ISO instants bounding when learners can start the exam; both required to publish. */
  opens_at: string | null;
  closes_at: string | null;
  draw_stage: string | null;
  draw_module_codes: string[] | null;
  draw_count: number | null;
};

export async function listExams(programId?: string): Promise<FilmExam[]> {
  const suffix = programId ? `?programId=${encodeURIComponent(programId)}` : '';
  return (await call<{ exams?: FilmExam[] }>(`${B}/exams${suffix}`)).exams ?? [];
}

export async function createExam(input: Partial<FilmExam> & { program_id: string; title: string }): Promise<FilmExam> {
  const r = await call<{ exam: FilmExam }>(`${B}/exams`, { method: 'POST', body: JSON.stringify(input) });
  return r.exam;
}

export async function updateExam(id: string, input: Partial<FilmExam>): Promise<FilmExam> {
  const r = await call<{ exam: FilmExam }>(`${B}/exams/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify(input),
  });
  return r.exam;
}

/** Publish runs the pool preflight on the server; a shortfall throws with the reason. */
export async function publishExam(id: string): Promise<void> {
  await call(`${B}/exams/${encodeURIComponent(id)}/publish`, { method: 'POST', body: JSON.stringify({ action: 'publish' }) });
}

export async function unpublishExam(id: string): Promise<void> {
  await call(`${B}/exams/${encodeURIComponent(id)}/publish`, { method: 'POST', body: JSON.stringify({ action: 'unpublish' }) });
}

// ────────────────────────────────────────────────────────────────────────────
// TOPIC-PLANE slice (PRD BK-01..05): the TMFA curriculum graph, its publication
// gates, teaching media, academic holds, candidate mastery, credentials and the
// pilot-delivery escape hatch. These drive /api/admin/academy/{topics,media,
// holds,mastery,certificates,pilot}*, served by frontend-web's
// src/server/services/academy/topics/*. Nothing here is reachable without
// FEATURE_FILM_ACADEMY_TOPICS; the routes answer 503 when the flag is off.
//
// The BFF wraps its payload in `{ success: true, ... }` and puts mutation
// results under `result`, so every wrapper below unwraps to what the caller uses.
// Field naming follows the wire, which is not uniform: topics, holds, mastery and
// pilot are camelCase; film_topic_media rows are the raw snake_case table shape.
// ────────────────────────────────────────────────────────────────────────────

/** Build `?k=v` from defined params; booleans serialise as 'true'/'false'. */
function query(params: Record<string, string | number | boolean | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    qs.set(key, String(value));
  }
  const encoded = qs.toString();
  return encoded ? `?${encoded}` : '';
}

export type PublicationBlocker = { code: string; message: string };

/** The server-measured shape of a topic's teaching article. */
export type AdminTopicArticle = {
  words: number; sections: number; hasPractical: boolean; hasSelfCheck: boolean;
  /** >= 1,000 words, four headings, a practical/application heading, a self-check heading. */
  meetsDepthStandard: boolean;
};

export type AdminTopicQuestionCounts = { draft: number; review: number; approved: number; retired: number; total: number };
export type AdminTopicMediaCounts = { total: number; required: number; published: number; missingFile: number };

export type AdminTopicRow = {
  topicId: string; courseId: string; courseTitle: string;
  stage: string; stageLabel: string; title: string;
  /** draft | review | approved on today's data; the BFF types it as string. */
  contentStatus: string;
  published: boolean;
  quizMinimumPercent: number; drawCount: number; timeLimitMinutes: number;
  approvedQuestions: number;
  questionCounts: AdminTopicQuestionCounts;
  media: AdminTopicMediaCounts;
  article: AdminTopicArticle;
  waiverSigned: boolean;
  ready: boolean;
  /** [] when ready — the gate the Publish button is built from. */
  blockers: PublicationBlocker[];
  updatedAt: string;
};

export type AdminTopicSummary = {
  total: number; ready: number; blocked: number; published: number;
  approved: number; inReview: number; articlesAtDepth: number;
  approvedQuestionTotal: number; requiredQuestionTotal: number;
  publishedMediaTotal: number; requiredMediaTotal: number;
  waivedTopics: number;
};

/** One film_topic_media row, served as the raw snake_case table shape. */
export type AdminMediaRecord = {
  asset_id: string; topic_id: string; course_id: string; media_type: string;
  required: boolean; language: string; status: string;
  production_state: string; rights_status: string; accessibility_status: string;
  instructions: string; owner: string; source_version: string;
  media_url: string; thumbnail_url: string; captions_url: string;
  transcript: string; alt_text: string;
  expires_at: string | null; replacement_asset_id: string | null;
  updated_by: string | null; updated_at: string;
  /** Reasons the asset is not publishable yet; [] means publishable. */
  blockers: string[];
};

/** A queue row adds the resolved topic/course titles the list joins in. */
export type AdminMediaRow = AdminMediaRecord & { topicTitle: string; courseTitle: string };

export type AdminTopicOutcome = { objective_id: string; description: string };

export type AdminTopicHold = {
  id: string; holdType: string; reason: string; status: string;
  createdAt: string; clearedAt: string | null; clearanceNote: string;
};

export type AdminTopicDetail = {
  topic: AdminTopicRow;
  /** lesson_markdown, verbatim. */
  article: string;
  outcomes: AdminTopicOutcome[];
  requiredMedia: string[];
  prerequisites: string[];
  media: AdminMediaRecord[];
  accessibleEquivalent: { approved: boolean; note: string };
  /** Last 50 holds for this topic, across every learner. */
  holds: AdminTopicHold[];
  mastery: { passed: number; mastered: number; remediation: number; total: number };
  attempts: { total: number; scored: number; inProgress: number };
  audit: Array<{ action: string; actorRole: string; reason: string; createdAt: string }>;
};

/** The six admin transitions; save is programs:manage, the other five are scores:manage. */
export type AdminTopicAction =
  | 'save' | 'submit_review' | 'approve' | 'publish' | 'unpublish' | 'set_accessible_equivalent';

export type AdminTopicMutationResult = {
  ok: true; action: AdminTopicAction; published: boolean; contentStatus: string;
  /** True when the save took approved or published content back to review. */
  returnedToReview: boolean;
  message: string;
};

/**
 * Every topic with the gates the server evaluates.
 * Recognised keys besides `action`: title, stage, stageLabel, lessonMarkdown,
 * learningOutcomes, requiredMedia, prerequisites, quizMinimumPercent,
 * quizDrawCount, quizTimeLimitMinutes, accessibleEquivalentApproved,
 * accessibleEquivalentNote.
 */
export async function listAdminTopics(filter?: {
  q?: string; ready?: boolean; published?: boolean; courseId?: string; status?: string;
  page?: number; pageSize?: number;
}): Promise<{ topics: AdminTopicRow[]; summary: AdminTopicSummary; page: number; pageSize: number; total: number; hasMore: boolean }> {
  const r = await call<{
    topics?: AdminTopicRow[]; summary?: AdminTopicSummary;
    page?: number; pageSize?: number; total?: number; hasMore?: boolean;
  }>(`${B}/topics${query({
    q: filter?.q, ready: filter?.ready, published: filter?.published,
    courseId: filter?.courseId, status: filter?.status,
    page: filter?.page, pageSize: filter?.pageSize,
  })}`);
  return {
    topics: r.topics ?? [],
    summary: r.summary ?? {
      total: 0, ready: 0, blocked: 0, published: 0, approved: 0, inReview: 0,
      articlesAtDepth: 0, approvedQuestionTotal: 0, requiredQuestionTotal: 0,
      publishedMediaTotal: 0, requiredMediaTotal: 0, waivedTopics: 0,
    },
    page: r.page ?? 1, pageSize: r.pageSize ?? 25, total: r.total ?? 0, hasMore: r.hasMore ?? false,
  };
}

export async function getAdminTopic(topicId: string): Promise<AdminTopicDetail> {
  // The route answers { success, topic } where topic.topic is the row again.
  const r = await call<{ topic: AdminTopicDetail }>(`${B}/topics/${encodeURIComponent(topicId)}`);
  return r.topic;
}

export async function mutateAdminTopic(
  topicId: string,
  input: { action: AdminTopicAction } & Record<string, unknown>,
): Promise<AdminTopicMutationResult> {
  return (await call<{ result: AdminTopicMutationResult }>(
    `${B}/topics/${encodeURIComponent(topicId)}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  )).result;
}

export type AdminTopicReadinessExport = { filename: string; csv: string };

/**
 * One row per topic with the server-evaluated gate. This route answers a CSV
 * download, not JSON, so it goes through callFile(). The web proxy forwards only
 * Content-Type, so Content-Disposition never reaches here and the filename is
 * the console's own constant — which matches the name the route sets.
 */
export async function exportTopicReadiness(): Promise<AdminTopicReadinessExport> {
  const file = await callFile(`${B}/topics/readiness`, 'tmfa-topic-readiness.csv');
  return { filename: file.filename, csv: file.text };
}

export async function listAdminMedia(filter?: {
  courseId?: string; topicId?: string; productionState?: string; rightsStatus?: string;
  accessibilityStatus?: string; q?: string; page?: number; pageSize?: number;
}): Promise<{ media: AdminMediaRow[]; summary: Record<string, number>; page: number; pageSize: number; total: number; hasMore: boolean }> {
  const r = await call<{
    media?: AdminMediaRow[]; summary?: Record<string, number>;
    page?: number; pageSize?: number; total?: number; hasMore?: boolean;
  }>(`${B}/media${query({
    courseId: filter?.courseId, topicId: filter?.topicId,
    productionState: filter?.productionState, rightsStatus: filter?.rightsStatus,
    accessibilityStatus: filter?.accessibilityStatus, q: filter?.q,
    page: filter?.page, pageSize: filter?.pageSize,
  })}`);
  return { media: r.media ?? [], summary: r.summary ?? {}, page: r.page ?? 1, pageSize: r.pageSize ?? 50, total: r.total ?? 0, hasMore: r.hasMore ?? false };
}

export type AdminMediaUpdate = {
  productionState?: string; rightsStatus?: string; accessibilityStatus?: string;
  instructions?: string; owner?: string;
  mediaUrl?: string; thumbnailUrl?: string; captionsUrl?: string;
  transcript?: string; altText?: string;
  expiresAt?: string | null; replacementAssetId?: string | null;
  language?: string; required?: boolean;
};

/**
 * Save an asset. The server re-derives publishability and, when a required asset
 * regresses, auto-unpublishes its topic so learners are never sent to a broken
 * lesson — that is what `topicUnpublished` reports.
 */
export async function updateAdminMedia(
  assetId: string,
  input: AdminMediaUpdate,
): Promise<{ ok: true; assetId: string; published: boolean; topicUnpublished: boolean; blockers: string[] }> {
  return (await call<{ result: { ok: true; assetId: string; published: boolean; topicUnpublished: boolean; blockers: string[] } }>(
    `${B}/media/${encodeURIComponent(assetId)}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  )).result;
}

export type AdminHoldRow = {
  id: string; enrollmentId: string; topicId: string; topicTitle: string;
  holdType: string; reason: string; status: string;
  createdAt: string; clearedAt: string | null; clearanceNote: string;
  learnerName: string; learnerEmail: string;
};

export async function listAdminHolds(filter?: {
  status?: string; topicId?: string; enrollmentId?: string; page?: number; pageSize?: number;
}): Promise<{ holds: AdminHoldRow[]; open: number; page: number; pageSize: number; total: number; hasMore: boolean }> {
  const r = await call<{
    holds?: AdminHoldRow[]; open?: number;
    page?: number; pageSize?: number; total?: number; hasMore?: boolean;
  }>(`${B}/holds${query({
    status: filter?.status, topicId: filter?.topicId, enrollmentId: filter?.enrollmentId,
    page: filter?.page, pageSize: filter?.pageSize,
  })}`);
  return { holds: r.holds ?? [], open: r.open ?? 0, page: r.page ?? 1, pageSize: r.pageSize ?? 25, total: r.total ?? 0, hasMore: r.hasMore ?? false };
}

/** A hold caps a passing quiz at PASSED independently of the score. */
export async function createAdminHold(input: {
  enrollmentId: string; topicId: string; holdType: string; reason: string;
}): Promise<{ ok: true; holdId: string; masteryState: string | null }> {
  return (await call<{ result: { ok: true; holdId: string; masteryState: string | null } }>(
    `${B}/holds`, { method: 'POST', body: JSON.stringify(input) },
  )).result;
}

/** Clearing the last open hold restores MASTERED only if the learner actually passed. */
export async function clearAdminHold(
  holdId: string,
  note: string,
): Promise<{ ok: true; cleared: boolean; masteryState: string | null }> {
  return (await call<{ result: { ok: true; cleared: boolean; masteryState: string | null } }>(
    `${B}/holds/${encodeURIComponent(holdId)}`, { method: 'PATCH', body: JSON.stringify({ note }) },
  )).result;
}

export type AdminCandidateMastery = {
  enrollmentId: string; userId: string; learnerName: string; learnerEmail: string;
  batchName: string; currentStage: string;
  topicsTouched: number; topicsRequired: number; topicsPublished: number;
  mastered: number; passedWithHold: number; remediation: number; openHolds: number;
  certificate: { id: string; certificateNumber: string; status: string; revokedAt: string | null } | null;
};

/** Reads the film_topic_mastery ledger — the same source the learner path uses. */
export async function listCandidateMastery(filter?: {
  q?: string; page?: number; pageSize?: number;
}): Promise<{ candidates: AdminCandidateMastery[]; page: number; pageSize: number; total: number; hasMore: boolean }> {
  const r = await call<{
    candidates?: AdminCandidateMastery[];
    page?: number; pageSize?: number; total?: number; hasMore?: boolean;
  }>(`${B}/mastery${query({ q: filter?.q, page: filter?.page, pageSize: filter?.pageSize })}`);
  return { candidates: r.candidates ?? [], page: r.page ?? 1, pageSize: r.pageSize ?? 25, total: r.total ?? 0, hasMore: r.hasMore ?? false };
}

export type AdminCertificate = {
  id: string; certificateNumber: string; studentName: string; programName: string;
  batchName: string; completionDate: string | null; grade: string | null; status: string;
  verificationCode: string; issuedAt: string | null; revokedAt: string | null;
  revocationReason: string; curriculumLabel: string;
  topicsRequired: number | null; topicsMastered: number | null;
};

export type AdminCertificateReadiness = {
  topicsRequired: number; topicsPublished: number; topicsMastered: number; openHolds: number;
  eligible: boolean; blockers: PublicationBlocker[];
};

/**
 * Issue or revoke a credential. Issue re-derives eligibility on the server, so a
 * stale console row cannot issue a certificate the learner has not earned —
 * `created: false` means it was already issued.
 */
export async function mutateCertificate(input: { action: 'issue'; enrollmentId: string } | { action: 'revoke'; certificateId: string; reason: string }):
  Promise<{ created?: boolean; certificate: AdminCertificate; readiness?: AdminCertificateReadiness }> {
  return await call<{ created?: boolean; certificate: AdminCertificate; readiness?: AdminCertificateReadiness }>(
    `${B}/certificates`, { method: 'POST', body: JSON.stringify(input) },
  );
}

export type AdminPilotCourse = {
  courseId: string; title: string; topicCount: number; publishedCount: number;
  entryTopicIds: string[]; active: boolean; note: string | null; enabledAt: string | null;
};

export type AdminPilotState = { available: boolean; production: boolean; courses: AdminPilotCourse[] };

/**
 * Pilot delivery state. `available` is false in production — the server never
 * lets an unreviewed course reach learners there.
 */
export async function getPilotState(): Promise<AdminPilotState> {
  const r = await call<{ pilot?: Partial<AdminPilotState> }>(`${B}/pilot`);
  return { available: r.pilot?.available ?? false, production: r.pilot?.production ?? false, courses: r.pilot?.courses ?? [] };
}

export type AdminPilotChange = {
  courseId: string; active: boolean; note: string; enabledAt: string;
  revokedAt: string | null; topicCount: number; entryTopicIds: string[];
};

/** Opens or closes one course for pilot delivery. Writes an audit row, changes no content status. */
export async function setCoursePilot(
  courseId: string,
  action: 'enable' | 'revoke',
  note: string,
): Promise<AdminPilotChange> {
  const r = await call<{ pilot?: AdminPilotChange }>(
    `${B}/pilot/${encodeURIComponent(courseId)}`,
    { method: 'POST', body: JSON.stringify({ action, note }) },
  );
  if (!r.pilot) throw new Error('Film Academy: the pilot response carried no course state.');
  return r.pilot;
}

// ────────────────────────────────────────────────────────────────────────────
// CURRICULUM PACK IMPORT + TOPIC QUESTION POOL
// GET  /topics/import  is the preview, POST the commit — the method decides,
// there is no dry-run flag. Both are programs:manage and both write DRAFTS only:
// an approved or retired question is reported as locked, never rewritten.
// ────────────────────────────────────────────────────────────────────────────

export type CurriculumImportCourse = {
  courseId: string; title: string; kind: 'acting' | 'craft'; stageLabel: string; topicCount: number;
};

export type CurriculumImportRowProblem = { row: number; code: string; message: string };

export type CurriculumImportPreview = {
  version: string; sourceHash: string;
  courseCount: number; topicCount: number; mediaCount: number; questionCount: number;
  rejectedQuestionCount: number;
  /** The server truncates this list; rejectedQuestionCount is the true total. */
  rejectedQuestions: CurriculumImportRowProblem[];
  warnings: string[];
  courses: CurriculumImportCourse[];
};

export type CurriculumImportResult = {
  version: string;
  courses: { inserted: number; updated: number };
  topics: { inserted: number; updated: number; unchanged: number; returnedToReview: number };
  media: { inserted: number; refreshed: number };
  questions: { inserted: number; updated: number; unchanged: number; locked: number; rejected: number };
  warnings: string[];
  rejectedQuestions: CurriculumImportRowProblem[];
};

/** Read-only plan of what importing the bundled TMFA pack would write. */
export async function previewCurriculumPack(): Promise<CurriculumImportPreview> {
  return (await call<{ preview: CurriculumImportPreview }>(`${B}/topics/import`)).preview;
}

export async function importCurriculumPack(): Promise<CurriculumImportResult> {
  return (await call<{ result: CurriculumImportResult }>(
    `${B}/topics/import`, { method: 'POST', body: JSON.stringify({}) },
  )).result;
}

/** A topic's approved pool against its gate, before and after a draft import. */
export type TopicQuestionPoolRow = {
  topicId: string; courseId: string; stage: string; title: string;
  contentStatus: string; published: boolean;
  required: number; approved: number; draft: number; review: number; retired: number;
  /** Rows in the pasted file that bind to this topic. */
  submitted: number;
  /** Draft count after the import — drafts never raise `approved`. */
  draftAfter: number;
  shortfall: number;
};

export type TopicQuestionProblem = {
  row: number; externalCode?: string; code: string; message: string;
};

export type TopicQuestionTotals = {
  rows: number; accepted: number; rejected: number;
  wouldInsert: number; wouldUpdate: number; unchanged: number; locked: number;
};

export type TopicQuestionPreview = {
  headers: string[]; sourceHash: string;
  totals: TopicQuestionTotals;
  topics: TopicQuestionPoolRow[];
  rejected: TopicQuestionProblem[];
  /** Reviewed, module-coded or otherwise-bound rows the import will not touch. */
  blocked: TopicQuestionProblem[];
  warnings: string[];
};

export type TopicQuestionAuthoringContext = {
  headers: string[]; templateFilename: string; topics: TopicQuestionPoolRow[];
};

/** The required CSV columns and every topic's current approved gap. */
export async function getTopicQuestionAuthoringContext(): Promise<TopicQuestionAuthoringContext> {
  return (await call<{ context: TopicQuestionAuthoringContext }>(
    `${B}/topics/questions/import-preview`,
  )).context;
}

export async function previewTopicQuestionImport(csv: string): Promise<TopicQuestionPreview> {
  return (await call<{ preview: TopicQuestionPreview }>(
    `${B}/topics/questions/import-preview`,
    { method: 'POST', body: JSON.stringify({ csv }) },
  )).preview;
}

export async function commitTopicQuestionImport(
  filename: string,
  csv: string,
): Promise<{
  batchId: string; inserted: number; updated: number; unchanged: number; locked: number;
  rejected: TopicQuestionProblem[]; blocked: TopicQuestionProblem[];
  warnings: string[]; topics: TopicQuestionPoolRow[];
}> {
  return (await call<{ result: {
    batchId: string; inserted: number; updated: number; unchanged: number; locked: number;
    rejected: TopicQuestionProblem[]; blocked: TopicQuestionProblem[];
    warnings: string[]; topics: TopicQuestionPoolRow[];
  } }>(
    `${B}/topics/questions/import-commit`,
    { method: 'POST', body: JSON.stringify({ csv, filename }) },
  )).result;
}

// ────────────────────────────────────────────────────────────────────────────
// PRACTICAL ASSESSMENTS. The rubric and pass mark are frozen onto each
// submission at submit time, so editing a rubric never re-grades history.
// Opening the gate (active: true) is learner-visible: it opens a
// PRACTICAL_PENDING hold for every learner who passed the quiz but not the
// practical, capping them at PASSED until they submit.
// ────────────────────────────────────────────────────────────────────────────

export type AdminPracticalRubricCriterion = { id: string; label: string; description: string; maxPoints: number };

export type AdminPracticalAssessment = {
  id: string; topicId: string; topicTitle: string; topicPublished: boolean;
  title: string; briefMarkdown: string; submissionInstructions: string;
  rubric: AdminPracticalRubricCriterion[];
  passPercent: number; maxAttempts: number; active: boolean;
  updatedAt: string | null;
  counts: { draft: number; submitted: number; graded: number; passed: number };
};

export type PracticalAssessmentDraft = {
  title: string; briefMarkdown: string; submissionInstructions: string;
  rubric: AdminPracticalRubricCriterion[];
  passPercent?: number; maxAttempts?: number; active: boolean;
};

export type AdminPracticalSubmission = {
  id: string; attemptNumber: number; status: string;
  submissionText: string; mediaUrl: string; mediaNote: string;
  submittedAt: string | null; gradedAt: string | null;
  earnedPoints: number | null; possiblePoints: number | null;
  percentage: number | null; passed: boolean | null;
  feedback: string;
  rubricScores: Array<{ criterionId: string; points: number; comment: string }>;
  /** The rubric as it stood when the learner submitted — what the grader marks against. */
  rubricSnapshot: AdminPracticalRubricCriterion[];
  topicId: string; topicTitle: string; enrollmentId: string;
  learnerName: string; learnerEmail: string;
  assessmentId: string; assessmentTitle: string; assessmentActive: boolean;
  passThreshold: number;
  gradedBy: string | null;
};

export type AdminPracticalQueueRow = {
  id: string; submissionId: string; topicId: string; topicTitle: string;
  enrollmentId: string; learnerName: string; learnerEmail: string;
  assessmentId: string; assessmentTitle: string;
  attemptNumber: number; status: string;
  submittedAt: string | null; gradedAt: string | null;
  percentage: number | null; passed: boolean | null;
  hasText: boolean; hasMediaUrl: boolean;
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

/** The topic a grader is authoring against, plus its current assessment (null if never authored). */
export async function getPracticalAssessment(topicId: string): Promise<{
  topic: { topicId: string; title: string; published: boolean; prerequisites: string[] };
  assessment: AdminPracticalAssessment | null;
}> {
  return await call<{
    topic: { topicId: string; title: string; published: boolean; prerequisites: string[] };
    assessment: AdminPracticalAssessment | null;
  }>(`${B}/practical/${encodeURIComponent(topicId)}`);
}

/** PUT — there is no POST/PATCH on this route. Saving an active gate opens or clears holds. */
export async function savePracticalAssessment(
  topicId: string,
  draft: PracticalAssessmentDraft,
): Promise<{
  ok: true; created: boolean; assessment: AdminPracticalAssessment;
  gateChanged: 'activated' | 'deactivated' | 'unchanged';
  holdsOpened: number; holdsCleared: number;
}> {
  return (await call<{ result: {
    ok: true; created: boolean; assessment: AdminPracticalAssessment;
    gateChanged: 'activated' | 'deactivated' | 'unchanged';
    holdsOpened: number; holdsCleared: number;
  } }>(
    `${B}/practical/${encodeURIComponent(topicId)}`,
    { method: 'PUT', body: JSON.stringify(draft) },
  )).result;
}

export async function listPracticalQueue(filter?: {
  status?: string; topicId?: string; page?: number; pageSize?: number;
}): Promise<{
  submissions: AdminPracticalQueueRow[]; pending: number;
  page: number; pageSize: number; total: number; hasMore: boolean;
}> {
  const r = await call<{
    submissions?: AdminPracticalQueueRow[]; pending?: number;
    page?: number; pageSize?: number; total?: number; hasMore?: boolean;
  }>(`${B}/practical/queue${query({
    status: filter?.status, topicId: filter?.topicId, page: filter?.page, pageSize: filter?.pageSize,
  })}`);
  return {
    submissions: r.submissions ?? [], pending: r.pending ?? 0,
    page: r.page ?? 1, pageSize: r.pageSize ?? 25, total: r.total ?? 0, hasMore: r.hasMore ?? false,
  };
}

export async function getPracticalSubmission(submissionId: string): Promise<AdminPracticalSubmission> {
  return (await call<{ submission: AdminPracticalSubmission }>(
    `${B}/practical/submissions/${encodeURIComponent(submissionId)}`,
  )).submission;
}

/**
 * Grade a submission. The server recomputes pass/fail from the criterion points
 * against the frozen snapshot — the console's preview is advisory only. A failed
 * practical requires at least 10 characters of feedback (400 otherwise).
 */
export async function gradePracticalSubmission(
  submissionId: string,
  input: { scores: Array<{ criterionId: string; points: number; comment: string }>; feedback: string },
): Promise<{
  ok: true; reconciled: boolean; submission: AdminPracticalSubmission;
  masteryState: string | null; holdEffect: 'applied' | 'skipped_inactive';
}> {
  return (await call<{ result: {
    ok: true; reconciled: boolean; submission: AdminPracticalSubmission;
    masteryState: string | null; holdEffect: 'applied' | 'skipped_inactive';
  } }>(
    `${B}/practical/submissions/${encodeURIComponent(submissionId)}/grade`,
    { method: 'POST', body: JSON.stringify(input) },
  )).result;
}
