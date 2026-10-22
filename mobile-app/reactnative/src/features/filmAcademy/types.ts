// Mirrors the payloads of /api/academy/* in frontend-web, which reads Supabase.
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
  /** Naira. Programme-wide reference figure only — never billed; tuition comes from each training's fee. */
  tuition_fee?: number;
  [key: string]: unknown;
}

/**
 * One composite tuition item: a training format priced for one area (NAIRA).
 * Every area carries the same five formats — weekend with/without boarding,
 * weekdays with/without boarding, and full-time 30 days with boarding.
 */
export interface FilmAcademyPricingOption {
  key: string;
  label: string;
  note: string | null;
  price_ngn: number;
  sort_order: number;
}

/** An area of interest. `pricing_options` is what tuition is priced on now. */
export interface FilmAcademyInterestArea {
  /** Written to academy_applications.areas_of_interest; stable once in use. */
  slug: string;
  label: string;
  description: string | null;
  /** @deprecated Legacy single fee — the composite format table prices tuition now. */
  fee_ngn: number;
  pricing_options?: FilmAcademyPricingOption[];
}

/**
 * The applicant's details as the ACCOUNT already holds them. The apply form
 * shows these read-only rather than asking for them again; a field that is an
 * empty string is genuinely missing from the profile and still has to be asked
 * for. `null` for the whole object means signed out.
 */
export interface FilmAcademyApplicant {
  full_name: string;
  email: string;
  phone: string;
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
  /** Signed-in applicant's known details, or null when signed out. */
  applicant: FilmAcademyApplicant | null;
  /**
   * The five training formats (identity only — prices live on each area's
   * pricing_options). Empty on an older server, which priced on fee_ngn.
   */
  pricingStructure: Array<{ key: string; label: string; note: string | null; sort_order: number }>;
  /** What the tuition buys, and what it does not cover — server-owned copy. */
  deliverables: string[];
  feeExclusions: string[];
}

export interface FilmAcademyApplicationInput {
  batch_id: string;
  /**
   * Identity fields. OPTIONAL because the server takes them from the signed-in
   * account first — the form only sends one when the profile has no value for
   * it. `email` is always ignored in favour of the session's own address.
   */
  full_name?: string;
  email?: string;
  phone?: string;
  areas_of_interest: string[];
  /**
   * Accordion selection: each chosen area WITH the format (sub) the applicant
   * tapped. When present the server prices tuition per area from these pairs.
   */
  area_selections?: Array<{ slug: string; key: string }>;
  motivation: string;
  experience?: string;
  payment_preference: 'one_off' | 'installment';
  /**
   * Which training format the tuition is priced in — one of the
   * pricingStructure keys. Omitted on an older server, which then falls back
   * to the cheapest format rather than the retired per-area fee.
   */
  pricing_option_key?: string;
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

/**
 * One part of a multi-part assignment — a single week's deliverable.
 *
 * Parts are OPTIONAL. An assignment with none is submitted whole, exactly as
 * before; `parts: []` is the normal, unchanged case rather than an empty state.
 */
export interface FilmAcademyAssignmentPart {
  id: string;
  assignment_id: string;
  part_number: number;
  /** Programme week this part is due in — the "week 1-4" timeline. */
  week_number: number;
  title: string;
  description: string | null;
  due_date: string | null;
  /** null = progress only, not separately scored. */
  max_score: number | null;
  /** An optional part shows on the timeline but never blocks completion. */
  is_required: boolean;
  submission: FilmAcademySubmission | null;
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
  /** Week the brief opens. null = unscheduled (every pre-timeline assignment). */
  week_number: number | null;
  submission: FilmAcademySubmission | null;
  parts: FilmAcademyAssignmentPart[];
  /** Required parts only — the server computes these so the app and the console cannot disagree. */
  partsTotal: number;
  partsSubmitted: number;
  partsComplete: boolean;
}

export interface FilmAcademyAssignments {
  locked: boolean;
  reason?: LearningLockReason;
  assignments: FilmAcademyAssignment[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

// ── Exams (PRD BK-10) ────────────────────────────────────────────────────────
// These mirror /api/academy/exams* and /api/academy/attempts* in frontend-web.
// Server-authoritative: the draw, option shuffle, deadline and score all happen
// there. Nothing here carries a correct answer — a learner sees only their own
// picked option, never which one was right.

/** Why an exam cannot be started — set by the server, mirrors examEligibility. */
export type ExamBlockerCode =
  | 'NOT_FOR_YOUR_PROGRAMME'
  | 'EXAM_MISCONFIGURED'
  | 'ATTEMPT_LIMIT_REACHED'
  | 'EXAM_UNPUBLISHED';

/** One exam on the learner's list. No draw config, no questions, no key. */
export interface FilmAcademyExamSummary {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  passMark: number;
  timeLimitMinutes: number;
  maxAttempts: number;
  attemptsUsed: number;
  canStart: boolean;
  blockerCode: ExamBlockerCode | null;
  blockerMessage: string | null;
}

export interface FilmAcademyExamList {
  locked: boolean;
  reason?: LearningLockReason;
  exams: FilmAcademyExamSummary[];
}

/** One option as presented to the learner — an opaque id, not a bank id. */
export interface ExamPresentedOption {
  presentationOptionId: string;
  text: string;
}

export interface ExamPresentedQuestion {
  attemptQuestionId: string;
  stem: string;
  points: number;
  options: ExamPresentedOption[];
}

/** The started attempt: the immutable draw, already shuffled, plus the timer. */
export interface FilmAcademyStartedAttempt {
  attemptId: string;
  state: 'in_progress';
  startedAt: string;
  deadlineAt: string;
  questionCount: number;
  questions: ExamPresentedQuestion[];
}

/** The committed score. `scorePercent` is 0-100; points are the raw sums. */
export interface FilmAcademyExamResult {
  attemptId: string;
  state: 'scored';
  scorePercent: number;
  earnedPoints: number;
  maxPoints: number;
  passed: boolean;
  answeredCount: number;
  totalCount: number;
}

/** A loaded attempt — replayable while in progress, or the result once scored. */
export interface FilmAcademyAttemptView {
  attemptId: string;
  state: string;
  startedAt: string | null;
  deadlineAt: string | null;
  expired: boolean;
  questions: ExamPresentedQuestion[];
  /** attemptQuestionId -> the learner's own last saved presentationOptionId. */
  answered: Record<string, string>;
  result: FilmAcademyExamResult | null;
}
