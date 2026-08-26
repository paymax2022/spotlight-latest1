// ── Film Academy — types ─────────────────────────────────────────────────────
// Mirrors the payloads of /api/academy/* in frontend-web, which reads Supabase.
// Field names are snake_case because that is what the API returns; they are not
// renamed here so a payload can be compared against the server without a
// mental mapping step.

export interface FilmAcademyBatch {
  id: string;
  batch_name: string;
  start_date: string | null;
  training_schedule: string | null;
  duration_weeks: number | null;
  status: string | null;
  /** Naira, NOT kobo — this table predates the kobo convention. */
  training_fee_ngn: number | null;
  one_off_discount_pct: number | null;
  installments_count: number | null;
  fee_frequency: string | null;
  description: string | null;
}

export interface FilmAcademySettings {
  /** 'paid' means an application fee is charged before an application is accepted. */
  registration_type?: string;
  /** Naira. Charged at APPLICATION time, separate from tuition. */
  application_fee?: number;
  /** Naira. The programme-wide tuition, used when a batch carries no fee of its own. */
  tuition_fee?: number;
  [key: string]: unknown;
}


/** An admin-managed area of interest. `fee_ngn` is NAIRA and is added to the base fee. */
export interface FilmAcademyInterestArea {
  /** Written to academy_applications.areas_of_interest; stable once in use. */
  slug: string;
  label: string;
  description: string | null;
  fee_ngn: number;
}

export interface FilmAcademyOverview {
  batches: FilmAcademyBatch[];
  /** Batch ids this user has already applied to; drives the Applied state. */
  appliedBatchIds: string[];
  settings: FilmAcademySettings;
  /** Active areas with their fees, in admin display order. */
  interestAreas: FilmAcademyInterestArea[];
  /**
   * Slugs each batch offers, keyed by batch id. A batch ABSENT from this map —
   * or present with an empty list — offers every active area.
   */
  batchAreas: Record<string, string[]>;
  /**
   * How many priced areas one application may carry. Served by the API so the
   * cap is not duplicated as a client-side constant that can drift from the
   * rule the server actually enforces.
   */
  maxInterestAreas: number;

}

export interface FilmAcademyApplicationInput {
  batch_id: string;
  full_name: string;
  email: string;
  phone: string;
  areas_of_interest: string[];
  motivation: string;
  experience?: string;
  payment_preference: 'one_off' | 'installment';
  /**
   * Paystack transaction reference for the APPLICATION fee, required when
   * settings.registration_type is 'paid'. The server re-verifies it with
   * Paystack (status success, NGN, amount >= application_fee) — the client is
   * never trusted for the amount, so a client-initialised transaction is fine.
   */
  application_fee_reference?: string;
}

/** One entry in the applicant-visible progress timeline. */
export interface FilmAcademyTimelineEntry {
  id: string;
  old_status: string | null;
  new_status: string | null;
  change_reason: string | null;
  created_at: string | null;
}

/** Something the applicant has to do next. Derived server-side, never guessed here. */
export interface FilmAcademyAction {
  key: string;
  label: string;
  detail: string;
  amountNgn?: number;
  dueDate?: string | null;
}

/** One tuition instalment. `amount_ngn` is NAIRA. */
export interface FilmAcademyInstalment {
  id: string;
  installment_number: number;
  amount_ngn: number;
  due_date: string | null;
  paid_at: string | null;
  status: string | null;
}

export interface FilmAcademyApplicationStatus {
  application: {
    id: string;
    status: string | null;
    payment_status: string | null;
    /** NUMERIC — the naira amount collected, not a boolean flag. */
    application_fee_paid: number | null;
    /** Naira. The sum of the priced areas chosen at application time. */
    tuition_total_ngn: number | null;
    full_name: string | null;
    email: string | null;
    batch_id: string | null;
    created_at: string | null;
    academy_batches?: { batch_name?: string | null; start_date?: string | null } | null;
  } | null;
  timeline: FilmAcademyTimelineEntry[];
  /**
   * True once the learner holds an enrolment — which the server grants on the
   * FIRST settled instalment, not on full settlement. Someone on a three-month
   * plan starts learning immediately after their first payment.
   */
  enrolled: boolean;
  plan: { id: string; total_amount_ngn: number; discounted_amount_ngn: number | null; installments_count: number } | null;
  payments: FilmAcademyInstalment[];
  actions: FilmAcademyAction[];
}

/** Why the learning area is not open yet. Decided server-side. */
export type LearningLockReason =
  | 'no_application'
  | 'not_approved'
  | 'tuition_unpaid'
  | 'no_curriculum';

export interface FilmAcademyLesson {
  id: string;
  title: string;
  description: string | null;
  /** The lecture itself, in markdown. Rendered by <Lecture />. */
  content_markdown: string | null;
  video_url: string | null;
  resource_url: string | null;
  resource_label: string | null;
  estimated_minutes: number | null;
  is_required: boolean | null;
  completed: boolean;
  completed_at: string | null;
}

export interface FilmAcademyModule {
  id: string;
  title: string;
  description: string | null;
  lessons: FilmAcademyLesson[];
  completedCount: number;
}

export interface FilmAcademyCurriculum {
  locked: boolean;
  reason?: LearningLockReason;
  modules: FilmAcademyModule[];
  totalLessons: number;
  completedLessons: number;
}

export interface FilmAcademySubmission {
  id: string;
  submission_link: string | null;
  submission_text: string | null;
  submitted_at: string | null;
  score: number | null;
  grade: string | null;
  feedback: string | null;
  reviewed_at: string | null;
  status: string | null;
}

export interface FilmAcademyAssignment {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  submission_format: string | null;
  max_score: number | null;
  rubric: string | null;
  status: string | null;
  submission: FilmAcademySubmission | null;
}

export interface FilmAcademyAssignments {
  locked: boolean;
  reason?: LearningLockReason;
  assignments: FilmAcademyAssignment[];
}
