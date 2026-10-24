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
  /** Naira. The programme-wide tuition, used when a batch carries no fee of its own. */
  tuition_fee?: number;
  [key: string]: unknown;
}

/** A priced option within an area (e.g. a course length). NAIRA. Returned active-only. */
export interface FilmAcademyAreaOption {
  id: string;
  label: string;
  duration_label: string | null;
  price_no_boarding_ngn: number;
  /** null = boarding is not offered for this option. */
  price_with_boarding_ngn: number | null;
}

/** One chosen option. Prices are never sent; the server prices from the DB. */
export interface FilmAcademySelection {
  /** Area slug. */
  area: string;
  option_id: string;
  boarding: boolean;
}

/**
 * One entry of an application's `selected_options` snapshot, priced by the
 * server at apply time and never re-priced. NAIRA. `price_ngn` is null only if
 * the stored snapshot is malformed.
 */
export interface FilmAcademySelectedOption {
  area_slug: string;
  option_id: string;
  label: string;
  duration_label: string | null;
  boarding: boolean;
  price_ngn: number | null;
}

/**
 * An admin-managed area of interest. `fee_ngn` is the area's legacy TUITION in
 * NAIRA — payable on acceptance, never part of the application fee — used only
 * when area options are disabled.
 */
export interface FilmAcademyInterestArea {
  /** Written to academy_applications.areas_of_interest; stable once in use. */
  slug: string;
  label: string;
  description: string | null;
  fee_ngn: number;
  /**
   * Active priced options. Always empty when area options are disabled (or on an
   * older server). With them enabled, an area with no options is "Pricing coming
   * soon" and cannot be chosen — it is NOT priced from fee_ngn.
   */
  options: FilmAcademyAreaOption[];
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
  /**
   * Server feature flag FEATURE_FILM_ACADEMY_AREA_OPTIONS_ENABLED. false (also
   * when an older server omits it) = legacy simple area selection sent as
   * `areas_of_interest`; true = option picker sent as `selections`.
   */
  areaOptionsEnabled: boolean;
  /** Signed-in applicant's known details, or null when signed out. */
  applicant: FilmAcademyApplicant | null;
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
  /** Legacy list (area options disabled); the server derives it from `selections` otherwise. */
  areas_of_interest?: string[];
  /** Area options enabled only — the server rejects it while they are disabled. */
  selections?: FilmAcademySelection[];
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

/** One interest area the applicant chose, with the priced option they picked. NAIRA. */
export interface FilmAcademyAppliedArea {
  slug: string;
  label: string;
  optionKey: string | null;
  optionLabel: string | null;
  priceNgn: number;
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
    /** Server-priced snapshot of the chosen options. Absent/null on older applications. */
    selected_options?: unknown;
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
  /** Interest areas applied for. Empty on an older server. */
  areas: FilmAcademyAppliedArea[];
  /** Naira. Sum of the priced areas; 0 when unknown. */
  tuitionTotalNgn: number;
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

export interface FilmAcademyModuleQuiz {
  id: string;
  title: string;
  passMark: number; /** 85 for module quizzes */
  timeLimitMinutes: number;
  maxAttempts: number;
  canStart: boolean;
  /** Null = not attempted, else the learner's last result (scorePercent >= 85 = passed) */
  lastResult: { scorePercent: number; passed: boolean; earnedPoints: number; maxPoints: number } | null;
}

export interface FilmAcademyModule {
  id: string;
  title: string;
  description: string | null;
  lessons: FilmAcademyLesson[];
  completedCount: number;
  /** Module-level quiz (tiered learning: 85% required to unlock next module) */
  quiz?: FilmAcademyModuleQuiz;
  /** True if this module is locked (previous module's quiz not passed at 85%) */
  isLocked?: boolean;
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
