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
async function call<T>(path: string, init?: RequestInit): Promise<T> {
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
  return (await res.json()) as T;
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
  ready: boolean;
  blockers: Array<{ code: string; message: string }>;
  updatedAt: string;
};

export type AdminTopicSummary = {
  total: number; ready: number; blocked: number; published: number; approved: number; inReview: number;
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
    summary: r.summary ?? { total: 0, ready: 0, blocked: 0, published: 0, approved: 0, inReview: 0 },
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
