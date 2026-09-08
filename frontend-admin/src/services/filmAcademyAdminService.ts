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

// ─── Types (mirror the Supabase rows the routes select) ─────────────────────

export type AcademyBatch = {
  id: string;
  batch_name: string;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  application_deadline: string | null;
  capacity: number | null;
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

export type AcademyInterestArea = {
  id: string;
  slug: string;
  label: string;
  description: string | null;
  fee_ngn: number | null;
  is_active: boolean | null;
  sort_order: number | null;
};

// ─── Transport ──────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
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

// ─── Batches (mobile: the cohort list on /film-academy and /film-academy/apply)

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

// ─── Applications (mobile: /film-academy/status) ────────────────────────────

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

// ─── Tuition plans (mobile: /film-academy/tuition) ──────────────────────────

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

// ─── Curriculum (mobile: /film-academy/learn + lesson/[id]) ─────────────────

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

// ─── Submissions (mobile: /film-academy/assignments) ────────────────────────

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

// ─── Assignment parts: the week 1-4 timeline ────────────────────────────────
// A part is one week's deliverable inside a larger brief. Defining parts turns a
// single-shot assignment into a staged one; an assignment with no parts keeps
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

// ─── Progress ───────────────────────────────────────────────────────────────

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

// ─── Settings & interest areas (mobile: the apply form) ─────────────────────

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

export async function updateInterestArea(input: Partial<AcademyInterestArea> & { id: string }): Promise<AcademyInterestArea> {
  return (await call<{ area: AcademyInterestArea }>(`${B}/interest-areas`, {
    method: 'PUT', body: JSON.stringify(input),
  })).area;
}
